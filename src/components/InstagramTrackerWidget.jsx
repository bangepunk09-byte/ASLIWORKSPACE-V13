import { useCallback, useEffect, useState } from "react";
import {
  Instagram,
  Plus,
  RefreshCw,
  ExternalLink,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Play,
  Layers,
  ImageOff,
  Loader2,
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

const IG_CACHE_KEY = "circle_instagram_tracker_cache_v3";

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
  if (!isoStr) return "Baru saja";
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

function buildProxyMediaUrl(rawUrl, shortcode) {
  if (rawUrl) {
    return `/api/instagram-tracker/media?url=${encodeURIComponent(rawUrl)}`;
  }
  if (shortcode) {
    return `/api/instagram-tracker/media?shortcode=${encodeURIComponent(shortcode)}`;
  }
  return "";
}

function IgAccountAvatar({ account }) {
  const [imgFailed, setImgFailed] = useState(false);
  const rawAvatar = account?.avatar_url;
  const hasDiskCache = Boolean(account?.has_cached_avatar);
  const cacheVer = account?.avatar_cached_at || account?.last_checked_at || "";
  const src =
    rawAvatar || hasDiskCache
      ? `/api/instagram-tracker/media?username=${encodeURIComponent(account?.username || "")}${
          rawAvatar ? `&url=${encodeURIComponent(rawAvatar)}` : ""
        }${cacheVer ? `&v=${encodeURIComponent(String(cacheVer))}` : ""}`
      : "";
  const initials = String(account?.display_name || account?.username || "IG")
    .replace(/^@/, "")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={`@${account.username}`}
        onError={() => setImgFailed(true)}
        referrerPolicy="no-referrer"
        className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
      />
    );
  }

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-fuchsia-600 text-xs font-bold text-white shadow-2xs"
      aria-hidden="true"
    >
      {initials || <Instagram className="h-4 w-4" />}
    </div>
  );
}

