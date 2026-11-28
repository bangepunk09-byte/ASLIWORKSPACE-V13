import { memo, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { Avatar } from "../../components/common";

const INITIAL_VISIBLE_COUNT = 4;
const TASK_LINE_RE = /^[•\-*]\s*\**\s*(TSK-\d+|T-\d+)\s*\**\s*[—–\-:]\s*(.+)$/i;

function stripMarkdownAndEmoji(str = "") {
  return String(str)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, "")
    .replace(/:\s*$/, "")
    .trim();
}

function computeLiveProgress(t) {
  if (!t) return 0;
  const isDone = t.status === "done" || Boolean(t.archived);
  const approvedBy = t.approvals?.approved_by || t.approval?.approved_by || [];
  const approvalCount = Array.isArray(approvedBy) ? approvedBy.length : 0;
  if (isDone || approvalCount >= 2) return 100;
  const approvalPct = approvalCount === 1 ? 50 : 0;
  const cps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
  if (cps.length > 0) {
    if (typeof t.progress === "number" && Number.isFinite(t.progress)) {
      return Math.min(100, Math.max(0, Math.round(t.progress)));
    }
    const doneCp = cps.filter((c) => c?.done || c?.completed || c?.status === "done").length;
    return Math.min(100, Math.max(0, Math.round((doneCp / cps.length) * 100)));
  }
  const explicitProgress = typeof t.progress === "number" && Number.isFinite(t.progress) ? t.progress : null;
  if (explicitProgress !== null) {
    return Math.min(100, Math.max(0, Math.round(Math.max(explicitProgress, approvalPct))));
  }
  const st = String(t.status || "").toLowerCase();
  if (st === "in_review" || st === "review") return Math.max(80, approvalPct);
  if (st === "in_progress" || st === "doing") return Math.max(40, approvalPct);
  return approvalPct;
}

function formatShortDeadline(item) {
  if (item.is_done) return { text: "Selesai", tone: "done" };
  if (item.is_overdue) {
    return {
      text: item.late_duration ? `Terlambat ${item.late_duration}` : "Terlambat",
      tone: "overdue",
    };
  }
  if (item.is_under_6h) {
    return {
      text: item.deadline_wib && item.deadline_wib !== "-" ? `Mepet · ${item.deadline_wib.replace(/ WIB$/i, "")}` : "Mepet (<6 jam)",
      tone: "soon",
    };
  }
  if (item.is_due_today) {
    return {
      text: item.deadline_wib && item.deadline_wib !== "-" ? `Hari ini · ${item.deadline_wib.split(",")[1]?.replace(/ WIB$/i, "").trim() || item.deadline_wib}` : "Hari ini",
      tone: "soon",
    };
  }
  if (item.is_due_tomorrow) {
    return {
      text: item.deadline_wib && item.deadline_wib !== "-" ? `Besok · ${item.deadline_wib.split(",")[1]?.replace(/ WIB$/i, "").trim() || item.deadline_wib}` : "Besok",
      tone: "soon",
    };
  }
  const raw = String(item.deadline_wib || "").trim();
  if (!raw || raw === "-" || /^tanpa deadline$/i.test(raw)) {
    return { text: "Tanpa deadline", tone: "muted" };
  }
  if (/^telat\b/i.test(raw)) {
    return { text: raw.replace(/^telat\b/i, "Terlambat"), tone: "overdue" };
  }
  return { text: raw.replace(/ WIB$/i, ""), tone: "normal" };
}

/**
 * Fast detector used by MessageItem to decide whether an Asli Assistant
 * message should render as the minimalist Executive Summary + Compact List card.
 */
export function detectAssistantReport(m) {
  if (!m || m.deleted) return false;
  if (m.type === "assistant_report" || m.assistant_report?.kind === "task_report") return true;
  if (m.sender_id !== "user_circle_assistant" || !m.text) return false;
  const lines = String(m.text).split(/\r?\n/);
  let matchCount = 0;
  for (const line of lines) {
    if (TASK_LINE_RE.test(line.trim())) {
      matchCount += 1;
      if (matchCount >= 2) return true;
    }
  }
  // Single task bullet under an explicit task report heading also upgrades cleanly
  if (matchCount === 1 && /tugas|deadline|telat|overdue|proyek|label|review/i.test(String(m.text))) {
    return true;
  }
  return false;
}

