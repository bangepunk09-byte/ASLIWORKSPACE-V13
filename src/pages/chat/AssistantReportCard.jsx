import { memo, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, ChevronDown, ChevronUp, Copy, Flag } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { Avatar } from "../../components/common";

const INITIAL_VISIBLE_COUNT = 4;
const TASK_LINE_RE = /^[•\-*]\s*\**\s*(TSK-\d+|T-\d+)\s*\**\s*[—–\-:]\s*(.+)$/i;
const REPORT_HEADER_EMOJI_RE = /^(?:🚧|📊|🏅|📏|🏆|⚖️|🎯|🧭|⚠️|🕳️|👀|📋|🗓️|📆|☀️|📈|🩺|🏷️|🎬|🔥|🔐|🛡️|🔎|👥|⏰|⏳|📌|🗂️|🧩|📰|💬|📅|🔔|📁|🕒|🗒️|🕰️|📒)/u;
const BULLET_OR_NUM_RE = /^(?:[•\-*]|\d+[.)]|[1-9]️⃣|\|)\s+/u;

const STATUS_FALLBACK_LABELS = {
  todo: "To Do",
  backlog: "Backlog",
  in_progress: "In Progress",
  doing: "In Progress",
  in_review: "In Review",
  review: "In Review",
  done: "Selesai",
  completed: "Selesai",
};

function stripMarkdownAndEmoji(str = "") {
  return String(str)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/(^|\s)_([^_]+)_(\s|$)/g, "$1$2$3")
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, "")
    .replace(/:\s*$/, "")
    .trim();
}

function cleanInlineText(str = "") {
  return String(str)
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, "")
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

function extractLiveCheckpointInfo(t) {
  const rawList = Array.isArray(t?.checkpoints) && t.checkpoints.length > 0
    ? t.checkpoints
    : (Array.isArray(t?.checklist) && t.checklist.length > 0 ? t.checklist : []);
  if (!rawList.length) {
    return { checkpoints_done: 0, checkpoints_total: 0, current_checkpoint: null };
  }
  const isDoneCp = (c) => Boolean(c?.done || c?.completed || c?.status === "done");
  const doneCount = rawList.filter(isDoneCp).length;
  const activeCp = rawList.find((c) => !isDoneCp(c));
  const title = activeCp ? String(activeCp.title || activeCp.name || activeCp.label || "").trim() : "";
  return {
    checkpoints_done: doneCount,
    checkpoints_total: rawList.length,
    current_checkpoint: title || null,
  };
}

