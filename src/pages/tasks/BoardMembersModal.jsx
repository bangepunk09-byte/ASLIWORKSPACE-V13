import { useEffect, useState, useMemo } from "react";
import { Users, UserPlus, Trash2, Shield, Check, X, Search, Sparkles, Kanban, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar } from "../../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { AppSelect } from "../../components/ui/select";

export default function BoardMembersModal({ board, boards = [], onSwitchBoard, onClose, onUpdated }) {
  const { users, me, isAdmin, t } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteScope, setInviteScope] = useState("board_only"); // "board_only" | "board_and_chat"
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const load = async () => {
    if (!board?.id) return;
    setLoading(true);
    try {
      const res = await api.get(`/boards/${board.id}/members`);
      setData(res.data);
    } catch (err) {
      toast.error(errMsg(err, t("board_members_load_err", "Gagal memuat anggota board")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [board?.id]);

  const boardDept = board?.department || data?.department || "Semua Divisi";
  const linkedGroupName = data?.linked_group_name || board?.department || board?.name || "Group Chat";
  const deptUsers = data?.dept_users || [];
  const invitedUsers = data?.invited_users || [];

  // Users who are not yet in dept_users or invited_users and not bots
  const existingUserIds = new Set([
    ...deptUsers.map((u) => u.user_id),
    ...invitedUsers.map((u) => u.user_id),
    "user_circle_assistant"
  ]);

  const availableToInvite = useMemo(() => {
    return users.filter((u) => !u.is_bot && !existingUserIds.has(u.user_id));
  }, [users, existingUserIds]);

  const filteredAvailable = useMemo(() => {
    if (!searchQuery.trim()) return availableToInvite;
    const q = searchQuery.toLowerCase();
    return availableToInvite.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.department?.toLowerCase().includes(q)
    );
  }, [availableToInvite, searchQuery]);

  const handleInvite = async () => {
    if (!inviteUserId) return;
    setSubmitting(true);
    try {
      const targetUser = users.find((u) => u.user_id === inviteUserId);
      const includeGroupChat = inviteScope === "board_and_chat";
      await api.post(`/boards/${board.id}/invite`, {
        user_ids: [inviteUserId],
        invite_scope: inviteScope,
        include_group_chat: includeGroupChat,
      });
      if (includeGroupChat) {
        toast.success(
          `${targetUser?.name || t("board_members_staff_fallback", "Karyawan")} berhasil diundang ke Board ${board.name} & Group Chat ${linkedGroupName}`
        );
      } else {
        toast.success(
          `${targetUser?.name || t("board_members_staff_fallback", "Karyawan")} berhasil diundang ke Board ${board.name} (Board Saja)`
        );
      }
      setInviteUserId("");
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(errMsg(err, t("board_members_invite_err", "Gagal mengundang anggota")));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddExistingToGroupChat = async (userId, userName) => {
    try {
      await api.post(`/boards/${board.id}/invite`, {
        user_ids: [userId],
        invite_scope: "board_and_chat",
        include_group_chat: true,
      });
      toast.success(`${userName || "Karyawan"} berhasil ditambahkan juga ke Group Chat ${linkedGroupName}`);
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menambahkan ke Group Chat"));
    }
  };

  const handleRemove = async (userId, userName) => {
    try {
      await api.post(`/boards/${board.id}/remove-member`, { user_id: userId });
      toast.success(`${t("board_members_remove_toast_pre", "Akses")} ${userName || t("task_field_member_fallback", "anggota")} ${t("board_members_remove_toast_mid", "ke board ini berhasil dicabut")}`);
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(errMsg(err, t("board_members_remove_err", "Gagal mencabut akses")));
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-2xl max-h-[90dvh] overflow-y-auto overflow-x-hidden grid-cols-1 rounded-3xl bg-surface p-5 sm:p-6 shadow-2xl border" data-testid="board-members-modal">
        <DialogHeader className="pb-3 border-b min-w-0 pr-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white font-bold shadow-xs"
              style={{ background: board?.color || "#10B981" }}
            >
              <Users size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-bold text-ink truncate text-left">
                {t("board_members_modal_title", "Invite & Hak Akses:")} {board?.name}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="rounded-md bg-brand/10 text-brand px-2 py-0.5 text-[11px] font-bold">
                  {t("board_dept_opt_prefix", "Divisi:")} {boardDept}
                </span>
                <span className="text-[11px] text-sub">
                  {t("board_members_total_pre", "Total")} {(deptUsers.length + invitedUsers.length)} {t("board_members_total_suf", "orang memiliki akses")}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-2 min-w-0">
          {/* Board Switcher if multiple boards available */}
          {boards.length > 1 && onSwitchBoard && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border bg-surface2/40 px-3.5 py-2.5">
              <span className="text-xs font-bold text-sub">
                {t("board_members_target_board_label", "Target Board Undangan:")}
              </span>
              <AppSelect
                value={board?.id || ""}
                onChange={(e) => {
                  const found = boards.find((b) => b.id === e.target.value);
                  if (found) onSwitchBoard(found);
                }}
                className="h-9 sm:w-64 rounded-xl border bg-surface px-3 text-xs font-bold text-ink"
                data-testid="invite-target-board-select"
              >
                {boards.map((b) => {
                  const dept = b.department || "";
                  const showDept = dept && dept.toLowerCase() !== (b.name || "").trim().toLowerCase();
                  return (
                    <option key={b.id} value={b.id}>
                      {showDept ? `${b.name} (${dept})` : b.name}
                    </option>
                  );
                })}
              </AppSelect>
            </div>
          )}

          {/* Section: Invite Form */}
          <div className="rounded-2xl border bg-surface2/60 p-3.5 sm:p-4 space-y-3.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus size={14} className="text-brand shrink-0" />
                {t("board_members_invite_hdr", "Undang Orang / Rekan Lintas Divisi")}
              </span>
              <span className="text-[11px] text-sub">{t("board_members_invite_sub", "Bisa undang dari divisi mana saja")}</span>
            </div>

            {/* Opsi Scope Undangan: Masuk ke Board Saja vs Sekalian ke Group Chat */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-sub uppercase tracking-wider">
                {t("board_members_scope_label", "Pilihan Akses Undangan")}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setInviteScope("board_only")}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors duration-100 cursor-pointer ${
                    inviteScope === "board_only"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/15"
                      : "border-border bg-surface hover:bg-surface2/60"
                  }`}
                  data-testid="invite-scope-board-only"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 ${
                      inviteScope === "board_only"
                        ? "bg-brand text-white"
                        : "bg-surface2 text-sub"
                    }`}
                  >
                    <Kanban size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-ink">
                        {t("board_members_scope_board_only", "Masuk ke Board Saja")}
                      </span>
                      {inviteScope === "board_only" && (
                        <Check size={14} className="text-brand shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-sub leading-snug mt-0.5">
                      {t(
                        "board_members_scope_board_only_desc",
                        "Hanya akses melihat & kelola tugas di Board ini tanpa masuk ke Group Chat."
                      )}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setInviteScope("board_and_chat")}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors duration-100 cursor-pointer ${
                    inviteScope === "board_and_chat"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/15"
                      : "border-border bg-surface hover:bg-surface2/60"
                  }`}
                  data-testid="invite-scope-board-and-chat"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 ${
                      inviteScope === "board_and_chat"
                        ? "bg-brand text-white"
                        : "bg-surface2 text-sub"
                    }`}
                  >
                    <MessageSquare size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-ink">
                        {t("board_members_scope_board_chat", "Sekalian ke Group Chat")}
                      </span>
                      {inviteScope === "board_and_chat" && (
                        <Check size={14} className="text-brand shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-sub leading-snug mt-0.5">
                      {t(
                        "board_members_scope_board_chat_desc",
                        `Masuk ke Board ini sekaligus otomatis bergabung ke Group Chat "${linkedGroupName}".`
                      )}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-0">
              <AppSelect
                value={inviteUserId}
                onChange={(e) => setInviteUserId(e.target.value)}
                className="h-10 w-full min-w-0 flex-1"
                data-testid="invite-user-select"
              >
                <option value="">{t("board_members_invite_ph", "Pilih rekan kerja untuk diundang...")}</option>
                {availableToInvite.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.name} — {t("board_division_prefix", "Divisi")} {u.department || t("board_general_dept", "Umum")} · {u.job_title || t("board_members_staff_fallback", "Staf")}
                  </option>
                ))}
              </AppSelect>

              <button
                type="button"
                onClick={handleInvite}
                disabled={!inviteUserId || submitting}
                className="h-10 px-4 rounded-xl bg-brand text-white text-xs sm:text-sm font-bold shadow-xs hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                data-testid="submit-invite-btn"
              >
                <Plus size={15} />
                <span>Invite</span>
              </button>
            </div>
          </div>

          {/* Section: Kolaborator Diundang (Tamu Lintas Divisi) */}
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">
                {t("board_members_invited_hdr", "Kolaborator Diundang")} · {invitedUsers.length}
              </span>
              <span className="text-[11px] text-sub">{t("board_members_invited_sub", "Akses khusus lintas divisi")}</span>
            </div>

            {invitedUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-center text-xs text-sub bg-surface2/30">
                {t("board_members_invited_empty_pre", "Belum ada rekan dari luar divisi")} {boardDept} {t("board_members_invited_empty_suf", "yang diundang ke board ini.")}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {invitedUsers.map((u) => (
                  <div
                    key={u.user_id}
                    className="flex items-center justify-between gap-2 rounded-xl border bg-surface p-2.5 shadow-2xs hover:bg-surface2 transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Avatar user={u} size={32} showStatus={false} />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-ink">{u.name}</span>
                        <span className="block truncate text-[11px] text-sub">
                          {t("board_division_prefix", "Divisi")} {u.department || t("board_general_dept", "Umum")} · {u.job_title || t("board_members_staff_fallback", "Staf")}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {u.in_group_chat ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                          <MessageSquare size={10} />
                          <span>Board + Group Chat</span>
                        </span>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5 text-[10px] font-bold">
                            <Kanban size={10} />
                            <span>Board Saja</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAddExistingToGroupChat(u.user_id, u.name)}
                            className="inline-flex items-center gap-1 rounded-md border border-brand/30 bg-brand/10 hover:bg-brand/20 text-brand px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer"
                            title={`Tambahkan ${u.name} ke Group Chat ${linkedGroupName}`}
                            data-testid={`add-to-chat-${u.user_id}`}
                          >
                            <Plus size={10} />
                            <span>Group Chat</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(u.user_id, u.name)}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                        title={t("board_members_revoke_title", "Cabut akses")}
                        aria-label={`${t("board_members_revoke_title", "Cabut akses")} ${u.name}`}
                        data-testid={`remove-invited-${u.user_id}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: Anggota Otomatis Divisi */}
          <div className="space-y-2 pt-2 border-t min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">
                {t("board_members_dept_hdr", "Anggota Otomatis Divisi")} {boardDept} · {deptUsers.length}
              </span>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">
                {t("board_members_auto_sync", "✓ Otomatis sinkron")}
              </span>
            </div>
            <p className="text-[11px] text-sub">
              {t("board_members_dept_desc_pre", "Semua karyawan dengan divisi")} <b>{boardDept}</b> {t("board_members_dept_desc_suf", "otomatis dapat membuka board ini dan mengelola daftar tugasnya.")}
            </p>

            {deptUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-center text-xs text-sub bg-surface2/30">
                {t("board_members_dept_empty_pre", "Belum ada karyawan yang terdaftar di divisi")} {boardDept}.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {deptUsers.map((u) => (
                  <div
                    key={u.user_id}
                    className="flex items-center justify-between gap-2 rounded-xl border bg-surface p-2.5 shadow-2xs min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Avatar user={u} size={32} showStatus={false} />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-ink">{u.name}</span>
                        <span className="block truncate text-[11px] text-sub">
                          {u.job_title || t("board_members_staff_fallback", "Staf")} · {u.email}
                        </span>
                      </div>
                    </div>

                    <span className="rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold shrink-0 whitespace-nowrap">
                      {t("board_members_auto_badge", "Otomatis")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t flex justify-end min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border bg-surface hover:bg-surface2 text-xs font-bold text-ink transition-colors cursor-pointer"
          >
            {t("board_members_close_btn", "Tutup")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
