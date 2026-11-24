import { useEffect, useState } from "react";
import { Search, Trash2, Users, Building2, FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar } from "../../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AppSelect } from "../../components/ui/select";

const COLORS = ["#F87171", "#FB923C", "#FACC15", "#4ADE80", "#60A5FA", "#A78BFA", "#F472B6", "#2DD4BF"];

export default function BoardDialog({ board, onClose, onSaved }) {
  const { users, me, isAdmin, t } = useApp();
  const depts = [...new Set(users.filter((u) => !u.is_bot).map((u) => u.department).filter(Boolean))].sort();

  const [f, setF] = useState({
    name: board?.name || "",
    description: board?.description || "",
    color: board?.color || COLORS[4],
    board_type: "collaborative",
    is_collaborative: true,
    all_workspace_members: board?.all_workspace_members !== false,
    project_id: board?.project_id || "",
    department: "Semua Divisi",
    member_ids: Array.isArray(board?.member_ids) && board.member_ids.length > 0
      ? board.member_ids
      : (me?.user_id ? [me.user_id] : [])
  });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (id) =>
    setF({
      ...f,
      member_ids: f.member_ids.includes(id) ? f.member_ids.filter((x) => x !== id) : [...f.member_ids, id]
    });
  const addDept = (d) =>
    setF({
      ...f,
      member_ids: [...new Set([...f.member_ids, ...users.filter((u) => !u.is_bot && u.department === d).map((u) => u.user_id)])]
    });
  const list = users.filter(
    (u) =>
      !u.is_bot &&
      u.role !== "assistant" &&
      u.user_id !== "user_circle_assistant" &&
      ((u.name || "").toLowerCase().includes(q.toLowerCase()) ||
        (u.department || "").toLowerCase().includes(q.toLowerCase()))
  );

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...f,
        board_type: "collaborative",
        is_collaborative: true,
        department: "Semua Divisi",
        project_id: f.project_id || null,
        invited_member_ids: f.member_ids
      };
      const { data } = board?.id
        ? await api.patch(`/boards/${board.id}`, payload)
        : await api.post("/boards", payload);
      toast.success(t("board_saved_toast", "Board proyek kolaborasi berhasil disimpan"));
      onSaved(data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
    setBusy(false);
  };

  const del = async () => {
    if (!board?.id) return;
    setBusy(true);
    try {
      await api.delete(`/boards/${board.id}`);
      toast.success(t("board_deleted_toast", "Board berhasil dihapus"));
      onSaved(null);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-3xl bg-surface" data-testid="board-dialog">
        <DialogHeader>
          <DialogTitle>{board?.id ? t("board_dialog_edit_title", "Atur Board Kolaborasi / Proyek") : t("board_dialog_new_title", "Buat Board Baru")}</DialogTitle>
          <p className="text-xs text-sub flex items-center gap-1.5 pt-0.5">
            <FolderKanban size={13} className="text-brand shrink-0" />
            <span>Board baru khusus untuk kolaborasi lintas divisi & otomatis masuk ke daftar Proyek.</span>
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">{t("board_name_label", "Nama Board / Proyek *")}</label>
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder={t("board_name_collab_ph", "mis. Kolaborasi Launch Produk, Campaign Q4")}
              className="h-11 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none"
              data-testid="board-name-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-sub">{t("board_desc_label", "Deskripsi")}</label>
            <input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder={t("board_desc_ph", "Tujuan atau fokus pekerjaan board kolaborasi ini")}
              className="h-10 w-full rounded-xl border bg-surface2 px-3 text-sm outline-none"
              data-testid="board-description-input"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-sub">{t("board_theme_color_label", "Warna Tema Board")}</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setF({ ...f, color: c })}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                    f.color === c ? "ring-2 ring-offset-2 ring-brand" : ""
                  }`}
                  style={{ background: c }}
                  aria-label={`${t("board_color_aria_prefix", "Warna")} ${c}`}
                  data-testid={`board-color-${c.slice(1)}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="flex items-start gap-2 rounded-xl border bg-surface2/60 p-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={f.all_workspace_members !== false}
                onChange={(e) => setF({ ...f, all_workspace_members: e.target.checked })}
                className="mt-0.5 accent-brand"
                data-testid="board-collab-all-checkbox"
              />
              <span>
                <b className="text-ink">{t("board_collab_all_title", "Terbuka untuk seluruh anggota lintas divisi")}</b>
                <span className="block text-sub text-[11px] mt-0.5">
                  {f.all_workspace_members !== false
                    ? t("board_collab_all_desc_on", "Semua karyawan dari divisi manapun bisa dipilih saat assign tugas di board kolaborasi ini.")
                    : t("board_collab_all_desc_off", "Hanya anggota yang Anda centang di bawah yang bisa ditugaskan di board ini.")}
                </span>
              </span>
            </label>
          </div>

          <div className="pt-2 border-t">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Users size={14} className="text-brand" />
                  {t("board_collab_members_hdr", "Anggota Kolaborasi")} ({f.member_ids.length})
                </p>
                <span className="text-[11px] text-sub font-medium">{t("board_cross_div_short", "Lintas divisi")}</span>
              </div>

              {depts.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-sub">{t("board_add_div_label", "Tambah divisi:")}</span>
                  {depts.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => addDept(d)}
                      className="rounded-full border bg-surface2 px-2.5 py-0.5 text-xs font-medium hover:bg-surface hover:border-brand transition-colors cursor-pointer"
                      data-testid={`board-add-dept-${d.replace(/\s/g, "-")}`}
                    >
                      + {d}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex h-9 items-center gap-2 rounded-xl border bg-surface2 px-3">
                <Search size={14} className="text-sub" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("board_search_member_ph", "Cari karyawan lintas divisi...")}
                  className="flex-1 bg-transparent text-sm outline-none"
                  data-testid="board-member-search"
                />
              </div>

              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                {list.map((u) => {
                  const isSelected = f.member_ids.includes(u.user_id);
                  return (
                    <label
                      key={u.user_id}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl p-2 transition-colors ${
                        isSelected ? "bg-brand/5 border border-brand/20" : "hover:bg-surface2"
                      }`}
                      data-testid={`board-member-${u.user_id}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(u.user_id)}
                        className="h-4 w-4 accent-brand rounded"
                      />
                      <Avatar user={u} size={28} showStatus={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">{u.name}</span>
                        <span className="block truncate text-[11px] text-sub">{u.job_title}</span>
                      </span>
                      <span className="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] font-bold text-sub">
                        {u.department || t("board_general_dept", "Umum")}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 pt-4 border-t">
          {board?.id && (isAdmin || board.created_by === me?.user_id) ? (
            confirmDelete ? (
              <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/30 p-1 rounded-xl">
                <span className="text-xs text-rose-600 font-bold px-1">{t("board_delete_confirm_q", "Yakin hapus?")}</span>
                <button
                  type="button"
                  onClick={del}
                  disabled={busy}
                  className="rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                  data-testid="board-delete-confirm"
                >
                  {t("board_delete_confirm_yes", "Ya")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full border bg-surface px-3 py-1 text-xs font-semibold hover:bg-surface2"
                >
                  {t("board_delete_confirm_cancel", "Batal")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="btn-ghost flex h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 disabled:opacity-50"
                data-testid="board-delete-btn"
              >
                <Trash2 size={14} /> {t("board_delete_btn", "Hapus")}
              </button>
            )
          ) : <div />}
          <button
            type="button"
            onClick={save}
            disabled={busy || !f.name.trim()}
            className="btn-accent h-11 flex-1 rounded-full font-semibold text-sm disabled:opacity-50"
            data-testid="board-save-btn"
          >
            {busy ? t("board_saving_btn", "Menyimpan...") : t("board_save_btn", "Simpan Board")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