function formatCheckpointStatus(item) {
  const total = Number(item.checkpoints_total) || 0;
  const done = Number(item.checkpoints_done) || 0;
  if (total > 0) {
    if (done >= total || item.is_done) {
      return {
        label: `CP ${total}/${total} · Selesai`,
        tooltip: `Semua ${total} checkpoint selesai`,
        tone: "done",
      };
    }
    const current = item.current_checkpoint ? ` · ${item.current_checkpoint}` : "";
    return {
      label: `CP ${done}/${total}${current}`,
      tooltip: item.current_checkpoint
        ? `Checkpoint ${done} dari ${total} selesai — tahap saat ini: ${item.current_checkpoint}`
        : `Checkpoint ${done} dari ${total} selesai`,
      tone: done > 0 ? "active" : "idle",
    };
  }
  const stKey = String(item.status || "todo").toLowerCase();
  const stLabel = item.is_done ? "Selesai" : (STATUS_FALLBACK_LABELS[stKey] || item.status || "To Do");
  return {
    label: stLabel,
    tooltip: `Status tugas: ${stLabel}`,
    tone: item.is_done ? "done" : stKey === "in_review" || stKey === "review" ? "active" : "idle",
  };
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

function isLegacyTaskBulletReport(text = "") {
  const lines = String(text).split(/\r?\n/);
  let matchCount = 0;
  for (const line of lines) {
    if (TASK_LINE_RE.test(line.trim())) {
      matchCount += 1;
      if (matchCount >= 2) return true;
    }
  }
  if (matchCount === 1 && /tugas|deadline|telat|overdue|proyek|label|review/i.test(String(text))) {
    return true;
  }
  return false;
}

function isLegacyStructuredSummaryReport(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  // Exclude greetings, help menus, format warnings, creative copywriting drafts, and simple confirmations
  if (/^(?:⚠️\s*Format|Halo!\s*Saya|✅\s*(?:Pengingat|Tugas|Checkpoint|Subtugas|Prioritas|Status|PIC|Deadline)|✨\s*\*\*Kalimat|✍️\s*\*\*3 Variasi|📧\s*\*\*Draf Email|💬\s*\*\*Draf Pesan|🎨\s*\*\*Creative Brief|☑️\s*\*\*Template Checklist|🌐\s*\*\*Mode Penerjemah)/i.test(trimmed)) {
    return false;
  }
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const firstLine = lines[0];
  const hasReportHeader = REPORT_HEADER_EMOJI_RE.test(firstLine) && (/\*\*/.test(firstLine) || lines.length >= 3);
  if (!hasReportHeader) return false;
  const bulletLines = lines.slice(1).filter((l) => BULLET_OR_NUM_RE.test(l));
  if (bulletLines.length >= 2) return true;
  // Single-item balanced / zero-state reports (e.g. "⚖️ Beban Tim Sudah Seimbang!")
  if (/seimbang|tidak ada tugas|belum ada|semua permintaan akses|0 pending/i.test(trimmed) && lines.length >= 2) {
    return true;
  }
  return false;
}

/**
 * Fast detector used by MessageItem to decide whether an Asli Assistant
 * message should render in the unified Executive Summary + Compact List card.
 */
export function detectAssistantReport(m) {
  if (!m || m.deleted) return false;
  if (
    m.type === "assistant_report" ||
    m.assistant_report?.kind === "task_report" ||
    m.assistant_report?.kind === "summary_report"
  ) {
    return true;
  }
  if (m.sender_id !== "user_circle_assistant" || !m.text) return false;
  return isLegacyTaskBulletReport(m.text) || isLegacyStructuredSummaryReport(m.text);
}

/**
 * Parses legacy plain-text task bullet reports into `task_report`.
 */
function parseLegacyTaskReport(text = "") {
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
        checkpoints_done: 0,
        checkpoints_total: 0,
        current_checkpoint: null,
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

    const profileMatch = line.match(/Profil\s*&\s*Beban Kerja:\s*\**([^(*\n]+)\**\s*\(([^)]+)\)/i);
    if (profileMatch) {
      if (!subtitle) subtitle = stripMarkdownAndEmoji(profileMatch[2]);
      continue;
    }

    const loadMatch = line.match(/Status Load:\s*\**([^—–\n*]+)\**/i);
    if (loadMatch) {
      const lbl = loadMatch[1].trim();
      loadLabel = lbl;
      if (/pressure/i.test(lbl)) loadStatus = "pressure";
      else if (/stabil/i.test(lbl)) loadStatus = "stabil";
      else if (/optimal/i.test(lbl)) loadStatus = "optimal";
      continue;
    }

    const doneMatch = line.match(/Selesai:\s*\**(\d+)\**/i);
    if (doneMatch) parsedDone = Number(doneMatch[1]);
    const totalMatch = line.match(/(\d+)\s+total/i);
    if (totalMatch) parsedTotal = Number(totalMatch[1]);

    if (items.length === 0 && !line.startsWith("•") && !line.startsWith("-")) {
      const cleaned = stripMarkdownAndEmoji(line);
      if (cleaned && cleaned.length <= 96) title = cleaned;
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

/**
 * Parses legacy plain-text summary reports (like `/blockers`, `/morning-brief`,
 * `/kpi`, `/sla`, `/leaderboard`, `/rebalance`, etc.) into `summary_report`
 * so existing chat history immediately adopts the same minimalist card design.
 */
function parseLegacySummaryReport(text = "") {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = stripMarkdownAndEmoji(lines[0] || "Laporan Asli Assistant") || "Laporan Asli Assistant";
  let subtitle = "";
  let footerNote = "";
  const rows = [];
  const metrics = [];
  let explicitPct = null;
  let allZeroRiskCounters = true;
  let riskCounterSeen = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.startsWith("|") && raw.endsWith("|") && !raw.replace(/\|/g, "").replace(/:/g, "").replace(/-/g, "").trim()) continue;

    // Italic timestamp subtitle line right under title
    if (i === 1 && /^_.*_$/.test(raw)) {
      subtitle = raw.replace(/^_|_$/g, "").trim();
      continue;
    }

    // Trailing status / tip line
    if (/^(?:✅|🟢|💡)/u.test(raw) && !BULLET_OR_NUM_RE.test(raw)) {
      footerNote = cleanInlineText(raw);
      continue;
    }

    // Markdown table row (e.g. /export-summary)
    if (raw.startsWith("|") && raw.endsWith("|")) {
      const cells = raw.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !/^Divisi$/i.test(cells[0])) {
        rows.push({
          id: `tbl_${i}`,
          title: cells[0],
          subtitle: cells.slice(1, -1).join(" · "),
          status_label: cells[cells.length - 1],
          status_tone: /pressure/i.test(cells[cells.length - 1])
            ? "danger"
            : /stabil/i.test(cells[cells.length - 1])
            ? "warn"
            : /optimal/i.test(cells[cells.length - 1])
            ? "good"
            : "default",
        });
      }
      continue;
    }

    // Bullet or numbered item
    if (BULLET_OR_NUM_RE.test(raw)) {
      const numPrefixMatch = raw.match(/^(\d+)[.)]\s+/);
      const codePrefix = numPrefixMatch ? `#${numPrefixMatch[1]}` : undefined;
      const body = raw.replace(BULLET_OR_NUM_RE, "").trim();
      const cleanedBody = cleanInlineText(body);

      // Pattern A: "Label: Value" (e.g., "Kendala/Issue Terbuka: 0", "Ketepatan Waktu: 84% (...)")
      const kvMatch = cleanedBody.match(/^([^:—–]{2,56}):\s*(.+)$/);
      if (kvMatch) {
        const k = kvMatch[1].trim();
        const v = kvMatch[2].trim();
        const pctMatch = v.match(/(\d{1,3})%/);
        const exactNumMatch = v.match(/^(\d+)$/);

        if (pctMatch && explicitPct === null && /ketepatan|sla|penyelesaian|progress|progres/i.test(k)) {
          explicitPct = Math.min(100, Math.max(0, Number(pctMatch[1])));
        }

        if (exactNumMatch) {
          const numVal = Number(exactNumMatch[1]);
          const isRiskMetric = /kendala|issue|telat|overdue|tanpa pic|review|pending/i.test(k);
          if (isRiskMetric) {
            riskCounterSeen += 1;
            if (numVal > 0) allZeroRiskCounters = false;
          }
          rows.push({
            id: `kv_${i}`,
            code: codePrefix,
            title: k,
            right_value: String(numVal),
            status_label: isRiskMetric ? (numVal === 0 ? "Aman" : "Perlu aksi") : undefined,
            status_tone: isRiskMetric ? (numVal === 0 ? "good" : "danger") : "default",
          });
          metrics.push({
            label: `${numVal} ${k.replace(/^Tugas\s+/i, "").toLowerCase()}`,
            tone: isRiskMetric ? (numVal === 0 ? "good" : "danger") : "default",
          });
          continue;
        }

        rows.push({
          id: `kv_${i}`,
          code: codePrefix,
          title: k,
          subtitle: v,
          progress: pctMatch ? Math.min(100, Math.max(0, Number(pctMatch[1]))) : null,
        });
        continue;
      }

      // Pattern B: "Title — Details" or "Title - Details"
      const dashMatch = cleanedBody.match(/^([^—–]{2,70}?)\s+[—–]\s+(.+)$/);
      if (dashMatch) {
        const pctMatch = dashMatch[2].match(/(\d{1,3})%/);
        const loadTone = /under pressure|kritis|telat/i.test(dashMatch[2])
          ? "danger"
          : /stabil|waspada/i.test(dashMatch[2])
          ? "warn"
          : /optimal|sehat|aman/i.test(dashMatch[2])
          ? "good"
          : "default";
        rows.push({
          id: `row_${i}`,
          code: codePrefix,
          title: dashMatch[1].trim(),
          subtitle: dashMatch[2].trim(),
          progress: pctMatch ? Math.min(100, Math.max(0, Number(pctMatch[1]))) : null,
          status_tone: loadTone,
        });
        continue;
      }

      rows.push({
        id: `row_${i}`,
        code: codePrefix,
        title: cleanedBody,
      });
    } else if (rows.length === 0 && !subtitle) {
      subtitle = cleanInlineText(raw);
    }
  }

  let progressPercent = 100;
  let progressLabel = "Status";
  let progressTone = "brand";

  if (explicitPct !== null) {
    progressPercent = explicitPct;
    progressLabel = "Progres";
    progressTone = explicitPct >= 80 ? "good" : "brand";
  } else if (riskCounterSeen > 0) {
    progressPercent = allZeroRiskCounters ? 100 : Math.max(30, 100 - rows.filter((r) => r.status_tone === "danger").length * 20);
    progressLabel = "Skor kelancaran";
    progressTone = allZeroRiskCounters ? "good" : "warn";
  } else {
    const withPct = rows.filter((r) => typeof r.progress === "number");
    if (withPct.length > 0) {
      progressPercent = Math.round(withPct.reduce((a, r) => a + r.progress, 0) / withPct.length);
      progressLabel = "Rata-rata";
      progressTone = progressPercent >= 80 ? "good" : "brand";
    } else if (/seimbang|aman|0 pending|tidak ada/i.test(text)) {
      progressPercent = 100;
      progressLabel = "Terkendali";
      progressTone = "good";
    } else {
      progressPercent = rows.length > 0 ? 100 : 0;
      progressLabel = "Ringkasan";
    }
  }

  const lowerAll = `${title} ${text}`.toLowerCase();
  const ctaHref = /meeting|jadwal|slot|pengingat|reminder/.test(lowerAll)
    ? "/schedule"
    : /employee|anggota|pic|kpi|leaderboard|beban|load/.test(lowerAll)
    ? "/people"
    : /proyek|project/.test(lowerAll)
    ? "/projects"
    : /beranda|trending|polling/.test(lowerAll)
    ? "/beranda"
    : /drive/.test(lowerAll)
    ? "/drive"
    : "/tasks";
  const ctaLabel =
    ctaHref === "/schedule"
      ? "Buka Jadwal"
      : ctaHref === "/people"
      ? "Buka Employee"
      : ctaHref === "/projects"
      ? "Buka Proyek"
      : ctaHref === "/beranda"
      ? "Buka Beranda"
      : ctaHref === "/drive"
      ? "Buka Drive"
      : "Buka Tugas";

  return {
    kind: "summary_report",
    title,
    subtitle: subtitle || undefined,
    progress_percent: progressPercent,
    progress_label: progressLabel,
    progress_tone: progressTone,
    metrics: metrics.slice(0, 4),
    rows,
    empty_note: rows.length === 0 ? (footerNote || "Tidak ada item yang perlu ditindaklanjuti.") : undefined,
    footer_note: rows.length > 0 ? footerNote || undefined : undefined,
    cta_label: ctaLabel,
    cta_href: ctaHref,
  };
}

