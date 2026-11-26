import { memo, useMemo, useState, useEffect, useCallback } from "react";
import { addDays, differenceInCalendarDays, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitBranch,
  ChevronsUpDown,
  ArrowRight,
  CircleDot,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { Avatar, AvatarStack } from "../../components/common";
import { api, errMsg } from "../../lib/api";
import { playSound } from "../../lib/sound";
import { listEvents } from "../../lib/calendar";
import { hasAccessToken } from "../../lib/auth";
import { toDayDate, fmtShortDay, analyzeTaskFlow } from "./timelineFlow";

const colorOf = (t, labelMap) => t.card_color || labelMap[t.label_ids?.[0]]?.color || "var(--c-accent2)";



function segmentClass(status, severity) {
  if (status === "done") return "bg-emerald-500 text-white";
  if (status === "bottleneck") {
    return severity === "critical"
      ? "bg-rose-500 text-white"
      : "bg-amber-500 text-white";
  }
  if (status === "active") return "bg-sky-500 text-white";
  return "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300";
}

export const Timeline = memo(function Timeline({ tasks, onOpen, onPatchTask, reload, initialFilterMode = "all" }) {
  const { labelMap, userMap, me, t: tr } = useApp();
  const [start, setStart] = useState(() => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), -7));
  const [filterMode, setFilterMode] = useState(initialFilterMode === "bottleneck" ? "bottleneck" : "all"); // "all" | "bottleneck"
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  useEffect(() => {
    if (initialFilterMode === "bottleneck") {
      setFilterMode("bottleneck");
    }
  }, [initialFilterMode]);

  const days = useMemo(() => Array.from({ length: 35 }, (_, i) => addDays(start, i)), [start]);
  const W = 40;
  const todayDay = toDayDate(new Date());
  const todayOffset = differenceInCalendarDays(todayDay, start);

  const rawRows = useMemo(
    () =>
      (Array.isArray(tasks) ? tasks : []).filter(
        (t) => t.deadline || t.start_date || t.created_at || (Array.isArray(t.checkpoints) && t.checkpoints.length > 0)
      ),
    [tasks]
  );

  const analyzedRows = useMemo(
    () => rawRows.map((t) => analyzeTaskFlow(t, userMap, todayDay)),
    [rawRows, userMap, todayDay]
  );

  const bottleneckRows = useMemo(
    () => analyzedRows.filter((r) => r.hasBottleneck),
    [analyzedRows]
  );

  // Auto-expand first bottleneck task when user hasn't manually collapsed it so bottleneck flow is immediately discoverable
  const visibleRows = useMemo(
    () => (filterMode === "bottleneck" ? bottleneckRows : analyzedRows),
    [filterMode, bottleneckRows, analyzedRows]
  );

  const hasCheckpointTasks = useMemo(
    () => visibleRows.some((r) => r.stages.length > 0),
    [visibleRows]
  );

  const toggleExpand = useCallback((taskId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedIds(new Set());
      setAllExpanded(false);
    } else {
      const allWithCps = new Set(analyzedRows.filter((r) => r.stages.length > 0).map((r) => r.task.id));
      setExpandedIds(allWithCps);
      setAllExpanded(true);
    }
  }, [allExpanded, analyzedRows]);

  const handleToggleStageDone = useCallback(
    async (task, stage, e) => {
      e.stopPropagation();
      const rawCps = Array.isArray(task.checkpoints) ? task.checkpoints : [];
      const nowIso = new Date().toISOString();
      const nextDone = !stage.done;

      let nextCps = rawCps.map((c, idx) => {
        const cid = typeof c === "string" ? `cp_${idx}` : (c.id || `cp_${idx}`);
        const obj = typeof c === "string" ? { id: cid, title: c, assignee_id: null, deadline: "", done: false } : { ...c };
        if (cid === stage.id) {
          return {
            ...obj,
            done: nextDone,
            done_at: nextDone ? nowIso : null,
            done_by: nextDone ? me?.user_id : null,
          };
        }
        return obj;
      });

      const nextActiveIdx = nextCps.findIndex((c) => !c.done);
      if (nextActiveIdx !== -1 && !nextCps[nextActiveIdx].started_at) {
        nextCps[nextActiveIdx] = { ...nextCps[nextActiveIdx], started_at: nowIso };
      }

      const doneTotal = nextCps.filter((c) => c.done).length;
      const nextProgress = nextCps.length > 0 ? Math.round((doneTotal / nextCps.length) * 100) : task.progress || 0;

      if (nextDone) playSound("task_done");
      else playSound("click");

      onPatchTask?.(task.id, { checkpoints: nextCps, progress: nextProgress });

      try {
        await api.patch(`/tasks/${task.id}`, { checkpoints: nextCps, progress: nextProgress });
        if (nextDone && nextActiveIdx !== -1 && nextCps[nextActiveIdx]?.assignee_id) {
          const nextPic = userMap[nextCps[nextActiveIdx].assignee_id]?.name || "PIC";
          toast.success(`Tahap "${stage.title}" selesai · lanjut ke "${nextCps[nextActiveIdx].title}" (PIC: ${nextPic})`);
        } else {
          toast.success(nextDone ? `Tahap "${stage.title}" ditandai selesai` : `Tahap "${stage.title}" dibuka kembali`);
        }
        reload?.();
      } catch (err) {
        toast.error(errMsg(err, "Gagal memperbarui tahap checkpoint"));
        reload?.();
      }
    },
    [me?.user_id, onPatchTask, reload, userMap]
  );

  const focusTaskFlow = useCallback((row) => {
    if (row.stages.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(row.task.id);
        return next;
      });
    }
    const targetDay = row.primaryBottleneck?.startDay || row.flowStart;
    if (targetDay) {
      const diff = differenceInCalendarDays(targetDay, start);
      if (diff < 0 || diff > 28) {
        setStart(addDays(targetDay, -5));
      }
    }
  }, [start]);

  return (
    <div className="card w-full min-w-0 overflow-hidden animate-subpage-enter" data-testid="task-timeline">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b p-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <p className="text-xs sm:text-sm font-bold text-ink truncate">
            {format(start, "d MMM", { locale: localeId })} – {format(days[34], "d MMM yyyy", { locale: localeId })}
          </p>
          <div className="inline-flex items-center gap-1 rounded-full border bg-surface2/80 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`rounded-full px-2.5 py-1 transition-colors cursor-pointer ${
                filterMode === "all" ? "bg-surface text-ink shadow-xs font-bold" : "text-sub hover:text-ink"
              }`}
              data-testid="timeline-filter-all"
            >
              {tr("timeline_filter_all", "Semua")} ({analyzedRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("bottleneck")}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors cursor-pointer ${
                filterMode === "bottleneck"
                  ? "bg-rose-500 text-white shadow-xs font-bold"
                  : bottleneckRows.length > 0
                  ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  : "text-sub hover:text-ink"
              }`}
              data-testid="timeline-filter-bottleneck"
            >
              <AlertTriangle size={11} />
              {tr("timeline_filter_bottleneck", "Bottleneck")} ({bottleneckRows.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {hasCheckpointTasks && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="btn-ghost inline-flex h-8 items-center gap-1.5 border px-2.5 text-[11px] font-semibold text-ink cursor-pointer"
              data-testid="timeline-expand-all"
            >
              <ChevronsUpDown size={13} className="text-brand" />
              {allExpanded ? tr("timeline_close_flow", "Tutup Flow") : tr("timeline_open_all_flow", "Buka Semua Flow")}
            </button>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStart(addDays(start, -14))}
              className="btn-ghost flex h-8 w-8 items-center justify-center cursor-pointer"
              aria-label={tr("timeline_prev", "Sebelumnya")}
              data-testid="timeline-prev"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setStart(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), -7))}
              className="btn-ghost h-8 px-2.5 text-xs font-semibold cursor-pointer"
            >
              {tr("timeline_today", "Hari Ini")}
            </button>
            <button
              type="button"
              onClick={() => setStart(addDays(start, 14))}
              className="btn-ghost flex h-8 w-8 items-center justify-center cursor-pointer"
              aria-label={tr("timeline_next", "Berikutnya")}
              data-testid="timeline-next"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottleneck Radar Strip + Flow Legend */}
      <div className="flex flex-col gap-2 border-b bg-surface2/40 px-3 py-2.5">
        {bottleneckRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="timeline-bottleneck-radar">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 mr-1">
              <AlertTriangle size={12} />
              {tr("timeline_bottleneck_detect", "Deteksi Bottleneck:")}
            </span>
            {bottleneckRows.slice(0, 5).map((row) => {
              const bn = row.primaryBottleneck;
              const isCrit = bn.severity === "critical";
              return (
                <button
                  key={row.task.id}
                  type="button"
                  onClick={() => focusTaskFlow(row)}
                  title={`${row.task.title} — ${bn.title} (${bn.picName}): ${bn.detailSummary}${bn.impactText ? `. ${bn.impactText}` : ""}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    isCrit
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}
                >
                  <span className="max-w-[110px] truncate font-bold">{row.task.title}</span>
                  <ArrowRight size={10} className="shrink-0 opacity-60" />
                  <span className="max-w-[100px] truncate">{bn.title}</span>
                  <span className="opacity-75">· {bn.picShort}</span>
                  <span className="rounded-full bg-white/80 dark:bg-black/25 px-1.5 py-0.2 text-[10px] font-bold">
                    {bn.shortReason}
                  </span>
                </button>
              );
            })}
            {bottleneckRows.length > 5 && (
              <button
                type="button"
                onClick={() => setFilterMode("bottleneck")}
                className="text-[11px] font-bold text-rose-600 hover:underline px-1 cursor-pointer"
              >
                +{bottleneckRows.length - 5} {tr("timeline_more_suffix", "lainnya")}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-sub">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              {tr("timeline_legend_done", "Selesai")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              {tr("timeline_legend_active", "Sedang Dikerjakan")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
              {tr("timeline_legend_waiting", "Menunggu Estafet")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              {tr("timeline_legend_bottleneck", "Bottleneck (Telat / Kendala)")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              {tr("timeline_legend_stalled", "Mandek > 2 Hari")}
            </span>
          </div>
          <span className="text-[10.5px] text-sub">
            {tr("timeline_legend_hint", "Klik panah atau bar tugas untuk lihat detail estafet tiap checkpoint & PIC")}
          </span>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="overflow-x-auto scroll-thin">
        <div style={{ minWidth: 280 + W * days.length }}>
          {/* Date Header */}
          <div className="flex border-b text-[10px] text-sub bg-surface">
            <div className="sticky left-0 z-20 w-[210px] sm:w-[290px] shrink-0 border-r bg-surface px-3 py-2 font-bold text-ink flex items-center justify-between">
              <span>{tr("timeline_col_task_flow", "Tugas & Flow PIC")}</span>
              <span className="text-[10px] font-medium text-sub">{tr("timeline_col_stage", "Tahap")}</span>
            </div>
            <div className="relative flex" style={{ width: W * days.length }}>
              {days.map((d, i) => {
                const today = isToday(d);
                return (
                  <div
                    key={`${format(d, "yyyy-MM-dd")}-${i}`}
                    style={{ width: W }}
                    className={`shrink-0 border-r border-border/40 py-1.5 text-center ${
                      today ? "bg-brand/10 font-bold text-brand" : ""
                    }`}
                  >
                    <div className="leading-tight">{format(d, "d")}</div>
                    <div className="text-[9px] leading-tight opacity-80">{format(d, "EEEEE", { locale: localeId })}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Task Rows */}
          {visibleRows.map((row) => {
            const { task: t, stages, flowStart, flowEnd, activeStage, doneCount, primaryBottleneck, hasBottleneck, isTaskDone } = row;
            const hasCps = stages.length > 0;
            const isExpanded = hasCps && (allExpanded || expandedIds.has(t.id));
            const flowOff = differenceInCalendarDays(flowStart, start);
            const flowLen = Math.max(1, differenceInCalendarDays(flowEnd, flowStart) + 1);
            const flowVisible = flowOff + flowLen > 0 && flowOff < days.length;

            // Clamped outer bar coordinates
            const clampedLeftDay = Math.max(0, flowOff);
            const clampedRightDay = Math.min(days.length, flowOff + flowLen);
            const clampedDays = Math.max(1, clampedRightDay - clampedLeftDay);

            const flowSubtitle = primaryBottleneck
              ? `${tr("timeline_filter_bottleneck", "Bottleneck")}: ${primaryBottleneck.title} · ${primaryBottleneck.picShort} (${primaryBottleneck.shortReason})`
              : activeStage
              ? `${tr("timeline_stage_active_prefix", "Aktif:")} ${activeStage.title} · ${activeStage.picShort}`
              : isTaskDone
              ? hasCps
                ? `${tr("timeline_stage_done", "Selesai")} · ${doneCount}/${stages.length} ${tr("timeline_stage_unit", "tahap")}`
                : tr("timeline_stage_done", "Selesai")
              : hasCps
              ? `${doneCount}/${stages.length} ${tr("timeline_stage_unit", "tahap")} · ${fmtShortDay(flowStart)} – ${fmtShortDay(flowEnd)}`
              : `${fmtShortDay(flowStart)} – ${fmtShortDay(flowEnd)}`;

            return (
              <div key={t.id} className="border-b last:border-0" data-testid={`timeline-row-${t.id}`}>
                {/* Parent Task Row */}
                <div className="group flex items-stretch hover:bg-surface2/70 transition-colors">
                  <div className="sticky left-0 z-10 flex w-[210px] sm:w-[290px] shrink-0 items-center gap-2 border-r bg-surface group-hover:bg-surface2/70 px-2.5 py-2 transition-colors">
                    {hasCps ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(t.id)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-sub hover:text-ink hover:bg-surface2 transition-colors cursor-pointer ${
                          hasBottleneck ? "border-rose-300 text-rose-600 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/30" : ""
                        }`}
                        aria-label={isExpanded ? "Tutup checkpoint flow" : "Buka checkpoint flow"}
                        data-testid={`timeline-expand-${t.id}`}
                      >
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-sub/50">
                        <CircleDot size={11} />
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                    >
                      {t.assignee_ids && t.assignee_ids.length > 1 ? (
                        <AvatarStack ids={t.assignee_ids} max={2} size={22} />
                      ) : (
                        <Avatar user={userMap[t.assignee_id || t.assignee_ids?.[0]]} size={22} showStatus={false} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-xs sm:text-[13px] font-semibold text-ink">{t.title}</span>
                          {hasCps && (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.2 text-[9.5px] font-bold ${
                                hasBottleneck
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                  : isTaskDone
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  : "bg-surface2 text-sub"
                              }`}
                            >
                              {doneCount}/{stages.length}
                            </span>
                          )}
                        </div>
                        <p
                          className={`truncate text-[10.5px] leading-snug ${
                            primaryBottleneck
                              ? primaryBottleneck.severity === "critical"
                                ? "font-semibold text-rose-600 dark:text-rose-400"
                                : "font-semibold text-amber-600 dark:text-amber-400"
                              : activeStage
                              ? "font-medium text-sky-600 dark:text-sky-400"
                              : "text-sub"
                          }`}
                        >
                          {flowSubtitle}
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* Parent Timeline Bar Grid */}
                  <div className="relative flex-1 min-h-[50px]" style={{ width: W * days.length }}>
                    {/* Vertical day gridlines & Today highlight */}
                    <div className="pointer-events-none absolute inset-0 flex">
                      {days.map((d, i) => (
                        <div
                          key={i}
                          style={{ width: W }}
                          className={`h-full shrink-0 border-r border-border/35 ${
                            isToday(d) ? "bg-brand/[0.05]" : ""
                          }`}
                        />
                      ))}
                    </div>
                    {todayOffset >= 0 && todayOffset < days.length && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-[1.5px] bg-brand/55"
                        style={{ left: todayOffset * W + W / 2 }}
                      />
                    )}

                    {/* Parent Flow Bar (Segmented if checkpoints exist, solid span if none) */}
                    {flowVisible && !hasCps && (
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        title={`${t.title} · ${fmtShortDay(flowStart)} – ${fmtShortDay(flowEnd)}${primaryBottleneck ? ` · ${primaryBottleneck.detailSummary}` : ""}`}
                        className={`absolute top-2.5 z-[5] flex h-7 items-center gap-1.5 rounded-full px-2.5 text-left text-[11px] font-semibold shadow-xs transition-transform hover:scale-[1.01] cursor-pointer ${
                          hasBottleneck
                            ? "bg-rose-500 text-white"
                            : isTaskDone
                            ? "bg-emerald-500 text-white"
                            : "text-white"
                        }`}
                        style={{
                          left: clampedLeftDay * W + 3,
                          width: Math.max(26, clampedDays * W - 6),
                          ...(!hasBottleneck && !isTaskDone ? { background: colorOf(t, labelMap) } : {}),
                        }}
                        data-testid={`timeline-bar-${t.id}`}
                      >
                        <span className="truncate">
                          {t.number_str ? `${t.number_str} · ` : ""}
                          {t.title}
                        </span>
                        {primaryBottleneck && (
                          <span className="ml-auto shrink-0 rounded-full bg-white/25 px-1.5 text-[9.5px] font-bold">
                            {primaryBottleneck.shortReason}
                          </span>
                        )}
                      </button>
                    )}

                    {flowVisible && hasCps && (
                      <div
                        onClick={() => toggleExpand(t.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && toggleExpand(t.id)}
                        title={
                          primaryBottleneck
                            ? `${t.title}: ${primaryBottleneck.title} (${primaryBottleneck.picName}) — ${primaryBottleneck.detailSummary}${primaryBottleneck.impactText ? `. ${primaryBottleneck.impactText}` : ""}`
                            : `${t.title}: ${doneCount}/${stages.length} tahap selesai · Klik untuk buka flow checkpoint`
                        }
                        style={{
                          left: clampedLeftDay * W + 3,
                          width: Math.max(stages.length * 28, clampedDays * W - 6),
                        }}
                        className="absolute top-2.5 z-[5] flex h-7 items-stretch gap-[2px] overflow-hidden rounded-full bg-surface/80 p-[1px] shadow-xs ring-1 ring-border/70 cursor-pointer hover:ring-brand/50 transition-all"
                        data-testid={`timeline-bar-${t.id}`}
                      >
                        {stages.map((st, idx) => {
                          const isFirst = idx === 0;
                          const isLast = idx === stages.length - 1;
                          return (
                            <div
                              key={st.id}
                              style={{ flexGrow: st.durationDays, flexBasis: 0 }}
                              title={`${idx + 1}. ${st.title} · PIC: ${st.picName} (${fmtShortDay(st.startDay)}–${fmtShortDay(st.endDay)})${st.isBottleneck ? ` · ${st.shortReason}` : ""}`}
                              className={`flex min-w-[22px] items-center gap-1 overflow-hidden px-1.5 text-[10px] font-semibold transition-all ${segmentClass(
                                st.status,
                                st.severity
                              )} ${isFirst ? "rounded-l-full pl-2" : "rounded-l-[3px]"} ${
                                isLast ? "rounded-r-full pr-2" : "rounded-r-[3px]"
                              }`}
                            >
                              {st.status === "done" && <CheckCircle2 size={10} className="shrink-0" />}
                              {st.status === "bottleneck" && <AlertTriangle size={10} className="shrink-0" />}
                              {st.status === "active" && <Clock size={10} className="shrink-0" />}
                              <span className="truncate">
                                {st.title} · {st.picShort}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded Checkpoint Relay Sub-rows */}
                {isExpanded && (
                  <div className="border-t border-dashed border-border/70 bg-surface2/25" data-testid={`timeline-flow-${t.id}`}>
                    {stages.map((st, idx) => {
                      const sOff = differenceInCalendarDays(st.startDay, start);
                      const sLen = Math.max(1, differenceInCalendarDays(st.endDay, st.startDay) + 1);
                      const visible = sOff + sLen > 0 && sOff < days.length;
                      const cLeft = Math.max(0, sOff);
                      const cRight = Math.min(days.length, sOff + sLen);
                      const cDays = Math.max(1, cRight - cLeft);

                      // Target deadline marker if active & overdue
                      const dlOff = st.deadlineDay ? differenceInCalendarDays(st.deadlineDay, start) : null;
                      const showTargetTick =
                        !st.done &&
                        st.overdueDays > 0 &&
                        dlOff !== null &&
                        dlOff >= cLeft &&
                        dlOff < cRight;

                      const stageTooltip = [
                        `Tahap ${idx + 1}: ${st.title}`,
                        `PIC: ${st.picName}`,
                        `Rentang: ${fmtShortDay(st.startDay)} – ${fmtShortDay(st.endDay)} (${st.durationDays} hr)`,
                        st.deadlineDay ? `Target Deadline: ${fmtShortDay(st.deadlineDay)}` : null,
                        st.done && st.doneDay ? `Selesai: ${fmtShortDay(st.doneDay)}` : null,
                        st.isBottleneck ? `BOTTLENECK: ${st.detailSummary}` : null,
                        st.impactText || null,
                      ]
                        .filter(Boolean)
                        .join("\n");

                      return (
                        <div
                          key={st.id}
                          className={`flex items-stretch border-b border-border/40 last:border-0 transition-colors ${
                            st.isBottleneck
                              ? "bg-rose-50/40 dark:bg-rose-950/15"
                              : st.isActive
                              ? "bg-sky-50/35 dark:bg-sky-950/15"
                              : ""
                          }`}
                          data-testid={`timeline-cp-${st.id}`}
                        >
                          {/* Sub-row Left Info Column */}
                          <div className="sticky left-0 z-10 flex w-[210px] sm:w-[290px] shrink-0 items-center gap-2 border-r bg-surface pl-7 pr-2.5 py-1.5">
                            <button
                              type="button"
                              onClick={(e) => handleToggleStageDone(t, st, e)}
                              title={st.done ? tr("timeline_reopen_stage_title", "Buka kembali tahap ini") : tr("timeline_done_stage_title", "Tandai tahap selesai & lanjut ke PIC berikutnya")}
                              className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer ${
                                st.done
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : st.isBottleneck
                                  ? "border-rose-400 bg-surface text-rose-500 hover:bg-rose-50"
                                  : st.isActive
                                  ? "border-sky-500 bg-surface hover:bg-emerald-50"
                                  : "border-slate-300 bg-surface hover:border-emerald-500 dark:border-slate-600"
                              }`}
                              data-testid={`timeline-cp-check-${st.id}`}
                            >
                              {st.done ? (
                                <CheckCircle2 size={11} />
                              ) : (
                                <span className="text-[9px] font-bold text-sub">{idx + 1}</span>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => onOpen(t.id)}
                              className="min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`truncate text-[11.5px] font-semibold ${
                                    st.done ? "text-sub line-through" : "text-ink"
                                  }`}
                                >
                                  {st.title}
                                </span>
                                {st.isBottleneck && (
                                  <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.2 text-[9px] font-bold ${
                                      st.severity === "critical"
                                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
                                    }`}
                                  >
                                    {st.shortReason}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-sub min-w-0">
                                {st.picIds?.length > 1 ? (
                                  <AvatarStack ids={st.picIds} max={2} size={14} />
                                ) : (
                                  <Avatar user={st.picUser} size={14} showStatus={false} />
                                )}
                                <span className="truncate font-medium text-ink/80">
                                  {st.picUsers?.length > 1 ? st.picUsers.map((u) => u.name.split(/\s+/)[0]).join(", ") : st.picShort}
                                </span>
                                <span className="opacity-50">·</span>
                                <span className="truncate">
                                  {fmtShortDay(st.startDay)}
                                  {st.endDay > st.startDay ? `–${fmtShortDay(st.endDay)}` : ""}
                                </span>
                              </div>
                            </button>
                          </div>

                          {/* Sub-row Stage Gantt Bar */}
                          <div className="relative flex-1 min-h-[40px]" style={{ width: W * days.length }}>
                            <div className="pointer-events-none absolute inset-0 flex">
                              {days.map((d, di) => (
                                <div
                                  key={di}
                                  style={{ width: W }}
                                  className={`h-full shrink-0 border-r border-border/25 ${
                                    isToday(d) ? "bg-brand/[0.04]" : ""
                                  }`}
                                />
                              ))}
                            </div>
                            {todayOffset >= 0 && todayOffset < days.length && (
                              <div
                                className="pointer-events-none absolute inset-y-0 z-10 w-[1.5px] bg-brand/45"
                                style={{ left: todayOffset * W + W / 2 }}
                              />
                            )}

                            {/* Handoff connector vertical step from previous stage */}
                            {idx > 0 && visible && (
                              <div
                                className="pointer-events-none absolute top-0 h-3.5 w-px border-l border-dashed border-slate-400/70 dark:border-slate-500/70"
                                style={{ left: cLeft * W + 4 }}
                              />
                            )}

                            {visible && (
                              <button
                                type="button"
                                onClick={() => onOpen(t.id)}
                                title={stageTooltip}
                                style={{
                                  left: cLeft * W + 3,
                                  width: Math.max(26, cDays * W - 6),
                                }}
                                className={`absolute top-1.5 z-[5] flex h-6 items-center gap-1.5 rounded-full px-2 text-left text-[10.5px] font-semibold shadow-xs transition-all hover:brightness-105 cursor-pointer ${segmentClass(
                                  st.status,
                                  st.severity
                                )} ${
                                  st.status === "waiting" ? "border border-dashed border-slate-400/50 shadow-none" : ""
                                }`}
                              >
                                {st.status === "done" ? (
                                  <CheckCircle2 size={11} className="shrink-0" />
                                ) : st.status === "bottleneck" ? (
                                  <AlertTriangle size={11} className="shrink-0" />
                                ) : st.status === "active" ? (
                                  <Clock size={11} className="shrink-0" />
                                ) : (
                                  <GitBranch size={10} className="shrink-0 opacity-70" />
                                )}
                                <span className="truncate">
                                  {st.title} · {st.picShort}
                                  {st.isBottleneck ? ` (${st.shortReason})` : ""}
                                </span>

                                {showTargetTick && (
                                  <span
                                    title={`Target deadline semula: ${fmtShortDay(st.deadlineDay)}`}
                                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90"
                                    style={{ left: Math.max(8, (dlOff - cLeft + 1) * W - 6) }}
                                  />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {!visibleRows.length && (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-ink">
                {filterMode === "bottleneck"
                  ? tr("timeline_empty_bottleneck_title", "Tidak ada bottleneck yang terdeteksi saat ini")
                  : tr("timeline_empty_title", "Belum ada tugas yang tampil di Timeline")}
              </p>
              <p className="mt-1 text-xs text-sub">
                {filterMode === "bottleneck"
                  ? tr("timeline_empty_bottleneck_desc", "Semua proyek & checkpoint berjalan sesuai jadwal.")
                  : tr("timeline_empty_desc", "Tugas dengan tanggal mulai, deadline, atau checkpoint otomatis tampil di sini.")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const Calendar = memo(function Calendar({ tasks, onOpen }) {
  const { labelMap, t: tr } = useApp();
  const [events, setEvents] = useState([]);
  const [month, setMonth] = useState(startOfMonth(new Date()));

  useEffect(() => {
    if (!hasAccessToken()) {
      setEvents([]);
      return;
    }
    let active = true;
    listEvents()
      .then((res) => {
        if (active) setEvents(res.items || []);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, [month]);

  const days = useMemo(() => {
    const s = startOfWeek(month, { weekStartsOn: 1 });
    const e = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return Array.from({ length: differenceInCalendarDays(e, s) + 1 }, (_, i) => addDays(s, i));
  }, [month]);

  const byDay = useMemo(() => {
    const m = {};
    tasks.forEach((t) => {
      if (t.deadline) (m[format(new Date(t.deadline), "yyyy-MM-dd")] ||= []).push({ type: "task", ...t });
    });
    events.forEach((e) => {
      if (e.start?.dateTime) (m[format(new Date(e.start.dateTime), "yyyy-MM-dd")] ||= []).push({ type: "event", ...e, id: e.id, title: e.summary });
    });
    return m;
  }, [tasks, events]);

  return (
    <div className="card w-full min-w-0 overflow-hidden animate-subpage-enter" data-testid="task-calendar">
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm sm:text-base font-semibold capitalize">{format(month, "MMMM yyyy", { locale: localeId })}</p>
        <div className="flex gap-1">
          <button onClick={() => setMonth(startOfMonth(addDays(month, -1)))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label={tr("calendar_prev_month", "Bulan sebelumnya")} data-testid="calendar-prev">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setMonth(startOfMonth(new Date()))} className="btn-ghost h-9 px-2.5 sm:px-3 text-xs font-semibold">
            {tr("calendar_today", "Hari Ini")}
          </button>
          <button onClick={() => setMonth(startOfMonth(addDays(endOfMonth(month), 1)))} className="btn-ghost flex h-9 w-9 items-center justify-center" aria-label={tr("calendar_next_month", "Bulan berikutnya")} data-testid="calendar-next">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b text-center text-[11px] font-semibold text-sub">
        {[
          ["mon", "Sen"],
          ["tue", "Sel"],
          ["wed", "Rab"],
          ["thu", "Kam"],
          ["fri", "Jum"],
          ["sat", "Sab"],
          ["sun", "Min"],
        ].map(([dk, dl]) => (
          <div key={dk} className="min-w-0 py-2">
            {tr(`calendar_day_${dk}`, dl)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-w-0">
        {days.map((d, i) => {
          const list = byDay[format(d, "yyyy-MM-dd")] || [];
          return (
            <div
              key={`${format(d, "yyyy-MM-dd")}-${i}`}
              className={`min-h-[62px] min-w-0 overflow-hidden border-b border-r p-0.5 sm:p-1 sm:min-h-[104px] ${
                isSameMonth(d, month) ? "" : "bg-surface2 opacity-60"
              }`}
            >
              <p className={`mb-1 text-[11px] font-semibold ${isToday(d) ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white" : "text-sub"}`}>
                {format(d, "d")}
              </p>
              {list.slice(0, 3).map((item) =>
                item.type === "task" ? (
                  <button
                    key={item.id}
                    onClick={() => onOpen(item.id)}
                    className="mb-0.5 block w-full truncate rounded-md px-1 py-0.5 text-left text-[10px] font-semibold"
                    style={{ background: `color-mix(in srgb, ${colorOf(item, labelMap)} 18%, transparent)`, color: "var(--c-text)" }}
                    data-testid={`calendar-item-${item.id}`}
                  >
                    {item.title}
                  </button>
                ) : (
                  <a
                    key={item.id}
                    href={item.htmlLink || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-0.5 block w-full truncate rounded-md px-1 py-0.5 text-left text-[10px] font-semibold"
                    style={{ background: "var(--c-accent1)", color: "var(--c-text)" }}
                    data-testid={`calendar-item-${item.id}`}
                  >
                    📅 {item.title}
                  </a>
                )
              )}
              {list.length > 3 && <p className="text-[10px] text-sub">+{list.length - 3} {tr("calendar_more_suffix", "lainnya")}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
});