function IgLatestPostPreview({ account, shortcode, targetUrl, isRefreshing }) {
  const primarySrc = buildProxyMediaUrl(account?.latest_thumb || "", shortcode);
  const fallbackSrc = shortcode ? buildProxyMediaUrl("", shortcode) : "";
  const [imgSrc, setImgSrc] = useState(primarySrc);
  const [failedAll, setFailedAll] = useState(false);

  useEffect(() => {
    setImgSrc(primarySrc || fallbackSrc);
    setFailedAll(!(primarySrc || fallbackSrc));
  }, [primarySrc, fallbackSrc]);

  const handleImageError = () => {
    if (fallbackSrc && imgSrc !== fallbackSrc) {
      setImgSrc(fallbackSrc);
    } else {
      setFailedAll(true);
    }
  };

  if (!shortcode && !account?.latest_thumb) {
    return (
      <a
        href={targetUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative flex aspect-[3/4] w-full flex-col items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-dashed border-border bg-surface2/45 px-5 text-center transition-colors hover:bg-surface2/75"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-surface text-sub">
          {isRefreshing ? (
            <Loader2 size={20} className="animate-spin text-brand" />
          ) : (
            <Instagram size={20} className="text-rose-500" />
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-ink">
            {isRefreshing ? "Mengambil postingan terbaru..." : "Belum ada postingan publik"}
          </p>
          <p className="mt-0.5 text-[11px] text-sub">
            {isRefreshing
              ? `Memeriksa @${account.username}`
              : `Akun @${account.username} belum memiliki unggahan publik yang terbaca`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-brand group-hover:underline">
          <span>Buka @{account.username}</span>
          <ExternalLink size={11} />
        </span>
      </a>
    );
  }

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-border/80 bg-surface2/50"
    >
      {!failedAll && imgSrc ? (
        <img
          src={imgSrc}
          alt={account?.latest_caption || `Postingan terakhir @${account.username}`}
          onError={handleImageError}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover object-center transition-transform duration-200 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
          <ImageOff size={24} className="text-sub" />
          <p className="text-xs font-semibold text-ink">Pratinjau gambar tidak tersedia</p>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand group-hover:underline">
            <span>Lihat di Instagram</span>
            <ExternalLink size={11} />
          </span>
        </div>
      )}

      {/* Subtle format indicator without carousel slider controls */}
      {(account?.latest_is_video || (account?.latest_media_count || 1) > 1) && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-semibold text-white">
          {account?.latest_is_video ? (
            <>
              <Play size={11} className="fill-white" />
              <span>Reel / Video</span>
            </>
          ) : (
            <>
              <Layers size={11} />
              <span>1/{account.latest_media_count}</span>
            </>
          )}
        </div>
      )}
    </a>
  );
}

export default function InstagramTrackerWidget() {
  const { subscribe } = useApp();
  const [accounts, setAccounts] = useState(() => readCachedAccounts());
  const [refreshingId, setRefreshingId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Add Account Modal
  const [addOpen, setAddOpen] = useState(false);
  const [quickInput, setQuickInput] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Edit Account Modal
  const [editingAccount, setEditingAccount] = useState(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPostUrl, setEditPostUrl] = useState("");
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

  const handleRefreshSingle = async (acc) => {
    setRefreshingId(acc.id);
    try {
      const { data } = await api.post(`/instagram-tracker/${acc.id}/refresh`, {
        username: acc.username,
        profile_url: acc.profile_url,
        forceAvatar: !acc.avatar_url,
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      void syncWorkspaceMirror(api, true);
      toast.success(`Postingan terakhir @${acc.username} diperbarui`);
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
      const { data } = await api.post("/instagram-tracker/refresh-all");
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      } else {
        await loadAccounts();
      }
      void syncWorkspaceMirror(api, true);
      toast.success("Semua akun Instagram berhasil diperbarui");
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui akun Instagram"));
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleMoveCard = async (index, delta) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= accounts.length) return;
    const reordered = [...accounts];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, moved);
    commitAccounts(reordered);
    try {
      const { data } = await api.patch("/instagram-tracker/reorder", {
        ids: reordered.map((a) => a.id),
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      void syncWorkspaceMirror(api, true);
    } catch {
      loadAccounts();
    }
  };

  const handleQuickAddAccount = async (e) => {
    e.preventDefault();
    const raw = quickInput.trim();
    if (!raw) {
      toast.error("Tempel link profil Instagram (contoh: https://www.instagram.com/bank.abdi/)");
      return;
    }
    setSubmittingAdd(true);
    try {
      const { data } = await api.post("/instagram-tracker", {
        username: raw,
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      playSound("success");
      const addedAcc = data?.account;
      if (addedAcc?.latest_shortcode) {
        toast.success(
          data?.updated
            ? `Postingan terakhir @${addedAcc.username} diperbarui`
            : `Postingan terakhir @${addedAcc.username} berhasil ditampilkan`
        );
      } else {
        toast.info(`@${addedAcc?.username || "Akun"} ditambahkan (belum ada postingan publik yang terbaca)`);
      }
      setQuickInput("");
      setAddOpen(false);
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menambahkan akun Instagram"));
    } finally {
      setSubmittingAdd(false);
    }
  };

  const openEditModal = (acc) => {
    setEditingAccount(acc);
    setEditUsername(acc.profile_url || acc.username || "");
    setEditPostUrl(
      acc.latest_post_url && /\/(?:p|reel|tv)\//i.test(acc.latest_post_url)
        ? acc.latest_post_url
        : ""
    );
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingAccount) return;
    if (!editUsername.trim() && !editPostUrl.trim()) {
      toast.error("Masukkan link profil atau username Instagram yang valid");
      return;
    }
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/instagram-tracker/${editingAccount.id}`, {
        username: editUsername.trim(),
        latest_post_url: editPostUrl.trim(),
      });
      if (Array.isArray(data?.accounts)) {
        commitAccounts(data.accounts);
      }
      setEditingAccount(null);
      playSound("success");
      toast.success("Akun Instagram diperbarui");
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan perubahan"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteAccount = async (acc) => {
    recordDeletedEntityIds([acc.id]);
    commitAccounts(accounts.filter((a) => a.id !== acc.id));
    toast.success(`@${acc.username} dihapus`);
    try {
      await api.delete(`/instagram-tracker/${acc.id}`);
      void syncWorkspaceMirror(api, true);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus akun Instagram"));
      loadAccounts();
    }
  };

  return (
    <section
      className="card w-full min-w-0 overflow-hidden p-4 sm:p-6"
      data-testid="instagram-tracker-widget"
    >
      {/* Compact Single-Row Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug text-ink">
            <Instagram size={19} className="text-rose-500 shrink-0" />
            <span className="truncate py-0.5">Postingan Terakhir Instagram</span>
          </h3>
          <span className="text-xs sm:text-sm font-medium text-sub tabular-nums">
            · {accounts.length} akun
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            data-testid="ig-open-add-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface2/75 px-3 text-xs sm:text-sm font-semibold text-ink shadow-xs transition-colors hover:bg-surface2 cursor-pointer shrink-0"
          >
            <Plus size={14} />
            <span>Tambah Akun</span>
          </button>
          {accounts.length > 0 && (
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              data-testid="ig-refresh-all-btn"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface2/75 px-3 text-xs sm:text-sm font-semibold text-ink shadow-xs transition-colors hover:bg-surface2 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <RefreshCw size={14} className={refreshingAll ? "animate-spin" : ""} />
              <span>{refreshingAll ? "Menyegarkan..." : "Refresh Semua"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Side-by-Side 3-Column Card Grid (Fit Fix, Zero Slider, Zero Scrollbar) */}
      {accounts.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface2/30 px-6 py-10 text-center">
          <Instagram size={28} className="text-sub mb-2.5" />
          <p className="text-sm font-bold text-ink">Belum ada akun Instagram ditampilkan</p>
          <p className="mt-1 max-w-md text-xs text-sub">
            Tambahkan profil Instagram untuk menampilkan postingan terakhirnya di sini.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="btn-accent mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs sm:text-sm font-semibold text-white shadow-xs cursor-pointer"
          >
            <Plus size={14} />
            <span>Tambah Akun Instagram</span>
          </button>
        </div>
      ) : (
        <div
          className="mt-4 sm:mt-5 grid grid-cols-1 gap-3.5 sm:gap-4 md:grid-cols-2 xl:grid-cols-3 min-w-0"
          data-testid="ig-accounts-grid"
        >
          {accounts.map((acc, idx) => {
            const shortcode = acc.latest_shortcode || extractShortcodeFromUrl(acc.latest_post_url);
            const targetUrl =
              acc.latest_post_url ||
              (shortcode ? `https://www.instagram.com/p/${shortcode}/` : "") ||
              acc.profile_url ||
              `https://www.instagram.com/${acc.username}/`;

            const cleanDisplayName = String(acc.display_name || "").trim();
            const hasDistinctDisplayName = Boolean(
              cleanDisplayName &&
                cleanDisplayName.replace(/^@/, "").toLowerCase() !== String(acc.username || "").toLowerCase()
            );
            const displayTitle = hasDistinctDisplayName ? cleanDisplayName : `@${acc.username}`;

            return (
              <article
                key={acc.id}
                data-testid={`ig-card-${acc.username}`}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-surface p-4 min-w-0"
              >
                {/* Card Top Header */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <a
                    href={acc.profile_url || `https://www.instagram.com/${acc.username}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 min-w-0 group"
                  >
                    <IgAccountAvatar account={acc} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink group-hover:text-brand transition-colors">
                        {displayTitle}
                      </p>
                      {hasDistinctDisplayName && (
                        <p className="truncate text-xs text-sub">@{acc.username}</p>
                      )}
                    </div>
                  </a>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {accounts.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleMoveCard(idx, -1)}
                          disabled={idx === 0}
                          title="Geser ke kiri"
                          aria-label={`Geser @${acc.username} ke kiri`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveCard(idx, 1)}
                          disabled={idx === accounts.length - 1}
                          title="Geser ke kanan"
                          aria-label={`Geser @${acc.username} ke kanan`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditModal(acc)}
                      title="Ubah link profil atau postingan"
                      aria-label={`Ubah @${acc.username}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink cursor-pointer transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRefreshSingle(acc)}
                      disabled={refreshingId === acc.id}
                      title="Muat ulang postingan terakhir"
                      aria-label={`Refresh @${acc.username}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <RefreshCw
                        size={13}
                        className={refreshingId === acc.id ? "animate-spin" : ""}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAccount(acc)}
                      title="Hapus akun ini"
                      aria-label={`Hapus @${acc.username}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 cursor-pointer transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Fit-Fix Single Latest Upload Preview (No Scrollbar, No Slider) */}
                <IgLatestPostPreview
                  account={acc}
                  shortcode={shortcode}
                  targetUrl={targetUrl}
                  isRefreshing={refreshingId === acc.id}
                />

                {/* Fixed-Height Caption Summary (Zero Scroll) */}
                <div className="min-h-[3.25rem]">
                  {acc.latest_caption ? (
                    <p className="line-clamp-3 text-xs leading-relaxed text-ink/90 break-words">
                      {acc.latest_caption}
                    </p>
                  ) : (
                    <p className="text-xs italic text-sub">
                      {shortcode
                        ? "Postingan tanpa keterangan teks."
                        : "Klik refresh atau buka profil Instagram untuk cek langsung."}
                    </p>
                  )}
                </div>

                {/* Clean Card Footer */}
                <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs min-w-0">
                  <span className="truncate text-[11px] text-sub tabular-nums">
                    {acc.latest_posted_at
                      ? `Diunggah ${formatRelativeTimeId(acc.latest_posted_at)}`
                      : acc.last_checked_at
                      ? `Dicek ${formatRelativeTimeId(acc.last_checked_at)}`
                      : "Siap dicek"}
                  </span>
                  <a
                    href={targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand hover:underline whitespace-nowrap"
                  >
                    <span>{shortcode ? "Buka Postingan" : "Buka Instagram"}</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal Tambah Akun Instagram */}
      <Dialog open={addOpen} onOpenChange={(v) => !submittingAdd && setAddOpen(v)}>
        <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl sm:max-w-md p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Tambah Akun Instagram</DialogTitle>
            <DialogDescription>
              Tempel link profil atau username Instagram untuk menampilkan postingan terakhirnya.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleQuickAddAccount} className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-sub">
                Link Profil atau Username Instagram *
              </label>
              <input
                type="text"
                autoFocus
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                placeholder="https://www.instagram.com/bank.abdi/"
                disabled={submittingAdd}
                data-testid="ig-quick-link-input"
                className="h-10 w-full rounded-xl border border-border bg-surface2/75 px-3.5 text-sm text-ink outline-none focus:border-brand"
              />
            </div>
            <DialogFooter className="pt-2">
              <button
                type="button"
                disabled={submittingAdd}
                onClick={() => setAddOpen(false)}
                className="h-10 rounded-xl border border-border bg-surface2/75 px-4 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submittingAdd}
                data-testid="ig-add-account-btn"
                className="btn-accent inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-xs sm:text-sm font-semibold text-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {submittingAdd ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{submittingAdd ? "Mengambil Postingan..." : "Tampilkan Postingan"}</span>
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Edit Akun Instagram (Minimalis) */}
      <Dialog open={Boolean(editingAccount)} onOpenChange={(v) => !v && setEditingAccount(null)}>
        <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl sm:max-w-md p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Ubah Akun Instagram</DialogTitle>
            <DialogDescription>
              Ganti link profil Instagram atau biarkan sistem mengambil postingan terakhir secara otomatis.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-sub">
                Link Profil atau Username Instagram *
              </label>
              <input
                type="text"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="https://www.instagram.com/bank.abdi/"
                className="h-10 w-full rounded-xl border border-border bg-surface2/75 px-3.5 text-sm text-ink outline-none focus:border-brand"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-sub">
                  Override Link Postingan (Opsional)
                </label>
                {editPostUrl && (
                  <button
                    type="button"
                    onClick={() => setEditPostUrl("")}
                    className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
                  >
                    Ambil Otomatis
                  </button>
                )}
              </div>
              <input
                type="text"
                value={editPostUrl}
                onChange={(e) => setEditPostUrl(e.target.value)}
                placeholder="Kosongkan untuk ambil postingan terakhir otomatis"
                className="h-10 w-full rounded-xl border border-border bg-surface2/75 px-3.5 text-sm text-ink outline-none focus:border-brand"
              />
            </div>

            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="h-10 rounded-xl border border-border bg-surface2/75 px-4 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="btn-accent h-10 rounded-xl px-4 text-xs sm:text-sm font-semibold text-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {savingEdit ? "Menyimpan..." : "Simpan"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
