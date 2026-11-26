import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Smile, Sticker, Paperclip, Image as ImageIcon, BarChart3, SendHorizonal, X, Search, Upload, FileText, Plus, Sparkles, Trash2, Palette, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl, uploadFile } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Avatar } from "../../components/common";
import { playSound } from "../../lib/sound";
import { fetchCircleCatalog } from "./CircleFeatureHub";

export const EMOJIS = "😀 😄 😂 🥹 😊 😍 🤩 😎 🤔 😅 😴 😭 😡 👍 👎 👏 🙌 🙏 💪 👀 🔥 ✨ 🎉 💯 ✅ ❌ ❤️ 💙 💜 💚 💛 🧡 ☕ 🍜 🚀 💡 📌 📎 📅 ⏰ 🎨 🎬 📸 📣 🤝 🌿 ⭕".split(" ");

export function StickerTile({ s, size = 96 }) {
  if (s?.file_id) return <img src={fileUrl(s.file_id)} alt={s.name} style={{ width: size, height: size }} className="rounded-2xl object-cover shadow-sm" />;
  return (
    <span className="flex flex-col items-center justify-center rounded-3xl shadow-sm border border-black/5" style={{ width: size, height: size, background: s?.bg || "#FFF0F2" }}>
      <span style={{ fontSize: size * 0.42, lineHeight: 1 }}>{s?.emoji || "✨"}</span>
      <span className="mt-1 max-w-full truncate px-1 text-[10px] font-extrabold uppercase tracking-wide text-[#20283B]" style={{ fontSize: Math.max(9, size * 0.1) }}>{s?.name || "STICKER"}</span>
    </span>
  );
}

const STICKER_DRAFT_KEY = "circle_sticker_draft_v1";

