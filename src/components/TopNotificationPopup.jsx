import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, MessageSquare, Send, Bell, ArrowRight, Clock, ShieldCheck, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { setTopQuickActionNotifActive } from "../lib/sonnerCompat";
import { api, errMsg } from "../lib/api";
import { useApp } from "../context/AppContext";
import { Avatar } from "./common";
import { playSound } from "../lib/sound";

export function hasTopNotifQuickAction(notif) {
  if (!notif) return false;
  const { type, access_request, conversation_id, task_id, group_id, requester_id, archive_request_id, post_id, link } = notif;
  const isAccessReq = type === "access_request" || type === "access_request_card" || !!access_request;
  const isGroupJoinReq = type === "group_join_request" && Boolean(group_id && requester_id);
  const isGroupInvite = type === "group_invitation" && Boolean(group_id);
  const isArchiveDeleteReq = type === "archive_month_delete" && Boolean(archive_request_id);
  const isMessage = type === "message" || type === "dm" || !!conversation_id;
  const isProfileVerify = type === "profile_verify" || type === "profile_verified";
  const isBerandaPost =
    type === "post_new" ||
    type === "post_mention" ||
    type === "post_reply" ||
    type === "announcement" ||
    Boolean(post_id) ||
    (typeof link === "string" && link.startsWith("/beranda"));
  return Boolean(isAccessReq || isGroupJoinReq || isGroupInvite || isArchiveDeleteReq || isMessage || task_id || isProfileVerify || isBerandaPost);
}

