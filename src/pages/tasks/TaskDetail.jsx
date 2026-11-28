import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Share2, Paperclip, CheckCircle2, RotateCcw, Send, MessageSquare, History, Link2, X, Printer } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { DatePicker, DateTimePicker } from "../../components/ui/date-picker";
import { Avatar, Spinner, fmtDate, rel, dueInfo, getTaskCompliance, getTaskComplianceDetail } from "../../components/common";
import RichEditor, { RichView } from "../../components/RichEditor";
import { inp, UserSelect, MultiUserSelect, PrioritySelect, LabelPicker, ItemPicker, ColorPicker, AttachmentList, useUploader, ListEditor } from "./fields";
import { getBoardAssigneeScope } from "./boardScope";
import { AppSelect, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { toDeadline } from "./TaskCreate";
import Checkpoints, { CommentItem, CommentMentionInput, extractCommentMentions } from "./Checkpoints";
import { playSound } from "../../lib/sound";
import { INITIAL_TASKS } from "../../data/initialTasks";
import PrintPreviewDialog from "../../components/PrintPreviewDialog";
import { tryNativePrint } from "../../lib/printReport";
import { humanizeLogAction, resolveActorName, resolveRawUserTokens } from "../../lib/logHumanizer";

function Row({ label, children }) {
  return <div className="grid w-full min-w-0 items-center gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3"><span className="text-xs font-semibold text-sub">{label}</span><div className="min-w-0 w-full max-w-full">{children}</div></div>;
}

function Comments({ t, reload }) {
  const { users, userMap, me, t: tr } = useApp();
  const [text, setText] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    const ids = extractCommentMentions(text, mentionIds, users);
    setBusy(true);
    try {
      await api.post(`/tasks/${t.id}/comments`, { text, mention_ids: ids });
      const notifiedNames = ids
        .filter((uid) => uid !== me?.user_id)
        .map((uid) => userMap?.[uid]?.name)
        .filter(Boolean);
      if (notifiedNames.length > 0) {
        toast.success(`${tr("task_comment_sent_notif_prefix", "Komentar terkirim · Notifikasi dikirim ke")} ${notifiedNames.join(", ")}`);
      }
      setText("");
      setMentionIds([]);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="task-comments">
      {(t.comments || []).map((c) => <CommentItem key={c.id} c={c} t={t} reload={reload} showCheckpoint />)}
      <CommentMentionInput
        value={text}
        onChange={setText}
        mentionIds={mentionIds}
        onMentionIdsChange={setMentionIds}
        onSubmit={send}
        placeholder={tr("task_comment_ph", "Tulis komentar… ketik @Nama untuk menyebut rekan")}
        testid="task-comment-input"
        rightSlot={
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="btn-accent flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 cursor-pointer"
            aria-label={tr("task_comment_send_label", "Kirim komentar")}
            data-testid="task-comment-submit"
          >
            <Send size={16} />
          </button>
        }
      />
    </div>
  );
}

const TASK_DETAIL_MEM_CACHE = new Map();
let BOARDS_MEM_CACHE = null;

const getInitialBoards = (propBoards) => {
  if (Array.isArray(propBoards) && propBoards.length > 0) {
    BOARDS_MEM_CACHE = propBoards;
    return propBoards;
  }
  if (Array.isArray(BOARDS_MEM_CACHE) && BOARDS_MEM_CACHE.length > 0) return BOARDS_MEM_CACHE;
  try {
    const saved = localStorage.getItem("circle_boards_cache");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        BOARDS_MEM_CACHE = parsed;
        return parsed;
      }
    }
  } catch {}
  return [];
};

const resolveTaskSync = (id, initialTask, ctxTasks) => {
  if (!id) return null;
  const cachedDetail = TASK_DETAIL_MEM_CACHE.get(id);
  const fromCtx = Array.isArray(ctxTasks) ? ctxTasks.find((x) => x && x.id === id) : null;
  if (initialTask && initialTask.id === id) {
    if (cachedDetail && cachedDetail.updated_at === initialTask.updated_at) return cachedDetail;
    return cachedDetail && (!initialTask.updated_at || (cachedDetail.updated_at || "") >= (initialTask.updated_at || ""))
      ? { ...initialTask, ...cachedDetail }
      : initialTask;
  }
  if (fromCtx) {
    if (cachedDetail && (!fromCtx.updated_at || (cachedDetail.updated_at || "") >= (fromCtx.updated_at || ""))) {
      return { ...fromCtx, ...cachedDetail };
    }
    return fromCtx;
  }
  if (cachedDetail) return cachedDetail;
  try {
    const c1 = localStorage.getItem("circle_tasks_cache") || localStorage.getItem("circle_cache_tasks");
    if (c1) {
      const arr = JSON.parse(c1);
      const found = Array.isArray(arr) && arr.find((x) => x && x.id === id);
      if (found) return found;
    }
  } catch {}
  return INITIAL_TASKS.find((x) => x.id === id) || null;
};