function readStickerDraft() {
  try {
    const raw = localStorage.getItem(STICKER_DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function StickerMaker({ onCreated, onClose }) {
  const { t: tr } = useApp();
  const initialDraft = readStickerDraft();
  const [tab, setTab] = useState(initialDraft?.tab || "custom"); // "custom" | "image"
  const [name, setName] = useState(initialDraft?.name ?? "SIAP MANDAN");
  const [emoji, setEmoji] = useState(initialDraft?.emoji || "🫡");
  const [bg, setBg] = useState(initialDraft?.bg || "#E0F2FE");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STICKER_DRAFT_KEY, JSON.stringify({ tab, name, emoji, bg }));
    } catch {}
  }, [tab, name, emoji, bg]);

  const STICKER_COLORS = [
    "#E0F2FE", "#FEF3C7", "#DCFCE7", "#F3E8FF",
    "#FFEDD5", "#FEE2E2", "#E0E7FF", "#101522"
  ];

  const EMOJI_LIST = ["🫡", "🔥", "👀", "✅", "✏️", "🚀", "🏎️", "👍", "🚨", "☕", "💯", "⏰", "🤝", "😭", "🎉", "💡", "⭐", "💪", "🎨", "🚢", "🐛"];

  const handleCreateCustom = async () => {
    if (!name.trim()) return toast.error("Ketik teks untuk stiker");
    setBusy(true);
    try {
      const { data } = await api.post("/stickers", {
        name: name.trim().toUpperCase(),
        emoji,
        bg,
        category: "Custom",
        pack_id: "pk_custom"
      });
      try { localStorage.removeItem(STICKER_DRAFT_KEY); } catch {}
      toast.success("Stiker kustom berhasil dibuat & tersimpan!");
      onCreated(data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuat stiker"));
    } finally {
      setBusy(false);
    }
  };

  const handleImageUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Pilih file gambar");
    setBusy(true);
    try {
      const up = await uploadFile(f);
      const { data } = await api.post("/stickers", {
        file_id: up.id,
        name: f.name.split(".")[0],
        category: "Custom",
        pack_id: "pk_custom"
      });
      try { localStorage.removeItem(STICKER_DRAFT_KEY); } catch {}
      toast.success("Stiker gambar berhasil ditambahkan!");
      onCreated(data);
      onClose();
    } catch (er) {
      toast.error(errMsg(er, "Gagal mengunggah stiker"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-[320px] sm:w-[360px] p-1 space-y-3" data-testid="sticker-maker-modal">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Sparkles size={16} className="text-brand" /> {tr("chat_sticker_maker_title", "Pembuat Stiker Kustom")}
        </h4>
        <button type="button" onClick={onClose} className="text-sub hover:text-ink"><X size={16} /></button>
      </div>

      <div className="flex rounded-xl bg-surface2 p-1 text-xs font-bold">
        <button
          type="button"
          onClick={() => setTab("custom")}
          className={`flex-1 rounded-lg py-1.5 transition-colors ${tab === "custom" ? "bg-surface text-brand shadow-xs" : "text-sub"}`}
        >
          {tr("chat_sticker_tab_text", "Desain Teks & Emoji")}
        </button>
        <button
          type="button"
          onClick={() => setTab("image")}
          className={`flex-1 rounded-lg py-1.5 transition-colors ${tab === "image" ? "bg-surface text-brand shadow-xs" : "text-sub"}`}
        >
          {tr("chat_sticker_tab_img", "Unggah Gambar")}
        </button>
      </div>

      {tab === "custom" ? (
        <div className="space-y-3">
          {/* Live Preview */}
          <div className="flex flex-col items-center justify-center p-3 rounded-2xl border bg-surface2/40">
            <span className="text-[11px] font-bold text-sub mb-2">{tr("chat_sticker_preview_label", "Live Preview:")}</span>
            <StickerTile s={{ name: name || "TEKS STIKER", emoji, bg }} size={96} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-sub mb-1">{tr("chat_sticker_text_label", "Teks / Pesan Stiker:")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("chat_sticker_text_ph", "mis. SIAP MANDAN, REVISI, APPROVED")}
              maxLength={20}
              className="h-9 w-full rounded-xl border bg-surface px-3 text-xs outline-none focus:border-brand font-semibold"
              data-testid="sticker-name-input"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-sub mb-1">{tr("chat_sticker_emoji_label", "Pilih Ikon Emoji:")}</label>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 border rounded-xl bg-surface">
              {EMOJI_LIST.map((em) => (
                <button
                  type="button"
                  key={em}
                  onClick={() => setEmoji(em)}
                  className={`h-8 w-8 rounded-lg text-base transition-transform hover:scale-110 ${emoji === em ? "bg-brand/10 border border-brand" : "hover:bg-surface2"}`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-sub mb-1">{tr("chat_sticker_bg_label", "Warna Background:")}</label>
            <div className="flex items-center gap-1.5">
              {STICKER_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setBg(c)}
                  className={`h-6 w-6 rounded-full border transition-transform ${bg === c ? "ring-2 ring-brand ring-offset-2 scale-110" : ""}`}
                  style={{ background: c }}
                  aria-label={`Warna ${c}`}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={handleCreateCustom}
            className="btn-accent w-full h-9 rounded-xl text-xs font-bold shadow-xs disabled:opacity-50"
            data-testid="save-custom-sticker-btn"
          >
            {busy ? tr("chat_sticker_saving", "Menyimpan...") : tr("chat_sticker_save_btn", "Simpan & Gunakan Stiker")}
          </button>
        </div>
      ) : (
        <div className="space-y-3 text-center py-4">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 bg-surface2/30">
            <Upload size={28} className="mx-auto text-brand mb-2" />
            <p className="text-xs font-bold text-ink">{tr("chat_sticker_upload_title", "Unggah Gambar dari Perangkat")}</p>
            <p className="text-[11px] text-sub mt-1">{tr("chat_sticker_upload_desc", "Format PNG, JPG, GIF, atau WebP")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="btn-accent mt-3 h-9 px-4 text-xs font-bold"
              data-testid="upload-image-sticker-btn"
            >
              {busy ? tr("chat_sticker_uploading", "Mengunggah...") : tr("chat_sticker_pick_img", "Pilih File Gambar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

let STICKERS_CACHE = null;
try {
  const saved = localStorage.getItem("circle_stickers_cache");
  if (saved) STICKERS_CACHE = JSON.parse(saved);
} catch {}

function normalizeStickerCategory(cat) {
  const raw = String(cat || "").trim();
  return raw.toLowerCase() === "kustom" || raw.toLowerCase() === "custom" ? "Custom" : raw;
}

function StickerPicker({ onPick }) {
  const { subscribe, t: tr } = useApp();
  const [data, setData] = useState(STICKERS_CACHE);
  const [cat, setCat] = useState(() => STICKERS_CACHE?.packs?.[0]?.category || "Kerja & Memes");
  const [q, setQ] = useState("");
  const [makerOpen, setMakerOpen] = useState(false);

  const load = () =>
    api.get("/stickers").then((r) => {
      setData(r.data);
      STICKERS_CACHE = r.data;
      try { localStorage.setItem("circle_stickers_cache", JSON.stringify(r.data)); } catch {}
      if (r.data?.packs?.length) {
        setCat((prev) => {
          const validCats = new Set(r.data.packs.map((p) => p.category || p.name));
          return prev && validCats.has(prev) ? prev : (r.data.packs[0]?.category || "Kerja & Memes");
        });
      }
    }).catch(() => {});

  useEffect(() => {
    load();
    return subscribe?.((e) => {
      if (e?.type === "stickers:changed") load();
    });
  }, [subscribe]);

  if (makerOpen) {
    return (
      <StickerMaker
        onCreated={(stk) => {
          setMakerOpen(false);
          if (stk) {
            setData((prev) => {
              const base = prev || { packs: [], stickers: [] };
              const next = {
                ...base,
                stickers: [stk, ...(base.stickers || []).filter((x) => x.id !== stk.id)]
              };
              STICKERS_CACHE = next;
              try { localStorage.setItem("circle_stickers_cache", JSON.stringify(next)); } catch {}
              return next;
            });
            setCat("Custom");
            load();
            onPick(stk);
          }
        }}
        onClose={() => setMakerOpen(false)}
      />
    );
  }

  if (!data) return <div className="h-64 w-[320px] rounded-2xl bg-surface2" />;

  const byId = Object.fromEntries((data.stickers || []).map((s) => [s.id, s]));
  const cats = [...new Set((data.packs || []).map((p) => p.category || p.name))];
  const normCat = normalizeStickerCategory(cat);
  const list = q
    ? (data.stickers || []).filter(
        (s) => s.name?.toLowerCase().includes(q.toLowerCase()) || s.category?.toLowerCase().includes(q.toLowerCase())
      )
    : (data.stickers || []).filter((s) => {
        const sCat = normalizeStickerCategory(s.category);
        return sCat === normCat || (normCat === "Custom" && s.pack_id === "pk_custom") || (!s.category && cat === "Kerja & Memes");
      });

  const handleDeleteSticker = async (e, stkId) => {
    e.stopPropagation();
    try {
      await api.delete(`/stickers/${stkId}`);
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, stickers: (prev.stickers || []).filter((s) => s.id !== stkId) };
        STICKERS_CACHE = next;
        try { localStorage.setItem("circle_stickers_cache", JSON.stringify(next)); } catch {}
        return next;
      });
      toast.success("Stiker dihapus");
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="w-[310px] sm:w-[350px]" data-testid="sticker-picker">
      <div className="flex items-center gap-2 rounded-xl border bg-surface2 px-2.5">
        <Search size={14} className="text-sub" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("chat_sticker_search_ph", "Cari stiker...")}
          className="h-9 flex-1 bg-transparent text-xs outline-none font-medium"
          data-testid="sticker-search-input"
        />
        <button
          type="button"
          onClick={() => setMakerOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-1 text-[11px] font-bold text-brand hover:bg-brand/20 transition-colors"
          title="Bikin stiker kustom baru"
          data-testid="sticker-create-btn"
        >
          <Plus size={13} />
          <span>{tr("chat_sticker_create_btn", "Bikin")}</span>
        </button>
      </div>

      {!q && (
        <div className="mt-2.5 flex gap-1 overflow-x-auto no-scrollbar pb-1">
          {cats.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCat(c)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold transition-all ${
                cat === c ? "bg-brand text-white shadow-xs" : "bg-surface2 text-sub hover:text-ink"
              }`}
              data-testid={`sticker-cat-${c.replace(/\s/g, "-")}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto scroll-thin p-0.5">
        {list.map((s) => (
          <div key={s.id} className="group relative">
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-center justify-center transition-transform hover:scale-105"
              data-testid={`sticker-${s.id}`}
              title={s.name}
            >
              <StickerTile s={s} size={68} />
            </button>
            {(s.category === "Custom" || s.category === "Kustom") && (
              <button
                type="button"
                onClick={(e) => handleDeleteSticker(e, s.id)}
                className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow-md group-hover:flex"
                title="Hapus stiker kustom"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
        {!list.length && (
          <div className="col-span-4 py-8 text-center">
            <p className="text-xs font-semibold text-sub">{tr("chat_sticker_empty", "Belum ada stiker di kategori ini.")}</p>
            <button
              type="button"
              onClick={() => setMakerOpen(true)}
              className="mt-2 inline-flex items-center gap-1 rounded-xl bg-brand/10 px-3 py-1.5 text-xs font-bold text-brand hover:bg-brand/20"
            >
              <Plus size={13} /> {tr("chat_sticker_create_now", "Buat Stiker Sekarang")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i.test(file.name || "");
}

const Composer = forwardRef(function Composer({ conv, reply, onCancelReply, onSent, onPoll, isCircleConv, onOpenFeatureHub }, forwardedRef) {
  const { me, send, userMap, t: tr } = useApp();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [mentions, setMentions] = useState([]);
  const [mq, setMq] = useState(null);
  const [slashCmds, setSlashCmds] = useState([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState("actions");
  const ta = useRef(null);
  const fileRef = useRef(null);
  const imgRef = useRef(null);
  const lastTyping = useRef(0);
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const circleMode = Boolean(isCircleConv || conv?.id?.startsWith("conv_circle_") || conv?.member_ids?.includes("user_circle_assistant"));

  useEffect(() => {
    if (!circleMode) return;
    let alive = true;
    fetchCircleCatalog().then((cat) => {
      if (alive && Array.isArray(cat?.commands)) setSlashCmds(cat.commands);
    });
    return () => { alive = false; };
  }, [circleMode]);

  useEffect(() => {
    if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = `${Math.min(ta.current.scrollHeight, 160)}px`; }
  }, [text]);

  const focusComposer = useCallback(() => {
    if (!ta.current || conv?.archived || conv?.is_member === false) return;
    if (document.querySelector('[role="dialog"], [data-testid="chat-search-input"]')) return;
    try {
      ta.current.focus({ preventScroll: true });
    } catch {
      ta.current.focus();
    }
    const len = ta.current.value.length;
    try { ta.current.setSelectionRange(len, len); } catch {}
  }, [conv?.archived, conv?.is_member]);

  useEffect(() => {
    if (!conv?.id || conv?.archived || conv?.is_member === false) return;
    let rafId = 0;
    let timerId = 0;
    rafId = requestAnimationFrame(() => {
      focusComposer();
      timerId = setTimeout(() => {
        if (document.activeElement !== ta.current) {
          focusComposer();
        }
      }, 45);
    });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
    };
  }, [conv?.id, conv?.archived, conv?.is_member, focusComposer]);

  useEffect(() => {
    if (!reply?.id) return;
    const rafId = requestAnimationFrame(() => focusComposer());
    return () => cancelAnimationFrame(rafId);
  }, [reply?.id, focusComposer]);

  useEffect(() => {
    const onFocusReq = (ev) => {
      const detail = ev?.detail || {};
      if (detail.conversationId && detail.conversationId !== conv?.id) return;
      requestAnimationFrame(() => focusComposer());
    };
    const onPrefill = (ev) => {
      const detail = ev?.detail || {};
      if (detail.conversationId && detail.conversationId !== conv?.id) return;
      if (typeof detail.text === "string") {
        setText(detail.text);
      }
      requestAnimationFrame(() => {
        if (ta.current) {
          ta.current.focus();
          const len = ta.current.value.length;
          try { ta.current.setSelectionRange(len, len); } catch {}
          ta.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    };
    window.addEventListener("circle:composer-focus", onFocusReq);
    window.addEventListener("circle:composer-prefill", onPrefill);
    return () => {
      window.removeEventListener("circle:composer-focus", onFocusReq);
      window.removeEventListener("circle:composer-prefill", onPrefill);
    };
  }, [conv?.id, focusComposer]);

  const post = async (body) => {
    const tempId = `msg_opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const optimisticMsg = {
      id: tempId,
      conversation_id: conv.id,
      sender_id: me?.user_id || "user_admin1",
      user_id: me?.user_id || "user_admin1",
      text: body.text || "",
      type: body.type || "text",
      sticker_id: body.sticker_id || null,
      sticker: body.sticker || null,
      attachments: body.attachments || [],
      reply_to: reply || null,
      mention_ids: body.mention_ids || [],
      created_at: new Date().toISOString(),
      _optimistic: true
    };
    playSound("message");
    onSent?.(optimisticMsg);
    try {
      const { data } = await api.post(`/conversations/${conv.id}/messages`, body);
      onSent?.(data, tempId);
      return true;
    } catch (e) {
      onSent?.(null, tempId);
      toast.error(errMsg(e));
      return false;
    }
  };
  const submit = async () => {
    if (!text.trim() && !files.length) return;
    if (files.some((f) => f.uploading)) return toast("Tunggu hingga unggahan selesai");
    const msgText = text;
    const msgFiles = files.map((f) => ({ id: f.id, name: f.name, content_type: f.content_type }));
    const msgReply = reply?.id;
    const hasAllMention = /(?<![\p{L}\p{N}._])@semua(?![\p{L}\p{N}_])/iu.test(msgText);
    const convMemberSet = new Set(conv?.member_ids || conv?.members || []);
    const msgMentions = Array.from(
      new Set([
        ...mentions.filter((m) => m !== "__all__" && m !== "semua" && convMemberSet.has(m) && msgText.includes(`@${userMap[m]?.name}`)),
        ...(hasAllMention ? ["semua"] : [])
      ])
    );
    setText("");
    setFiles([]);
    setMentions([]);
    onCancelReply?.();
    await post({ text: msgText, attachments: msgFiles, reply_to: msgReply, mention_ids: msgMentions });
  };
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const m = v.slice(0, e.target.selectionStart).match(/@([\w]*)$/);
    setMq(m ? m[1].toLowerCase() : null);
    if (Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); send({ type: "typing", conversation_id: conv.id }); }
  };
  const pickMention = (u) => {
    const pos = ta.current.selectionStart;
    const tagText = u.isAll ? "@semua " : `@${u.name} `;
    const before = text.slice(0, pos).replace(/@[\w]*$/, tagText);
    setText(before + text.slice(pos));
    setMentions((prev) => Array.from(new Set([...prev, u.isAll ? "semua" : u.user_id])));
    setMq(null);
    ta.current.focus();
  };
  const addFiles = useCallback(async (list) => {
    if (conv?.archived || conv?.is_member === false) return;
    const picked = Array.from(list || []).filter(Boolean);
    if (picked.length === 0) return;

    const entries = picked.map((f) => {
      const imgLike = isImageFile(f);
      return {
        file: f,
        imgLike,
        tmp: {
          key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: f.name || (imgLike ? "gambar.png" : "file"),
          uploading: true,
          content_type: f.type || (imgLike ? "image/png" : ""),
          preview: imgLike ? URL.createObjectURL(f) : null,
        },
      };
    });

    setFiles((x) => [...x, ...entries.map((e) => e.tmp)]);
    requestAnimationFrame(() => focusComposer());

    await Promise.all(
      entries.map(async ({ file, imgLike, tmp }) => {
        try {
          const up = await uploadFile(file);
          setFiles((x) =>
            x.map((y) =>
              y.key === tmp.key
                ? {
                    ...y,
                    ...up,
                    content_type: up?.content_type || up?.mimetype || y.content_type || (imgLike ? "image/png" : "application/octet-stream"),
                    uploading: false,
                  }
                : y
            )
          );
        } catch (e) {
          if (tmp.preview) {
            try { URL.revokeObjectURL(tmp.preview); } catch {}
          }
          toast.error(errMsg(e));
          setFiles((x) => x.filter((y) => y.key !== tmp.key));
        }
      })
    );
  }, [conv?.archived, conv?.is_member, focusComposer]);

  useImperativeHandle(forwardedRef, () => ({
    addFiles,
    focus: focusComposer,
  }), [addFiles, focusComposer]);

  const removeQueuedFile = (target) => {
    if (target?.preview) {
      try { URL.revokeObjectURL(target.preview); } catch {}
    }
    setFiles((prev) => prev.filter((x) => x.key !== target.key));
  };

  const handlePaste = (e) => {
    if (conv?.archived || conv?.is_member === false) return;
    const directFiles = Array.from(e.clipboardData?.files || []).filter(Boolean);
    const fallbackFiles = directFiles.length > 0
      ? directFiles
      : Array.from(e.clipboardData?.items || [])
          .filter((it) => it.kind === "file")
          .map((it) => it.getAsFile())
          .filter(Boolean);
    if (fallbackFiles.length > 0) {
      e.preventDefault();
      addFiles(fallbackFiles);
    }
  };
  const scopedHumanMembers = (conv?.member_ids || conv?.members || [])
    .map((id) => userMap[id])
    .filter((u) => u && u.user_id !== me?.user_id && !u.is_bot && u.role !== "assistant" && u.status !== "suspended" && u.status !== "pending");
  const filteredMembers = mq !== null
    ? scopedHumanMembers.filter((u) => (u.name || "").toLowerCase().includes(mq)).slice(0, 6)
    : [];
  const members = mq !== null && scopedHumanMembers.length > 0 && "semua".includes(mq)
    ? [
        {
          user_id: "__all__",
          name: "semua",
          isAll: true,
          count: scopedHumanMembers.length,
        },
        ...filteredMembers,
      ].slice(0, 6)
    : filteredMembers;
  const slashPrefix = circleMode && text.startsWith("/") && !text.slice(1).includes(" ") ? text.toLowerCase() : null;
  const matchingSlash = slashPrefix !== null
    ? slashCmds.filter((c) => c.command.startsWith(slashPrefix) || c.title.toLowerCase().includes(slashPrefix.slice(1))).slice(0, 8)
    : [];

  const pickSlashCommand = (item) => {
    playSound("pop");
    const val = item.instant ? item.command : (item.template || `${item.command} `);
    setText(val);
    setSlashIndex(0);
    requestAnimationFrame(() => ta.current?.focus());
  };

  return (
    <div className="border-t bg-surface px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:px-4" data-testid="message-composer">
      {reply && <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2 text-xs"><span className="flex-1 truncate">{tr("chat_composer_replying_prefix", "Membalas")} <b>{userMap[reply.sender_id]?.name}</b>: {reply.text}</span><button onClick={onCancelReply} aria-label={tr("common_cancel", "Batal")}><X size={14} /></button></div>}
      {files.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar" data-testid="composer-attachments">
          {files.map((f) => (
            <div key={f.key} className="relative flex h-16 shrink-0 items-center gap-2 rounded-xl border bg-surface2 px-2">
              {f.preview ? <img src={f.preview} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <FileText size={18} className="text-sub" />}
              <span className="max-w-[120px] truncate text-xs">{f.uploading ? tr("chat_composer_uploading", "Mengunggah…") : f.name}</span>
              <button onClick={() => removeQueuedFile(f)} className="absolute -right-1 -top-1 rounded-full bg-ink p-0.5 text-[var(--c-surface)]" aria-label={tr("common_delete", "Hapus")}><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      {members.length > 0 && (
        <div className="mb-2 rounded-xl border bg-surface p-1 shadow-lg" data-testid="mention-suggestions">
          {members.map((u) => (
            <button
              key={u.user_id}
              type="button"
              onClick={() => pickMention(u)}
              className="flex w-full items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-surface2 cursor-pointer"
              data-testid={`chat-mention-${u.user_id}`}
            >
              {u.isAll ? (
                <>
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                    <Users size={12} />
                  </span>
                  <span className="font-semibold text-brand">@semua</span>
                  <span className="ml-auto text-[11px] text-sub">
                    {conv?.type === "group" ? `Semua anggota grup (${u.count})` : "Tag semua"}
                  </span>
                </>
              ) : (
                <>
                  <Avatar user={u} size={22} showStatus={false} />
                  <span>{u.name}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {matchingSlash.length > 0 && (
        <div className="mb-2 max-h-60 overflow-y-auto rounded-2xl border border-subtle bg-surface p-1.5 shadow-xl scroll-thin" data-testid="circle-slash-autocomplete">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sub">
            {tr("chat_composer_slash_hint", "Perintah Cepat Asli")} ({matchingSlash.length}) {tr("chat_composer_slash_sub", "· Tab/Klik untuk pilih")}
          </div>
          {matchingSlash.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pickSlashCommand(item)}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                idx === (slashIndex % matchingSlash.length) ? "bg-brand/10 text-ink" : "hover:bg-surface2 text-ink"
              }`}
              data-testid={`slash-opt-${item.id}`}
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono font-bold text-brand">{item.command}</span>
                <span className="ml-2 font-semibold text-ink">{item.title}</span>
                <p className="truncate text-[11px] text-sub">{item.description}</p>
              </div>
              <span className="shrink-0 rounded-lg bg-surface2 px-2 py-0.5 text-[10px] font-semibold text-sub">{item.category}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 sm:gap-1.5 rounded-2xl border bg-surface2 p-1.5">
        <div className="flex shrink-0 items-center">
          {circleMode && onOpenFeatureHub && (
            <button
              type="button"
              onClick={onOpenFeatureHub}
              className="btn-ghost hidden sm:flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center text-brand hover:bg-brand/10"
              title="Jelajahi 60+ Fitur ASLI AI"
              aria-label="Fitur ASLI AI"
              data-testid="composer-circle-hub-btn"
            >
              <Sparkles size={19} />
            </button>
          )}

          {/* Mobile consolidated '+' tools menu so textarea gets generous width */}
          <Popover open={mobileToolsOpen} onOpenChange={(o) => { if (o) playSound("pop"); setMobileToolsOpen(o); if (o) setMobileTab("actions"); }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="btn-ghost flex h-9 w-9 items-center justify-center text-sub hover:text-ink sm:hidden"
                aria-label="Lampiran, emoji, & stiker"
                data-testid="mobile-composer-tools-btn"
              >
                <Plus size={19} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-1.5rem))] bg-surface p-2.5 sm:hidden" align="start" sideOffset={8}>
              <div className="mb-2 flex gap-1 rounded-xl bg-surface2 p-1 text-xs font-semibold">
                <button type="button" onClick={() => setMobileTab("actions")} className={`flex-1 rounded-lg py-1.5 transition-colors ${mobileTab === "actions" ? "bg-surface text-ink shadow-xs font-bold" : "text-sub"}`}>{tr("chat_composer_mobile_menu", "Menu")}</button>
                <button type="button" onClick={() => setMobileTab("emoji")} className={`flex-1 rounded-lg py-1.5 transition-colors ${mobileTab === "emoji" ? "bg-surface text-ink shadow-xs font-bold" : "text-sub"}`}>{tr("chat_composer_mobile_emoji", "Emoji")}</button>
                <button type="button" onClick={() => setMobileTab("sticker")} className={`flex-1 rounded-lg py-1.5 transition-colors ${mobileTab === "sticker" ? "bg-surface text-ink shadow-xs font-bold" : "text-sub"}`}>{tr("chat_composer_mobile_sticker", "Stiker")}</button>
              </div>
              {mobileTab === "actions" && (
                <div className={`grid gap-2 ${conv.type === "group" ? "grid-cols-3" : "grid-cols-2"}`}>
                  <button
                    type="button"
                    onClick={() => { setMobileToolsOpen(false); imgRef.current?.click(); }}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface2/60 py-3 text-xs font-semibold text-ink hover:bg-surface2"
                    data-testid="mobile-attach-image-btn"
                  >
                    <ImageIcon size={18} className="text-brand" />
                    <span>{tr("chat_composer_photo", "Foto")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMobileToolsOpen(false); fileRef.current?.click(); }}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface2/60 py-3 text-xs font-semibold text-ink hover:bg-surface2"
                    data-testid="mobile-attach-file-btn"
                  >
                    <Paperclip size={18} className="text-blue-500" />
                    <span>{tr("chat_composer_file", "File")}</span>
                  </button>
                  {conv.type === "group" && (
                    <button
                      type="button"
                      onClick={() => { setMobileToolsOpen(false); onPoll?.(); }}
                      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface2/60 py-3 text-xs font-semibold text-ink hover:bg-surface2"
                      data-testid="mobile-composer-poll-btn"
                    >
                      <BarChart3 size={18} className="text-emerald-500" />
                      <span>{tr("chat_composer_poll", "Polling")}</span>
                    </button>
                  )}
                </div>
              )}
              {mobileTab === "emoji" && (
                <div className="grid max-h-52 grid-cols-8 gap-1 overflow-y-auto" data-testid="mobile-emoji-picker">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => { playSound("pop"); setText((t) => t + e); }}
                      className="flex h-8 w-full items-center justify-center rounded-lg text-lg hover:bg-surface2"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              {mobileTab === "sticker" && (
                <StickerPicker onPick={(s) => { setMobileToolsOpen(false); post({ type: "sticker", sticker_id: s.id, sticker: s, reply_to: reply?.id }).then((ok) => ok && onCancelReply?.()); }} />
              )}
            </PopoverContent>
          </Popover>

          {/* Desktop inline toolbar */}
          <div className="hidden sm:flex items-center">
            <Popover><PopoverTrigger asChild><button className="btn-ghost flex h-10 w-10 items-center justify-center text-sub" aria-label="Emoji" data-testid="emoji-picker-btn"><Smile size={19} /></button></PopoverTrigger>
              <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] bg-surface p-2" align="start"><div className="grid grid-cols-8 gap-1" data-testid="emoji-picker">{EMOJIS.map((e) => <button key={e} onClick={() => { playSound("pop"); setText((t) => t + e); }} className="h-8 rounded-lg text-lg hover:bg-surface2">{e}</button>)}</div></PopoverContent></Popover>
            <Popover><PopoverTrigger asChild><button className="btn-ghost flex h-10 w-10 items-center justify-center text-sub" aria-label="Stiker" data-testid="sticker-picker-btn"><Sticker size={19} /></button></PopoverTrigger>
              <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] bg-surface p-3" align="start"><StickerPicker onPick={(s) => post({ type: "sticker", sticker_id: s.id, sticker: s, reply_to: reply?.id }).then((ok) => ok && onCancelReply?.())} /></PopoverContent></Popover>
            <button type="button" onClick={() => imgRef.current.click()} className="btn-ghost flex h-10 w-10 items-center justify-center text-sub" aria-label="Lampirkan gambar" data-testid="attach-image-btn"><ImageIcon size={19} /></button>
            <button type="button" onClick={() => fileRef.current.click()} className="btn-ghost flex h-10 w-10 items-center justify-center text-sub" aria-label="Lampirkan file" data-testid="attach-file-btn"><Paperclip size={19} /></button>
            {conv.type === "group" && <button type="button" onClick={onPoll} className="btn-ghost flex h-10 w-10 items-center justify-center text-sub hover:text-brand" title="Buat Polling" aria-label="Buat polling" data-testid="composer-poll-btn"><BarChart3 size={19} /></button>}
          </div>

          <input ref={imgRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} data-testid="attach-file-input" />
        </div>
        <textarea ref={ta} rows={1} value={text} onPaste={handlePaste} onChange={(e) => { setSlashIndex(0); onChange(e); }} placeholder={conv.archived ? tr("chat_composer_ph_archived", "Grup ini telah diarsipkan") : circleMode ? tr("chat_composer_ph_circle", "Tanya atau ketik / perintah…") : tr("chat_composer_ph_default", "Tulis pesan…")} disabled={conv.archived}
          onKeyDown={(e) => {
            if (matchingSlash.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => (i + 1) % matchingSlash.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => (i - 1 + matchingSlash.length) % matchingSlash.length); return; }
              if (e.key === "Tab") { e.preventDefault(); pickSlashCommand(matchingSlash[slashIndex % matchingSlash.length]); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          enterKeyHint="send" className="max-h-40 min-h-[38px] sm:min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none" data-testid="message-input" />
        <button onClick={submit} disabled={busy} className="btn-accent flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center disabled:opacity-50" aria-label="Kirim" data-testid="send-message-btn"><SendHorizonal size={18} /></button>
      </div>
    </div>
  );
});

export default Composer;
