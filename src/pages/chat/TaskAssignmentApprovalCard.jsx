import { memo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Calendar, Check, Clock, Flag, Layers, X } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar, fmtDate } from "../../components/common";
import { playSound } from "../../lib/sound";
import { updateMessageInCache } from "../../lib/workspaceCaches";

const PRIORITY_META = {
  urgent: { label: "Mendesak", cls: "text-rose-600 dark:text-rose-400" },
  high: { label: "Tinggi", cls: "text-amber-600 dark:text-amber-400" },
  medium: { label: "Sedang", cls: "text-sky-600 dark:text-sky-400" },
  low: { label: "Rendah", cls: "text-slate-500 dark:text-slate-400" },
};

function formatDeadlineLabel(iso) {
  if (!iso) return "Tanpa deadline";
  try {
    return fmtDate(iso, "d MMM yyyy, HH:mm");
  } catch {
    return String(iso);
  }
}

const TaskAssignmentApprovalCard = memo(function TaskAssignmentApprovalCard({ m }) {
  const navigate = useNavigate();
  const { me, userMap, subscribe } = useApp();
  const [info, setInfo] = useState(() => m.task_assignment || {});
  const [busy, setBusy] = useState(false);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    if (m.task_assignment) setInfo(m.task_assignment);
  }, [m.task_assignment]);

  useEffect(() => {
    return subscribe((e) => {
      if (e?.type === "message:update" && e.data?.id === m.id && e.data?.task_assignment) {
        setInfo(e.data.task_assignment);
      }
    });
  }, [subscribe, m.id]);

  const status = info.status || "pending";
  const isPending = status === "pending";
  const isAccepted = status === "accepted";
  const isRejected = status === "rejected";
  const isCancelled = status === "cancelled";

  const isTargetAssignee = Boolean(me?.user_id && info.assignee_id && me.user_id === info.assignee_id);
  const inviterUser = (info.invited_by && userMap?.[info.invited_by]) || { name: info.invited_by_name || "Rekan Kerja" };
  const assigneeUser = (info.assignee_id && userMap?.[info.assignee_id]) || { name: info.assignee_name || "Anggota Tim" };
  const prKey = String(info.priority || "medium").toLowerCase();
  const prMeta = PRIORITY_META[prKey] || PRIORITY_META.medium;

  const accentBarClass = isAccepted
    ? "bg-emerald-500"
    : isRejected
    ? "bg-rose-500"
    : isCancelled
    ? "bg-slate-400"
    : "bg-amber-500";

  const statusBadgeClass = isAccepted
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
    : isRejected
    ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
    : isCancelled
    ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
    : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";

  const statusLabel = isAccepted
    ? "Diterima"
    : isRejected
    ? "Ditolak"
    : isCancelled
    ? "Dibatalkan"
    : "Menunggu Konfirmasi";

  const respond = async (decision, noteText = "") => {
    if (busy || !info.task_id) return;
    const prevInfo = info;
    const optimistic = {
      ...info,
      status: decision === "accept" ? "accepted" : "rejected",
      responded_at: new Date().toISOString(),
      note: noteText.trim(),
    };
    setInfo(optimistic);
    updateMessageInCache({ ...m, task_assignment: optimistic });
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${info.task_id}/assignment-response`, {
        decision,
        invite_id: info.invite_id || undefined,
        note: noteText.trim(),
      });
      if (data?.message?.task_assignment) {
        setInfo(data.message.task_assignment);
        updateMessageInCache(data.message);
      }
      setShowRejectBox(false);
      setRejectNote("");
      if (decision === "accept") {
        playSound("task_done");
        toast.success(`Tugas ${info.number_str || ""} diterima dan kini aktif atas nama Anda.`);
      } else {
        playSound("click");
        toast.info(`Penugasan ${info.number_str || ""} ditolak.`);
      }
    } catch (e) {
      setInfo(prevInfo);
      updateMessageInCache({ ...m, task_assignment: prevInfo });
      toast.error(errMsg(e, "Gagal memproses konfirmasi tugas"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="font-sans w-[min(26rem,calc(100vw-4.5rem))] sm:w-[420px] max-w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface text-left text-ink shadow-sm overflow-hidden"
      data-testid={`task-assign-approval-${info.invite_id || m.id}`}
    >
      {/* Top Semantic Accent Strip */}
      <div className={`h-1 w-full ${accentBarClass}`} />

      {/* Header */}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-sub">
              Approval Penugasan
            </span>
            {info.number_str && (
              <span className="text-[11px] font-bold text-ink/75 tabular-nums">
                {info.number_str}
              </span>
            )}
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${statusBadgeClass}`}
            data-testid={`task-assign-status-${info.invite_id || m.id}`}
          >
            {isAccepted && <Check size={11} strokeWidth={2.6} />}
            {isRejected && <X size={11} strokeWidth={2.6} />}
            {isPending && <Clock size={11} strokeWidth={2.3} />}
            <span>{statusLabel}</span>
          </span>
        </div>

        <h4 className="mt-1.5 text-[15px] font-bold leading-snug tracking-tight text-ink">
          {info.title || "Tugas Baru"}
        </h4>
        {info.description && (
          <p className="mt-1 text-[12px] leading-relaxed text-sub line-clamp-2">
            {info.description}
          </p>
        )}
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-px border-t border-slate-100 dark:border-slate-800/80 bg-slate-100 dark:bg-slate-800/80">
        <div className="bg-surface px-4 py-2.5 min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-sub">
            Ditugaskan oleh
          </span>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <Avatar user={inviterUser} size={18} showStatus={false} ringDeadline={false} />
            <span className="truncate text-[12px] font-semibold text-ink">
              {inviterUser?.name || info.invited_by_name || "Rekan Kerja"}
            </span>
          </div>
        </div>

        <div className="bg-surface px-4 py-2.5 min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-sub">
            Board / Divisi
          </span>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <Layers size={13} className="shrink-0 text-sub" />
            <span className="truncate text-[12px] font-semibold text-ink">
              {info.board_name || info.department || "Workspace"}
            </span>
          </div>
        </div>

        <div className="bg-surface px-4 py-2.5 min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-sub">
            Prioritas
          </span>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <Flag size={12} className={`shrink-0 ${prMeta.cls}`} />
            <span className={`truncate text-[12px] font-semibold ${prMeta.cls}`}>
              {prMeta.label}
            </span>
          </div>
        </div>

        <div className="bg-surface px-4 py-2.5 min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-sub">
            Deadline
          </span>
          <div className="mt-1 flex items-center gap-1.5 min-w-0">
            <Calendar size={12} className="shrink-0 text-sub" />
            <span className="truncate text-[12px] font-semibold text-ink tabular-nums">
              {formatDeadlineLabel(info.deadline)}
            </span>
          </div>
        </div>
      </div>

      {/* Action / Decision Body */}
      <div className="border-t border-slate-100 dark:border-slate-800/80 px-4 py-3">
        {isPending ? (
          isTargetAssignee ? (
            showRejectBox ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) respond("reject", rejectNote);
                  }}
                  placeholder="Alasan penolakan (opsional)..."
                  maxLength={300}
                  autoFocus
                  className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-surface2/60 px-3 text-xs text-ink placeholder:text-sub outline-none focus:border-rose-400"
                  data-testid="task-assign-reject-note"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => respond("reject", rejectNote)}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white transition-colors disabled:opacity-50 cursor-pointer"
                    data-testid="task-assign-confirm-reject"
                  >
                    <X size={14} strokeWidth={2.5} />
                    <span>Konfirmasi Tolak</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setShowRejectBox(false);
                      setRejectNote("");
                    }}
                    className="flex h-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-surface hover:bg-surface2 text-xs font-semibold text-sub transition-colors cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11.5px] text-sub leading-relaxed">
                  Tugas akan aktif atas nama Anda di board setelah Anda mengklik <strong className="font-semibold text-ink">Terima Tugas</strong>.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => respond("accept")}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                    data-testid={`task-assign-accept-${info.invite_id || m.id}`}
                  >
                    <Check size={14} strokeWidth={2.6} />
                    <span>Terima Tugas</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowRejectBox(true)}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-xs font-bold text-rose-600 dark:text-rose-400 transition-colors disabled:opacity-50 cursor-pointer"
                    data-testid={`task-assign-reject-${info.invite_id || m.id}`}
                  >
                    <X size={14} strokeWidth={2.5} />
                    <span>Tolak</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="flex items-start gap-2 text-[11.5px] text-sub leading-relaxed">
              <Clock size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span>
                Menunggu <strong className="font-semibold text-ink">{assigneeUser?.name || info.assignee_name || "penerima"}</strong> menerima atau menolak penugasan. Kartu tugas tetap ada tanpa nama PIC sampai diterima.
              </span>
            </div>
          )
        ) : isAccepted ? (
          <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Diterima oleh {assigneeUser?.name || info.assignee_name} · Tugas kini aktif atas nama {assigneeUser?.name || info.assignee_name}
          </div>
        ) : isRejected ? (
          <div className="rounded-xl border border-rose-200/80 dark:border-rose-800/60 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2 text-[12px] font-semibold text-rose-700 dark:text-rose-300">
            <div>✕ Penugasan ditolak oleh {assigneeUser?.name || info.assignee_name}</div>
            {info.note && (
              <p className="mt-1 text-[11px] font-normal italic text-rose-600/90 dark:text-rose-300/90">
                "{info.note}"
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-surface2/60 px-3 py-2 text-[12px] font-medium text-sub">
            Undangan penugasan ini telah dibatalkan.
          </div>
        )}
      </div>

      {/* Footer Link */}
      {info.task_id && (
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 bg-surface2/35 px-4 py-2">
          <span className="text-[11px] text-sub truncate">
            {isAccepted ? "Tugas aktif di board" : isPending ? "Tinjau detail sebelum konfirmasi" : "Kartu tugas di workspace"}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/tasks?task=${encodeURIComponent(info.task_id)}`)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-brand hover:bg-soft-red transition-colors whitespace-nowrap cursor-pointer"
            data-testid={`task-assign-open-${info.invite_id || m.id}`}
          >
            <span>Lihat Tugas</span>
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
});

export default TaskAssignmentApprovalCard;