const isSameTaskDetail = (a, b) => {
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.updated_at === b.updated_at &&
    a.status === b.status &&
    a.title === b.title &&
    (a.description || "") === (b.description || "") &&
    (a.comments?.length || 0) === (b.comments?.length || 0) &&
    (a.activity?.length || 0) === (b.activity?.length || 0) &&
    (a.checkpoints?.length || 0) === (b.checkpoints?.length || 0) &&
    JSON.stringify(a.assignee_ids || []) === JSON.stringify(b.assignee_ids || []) &&
    JSON.stringify(a.pending_assignees || []) === JSON.stringify(b.pending_assignees || []) &&
    Boolean(a.board) === Boolean(b.board)
  );
};

export default function TaskDetail({ id, initialTask = null, boards: propBoards = null, onClose, onChanged }) {
  const { me, statuses: wsStatuses, allStatuses, getStatusesForDivision, userMap, labelMap, tasks: ctxTasks, isManager, subscribe, t: tr } = useApp();
  const syncResolvedTask = id ? resolveTaskSync(id, initialTask, ctxTasks) : null;
  const [tState, setTState] = useState(() => syncResolvedTask);
  const [boards, setBoards] = useState(() => getInitialBoards(propBoards));
  const [tab, setTab] = useState("comments");
  const [groups, setGroups] = useState(null);
  const [approving, setApproving] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const navigate = useNavigate();

  // Always prefer up-to-date matching state for `id`, or immediate in-memory task on first render frame
  const t = !id
    ? null
    : tState && tState.id === id
    ? tState
    : syncResolvedTask || {
        id,
        number_str: "TSK",
        title: "Detail Tugas",
        status: "todo",
        priority: "medium",
        checkpoints: [],
        comments: [],
        activity: []
      };

  const taskDivision = t?.department || boards.find((b) => b.id === t?.board_id)?.department || "";
  const statuses = getStatusesForDivision ? getStatusesForDivision(taskDivision) : wsStatuses;

  const setT = (updater) => {
    setTState((prev) => {
      const base = prev && prev.id === id ? prev : syncResolvedTask;
      const next = typeof updater === "function" ? updater(base) : updater;
      if (next && next.id) TASK_DETAIL_MEM_CACHE.set(next.id, next);
      return next;
    });
  };

  useEffect(() => {
    if (Array.isArray(propBoards) && propBoards.length > 0) {
      BOARDS_MEM_CACHE = propBoards;
      setBoards(propBoards);
    }
  }, [propBoards]);

  const load = () => {
    if (!id) return;
    api.get(`/tasks/${id}`)
      .then((r) => {
        if (r.data) {
          TASK_DETAIL_MEM_CACHE.set(id, r.data);
          setTState((prev) => {
            const current = prev && prev.id === id ? prev : syncResolvedTask;
            if (isSameTaskDetail(current, r.data)) return current;
            return r.data;
          });
        }
      })
      .catch(() => {});
  };
  useEffect(() => {
    if (id) {
      setTab("comments");
      setGroups(null);
      if (syncResolvedTask) {
        setTState((prev) => (prev && prev.id === id && (prev.updated_at || "") >= (syncResolvedTask.updated_at || "") ? prev : syncResolvedTask));
      } else {
        setTState(null);
      }
      load();
      if ((!propBoards || propBoards.length === 0) && (!BOARDS_MEM_CACHE || BOARDS_MEM_CACHE.length === 0)) {
        api.get("/boards").then((r) => {
          if (Array.isArray(r.data)) {
            BOARDS_MEM_CACHE = r.data;
            setBoards(r.data);
            try { localStorage.setItem("circle_boards_cache", JSON.stringify(r.data)); } catch {}
          }
        }).catch(() => {});
      }
    } else {
      setTState(null);
    }
  }, [id]); // eslint-disable-line

  useEffect(() => {
    if (!id || !subscribe) return;
    return subscribe((e) => {
      if (e.type === "tasks:changed" && e.task?.id === id) {
        setT((prev) => ({ ...(prev || {}), ...e.task }));
      }
    });
  }, [id, subscribe]);

  const patch = async (body, msg) => {
    const involvesAssigneeChange =
      body.assignee_ids !== undefined || body.assignee_id !== undefined || body.checkpoints !== undefined;
    if (!involvesAssigneeChange) {
      setT((prev) => (prev ? { ...prev, ...body, updated_at: new Date().toISOString() } : prev));
    }
    try {
      const { data } = await api.patch(`/tasks/${id}`, body);
      setT(data);
      if (body.status === "done" || statuses.find((s) => s.key === body.status)?.is_done) {
        playSound("task_done");
      } else {
        playSound("click");
      }
      onChanged?.(data);
      const invited = Array.isArray(data?.newly_invited_assignees) ? data.newly_invited_assignees : [];
      if (invited.length > 0) {
        const names = invited.map((x) => x.name).filter(Boolean).join(", ");
        toast.info(`Konfirmasi penugasan telah dikirim melalui pesan langsung ke ${names}. Nama PIC akan aktif setelah disetujui.`);
      } else if (msg) {
        toast.success(msg);
      }
    } catch (e) {
      toast.error(errMsg(e));
      load();
    }
  };

  const cancelPendingInvite = async (targetUid, targetName) => {
    try {
      const { data } = await api.delete(`/tasks/${id}/pending-assignees/${encodeURIComponent(targetUid)}`);
      if (data?.task) {
        setT(data.task);
        onChanged?.(data.task);
      }
      toast.info(`Undangan penugasan ke ${targetName || "anggota"} dibatalkan.`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal membatalkan undangan"));
    }
  };
  const setAtt = (fn) => patch({ attachments: fn(t.attachments) });
  const { pick, input } = useUploader(setAtt);
  const share = async (cid) => {
    try {
      const { data } = await api.post(`/tasks/${id}/share`, { conversation_id: cid });
      const updatedTask = data?.task;
      if (updatedTask?.id) {
        setT((prev) => ({ ...(prev || {}), ...updatedTask }));
        onChanged?.(updatedTask);
      }
      toast.success(
        updatedTask?.status === "done"
          ? tr("task_share_sent_done_toast", "Preview tugas (Done) dikirim ke grup")
          : tr("task_share_sent_toast", "Preview dikirim ke grup dan status diubah ke In Review")
      );
      setGroups(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const done = statuses.find((s) => s.key === t?.status)?.is_done;
  const ro = t ? t.can_edit === false : false;
  const d = t && dueInfo(t.deadline, done);
  const reqIds = t?.requestor_ids && t.requestor_ids.length ? t.requestor_ids : (t?.requestor_id ? [t.requestor_id] : (t?.created_by ? [t.created_by] : []));
  const revIds = t?.reviewer_ids && t.reviewer_ids.length ? t.reviewer_ids : reqIds;
  const reviewer = t && me?.user_id && (revIds.includes(me.user_id) || reqIds.includes(me.user_id));

  const approvalObj = t?.approvals || t?.approval || {
    needed: 2,
    approved_by: [],
    status: done ? "approved" : "pending",
  };
  const approvedList = Array.isArray(approvalObj.approved_by) ? approvalObj.approved_by : [];
  const approvedCount = approvedList.length;
  const isApprovedFull = approvedCount >= 2 || approvalObj.status === "approved" || Boolean(done && approvedCount > 0);
  const approvalProgressPct = isApprovedFull ? 100 : approvedCount === 1 ? 50 : 0;
  const alreadyApprovedByMe = Boolean(me?.user_id && approvedList.includes(me.user_id));

  const cachedBoardObj = boards.find((b) => b.id === t?.board_id) || null;
  const activeBoardObj = t?.board
    ? { ...(cachedBoardObj || {}), ...t.board }
    : cachedBoardObj;
  const assigneeScope = getBoardAssigneeScope({
    board: activeBoardObj,
    boards,
    boardId: t?.board_id || "",
    projectId: t?.project_id || "",
    department: t?.department || "",
    users: Object.values(userMap || {})
  });
  const members = assigneeScope.ids;

  const handleReviseRedirectToChat = async () => {
    try {
      await api.post(`/tasks/${id}/approval`, { decision: "revise", note: "" });
    } catch (err) {
      toast.error(errMsg(err));
    }
    let targetCid = t?.conversation_id || "";
    if (!targetCid) {
      try {
        const { data: convs } = await api.get("/conversations");
        const list = Array.isArray(convs) ? convs : [];
        const deptName = String(activeBoardObj?.department || t?.department || "").trim().toLowerCase();
        const deptGroup = deptName && list.find((c) => c.type === "group" && String(c.name || "").trim().toLowerCase() === deptName);
        const anyGroup = list.find((c) => c.type === "group");
        const primaryAssignee = t?.assignee_id || t?.assignee_ids?.[0];
        const dmWithAssignee = primaryAssignee && list.find((c) => c.type === "dm" && Array.isArray(c.member_ids) && c.member_ids.includes(primaryAssignee));
        targetCid = deptGroup?.id || dmWithAssignee?.id || anyGroup?.id || "";
      } catch {}
    }
    toast.info(tr("task_revise_redirect_toast", "Mengarahkan ke chat untuk mengirim catatan revisi"));
    onChanged?.();
    onClose?.();
    const qs = new URLSearchParams({
      reviseTask: id || "",
      taskNum: t?.number_str || "",
      taskTitle: t?.title || ""
    }).toString();
    if (targetCid) {
      navigate(`/messages/${targetCid}?${qs}`);
    } else {
      navigate(`/messages?${qs}`);
    }
  };

  const handleApproveTask = async () => {
    if (approving) return;
    setApproving(true);
    try {
      const res = await api.post(`/tasks/${id}/approval`, { decision: "approve" });
      const updatedTask = res.data?.task || res.data;
      const nextApproved =
        res.data?.approvals?.approved_by ||
        updatedTask?.approvals?.approved_by ||
        updatedTask?.approval?.approved_by ||
        [];
      if (updatedTask && updatedTask.id) {
        setT((prev) => ({ ...(prev || {}), ...updatedTask }));
      }
      if (updatedTask?.status === "done" || nextApproved.length >= 2) {
        playSound("task_done");
        toast.success(tr("task_approved_full_toast", "Tugas di-approve 2/2 (100%) dan otomatis dipindah ke Done!"));
      } else {
        playSound("click");
        toast.success(tr("task_approved_half_toast", "Approved 1/2 (50%). Menunggu 1 approval lagi."));
      }
      load();
      onChanged?.(updatedTask);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setApproving(false);
    }
  };

  return (
    <>
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent instant className="w-full max-w-full overflow-y-auto overflow-x-hidden bg-surface p-0 sm:max-w-3xl print:max-w-none print:static print:shadow-none print:border-0" data-testid="task-detail-panel">
        <SheetHeader className="flex flex-row items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
          <SheetTitle className="text-base font-bold">{tr("task_detail_title", "Detail Tugas")}</SheetTitle>
          <div className="flex items-center gap-1 print:hidden">
            <button
              type="button"
              onClick={() => {
                if (!tryNativePrint()) {
                  setPrintPreviewOpen(true);
                }
              }}
              className="flex h-9 sm:h-10 items-center gap-2 rounded-full border px-3 sm:px-4 text-sm font-semibold text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
              title={tr("task_detail_print_title", "Cetak Detail Tugas")}
              data-testid="task-detail-print-btn"
            >
              <Printer size={16} />
              <span className="hidden sm:inline">{tr("task_detail_print_btn", "Cetak / PDF")}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
              aria-label={tr("task_detail_close_label", "Tutup detail")}
              data-testid="task-detail-close-btn"
            >
              <X size={18} />
            </button>
          </div>
        </SheetHeader>
        {!t ? <Spinner /> : (
          <div className="animate-task-reveal w-full max-w-full min-w-0 overflow-x-hidden pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            <div className="h-2" style={{ background: t.card_color || "transparent" }} />
            <div className="w-full max-w-full min-w-0 space-y-4 sm:space-y-5 p-4 sm:p-6 overflow-x-hidden">
              <div>
                <p className="text-xs font-semibold text-sub" data-testid="task-detail-id">{t.number_str}{t.archived && ` · ${tr("task_detail_archived_tag", "Diarsipkan")}`}{done && t.completed_at && <span className="text-emerald-600"> · {tr("task_detail_done_prefix", "Selesai")} {fmtDate(t.completed_at, "d MMM yyyy HH:mm")} {tr("task_detail_by_prefix", "oleh")} {userMap[t.completed_by]?.name}</span>}</p>
                <input defaultValue={t.title} key={t.updated_at} disabled={ro} onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && patch({ title: e.target.value })} className="mt-1 w-full bg-transparent text-xl sm:text-2xl font-bold outline-none" data-testid="task-detail-title" />
              </div>
              {ro ? (
                t.description ? <RichView html={t.description} className="rounded-2xl bg-surface2 p-4" /> : null
              ) : (
                <RichEditor
                  key={`desc-${t.id}`}
                  value={t.description || ""}
                  onBlur={(html) => {
                    if (html !== (t.description || "")) {
                      patch({ description: html });
                    }
                  }}
                  testid="task-detail-editor"
                />
              )}
              
              {/* Approval status banner */}
              {(t.status === "in_review" || approvedCount > 0) && (
                <div
                  className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 transition-colors ${
                    isApprovedFull
                      ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                      : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-800"
                  }`}
                  data-testid="review-actions"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`text-xs sm:text-sm font-bold ${
                        isApprovedFull
                          ? "text-emerald-800 dark:text-emerald-200"
                          : "text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      {isApprovedFull ? tr("task_approval_done_banner", "✓ Approved 100% · Status: Done") : tr("task_approval_waiting_banner", "Menunggu Approval")}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] sm:text-xs font-bold whitespace-nowrap shrink-0 ${
                        isApprovedFull
                          ? "bg-emerald-200/70 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200"
                          : "bg-amber-200/60 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      {isApprovedFull
                        ? `${approvedCount >= 2 ? `${approvedCount}/2` : "2/2"} ${tr("task_approval_approved_suffix", "Approved")}`
                        : `${approvedCount}/2 ${tr("task_approval_approved_suffix", "Approved")}`}
                    </span>
                  </div>
                  <div
                    className={`h-2.5 w-full overflow-hidden rounded-full ${
                      isApprovedFull ? "bg-emerald-200/50 dark:bg-emerald-950" : "bg-amber-200/50 dark:bg-amber-950"
                    }`}
                  >
                    <div
                      className={`h-full transition-all duration-500 ${
                        isApprovedFull ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      style={{ width: `${approvalProgressPct}%` }}
                      data-testid="review-approval-progress-bar"
                    />
                  </div>
                  {approvedList.length > 0 && (
                    <div
                      className={`flex flex-wrap items-center gap-1.5 text-xs ${
                        isApprovedFull
                          ? "text-emerald-800 dark:text-emerald-300"
                          : "text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      <span>{tr("task_approval_approved_by", "Telah di-approve oleh:")}</span>
                      <b>{approvedList.map((uid) => userMap[uid]?.name?.split(" ")[0] || uid).join(", ")}</b>
                    </div>
                  )}
                  {!isApprovedFull ? (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleReviseRedirectToChat}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-surface px-4 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:bg-surface2 cursor-pointer"
                        data-testid="request-revision-btn"
                      >
                        <RotateCcw size={14} /> {tr("task_approval_revise_btn", "Revisi")}
                      </button>
                      <button
                        type="button"
                        disabled={approving || alreadyApprovedByMe}
                        onClick={handleApproveTask}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
                        data-testid="approve-task-btn"
                      >
                        <CheckCircle2 size={14} />
                        {approving ? tr("task_approval_processing", "Memproses…") : alreadyApprovedByMe ? tr("task_approval_already_btn", "Sudah Approve ✓") : tr("task_approval_approve_btn", "Approve")}
                      </button>
                    </div>
                  ) : (
                    !alreadyApprovedByMe && (
                      <div className="pt-1">
                        <button
                          type="button"
                          disabled={approving}
                          onClick={handleApproveTask}
                          className="w-full h-9 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50 transition-colors cursor-pointer"
                          data-testid="approve-task-more-btn"
                        >
                          {tr("task_approval_more_prefix", "+ Approve Juga")} ({approvedCount} {tr("task_approval_more_suffix", "sudah approve")})
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}


              <div className="space-y-3">
                <Row label={tr("task_field_status", "Status")}>
                  <div className="space-y-1.5 w-full">
                    <Select
                      value={t.status}
                      disabled={ro || approvedCount >= 2}
                      onValueChange={(val) => {
                        const targetDone = val === "done" || statuses.find((s) => s.key === val)?.is_done;
                        if (approvedCount >= 2 && !targetDone) {
                          toast.error("Tugas sudah 2/2 Approved (100%) dan terkunci saklek di Done.");
                          return;
                        }
                        patch({ status: val });
                      }}
                    >
                      <SelectTrigger className="w-full" data-testid="task-detail-status">
                        <SelectValue placeholder={tr("task_status_ph", "Pilih status...")} />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s.key} value={s.key} data-testid={`status-option-${s.key}`}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {approvedCount >= 2 && (
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400" data-testid="task-detail-status-locked">
                        ✓ Terkunci saklek di Done (2/2 Approved · 100%)
                      </p>
                    )}
                    {(() => {
                      const comp = getTaskCompliance(t);
                      const detail = getTaskComplianceDetail(t);
                      if (!comp) return null;
                      const compLabel = comp === "On time"
                        ? tr("compliance_on_time", "On time")
                        : comp === "Overdue"
                        ? tr("compliance_late", "Overdue")
                        : tr("compliance_in_progress", comp);
                      return (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            comp === "On time"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : comp === "Overdue"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${comp === "On time" ? "bg-emerald-500" : comp === "Overdue" ? "bg-rose-500" : "bg-amber-500"}`} />
                            {compLabel}
                          </span>
                          <span className="text-[11px] text-sub truncate">{detail}</span>
                        </div>
                      );
                    })()}
                  </div>
                </Row>

                {/* Multi Requestor */}
                <Row label={tr("task_field_requestor", "Requestor")}>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reqIds.map((uid) => (
                        <span key={uid} className="inline-flex items-center gap-1.5 rounded-full border bg-surface2 px-2.5 py-1 text-xs font-semibold">
                          <Avatar user={userMap[uid]} size={18} showStatus={false} />
                          {userMap[uid]?.name || tr("task_user_fallback", "Pengguna")}
                          {!ro && reqIds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = reqIds.filter((x) => x !== uid);
                                patch({ requestor_ids: next, reviewer_ids: next }, tr("task_requestor_updated", "Requestor diperbarui"));
                              }}
                              className="ml-0.5 text-slate-400 hover:text-rose-500"
                              title={tr("task_requestor_remove_title", "Hapus requestor")}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {!ro && (
                        <AppSelect
                          value=""
                          onChange={(e) => {
                            if (e.target.value && !reqIds.includes(e.target.value)) {
                              const next = [...reqIds, e.target.value];
                              patch({ requestor_ids: next, reviewer_ids: next }, tr("task_requestor_added", "Requestor ditambah"));
                            }
                          }}
                          className="h-8 rounded-xl border border-border bg-surface2/75 px-2.5 text-xs font-semibold"
                        >
                          <option value="">{tr("task_requestor_add_opt", "+ Tambah Requestor")}</option>
                          {Object.values(userMap || {})
                            .filter((u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant" && members.includes(u.user_id) && !reqIds.includes(u.user_id))
                            .map((u) => (
                              <option key={u.user_id} value={u.user_id}>{u.name}</option>
                            ))}
                        </AppSelect>
                      )}
                    </div>
                  </div>
                </Row>

                <Row label={tr("task_field_assignee", "Assignee")}>
                  <div className="space-y-1.5">
                    <MultiUserSelect
                      value={t.assignee_ids && t.assignee_ids.length ? t.assignee_ids : (t.assignee_id ? [t.assignee_id] : [])}
                      ids={members}
                      scopeLabel={assigneeScope.scopeLabel}
                      emptyMessage={assigneeScope.emptyMessage}
                      onChange={(ids) => {
                        const nextIds = Array.isArray(ids) ? ids : [];
                        const nextPrimary = nextIds[0] || null;
                        const prevPrimary = t.assignee_ids?.[0] || t.assignee_id || null;
                        const patchBody = {
                          assignee_ids: nextIds,
                          assignee_id: nextPrimary
                        };
                        if (Array.isArray(t.checkpoints) && t.checkpoints.length > 0 && nextPrimary) {
                          patchBody.checkpoints = t.checkpoints.map((c) => {
                            if (!c || c.unassigned) return c;
                            if (!c.assignee_id || (prevPrimary && c.assignee_id === prevPrimary && !nextIds.includes(prevPrimary))) {
                              return { ...c, assignee_id: nextPrimary };
                            }
                            return c;
                          });
                        }
                        patch(patchBody);
                      }}
                      testid="task-detail-assignee"
                    />
                    {(() => {
                      const pendingInvites = (Array.isArray(t.pending_assignees) ? t.pending_assignees : []).filter(
                        (p) => p && p.status === "pending"
                      );
                      if (pendingInvites.length === 0) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="task-detail-pending-assignees">
                          <span className="font-semibold">Menunggu konfirmasi penugasan:</span>
                          {pendingInvites.map((inv) => {
                            const nm = userMap?.[inv.user_id]?.name || inv.name || "Anggota";
                            return (
                              <span
                                key={inv.id || inv.user_id}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/35 px-2 py-0.5 font-medium"
                              >
                                <span className="max-w-[140px] truncate">{nm}</span>
                                {!ro && (
                                  <button
                                    type="button"
                                    onClick={() => cancelPendingInvite(inv.user_id, nm)}
                                    title="Batalkan undangan penugasan"
                                    className="rounded-full p-0.5 text-amber-700/70 hover:bg-amber-200/60 hover:text-amber-900 dark:text-amber-300/80 dark:hover:bg-amber-900/50 cursor-pointer"
                                  >
                                    <X size={10} />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </Row>
                <Row label={tr("task_field_priority", "Prioritas")}><PrioritySelect value={t.priority} onChange={(v) => patch({ priority: v })} testid="task-detail-priority" /></Row>
                <Row label={tr("task_field_start_date", "Tanggal Mulai")}><DatePicker disabled={ro} value={t.start_date || (t.created_at ? fmtDate(t.created_at, "yyyy-MM-dd") : "")} onChange={(val) => { const nextVal = val || (t.created_at ? fmtDate(t.created_at, "yyyy-MM-dd") : null); if (nextVal !== (t.start_date || null)) patch({ start_date: nextVal }); }} placeholder={tr("task_start_date_ph_detail", "Pilih tanggal mulai")} className={inp} data-testid="task-detail-start-date" /></Row>
                <Row label={tr("task_field_deadline", "Deadline")}><div className="flex flex-wrap items-center gap-2"><DateTimePicker disabled={ro} value={t.deadline ? fmtDate(t.deadline, "yyyy-MM-dd'T'HH:mm") : ""} onChange={(val) => { const v = val ? new Date(val).toISOString() : null; if (v !== t.deadline) patch({ deadline: v }); }} placeholder={tr("task_deadline_dt_ph", "Pilih deadline & jam")} className={`${inp} flex-1 min-w-[180px]`} data-testid="task-detail-deadline" />{d && <span className={`whitespace-nowrap text-xs ${d.cls}`}>{d.state === "overdue" ? tr("task_overdue_label", "Overdue") : d.state === "today" ? tr("task_today_label", "Hari Ini") : ""}</span>}</div></Row>
                <Row label={tr("task_field_brand", "IP / Brand")}><LabelPicker value={t.label_ids} onChange={(v) => patch({ label_ids: v })} testid="task-detail-labels" /></Row>
                <Row label={tr("task_field_item_type", "Jenis Item")}><ItemPicker value={t.item_type} onChange={(v) => patch({ item_type: v })} testid="task-detail-item" /></Row>
                <Row label={tr("task_field_link_url", "Link File / Folder")}><input disabled={ro} defaultValue={t.link_url || ""} key={`l${t.link_url}`} onBlur={(e) => e.target.value.trim() !== (t.link_url || "") && patch({ link_url: e.target.value.trim() })} placeholder="https://…" className={inp} data-testid="task-detail-link" /></Row>
                <Row label={tr("task_field_board", "Board")}>
                  <Select
                    value={t.board_id || "none"}
                    disabled={ro}
                    onValueChange={(val) => {
                      const nextBoardId = val === "none" ? "" : val;
                      const b = boards.find((x) => x.id === nextBoardId);
                      patch({
                        board_id: nextBoardId,
                        ...(b?.department ? { department: b.department } : {}),
                      }, tr("task_board_updated", "Board tugas diperbarui"));
                    }}
                  >
                    <SelectTrigger className="w-full" data-testid="task-detail-board">
                      <SelectValue placeholder={tr("task_board_ph", "Pilih board...")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("task_board_all_opt", "Semua Board")}</SelectItem>
                      {boards.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={tr("task_field_card_color", "Warna Kartu")}><ColorPicker value={t.card_color} onChange={(v) => patch({ card_color: v })} style={t.card_style} onStyle={(v) => patch({ card_style: v })} /></Row>
                {t.estimate && <Row label={tr("task_field_estimate_short", "Estimasi")}><span className="text-sm">{t.estimate}</span></Row>}
              </div>
              <Checkpoints t={t} ro={ro} patch={patch} reload={load} members={members} emptyMessage={assigneeScope.emptyMessage} />
              {t.links?.length > 0 && <section><h4 className="mb-2 text-sm font-bold">{tr("task_field_ref_links", "Link Referensi")}</h4>{t.links.map((l, i) => <a key={`${l}-${i}`} href={l} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-0.5 text-sm font-medium text-[#E11D48] dark:text-[#FF5364] underline hover:opacity-80"><Link2 size={13} /><span className="truncate">{l}</span></a>)}</section>}
              <section><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-bold">{tr("task_field_attachments", "Lampiran")} · {(t.attachments || []).length}</h4>{!ro && <button onClick={pick} className="flex items-center gap-1 text-xs font-semibold text-brand" data-testid="task-detail-add-attachment"><Paperclip size={12} />{tr("task_add_att_short", "Tambah")}</button>}{input}</div><AttachmentList items={t.attachments || []} onRemove={ro ? null : (a) => setAtt((x) => x.filter((y) => y.id !== a.id))} /></section>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => (groups ? setGroups(null) : api.get("/conversations").then((r) => setGroups((Array.isArray(r.data) ? r.data : []).filter((c) => c.type === "group"))).catch((e) => toast.error(errMsg(e, tr("task_share_load_groups_err", "Gagal memuat daftar grup")))))} className="btn-accent flex h-10 items-center gap-1.5 px-4 text-sm font-semibold shadow-sm" data-testid="task-share-btn"><Share2 size={15} />{tr("task_share_preview_btn", "Kirim Preview ke Grup")}</button>
                {t.conversation_id && <button onClick={() => navigate(`/messages/${t.conversation_id}`)} className="btn-ghost flex h-10 items-center gap-1.5 border px-4 text-sm font-semibold" data-testid="task-open-conversation"><MessageSquare size={14} />{tr("task_open_chat_btn", "Buka Obrolan")}</button>}
                {(isManager || (me?.user_id && reqIds.includes(me.user_id))) && <button onClick={() => patch({ archived: !t.archived }, t.archived ? tr("task_restored_toast", "Dipulihkan") : tr("task_archived_toast", "Diarsipkan"))} className="btn-ghost flex h-10 items-center gap-1.5 border px-4 text-sm font-semibold" data-testid="task-archive-btn"><Archive size={14} />{t.archived ? tr("task_restore_btn", "Pulihkan") : tr("task_archive_btn", "Arsipkan")}</button>}
              </div>
              {groups && (
                <div className="rounded-2xl border bg-surface2/60 p-3 space-y-2">
                  <p className="text-xs font-bold text-sub">{tr("task_share_pick_title", "Pilih grup tujuan pengiriman preview & approval:")}</p>
                  {groups.length === 0 ? (
                    <p className="text-xs text-sub py-2">{tr("task_share_no_groups", "Anda belum bergabung ke grup mana pun.")}</p>
                  ) : (
                    <div className="grid gap-1 sm:grid-cols-2">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => share(g.id)}
                          className="flex items-center gap-2 rounded-xl border bg-surface p-2.5 text-left text-sm font-medium hover:border-brand transition-colors"
                          data-testid={`share-to-${g.id}`}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-soft-purple text-xs font-bold">#</span>
                          <span className="truncate">{g.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <section>
                <div className="mb-3 flex items-center gap-1 border-b text-sm font-semibold">{[["comments", MessageSquare, `${tr("task_tab_comments", "Komentar")} · ${(t.comments || []).length}`], ["activity", History, `${tr("task_tab_activity", "Aktivitas")} · ${(t.activity || []).length}`]].map(([k, I, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px flex items-center gap-1.5 rounded-none border-b-2 px-3 py-2 transition-colors cursor-pointer ${tab === k ? "border-[var(--c-accent)] text-ink" : "border-transparent text-sub hover:text-ink hover:border-slate-300 dark:hover:border-slate-700"}`} data-testid={`task-tab-${k}`}><I size={14} />{l}</button>)}</div>
                {tab === "comments" ? <Comments t={t} reload={load} /> : (
                  (t.activity || []).length === 0 ? (
                    <p className="py-4 text-center text-xs text-sub">{tr("task_activity_empty", "Belum ada riwayat aktivitas pada tugas ini.")}</p>
                  ) : (
                    <ul className="space-y-3" data-testid="task-activity">
                      {(t.activity || []).map((a, i) => {
                        const actorDisplay = resolveActorName(a.actor_id, a.actor_name, userMap) || tr("task_user_fallback", "Pengguna");
                        const actionDisplay = humanizeLogAction(a.action, userMap);
                        const detailDisplay = a.detail ? resolveRawUserTokens(String(a.detail), userMap) : "";
                        return (
                          <li key={a.id || `act_${i}`} className="flex items-start gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-surface2/40 p-3 text-sm">
                            <Avatar user={userMap[a.actor_id]} size={26} showStatus={false} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="leading-snug">
                                <b className="text-ink">{actorDisplay}</b>{" "}
                                <span className="text-sub">{actionDisplay}</span>
                                {!detailDisplay && a.changes?.from !== undefined && a.changes?.to !== undefined && typeof a.changes.to !== "object" && a.changes.to !== null && (
                                  <span className="text-sub">
                                    {" "}→ <b className="text-ink">{userMap[a.changes.to]?.name || statuses.find((s) => s.key === a.changes.to)?.name || (allStatuses || []).find((s) => s.key === a.changes.to)?.name || resolveRawUserTokens(String(a.changes.to), userMap).slice(0, 80)}</b>
                                  </span>
                                )}
                              </p>
                              {detailDisplay && (
                                <div className="mt-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-surface px-3 py-2 text-xs text-ink/90 whitespace-pre-wrap break-words">
                                  {detailDisplay}
                                </div>
                              )}
                              <span className="mt-1 block text-[11px] text-sub">
                                {fmtDate(a.created_at, "d MMM yyyy, HH:mm:ss")} · {rel(a.created_at)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    {printPreviewOpen && (
      <PrintPreviewDialog
        open={printPreviewOpen}
        onOpenChange={setPrintPreviewOpen}
        mode="detail"
        task={t}
        boardName={activeBoardObj?.name || t?.department || tr("task_detail_title", "Detail Tugas")}
        userMap={userMap}
        labelMap={labelMap}
        statuses={statuses}
      />
    )}
    </>
  );
}
