import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Instagram,
  Plus,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Clock,
  Trash2,
  Eye,
  EyeOff,
  Link2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg } from "../lib/api";
import { playSound } from "../lib/sound";
import {
  getLocalDeletedEntityIds,
  recordDeletedEntityIds,
  syncWorkspaceMirror,
} from "../lib/persistentMirror";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

const IG_CACHE_KEY = "circle_instagram_tracker_cache_v1";

function readCachedAccounts() {
  try {
    const delSet = new Set(getLocalDeletedEntityIds());
    const raw = localStorage.getItem(IG_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((a) => a && a.id && !delSet.has(String(a.id)));
      }
    }
  } catch {}
  return [];
}

function writeCachedAccounts(list) {
  try {
    const delSet = new Set(getLocalDeletedEntityIds());
    const clean = (Array.isArray(list) ? list : []).filter(
      (a) => a && a.id && !delSet.has(String(a.id))
    );
    localStorage.setItem(IG_CACHE_KEY, JSON.stringify(clean));
  } catch {}
}

function formatRelativeTimeId(isoStr) {
  if (!isoStr) return "Belum ada data";
  const ts = new Date(isoStr).getTime();
  if (!Number.isFinite(ts)) return "Baru saja";
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} hari lalu`;
}

function extractShortcodeFromUrl(url = "") {
  const m = String(url || "").match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : "";
}

export default function InstagramTrackerWidget({ densityStyles }) {
  const { subscribe } = useApp();
  const [accounts, setAccounts] = useState(() => readCachedAccounts());
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'live' | 'pending'
  const [expandedEmbedId, setExpandedEmbedId] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Add Account Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newCategory, setNewCategory] = useState("Brand Utama");
  const [newPostUrl, setNewPostUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [newIsLiveToday, setNewIsLiveToday] = useState(true);
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Quick Update Post Modal
  const [editingAccount, setEditingAccount] = useState(null);
  const [editPostUrl, setEditPostUrl] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [editIsLive, setEditIsLive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  const commitAccounts = useCallback((nextList) => {
    const delSet = new Set(getLocalDeletedEntityIds());
    const clean = (Array.isArray(nextList) ? nextList : []).filter(
      (a) => a && a.id && !delSet.has(String(a.id))
    );
    setAccounts(clean);
    writeCachedAccounts(clean);
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await api.get("/instagram-tracker");
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
    } catch {}
  }, [commitAccounts]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    return subscribe?.((evt) => {
      if (evt.type === "instagram_tracker:changed") {
        if (evt.deleted_id) {
          recordDeletedEntityIds([evt.deleted_id]);
        }
        if (Array.isArray(evt.accounts)) {
          commitAccounts(evt.accounts);
        } else {
          loadAccounts();
        }
      }
    });
  }, [subscribe, commitAccounts, loadAccounts]);

  const stats = useMemo(() => {
    const total = accounts.length;
    const liveCount = accounts.filter((a) => Boolean(a.is_live_today)).length;
    const pendingCount = Math.max(0, total - liveCount);
    return { total, liveCount, pendingCount };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (filterMode === "live") return Boolean(acc.is_live_today);
      if (filterMode === "pending") return !acc.is_live_today;
      return true;
    });
  }, [accounts, filterMode]);

  const handleToggleLiveStatus = async (acc) => {
    const nextLive = !acc.is_live_today;
    playSound("check");
    const nowIso = new Date().toISOString();
    commitAccounts(
      accounts.map((a) =>
        a.id === acc.id
          ? {
              ...a,
              is_live_today: nextLive,
              latest_posted_at: nextLive ? nowIso : a.latest_posted_at,
            }
          : a
      )
    );
    try {
      const { data } = await api.patch(`/instagram-tracker/${acc.id}`, {
        is_live_today: nextLive,
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      toast.success(
        nextLive
          ? `@${acc.username} ditandai: Konten Baru Sudah Naik!`
          : `@${acc.username} ditandai: Belum Naik Hari Ini`
      );
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui status tayang"));
      loadAccounts();
    }
  };

  const handleRefreshSingle = async (acc) => {
    setRefreshingId(acc.id);
    try {
      const { data } = await api.post(`/instagram-tracker/${acc.id}/refresh`);
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      toast.success(`Data postingan @${acc.username} berhasil dicek`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengecek akun Instagram"));
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    if (accounts.length === 0) return;
    setRefreshingAll(true);
    try {
      for (const acc of accounts) {
        await api.post(`/instagram-tracker/${acc.id}/refresh`).catch(() => {});
      }
      await loadAccounts();
      toast.success("Semua akun Instagram berhasil disinkronkan!");
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() && !newPostUrl.trim()) {
      toast.error("Masukkan username Instagram (@namaakun) atau link postingan");
      return;
    }
    setSubmittingAdd(true);
    try {
      const { data } = await api.post("/instagram-tracker", {
        username: newUsername.trim(),
        display_name: newDisplayName.trim(),
        category: newCategory,
        latest_post_url: newPostUrl.trim(),
        latest_caption: newCaption.trim(),
        is_live_today: newIsLiveToday,
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      playSound("success");
      toast.success("Akun Instagram berhasil ditambahkan ke tracker");
      setNewUsername("");
      setNewDisplayName("");
      setNewPostUrl("");
      setNewCaption("");
      setNewIsLiveToday(true);
      setAddOpen(false);
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menambahkan akun Instagram"));
    } finally {
      setSubmittingAdd(false);
    }
  };

  const openQuickUpdate = (acc) => {
    setEditingAccount(acc);
    setEditPostUrl(acc.latest_post_url || "");
    setEditCaption(acc.latest_caption || "");
    setEditIsLive(Boolean(acc.is_live_today));
  };

  const handleSaveQuickUpdate = async (e) => {
    e.preventDefault();
    if (!editingAccount) return;
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/instagram-tracker/${editingAccount.id}`, {
        latest_post_url: editPostUrl.trim(),
        latest_caption: editCaption.trim(),
        is_live_today: editIsLive,
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      if (editPostUrl.trim()) {
        setExpandedEmbedId(editingAccount.id);
      }
      setEditingAccount(null);
      playSound("success");
      toast.success(`Update postingan @${editingAccount.username} tersimpan!`);
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan update postingan"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteAccount = async (acc) => {
    recordDeletedEntityIds([acc.id]);
    commitAccounts(accounts.filter((a) => a.id !== acc.id));
    toast.success(`Akun @${acc.username} dihapus dari tracker`);
    try {
      await api.delete(`/instagram-tracker/${acc.id}`);
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus akun Instagram"));
      loadAccounts();
    }
  };

  return (
    <div
      className={`rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/90 shadow-sm ${
        densityStyles?.cardPad || "p-5"
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Instagram className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              Tracker Postingan Instagram
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Pantau konten terbaru akun sudah naik atau belum hari ini
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            title="Sinkronkan ulang semua akun"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-xs hover:opacity-95"
            style={{ background: "var(--accent, #E11D48)" }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Akun IG</span>
          </button>
        </div>
      </div>

      {/* Summary Filter Strip */}
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <button
          type="button"
          onClick={() => setFilterMode("all")}
          className={`px-2.5 py-2 rounded-xl border text-left transition-all ${
            filterMode === "all"
              ? "border-slate-900 dark:border-slate-200 bg-slate-900/5 dark:bg-slate-800"
              : "border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/70"
          }`}
        >
          <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
            Total Akun
          </div>
          <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
            {stats.total}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode("live")}
          className={`px-2.5 py-2 rounded-xl border text-left transition-all ${
            filterMode === "live"
              ? "border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40"
              : "border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50/70"
          }`}
        >
          <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Sudah Naik
          </div>
          <div className="text-base font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
            {stats.liveCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode("pending")}
          className={`px-2.5 py-2 rounded-xl border text-left transition-all ${
            filterMode === "pending"
              ? "border-amber-500 bg-amber-50/80 dark:bg-amber-950/40"
              : "border-amber-200/70 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70"
          }`}
        >
          <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Belum Naik
          </div>
          <div className="text-base font-bold text-amber-700 dark:text-amber-300 tabular-nums">
            {stats.pendingCount}
          </div>
        </button>
      </div>

      {/* Account List */}
      {filteredAccounts.length === 0 ? (
        <div className="py-7 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <Instagram className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Belum ada akun Instagram pada filter ini
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Tambahkan akun Instagram brand/divisi untuk memantau status tayang konten terbaru.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-0.5">
          {filteredAccounts.map((acc) => {
            const isLive = Boolean(acc.is_live_today);
            const shortcode = acc.latest_shortcode || extractShortcodeFromUrl(acc.latest_post_url);
            const isEmbedOpen = expandedEmbedId === acc.id;
            const embedSrc = shortcode
              ? `https://www.instagram.com/p/${shortcode}/embed/captioned/`
              : `https://www.instagram.com/${encodeURIComponent(acc.username)}/embed`;
            const targetUrl =
              acc.latest_post_url ||
              (shortcode ? `https://www.instagram.com/p/${shortcode}/` : "") ||
              acc.profile_url ||
              `https://www.instagram.com/${acc.username}/`;

            return (
              <div
                key={acc.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-slate-900 dark:text-white hover:underline truncate"
                      >
                        @{acc.username}
                      </a>
                      {acc.category && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300">
                          {acc.category}
                        </span>
                      )}
                    </div>
                    {acc.display_name && acc.display_name !== `@${acc.username}` && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {acc.display_name}
                      </div>
                    )}
                  </div>

                  {/* Status Toggle Button */}
                  <button
                    type="button"
                    onClick={() => handleToggleLiveStatus(acc)}
                    title="Klik untuk mengubah status tayang hari ini"
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition-all border ${
                      isLive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70"
                    }`}
                  >
                    {isLive ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>Sudah Naik</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <span>Belum Naik</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Latest post caption / info */}
                <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                  {acc.latest_caption || "Klik 'Preview IG' untuk melihat postingan terakhir secara live."}
                </div>

                {/* Footer metadata & actions */}
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                    Update: {formatRelativeTimeId(acc.latest_posted_at || acc.last_checked_at)}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedEmbedId(isEmbedOpen ? null : acc.id)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        isEmbedOpen
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {isEmbedOpen ? (
                        <>
                          <EyeOff className="w-3 h-3" />
                          <span>Tutup Feed</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3 h-3" />
                          <span>Lihat Post Terakhir</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => openQuickUpdate(acc)}
                      title="Tautkan link postingan terbaru / catat caption"
                      className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    >
                      <Link2 className="w-3 h-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRefreshSingle(acc)}
                      disabled={refreshingId === acc.id}
                      title="Cek ulang dari Instagram"
                      className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${refreshingId === acc.id ? "animate-spin" : ""}`}
                      />
                    </button>

                    <a
                      href={targetUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Buka di Instagram"
                      className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    <button
                      type="button"
                      onClick={() => handleDeleteAccount(acc)}
                      title="Hapus akun dari tracker"
                      className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Live Instagram Profile / Post Embed Viewer */}
                {isEmbedOpen && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white">
                    <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="font-medium truncate">
                        Live Feed Instagram @{acc.username}
                      </span>
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-rose-600 dark:text-rose-400 font-semibold hover:underline flex items-center gap-1"
                      >
                        <span>Buka Tab</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <iframe
                      title={`Instagram @${acc.username}`}
                      src={embedSrc}
                      className="w-full h-[380px] border-0 bg-white"
                      loading="lazy"
                      allowTransparency={true}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Tambah Akun Instagram */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Akun Instagram ke Tracker</DialogTitle>
            <DialogDescription>
              Masukkan username akun Instagram yang ingin dipantau jadwal kenaikan konten terbarunya.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAccount} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Username / Link Profil Instagram *
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Contoh: @asli.ri atau https://instagram.com/asli.ri"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Brand / Label
                </label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Contoh: ASLI RI Official"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kategori
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="Brand Utama">Brand Utama</option>
                  <option value="Campaign / Event">Campaign / Event</option>
                  <option value="Klien / Partner">Klien / Partner</option>
                  <option value="Referensi / Kompetitor">Referensi / Kompetitor</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Link Postingan / Reel Terakhir (Opsional)
              </label>
              <input
                type="text"
                value={newPostUrl}
                onChange={(e) => setNewPostUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/... atau /reel/..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Catatan / Judul Konten Terakhir
              </label>
              <input
                type="text"
                value={newCaption}
                onChange={(e) => setNewCaption(e.target.value)}
                placeholder="Contoh: Reels Campaign Promo Akhir Bulan"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Status Konten Hari Ini
              </span>
              <button
                type="button"
                onClick={() => setNewIsLiveToday((v) => !v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  newIsLiveToday
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-white"
                }`}
              >
                {newIsLiveToday ? "Sudah Naik Hari Ini" : "Belum Naik"}
              </button>
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submittingAdd}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs disabled:opacity-50"
                style={{ background: "var(--accent, #E11D48)" }}
              >
                {submittingAdd ? "Menyimpan..." : "Simpan Akun"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Update Postingan Terakhir */}
      <Dialog open={Boolean(editingAccount)} onOpenChange={(v) => !v && setEditingAccount(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Update Postingan Terakhir @{editingAccount?.username}
            </DialogTitle>
            <DialogDescription>
              Tempel link postingan/reel Instagram terbaru yang baru saja naik agar seluruh tim dapat memantau.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveQuickUpdate} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Link Post / Reel Instagram Terbaru
              </label>
              <input
                type="text"
                value={editPostUrl}
                onChange={(e) => setEditPostUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/... atau /reel/..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Judul / Caption Singkat Konten
              </label>
              <input
                type="text"
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                placeholder="Contoh: Carousel Edukasi Produk Episode 4"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Status Tayang Hari Ini
              </span>
              <button
                type="button"
                onClick={() => setEditIsLive((v) => !v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  editIsLive ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
                }`}
              >
                {editIsLive ? "Sudah Naik Hari Ini" : "Belum Naik"}
              </button>
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs disabled:opacity-50"
                style={{ background: "var(--accent, #E11D48)" }}
              >
                {savingEdit ? "Menyimpan..." : "Simpan Update"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
