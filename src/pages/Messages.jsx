import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Search, MessageCircle, ShieldCheck, Trash2, LogOut, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg } from "../lib/api";
import { playSound } from "../lib/sound";
import { Avatar, Empty, fmtTime, GroupIcon } from "../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import ChatView, { hydrateConversationsCache, upsertConversationInCache, appendMessageToCache, updateMessageInCache } from "./chat/ChatView";
import { removeConversationFromCache, clearConversationMessagesCache, removeGroupFromCache } from "../lib/workspaceCaches";

function NewDM({ open, onOpenChange, convs, onCreated }) {
  const { users, me, t: tr } = useApp();
  const [q, setQ] = useState("");
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();
  const start = async (uid) => {
    if (starting) return;
    onOpenChange(false);
    // Check if DM with uid already exists in memory for 0ms navigation
    const existing = (convs || []).find((c) => {
      if (!c || c.type !== "dm" || String(c.id).startsWith("conv_circle_")) return false;
      const mems = c.member_ids || c.members || [];
      return mems.includes(uid) && mems.includes(me?.user_id);
    });
    if (existing) {
      navigate(`/messages/${existing.id}`);
      return;
    }
    setStarting(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: uid });
      if (data && data.id) {
        upsertConversationInCache(data, me?.user_id);
        onCreated?.(data);
        navigate(`/messages/${data.id}`);
      }
    } catch (e) {
      toast.error(errMsg(e, tr("messages_new_dm_err", "Gagal memulai pesan langsung")));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl max-w-md">
        <DialogHeader><DialogTitle>{tr("messages_new_dm_title", "Pesan Baru")}</DialogTitle></DialogHeader>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("messages_new_dm_search_ph", "Cari rekan kerja…")} className="h-11 rounded-xl border bg-surface2 px-3 text-sm outline-none" data-testid="new-dm-search" />
        <div className="max-h-80 overflow-y-auto">
          {(users || []).filter((u) => u.user_id !== me?.user_id && (u.name || "").toLowerCase().includes(q.toLowerCase())).map((u) => (
            <button key={u.user_id} disabled={starting} onClick={() => start(u.user_id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface2 disabled:opacity-50" data-testid={`new-dm-user-${u.user_id}`}>
              <Avatar user={u} size={34} /><span><span className="block text-sm font-semibold">{u.name}</span><span className="block text-xs text-sub">{u.job_title}</span></span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getDefaultConvsForUser(user) {
  const userId = user?.user_id || "user_admin1";
  return [
    {
      id: `conv_circle_${userId}`,
      type: "dm",
      name: "Circle",
      member_ids: ["user_circle_assistant", userId],
      unread: 0,
      last_message_preview: "Halo! Saya Circle, asisten workspace Anda.",
      last_message_at: new Date().toISOString()
    }
  ];
}

export default function Messages() {
  const { cid } = useParams();
  const { me, userMap, subscribe, ws, isAdmin, t } = useApp();
  const [convs, setConvs] = useState(() => {
    try {
      const uid = me?.user_id;
      if (uid) {
        const saved = localStorage.getItem(`circle_convs_cache_${uid}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch {}
    return getDefaultConvsForUser(me);
  });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [dm, setDm] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingChat, setDeletingChat] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const load = useCallback(() => {
    if (!me?.user_id) return Promise.resolve();
    return api.get("/conversations").then((r) => {
      const arr = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.conversations) ? r.data.conversations : null);
      if (Array.isArray(arr)) {
        setConvs(arr);
        hydrateConversationsCache(arr, me.user_id);
      }
    }).catch(() => {});
  }, [me?.user_id]);

  // Load conversations once per logged-in user (NOT on every cid click)
  useEffect(() => {
    if (!me?.user_id) return;
    try {
      const saved = localStorage.getItem(`circle_convs_cache_${me.user_id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConvs(parsed);
        } else {
          setConvs(getDefaultConvsForUser(me));
        }
      } else {
        setConvs(getDefaultConvsForUser(me));
      }
    } catch {}
    load();
  }, [me?.user_id, me?.department, load]);

  // Clear unread badge in 0ms when opening a conversation
  const handleRead = useCallback((readCid) => {
    if (!readCid) return;
    setConvs((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const target = list.find((c) => c && c.id === readCid);
      if (!target || !target.unread) return list;
      const next = list.map((c) => (c && c.id === readCid ? { ...c, unread: 0 } : c));
      if (me?.user_id) {
        try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
      }
      return next;
    });
  }, [me?.user_id]);

  useEffect(() => {
    if (cid) handleRead(cid);
  }, [cid, handleRead]);

  const handleLeftGroup = useCallback((leftCid) => {
    if (!leftCid) return;
    removeConversationFromCache(leftCid, me?.user_id);
    removeGroupFromCache(leftCid, me?.user_id);
    setConvs((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((c) => c && c.id !== leftCid);
      if (me?.user_id) {
        try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
      }
      return next;
    });
    load();
  }, [me?.user_id, load]);

  useEffect(() => subscribe((e) => { 
    if (e.type === "message:new" && e.data) {
      const d = e.data;
      if (Array.isArray(d?.member_ids) && me?.user_id && !d.member_ids.includes(me.user_id)) {
        return;
      }
      appendMessageToCache(d);
      let foundInList = false;
      setConvs((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((c) => c && c.id === d.conversation_id);
        if (idx !== -1) {
          foundInList = true;
          const curMsgs = Array.isArray(list[idx].messages) ? list[idx].messages : [];
          const nextMsgs = curMsgs.some((m) => m.id === d.id) ? curMsgs : [...curMsgs, d];
          const previewVal = d.type === "sticker"
            ? t("messages_sticker_preview", "[Stiker]")
            : d.type === "sticky_note"
            ? `📌 ${d.sticky_note?.title || "Sticky Note"} (${d.sticky_note?.progress ?? 0}%)`
            : (d.text || t("messages_new_msg_preview", "Pesan baru"));
          const updated = {
            ...list[idx],
            messages: nextMsgs,
            last_message_preview: previewVal,
            last_message_at: d.created_at || new Date().toISOString(),
            unread: d.sender_id !== me?.user_id && cid !== d.conversation_id ? (list[idx].unread || 0) + 1 : 0
          };
          const next = [updated, ...list.filter((c) => c && c.id !== d.conversation_id)];
          if (me?.user_id) {
            try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
          }
          return next;
        }
        return list;
      });
      if (!foundInList) {
        load();
      }
    } else if (e.type === "message:update") {
      updateMessageInCache(e.data);
    } else if (e.type === "read" && e.data) {
      if (e.data.user_id === me?.user_id) {
        handleRead(e.data.conversation_id);
      }
    } else if ((e.type === "conversation:upsert" || e.type === "group:updated") && e.data) {
      const d = e.data;
      const mems = Array.isArray(d.member_ids) ? d.member_ids : (Array.isArray(d.members) ? d.members : null);
      const isLeft =
        (e.left_user_id && e.left_user_id === me?.user_id) ||
        (d.left_user_id && d.left_user_id === me?.user_id) ||
        (me?.user_id && mems && !mems.includes(me.user_id) && !String(d.id || "").startsWith("conv_circle_")) ||
        d.is_member === false;
      if (isLeft) {
        removeConversationFromCache(d.id, me?.user_id);
        setConvs((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((c) => c && c.id !== d.id);
          if (me?.user_id) {
            try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
          }
          return next;
        });
        return;
      }
      upsertConversationInCache(d, me?.user_id);
      setConvs((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((c) => c && c.id === d.id);
        const next = idx !== -1
          ? list.map((c, i) => (i === idx ? { ...c, ...d } : c))
          : [d, ...list];
        if (me?.user_id) {
          try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
        }
        return next;
      });
    } else if (e.type === "group:deleted" && e.id) {
      removeConversationFromCache(e.id, me?.user_id);
      setConvs((prev) => {
        const next = (Array.isArray(prev) ? prev : []).filter((c) => c && c.id !== e.id);
        if (me?.user_id) {
          try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
        }
        return next;
      });
    } else if (e.type === "conversation:deleted" && e.id) {
      if (e.is_circle_clear) {
        clearConversationMessagesCache(e.id, me?.user_id);
        setConvs((prev) =>
          (Array.isArray(prev) ? prev : []).map((c) =>
            c && c.id === e.id ? { ...c, messages: [], unread: 0, last_message_preview: "Asisten Workspace & Notifikasi Approval" } : c
          )
        );
      } else {
        removeConversationFromCache(e.id, me?.user_id);
        if (e.conv_type === "group") removeGroupFromCache(e.id, me?.user_id);
        setConvs((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((c) => c && c.id !== e.id);
          if (me?.user_id) {
            try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
          }
          return next;
        });
        if (cid === e.id) navigate("/messages", { replace: true });
      }
    } else if (["conversation:new", "conversations:changed", "access_requests:changed"].includes(e.type)) {
      load();
    }
  }), [subscribe, me?.user_id, cid, load, handleRead, navigate]);

  const safeConvs = Array.isArray(convs) ? convs : [];
  const named = useMemo(() => safeConvs
    .filter((c) => {
      if (!c) return false;
      if (c.is_member === false) return false;
      const mems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : null);
      if (me?.user_id && !String(c.id || "").startsWith("conv_circle_") && mems && !mems.includes(me.user_id)) {
        return false;
      }
      return true;
    })
    .map((c) => {
      const mems = Array.isArray(c.member_ids) ? c.member_ids : (Array.isArray(c.members) ? c.members : []);
      const otherId = mems.find((x) => x && x !== me?.user_id) || me?.user_id;
      const botAvatar = ws?.assistant_avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=CircleWorkspace&backgroundColor=FF5364";
      const botName = ws?.assistant_name || "Circle";

      const isBotDM = c.type === "dm" && (otherId === "user_circle_assistant" || c.id?.startsWith("conv_circle_"));
      const rawOther = userMap ? userMap[otherId] : null;
      const other = c.type === "dm" ? (
        isBotDM ? {
          ...(rawOther || {}),
          user_id: "user_circle_assistant",
          name: botName,
          job_title: t("messages_assistant_role", "Asisten AI Workspace"),
          avatar: botAvatar,
          picture: botAvatar
        } : rawOther
      ) : null;

      let title = c.name || t("messages_default_group_title", "Grup Chat");
      if (c.type === "dm") title = other?.name || (isBotDM ? botName : (c.name && c.name !== "Direct Message" ? c.name : t("messages_default_dm_title", "Pesan Langsung")));

      const msgs = Array.isArray(c.messages) ? c.messages : [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const previewText = c.last_message_preview && c.last_message_preview !== "No messages yet" && c.last_message_preview !== "Belum ada pesan"
        ? c.last_message_preview
        : (lastMsg
            ? (lastMsg.type === "sticker"
                ? t("messages_sticker_preview", "[Stiker]")
                : lastMsg.type === "sticky_note"
                ? `📌 ${lastMsg.sticky_note?.title || "Sticky Note"} (${lastMsg.sticky_note?.progress ?? 0}%)`
                : (lastMsg.text || t("messages_attachment_preview", "Lampiran")))
            : "");
      const hasActivity = Boolean(previewText) || msgs.length > 0 || (c.type === "dm" && Boolean(c.last_message_at));
      const effectiveTime = lastMsg?.created_at || (hasActivity ? c.last_message_at : null);
      const sortTs = effectiveTime ? new Date(effectiveTime).getTime() : 0;

      return {
        ...c,
        other,
        title,
        last_message_preview: previewText,
        last_message_at: effectiveTime,
        _hasActivity: hasActivity,
        _sortTs: Number.isNaN(sortTs) ? 0 : sortTs
      };
    })
    .sort((a, b) => {
      if (a._hasActivity !== b._hasActivity) {
        return a._hasActivity ? -1 : 1;
      }
      if (b._sortTs !== a._sortTs) {
        return b._sortTs - a._sortTs;
      }
      return (a.title || "").localeCompare(b.title || "");
    }), [safeConvs, userMap, me, ws?.assistant_name, ws?.assistant_avatar]);

  const list = named.filter((c) => (tab === "all" || (tab === "dm" ? c.type === "dm" : c.type === "group")) && (c.title || "").toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (!cid && searchParams.get("reviseTask") && named.length > 0) {
      const target = named.find((c) => c.type === "group") || named[0];
      if (target?.id) {
        navigate(`/messages/${target.id}?${searchParams.toString()}`, { replace: true });
      }
    }
  }, [cid, searchParams, named, navigate]);

  const canDeleteConversation = useCallback((c) => {
    if (!c) return false;
    if (c.type === "dm") return true;
    if (c.is_default) return false;
    const isOfficialDept = String(c.id || "").startsWith("group_official_") || Boolean(c.is_verified);
    if (isOfficialDept) return isAdmin;
    return Boolean(
      isAdmin ||
      c.can_manage ||
      (c.created_by && c.created_by === me?.user_id) ||
      (Array.isArray(c.admin_ids) && c.admin_ids.includes(me?.user_id))
    );
  }, [isAdmin, me?.user_id]);

  useEffect(() => {
    if (!ctxMenu) return undefined;
    const close = () => setCtxMenu(null);
    const onKey = (ev) => { if (ev.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const openContextMenu = (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    playSound("pop");
    const menuW = 216;
    const menuH = 160;
    const x = Math.min(Math.max(8, e.clientX), Math.max(8, window.innerWidth - menuW - 8));
    const y = Math.min(Math.max(8, e.clientY), Math.max(8, window.innerHeight - menuH - 8));
    setCtxMenu({ x, y, conv: c });
  };

  const confirmDeleteConversation = async () => {
    if (!deleteTarget || deletingChat) return;
    const target = deleteTarget;
    const isCircle = String(target.id || "").startsWith("conv_circle_");
    setDeletingChat(true);
    try {
      const { data } = await api.delete(`/conversations/${target.id}`);
      playSound("trash");
      if (isCircle || data?.is_circle_clear) {
        clearConversationMessagesCache(target.id, me?.user_id);
        setConvs((prev) =>
          (Array.isArray(prev) ? prev : []).map((c) =>
            c && c.id === target.id
              ? { ...c, messages: [], unread: 0, last_message_preview: "Asisten Workspace & Notifikasi Approval" }
              : c
          )
        );
        toast.success(t("messages_clear_chat_success", "Riwayat pesan berhasil dibersihkan"));
      } else {
        removeConversationFromCache(target.id, me?.user_id);
        if (target.type === "group") removeGroupFromCache(target.id, me?.user_id);
        setConvs((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((c) => c && c.id !== target.id);
          if (me?.user_id) {
            try { localStorage.setItem(`circle_convs_cache_${me.user_id}`, JSON.stringify(next)); } catch {}
          }
          return next;
        });
        toast.success(t("messages_delete_chat_success", "Percakapan berhasil dihapus"));
        if (cid === target.id) {
          navigate("/messages", { replace: true });
        }
      }
      setDeleteTarget(null);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus percakapan"));
    } finally {
      setDeletingChat(false);
    }
  };

  const handleLeaveFromCtx = async (target) => {
    if (!target) return;
    try {
      await api.post(`/groups/${target.id}/leave`);
      playSound("trash");
      handleLeftGroup(target.id);
      toast.success(t("groups_left_toast", "Keluar dari grup"));
      if (cid === target.id) navigate("/messages", { replace: true });
    } catch (err) {
      toast.error(errMsg(err, "Gagal keluar dari grup"));
    }
  };

  const isDeleteTargetCircle = Boolean(deleteTarget && String(deleteTarget.id || "").startsWith("conv_circle_"));

  return (
    <div className={`flex w-full max-w-full min-w-0 overflow-hidden overscroll-none ${cid ? "h-[100dvh] max-h-[100dvh]" : "h-full max-h-full pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"} md:h-[100dvh] md:max-h-[100dvh] animate-crossfade`} data-testid="messages-page">
      <aside className={`${cid ? "hidden lg:flex" : "flex"} h-full max-h-full w-full max-w-full min-w-0 lg:w-[320px] shrink-0 flex-col overflow-hidden border-r bg-surface`}>
        <div className="shrink-0 p-3 sm:p-4 pb-2">
          <div className="flex items-center justify-between"><h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t("messages_title", "Pesan")}</h1>
            <button onClick={() => { playSound("pop"); setDm(true); }} className="btn-accent flex h-10 w-10 items-center justify-center" aria-label={t("messages_new_dm_btn_aria", "Pesan baru")} data-testid="new-message-btn"><Plus size={18} /></button></div>
          <div className="mt-2.5 sm:mt-3 flex items-center gap-2 rounded-xl border bg-surface2 px-3"><Search size={15} className="text-sub" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("messages_search_placeholder", "Cari obrolan…")} className="h-10 flex-1 bg-transparent text-sm outline-none" data-testid="conversation-filter-input" /></div>
          <div className="mt-2.5 sm:mt-3 flex gap-1 rounded-xl bg-surface2 p-1 text-xs font-semibold">
            {[["all", t("messages_tab_all", "Semua")], ["dm", t("messages_tab_dm", "Langsung")], ["group", t("messages_tab_groups", "Grup")]].map(([k, l]) => <button key={k} onClick={() => { if (tab !== k) playSound("tab"); setTab(k); }} className={`flex-1 rounded-lg py-1.5 transition-colors cursor-pointer ${tab === k ? "bg-surface text-ink shadow-sm font-bold" : "text-sub hover:text-ink"}`} data-testid={`conv-tab-${k}`}>{l}</button>)}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-2 scroll-thin">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => { playSound("click"); navigate(`/messages/${c.id}`); }}
              onContextMenu={(e) => openContextMenu(e, c)}
              data-testid={`conversation-item-${c.id}`}
              className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors cursor-pointer ${cid === c.id ? "bg-soft-red" : "hover:bg-surface2"}`}
            >
              {c.other ? <Avatar user={c.other} size={42} /> : <GroupIcon c={c} size={42} />}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="truncate text-sm font-semibold leading-snug">{c.title}</span>
                    {c.is_verified && <ShieldCheck size={13} className="shrink-0 text-blue-500 fill-blue-500/10" />}
                  </span>
                  <span className="shrink-0 text-[10px] text-sub">{fmtTime(c.last_message_at)}</span>
                </span>
                <span className="flex items-center justify-between gap-2"><span className="truncate text-xs text-sub leading-snug">{c.last_message_preview || t("messages_no_messages_yet", "Belum ada pesan")}</span>{c.unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white" data-testid="conversation-unread">{c.unread}</span>}</span>
              </span>
            </button>
          ))}
          {!list.length && <Empty icon={MessageCircle} title={t("messages_empty_list_title", "Belum ada obrolan")} text={t("messages_empty_list_desc", "Mulai pesan langsung atau gabung ke grup.")} />}
        </div>
      </aside>
      <section className={`${cid ? "flex" : "hidden lg:flex"} h-full max-h-full min-w-0 flex-1 overflow-hidden`}>
        {cid ? <ChatView cid={cid} onChange={load} onRead={handleRead} onLeft={handleLeftGroup} /> : <div className="flex flex-1 items-center justify-center"><Empty icon={MessageCircle} title={t("messages_empty_title", "Pilih obrolan")} text={t("messages_empty_desc", "Pesan Anda bersifat privat untuk anggota dalam obrolan terkait.")} /></div>}
      </section>
      <NewDM open={dm} onOpenChange={setDm} convs={convs} onCreated={(newConv) => setConvs((prev) => [newConv, ...(prev || []).filter((c) => c.id !== newConv.id)])} />

      {/* Right-Click Conversation Context Menu */}
      {ctxMenu && (
        <div
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-2xl border border-slate-200 dark:border-slate-800 bg-surface p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100"
          data-testid="conversation-context-menu"
        >
          <button
            type="button"
            onClick={() => {
              const target = ctxMenu.conv;
              setCtxMenu(null);
              playSound("click");
              navigate(`/messages/${target.id}`);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-surface2 cursor-pointer"
            data-testid="ctx-open-chat"
          >
            <ExternalLink size={14} className="text-sub" />
            <span>{t("messages_ctx_open", "Buka Obrolan")}</span>
          </button>

          {ctxMenu.conv?.type === "group" && !ctxMenu.conv?.is_default && (
            <button
              type="button"
              onClick={() => {
                const target = ctxMenu.conv;
                setCtxMenu(null);
                handleLeaveFromCtx(target);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-ink hover:bg-surface2 cursor-pointer"
              data-testid="ctx-leave-group"
            >
              <LogOut size={14} className="text-sub" />
              <span>{t("messages_ctx_leave_group", "Keluar dari Grup")}</span>
            </button>
          )}

          {canDeleteConversation(ctxMenu.conv) && (
            <button
              type="button"
              onClick={() => {
                const target = ctxMenu.conv;
                setCtxMenu(null);
                playSound("click");
                setDeleteTarget(target);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              data-testid="ctx-delete-chat"
            >
              <Trash2 size={14} />
              <span>
                {String(ctxMenu.conv?.id || "").startsWith("conv_circle_")
                  ? t("messages_ctx_clear_chat", "Bersihkan Riwayat Chat")
                  : t("messages_ctx_delete_chat", "Hapus Semua Chat")}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Delete Entire Chat Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deletingChat && setDeleteTarget(null)}>
        <DialogContent className="bg-surface rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isDeleteTargetCircle
                ? t("messages_clear_chat_title", "Bersihkan Riwayat Chat?")
                : `${t("messages_delete_chat_title", "Hapus Semua Chat Ini?")}${deleteTarget?.title ? ` (${deleteTarget.title})` : ""}`}
            </DialogTitle>
            <DialogDescription>
              {isDeleteTargetCircle
                ? t("messages_clear_chat_desc", "Seluruh riwayat pesan dengan Circle akan dihapus, namun obrolan tetap tersedia.")
                : t("messages_delete_chat_desc", "Seluruh isi pesan dan percakapan ini akan dihapus secara permanen.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              disabled={deletingChat}
              onClick={() => setDeleteTarget(null)}
              className="btn-ghost h-9 border px-4 text-xs font-semibold cursor-pointer"
            >
              {t("common_cancel", "Batal")}
            </button>
            <button
              type="button"
              disabled={deletingChat}
              onClick={confirmDeleteConversation}
              className="h-9 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              data-testid="confirm-delete-chat-btn"
            >
              {deletingChat
                ? t("messages_deleting_chat", "Menghapus…")
                : isDeleteTargetCircle
                ? t("messages_clear_chat_confirm", "Ya, Bersihkan Chat")
                : t("messages_delete_chat_confirm", "Ya, Hapus Semua Chat")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