/**
 * Parses legacy/plain-text Asli Assistant task reports (e.g. existing chat history
 * or Gemini-formatted task bullet lists) into the unified structured report shape.
 */
function parseLegacyAssistantReport(text = "") {
  const rawLines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  let title = "";
  let subtitle = "";
  let loadStatus = null;
  let loadLabel = null;
  let parsedDone = null;
  let parsedTotal = null;
  let extraMoreCount = 0;

  for (const line of rawLines) {
    const taskMatch = line.match(TASK_LINE_RE);
    if (taskMatch) {
      const code = taskMatch[1].toUpperCase();
      const rest = taskMatch[2];
      const parts = rest.split("|").map((p) => p.trim()).filter(Boolean);
      const taskTitle = stripMarkdownAndEmoji(parts[0] || "Tanpa Judul");
      let assigneeNames = [];
      let boardName = "";
      let deadlineText = "tanpa deadline";

      for (let i = 1; i < parts.length; i += 1) {
        const seg = parts[i];
        if (/^PIC\s*:/i.test(seg)) {
          const val = seg.replace(/^PIC\s*:/i, "").trim();
          if (val && !/^belum di-assign$/i.test(val) && val !== "-") {
            assigneeNames = val.split(",").map((s) => s.trim()).filter(Boolean);
          }
        } else if (/^Board\s*:/i.test(seg)) {
          boardName = seg.replace(/^Board\s*:/i, "").trim();
        } else {
          deadlineText = seg;
        }
      }

      const isOverdue = /^telat\b|terlambat|overdue/i.test(deadlineText);
      const lateMatch = deadlineText.match(/telat\s+([^()]+)/i);
      items.push({
        id: "",
        number_str: code,
        title: taskTitle,
        status: "in_progress",
        priority: "medium",
        progress: null,
        board_id: null,
        board_name: boardName || "Workspace",
        assignee_ids: [],
        assignee_names: assigneeNames,
        deadline: null,
        deadline_wib: /^tanpa deadline$/i.test(deadlineText) ? "-" : deadlineText,
        is_done: false,
        is_overdue: isOverdue,
        is_under_6h: false,
        is_due_today: /hari ini/i.test(deadlineText),
        is_due_tomorrow: /besok/i.test(deadlineText),
        late_duration: lateMatch ? lateMatch[1].trim() : null,
      });
      continue;
    }

    const moreMatch = line.match(/dan\s+(\d+)\s+tugas\s+lainnya/i);
    if (moreMatch) {
      extraMoreCount = Number(moreMatch[1]) || 0;
      continue;
    }

    // Extract profile/subtitle & summary counters if present above the task list
    const profileMatch = line.match(/Profil\s*&\s*Beban Kerja:\s*\**([^(*\n]+?)\**\s*\(([^)]+)\)/i);
    if (profileMatch) {
      if (!subtitle) subtitle = stripMarkdownAndEmoji(profileMatch[2]);
      continue;
    }

    const loadMatch = line.match(/Status Load:\s*\**([^—\n*]+?)\**/i);
    if (loadMatch) {
      const lbl = loadMatch[1].trim();
      loadLabel = lbl;
      if (/pressure/i.test(lbl)) loadStatus = "pressure";
      else if (/stabil/i.test(lbl)) loadStatus = "stabil";
      else if (/optimal/i.test(lbl)) loadStatus = "optimal";
      continue;
    }

    const doneMatch = line.match(/Selesai:\s*\**(\d+)\**/i);
    if (doneMatch) {
      parsedDone = Number(doneMatch[1]);
    }
    const totalMatch = line.match(/(\d+)\s+total/i);
    if (totalMatch) {
      parsedTotal = Number(totalMatch[1]);
    }

    // Prefer the closest task-related section heading right before the bullet list
    if (items.length === 0 && !line.startsWith("•") && !line.startsWith("-")) {
      const cleaned = stripMarkdownAndEmoji(line);
      if (cleaned && cleaned.length <= 96) {
        title = cleaned;
      }
    }
  }

  return {
    kind: "task_report",
    title: title || "Ringkasan Tugas",
    subtitle: subtitle || undefined,
    load_status: loadStatus,
    load_label: loadLabel,
    summary: {
      total: parsedTotal ?? ((parsedDone || 0) + items.length + extraMoreCount),
      done: parsedDone ?? 0,
      active: items.length + extraMoreCount,
      overdue: items.filter((it) => it.is_overdue).length,
      due_soon: items.filter((it) => !it.is_overdue && (it.is_under_6h || it.is_due_today || it.is_due_tomorrow)).length,
      progress_percent: 0,
      progress_mode: parsedDone && parsedDone > 0 ? "completion" : "average",
    },
    items,
    total_items: items.length + extraMoreCount,
  };
}

