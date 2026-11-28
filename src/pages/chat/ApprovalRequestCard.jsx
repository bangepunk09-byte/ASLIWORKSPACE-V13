import { memo, useEffect, useState } from "react";
import {
  CalendarDays,
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  ExternalLink,
  Check,
  FileText,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Avatar, fmtDate, ImageLightbox } from "../../components/common";
import { playSound } from "../../lib/sound";
import { updateMessageInCache } from "../../lib/workspaceCaches";
import { RupiahReceiptIcon } from "../marketplace/catalogAssets";

const FORM_THEMES = {
  leave: {
    label: "Form Izin Cuti",
    icon: CalendarDays,
    topBar: "#0EA5E9",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
    barFill: "bg-sky-500",
  },
  item_request: {
    label: "Form Request Barang",
    icon: Package,
    topBar: "#6366F1",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
    barFill: "bg-indigo-500",
  },
  reimbursement: {
    label: "Form Reimbursement & Dana",
    icon: RupiahReceiptIcon,
    topBar: "#F59E0B",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    barFill: "bg-amber-500",
  },
};

function formatShortDate(dateStr) {
  if (!dateStr) return "-";
  try {
    return fmtDate(dateStr, "d MMM yyyy");
  } catch {
    return dateStr;
  }
}

function isImageAttachment(a) {
  if (!a) return false;
  if (a.content_type && a.content_type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i.test(a.name || "");
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.ceil(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function safeHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^(javascript|data|vbscript):/i.test(s)) return null;
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

const ApprovalRequestCard = memo(function ApprovalRequestCard({ m }) {
  const { me, userMap, isAdmin, subscribe } = useApp();
  const [appr, setAppr] = useState(() => m.form_approval || {});
  const [busy, setBusy] = useState(false);
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [lightboxImg, setLightboxImg] = useState(null);

  useEffect(() => {
    if (m.form_approval) setAppr(m.form_approval);
  }, [m.form_approval]);

  useEffect(() => {
    return subscribe((e) => {
      if (e?.type === "message:update" && e.data?.id === m.id && e.data?.form_approval) {
        setAppr(e.data.form_approval);
      }
    });
  }, [subscribe, m.id]);

  const formType = appr.form_type || "leave";
  const theme = FORM_THEMES[formType] || FORM_THEMES.leave;
  const Icon = theme.icon;
  const fields = appr.fields || {};

  const cardAttachments = Array.isArray(appr.attachments) && appr.attachments.length > 0
    ? appr.attachments
    : Array.isArray(fields.attachments)
    ? fields.attachments
    : [];
  const attachedImages = cardAttachments.filter(isImageAttachment);
  const attachedDocs = cardAttachments.filter((a) => !isImageAttachment(a));

  const approverIds = Array.isArray(appr.approver_ids) && appr.approver_ids.length > 0
    ? appr.approver_ids
    : [];
  const approvals = Array.isArray(appr.approvals) ? appr.approvals : [];
  const rejections = Array.isArray(appr.rejections) ? appr.rejections : [];

  const approvedUserIds = Array.from(
    new Set(approvals.map((a) => (typeof a === "string" ? a : a?.user_id)).filter(Boolean))
  );
  const rejectedUserIds = Array.from(
    new Set(rejections.map((r) => (typeof r === "string" ? r : r?.user_id)).filter(Boolean))
  );

  const totalNeeded = Math.max(1, approverIds.length || 1);
  const approvedCount = Math.min(totalNeeded, approvedUserIds.length);
  const progressPercent = Math.min(100, Math.round((approvedCount / totalNeeded) * 100));
  const isRejected = appr.status === "rejected" || rejectedUserIds.length > 0;
  const isApprovedFull = !isRejected && (approvedCount >= totalNeeded || appr.status === "approved");

  const extraDeciderIds = Array.from(new Set([...approvedUserIds, ...rejectedUserIds])).filter(
    (uid) => !approverIds.includes(uid)
  );
  const displayApproverIds = [...extraDeciderIds, ...approverIds];
  const safeRefLink = safeHttpUrl(fields.reference_link);

  const myUid = me?.user_id;
  const isDesignatedApprover = approverIds.length === 0 || (myUid && approverIds.includes(myUid)) || isAdmin;
  const iAlreadyApproved = Boolean(myUid && approvedUserIds.includes(myUid));
  const iAlreadyRejected = Boolean(myUid && rejectedUserIds.includes(myUid));

  const requester = userMap[appr.requester_id] || {
    user_id: appr.requester_id,
    name: appr.requester_name || "Anggota Tim",
    department: appr.requester_department,
    job_title: appr.requester_job_title,
  };

  const handleDecision = async (decision, noteText = "") => {
    if (busy || !myUid) return;
    const prevAppr = appr;
    const nowIso = new Date().toISOString();

    let nextApprovals = [...approvals.filter((a) => (typeof a === "string" ? a : a?.user_id) !== myUid)];
    let nextRejections = [...rejections.filter((r) => (typeof r === "string" ? r : r?.user_id) !== myUid)];

    if (decision === "approve") {
      nextApprovals.push({
        user_id: myUid,
        name: me?.name || "Approver",
        note: noteText,
        at: nowIso,
      });
    } else if (decision === "reject") {
      nextRejections.push({
        user_id: myUid,
        name: me?.name || "Approver",
        note: noteText,
        at: nowIso,
      });
    }

    const nextApprovedIds = Array.from(
      new Set(nextApprovals.map((a) => (typeof a === "string" ? a : a?.user_id)).filter(Boolean))
    );
    const nextApprovedCount = Math.min(totalNeeded, nextApprovedIds.length);
    const nextProgress = Math.min(100, Math.round((nextApprovedCount / totalNeeded) * 100));
    const nextStatus =
      nextRejections.length > 0
        ? "rejected"
        : nextApprovedCount >= totalNeeded
        ? "approved"
        : nextApprovedCount > 0
        ? "partial"
        : "pending";

    const optimistic = {
      ...appr,
      approvals: nextApprovals,
      rejections: nextRejections,
      progress: nextProgress,
      status: nextStatus,
    };

    setAppr(optimistic);
    setShowRejectNote(false);
    setRejectNote("");
    updateMessageInCache({ ...m, form_approval: optimistic });

    if (decision === "approve") {
      if (nextApprovedCount >= totalNeeded) {
        playSound("task_done");
      } else {
        playSound("check");
      }
    } else {
      playSound("uncheck");
    }

    setBusy(true);
    try {
      const { data } = await api.post(`/messages/${m.id}/form-approval-decide`, {
        decision,
        note: noteText,
      });
      if (data?.message?.form_approval) {
        setAppr(data.message.form_approval);
        updateMessageInCache(data.message);
      }
      if (decision === "approve") {
        if (nextApprovedCount >= totalNeeded) {
          toast.success(`Approval selesai ${nextApprovedCount}/${totalNeeded} (100%)!`);
        } else {
          toast.success(`Approval ${nextApprovedCount}/${totalNeeded} (${nextProgress}%) tercatat.`);
        }
      } else if (decision === "unapprove") {
        toast.info("Approval dibatalkan.");
      } else {
        toast.info("Pengajuan ditandai perlu revisi / ditolak.");
      }
    } catch (err) {
      setAppr(prevAppr);
      updateMessageInCache({ ...m, form_approval: prevAppr });
      toast.error(errMsg(err, "Gagal memperbarui status approval"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="w-[min(36rem,calc(100vw-4.5rem))] sm:w-[560px] max-w-full rounded-2xl border border-l-[4px] border-slate-200/90 dark:border-slate-800 bg-surface p-3.5 text-left text-ink shadow-sm"
        style={{ borderLeftColor: theme.topBar }}
        data-testid={`message-approval-card-${m.id}`}
      >
        {/* Top Compact Header Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${theme.badge}`}>
              <Icon size={12} />
              <span>{appr.form_label || theme.label}</span>
            </span>
            <h4 className="text-sm font-extrabold text-ink truncate">
              {appr.title || theme.label}
            </h4>
          </div>

          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${
              isRejected
                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                : isApprovedFull
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : approvedCount > 0
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
            data-testid={`approval-card-status-${m.id}`}
          >
            {isRejected ? (
              <>
                <XCircle size={12} />
                <span>Ditolak</span>
              </>
            ) : isApprovedFull ? (
              <>
                <CheckCircle2 size={12} />
                <span>Disetujui</span>
              </>
            ) : approvedCount > 0 ? (
              <>
                <Clock size={12} />
                <span>Diproses</span>
              </>
            ) : (
              <>
                <Clock size={12} />
                <span>Menunggu</span>
              </>
            )}
          </span>
        </div>

        {/* Horizontal 2-Column Body */}
        <div className="mt-2.5 grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* LEFT COLUMN: Requester + Structured Details + Invoice Attachments */}
          <div className="md:col-span-7 flex flex-col gap-2 min-w-0">
            {/* Compact Requester Strip */}
            <div className="flex items-center gap-2 rounded-xl bg-surface2/60 px-2.5 py-1.5">
              <Avatar user={requester} size={24} showStatus={false} />
              <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs">
                <span className="font-bold text-ink truncate">{requester?.name || appr.requester_name}</span>
                <span className="text-[10.5px] text-sub truncate hidden sm:inline">
                  · {requester?.department || appr.requester_department || "Tim"}
                </span>
              </div>
            </div>

            {/* Structured Form Details */}
            <div className="space-y-1.5 text-xs">
              {formType === "leave" && (
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Jenis Cuti</span>
                    <span className="font-bold text-ink truncate block">{fields.category || "Cuti Tahunan"}</span>
                  </div>
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Durasi</span>
                    <span className="font-bold text-brand">{fields.duration_days || 1} Hari Kerja</span>
                  </div>
                  <div className={`rounded-xl border bg-surface2/40 px-2.5 py-1.5 ${fields.delegate_name ? "" : "col-span-2"}`}>
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Periode</span>
                    <span className="font-semibold text-ink">
                      {fields.start_date && fields.end_date && fields.start_date === fields.end_date
                        ? formatShortDate(fields.start_date)
                        : `${formatShortDate(fields.start_date)} — ${formatShortDate(fields.end_date)}`}
                    </span>
                  </div>
                  {fields.delegate_name && (
                    <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                      <span className="block text-[9.5px] uppercase font-bold text-sub">Delegasi</span>
                      <span className="font-semibold text-ink truncate block">{fields.delegate_name}</span>
                    </div>
                  )}
                </div>
              )}

              {formType === "item_request" && (
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Kategori</span>
                    <span className="font-semibold text-ink truncate block">{fields.category || "Perangkat"}</span>
                  </div>
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Jumlah & Prioritas</span>
                    <span className="font-bold text-ink truncate block">
                      {fields.qty || 1} {fields.unit || "Unit"} ·{" "}
                      <span className={fields.urgency?.includes("Mendesak") ? "text-rose-600" : "text-brand"}>
                        {fields.urgency || "Penting"}
                      </span>
                    </span>
                  </div>
                  {(fields.estimated_price || safeRefLink) && (
                    <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                      {fields.estimated_price && (
                        <div>
                          <span className="block text-[9.5px] uppercase font-bold text-sub">Estimasi Harga</span>
                          <span className="font-bold text-ink">{fields.estimated_price}</span>
                        </div>
                      )}
                      {safeRefLink && (
                        <a
                          href={safeRefLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-brand hover:bg-rose-500/20"
                        >
                          <ExternalLink size={11} /> Link Referensi
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {formType === "reimbursement" && (
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Nominal Klaim</span>
                    <span className="font-extrabold text-brand">{fields.amount || "-"}</span>
                  </div>
                  <div className="rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                    <span className="block text-[9.5px] uppercase font-bold text-sub">Tanggal</span>
                    <span className="font-semibold text-ink">{formatShortDate(fields.transaction_date)}</span>
                  </div>
                  {fields.category && (
                    <div className="col-span-2 rounded-xl border bg-surface2/40 px-2.5 py-1.5">
                      <span className="block text-[9.5px] uppercase font-bold text-sub">Kategori</span>
                      <span className="font-semibold text-ink truncate block">{fields.category}</span>
                    </div>
                  )}
                </div>
              )}

              {fields.reason && (
                <div className="rounded-xl border bg-surface2/30 px-2.5 py-1.5">
                  <span className="block text-[9.5px] uppercase font-bold text-sub mb-0.5">Keterangan</span>
                  <p className="text-[11.5px] text-ink/90 leading-relaxed whitespace-pre-wrap break-words line-clamp-3">
                    {fields.reason}
                  </p>
                </div>
              )}

              {/* Invoice / Document Attachments */}
              {cardAttachments.length > 0 && (
                <div className="rounded-xl border bg-surface2/30 p-2 space-y-1.5" data-testid={`approval-attachments-${m.id}`}>
                  <span className="flex items-center gap-1 text-[9.5px] uppercase font-bold text-sub">
                    <Paperclip size={10} className="text-amber-600" />
                    Lampiran Invoice ({cardAttachments.length})
                  </span>
                  {attachedImages.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedImages.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxImg(img);
                          }}
                          className="group/img relative overflow-hidden rounded-lg border bg-surface cursor-zoom-in focus:outline-none"
                          title={img.name || "Lihat gambar"}
                        >
                          <img
                            src={fileUrl(img.id)}
                            alt={img.name || "Invoice"}
                            loading="lazy"
                            className="h-12 w-12 object-cover transition-transform duration-150 group-hover/img:scale-105"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {attachedDocs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedDocs.map((doc) => (
                        <a
                          key={doc.id}
                          href={fileUrl(doc.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded-lg border bg-surface hover:bg-surface2 px-2 py-1 text-[11px] font-semibold text-ink max-w-full transition-colors"
                          title={doc.name}
                        >
                          <FileText size={12} className="text-amber-600 shrink-0" />
                          <span className="truncate max-w-[150px]">{doc.name}</span>
                          {doc.size > 0 && (
                            <span className="text-[9.5px] text-sub shrink-0">{formatFileSize(doc.size)}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Progress Bar + Approvers + Action Buttons */}
          <div className="md:col-span-5 md:border-l md:pl-3 flex flex-col justify-between gap-2.5 min-w-0">
            <div className="space-y-2">
              {/* Progress Header & Bar */}
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold mb-1">
                  <span className="text-sub">Progres</span>
                  <span
                    className={`font-extrabold tabular-nums ${
                      isRejected
                        ? "text-rose-600"
                        : isApprovedFull
                        ? "text-emerald-600"
                        : approvedCount > 0
                        ? "text-amber-600"
                        : "text-sub"
                    }`}
                    data-testid={`approval-card-progress-text-${m.id}`}
                  >
                    {approvedCount}/{totalNeeded} · {progressPercent}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      isRejected
                        ? "bg-rose-500"
                        : isApprovedFull
                        ? "bg-emerald-500"
                        : theme.barFill
                    }`}
                    style={{ width: `${progressPercent}%` }}
                    data-testid={`approval-card-progress-bar-${m.id}`}
                  />
                </div>
              </div>

              {/* Approvers List */}
              {displayApproverIds.length > 0 && (
                <div className="space-y-1">
                  {displayApproverIds.map((uid) => {
                    const appEntry = approvals.find((a) => (typeof a === "string" ? a : a?.user_id) === uid);
                    const rejEntry = rejections.find((r) => (typeof r === "string" ? r : r?.user_id) === uid);
                    const fallbackName =
                      (typeof appEntry === "object" && appEntry?.name) ||
                      (typeof rejEntry === "object" && rejEntry?.name) ||
                      uid;
                    const u = userMap[uid] || { user_id: uid, name: fallbackName };
                    const isExtraAdmin = !approverIds.includes(uid);
                    const hasApproved = Boolean(appEntry);
                    const hasRejected = Boolean(rejEntry);
                    const entryNote = (typeof rejEntry === "object" && rejEntry?.note) || (typeof appEntry === "object" && appEntry?.note);

                    return (
                      <div
                        key={uid}
                        className="flex flex-col rounded-xl border bg-surface2/40 px-2 py-1 text-[11px]"
                        data-testid={`approver-row-${m.id}-${uid}`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Avatar user={u} size={18} showStatus={false} />
                            <span className="font-semibold text-ink truncate">{u.name}</span>
                            {isExtraAdmin && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-slate-200/80 dark:bg-slate-700/80 text-sub shrink-0">
                                Admin
                              </span>
                            )}
                          </div>
                          {hasApproved ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                              <Check size={9} strokeWidth={3} /> OK
                            </span>
                          ) : hasRejected ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 px-1.5 py-0.5 text-[9.5px] font-bold text-rose-700 dark:text-rose-300 shrink-0">
                              <XCircle size={9} /> Tolak
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100/80 dark:bg-amber-950/40 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-800 dark:text-amber-300 shrink-0">
                              <Clock size={9} /> Tunggu
                            </span>
                          )}
                        </div>
                        {entryNote && (
                          <p className="mt-0.5 text-[10.5px] italic text-sub pl-6 break-words">
                            &ldquo;{entryNote}&rdquo;
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t">
              {isApprovedFull ? (
                <div
                  className={`flex items-center ${
                    iAlreadyApproved ? "justify-between" : "justify-center"
                  } gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span>Persetujuan Selesai</span>
                  </span>
                  {iAlreadyApproved && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDecision("unapprove")}
                      className="rounded-lg border border-emerald-300/80 dark:border-emerald-700 bg-white/85 dark:bg-emerald-950/70 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 transition-colors cursor-pointer disabled:opacity-50"
                      title="Klik untuk membatalkan approval Anda"
                      data-testid={`form-approval-unapprove-btn-${m.id}`}
                    >
                      Batalkan
                    </button>
                  )}
                </div>
              ) : isDesignatedApprover ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDecision(iAlreadyApproved ? "unapprove" : "approve")}
                      title={iAlreadyApproved ? "Klik untuk membatalkan approval Anda" : "Setujui pengajuan"}
                      className={`flex h-8 items-center justify-center gap-1 rounded-xl text-[11px] font-bold shadow-xs disabled:opacity-50 transition-colors cursor-pointer ${
                        iAlreadyApproved
                          ? "border border-emerald-400/80 dark:border-emerald-700 bg-emerald-100/90 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                          : "bg-emerald-500 hover:bg-emerald-600 text-white"
                      }`}
                      data-testid={`form-approval-approve-btn-${m.id}`}
                    >
                      <Check size={13} strokeWidth={2.5} />
                      <span>{iAlreadyApproved ? "Approved" : "Approve"}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowRejectNote((v) => !v)}
                      className="flex h-8 items-center justify-center gap-1 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 text-[11px] font-bold text-rose-700 dark:text-rose-300 disabled:opacity-50 transition-colors cursor-pointer"
                      data-testid={`form-approval-reject-btn-${m.id}`}
                    >
                      <span>{iAlreadyRejected ? "Ubah Tolak" : "Tolak"}</span>
                    </button>
                  </div>

                  {showRejectNote && (
                    <div className="flex items-center gap-1 pt-0.5">
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Catatan revisi..."
                        className="h-8 min-w-0 flex-1 rounded-xl border bg-surface2 px-2 text-[11px] outline-none"
                        data-testid={`form-approval-reject-note-${m.id}`}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecision("reject", rejectNote.trim())}
                        className="h-8 rounded-xl bg-rose-600 hover:bg-rose-700 px-2.5 text-[11px] font-bold text-white shrink-0 cursor-pointer"
                        data-testid={`form-approval-confirm-reject-${m.id}`}
                      >
                        Kirim
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center text-[11px] text-sub italic">
                  Menunggu persetujuan approver.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      <ImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
    </>
  );
});

export default ApprovalRequestCard;
