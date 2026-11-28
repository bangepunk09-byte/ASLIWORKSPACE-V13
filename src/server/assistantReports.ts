export function computeTaskProgressPercent(t: any): number {
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
    const doneCp = cps.filter((c: any) => c?.done || c?.completed || c?.status === "done").length;
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

export function extractTaskCheckpointInfo(t: any): {
  checkpoints_done: number;
  checkpoints_total: number;
  current_checkpoint: string | null;
} {
  const rawList = Array.isArray(t?.checkpoints) && t.checkpoints.length > 0
    ? t.checkpoints
    : (Array.isArray(t?.checklist) && t.checklist.length > 0 ? t.checklist : []);
  if (!rawList.length) {
    return { checkpoints_done: 0, checkpoints_total: 0, current_checkpoint: null };
  }
  const isDoneCp = (c: any) => Boolean(c?.done || c?.completed || c?.status === "done");
  const doneCount = rawList.filter(isDoneCp).length;
  const activeCp = rawList.find((c: any) => !isDoneCp(c));
  const title = activeCp ? String(activeCp.title || activeCp.name || activeCp.label || "").trim() : "";
  return {
    checkpoints_done: doneCount,
    checkpoints_total: rawList.length,
    current_checkpoint: title || null
  };
}

export interface AssistantReportItem {
  id: string;
  number_str: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  checkpoints_done: number;
  checkpoints_total: number;
  current_checkpoint: string | null;
  board_id: string | null;
  board_name: string;
  assignee_ids: string[];
  assignee_names: string[];
  deadline: string | null;
  deadline_wib: string;
  is_done: boolean;
  is_overdue: boolean;
  is_under_6h: boolean;
  is_due_today: boolean;
  is_due_tomorrow: boolean;
  late_duration: string | null;
}

export interface AssistantTaskReportPayload {
  kind: "task_report";
  title: string;
  subtitle?: string;
  load_status?: "optimal" | "stabil" | "pressure" | null;
  load_label?: string | null;
  summary: {
    total: number;
    done: number;
    active: number;
    overdue: number;
    due_soon: number;
    progress_percent: number;
    progress_mode: "completion" | "average";
  };
  items: AssistantReportItem[];
  total_items: number;
  footer_note?: string;
}

export interface AssistantSummaryMetric {
  label: string;
  tone?: "default" | "strong" | "good" | "warn" | "danger";
}

export interface AssistantSummaryRow {
  id?: string;
  code?: string;
  title: string;
  subtitle?: string;
  status_label?: string;
  status_tone?: "default" | "good" | "warn" | "danger";
  progress?: number | null;
  right_value?: string;
  user_ids?: string[];
  user_names?: string[];
  href?: string;
}

export interface AssistantSummaryReportPayload {
  kind: "summary_report";
  title: string;
  subtitle?: string;
  progress_percent: number;
  progress_label: string;
  progress_tone?: "brand" | "good" | "warn" | "danger";
  metrics: AssistantSummaryMetric[];
  rows: AssistantSummaryRow[];
  empty_note?: string;
  footer_note?: string;
  cta_label?: string;
  cta_href?: string;
}

export type AssistantReportPayload = AssistantTaskReportPayload | AssistantSummaryReportPayload;

export function toReportItem(t: any): AssistantReportItem {
  const cpInfo =
    typeof t.checkpoints_total === "number"
      ? {
          checkpoints_done: Number(t.checkpoints_done) || 0,
          checkpoints_total: Number(t.checkpoints_total) || 0,
          current_checkpoint: t.current_checkpoint || null
        }
      : extractTaskCheckpointInfo(t);
  return {
    id: String(t.id || ""),
    number_str: String(t.number_str || t.id || "TSK"),
    title: String(t.title || "Tanpa Judul"),
    status: String(t.status || "todo"),
    priority: String(t.priority || "medium"),
    progress: typeof t.progress === "number" ? Math.min(100, Math.max(0, Math.round(t.progress))) : computeTaskProgressPercent(t),
    checkpoints_done: cpInfo.checkpoints_done,
    checkpoints_total: cpInfo.checkpoints_total,
    current_checkpoint: cpInfo.current_checkpoint,
    board_id: t.board_id || null,
    board_name: String(t.board_name || "Tanpa Board"),
    assignee_ids: Array.isArray(t.assignee_ids) ? t.assignee_ids.slice(0, 8) : [],
    assignee_names: Array.isArray(t.assignee_names) ? t.assignee_names.slice(0, 8) : [],
    deadline: t.deadline || null,
    deadline_wib: String(t.deadline_wib || "-"),
    is_done: Boolean(t.is_done),
    is_overdue: Boolean(t.is_overdue),
    is_under_6h: Boolean(t.is_under_6h),
    is_due_today: Boolean(t.is_due_today),
    is_due_tomorrow: Boolean(t.is_due_tomorrow),
    late_duration: t.late_duration || null
  };
}

export function buildTaskReportPayload(params: {
  title: string;
  subtitle?: string;
  loadStatus?: "optimal" | "stabil" | "pressure" | null;
  loadLabel?: string | null;
  tasks: any[];
  doneCount?: number;
  totalCount?: number;
  maxItems?: number;
  footerNote?: string;
}): AssistantTaskReportPayload {
  const { title, subtitle, loadStatus = null, loadLabel = null, tasks, maxItems = 25, footerNote } = params;
  const list = Array.isArray(tasks) ? tasks : [];
  const activeCount = list.filter((t) => !t.is_done).length;
  const overdueCount = list.filter((t) => t.is_overdue).length;
  const dueSoonCount = list.filter((t) => !t.is_overdue && (t.is_under_6h || t.is_due_today || t.is_due_tomorrow)).length;
  const doneCount = typeof params.doneCount === "number" ? params.doneCount : list.filter((t) => t.is_done).length;
  const totalCount = typeof params.totalCount === "number" ? params.totalCount : doneCount + activeCount;

  let progressPercent = 0;
  let progressMode: "completion" | "average" = "completion";
  if (totalCount > 0 && doneCount > 0) {
    progressPercent = Math.min(100, Math.max(0, Math.round((doneCount / totalCount) * 100)));
    progressMode = "completion";
  } else if (list.length > 0) {
    const sum = list.reduce((acc, t) => acc + (typeof t.progress === "number" ? t.progress : computeTaskProgressPercent(t)), 0);
    progressPercent = Math.min(100, Math.max(0, Math.round(sum / list.length)));
    progressMode = "average";
  } else if (totalCount > 0 && activeCount === 0) {
    progressPercent = 100;
    progressMode = "completion";
  } else if (list.length === 0 && doneCount === 0 && totalCount === 0) {
    progressPercent = 100;
    progressMode = "completion";
  }

  return {
    kind: "task_report",
    title,
    subtitle,
    load_status: loadStatus,
    load_label: loadLabel,
    summary: {
      total: totalCount,
      done: doneCount,
      active: activeCount,
      overdue: overdueCount,
      due_soon: dueSoonCount,
      progress_percent: progressPercent,
      progress_mode: progressMode
    },
    items: list.slice(0, maxItems).map(toReportItem),
    total_items: list.length,
    ...(footerNote ? { footer_note: footerNote } : {})
  };
}

export function buildSummaryReportPayload(params: {
  title: string;
  subtitle?: string;
  progressPercent: number;
  progressLabel: string;
  progressTone?: "brand" | "good" | "warn" | "danger";
  metrics: AssistantSummaryMetric[];
  rows: AssistantSummaryRow[];
  emptyNote?: string;
  footerNote?: string;
  ctaLabel?: string;
  ctaHref?: string;
  maxRows?: number;
}): AssistantSummaryReportPayload {
  const {
    title,
    subtitle,
    progressPercent,
    progressLabel,
    progressTone = "brand",
    metrics,
    rows,
    emptyNote,
    footerNote,
    ctaLabel,
    ctaHref,
    maxRows = 25
  } = params;
  return {
    kind: "summary_report",
    title,
    subtitle,
    progress_percent: Math.min(100, Math.max(0, Math.round(Number(progressPercent) || 0))),
    progress_label: progressLabel,
    progress_tone: progressTone,
    metrics: metrics.filter((m) => m && m.label),
    rows: (rows || []).slice(0, maxRows),
    ...(emptyNote ? { empty_note: emptyNote } : {}),
    ...(footerNote ? { footer_note: footerNote } : {}),
    ...(ctaLabel ? { cta_label: ctaLabel } : {}),
    ...(ctaHref ? { cta_href: ctaHref } : {})
  };
}