function buildCopySummaryText(report) {
  const s = report.summary;
  const header = `${report.title} — ${s.progress_percent}%`;
  const metaParts = [];
  if (s.done > 0 && s.total > 0) metaParts.push(`${s.done}/${s.total} selesai`);
  if (s.active > 0) metaParts.push(`${s.active} aktif`);
  if (s.overdue > 0) metaParts.push(`${s.overdue} terlambat`);
  if (s.due_soon > 0) metaParts.push(`${s.due_soon} mepet`);
  const rows = report.items.map((it) => {
    const dl = formatShortDeadline(it).text;
    const pics = it.assignee_names?.length ? ` · PIC: ${it.assignee_names.join(", ")}` : "";
    return `• ${it.number_str} — ${it.title} (${it.progress}%) · ${it.board_name}${pics} · ${dl}`;
  });
  return [header, metaParts.join(" · "), "", ...rows].filter((x, idx) => idx === 2 || Boolean(x)).join("\n");
}

const AssistantReportCard = memo(function AssistantReportCard({ m }) {
  const navigate = useNavigate();
  const { tasks = [], users = [], userMap = {} } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "overdue" | "soon"
  const [copied, setCopied] = useState(false);

  // Build quick lookup maps for live hydration
  const { taskById, taskByCode, userByNameLower } = useMemo(() => {
    const byId = new Map();
    const byCode = new Map();
    for (const t of tasks || []) {
      if (!t) continue;
      if (t.id) byId.set(String(t.id), t);
      const code = String(t.number_str || (t.number ? `TSK-${String(t.number).padStart(3, "0")}` : "")).toUpperCase();
      if (code) byCode.set(code, t);
    }
    const byName = new Map();
    for (const u of users || []) {
      if (!u?.name) continue;
      byName.set(String(u.name).trim().toLowerCase(), u);
    }
    return { taskById: byId, taskByCode: byCode, userByNameLower: byName };
  }, [tasks, users]);

  const report = useMemo(() => {
    const base = m.assistant_report?.kind === "task_report"
      ? m.assistant_report
      : parseLegacyAssistantReport(m.text || "");

    const nowMs = Date.now();
    const hydratedItems = (base.items || []).map((rawItem) => {
      const live =
        (rawItem.id && taskById.get(String(rawItem.id))) ||
        (rawItem.number_str && taskByCode.get(String(rawItem.number_str).toUpperCase())) ||
        null;

      const resolvedId = live?.id || rawItem.id || "";
      const isDone = live ? (live.status === "done" || Boolean(live.archived)) : Boolean(rawItem.is_done);
      const progress = live
        ? computeLiveProgress(live)
        : (typeof rawItem.progress === "number" ? rawItem.progress : (isDone ? 100 : 0));

      let isOverdue = Boolean(rawItem.is_overdue);
      let isUnder6h = Boolean(rawItem.is_under_6h);
      let isDueToday = Boolean(rawItem.is_due_today);
      let isDueTomorrow = Boolean(rawItem.is_due_tomorrow);

      if (live) {
        if (isDone) {
          isOverdue = false;
          isUnder6h = false;
          isDueToday = false;
          isDueTomorrow = false;
        } else if (live.deadline) {
          const dlMs = new Date(live.deadline).getTime();
          if (!Number.isNaN(dlMs)) {
            const hrs = (dlMs - nowMs) / 3600000;
            isOverdue = hrs <= 0;
            isUnder6h = hrs > 0 && hrs < 6;
            isDueToday = hrs >= 0 && hrs < 24;
            isDueTomorrow = hrs >= 24 && hrs < 48;
          }
        }
      }

      // Resolve PIC user objects for crisp mini-avatars
      const assigneeIds = Array.isArray(live?.assignee_ids) && live.assignee_ids.length
        ? live.assignee_ids
        : (Array.isArray(rawItem.assignee_ids) && rawItem.assignee_ids.length ? rawItem.assignee_ids : []);

      const picUsers = [];
      const seenPic = new Set();
      for (const uid of assigneeIds) {
        const u = userMap[uid];
        if (u && !seenPic.has(uid)) {
          seenPic.add(uid);
          picUsers.push(u);
        }
      }
      if (picUsers.length === 0 && Array.isArray(rawItem.assignee_names)) {
        for (const nm of rawItem.assignee_names) {
          const matched = userByNameLower.get(String(nm).trim().toLowerCase());
          const key = matched?.user_id || nm;
          if (!seenPic.has(key)) {
            seenPic.add(key);
            picUsers.push(matched || { name: nm });
          }
        }
      }

      return {
        ...rawItem,
        id: resolvedId,
        title: live?.title || rawItem.title,
        status: live?.status || rawItem.status,
        progress,
        is_done: isDone,
        is_overdue: isOverdue,
        is_under_6h: isUnder6h,
        is_due_today: isDueToday,
        is_due_tomorrow: isDueTomorrow,
        pic_users: picUsers,
        assignee_names: picUsers.length > 0 ? picUsers.map((u) => u.name) : (rawItem.assignee_names || []),
      };
    });

    const overdueCount = hydratedItems.filter((it) => it.is_overdue).length;
    const dueSoonCount = hydratedItems.filter((it) => !it.is_overdue && !it.is_done && (it.is_under_6h || it.is_due_today || it.is_due_tomorrow)).length;
    const baseDoneInItems = (base.items || []).filter((it) => it.is_done).length;
    const liveDoneInItems = hydratedItems.filter((it) => it.is_done).length;
    const newlyDoneDelta = Math.max(0, liveDoneInItems - baseDoneInItems);
    const baseDone = typeof base.summary?.done === "number" ? base.summary.done : baseDoneInItems;
    const effectiveDone = baseDone + newlyDoneDelta;
    const activeCount = Math.max(
      hydratedItems.filter((it) => !it.is_done).length,
      (base.total_items || hydratedItems.length) - liveDoneInItems
    );
    const totalCount = Math.max(base.summary?.total || 0, effectiveDone + activeCount);

    let progressPercent = base.summary?.progress_percent ?? 0;
    let progressMode = base.summary?.progress_mode || "average";

    if (effectiveDone > 0 && totalCount > 0) {
      progressPercent = Math.min(100, Math.max(0, Math.round((effectiveDone / totalCount) * 100)));
      progressMode = "completion";
    } else if (hydratedItems.length > 0) {
      const avg = hydratedItems.reduce((acc, it) => acc + (it.progress || 0), 0) / hydratedItems.length;
      progressPercent = Math.min(100, Math.max(0, Math.round(avg)));
      progressMode = "average";
    } else if (totalCount > 0 && activeCount === 0) {
      progressPercent = 100;
      progressMode = "completion";
    }

    return {
      ...base,
      items: hydratedItems,
      summary: {
        total: totalCount,
        done: effectiveDone,
        active: activeCount,
        overdue: overdueCount,
        due_soon: dueSoonCount,
        progress_percent: progressPercent,
        progress_mode: progressMode,
      },
    };
  }, [m.assistant_report, m.text, taskById, taskByCode, userMap, userByNameLower]);

  const filteredItems = useMemo(() => {
    if (filterMode === "overdue") return report.items.filter((it) => it.is_overdue);
    if (filterMode === "soon") return report.items.filter((it) => !it.is_overdue && !it.is_done && (it.is_under_6h || it.is_due_today || it.is_due_tomorrow));
    return report.items;
  }, [report.items, filterMode]);

  const visibleItems = expanded ? filteredItems : filteredItems.slice(0, INITIAL_VISIBLE_COUNT);
  const hiddenCount = Math.max(0, filteredItems.length - visibleItems.length);
  const pct = report.summary.progress_percent;
  const isAllDone = pct >= 100 && report.summary.active === 0;

  const loadToneClass =
    report.load_status === "pressure"
      ? "text-rose-600 dark:text-rose-400"
      : report.load_status === "stabil"
      ? "text-amber-600 dark:text-amber-400"
      : report.load_status === "optimal"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-sub";

  const handleCopy = async () => {
    try {
      const text = buildCopySummaryText(report);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Ringkasan laporan disalin");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Gagal menyalin ringkasan");
    }
  };

  const handleOpenTask = (item) => {
    if (item.id) {
      navigate(`/tasks?task=${encodeURIComponent(item.id)}`);
    } else {
      navigate("/tasks");
    }
  };

  return (
    <div
      className="w-[min(35rem,calc(100vw-4.5rem))] sm:w-[540px] max-w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface text-left text-ink shadow-xs overflow-hidden"
      data-testid={`assistant-report-card-${m.id}`}
    >
      {/* Executive Summary Header */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[14px] font-bold tracking-tight text-ink leading-snug truncate">
              {report.title}
            </h4>
            {(report.subtitle || report.load_label) && (
              <p className="mt-0.5 text-[11.5px] text-sub truncate">
                {report.subtitle}
                {report.subtitle && report.load_label ? " · " : ""}
                {report.load_label && (
                  <span className={`font-medium ${loadToneClass}`}>Load {report.load_label}</span>
                )}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div
              className={`font-mono text-lg font-extrabold leading-none tabular-nums ${
                isAllDone ? "text-emerald-600 dark:text-emerald-400" : "text-ink"
              }`}
              data-testid="assistant-report-progress"
            >
              {pct}%
            </div>
            <p className="mt-0.5 text-[10px] font-medium text-sub whitespace-nowrap">
              {report.summary.progress_mode === "completion" ? "Penyelesaian" : "Rata-rata progres"}
            </p>
          </div>
        </div>

        {/* Clean Overall Progress Track */}
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              isAllDone ? "bg-emerald-500" : "bg-brand"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>

        {/* Unboxed Executive Summary Metadata Strip */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-sub tabular-nums">
          {report.summary.done > 0 && report.summary.total > 0 && (
            <span className="font-medium text-ink">
              {report.summary.done}/{report.summary.total} selesai
            </span>
          )}
          {report.summary.done > 0 && report.summary.total > 0 && <span aria-hidden="true">·</span>}
          <span>{report.summary.active} aktif</span>

          {report.summary.overdue > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setFilterMode((prev) => (prev === "overdue" ? "all" : "overdue"))}
                className={`font-medium transition-colors cursor-pointer ${
                  filterMode === "overdue"
                    ? "text-rose-700 dark:text-rose-300 underline underline-offset-2"
                    : "text-rose-600 dark:text-rose-400 hover:underline underline-offset-2"
                }`}
              >
                {report.summary.overdue} terlambat
              </button>
            </>
          )}

          {report.summary.due_soon > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setFilterMode((prev) => (prev === "soon" ? "all" : "soon"))}
                className={`font-medium transition-colors cursor-pointer ${
                  filterMode === "soon"
                    ? "text-amber-700 dark:text-amber-300 underline underline-offset-2"
                    : "text-amber-600 dark:text-amber-400 hover:underline underline-offset-2"
                }`}
              >
                {report.summary.due_soon} mepet
              </button>
            </>
          )}

          {filterMode !== "all" && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className="text-brand font-medium hover:underline underline-offset-2 cursor-pointer"
              >
                Tampilkan semua
              </button>
            </>
          )}
        </div>
      </div>

      {/* Compact Interactive Task List */}
      <div className="border-t border-slate-100 dark:border-slate-800/80 divide-y divide-slate-100 dark:divide-slate-800/80">
        {visibleItems.length === 0 ? (
          <div className="px-4 py-4 text-xs text-sub">
            {filterMode !== "all"
              ? "Tidak ada tugas pada filter ini."
              : "Semua tugas sudah selesai — tidak ada tugas aktif yang tertunda."}
          </div>
        ) : (
          visibleItems.map((item, idx) => {
            const dl = formatShortDeadline(item);
            const pics = item.pic_users || [];
            const visiblePics = pics.slice(0, 3);
            const extraPics = Math.max(0, pics.length - visiblePics.length);
            const picTooltip = item.assignee_names?.length
              ? `PIC: ${item.assignee_names.join(", ")}`
              : "Belum ada PIC";
            const dlColorClass =
              dl.tone === "overdue"
                ? "text-rose-600 dark:text-rose-400 font-medium"
                : dl.tone === "soon"
                ? "text-amber-600 dark:text-amber-400 font-medium"
                : dl.tone === "done"
                ? "text-emerald-600 dark:text-emerald-400 font-medium"
                : "text-sub";

            return (
              <button
                key={item.id || `${item.number_str}-${idx}`}
                type="button"
                onClick={() => handleOpenTask(item)}
                className="group/row flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface2/75 focus:outline-none focus-visible:bg-surface2"
                data-testid={`assistant-report-item-${item.number_str}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] font-semibold text-sub tabular-nums shrink-0">
                      {item.number_str}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-ink group-hover/row:text-brand transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-sub">
                    <span className="truncate max-w-[120px]">{item.board_name}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`truncate ${dlColorClass}`}>{dl.text}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {/* Stacked Mini PIC Avatars */}
                  {visiblePics.length > 0 && (
                    <div
                      className="hidden sm:flex items-center -space-x-1.5"
                      title={picTooltip}
                    >
                      {visiblePics.map((u, uIdx) => (
                        <div
                          key={u.user_id || `${u.name}-${uIdx}`}
                          className="rounded-full ring-2 ring-surface"
                        >
                          <Avatar user={u} size={20} showStatus={false} ringDeadline={false} />
                        </div>
                      ))}
                      {extraPics > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface2 px-1 text-[9.5px] font-semibold text-sub ring-2 ring-surface tabular-nums">
                          +{extraPics}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Mini Progress Bar + Tabular % */}
                  <div className="flex items-center gap-1.5" title={`Progres ${item.progress}%`}>
                    <div className="h-1.5 w-9 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          item.progress >= 100 ? "bg-emerald-500" : "bg-brand"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, item.progress || 0))}%` }}
                      />
                    </div>
                    <span
                      className={`w-7 text-right font-mono text-[11px] font-semibold tabular-nums ${
                        item.progress >= 100
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-sub"
                      }`}
                    >
                      {item.progress}%
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Minimalist Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80 bg-surface2/35 px-4 py-2">
        <div className="min-w-0">
          {filteredItems.length > INITIAL_VISIBLE_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-ink hover:text-brand transition-colors cursor-pointer"
              data-testid="assistant-report-toggle-more"
            >
              {expanded ? (
                <>
                  <ChevronUp size={13} />
                  <span>Tampilkan lebih sedikit</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>Lihat {hiddenCount} lainnya</span>
                </>
              )}
            </button>
          ) : (
            <span className="text-[11px] text-sub tabular-nums">
              {filteredItems.length} tugas ditampilkan
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-sub hover:bg-surface2 hover:text-ink transition-colors whitespace-nowrap cursor-pointer"
            data-testid="assistant-report-copy"
          >
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            <span>{copied ? "Disalin" : "Salin"}</span>
          </button>
          <button
            type="button"
            onClick={() => navigate("/tasks")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-brand hover:bg-soft-red transition-colors whitespace-nowrap cursor-pointer"
            data-testid="assistant-report-open-tasks"
          >
            <span>Buka Tugas</span>
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default AssistantReportCard;
