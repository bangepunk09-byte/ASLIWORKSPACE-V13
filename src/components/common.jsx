import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNowStrict, isToday, isPast, differenceInHours } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { X, Download, ZoomIn, ZoomOut } from "lucide-react";
import { useApp } from "../context/AppContext";
import { fileUrl } from "../lib/api";
import { getProfileCompletion } from "../lib/profileCompletion";

const GRADS = ["from-[#FF8A9A] to-[#FF5364]", "from-[#8FB8FF] to-[#5B7CFA]", "from-[#C3A6FF] to-[#8B5CF6]", "from-[#7FE0B0] to-[#22A06B]", "from-[#FFD27A] to-[#F59E0B]", "from-[#7FD8E0] to-[#0EA5A4]"];
const hash = (s = "") => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

export function Logo({ size = 36, ws }) {
  const logoUrl = ws?.logo_file_id 
    ? (ws.logo_file_id === "default_workspace_logo" ? "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png" : fileUrl(ws.logo_file_id))
    : "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png";
  return <img src={logoUrl} alt="logo" style={{ width: size, height: size }} className="rounded-xl object-cover" />;
}

export const AVAILABILITY_STATUS_OPTIONS = [
  {
    value: "online",
    label: "Online",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70",
    activeRowClass: "bg-emerald-50/80 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  {
    value: "sick_leave",
    label: "Sick Leave",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
    activeRowClass: "bg-amber-50/80 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  {
    value: "cuti",
    label: "Cuti",
    dotClass: "bg-violet-500",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/70",
    activeRowClass: "bg-violet-50/80 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  },
  {
    value: "busy",
    label: "Busy",
    dotClass: "bg-rose-500",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70",
    activeRowClass: "bg-rose-50/80 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  },
];

export function getAvailabilityStatusMeta(status) {
  const normalized = String(status || "online").toLowerCase().trim();
  return AVAILABILITY_STATUS_OPTIONS.find((opt) => opt.value === normalized) || AVAILABILITY_STATUS_OPTIONS[0];
}

export const Avatar = memo(function Avatar({ user, size = 36, showStatus = true, className = "", ringDeadline = true }) {
  const { online, ws, me, userMap, users, userDeadlinesToday, userDeadlineReasons, hasDeadlineToday, t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  const isCircleBot = user?.user_id === "user_circle_assistant" || user?.role === "assistant";
  const liveUser = (!isCircleBot && user?.user_id)
    ? (userMap?.[user.user_id] || (Array.isArray(users) ? users.find((u) => u.user_id === user.user_id) : null) || user)
    : user;
  const name = isCircleBot ? (ws?.assistant_name || user?.name || "Asli") : (liveUser?.name || user?.name || "?");
  const avatarSrc = isCircleBot
    ? (ws?.assistant_avatar || user?.avatar || user?.picture || "https://api.dicebear.com/7.x/bottts/svg?seed=AsliWorkspace&backgroundColor=FF5364")
    : (liveUser?.avatar || liveUser?.picture || user?.avatar || user?.picture);

  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const isOn = Boolean(
    isCircleBot ||
    (user?.user_id && me?.user_id && user.user_id === me.user_id) ||
    online?.has(user?.user_id) ||
    liveUser?.online
  );

  const rawAvailability = isCircleBot
    ? "online"
    : (user?.user_id && me?.user_id && user.user_id === me.user_id
        ? (me?.availability_status || liveUser?.availability_status || "online")
        : (liveUser?.availability_status || user?.availability_status || "online"));
  const statusMeta = getAvailabilityStatusMeta(rawAvailability);
  const statusLabel = tr(`nav_status_${statusMeta.value}`, statusMeta.label);
  const dotColorClass = isCircleBot
    ? "bg-emerald-500"
    : (statusMeta.value !== "online"
        ? statusMeta.dotClass
        : (isOn ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"));

  const hasDeadline = Boolean(
    ringDeadline &&
    user?.user_id &&
    !isCircleBot &&
    (hasDeadlineToday ? hasDeadlineToday(user.user_id) : userDeadlinesToday?.has(user.user_id))
  );
  const deadlineReason = hasDeadline ? userDeadlineReasons?.[user.user_id] : "";

  const ringClass = (ringDeadline && user?.user_id && !isCircleBot && size >= 24)
    ? (hasDeadline ? "avatar-deadline-ring" : "avatar-safe-ring")
    : "";

  return (
    <span
      className={`relative inline-flex shrink-0 rounded-full transition-colors duration-200 ${ringClass} ${className}`}
      style={{ width: size, height: size }}
      title={
        user?.user_id && !isCircleBot
          ? `${name} (${statusLabel}) · ${hasDeadline ? (deadlineReason || tr("common_deadline_today_tip", "Ada deadline tugas hari ini!")) : tr("common_deadline_safe_tip", "Bebas deadline (Aman)")}`
          : name
      }
    >
      {avatarSrc ? (
        <img src={avatarSrc} alt={name} loading="lazy" decoding="async" className="h-full w-full rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className={`flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ${GRADS[hash(name) % GRADS.length]} font-semibold text-white`} style={{ fontSize: size * 0.38 }}>
          {initials}
        </span>
      )}
      {showStatus && user && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-[var(--c-surface)] ${dotColorClass}`}
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
          title={statusLabel}
          data-testid="online-indicator"
        />
      )}
    </span>
  );
});

export const VerifiedBadge = memo(function VerifiedBadge({ user, size = 15, className = "" }) {
  const { userMap, users, me, t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  if (!user) return null;
  const isCircleBot = user?.user_id === "user_circle_assistant" || user?.role === "assistant";
  if (isCircleBot) return null;
  const liveUser =
    user?.user_id && me?.user_id === user.user_id
      ? me
      : (user?.user_id ? (userMap?.[user.user_id] || (Array.isArray(users) ? users.find((u) => u.user_id === user.user_id) : null)) : null) || user;
  const verified = Boolean(liveUser?.is_verified || user?.is_verified || getProfileCompletion(liveUser).isVerified);
  if (!verified) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center align-middle ${className}`}
      title={tr("common_verified_title", "Profil Terverifikasi")}
      data-testid="verified-badge"
      aria-label={tr("common_verified_aria", "Terverifikasi")}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_1px_1px_rgba(14,165,233,0.2)]"
      >
        <path
          d="M12 2L14.6 3.7L17.7 3.4L19.1 6.2L21.9 7.6L21.6 10.7L23.3 13.3L21.6 15.9L21.9 19L19.1 20.4L17.7 23.2L14.6 22.9L12 24.6L9.4 22.9L6.3 23.2L4.9 20.4L2.1 19L2.4 15.9L0.7 13.3L2.4 10.7L2.1 7.6L4.9 6.2L6.3 3.4L9.4 3.7L12 2Z"
          transform="translate(0 -1.3) scale(1 0.98)"
          fill="#0EA5E9"
        />
        <path
          d="M9.8 15.4L6.9 12.5L5.6 13.8L9.8 18L18.6 9.2L17.3 7.9L9.8 15.4Z"
          fill="#FFFFFF"
        />
      </svg>
    </span>
  );
});

export function ImageLightbox({ image, onClose }) {
  const { t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!image) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, onClose]);

  useEffect(() => {
    setZoomed(false);
  }, [image?.id, image?.url]);

  if (!image) return null;

  const src = image.url || fileUrl(image.id);
  const downloadHref = image.id ? `${fileUrl(image.id)}?download=1` : src;
  const fileName = image.name || `photo-${image.id || Date.now()}.png`;

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const response = await fetch(downloadHref);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    } catch {
      const a = document.createElement("a");
      a.href = downloadHref;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm animate-fadeIn"
      onClick={() => onClose?.()}
      role="dialog"
      aria-modal="true"
      data-testid="image-lightbox-modal"
    >
      {/* Top Toolbar */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-6 bg-gradient-to-b from-black/70 to-transparent text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{fileName}</p>
          <p className="hidden sm:block text-[11px] text-white/70">{tr("common_lightbox_hint", "Tekan tombol ESC atau klik di luar foto untuk menutup")}</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 px-2.5 sm:px-3 text-xs font-semibold text-white transition-colors cursor-pointer"
            title={zoomed ? tr("common_lightbox_zoom_out", "Sesuaikan Layar") : tr("common_lightbox_zoom_in", "Perbesar")}
            data-testid="lightbox-zoom-btn"
          >
            {zoomed ? <ZoomOut size={15} /> : <ZoomIn size={15} />}
            <span className="hidden sm:inline">{zoomed ? tr("common_lightbox_zoom_out", "Sesuaikan Layar") : tr("common_lightbox_zoom_in", "Perbesar")}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand hover:opacity-95 px-3 sm:px-3.5 text-xs font-bold text-white shadow-md transition-all cursor-pointer"
            data-testid="lightbox-download-btn"
          >
            <Download size={15} />
            <span className="sm:hidden">{tr("common_lightbox_download_short", "Unduh")}</span>
            <span className="hidden sm:inline">{tr("common_lightbox_download_full", "Unduh Resolusi Penuh")}</span>
          </button>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 hover:bg-rose-500 text-white transition-colors cursor-pointer"
            aria-label={tr("common_lightbox_close", "Tutup")}
            title={tr("common_lightbox_close", "Tutup")}
            data-testid="lightbox-close-btn"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Image Viewport */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
        <img
          src={src}
          alt={fileName}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed((z) => !z);
          }}
          className={`rounded-2xl shadow-2xl transition-transform duration-200 select-none ${
            zoomed
              ? "max-w-none max-h-none scale-125 cursor-zoom-out"
              : "max-h-[82dvh] max-w-[92vw] object-contain cursor-zoom-in"
          }`}
          data-testid="lightbox-image"
        />
      </div>
    </div>
  );
}

