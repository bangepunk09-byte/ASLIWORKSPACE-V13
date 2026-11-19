import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { Avatar, rel } from "./common";
import { showSystemNotification } from "../lib/systemNotifications";

export function NotificationList({ onNavigate }) {
  const { me, setUnread, userMap, subscribe, showTopNotif } = useApp();
  const cacheKey = me?.user_id ? `circle_notifications_cache_${me.user_id}` : "circle_notifications_cache";
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [cat, setCat] = useState("all");
  const navigate = useNavigate();
  const load = () => api.get("/notifications").then((r) => {
    setData(r.data);
    setUnread(r.data.unread);
    try { localStorage.setItem(cacheKey, JSON.stringify(r.data)); } catch {}
  }).catch(() => {});
  useEffect(() => { load(); }, [me?.user_id]); // eslint-disable-line
  useEffect(() => subscribe((e) => e.type === "notification" && load()), [subscribe, me?.user_id]); // eslint-disable-line
  const open = (n) => {
    setData((prev) => {
      if (!prev) return prev;
      const items = (prev.items || []).map((item) => (item.id === n.id ? { ...item, read: true } : item));
      const unread = n.read ? prev.unread : Math.max(0, Number(prev.unread || 0) - 1);
      setUnread(unread);
      return { ...prev, items, unread };
    });
    api.post(`/notifications/${n.id}/read`).then(load).catch(() => {});
    const targetLink = n.link || (n.task_id ? `/tasks?task=${n.task_id}` : null);
    if (targetLink) {
      navigate(targetLink);
      onNavigate?.();
    }
  };
  const handleClose = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      navigate(-1);
    }
  };
  const cats = ["all", ...new Set((data?.items || []).map((n) => n.category))];
  const items = (data?.items || []).filter((n) => cat === "all" || n.category === cat);

  const testPopup = () => {
    const payload = {
      id: `test_notif_${Date.now()}`,
      title: "Permintaan Akses Masuk Baru",
      body: "Jessica Iskandar (Marketing) mengajukan permohonan akses masuk",
      type: "access_request",
      category: "system",
      access_request: {
        id: `req_test_${Date.now()}`,
        name: "Jessica Iskandar",
        email: "jessica@asliri.id",
        department: "Marketing",
        job_title: "Brand Specialist",
        status: "pending"
      }
    };
    showTopNotif(payload);
    showSystemNotification(payload, { force: true });
  };

  const CAT_LABELS = { all: "Semua", tasks: "Tugas", chat: "Pesan", beranda: "Beranda", approval: "Persetujuan", system: "Sistem", calendar: "Jadwal", meetings: "Rapat", mentions: "Mention" };

  return (
    <div className="flex h-full flex-col" data-testid="notification-list">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-3 flex-nowrap">
        <div className="flex items-baseline gap-1.5 min-w-0 whitespace-nowrap">
          <p className="font-bold text-sm text-ink whitespace-nowrap">Notifikasi</p>
          {data && (
            <span className="text-[11px] font-medium text-sub whitespace-nowrap">
              · {data.unread} belum dibaca
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
          <button type="button" onClick={testPopup} className="rounded-full bg-brand/10 text-brand px-2.5 py-1 text-[11px] font-bold hover:bg-brand/20 transition-colors cursor-pointer whitespace-nowrap" data-testid="test-popup-header-btn">Uji Popup</button>
          <button type="button" onClick={() => api.post("/notifications/read-all").then(load).catch(() => {})} className="btn-ghost flex h-8 items-center gap-1 px-2 text-[11px] font-semibold cursor-pointer whitespace-nowrap" data-testid="mark-all-read-btn"><CheckCheck size={14} /><span className="hidden sm:inline">Tandai </span>Semua</button>
          <button type="button" onClick={handleClose} className="btn-ghost flex h-8 w-8 items-center justify-center rounded-xl hover:bg-surface2 cursor-pointer shrink-0" aria-label="Tutup" data-testid="close-notifications-btn"><X size={16} /></button>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b px-3 sm:px-4 py-2 no-scrollbar">{cats.filter(Boolean).map((c) => <button key={`notif-cat-${c}`} onClick={() => setCat(c)} className={`h-7 whitespace-nowrap rounded-full px-3 text-[11px] font-semibold transition-colors cursor-pointer ${cat === c ? "bg-brand text-white shadow-xs" : "bg-surface2 text-sub hover:text-ink"}`} data-testid={`notif-cat-${c}`}>{CAT_LABELS[c] || c}</button>)}</div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {data && !items.length && <div className="p-10 text-center text-sm text-sub"><Bell className="mx-auto mb-2" size={22} />Semua sudah terbaca</div>}
        {items.map((n) => (
          <button key={n.id} onClick={() => open(n)} className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left hover:bg-surface2 ${n.read ? "" : "bg-soft-red"}`} data-testid={`notification-${n.id}`}>
            {n.actor_id && userMap[n.actor_id] ? <Avatar user={userMap[n.actor_id]} size={32} showStatus={false} /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2"><Bell size={14} /></span>}
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{n.title}</span>{n.body && <span className="block line-clamp-2 whitespace-normal break-words text-xs text-sub">{n.body}</span>}<span className="mt-0.5 block text-[10px] text-sub">{rel(n.created_at)}</span></span>
            {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" />}
          </button>
        ))}
      </div>
    </div>
  );
}


export function NotificationRail({ open, setOpen }) {
  const { unread } = useApp();
  const [ready, setReady] = useState(open);

  useEffect(() => {
    if (open && !ready) setReady(true);
  }, [open, ready]);

  // Pre-mount NotificationList gently during browser idle time so the very first open has zero mount jank
  useEffect(() => {
    if (ready) return undefined;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => setReady(true), 800);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const shouldRenderList = ready || open;

  return (
    <>
      <div
        className={`fixed inset-0 right-[60px] z-30 hidden bg-transparent md:block ${
          open ? "pointer-events-auto" : "pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside className="hidden md:block" data-testid="notification-rail">
        <div
          className="fixed inset-y-0 right-[60px] z-40 h-screen w-[448px] xl:w-[468px] overflow-hidden pl-12 pointer-events-none"
          aria-hidden={!open}
        >
          <div
            className={`h-full w-full border-l bg-surface will-change-transform [contain:layout_paint] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              open
                ? "translate-x-0 pointer-events-auto shadow-[-14px_0_36px_-6px_rgba(15,23,42,0.14),-4px_0_12px_-2px_rgba(15,23,42,0.06)] dark:shadow-[-16px_0_40px_-6px_rgba(0,0,0,0.55),-4px_0_14px_-2px_rgba(0,0,0,0.35)]"
                : "translate-x-full pointer-events-none shadow-none"
            }`}
            data-testid="notification-panel"
          >
            {shouldRenderList && <NotificationList onNavigate={() => setOpen(false)} />}
          </div>
        </div>
        <div className="fixed inset-y-0 right-0 z-50 flex h-screen w-[60px] flex-col items-center border-l bg-sidebar pt-4 shadow-sm">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            onMouseEnter={() => { if (!ready) setReady(true); }}
            onFocus={() => { if (!ready) setReady(true); }}
            className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors duration-200 cursor-pointer ${
              open ? "tint-accent" : "hover:bg-surface2 text-sub"
            }`}
            aria-label="Notifikasi"
            aria-expanded={open}
            data-testid="notification-rail-btn"
          >
            <Bell size={20} className={unread > 0 && !open ? "animate-[float_1.2s_ease-in-out_infinite] text-brand" : ""} />
            {unread > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-[18px] text-white"
                data-testid="unread-count"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