function buildCopyTextForTaskReport(report) {
  const s = report.summary;
  const header = `${report.title} — ${s.progress_percent}%`;
  const metaParts = [];
  if (s.done > 0 && s.total > 0) metaParts.push(`${s.done}/${s.total} selesai`);
  if (s.active > 0) metaParts.push(`${s.active} aktif`);
  if (s.overdue > 0) metaParts.push(`${s.overdue} terlambat`);
  if (s.due_soon > 0) metaParts.push(`${s.due_soon} mepet`);
  const rows = report.items.map((it) => {
    const dl = formatShortDeadline(it).text;
    const cp = formatCheckpointStatus(it).label;
    const pics = it.assignee_names?.length ? ` · PIC: ${it.assignee_names.join(", ")}` : "";
    return `• ${it.number_str} — ${it.title} (${it.progress}%) · ${it.board_name}${pics} · ${dl} · ${cp}`;
  });
  return [header, metaParts.join(" · "), "", ...rows].filter((x, idx) => idx === 2 || Boolean(x)).join("\n");
}

function buildCopyTextForSummaryReport(report) {
  const header = `${report.title} — ${report.progress_percent}% (${report.progress_label})`;
  const meta = (report.metrics || []).map((x) => x.label).join(" · ");
  const rows = (report.rows || []).map((r) => {
    const prefix = r.code ? `${r.code} · ` : "";
    const right = typeof r.progress === "number"
      ? ` (${r.progress}%)`
      : r.right_value
      ? `: ${r.right_value}`
      : "";
    const sub = r.subtitle ? ` — ${r.subtitle}` : "";
    return `• ${prefix}${r.title}${right}${sub}`;
  });
  return [header, meta, "", ...rows, report.footer_note || ""].filter((x, idx) => idx === 2 || Boolean(x)).join("\n");
}