export function GroupIcon({ c, size = 42, rounded = "rounded-2xl" }) {
  if (c?.image) return <img src={fileUrl(c.image)} alt={c.name || "group"} className={`${rounded} shrink-0 object-cover`} style={{ width: size, height: size }} data-testid={`group-avatar-${c.id}`} />;
  return <span className={`flex shrink-0 items-center justify-center ${rounded} bg-soft-purple font-bold text-ink`} style={{ width: size, height: size, fontSize: size * 0.4 }} data-testid={`group-avatar-${c?.id}`}>{(c?.name || "#").trim().slice(0, 1).toUpperCase()}</span>;
}

export const AvatarStack = memo(function AvatarStack({ ids = [], max = 4, size = 26, ringDeadline = true }) {
  const { userMap } = useApp();
  return (
    <div className="flex items-center -space-x-1">
      {[...ids.slice(0, max)].reverse().map((id, index) => <Avatar key={id} user={userMap[id]} size={size} showStatus={false} ringDeadline={ringDeadline} className="relative rounded-full" style={{ zIndex: index }} />)}
      {ids.length > max && <span className="relative flex items-center justify-center rounded-full bg-surface2 text-[10px] font-semibold text-sub border border-slate-200 dark:border-slate-700" style={{ width: size, height: size, zIndex: 0 }}>+{ids.length - max}</span>}
    </div>
  );
});

