import { memo, useMemo, useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Reply, Smile, Pencil, Trash2, Pin, CheckSquare, FileText, MoreHorizontal, Check, CheckCheck, StickyNote, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl } from "../../lib/api";
import { playSound } from "../../lib/sound";
import { updateMessageInCache } from "../../lib/workspaceCaches";
import { useApp } from "../../context/AppContext";
import { Avatar, StatusBadge, PriorityBadge, fmtTime, ImageLightbox, VerifiedBadge, buildMentionMatcher } from "../../components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { AppSelect } from "../../components/ui/select";
import PollCard from "./PollCard";
import { StickerTile } from "./Composer";

const STICKY_THEMES = {
  amber: {
    card: "bg-amber-50/95 border-amber-200/90 dark:bg-amber-950/35 dark:border-amber-800/70",
    topBar: "#F59E0B",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
    barFill: "bg-amber-500",
    checkBg: "bg-amber-500 border-amber-500 text-white",
  },
  emerald: {
    card: "bg-emerald-50/90 border-emerald-200/90 dark:bg-emerald-950/35 dark:border-emerald-800/70",
    topBar: "#10B981",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
    barFill: "bg-emerald-500",
    checkBg: "bg-emerald-500 border-emerald-500 text-white",
  },
  sky: {
    card: "bg-sky-50/95 border-sky-200/90 dark:bg-sky-950/35 dark:border-sky-800/70",
    topBar: "#0EA5E9",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200",
    barFill: "bg-sky-500",
    checkBg: "bg-sky-500 border-sky-500 text-white",
  },
  rose: {
    card: "bg-rose-50/90 border-rose-200/90 dark:bg-rose-950/35 dark:border-rose-800/70",
    topBar: "#F43F5E",
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200",
    barFill: "bg-rose-500",
    checkBg: "bg-rose-500 border-rose-500 text-white",
  },
  violet: {
    card: "bg-violet-50/90 border-violet-200/90 dark:bg-violet-950/35 dark:border-violet-800/70",
    topBar: "#8B5CF6",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200",
    barFill: "bg-violet-500",
    checkBg: "bg-violet-500 border-violet-500 text-white",
  },
};