export default function TopNotificationPopup({ notif, onClose }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const { me, t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  const navigate = useNavigate();

  const DURATION = 10000; // 10 seconds auto-dismiss
  const isPaused = paused || busy || replyOpen;
  const notifKey = notif ? `${notif.id || ""}_${notif.title || ""}_${notif.body || ""}` : "none";

  useEffect(() => {
    const active = hasTopNotifQuickAction(notif);
    setTopQuickActionNotifActive(active);
    return () => setTopQuickActionNotifActive(false);
  }, [notif?.id, notif?.type, notif?.access_request, notif?.conversation_id, notif?.task_id, notif?.group_id, notif?.requester_id, notif?.archive_request_id, notif?.post_id, notif?.link]);

  useEffect(() => {
    if (notif) {
      setReplyOpen(false);
      setReplyText("");
      setPaused(false);
      setBusy(false);
    }
  }, [notif?.id, notif?.title, notif?.body]);

  if (!notif) return null;

  const { title, body, type, sender, access_request, group_id, requester_id, archive_request_id, conversation_id, task_id, post_id, link } = notif;
  const isPasswordReset = access_request?.type === "password_reset";
  const isDeleteUser = access_request?.type === "delete_user";
  const isProfileVerify = type === "profile_verify" || type === "profile_verified";
  const isGroupJoinReq = type === "group_join_request" && Boolean(group_id && requester_id);
  const isGroupInvite = type === "group_invitation" && Boolean(group_id);
  const isArchiveDeleteReq = type === "archive_month_delete" && Boolean(archive_request_id);
  const isBerandaPost =
    type === "post_new" ||
    type === "post_mention" ||
    type === "post_reply" ||
    type === "announcement" ||
    Boolean(post_id) ||
    (typeof link === "string" && link.startsWith("/beranda"));

  const handleApprove = async () => {
    if (!access_request?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/access-requests/${access_request.id}/approve`, (isPasswordReset || isDeleteUser) ? {} : {
        role: access_request.assigned_role || "employee",
        department: access_request.department || "General"
      });
      playSound("click");
      setTopQuickActionNotifActive(false);
      onClose();
      toast.success(
        isPasswordReset
          ? `Reset password untuk ${access_request.name || "karyawan"} di-approve!`
          : isDeleteUser
          ? `Permohonan hapus akun ${access_request.name || "karyawan"} di-approve!`
          : `Akses untuk ${access_request.name || "karyawan"} berhasil di-approve!`
      );
    } catch (e) {
      toast.error(errMsg(e, "Gagal meng-approve permintaan"));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!access_request?.id) return;
    setBusy(true);
    try {
      await api.post(`/admin/access-requests/${access_request.id}/reject`);
      setTopQuickActionNotifActive(false);
      onClose();
      toast.info(
        isPasswordReset
          ? "Permintaan reset password ditolak."
          : isDeleteUser
          ? "Permohonan hapus akun ditolak."
          : "Permintaan akses ditolak."
      );
    } catch (e) {
      toast.error(errMsg(e, "Gagal menolak permintaan"));
    } finally {
      setBusy(false);
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !conversation_id) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${conversation_id}/messages`, {
        text: replyText.trim()
      });
      playSound("message");
      setTopQuickActionNotifActive(false);
      onClose();
      toast.success("Balasan pesan terkirim!");
    } catch (e) {
      toast.error(errMsg(e, "Gagal membalas pesan"));
    } finally {
      setBusy(false);
    }
  };

  const handleGroupJoinDecision = async (approve) => {
    if (!group_id || !requester_id) return;
    setBusy(true);
    try {
      await api.post(`/groups/${group_id}/join-requests/${requester_id}/${approve ? "approve" : "reject"}`);
      playSound("click");
      setTopQuickActionNotifActive(false);
      onClose();
      toast.success(approve ? "Permintaan masuk grup di-approve!" : "Permintaan masuk grup ditolak.");
    } catch (e) {
      toast.error(errMsg(e, "Gagal memproses permintaan grup"));
    } finally {
      setBusy(false);
    }
  };

  const handleGroupInviteDecision = async (accept) => {
    if (!group_id) return;
    setBusy(true);
    try {
      await api.post(`/groups/${group_id}/${accept ? "accept-invite" : "decline-invite"}`);
      playSound("click");
      setTopQuickActionNotifActive(false);
      onClose();
      if (accept) {
        toast.success("Undangan grup diterima!");
        navigate(`/messages/${group_id}`);
      } else {
        toast.info("Undangan grup ditolak.");
      }
    } catch (e) {
      toast.error(errMsg(e, "Gagal memproses undangan grup"));
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveDeleteDecision = async (decision) => {
    if (!archive_request_id) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/archive/delete-requests/${archive_request_id}/decision`, { decision });
      playSound("click");
      setTopQuickActionNotifActive(false);
      onClose();
      if (decision === "reject") {
        toast.info("Permintaan hapus arsip bulan ditolak.");
      } else if (data?.executed) {
        toast.success(`Approval 2/2 lengkap! ${data.deleted_count || 0} tugas arsip bulan tersebut dihapus.`);
      } else {
        toast.success(`Approval ${data?.approved_count || 1}/${data?.needed || 2} tercatat!`);
      }
      navigate("/tasks?view=archive");
    } catch (e) {
      toast.error(errMsg(e, "Gagal memproses approval hapus arsip"));
    } finally {
      setBusy(false);
    }
  };

  const isAccessReq = type === "access_request" || type === "access_request_card" || !!access_request;
  const isMessage = !isGroupJoinReq && !isGroupInvite && !isArchiveDeleteReq && (type === "message" || type === "dm" || !!conversation_id);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => !replyOpen && setPaused(false)}
      className="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-1.5rem)] sm:w-[94%] max-w-lg rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface dark:bg-slate-900 p-3.5 sm:p-4 shadow-2xl text-ink animate-in fade-in slide-in-from-top-3 duration-150"
      data-testid="top-notification-popup"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {sender && !isProfileVerify ? (
            <Avatar user={sender} size={40} />
          ) : (
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-bold ${isProfileVerify ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-brand/10 text-brand"}`}>
              {isAccessReq ? <ShieldCheck size={20} /> : isProfileVerify ? <BadgeCheck size={20} /> : <Bell size={20} />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-ink truncate leading-normal">{title || tr("notif_popup_default_title", "Notifikasi Baru")}</h4>
            <p className="text-xs text-sub line-clamp-2 whitespace-normal break-words mt-0.5">{body || tr("notif_popup_default_body", "Ada pembaruan di ASLI Workspace.")}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className="rounded-full p-1.5 text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
          title="Tutup Notifikasi"
          data-testid="close-top-notif-btn"
        >
          <X size={16} />
        </button>
      </div>

      {/* Quick Action Area */}
      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">
        {/* Case 1: Access Request / Password Reset / Delete User Approval Quick Actions */}
        {isAccessReq && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-sub font-medium flex items-center gap-1">
              <Clock size={12} /> {isPasswordReset ? tr("notif_popup_req_reset", "Permintaan Reset Password") : isDeleteUser ? tr("notif_popup_req_delete", "Permohonan Hapus Akun") : tr("notif_popup_req_access", "Permintaan Akses Masuk")}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                disabled={busy}
                onClick={handleReject}
                className="h-8 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-quick-reject-btn"
              >
                {tr("notif_popup_reject", "Tolak")}
              </button>
              <button
                disabled={busy}
                onClick={handleApprove}
                className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-quick-approve-btn"
              >
                {isPasswordReset ? tr("notif_popup_approve_reset", "Approve Reset") : isDeleteUser ? tr("notif_popup_approve_delete", "Approve Hapus") : tr("notif_popup_approve_access", "Approve Akses")}
              </button>
            </div>
          </div>
        )}

        {/* Case 1b: Private Group Join Request Approval Quick Actions */}
        {isGroupJoinReq && !isAccessReq && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-sub font-medium flex items-center gap-1">
              <Clock size={12} /> {tr("notif_popup_group_join", "Izin Gabung Grup Privat")}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                disabled={busy}
                onClick={() => handleGroupJoinDecision(false)}
                className="h-8 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-group-reject-btn"
              >
                {tr("notif_popup_reject", "Tolak")}
              </button>
              <button
                disabled={busy}
                onClick={() => handleGroupJoinDecision(true)}
                className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-group-approve-btn"
              >
                {tr("notif_popup_approve", "Approve")}
              </button>
            </div>
          </div>
        )}

        {/* Case 1c: Group Invitation Quick Actions */}
        {isGroupInvite && !isAccessReq && !isGroupJoinReq && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-sub font-medium flex items-center gap-1">
              <Clock size={12} /> {tr("notif_popup_group_invite", "Undangan Masuk Grup")}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                disabled={busy}
                onClick={() => handleGroupInviteDecision(false)}
                className="h-8 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-group-invite-decline-btn"
              >
                {tr("notif_popup_reject", "Tolak")}
              </button>
              <button
                disabled={busy}
                onClick={() => handleGroupInviteDecision(true)}
                className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-group-invite-accept-btn"
              >
                {tr("notif_popup_accept_invite", "Terima Undangan")}
              </button>
            </div>
          </div>
        )}

        {/* Case 1d: Monthly Archive Deletion Approval (Min 2 Approvals) */}
        {isArchiveDeleteReq && !isAccessReq && !isGroupJoinReq && !isGroupInvite && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-sub font-medium flex items-center gap-1">
              <Clock size={12} /> {tr("notif_popup_archive_del", "Approval Hapus Arsip 1 Bulan (Min. 2 Orang)")}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                disabled={busy}
                onClick={() => handleArchiveDeleteDecision("reject")}
                className="h-8 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-archive-reject-btn"
              >
                {tr("notif_popup_reject", "Tolak")}
              </button>
              <button
                disabled={busy}
                onClick={() => handleArchiveDeleteDecision("approve")}
                className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                data-testid="notif-archive-approve-btn"
              >
                {tr("notif_popup_approve_delete", "Approve Hapus")}
              </button>
            </div>
          </div>
        )}

        {/* Case 2: Message / Chat Quick Actions */}
        {isMessage && !isAccessReq && !isGroupJoinReq && !isGroupInvite && !isArchiveDeleteReq && (
          <div className="space-y-2">
            {!replyOpen ? (
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setReplyOpen(true);
                    setPaused(true);
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-xl bg-surface2 px-3 text-xs font-semibold text-brand hover:bg-brand/10 transition-colors cursor-pointer"
                  data-testid="notif-quick-reply-toggle"
                >
                  <MessageSquare size={13} /> {tr("notif_popup_quick_reply", "Balas Chat Cepat")}
                </button>
                <button
                  onClick={() => {
                    if (conversation_id) navigate(`/messages/${conversation_id}`);
                    else navigate("/messages");
                    onClose();
                  }}
                  className="flex h-8 items-center gap-1 text-xs font-bold text-ink hover:text-brand transition-colors cursor-pointer"
                  data-testid="notif-open-chat-btn"
                >
                  {tr("notif_popup_open_chat", "Buka Chat")} <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendReply} className="flex items-center gap-2">
                <input
                  autoFocus
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={tr("notif_popup_reply_ph", "Ketik balasan pesan...")}
                  className="h-9 flex-1 rounded-xl border bg-surface2 px-3 text-xs text-ink outline-none focus:border-brand"
                  data-testid="notif-reply-input"
                />
                <button
                  type="submit"
                  disabled={busy || !replyText.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white font-bold disabled:opacity-50 hover:bg-brand/90 transition-colors cursor-pointer"
                  data-testid="notif-send-reply-btn"
                >
                  <Send size={14} />
                </button>
              </form>
            )}
          </div>
        )}

        {/* Case 3: Task Quick Actions */}
        {task_id && !isAccessReq && !isMessage && !isGroupJoinReq && !isGroupInvite && !isArchiveDeleteReq && (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                navigate(`/tasks?task=${task_id}`);
                onClose();
              }}
              className="h-8 rounded-xl bg-brand text-white px-3 text-xs font-bold shadow-xs hover:bg-brand/90 transition-colors cursor-pointer"
              data-testid="notif-open-task-btn"
            >
              {tr("notif_popup_view_task", "Lihat Tugas")}
            </button>
          </div>
        )}

        {/* Case 4: Profile Verification Onboarding CTA */}
        {isProfileVerify && !isAccessReq && !isMessage && !task_id && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400 flex items-center gap-1">
              <BadgeCheck size={13} /> {type === "profile_verified" ? tr("notif_popup_verified", "Akun Terverifikasi") : tr("notif_popup_verify_cta", "Lengkapi 100% untuk Verified")}
            </span>
            <button
              type="button"
              onClick={() => {
                navigate(link || `/people/${me?.user_id}?edit=1`);
                onClose();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 px-3 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
              data-testid="notif-complete-profile-btn"
            >
              {type === "profile_verified" ? tr("notif_popup_view_profile", "Lihat Profil") : tr("notif_popup_complete_profile", "Lengkapi Profil")}
              <ArrowRight size={13} />
            </button>
          </div>
        )}

        {/* Case 5: Beranda Post / Mention / Reply CTA */}
        {isBerandaPost && !isAccessReq && !isGroupJoinReq && !isGroupInvite && !isArchiveDeleteReq && !isMessage && !task_id && !isProfileVerify && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-sub flex items-center gap-1">
              <Bell size={12} className="text-brand" />{" "}
              {type === "post_mention"
                ? tr("notif_popup_beranda_mention", "Menyebut di Beranda")
                : type === "post_reply"
                ? tr("notif_popup_beranda_reply", "Balasan di Beranda")
                : tr("notif_popup_beranda_new", "Postingan Baru Beranda")}
            </span>
            <button
              type="button"
              onClick={() => {
                setTopQuickActionNotifActive(false);
                navigate(link || (post_id ? `/beranda/${post_id}` : "/beranda"));
                onClose();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-brand hover:bg-brand/90 px-3 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
              data-testid="notif-open-beranda-btn"
            >
              {tr("notif_popup_view_beranda", "Lihat di Beranda")}
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/* 10-Second Auto Dismiss Progress Bar (GPU scaleX, zero timer ticks) */}
      <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          key={notifKey}
          onAnimationEnd={() => onClose?.()}
          className="h-full w-full bg-brand origin-left"
          style={{
            animation: `top-notif-shrink ${DURATION}ms linear forwards`,
            animationPlayState: isPaused ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}