export function hasRichCopyFormatting(str) {
  if (typeof str !== "string") return false;
  return /(\n|\*\*[^*]+\*\*|<b>[\s\S]+?<\/b>|<strong>[\s\S]+?<\/strong>|__[^_]+__|<u>[\s\S]+?<\/u>|\*[^*\n]+\*|<i>[\s\S]+?<\/i>|==[^=\n]+==)/.test(str);
}

export function renderFormattedCopy(str, opts = {}) {
  if (typeof str !== "string" || !str) return str;
  if (!hasRichCopyFormatting(str)) return str;
  const {
    boldClass = "font-extrabold",
    normalPartClass = "",
    highlightClass = "rounded bg-brand/20 px-1 py-0.5 font-bold text-brand",
  } = opts;

  const lines = str.split("\n");
  const tokenRegex = /(\*\*[\s\S]+?\*\*|<b>[\s\S]+?<\/b>|<strong>[\s\S]+?<\/strong>|__[\s\S]+?__|<u>[\s\S]+?<\/u>|==[\s\S]+?==|\*[^*\n]+\*|<i>[\s\S]+?<\/i>)/g;

  return lines.map((line, lineIdx) => {
    const parts = line.split(tokenRegex).filter((p) => p !== "");
    return (
      <span key={lineIdx}>
        {lineIdx > 0 && <br />}
        {parts.map((part, idx) => {
          if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("<b>") && part.endsWith("</b>")) || (part.startsWith("<strong>") && part.endsWith("</strong>"))) {
            const inner = part.startsWith("**")
              ? part.slice(2, -2)
              : part.replace(/^<(b|strong)>|<\/(b|strong)>$/g, "");
            return (
              <strong key={idx} className={boldClass}>
                {inner}
              </strong>
            );
          }
          if ((part.startsWith("__") && part.endsWith("__")) || (part.startsWith("<u>") && part.endsWith("</u>"))) {
            const inner = part.startsWith("__") ? part.slice(2, -2) : part.slice(3, -4);
            return (
              <u key={idx} className="underline underline-offset-2">
                {inner}
              </u>
            );
          }
          if (part.startsWith("==") && part.endsWith("==")) {
            return (
              <mark key={idx} className={highlightClass}>
                {part.slice(2, -2)}
              </mark>
            );
          }
          if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("<i>") && part.endsWith("</i>"))) {
            const inner = part.startsWith("*") ? part.slice(1, -1) : part.slice(3, -4);
            return (
              <em key={idx} className="italic">
                {inner}
              </em>
            );
          }
          return normalPartClass ? (
            <span key={idx} className={normalPartClass}>
              {part}
            </span>
          ) : (
            part
          );
        })}
      </span>
    );
  });
}