const StickyNoteMessageCard = memo(function StickyNoteMessageCard({ m }) {
  const { me, t: tr } = useApp();
  const [noteState, setNoteState] = useState(() => m.sticky_note || {});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (m.sticky_note) setNoteState(m.sticky_note);
  }, [m.sticky_note]);

  const theme = STICKY_THEMES[noteState.color] || STICKY_THEMES.amber;
  const items = Array.isArray(noteState.items) ? noteState.items : [];
  const total = items.length;
  const doneCount = items.filter((it) => it?.done).length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : noteState.completed ? 100 : (noteState.progress || 0);
  const isExecuted = total > 0 ? doneCount === total : Boolean(noteState.completed);

  const handleToggleItem = async (itemId) => {
    if (busyId === itemId) return;
    const prevState = noteState;
    const targetItem = items.find((it) => it.id === itemId);
    const nextDone = targetItem ? !targetItem.done : true;
    const myFirstName = (me?.name || "Anggota").split(" ")[0];
    const nextItems = items.map((it) =>
      it.id === itemId
        ? { ...it, done: nextDone, checked_by_name: nextDone ? myFirstName : undefined }
        : it
    );
    const nextDoneCount = nextItems.filter((it) => it.done).length;
    const nextProgress = total > 0 ? Math.round((nextDoneCount / total) * 100) : 0;
    const nextExecuted = total > 0 && nextDoneCount === total;

    const optimisticNote = {
      ...noteState,
      items: nextItems,
      done_count: nextDoneCount,
      total_count: total,
      progress: nextProgress,
      completed: nextExecuted,
    };
    setNoteState(optimisticNote);
    updateMessageInCache({ ...m, sticky_note: optimisticNote });

    if (nextExecuted && progress < 100) {
      playSound("task_done");
    } else {
      playSound(nextDone ? "check" : "uncheck");
    }

    setBusyId(itemId);
    try {
      const { data } = await api.post(`/messages/${m.id}/sticky-toggle`, { item_id: itemId });
      if (data?.message) {
        if (data.message.sticky_note) setNoteState(data.message.sticky_note);
        updateMessageInCache(data.message);
      }
    } catch (err) {
      setNoteState(prevState);
      updateMessageInCache({ ...m, sticky_note: prevState });
      toast.error(errMsg(err, "Gagal memperbarui checklist sticky note"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className={`w-[min(22rem,calc(100vw-5.5rem))] sm:w-[360px] max-w-full rounded-2xl border border-t-[3px] p-3.5 sm:p-4 text-left text-ink shadow-sm ${theme.card}`}
      style={{ borderTopColor: theme.topBar }}
      data-testid={`message-sticky-note-${m.id}`}
    >
      {/* Header Badge & Progress */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${theme.badge}`}>
            <StickyNote size={10} />
            {tr("notes_group_card_badge", "Sticky Note")}
          </span>
          <h4 className="mt-1.5 text-sm font-extrabold text-ink break-words leading-snug">
            {noteState.title || tr("notes_default_title", "Catatan Checklist")}
          </h4>
        </div>

        <div
          className={`inline-flex shrink-0 items-center gap-1 font-mono text-xs font-extrabold tabular-nums ${
            isExecuted ? "text-emerald-700 dark:text-emerald-300" : "text-slate-700 dark:text-slate-200"
          }`}
        >
          {isExecuted && <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />}
          <span>
            {progress}%{isExecuted ? ` · ${tr("notes_status_done", "Terlaksana")}` : ""}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${
              isExecuted ? "bg-emerald-500" : theme.barFill
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10.5px] font-semibold text-sub tabular-nums shrink-0">
          {doneCount}/{total}
        </span>
      </div>

      {/* Interactive Checklist */}
      {items.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => handleToggleItem(it.id)}
                disabled={busyId === it.id}
                className="group/item flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/75 dark:hover:bg-slate-900/50 transition-colors cursor-pointer"
                data-testid={`group-sticky-check-${it.id}`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    it.done
                      ? theme.checkBg
                      : "border-slate-400/70 bg-white/90 dark:border-slate-600 dark:bg-slate-900/70 group-hover/item:border-slate-600"
                  }`}
                >
                  {it.done && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs leading-relaxed break-words [overflow-wrap:anywhere] ${
                      it.done
                        ? "line-through text-slate-400 dark:text-slate-500"
                        : "text-slate-800 dark:text-slate-100 font-medium"
                    }`}
                  >
                    {renderInline(it.text, {}, false, [])}
                  </span>
                  {it.done && it.checked_by_name && (
                    <span className="block text-[10px] font-medium text-emerald-700/80 dark:text-emerald-300/80">
                      ✓ {tr("notes_group_checked_by_prefix", "Dicentang")} {it.checked_by_name}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : noteState.content ? (
        <p className="mt-2 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-line break-words">
          {renderInline(noteState.content, {}, false, [])}
        </p>
      ) : (
        <p className="mt-2 text-[11px] italic text-sub">
          {tr("notes_group_empty_points", "Belum ada poin checklist.")}
        </p>
      )}

      {noteState.extra_note && (
        <div className="mt-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-slate-900/40 px-2.5 py-1.5 text-xs text-ink break-words">
          💬 {renderInline(noteState.extra_note, {}, false, [])}
        </div>
      )}

      {noteState.owner_name && (
        <p className="mt-2.5 pt-2 border-t border-black/8 dark:border-white/10 text-[10.5px] font-semibold text-sub">
          {tr("notes_group_owner_prefix", "Dari Sticky Note")} {noteState.owner_name}
        </p>
      )}
    </div>
  );
});

const TaskPreview = memo(function TaskPreview({ m }) {
  const { userMap, me, isManager, isAdmin, subscribe, t: tr } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState(m.task || {});

  useEffect(() => {
    if (m.task) setTask(m.task);
  }, [m.task]);

  useEffect(() => {
    return subscribe((e) => {
      if (e.type === "tasks:changed" && e.task?.id === task.id) {
        setTask((prev) => ({ ...(prev || {}), ...e.task }));
      } else if (e.type === "message:update" && e.data?.id === m.id) {
        if (e.data.task || e.data.approvals) {
          setTask((prev) => ({
            ...(prev || {}),
            ...(e.data.task || {}),
            ...(e.data.approvals ? { approvals: e.data.approvals, approval: e.data.approvals } : {})
          }));
        }
      }
    });
  }, [subscribe, task.id, m.id]);
  
  const t = task || {};
  // Handle approvals on both t.approvals, t.approval, and m.approvals
  const approval = t.approvals || t.approval || m.approvals || {
    needed: 2,
    approved_by: [],
    status: t.status === "done" ? "approved" : "pending"
  };
  const approvedList = Array.isArray(approval.approved_by) ? approval.approved_by : [];
  const approvedCount = approvedList.length;
  const isApprovedFull = approvedCount >= 2 || approval.status === "approved" || t.status === "done";
  
  // 1 approval = 50%, 2 or more = 100%
  const progressPercent = approvedCount === 0 ? 0 : approvedCount === 1 ? 50 : 100;
  
  const alreadyApproved = approvedList.includes(me?.user_id);
  const can = true; // In group chat, team members can participate in approval

  const decide = async (decision) => {
    if (busy || !t?.id) return;
    setBusy(true);
    try {
      const res = await api.post(`/tasks/${t.id}/approval`, {
        decision,
        note: "",
        message_id: m.id
      });
      const updatedTask = res.data?.task || (res.data?.id ? res.data : null);
      if (updatedTask) {
        setTask((prev) => ({ ...(prev || {}), ...updatedTask }));
      }
      if (decision === "approve") {
        const nextApproved =
          res.data?.approvals?.approved_by ||
          updatedTask?.approvals?.approved_by ||
          [];
        if (updatedTask?.status === "done" || nextApproved.length >= 2) {
          playSound("task_done");
          toast.success("Approval tercapai 2/2 (100%)! Tugas otomatis pindah ke Done.");
        } else {
          playSound("click");
          toast.success("Approval 1/2 tercatat. Menunggu 1 orang lagi.");
        }
      } else {
        playSound("click");
        const prefillText = `Revisi ${t.number_str || `T-${t.number || ""}`} — ${t.title || ""}: `;
        window.dispatchEvent(
          new CustomEvent("circle:composer-prefill", {
            detail: {
              conversationId: m.conversation_id,
              text: prefillText,
              replyMsg: m
            }
          })
        );
        toast.info("Silakan ketik catatan revisi langsung di kolom chat");
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
    setBusy(false);
  };

  return (
    <div className="w-[min(20rem,calc(100vw-5.5rem))] sm:w-80 max-w-full rounded-2xl border border-slate-200/80 bg-surface p-3.5 sm:p-4 text-left text-ink shadow-sm" data-testid={`message-task-card-${t.id}`}>
      <button onClick={() => navigate(`/tasks?task=${t.id}`)} className="block w-full text-left group">
        <div className="flex items-center justify-end text-sub mb-1">
          <span className="text-xs font-semibold text-slate-500">{t.number_str || `T-${t.number}`}</span>
        </div>
        <p className="font-bold text-sm text-ink group-hover:text-brand transition-colors line-clamp-2">{t.title}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          <StatusBadge status={t.status} />
          <PriorityBadge value={t.priority} />
        </div>
      </button>

      {/* 2-Person Approval Progress */}
      <div className="mt-3.5 pt-3 border-t">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold mb-1.5">
          <span className="text-slate-500 truncate">{tr("chat_task_approval_progress", "Progres Approval")}</span>
          <span className={`font-bold shrink-0 whitespace-nowrap ${isApprovedFull ? "text-emerald-600" : approvedCount === 1 ? "text-amber-600" : "text-slate-500"}`}>
            {isApprovedFull
              ? `${approvedCount >= 2 ? `${approvedCount}/2` : "2/2"} ${tr("chat_task_approved_suffix", "Approved")}`
              : approvedCount === 1
              ? `1/2 ${tr("chat_task_approved_suffix", "Approved")}`
              : `0/2 ${tr("chat_task_approved_suffix", "Approved")}`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full transition-[width] duration-300 ${isApprovedFull ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {approvedList.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            {tr("chat_task_approved_suffix", "Approved")}: <b className="text-ink">{approvedList.map((uid) => userMap[uid]?.name?.split(" ")[0] || uid).join(", ")}</b>
          </p>
        )}
      </div>

      {/* Action buttons */}
      {!isApprovedFull ? (
        can ? (
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button
              disabled={busy || alreadyApproved}
              onClick={() => decide("approve")}
              className="h-9 rounded-xl bg-emerald-500 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              data-testid={`task-preview-approve-${m.id}`}
            >
              {alreadyApproved ? tr("chat_task_already_approved_btn", "Sudah Approve ✓") : tr("chat_task_approve_btn", "Approve")}
            </button>
            <button
              disabled={busy}
              onClick={() => decide("revise")}
              className="h-9 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              data-testid={`task-preview-revise-${m.id}`}
            >
              {tr("chat_task_revise_btn", "Revisi")}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-center text-xs text-sub">{tr("chat_task_waiting_approval", "Menunggu approval.")}</p>
        )
      ) : (
        <div className="mt-3 space-y-2">
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-2 text-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {tr("chat_task_approved_done_banner", "✓ Approved 100% · Status: Done")}
          </div>
          {/* Allow additional approvals beyond 2 people */}
          {!alreadyApproved ? (
            <button
              disabled={busy}
              onClick={() => decide("approve")}
              className="w-full h-8 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
              data-testid={`task-preview-approve-more-${m.id}`}
            >
              {tr("chat_task_approve_more_prefix", "+ Approve Juga")} ({approvedCount} {tr("chat_task_approve_more_suffix", "sudah approve")})
            </button>
          ) : (
            <p className="text-center text-[11px] text-emerald-600 font-medium">
              {tr("chat_task_you_approved", "Anda telah meng-approve tugas ini ✓")}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

const AccessRequestCard = memo(function AccessRequestCard({ m }) {
  const { me, isManager, isAdmin, subscribe, t: tr } = useApp();
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState(m.access_request || {});
  const [assignedRole, setAssignedRole] = useState(req.assigned_role || req.job_title || "employee");

  useEffect(() => {
    if (m.access_request) setReq(m.access_request);
  }, [m.access_request]);

  useEffect(() => {
    return subscribe((e) => {
      if (e.type === "access_requests:changed") {
        api.get("/admin/access-requests").then((res) => {
          const found = (res.data || []).find((x) => x.id === req.id);
          if (found) setReq(found);
        }).catch(() => {});
      }
    });
  }, [subscribe, req.id]);

  const canApprove = isAdmin || isManager;
  const isPending = req.status === "pending";
  const isApproved = req.status === "approved";
  const isRejected = req.status === "rejected";

  const isDeleteReq = req.type === "delete_user";
  const isPasswordReset = req.type === "password_reset";

  const handleApprove = async () => {
    const prevReq = req;
    const optimistic = {
      ...req,
      status: "approved",
      approved_by: me?.name || "Manager",
      approved_at: new Date().toISOString(),
      assigned_role: assignedRole
    };
    setReq(optimistic);
    setBusy(true);
    try {
      await api.post(`/admin/access-requests/${req.id}/approve`, isPasswordReset || isDeleteReq ? {} : {
        role: assignedRole,
        department: req.department
      });
      if (isDeleteReq) {
        toast.success(`Karyawan ${req.name} berhasil dihapus.`);
      } else if (isPasswordReset) {
        toast.success(`Reset password untuk ${req.name} telah di-approve!`);
      } else {
        toast.success(`Akses untuk ${req.name} berhasil di-approve!`);
      }
    } catch (e) {
      setReq(prevReq);
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    const prevReq = req;
    const optimistic = {
      ...req,
      status: "rejected",
      rejected_by: me?.name || "Manager",
      rejected_at: new Date().toISOString()
    };
    setReq(optimistic);
    setBusy(true);
    try {
      await api.post(`/admin/access-requests/${req.id}/reject`);
      if (isDeleteReq) {
        toast.info(`Permohonan hapus ${req.name} ditolak.`);
      } else if (isPasswordReset) {
        toast.info(`Permintaan reset password ${req.name} ditolak.`);
      } else {
        toast.info(`Permintaan akses ${req.name} ditolak.`);
      }
    } catch (e) {
      setReq(prevReq);
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-[min(22rem,calc(100vw-5.5rem))] sm:w-88 max-w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface p-3.5 sm:p-4 text-left text-ink shadow-md" data-testid={`access-request-card-${req.id}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white font-bold text-xs shadow-xs ${
            isDeleteReq ? "bg-rose-600" : isPasswordReset ? "bg-indigo-600" : "bg-gradient-to-tr from-brand to-rose-400"
          }`}>
            {isDeleteReq ? "🗑️" : isPasswordReset ? "🔑" : "🤖"}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-ink leading-tight truncate">
              {isDeleteReq ? tr("chat_access_del_title", "Approval Hapus Karyawan") : isPasswordReset ? tr("chat_access_pw_title", "Permintaan Reset Password") : tr("chat_access_login_title", "Permintaan Akses Masuk")}
            </h4>
            <p className="text-[10px] text-sub font-medium truncate">{tr("chat_access_subtitle", "Asisten Workspace: Asli")}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${
          isApproved
            ? (isDeleteReq ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300")
            : isRejected
            ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        }`}>
          {isApproved ? (isDeleteReq ? tr("chat_access_status_deleted", "✓ Dihapus") : isPasswordReset ? tr("chat_access_status_reset", "✓ Direset") : tr("chat_access_status_approved", "✓ Approved")) : isRejected ? tr("chat_access_status_rejected", "✕ Ditolak") : tr("chat_access_status_waiting", "⏳ Menunggu")}
        </span>
      </div>

      {/* Requester Info */}
      <div className="mt-3 space-y-2 text-xs">
        <div className="flex items-start gap-2.5 rounded-xl bg-surface2/60 p-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand font-bold text-sm">
            {req.name ? req.name.charAt(0).toUpperCase() : "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink text-sm truncate">{req.name}</p>
            <p className="text-sub truncate text-[11px]">{req.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded-lg border bg-surface2/40 px-2.5 py-1.5">
            <span className="block text-[10px] uppercase font-bold text-sub tracking-wider">{tr("chat_access_div_label", "Divisi")}</span>
            <span className="font-semibold text-ink">{req.department || tr("dash_tasks_general_label", "Umum")}</span>
          </div>
          <div className="rounded-lg border bg-surface2/40 px-2.5 py-1.5">
            <span className="block text-[10px] uppercase font-bold text-sub tracking-wider">{tr("chat_access_job_label", "Jabatan / Posisi")}</span>
            <span className="font-semibold text-ink truncate block">{req.job_title || tr("common_role_employee", "Karyawan")}</span>
          </div>
        </div>

        {req.requested_by && (
          <div className="rounded-lg border bg-surface2/30 p-2 text-[11.5px]">
            <span className="block text-[10px] uppercase font-bold text-sub tracking-wider mb-0.5">{tr("chat_access_req_by", "Diajukan oleh:")}</span>
            <p className="text-ink font-semibold">{req.requested_by}</p>
          </div>
        )}

        {req.note && req.note !== "-" && (
          <div className="rounded-lg border bg-surface2/30 p-2 text-[11.5px]">
            <span className="block text-[10px] uppercase font-bold text-sub tracking-wider mb-0.5">{tr("chat_access_note", "Alasan / Catatan:")}</span>
            <p className="text-ink/80 italic font-medium">"{req.note}"</p>
          </div>
        )}

        <p className="text-[10px] text-sub text-right pt-1">
          {tr("chat_access_submitted_prefix", "Diajukan:")} {fmtTime(req.created_at)}
        </p>
      </div>

      {/* Status or Action Buttons */}
      <div className="mt-3.5 pt-3 border-t">
        {isPending ? (
          canApprove ? (
            <div className="space-y-2">
              {!isDeleteReq && !isPasswordReset && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-[11px] text-sub font-medium">{tr("chat_access_assign_role", "Tetapkan Role:")}</span>
                  <AppSelect
                    value={assignedRole}
                    onChange={(e) => setAssignedRole(e.target.value)}
                    className="h-8 flex-1 rounded-xl border bg-surface px-2.5 text-xs font-semibold text-ink"
                    data-testid="access-role-select"
                  >
                    <option value="employee">{tr("common_role_employee", "Karyawan")}</option>
                    <option value="project_manager">{tr("common_role_project_manager", "Project Manager")}</option>
                    <option value="department_manager">Department Manager</option>
                    <option value="workspace_admin">{tr("common_role_workspace_admin", "Workspace Admin")}</option>
                  </AppSelect>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={busy}
                  onClick={handleApprove}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-xl font-bold text-xs text-white shadow-xs disabled:opacity-50 transition-colors ${isDeleteReq ? "bg-rose-600 hover:bg-rose-700" : isPasswordReset ? "bg-indigo-600 hover:bg-indigo-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
                  data-testid={`approve-access-btn-${req.id}`}
                >
                  {isDeleteReq ? tr("chat_access_approve_del", "Approve Hapus") : isPasswordReset ? tr("chat_access_approve_pw", "Approve Reset") : tr("chat_access_approve_login", "Approve Akses")}
                </button>
                <button
                  disabled={busy}
                  onClick={handleReject}
                  className="flex h-9 items-center justify-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-surface hover:bg-surface2 font-bold text-xs text-ink disabled:opacity-50 transition-colors"
                  data-testid={`reject-access-btn-${req.id}`}
                >
                  {tr("chat_reject_btn", "Tolak")}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-sub italic">
              {tr("chat_access_waiting_mgr", "Menunggu approval dari Manajer Divisi / Super Admin.")}
            </p>
          )
        ) : isApproved ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-2 text-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {isDeleteReq ? `✓ Dihapus · Approved oleh ${req.approved_by || "Manajer"}` : isPasswordReset ? `✓ Reset Password Approved oleh ${req.approved_by || "Admin"}` : `✓ Akses Approved oleh ${req.approved_by || "Admin"}`}
          </div>
        ) : (
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2 text-center text-xs font-bold text-rose-700 dark:text-rose-300">
            ✕ Permintaan Ditolak oleh {req.rejected_by || "Admin"}
          </div>
        )}
      </div>
    </div>
  );
});

const QUICK = ["👍", "❤️", "😂", "🎉", "🙏", "👀"];

function renderInline(text, userMap, isMine = false, mentionIds = []) {
  const normalized = String(text || "").replace(/^#{1,4}\s+(.+)$/gm, "**$1**");
  const { pattern: mentionPattern, resolve } = buildMentionMatcher(userMap, mentionIds);
  const allMentionPattern = "(?<![\\p{L}\\p{N}._])@semua(?![\\p{L}\\p{N}_])";
  const combinedMention = mentionPattern ? `${allMentionPattern}|${mentionPattern}` : allMentionPattern;
  const rx = new RegExp(
    `(\\*\\*[^*\\n]+\\*\\*|\`[^\`\\n]+\`|_[^_\\n]+_|(?:https?:\\/\\/|www\\.)[^\\s<>]+|${combinedMention})`,
    "giu"
  );
  const parts = normalized.split(rx);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={i} className="font-bold">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return <code key={i} className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[0.9em] font-mono">{p.slice(1, -1)}</code>;
    }
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2 && !p.includes(" ")) {
      return p;
    }
    if (p.startsWith("_") && p.endsWith("_") && p.length > 3) {
      return <em key={i} className="italic opacity-90">{p.slice(1, -1)}</em>;
    }
    if (/^(?:https?:\/\/|www\.)/i.test(p)) {
      const mUrl = p.match(/^(.*?)([.,;:!?)\]]*)$/);
      const rawUrl = mUrl?.[1] || p;
      const trailing = mUrl?.[2] || "";
      const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      return (
        <span key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={
              isMine
                ? "inline rounded bg-white/95 px-1 py-0.5 font-medium text-[#E11D48] underline hover:bg-white break-all"
                : "font-medium text-[#E11D48] dark:text-[#FF5364] underline hover:opacity-80 break-all"
            }
          >
            {rawUrl}
          </a>
          {trailing}
        </span>
      );
    }
    if (p.startsWith("@")) {
      if (p.toLowerCase() === "@semua") {
        return (
          <span
            key={i}
            className={
              isMine
                ? "rounded bg-white/25 px-1 font-bold text-white"
                : "rounded bg-soft-blue px-1 font-bold text-brand"
            }
            data-testid="mention-all"
          >
            {p}
          </span>
        );
      }
      const mentionedUser = resolve(p);
      if (mentionedUser?.user_id) {
        return (
          <Link
            key={i}
            to={`/people/${mentionedUser.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className={
              isMine
                ? "rounded bg-white/20 px-1 font-semibold text-white hover:bg-white/30 hover:underline cursor-pointer"
                : "rounded bg-soft-blue px-1 font-semibold text-brand hover:underline cursor-pointer"
            }
            title={`Lihat profil ${mentionedUser.name}`}
            data-testid={`mention-link-${mentionedUser.user_id}`}
          >
            {p}
          </Link>
        );
      }
    }
    return p;
  });
}

function renderText(text, userMap, isMine = false, mentionIds = []) {
  const str = String(text || "");
  if (!/\n\|[^\n]+\|\n\|[-:\s|]+\|/.test(str)) {
    return renderInline(str, userMap, isMine, mentionIds);
  }
  const lines = str.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (
      lines[i].trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|[\s:-]+\|/.test(lines[i + 1].trim())
    ) {
      const parseRow = (ln) => ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const headers = parseRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={`tbl_${i}`} className="my-2 overflow-x-auto rounded-xl border border-subtle bg-surface2/50">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-subtle bg-surface2 font-bold text-ink">
                {headers.map((h, hi) => <th key={hi} className="px-2.5 py-1.5 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-subtle/50 last:border-0">
                  {r.map((cell, ci) => <td key={ci} className="px-2.5 py-1.5 whitespace-nowrap">{renderInline(cell, userMap, isMine, mentionIds)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    const textChunk = [];
    while (
      i < lines.length &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1].trim()))
    ) {
      textChunk.push(lines[i]);
      i++;
    }
    blocks.push(<span key={`txt_${i}`}>{renderInline(textChunk.join("\n"), userMap, isMine, mentionIds)}{i < lines.length ? "\n" : ""}</span>);
  }
  return blocks;
}

function MessageEmojiPicker({ onReact, messageId, isMine }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTimer();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setOpen(false);
    }, 280);
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-sub hover:bg-surface2 hover:text-ink transition-colors"
        aria-label="Pilih emoji reaksi"
        data-testid={`message-react-btn-${messageId}`}
      >
        <Smile size={15} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Pilihan emoji"
          className={`absolute bottom-full mb-1.5 z-40 flex items-center gap-1 rounded-full border border-subtle bg-surface p-1 shadow-xl animate-in fade-in zoom-in-95 duration-120 ${
            isMine ? "right-0" : "left-0"
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {QUICK.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e);
                setOpen(false);
              }}
              className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-base sm:text-lg transition-transform duration-150 hover:scale-125 hover:bg-surface2 active:scale-95"
              title={`Reaksi ${e}`}
              data-testid={`react-hover-${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageItem({ m, mine, grouped, conv, onReply, onCreateTask, readBy }) {
  const { userMap, me, t: tr } = useApp();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.text);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [localReactions, setLocalReactions] = useState(m.reactions || {});
  useEffect(() => {
    setLocalReactions(m.reactions || {});
  }, [m.reactions]);
  const senderId = m.sender_id || m.user_id;
  const isMine = Boolean(mine || (me?.user_id && senderId === me.user_id));
  const sender = userMap[senderId] || (isMine ? me : null);
  const act = (fn, sfx) => async () => {
    try {
      await fn();
      if (sfx) playSound(sfx);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const react = async (emoji) => {
    playSound("pop");
    const uid = me?.user_id;
    const prev = localReactions;
    if (uid) {
      setLocalReactions((curr) => {
        const next = { ...(curr || {}) };
        const arr = Array.isArray(next[emoji]) ? next[emoji] : [];
        if (arr.includes(uid)) {
          const filtered = arr.filter((id) => id !== uid);
          if (filtered.length > 0) next[emoji] = filtered;
          else delete next[emoji];
        } else {
          next[emoji] = [...arr, uid];
        }
        return next;
      });
    }
    try {
      const { data } = await api.post(`/messages/${m.id}/react`, { emoji });
      if (data?.reactions) setLocalReactions(data.reactions);
    } catch (e) {
      setLocalReactions(prev);
      toast.error(errMsg(e));
    }
  };
  const save = act(async () => { await api.patch(`/messages/${m.id}`, { text: val }); setEditing(false); }, "success");

  const bubble = isMine ? "bg-brand text-white rounded-br-md shadow-xs" : "bg-surface border border-slate-200/80 dark:border-slate-700 text-ink rounded-bl-md shadow-xs";
  const images = (m.attachments || []).filter((a) => a.content_type?.startsWith("image/") || (!a.content_type && /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name || "")));
  const docs = (m.attachments || []).filter((a) => !images.includes(a));
  const isPoll = m.type === "poll" || Boolean(m.poll_id || m.poll);
  const isStickyNote = m.type === "sticky_note" || Boolean(m.sticky_note);
  const plain = m.type === "sticker" || isPoll || isStickyNote || m.type === "task" || m.type === "approval_card" || m.type === "access_request_card";
  const renderedBody = useMemo(
    () => (m.text && !isPoll && !isStickyNote && m.type !== "access_request_card"
      ? renderText(m.text, userMap, isMine, m.mention_ids)
      : null),
    [m.text, m.type, isPoll, isStickyNote, userMap, isMine, m.mention_ids]
  );
  return (
    <div className={`group flex w-full gap-2 sm:gap-2.5 ${isMine ? "flex-row-reverse justify-start" : "flex-row justify-start"} ${grouped ? "mt-0.5" : "mt-3.5 sm:mt-4"}`} data-testid={`message-${m.id}`}>
      {!isMine && (
        <div className="w-7 sm:w-8 shrink-0">
          {!grouped && senderId && <Link to={`/people/${senderId}`} className="block w-fit rounded-full"><Avatar user={sender} size={28} /></Link>}
        </div>
      )}
      <div className={`flex min-w-0 max-w-[86%] sm:max-w-[70%] flex-col ${isMine ? "items-end" : "items-start"}`}>
        {!grouped && (
          <p className={`mb-1 px-1 text-[11px] text-sub ${isMine ? "text-right" : "text-left"}`}>
            {isMine ? (
              <b className="inline-flex items-center gap-1 font-semibold text-ink">
                <span>{tr("beranda_you_label", "Anda")}</span>
              </b>
            ) : (
              <Link to={`/people/${senderId}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:underline">
                <span>{sender?.name || tr("chat_msg_member_fallback", "Anggota")}</span>
                <VerifiedBadge user={sender} size={12} />
              </Link>
            )} · {fmtTime(m.created_at)}
            {m.pinned && <Pin size={10} className="ml-1 inline text-brand" />}
          </p>
        )}
        {m.reply_to && <div className={`mb-1 max-w-full truncate rounded-xl border-l-4 border-[var(--c-accent)] bg-surface2 px-2.5 py-1 text-xs text-sub`}>{userMap[m.reply_to.sender_id]?.name}: {m.reply_to.text}</div>}
        <div className="flex items-center gap-1">
          <div className={`min-w-0 ${isMine ? "order-2" : ""}`}>
            {m.deleted ? <div className="rounded-2xl border border-dashed px-3 py-2 text-sm italic text-sub">{tr("chat_msg_deleted", "Pesan telah dihapus")}</div> : (<>
              {m.type === "sticker" && m.sticker && <StickerTile s={m.sticker} size={120} />}
              {isPoll && <PollCard pollId={m.poll_id || m.poll?.id} poll={m.poll} />}
              {isStickyNote && m.sticky_note && <StickyNoteMessageCard m={m} />}
              {(m.type === "task" || m.type === "approval_card") && m.task && <TaskPreview m={m} />}
              {m.type === "access_request_card" && (m.access_request || m.data) && <AccessRequestCard m={m} />}
              {(m.text && !isPoll && !isStickyNote && m.type !== "access_request_card") && (editing ? (
                <div className="flex flex-col gap-1"><textarea value={val} onChange={(e) => setVal(e.target.value)} className="w-72 max-w-full rounded-xl border bg-surface p-2 text-sm text-ink" data-testid="edit-message-input" />
                  <div className="flex gap-2 text-xs"><button onClick={save} className="font-semibold text-brand" data-testid="save-edit-btn">{tr("chat_msg_save_edit", "Simpan")}</button><button onClick={() => setEditing(false)} className="text-sub">{tr("chat_msg_cancel_edit", "Batal")}</button></div></div>
              ) : <div className={`${plain ? "mt-1 text-sm" : `rounded-2xl px-3.5 py-2 text-[14.5px] leading-relaxed ${bubble}`} whitespace-pre-wrap break-words`}>{renderedBody}{m.edited && <span className="ml-1 text-[10px] opacity-70">{tr("chat_msg_edited", "· diedit")}</span>}</div>)}
              {images.length > 0 && (
                <div className={`mt-1 grid gap-1.5 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {images.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setLightboxImg(a)}
                      className="group/img relative overflow-hidden rounded-xl border text-left focus:outline-none cursor-zoom-in"
                      data-testid={`message-image-${a.id}`}
                    >
                      <img
                        src={fileUrl(a.id)}
                        alt={a.name || "Photo"}
                        loading="lazy"
                        decoding="async"
                        className={`${images.length > 1 ? "h-32 w-32 sm:h-44 sm:w-44" : "max-h-72 w-auto max-w-[min(260px,calc(100vw-7rem))] sm:max-w-[340px]"} rounded-xl object-cover transition-transform duration-200 group-hover/img:scale-[1.02]`}
                      />
                    </button>
                  ))}
                </div>
              )}
              {docs.map((a) => <a key={a.id} href={fileUrl(a.id)} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-sm text-ink max-w-full" data-testid={`message-file-${a.id}`}><FileText size={16} className="text-brand shrink-0" /><span className="max-w-[160px] sm:max-w-[200px] truncate">{a.name}</span><span className="text-[10px] text-sub shrink-0">{Math.ceil((a.size || 1024) / 1024)} KB</span></a>)}
            </>)}
          </div>
          {!m.deleted && !editing && (
            <div className={`flex flex-col sm:flex-row items-center gap-0.5 opacity-100 md:opacity-0 transition-opacity group-hover:opacity-100 ${isMine ? "order-1" : ""}`}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-sub hover:bg-surface2" aria-label="Opsi pesan" data-testid={`message-actions-${m.id}`}><MoreHorizontal size={15} /></button></DropdownMenuTrigger>
                <DropdownMenuContent align={isMine ? "end" : "start"} className="bg-surface">
                  <div className="flex gap-0.5 p-1">{QUICK.map((e) => <DropdownMenuItem key={e} onClick={() => react(e)} className="h-8 w-8 justify-center rounded-lg p-0 text-lg" data-testid={`react-${e}`}>{e}</DropdownMenuItem>)}</div>
                  <DropdownMenuItem onClick={() => onReply(m)} data-testid="action-reply"><Reply size={14} className="mr-2" />{tr("chat_msg_action_reply", "Balas")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={act(() => api.post(`/messages/${m.id}/pin`), "pop")} data-testid="action-pin"><Pin size={14} className="mr-2" />{m.pinned ? tr("chat_msg_action_unpin", "Lepas Sematan") : tr("chat_msg_action_pin", "Sematkan")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCreateTask(m)} data-testid="action-create-task"><CheckSquare size={14} className="mr-2" />{tr("chat_msg_action_task", "Buat Tugas")}</DropdownMenuItem>
                  {isMine && m.type === "text" && <DropdownMenuItem onClick={() => setEditing(true)} data-testid="action-edit"><Pencil size={14} className="mr-2" />{tr("chat_msg_action_edit", "Ubah")}</DropdownMenuItem>}
                  {(isMine || conv?.admin_ids?.includes(me?.user_id) || conv?.type === "dm" || conv?.type === "group_message") && <DropdownMenuItem onClick={act(() => api.delete(`/messages/${m.id}`), "trash")} className="text-rose-600" data-testid="action-delete"><Trash2 size={14} className="mr-2" />{tr("chat_msg_action_delete", "Hapus")}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              <MessageEmojiPicker onReact={react} messageId={m.id} isMine={isMine} />
            </div>
          )}
        </div>
        {Object.keys(localReactions || {}).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">{Object.entries(localReactions).map(([e, us]) => <button key={e} onClick={() => react(e)} title={us.map((u) => userMap[u]?.name).join(", ")} className={`rounded-full border px-2 py-0.5 text-xs ${us.includes(me?.user_id) ? "border-[var(--c-accent)] bg-soft-red" : "bg-surface"}`} data-testid={`reaction-${e}`}>{e} {us.length}</button>)}</div>
        )}
        {isMine && readBy !== undefined && (
          <span
            className={`mt-0.5 flex items-center gap-0.5 text-[10px] transition-colors ${
              readBy > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-sub"
            }`}
            data-testid="read-receipt"
          >
            {readBy > 0 ? (
              <>
                <CheckCheck size={12} className="text-emerald-500 dark:text-emerald-400" />
                {tr("chat_msg_sent_label", "Terkirim")} · {tr("chat_msg_read_label", "Dibaca")}
                {conv.type === "group" ? ` ${tr("chat_msg_read_by_prefix", "oleh")} ${readBy}` : ""}
              </>
            ) : (
              <>
                <Check size={12} />
                {tr("chat_msg_sent_label", "Terkirim")}
              </>
            )}
          </span>
        )}
      </div>
      <ImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
    </div>
  );
}

export default memo(MessageItem);