function toneTextClass(tone) {
  if (tone === "danger") return "text-rose-600 dark:text-rose-400 font-semibold";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400 font-semibold";
  if (tone === "good") return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (tone === "strong") return "text-ink font-semibold";
  return "text-sub";
}

function progressBarColorClass(tone, pct) {
  if (tone === "good" || pct >= 100) return "bg-emerald-500";
  if (tone === "danger") return "bg-rose-500";
  if (tone === "warn") return "bg-amber-500";
  return "bg-brand";
}

function progressNumColorClass(tone, pct) {
  if (tone === "good" || pct >= 100) return "text-emerald-600 dark:text-emerald-400";
  if (tone === "danger") return "text-rose-600 dark:text-rose-400";
  return "text-ink";
}

const SummaryReportCard = memo(function SummaryReportCard({ m, report, userMap, userByNameLower }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = Array.isArray(report.rows) ? report.rows : [];
  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_VISIBLE_COUNT);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  const pct = Math.min(100, Math.max(0, Math.round(Number(report.progress_percent) || 0)));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyTextForSummaryReport(report));
      setCopied(true);
      toast.success("Ringkasan laporan disalin");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Gagal menyalin ringkasan");
    }
  };

  return (
    <div
      className="font-sans w-[min(37rem,calc(100vw-4.5rem))] sm:w-[580px] max-w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface text-left text-ink shadow-xs overflow-hidden"
      data-testid={`assistant-report-card-${m.id}`}
    >
      {/* Executive Summary Header */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[14.5px] font-bold tracking-tight text-ink leading-snug truncate">
              {report.title}
            </h4>
            {report.subtitle && (
              <p className="mt-0.5 text-[11.5px] text-sub truncate">{report.subtitle}</p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div
              className={`text-[19px] font-extrabold tracking-tight leading-none tabular-nums ${progressNumColorClass(report.progress_tone, pct)}`}
              data-testid="assistant-report-progress"
            >
              {pct}%
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-sub whitespace-nowrap">
              {report.progress_label || "Ringkasan"}
            </p>
          </div>
        </div>

        {/* Clean Overall Progress Track */}
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${progressBarColorClass(report.progress_tone, pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Unboxed Executive Summary Metadata Strip */}
        {Array.isArray(report.metrics) && report.metrics.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-sub tabular-nums">
            {report.metrics.map((met, idx) => (
              <span key={`${met.label}-${idx}`} className="inline-flex items-center gap-2">
                {idx > 0 && <span aria-hidden="true" className="text-sub/70">·</span>}
                <span className={toneTextClass(met.tone)}>{met.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Compact List Rows */}
      <div className="border-t border-slate-100 dark:border-slate-800/80 divide-y divide-slate-100 dark:divide-slate-800/80">
        {visibleRows.length === 0 ? (
          <div className="px-4 py-3.5 text-xs text-sub">
            {report.empty_note || "Tidak ada data untuk ditampilkan."}
          </div>
        ) : (
          visibleRows.map((row, idx) => {
            const picUsers = [];
            const seen = new Set();
            for (const uid of row.user_ids || []) {
              const u = userMap[uid];
              if (u && !seen.has(uid)) {
                seen.add(uid);
                picUsers.push(u);
              }
            }
            if (picUsers.length === 0 && Array.isArray(row.user_names)) {
              for (const nm of row.user_names) {
                const matched = userByNameLower.get(String(nm).trim().toLowerCase());
                const key = matched?.user_id || nm;
                if (!seen.has(key)) {
                  seen.add(key);
                  picUsers.push(matched || { name: nm });
                }
              }
            }
            const visiblePics = picUsers.slice(0, 3);
            const hasProg = typeof row.progress === "number" && Number.isFinite(row.progress);
            const rowPct = hasProg ? Math.min(100, Math.max(0, Math.round(row.progress))) : null;
            const clickable = Boolean(row.href);
            const RowTag = clickable ? "button" : "div";

            return (
              <RowTag
                key={row.id || `sr-${idx}`}
                {...(clickable
                  ? {
                      type: "button",
                      onClick: () => navigate(row.href),
                    }
                  : {})}
                className={`group/row flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                  clickable ? "hover:bg-surface2/75 cursor-pointer" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.code && (
                      <span className="text-[11px] font-bold tracking-tight text-sub tabular-nums shrink-0">
                        {row.code}
                      </span>
                    )}
                    <span
                      className={`truncate text-[13px] font-semibold text-ink ${
                        clickable ? "group-hover/row:text-brand transition-colors" : ""
                      }`}
                    >
                      {row.title}
                    </span>
                  </div>
                  {(row.subtitle || (row.status_label && (hasProg || row.right_value))) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-sub tabular-nums">
                      {row.subtitle && <span className="truncate max-w-[340px]">{row.subtitle}</span>}
                      {row.subtitle && row.status_label && (hasProg || row.right_value) && (
                        <span aria-hidden="true">·</span>
                      )}
                      {row.status_label && (hasProg || row.right_value) && (
                        <span className={toneTextClass(row.status_tone)}>{row.status_label}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {visiblePics.length > 0 && (
                    <div className="hidden sm:flex items-center -space-x-1.5">
                      {visiblePics.map((u, uIdx) => (
                        <div key={u.user_id || `${u.name}-${uIdx}`} className="rounded-full ring-2 ring-surface">
                          <Avatar user={u} size={20} showStatus={false} ringDeadline={false} />
                        </div>
                      ))}
                    </div>
                  )}

                  {hasProg ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-9 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full ${rowPct >= 100 ? "bg-emerald-500" : "bg-brand"}`}
                          style={{ width: `${rowPct}%` }}
                        />
                      </div>
                      <span
                        className={`w-8 text-right text-[11.5px] font-semibold tabular-nums ${
                          rowPct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-sub"
                        }`}
                      >
                        {rowPct}%
                      </span>
                    </div>
                  ) : row.right_value ? (
                    <span className="text-[12.5px] font-bold text-ink tabular-nums whitespace-nowrap">
                      {row.right_value}
                    </span>
                  ) : row.status_label ? (
                    <span className={`text-[11.5px] whitespace-nowrap ${toneTextClass(row.status_tone)}`}>
                      {row.status_label}
                    </span>
                  ) : null}
                </div>
              </RowTag>
            );
          })
        )}
      </div>

      {/* Quiet Footer Note (when present) */}
      {report.footer_note && (
        <div className="border-t border-slate-100 dark:border-slate-800/80 px-4 py-2 text-[11px] text-sub">
          {report.footer_note}
        </div>
      )}

      {/* Minimalist Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80 bg-surface2/35 px-4 py-2">
        <div className="min-w-0">
          {rows.length > INITIAL_VISIBLE_COUNT ? (
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
              {rows.length} item ditampilkan
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
          {report.cta_href && (
            <button
              type="button"
              onClick={() => navigate(report.cta_href)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-brand hover:bg-soft-red transition-colors whitespace-nowrap cursor-pointer"
              data-testid="assistant-report-cta"
            >
              <span>{report.cta_label || "Buka Tugas"}</span>
              <ArrowUpRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const AssistantReportCard = memo(function AssistantReportCard({ m }) {
  const navigate = useNavigate();
  const { tasks = [], users = [], userMap = {} } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "overdue" | "soon"
  const [copied, setCopied] = useState(false);

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

  const parsedSummaryReport = useMemo(() => {
    if (m.assistant_report?.kind === "summary_report") return m.assistant_report;
    if (m.assistant_report?.kind === "task_report") return null;
    if (!isLegacyTaskBulletReport(m.text || "") && isLegacyStructuredSummaryReport(m.text || "")) {
      return parseLegacySummaryReport(m.text || "");
    }
    return null;
  }, [m.assistant_report, m.text]);

  const report = useMemo(() => {
    if (parsedSummaryReport) return null;
    const base = m.assistant_report?.kind === "task_report"
      ? m.assistant_report
      : parseLegacyTaskReport(m.text || "");

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

      const liveCp = live
        ? extractLiveCheckpointInfo(live)
        : {
            checkpoints_done: Number(rawItem.checkpoints_done) || 0,
            checkpoints_total: Number(rawItem.checkpoints_total) || 0,
            current_checkpoint: rawItem.current_checkpoint || null,
          };

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
        checkpoints_done: liveCp.checkpoints_done,
        checkpoints_total: liveCp.checkpoints_total,
        current_checkpoint: liveCp.current_checkpoint,
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
    } else if (activeCount === 0) {
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
  }, [parsedSummaryReport, m.assistant_report, m.text, taskById, taskByCode, userMap, userByNameLower]);

  if (parsedSummaryReport) {
    return (
      <SummaryReportCard
        m={m}
        report={parsedSummaryReport}
        userMap={userMap}
        userByNameLower={userByNameLower}
      />
    );
  }

  const filteredItems = (() => {
    if (filterMode === "overdue") return report.items.filter((it) => it.is_overdue);
    if (filterMode === "soon") return report.items.filter((it) => !it.is_overdue && !it.is_done && (it.is_under_6h || it.is_due_today || it.is_due_tomorrow));
    return report.items;
  })();

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
      const text = buildCopyTextForTaskReport(report);
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
      className="font-sans w-[min(37rem,calc(100vw-4.5rem))] sm:w-[580px] max-w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface text-left text-ink shadow-xs overflow-hidden"
      data-testid={`assistant-report-card-${m.id}`}
    >
      {/* Executive Summary Header */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[14.5px] font-bold tracking-tight text-ink leading-snug truncate">
              {report.title}
            </h4>
            {(report.subtitle || report.load_label) && (
              <p className="mt-0.5 text-[11.5px] text-sub truncate">
                {report.subtitle}
                {report.subtitle && report.load_label ? " · " : ""}
                {report.load_label && (
                  <span className={`font-semibold ${loadToneClass}`}>Load {report.load_label}</span>
                )}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div
              className={`text-[19px] font-extrabold tracking-tight leading-none tabular-nums ${
                isAllDone ? "text-emerald-600 dark:text-emerald-400" : "text-ink"
              }`}
              data-testid="assistant-report-progress"
            >
              {pct}%
            </div>
            <p className="mt-1 text-[10.5px] font-medium text-sub whitespace-nowrap">
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
            <span className="font-semibold text-ink">
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
                className={`font-semibold transition-colors cursor-pointer ${
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
                className={`font-semibold transition-colors cursor-pointer ${
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
                className="text-brand font-semibold hover:underline underline-offset-2 cursor-pointer"
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
            const cp = formatCheckpointStatus(item);
            const pics = item.pic_users || [];
            const visiblePics = pics.slice(0, 3);
            const extraPics = Math.max(0, pics.length - visiblePics.length);
            const picTooltip = item.assignee_names?.length
              ? `PIC: ${item.assignee_names.join(", ")}`
              : "Belum ada PIC";
            const dlColorClass =
              dl.tone === "overdue"
                ? "text-rose-600 dark:text-rose-400 font-semibold"
                : dl.tone === "soon"
                ? "text-amber-600 dark:text-amber-400 font-semibold"
                : dl.tone === "done"
                ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                : "text-sub";
            const cpColorClass =
              cp.tone === "done"
                ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                : cp.tone === "active"
                ? "text-ink/80 font-medium"
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
                    <span className="text-[11px] font-bold tracking-tight text-sub tabular-nums shrink-0">
                      {item.number_str}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-ink group-hover/row:text-brand transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-sub tabular-nums">
                    <span className="truncate max-w-[110px]">{item.board_name}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`truncate ${dlColorClass}`}>{dl.text}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`inline-flex items-center gap-1 truncate max-w-[190px] ${cpColorClass}`}
                      title={cp.tooltip}
                      data-testid={`assistant-report-cp-${item.number_str}`}
                    >
                      <Flag size={10} className="shrink-0 opacity-75" />
                      <span className="truncate">{cp.label}</span>
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
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
                      className={`w-8 text-right text-[11.5px] font-semibold tabular-nums ${
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

      {/* Optional Footer Note */}
      {report.footer_note && (
        <div className="border-t border-slate-100 dark:border-slate-800/80 px-4 py-2 text-[11px] text-sub">
          {report.footer_note}
        </div>
      )}

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