export const LabelChip = memo(function LabelChip({ label, small }) {
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"}`}
      style={{ background: `${label.color}1F`, color: label.color }} data-testid={`label-chip-${label.id}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: label.color }} />{label.name}
    </span>
  );
});

export const Labels = memo(function Labels({ ids = [], small, max = 3 }) {
  const { labelMap } = useApp();
  const ls = ids.map((i) => labelMap[i]).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {ls.slice(0, max).map((l) => <LabelChip key={l.id} label={l} small={small} />)}
      {ls.length > max && <span className="text-[10px] text-sub">+{ls.length - max}</span>}
    </div>
  );
});

export const PRIORITY = {
  low: { name: "Rendah", cls: "bg-soft-green text-emerald-700 dark:text-emerald-300" },
  medium: { name: "Sedang", cls: "bg-soft-blue text-blue-700 dark:text-blue-300" },
  high: { name: "Tinggi", cls: "bg-soft-yellow text-amber-700 dark:text-amber-300" },
  urgent: { name: "Urgent", cls: "bg-soft-red text-rose-600 dark:text-rose-300" },
};
export const PriorityBadge = memo(function PriorityBadge({ value }) {
  const { t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  const key = value in PRIORITY ? value : "medium";
  const p = PRIORITY[key] || PRIORITY.medium;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0 ${p.cls}`}>{tr(`common_priority_${key}`, p.name)}</span>;
});

export const StatusBadge = memo(function StatusBadge({ status }) {
  const { statuses } = useApp();
  const s = statuses.find((x) => x.key === status);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: `${s?.color || "#eee"}55` }}>
      <span className="h-2 w-2 rounded-full" style={{ background: s?.is_done ? "#22A06B" : "var(--c-accent2)", opacity: s?.is_done ? 1 : 0.7 }} />{s?.name || status}
    </span>
  );
});

export function dueInfo(deadline, done) {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  if (done) return { text: format(d, "d MMM", { locale: localeId }), cls: "text-sub" };
  if (isPast(d) && !isToday(d)) return { text: `Overdue · ${format(d, "d MMM", { locale: localeId })}`, cls: "text-rose-600 dark:text-rose-400 font-semibold", state: "overdue" };
  if (isPast(d)) return { text: `Overdue · ${format(d, "HH:mm")}`, cls: "text-rose-600 dark:text-rose-400 font-semibold", state: "overdue" };
  if (isToday(d)) return { text: `Hari ini · ${format(d, "HH:mm")}`, cls: "text-amber-600 dark:text-amber-400 font-semibold", state: "today" };
  if (differenceInHours(d, new Date()) < 72) return { text: format(d, "EEE, d MMM", { locale: localeId }), cls: "text-blue-600 dark:text-blue-400", state: "soon" };
  return { text: format(d, "d MMM yyyy", { locale: localeId }), cls: "text-sub" };
}

export const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "HH:mm");
};
export const fmtDate = (iso, f = "d MMM yyyy") => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, f, { locale: localeId });
};
export const rel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDistanceToNowStrict(d, { addSuffix: true, locale: localeId });
};

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  const isMultilineTitle = typeof title === "string" && title.includes("\n");
  const isMultilineSubtitle = typeof subtitle === "string" && subtitle.includes("\n");
  return (
    <div className="mb-4 sm:mb-6 flex w-full max-w-full min-w-0 flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200/70 dark:border-slate-800/80 pb-3 lg:border-b-0 lg:pb-0">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        {Icon && (
          <span className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-2xl tint-accent shadow-2xs">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={`text-xl sm:text-3xl font-extrabold tracking-tight text-ink leading-normal ${isMultilineTitle ? "whitespace-pre-line" : "truncate"}`} data-testid="page-title">
            {typeof title === "string" ? renderFormattedCopy(title) : title}
          </h1>
          {subtitle && (
            <p className={`text-xs sm:text-sm text-sub mt-0.5 leading-relaxed ${isMultilineSubtitle ? "whitespace-pre-line" : "line-clamp-2 sm:line-clamp-1"}`}>
              {typeof subtitle === "string" ? renderFormattedCopy(subtitle) : subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-nowrap items-center gap-2 shrink-0 overflow-x-auto no-scrollbar max-w-full pb-0.5 lg:pb-0">
          {actions}
        </div>
      )}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, description, action }) {
  const msg = text || description;
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center" data-testid="empty-state">
      {Icon && <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-surface2 text-sub"><Icon size={24} /></span>}
      <p className="font-semibold whitespace-pre-line">{typeof title === "string" ? renderFormattedCopy(title) : title}</p>
      {msg && <p className="mt-1 max-w-sm text-sm text-sub whitespace-pre-line">{typeof msg === "string" ? renderFormattedCopy(msg) : msg}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }) {
  const { t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  const text = label || tr("common_loading", "Memuat");
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-sub" data-testid="loading-state">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--c-border)] border-t-[var(--c-accent)]" />{text}…
    </div>
  );
}

export function AccentButton({ children, className = "", ...p }) {
  return <button className={`btn-accent inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:opacity-50 ${className}`} {...p}>{children}</button>;
}
export function GhostButton({ children, className = "", ...p }) {
  return <button className={`btn-ghost inline-flex h-10 items-center justify-center gap-2 border bg-surface px-4 text-sm font-semibold disabled:opacity-50 ${className}`} {...p}>{children}</button>;
}

export const ROLE_NAMES = {
  super_admin: "Super Admin",
  workspace_admin: "Workspace Admin",
  department_manager: "Manajer Divisi",
  project_manager: "Project Manager",
  employee: "Karyawan",
  member: "Anggota",
};

function parseTaskDeadlineDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

export function getTaskCompliance(t) {
  if (!t) return "In Progress";

  const isDone = t.status === "done" || Boolean(t.archived);
  const dl = parseTaskDeadlineDate(t.deadline);

  // Jika task sudah selesai (DONE)
  if (isDone) {
    if (!dl) return "On time";
    const finishedAt = new Date(t.completed_at || t.submit_date || t.archived_at || t.updated_at || Date.now());
    // Jika selesai melebihi deadline -> OVERDUE, jika tepat waktu/sebelumnya -> ON TIME
    return finishedAt > dl ? "Overdue" : "On time";
  }

  // Jika task belum selesai (To Do, In Progress, In Review)
  if (!dl) return "In Progress";
  const now = new Date();
  // Jika sekarang sudah melewati deadline -> OVERDUE, jika masih dalam tenggat -> IN PROGRESS
  return now > dl ? "Overdue" : "In Progress";
}

export function getTaskComplianceDetail(t) {
  if (!t) return "";
  const isDone = t.status === "done" || Boolean(t.archived);
  const dl = parseTaskDeadlineDate(t.deadline);
  if (isDone) {
    if (!dl) return "Selesai tepat waktu";
    const finishedAt = new Date(t.completed_at || t.submit_date || t.archived_at || t.updated_at || Date.now());
    return finishedAt > dl
      ? "Selesai melewati deadline"
      : "Selesai tepat waktu";
  }
  if (!dl) return "Sedang dikerjakan";
  const now = new Date();
  return now > dl
    ? "Belum selesai dan melewati deadline"
    : "Sedang dikerjakan dalam tenggat waktu";
}

const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MENTION_MATCHER_CACHE = new WeakMap();
const EMPTY_MENTION_MATCHER = { pattern: "", regex: null, resolve: () => null };

export function buildMentionMatcher(userMap, mentionIds = []) {
  if (!userMap || typeof userMap !== "object") return EMPTY_MENTION_MATCHER;

  const mentionKey = Array.isArray(mentionIds) && mentionIds.length > 0
    ? [...mentionIds].sort().join("|")
    : "";
  let innerCache = MENTION_MATCHER_CACHE.get(userMap);
  if (!innerCache) {
    innerCache = new Map();
    MENTION_MATCHER_CACHE.set(userMap, innerCache);
  }
  const cached = innerCache.get(mentionKey);
  if (cached) return cached;

  const allUsers = Object.values(userMap).filter((u) => u && u.user_id && u.name);
  if (!allUsers.length) {
    innerCache.set(mentionKey, EMPTY_MENTION_MATCHER);
    return EMPTY_MENTION_MATCHER;
  }

  const mentionedSet = new Set(Array.isArray(mentionIds) ? mentionIds : []);
  const orderedUsers = [
    ...allUsers.filter((u) => mentionedSet.has(u.user_id)),
    ...allUsers.filter((u) => !mentionedSet.has(u.user_id)),
  ];

  const tokenToUser = new Map();
  const tokenList = [];
  const firstCounts = new Map();
  const nickCounts = new Map();

  for (const u of allUsers) {
    const first = String(u.name || "").trim().split(/\s+/)[0]?.toLowerCase();
    if (first && first.length >= 2) firstCounts.set(first, (firstCounts.get(first) || 0) + 1);
    const nick = String(u.nickname || "").trim().toLowerCase();
    if (nick && nick.length >= 2) nickCounts.set(nick, (nickCounts.get(nick) || 0) + 1);
  }

  for (const u of orderedUsers) {
    const full = String(u.name || "").trim();
    if (full) {
      const key = full.toLowerCase();
      if (!tokenToUser.has(key)) {
        tokenToUser.set(key, u);
        tokenList.push(full);
      }
    }
    const nick = String(u.nickname || "").trim();
    if (nick && (mentionedSet.has(u.user_id) || nickCounts.get(nick.toLowerCase()) === 1)) {
      const key = nick.toLowerCase();
      if (!tokenToUser.has(key)) {
        tokenToUser.set(key, u);
        tokenList.push(nick);
      }
    }
    const first = full.split(/\s+/)[0];
    if (first && first.length >= 2 && (mentionedSet.has(u.user_id) || firstCounts.get(first.toLowerCase()) === 1)) {
      const key = first.toLowerCase();
      if (!tokenToUser.has(key)) {
        tokenToUser.set(key, u);
        tokenList.push(first);
      }
    }
  }

  tokenList.sort((a, b) => b.length - a.length);
  if (!tokenList.length) {
    innerCache.set(mentionKey, EMPTY_MENTION_MATCHER);
    return EMPTY_MENTION_MATCHER;
  }

  const pattern = `(?<![\\p{L}\\p{N}._])@(?:${tokenList.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`;
  const result = {
    pattern,
    regex: new RegExp(`(${pattern})`, "giu"),
    resolve: (part) => {
      if (!part || !part.startsWith("@")) return null;
      return tokenToUser.get(part.slice(1).toLowerCase()) || null;
    },
  };
  if (innerCache.size > 60) innerCache.clear();
  innerCache.set(mentionKey, result);
  return result;
}

export const MentionText = memo(function MentionText({
  text,
  mentionIds = [],
  linkClassName = "font-semibold text-brand hover:underline",
}) {
  const { userMap } = useApp() || {};
  const str = String(text || "");
  if (!str) return null;
  const { pattern: mentionPattern, resolve } = buildMentionMatcher(userMap, mentionIds);
  const urlPattern = "(?:https?:\\/\\/|www\\.)[^\\s<>]+";
  const rx = new RegExp(mentionPattern ? `(${mentionPattern}|${urlPattern})` : `(${urlPattern})`, "giu");

  return str.split(rx).map((part, i) => {
    if (!part) return null;
    if (/^(?:https?:\/\/|www\.)/i.test(part)) {
      const mUrl = part.match(/^(.*?)([.,;:!?)\]]*)$/);
      const rawUrl = mUrl?.[1] || part;
      const trailing = mUrl?.[2] || "";
      const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      return (
        <span key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-[#E11D48] dark:text-[#FF5364] underline hover:opacity-80 break-all"
          >
            {rawUrl}
          </a>
          {trailing}
        </span>
      );
    }
    if (part.startsWith("@")) {
      const u = resolve(part);
      if (u?.user_id) {
        return (
          <Link
            key={i}
            to={`/people/${u.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className={linkClassName}
            title={`Lihat profil ${u.name}`}
            data-testid={`mention-link-${u.user_id}`}
          >
            {part}
          </Link>
        );
      }
    }
    return part;
  });
});

export function RichCopyField({
  value = "",
  onChange,
  placeholder = "",
  label,
  singleLineLabel = false,
  minRows = 1,
  mono = false,
  uppercase = false,
  compact = false,
  className = "",
  inputClassName = "",
  testid,
}) {
  const ref = useRef(null);
  const strVal = String(value ?? "");
  const effectiveSource = strVal || String(placeholder || "");
  const lineCount = Math.max(minRows, Math.min(6, strVal.split("\n").length));

  const applyWrap = (marker) => {
    const el = ref.current;
    const baseText = strVal || String(placeholder || "");
    if (!el) {
      const next = baseText.startsWith(marker) && baseText.endsWith(marker)
        ? baseText.slice(marker.length, -marker.length)
        : `${marker}${baseText}${marker}`;
      onChange?.(uppercase ? next.toUpperCase() : next);
      return;
    }

    // If field was empty and showing placeholder, seed from placeholder so user can immediately edit/bold it
    const workingText = strVal || String(placeholder || "");
    let start = el.selectionStart ?? 0;
    let end = el.selectionEnd ?? 0;
    if (!strVal && workingText) {
      start = 0;
      end = workingText.length;
    }

    let nextText;
    let nextStart = start;
    let nextEnd = end;

    if (start !== end) {
      const selected = workingText.slice(start, end);
      const before = workingText.slice(0, start);
      const after = workingText.slice(end);
      if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
        const unwrapped = selected.slice(marker.length, -marker.length);
        nextText = `${before}${unwrapped}${after}`;
        nextEnd = start + unwrapped.length;
      } else if (before.endsWith(marker) && after.startsWith(marker)) {
        nextText = `${before.slice(0, -marker.length)}${selected}${after.slice(marker.length)}`;
        nextStart = start - marker.length;
        nextEnd = end - marker.length;
      } else {
        nextText = `${before}${marker}${selected}${marker}${after}`;
        nextStart = start + marker.length;
        nextEnd = end + marker.length;
      }
    } else {
      // No selection: toggle wrap on the word under cursor, or entire text if cursor is at end
      const trimmed = workingText.trim();
      if (!trimmed) {
        nextText = `${marker}teks${marker}`;
        nextStart = marker.length;
        nextEnd = marker.length + 4;
      } else if (trimmed.startsWith(marker) && trimmed.endsWith(marker) && trimmed.length >= marker.length * 2) {
        nextText = trimmed.slice(marker.length, -marker.length);
        nextStart = 0;
        nextEnd = nextText.length;
      } else {
        nextText = `${marker}${workingText}${marker}`;
        nextStart = marker.length;
        nextEnd = marker.length + workingText.length;
      }
    }

    const finalVal = uppercase ? nextText.toUpperCase() : nextText;
    onChange?.(finalVal);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        try {
          ref.current.setSelectionRange(nextStart, nextEnd);
        } catch {}
      }
    });
  };

  const insertLineBreak = () => {
    const el = ref.current;
    const workingText = strVal || String(placeholder || "");
    const pos = el ? (el.selectionStart ?? workingText.length) : workingText.length;
    const end = el ? (el.selectionEnd ?? pos) : pos;
    const nextText = `${workingText.slice(0, pos)}\n${workingText.slice(end)}`;
    const finalVal = uppercase ? nextText.toUpperCase() : nextText;
    onChange?.(finalVal);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        try {
          ref.current.setSelectionRange(pos + 1, pos + 1);
        } catch {}
      }
    });
  };

  const loadDefaultIfEmpty = () => {
    if (!strVal && placeholder) {
      onChange?.(uppercase ? String(placeholder).toUpperCase() : String(placeholder));
      requestAnimationFrame(() => {
        if (ref.current) ref.current.focus();
      });
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        applyWrap("**");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        applyWrap("*");
        return;
      }
      if (k === "u") {
        e.preventDefault();
        applyWrap("__");
        return;
      }
    }
    if (e.key === "Enter") {
      // Allow Enter to insert a new line without submitting the parent form
      e.stopPropagation();
    }
  };

  const toolbarButtons = (
    <span className="inline-flex items-center gap-0.5 shrink-0" onClick={(e) => e.preventDefault()}>
      {!strVal && placeholder && !compact && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            loadDefaultIfEmpty();
          }}
          title="Muat teks default agar bisa langsung diedit penggalannya"
          className="inline-flex h-5 items-center rounded border border-slate-200 dark:border-slate-700 bg-surface px-1.5 text-[10px] font-semibold text-sub hover:border-brand hover:text-brand transition-colors cursor-pointer mr-0.5"
        >
          Isi Default
        </button>
      )}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          applyWrap("**");
        }}
        title="Bold / Tebalkan teks yang diblok (Ctrl+B)"
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-surface text-[10.5px] font-black text-ink hover:border-brand hover:bg-brand/10 hover:text-brand transition-colors cursor-pointer"
        data-testid={testid ? `${testid}-bold-btn` : undefined}
      >
        B
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          applyWrap("*");
        }}
        title="Italic / Miringkan teks yang diblok (Ctrl+I)"
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-surface text-[10.5px] italic font-serif font-bold text-ink hover:border-brand hover:bg-brand/10 hover:text-brand transition-colors cursor-pointer"
      >
        I
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          insertLineBreak();
        }}
        title="Sisipkan baris baru / penggalan baris (Enter)"
        className="inline-flex h-5 items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-surface px-1 text-[10px] font-bold text-ink hover:border-brand hover:bg-brand/10 hover:text-brand transition-colors cursor-pointer"
        data-testid={testid ? `${testid}-enter-btn` : undefined}
      >
        ↵
      </button>
    </span>
  );

  return (
    <div className={`min-w-0 ${className}`}>
      {label && (
        <div className="mb-1 flex items-center justify-between gap-1.5 min-w-0">
          <span
            className={`text-xs font-semibold text-sub ${
              singleLineLabel ? "block truncate whitespace-nowrap" : "truncate"
            }`}
            title={typeof label === "string" ? label : undefined}
          >
            {label}
          </span>
          {toolbarButtons}
        </div>
      )}
      <div className="relative flex items-start gap-1.5">
        <textarea
          ref={ref}
          rows={lineCount}
          value={strVal}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            const v = uppercase ? e.target.value.toUpperCase() : e.target.value;
            onChange?.(v);
          }}
          placeholder={placeholder}
          className={`w-full resize-y rounded-xl border bg-surface2 px-3 py-2 text-xs sm:text-sm text-ink outline-none transition-colors focus:border-brand leading-snug ${
            mono ? "font-mono" : ""
          } ${compact ? "min-h-[34px] py-1.5 text-xs" : "min-h-[40px]"} ${inputClassName}`}
          data-testid={testid}
        />
        {!label && <div className="pt-1 shrink-0">{toolbarButtons}</div>}
      </div>
      {!compact && effectiveSource && hasRichCopyFormatting(strVal) && (
        <div className="mt-1 rounded-lg border border-dashed border-brand/30 bg-brand/5 px-2.5 py-1 text-[11px] text-ink whitespace-pre-line">
          <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-brand">Preview:</span>
          {renderFormattedCopy(strVal)}
        </div>
      )}
    </div>
  );
}

