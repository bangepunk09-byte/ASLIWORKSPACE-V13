import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  CalendarDays,
  Package,
  FileText,
  FolderOpen,
  Search,
  Plus,
  Download,
  Paperclip,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  ShieldCheck,
  Lock,
  Loader2,
  Upload,
  X,
  Building2,
  Users,
  Eye,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, uploadFile } from "../lib/api";
import { playSound } from "../lib/sound";
import { Avatar, Empty, ImageLightbox } from "../components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";
import { RupiahReceiptIcon } from "./marketplace/catalogAssets";
import {
  canAccessEmployeeArchives,
  canViewAllArchiveDivisions,
  inferUserOrgLevel,
  getOrgLevelMeta,
} from "../lib/orgLevels";
import { readArchivesCache, writeArchivesCache } from "../lib/archivesCache";

const ARCHIVE_CATEGORIES = [
  {
    id: "leave",
    label: "Surat Izin & Cuti",
    shortLabel: "Surat Izin",
    icon: CalendarDays,
    chipClass: "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/70",
    iconBg: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
    subOptions: [
      "Cuti Tahunan",
      "Izin Sakit (Surat Dokter)",
      "Izin Keperluan Keluarga / Mendesak",
      "Cuti Menikah / Melahirkan",
      "Work From Home (WFH) / Dinas Luar",
    ],
  },
  {
    id: "item_request",
    label: "Request Barang & Aset",
    shortLabel: "Request Barang",
    icon: Package,
    chipClass: "bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70",
    iconBg: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400",
    subOptions: [
      "Perangkat Kerja & IT",
      "Kebutuhan Produksi & Studio",
      "Perlengkapan Kantor (ATK & Inventaris)",
      "Lisensi Software & Langganan",
      "Pengadaan Lainnya",
    ],
  },
  {
    id: "reimbursement",
    label: "Reimburse & Dana",
    shortLabel: "Reimburse",
    icon: RupiahReceiptIcon,
    chipClass: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70",
    iconBg: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    subOptions: [
      "Transportasi & Perjalanan Dinas",
      "Kebutuhan Produksi & Operasional",
      "Konsumsi & Jamuan Klien",
      "Iklan & Kampanye Marketing",
      "Reimburse Lainnya",
    ],
  },
  {
    id: "other",
    label: "Administrasi Lainnya",
    shortLabel: "Administrasi",
    icon: FileText,
    chipClass: "bg-violet-50 text-violet-700 border-violet-200/80 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800/70",
    iconBg: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
    subOptions: [
      "Surat Tugas",
      "Surat Keterangan Kerja",
      "Berita Acara & Serah Terima",
      "Evaluasi / Surat Peringatan (SP)",
      "Kontrak / Addendum Karyawan",
      "Dokumen Administrasi Lainnya",
    ],
  },
];

const CATEGORY_MAP = Object.fromEntries(ARCHIVE_CATEGORIES.map((c) => [c.id, c]));

const STATUS_META = {
  approved: {
    label: "Disetujui",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/70",
    icon: CheckCircle2,
  },
  partial: {
    label: "Sebagian",
    badge: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/70",
    icon: Clock,
  },
  pending: {
    label: "Menunggu",
    badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    icon: Clock,
  },
  rejected: {
    label: "Ditolak",
    badge: "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/70",
    icon: XCircle,
  },
};

function fmtRp(num) {
  const n = Number(num) || 0;
  if (n <= 0) return "Rp 0";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function fmtShortDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return format(d, "d MMM yyyy", { locale: localeId });
  } catch {
    return String(iso);
  }
}

function fmtMonthLabel(ym) {
  if (!ym || ym === "all") return "Semua Bulan";
  try {
    const [y, m] = ym.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    if (Number.isNaN(d.getTime())) return ym;
    return format(d, "MMMM yyyy", { locale: localeId });
  } catch {
    return ym;
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

function computeDays(startStr, endStr) {
  if (!startStr || !endStr) return 1;
  try {
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  } catch {
    return 1;
  }
}

function CreateArchiveDialog({ open, onOpenChange, divisions, canViewAll, defaultDivision, onCreated }) {
  const { me, users } = useApp();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const fileInputRef = useRef(null);

  const [category, setCategory] = useState("leave");
  const [subCategory, setSubCategory] = useState(ARCHIVE_CATEGORIES[0].subOptions[0]);
  const [employeeId, setEmployeeId] = useState(me?.user_id || "");
  const [division, setDivision] = useState(defaultDivision || me?.department || "Umum");
  const [title, setTitle] = useState("");
  const [dateStart, setDateStart] = useState(todayIso);
  const [dateEnd, setDateEnd] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemUnit, setItemUnit] = useState("Unit");
  const [status, setStatus] = useState("approved");
  const [approverIds, setApproverIds] = useState(() => (me?.user_id ? [me.user_id] : []));
  const [approverPicker, setApproverPicker] = useState("");
  const [reason, setReason] = useState("");
  const [archiveNote, setArchiveNote] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const humanUsers = useMemo(
    () =>
      (Array.isArray(users) ? users : [])
        .filter((u) => u && u.user_id && !u.is_bot && u.role !== "assistant" && u.status !== "suspended")
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [users]
  );

  const visibleEmployees = useMemo(() => {
    if (canViewAll) return humanUsers;
    const myDept = String(me?.department || "").toLowerCase();
    return humanUsers.filter((u) => !myDept || String(u.department || "").toLowerCase() === myDept);
  }, [humanUsers, canViewAll, me?.department]);

  const catMeta = CATEGORY_MAP[category] || ARCHIVE_CATEGORIES[0];

  useEffect(() => {
    if (!open) return;
    setSubCategory(catMeta.subOptions[0] || "");
  }, [category, open]); // eslint-disable-line

  useEffect(() => {
    if (!open) return;
    if (defaultDivision && defaultDivision !== "all") {
      setDivision(defaultDivision);
    } else if (me?.department) {
      setDivision(me.department);
    }
    if (!employeeId && me?.user_id) {
      setEmployeeId(me.user_id);
    }
    if (approverIds.length === 0 && me?.user_id) {
      setApproverIds([me.user_id]);
    }
  }, [open, defaultDivision, me?.department, me?.user_id]); // eslint-disable-line

  const handleEmployeeChange = (uid) => {
    setEmployeeId(uid);
    const emp = humanUsers.find((u) => u.user_id === uid);
    if (emp?.department && canViewAll) {
      setDivision(emp.department);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > 10) {
      toast.error("Maksimal 10 file lampiran per arsip dokumen.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`File "${file.name}" melebihi batas 15 MB.`);
          continue;
        }
        const up = await uploadFile(file);
        if (up?.id) {
          uploaded.push({
            id: up.id,
            name: up.name || file.name,
            content_type: up.content_type || file.type || "",
            size: up.size || file.size || 0,
          });
        }
      }
      if (uploaded.length) {
        setAttachments((prev) => [...prev, ...uploaded]);
        playSound("pop");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah lampiran dokumen"));
    } finally {
      setUploading(false);
    }
  };

  const durationDays = useMemo(() => computeDays(dateStart, dateEnd), [dateStart, dateEnd]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!title.trim()) {
      toast.error("Judul / perihal dokumen wajib diisi.");
      return;
    }
    if (uploading) {
      toast.info("Tunggu proses unggah lampiran selesai terlebih dahulu.");
      return;
    }
    setSaving(true);
    try {
      const emp = humanUsers.find((u) => u.user_id === employeeId);
      const fields =
        category === "leave"
          ? { category: subCategory, start_date: dateStart, end_date: dateEnd, duration_days: durationDays, reason: reason.trim() }
          : category === "item_request"
          ? { category: subCategory, item_name: title.trim(), qty: Number(itemQty) || 1, unit: itemUnit, estimated_price: amount.trim() || null, reason: reason.trim() }
          : category === "reimbursement"
          ? { category: subCategory, claim_title: title.trim(), amount: amount.trim(), transaction_date: dateStart, reason: reason.trim() }
          : { category: subCategory, document_date: dateStart, reason: reason.trim() };

      const { data } = await api.post("/employee-archives", {
        category,
        sub_category: subCategory,
        title: title.trim(),
        employee_id: emp?.user_id || employeeId || me?.user_id,
        employee_name: emp?.name || me?.name,
        division: canViewAll ? (division || emp?.department || "Umum") : (me?.department || division || "Umum"),
        status,
        approver_ids: approverIds.length > 0 ? approverIds : [me?.user_id].filter(Boolean),
        date_start: dateStart,
        date_end: category === "leave" ? dateEnd : dateStart,
        amount_label: amount.trim(),
        reason: reason.trim(),
        archive_note: archiveNote.trim(),
        fields,
        attachments,
      });

      playSound("post");
      toast.success("Dokumen berhasil disimpan ke Arsip Dokumen.");
      onCreated?.(data);
      onOpenChange(false);

      // Reset form
      setTitle("");
      setAmount("");
      setItemQty("1");
      setReason("");
      setArchiveNote("");
      setAttachments([]);
      setStatus("approved");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengarsipkan dokumen"));
    } finally {
      setSaving(false);
    }
  };

  const divisionOptions = useMemo(() => {
    const set = new Set(divisions || []);
    if (me?.department) set.add(me.department);
    if (division) set.add(division);
    if (set.size === 0) set.add("Umum");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [divisions, me?.department, division]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl w-[min(94vw,52rem)] max-w-4xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-extrabold text-ink">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand">
              <Archive size={18} />
            </span>
            <span>Arsipkan Dokumen Karyawan</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
          {/* Category Switcher */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ARCHIVE_CATEGORIES.map((c) => {
              const Icon = c.icon;
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    playSound("tab");
                    setCategory(c.id);
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all cursor-pointer ${
                    active
                      ? "border-brand bg-brand text-white shadow-xs"
                      : "bg-surface2/50 text-sub hover:bg-surface2 hover:text-ink"
                  }`}
                  data-testid={`archive-cat-btn-${c.id}`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{c.shortLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Left column */}
            <div className="md:col-span-7 space-y-3 rounded-2xl border bg-surface2/35 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Karyawan Terkait</label>
                  <AppSelect
                    value={employeeId}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                    data-testid="archive-employee-select"
                  >
                    {visibleEmployees.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name} {u.department ? `— ${u.department}` : ""}
                      </option>
                    ))}
                  </AppSelect>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Divisi Arsip</label>
                  <AppSelect
                    value={division}
                    disabled={!canViewAll}
                    onChange={(e) => setDivision(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink disabled:opacity-70"
                    data-testid="archive-division-select"
                  >
                    {divisionOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </AppSelect>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Sub-Kategori</label>
                  <AppSelect
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                  >
                    {catMeta.subOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </AppSelect>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Status Dokumen</label>
                  <AppSelect
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                    data-testid="archive-status-select"
                  >
                    <option value="approved">Disetujui & Terarsip</option>
                    <option value="pending">Menunggu Approval</option>
                    <option value="rejected">Ditolak</option>
                  </AppSelect>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-sub mb-1">Judul / Perihal Dokumen</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    category === "leave"
                      ? "Contoh: Izin Sakit Rawat Jalan (2 Hari)"
                      : category === "item_request"
                      ? "Contoh: Pengadaan Monitor Dell 27 Inch"
                      : category === "reimbursement"
                      ? "Contoh: Reimburse Transport Meeting Klien Jakarta"
                      : "Contoh: Surat Tugas Dinas Luar Kota Surabaya"
                  }
                  className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-brand"
                  data-testid="archive-title-input"
                />
              </div>

              {category === "leave" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Tanggal Mulai</label>
                    <DatePicker
                      value={dateStart}
                      onChange={(v) => {
                        setDateStart(v);
                        if (dateEnd && v > dateEnd) setDateEnd(v);
                      }}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">
                      Tanggal Selesai <span className="text-brand font-bold">· {durationDays} Hari</span>
                    </label>
                    <DatePicker
                      value={dateEnd}
                      onChange={setDateEnd}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                    />
                  </div>
                </div>
              ) : category === "item_request" ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Jumlah</label>
                    <input
                      type="number"
                      min={1}
                      value={itemQty}
                      onChange={(e) => setItemQty(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Satuan</label>
                    <AppSelect
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                    >
                      {["Unit", "Pcs", "Set / Paket", "Box", "Lisensi"].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </AppSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Estimasi Nilai</label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Rp 2.500.000"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-brand"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">
                      {category === "reimbursement" ? "Tanggal Transaksi" : "Tanggal Dokumen"}
                    </label>
                    <DatePicker
                      value={dateStart}
                      onChange={setDateStart}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">
                      {category === "reimbursement" ? "Nominal Klaim" : "Nominal (Opsional)"}
                    </label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Rp 500.000"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand"
                      data-testid="archive-amount-input"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-sub mb-1">Keterangan / Ringkasan</label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Tuliskan rincian keperluan, nomor surat, atau catatan penting untuk arsip..."
                  className="w-full rounded-xl border bg-surface p-2.5 text-sm text-ink outline-none focus:border-brand resize-none"
                />
              </div>
            </div>

            {/* Right column: Approvers & Attachments */}
            <div className="md:col-span-5 flex flex-col justify-between gap-3 rounded-2xl border bg-surface2/45 p-4">
              <div className="space-y-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-ink mb-1">
                    <Users size={13} className="text-brand" />
                    <span>Pihak Penyetuju / Approver</span>
                  </label>
                  <AppSelect
                    value={approverPicker}
                    onChange={(e) => {
                      const uid = e.target.value;
                      setApproverPicker("");
                      if (uid && !approverIds.includes(uid)) {
                        setApproverIds((prev) => [...prev, uid]);
                      }
                    }}
                    className="h-9 w-full rounded-xl border bg-surface px-3 text-xs font-semibold text-ink"
                  >
                    <option value="">+ Tambah Approver...</option>
                    {humanUsers.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name} — {u.job_title || u.department || "Tim"}
                      </option>
                    ))}
                  </AppSelect>
                  {approverIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {approverIds.map((uid) => {
                        const u = humanUsers.find((x) => x.user_id === uid) || { user_id: uid, name: uid };
                        return (
                          <span
                            key={uid}
                            className="inline-flex items-center gap-1.5 rounded-full border bg-surface pl-1 pr-2 py-0.5 text-[11px] font-bold text-ink"
                          >
                            <Avatar user={u} size={18} showStatus={false} ringDeadline={false} />
                            <span className="truncate max-w-[110px]">{u.name}</span>
                            {approverIds.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setApproverIds((prev) => prev.filter((id) => id !== uid))}
                                className="text-sub hover:text-rose-600 cursor-pointer"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink mb-1">Catatan Arsip (Opsional)</label>
                  <input
                    value={archiveNote}
                    onChange={(e) => setArchiveNote(e.target.value)}
                    placeholder="Contoh: Nota asli diterima HRD / Finance"
                    className="h-9 w-full rounded-xl border bg-surface px-3 text-xs text-ink outline-none focus:border-brand"
                  />
                </div>

                {/* Lampiran File */}
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    Lampiran Dokumen (PDF, Foto Surat, Struk)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
                    hidden
                    onChange={handleFileUpload}
                    data-testid="archive-file-input"
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/80 hover:bg-surface px-3 py-3 text-xs font-semibold text-sub hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 size={14} className="animate-spin text-brand" />
                    ) : (
                      <Upload size={14} className="text-brand" />
                    )}
                    <span>{uploading ? "Mengunggah file..." : "Unggah Surat Izin / Invoice / PDF"}</span>
                  </button>

                  {attachments.length > 0 && (
                    <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto scroll-thin">
                      {attachments.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-1.5">
                          <Paperclip size={12} className="text-brand shrink-0" />
                          <span className="truncate flex-1 text-[11px] font-semibold text-ink">{f.name}</span>
                          <span className="text-[10px] text-sub shrink-0">{formatFileSize(f.size)}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== f.id))}
                            className="text-sub hover:text-rose-600 cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="btn-ghost h-10 px-4 text-xs font-semibold text-sub"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="btn-accent h-10 px-5 text-xs font-bold shadow-xs disabled:opacity-50"
                  data-testid="archive-submit-btn"
                >
                  {saving ? "Menyimpan..." : "Simpan ke Arsip"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDetailDialog({ item, onClose, onDecisionDone, onDeleted, onPreviewImage, canManageAll }) {
  const { me, userMap, isAdmin } = useApp();
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setNote("");
    setConfirmDelete(false);
  }, [item?.id]);

  if (!item) return null;

  const catMeta = CATEGORY_MAP[item.category] || ARCHIVE_CATEGORIES[3];
  const CatIcon = catMeta.icon;
  const statusMeta = STATUS_META[item.status] || STATUS_META.pending;
  const StatusIcon = statusMeta.icon;
  const empUser = userMap?.[item.employee_id] || { user_id: item.employee_id, name: item.employee_name };

  const approverIds = Array.isArray(item.approver_ids) ? item.approver_ids : [];
  const approvals = Array.isArray(item.approvals) ? item.approvals : [];
  const rejections = Array.isArray(item.rejections) ? item.rejections : [];
  const canDecide =
    (item.status === "pending" || item.status === "partial") &&
    Boolean(
      isAdmin ||
        (item.source === "manual" && canManageAll) ||
        approverIds.includes(me?.user_id)
    );
  const canDelete = item.source === "manual" && Boolean(isAdmin || item.created_by === me?.user_id);

  const handleDecide = async (decision) => {
    if (deciding) return;
    setDeciding(true);
    try {
      if (item.source === "form_approval" && item.message_id) {
        await api.post(`/messages/${item.message_id}/form-approval-decide`, { decision, note: note.trim() });
      } else {
        await api.post(`/employee-archives/${item.id}/decide`, { decision, note: note.trim() });
      }
      playSound(decision === "approve" ? "task_done" : "pop");
      toast.success(decision === "approve" ? "Pengajuan berhasil disetujui." : "Pengajuan telah ditolak.");
      setNote("");
      await onDecisionDone?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memproses keputusan approval"));
    } finally {
      setDeciding(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.delete(`/employee-archives/${item.id}`);
      playSound("trash");
      toast.success("Arsip dokumen berhasil dihapus.");
      onDeleted?.(item.id);
      onClose?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus arsip"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="bg-surface rounded-3xl w-[min(94vw,44rem)] max-w-2xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="pb-2 border-b">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="rounded-lg bg-surface2 px-2 py-0.5 text-[11px] font-bold tracking-wide text-sub font-mono">
              {item.ref_code}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${catMeta.chipClass}`}>
              <CatIcon size={12} />
              <span>{catMeta.shortLabel}</span>
            </span>
            <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${statusMeta.badge}`}>
              <StatusIcon size={12} />
              <span>{statusMeta.label}</span>
            </span>
            <span className="rounded-lg bg-surface2 px-2 py-0.5 text-[10px] font-semibold text-sub">
              {item.source === "form_approval" ? "Otomatis dari Chat" : "Arsip Manual"}
            </span>
          </div>
          <DialogTitle className="mt-2 text-lg font-extrabold text-ink leading-snug">
            {item.title}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* Employee & Division */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border bg-surface2/45 p-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar user={empUser} size={38} showStatus={false} />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Karyawan</p>
                <p className="truncate text-sm font-bold text-ink">{item.employee_name}</p>
                {item.employee_job_title && (
                  <p className="truncate text-[11px] text-sub">{item.employee_job_title}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Divisi & Tanggal Pengajuan</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-lg bg-surface border px-2 py-0.5 text-xs font-bold text-ink">
                  <Building2 size={12} className="text-brand" />
                  {item.division}
                </span>
                <span className="text-xs font-medium text-sub">{fmtShortDate(item.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Structured Category Details */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {item.sub_category && (
              <div className="rounded-xl border bg-surface p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Jenis</p>
                <p className="mt-0.5 text-xs font-bold text-ink">{item.sub_category}</p>
              </div>
            )}
            {item.category === "leave" && (
              <>
                <div className="rounded-xl border bg-surface p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Periode</p>
                  <p className="mt-0.5 text-xs font-bold text-ink">
                    {fmtShortDate(item.date_start)}
                    {item.date_end && item.date_end !== item.date_start ? ` – ${fmtShortDate(item.date_end)}` : ""}
                  </p>
                </div>
                <div className="rounded-xl border bg-surface p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Durasi</p>
                  <p className="mt-0.5 text-xs font-extrabold text-brand">{item.duration_days || 1} Hari</p>
                </div>
              </>
            )}
            {item.category === "item_request" && (
              <>
                <div className="rounded-xl border bg-surface p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Kuantitas</p>
                  <p className="mt-0.5 text-xs font-bold text-ink">
                    {item.fields?.qty || 1} {item.fields?.unit || "Unit"}
                  </p>
                </div>
                {item.fields?.urgency && (
                  <div className="rounded-xl border bg-surface p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Prioritas</p>
                    <p className="mt-0.5 text-xs font-bold text-ink">{item.fields.urgency}</p>
                  </div>
                )}
              </>
            )}
            {(item.amount_label || item.amount_numeric > 0) && (
              <div className="rounded-xl border bg-surface p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Nominal</p>
                <p className="mt-0.5 text-xs font-extrabold text-amber-600 dark:text-amber-400">
                  {item.amount_numeric > 0 ? fmtRp(item.amount_numeric) : item.amount_label}
                </p>
              </div>
            )}
            {item.fields?.delegate_name && (
              <div className="rounded-xl border bg-surface p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Delegasi / Backup</p>
                <p className="mt-0.5 text-xs font-bold text-ink">{item.fields.delegate_name}</p>
              </div>
            )}
          </div>

          {/* Reason & Notes */}
          {(item.reason || item.archive_note) && (
            <div className="rounded-2xl border bg-surface p-3.5 space-y-2">
              {item.reason && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Alasan / Rincian</p>
                  <p className="mt-1 text-sm text-ink whitespace-pre-wrap leading-relaxed">{item.reason}</p>
                </div>
              )}
              {item.archive_note && (
                <div className="border-t pt-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sub">Catatan Arsip</p>
                  <p className="mt-0.5 text-xs font-medium text-sub">{item.archive_note}</p>
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          {Array.isArray(item.attachments) && item.attachments.length > 0 && (
            <div>
              <p className="text-xs font-bold text-ink mb-2 flex items-center gap-1.5">
                <Paperclip size={13} className="text-brand" />
                <span>Lampiran Dokumen ({item.attachments.length})</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {item.attachments.map((att) => {
                  const isImg = isImageAttachment(att);
                  const url = fileUrl(att.id);
                  return (
                    <div
                      key={att.id}
                      className="flex items-center gap-2.5 rounded-xl border bg-surface2/50 p-2"
                    >
                      {isImg ? (
                        <button
                          type="button"
                          onClick={() => onPreviewImage?.({ id: att.id, name: att.name, url })}
                          className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border cursor-pointer hover:opacity-90"
                        >
                          <img src={url} alt={att.name} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                          <FileText size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ink">{att.name}</p>
                        {att.size > 0 && <p className="text-[10px] text-sub">{formatFileSize(att.size)}</p>}
                      </div>
                      <a
                        href={`${url}?download=1`}
                        download={att.name}
                        className="btn-ghost flex h-8 w-8 shrink-0 items-center justify-center text-sub hover:text-ink"
                        title="Unduh lampiran"
                      >
                        <Download size={14} />
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Approval Audit Trail */}
          <div className="rounded-2xl border bg-surface2/35 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-ink flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-brand" />
                <span>Riwayat Persetujuan ({item.progress || 0}%)</span>
              </p>
              <span className="text-[11px] font-semibold text-sub">
                {approvals.length}/{Math.max(1, approverIds.length)} disetujui
              </span>
            </div>
            <div className="space-y-1.5">
              {(approverIds.length > 0 ? approverIds : approvals.map((a) => a.user_id)).map((uid) => {
                const apprObj = approvals.find((a) => (typeof a === "string" ? a : a?.user_id) === uid);
                const rejObj = rejections.find((r) => (typeof r === "string" ? r : r?.user_id) === uid);
                const u = userMap?.[uid] || { user_id: uid, name: apprObj?.name || rejObj?.name || "Approver" };
                return (
                  <div key={uid} className="flex items-center justify-between gap-2 rounded-xl border bg-surface px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar user={u} size={26} showStatus={false} ringDeadline={false} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-ink">{u.name}</p>
                        {(apprObj?.note || rejObj?.note) && (
                          <p className="truncate text-[11px] text-sub italic">"{apprObj?.note || rejObj?.note}"</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {apprObj ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 size={11} /> Disetujui
                        </span>
                      ) : rejObj ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                          <XCircle size={11} /> Ditolak
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-surface2 px-2 py-0.5 text-[10px] font-semibold text-sub">
                          <Clock size={11} /> Menunggu
                        </span>
                      )}
                      {(apprObj?.at || rejObj?.at) && (
                        <p className="mt-0.5 text-[10px] text-sub">{fmtShortDate(apprObj?.at || rejObj?.at)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inline Approve / Reject Action */}
          {canDecide && (
            <div className="rounded-2xl border border-brand/25 bg-brand/[0.03] p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-ink">Berikan Keputusan Approval</p>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Tambahkan catatan persetujuan atau alasan penolakan (opsional)..."
                className="h-9 w-full rounded-xl border bg-surface px-3 text-xs text-ink outline-none focus:border-brand"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => handleDecide("approve")}
                  className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  <span>{deciding ? "Memproses..." : "Setujui"}</span>
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => handleDecide("reject")}
                  className="flex-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-xs font-bold text-rose-700 dark:text-rose-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <XCircle size={14} />
                  <span>Tolak</span>
                </button>
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              {item.source === "form_approval" && item.conversation_id && (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    navigate(`/messages/${item.conversation_id}`);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-surface2/60 hover:bg-surface2 px-3 text-xs font-bold text-ink transition-colors cursor-pointer"
                >
                  <ExternalLink size={13} className="text-brand" />
                  <span>Buka di Pesan</span>
                </button>
              )}
              {canDelete && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 px-3 text-xs font-bold text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>Hapus Arsip</span>
                </button>
              )}
              {canDelete && confirmDelete && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className="inline-flex h-9 items-center gap-1 rounded-xl bg-rose-600 px-3 text-xs font-bold text-white cursor-pointer disabled:opacity-50"
                  >
                    {deleting ? "Menghapus..." : "Konfirmasi Hapus"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="btn-ghost h-9 px-2.5 text-xs font-semibold text-sub"
                  >
                    Batal
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="btn-ghost h-9 px-4 text-xs font-bold text-ink border"
            >
              Tutup
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeArchives() {
  const { me, users, userMap, subscribe, canAccessArchives } = useApp();
  const navigate = useNavigate();

  const initialCached = useMemo(() => readArchivesCache(me?.user_id), [me?.user_id]);
  const [items, setItems] = useState(() => initialCached?.items || []);
  const [divisions, setDivisions] = useState(() => initialCached?.divisions || []);
  const [accessMeta, setAccessMeta] = useState(() => initialCached?.access || null);
  const [loading, setLoading] = useState(() => !initialCached);
  const [forbidden, setForbidden] = useState(false);

  const [activeDivision, setActiveDivision] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [lightboxImg, setLightboxImg] = useState(null);

  const localHasAccess = useMemo(
    () => canAccessArchives || canAccessEmployeeArchives(me, { users }),
    [canAccessArchives, me, users]
  );

  const userLevelLabel = useMemo(() => inferUserOrgLevel(me), [me]);
  const userLevelMeta = useMemo(() => getOrgLevelMeta(userLevelLabel), [userLevelLabel]);

  const loadArchives = useCallback(async (silent = false, forceFresh = false) => {
    if (!me?.user_id) return;
    const hasCached = Boolean(readArchivesCache(me.user_id));
    if (!silent && !hasCached) setLoading(true);
    try {
      const { data } = await api.get("/employee-archives", forceFresh ? { noCache: true } : undefined);
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      const nextDivs = Array.isArray(data?.divisions) ? data.divisions : [];
      setItems(nextItems);
      setDivisions(nextDivs);
      setAccessMeta(data?.access || null);
      setForbidden(false);
      writeArchivesCache(me.user_id, { items: nextItems, divisions: nextDivs, access: data?.access || null });
      setSelectedItem((prev) => (prev ? nextItems.find((x) => x.id === prev.id) || null : null));
    } catch (err) {
      if (err?.response?.status === 403) {
        setForbidden(true);
      } else if (!silent && !hasCached) {
        toast.error(errMsg(err, "Gagal memuat Arsip Dokumen"));
      }
    } finally {
      setLoading(false);
    }
  }, [me?.user_id]);

  useEffect(() => {
    if (!me?.user_id) return;
    if (!localHasAccess) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const cached = readArchivesCache(me.user_id);
    if (cached) {
      setItems(cached.items || []);
      setDivisions(cached.divisions || []);
      setAccessMeta(cached.access || null);
      setLoading(false);
      loadArchives(true, false);
    } else {
      loadArchives(false, false);
    }
  }, [me?.user_id, localHasAccess, loadArchives]);

  // Live updates when new chat form approvals or manual archive entries arrive
  useEffect(() => {
    return subscribe((e) => {
      if (
        e?.type === "employee_archives:changed" ||
        (e?.type === "message:new" && e?.data?.type === "form_approval") ||
        (e?.type === "message:update" && e?.data?.form_approval)
      ) {
        loadArchives(true, true);
      }
    });
  }, [subscribe, loadArchives]);

  const canViewAll = Boolean(accessMeta?.canViewAllDivisions ?? canViewAllArchiveDivisions(me));

  // If user only has access to 1 division, default active tab to that division when loaded
  useEffect(() => {
    if (!canViewAll && divisions.length === 1 && activeDivision === "all") {
      setActiveDivision(divisions[0]);
    }
  }, [canViewAll, divisions, activeDivision]);

  const availableMonths = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      const ym = String(it?.date_start || it?.created_at || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [items]);

  const divisionStats = useMemo(() => {
    const map = {};
    for (const d of divisions) {
      map[d] = { total: 0, pending: 0 };
    }
    for (const it of items) {
      const d = it.division || "Umum";
      if (!map[d]) map[d] = { total: 0, pending: 0 };
      map[d].total += 1;
      if (it.status === "pending" || it.status === "partial") map[d].pending += 1;
    }
    return map;
  }, [items, divisions]);

  const divisionScopedItems = useMemo(() => {
    if (activeDivision === "all") return items;
    const target = activeDivision.toLowerCase();
    return items.filter((it) => String(it.division || "Umum").toLowerCase() === target);
  }, [items, activeDivision]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return divisionScopedItems.filter((it) => {
      if (categoryFilter !== "all" && it.category !== categoryFilter) return false;
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (monthFilter !== "all") {
        const ym = String(it.date_start || it.created_at || "").slice(0, 7);
        if (ym !== monthFilter) return false;
      }
      if (q) {
        const hay = [
          it.ref_code,
          it.title,
          it.employee_name,
          it.division,
          it.sub_category,
          it.reason,
          it.amount_label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [divisionScopedItems, categoryFilter, statusFilter, monthFilter, search]);

  const kpis = useMemo(() => {
    let leaveCount = 0;
    let leaveDays = 0;
    let itemCount = 0;
    let itemPending = 0;
    let reimbCount = 0;
    let reimbTotal = 0;
    let autoCount = 0;
    let manualCount = 0;

    for (const it of divisionScopedItems) {
      if (it.source === "form_approval") autoCount += 1;
      else manualCount += 1;

      if (it.category === "leave") {
        leaveCount += 1;
        leaveDays += Number(it.duration_days || 1);
      } else if (it.category === "item_request") {
        itemCount += 1;
        if (it.status === "pending" || it.status === "partial") itemPending += 1;
      } else if (it.category === "reimbursement") {
        reimbCount += 1;
        reimbTotal += Number(it.amount_numeric || 0);
      }
    }
    return {
      total: divisionScopedItems.length,
      autoCount,
      manualCount,
      leaveCount,
      leaveDays,
      itemCount,
      itemPending,
      reimbCount,
      reimbTotal,
    };
  }, [divisionScopedItems]);

  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      toast.info("Tidak ada data arsip untuk diekspor.");
      return;
    }
    const headers = [
      "No. Arsip",
      "Kategori",
      "Sub-Kategori",
      "Judul / Perihal",
      "Karyawan",
      "Divisi",
      "Status",
      "Tanggal",
      "Durasi (Hari)",
      "Nominal",
      "Sumber",
      "Keterangan",
    ];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filteredItems.map((it) => [
      it.ref_code,
      CATEGORY_MAP[it.category]?.label || it.category,
      it.sub_category || "",
      it.title,
      it.employee_name,
      it.division,
      STATUS_META[it.status]?.label || it.status,
      it.date_start || String(it.created_at || "").slice(0, 10),
      it.duration_days ?? "",
      it.amount_numeric > 0 ? it.amount_numeric : it.amount_label || "",
      it.source === "form_approval" ? "Chat Approval" : "Arsip Manual",
      it.reason || "",
    ]);
    const csv = "\uFEFF" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const divSlug = activeDivision === "all" ? "semua-divisi" : activeDivision.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.download = `arsip-dokumen-${divSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    playSound("pop");
    toast.success(`Rekap ${filteredItems.length} arsip dokumen berhasil diunduh.`);
  };

  if (forbidden) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-brand">
          <Lock size={28} />
        </div>
        <h1 className="text-xl font-extrabold text-ink">Akses Arsip Dokumen Terbatas</h1>
        <p className="mt-2 text-sm text-sub leading-relaxed">
          Halaman <strong>Arsip Dokumen</strong> hanya tersedia untuk level <strong>Lead ke atas</strong> (Lead, Manager, Direktur, C-Level) serta pihak yang ditunjuk sebagai <strong>Approver</strong>.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="btn-accent mt-5 h-10 px-5 text-xs font-bold"
        >
          Kembali ke Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 space-y-5" data-testid="employee-archives-page">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">Arsip Dokumen</h1>
            <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${userLevelMeta.badge}`}>
              <ShieldCheck size={12} />
              <span>{userLevelMeta.label}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border bg-surface px-2 py-0.5 text-[11px] font-semibold text-sub">
              {canViewAll ? "Semua Divisi" : `Divisi ${accessMeta?.department || me?.department || "Anda"}`}
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-sub">
            Arsip terpusat surat izin, request barang, reimburse & administrasi karyawan per divisi.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-surface hover:bg-surface2 px-3.5 text-xs font-bold text-ink transition-colors cursor-pointer"
            data-testid="archive-export-btn"
          >
            <Download size={15} className="text-sub" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playSound("pop");
              setCreateOpen(true);
            }}
            className="btn-accent inline-flex h-10 items-center gap-1.5 px-4 text-xs font-bold shadow-xs"
            data-testid="archive-create-btn"
          >
            <Plus size={16} />
            <span>Arsipkan Dokumen</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sub">Total Terarsip</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Archive size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-ink tabular-nums">{kpis.total}</p>
          <p className="mt-0.5 text-[11px] text-sub">
            {kpis.autoCount} dari Chat · {kpis.manualCount} Manual
          </p>
        </div>

        <div className="rounded-2xl border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sub">Surat Izin & Cuti</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/12 text-sky-600 dark:text-sky-400">
              <CalendarDays size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-ink tabular-nums">{kpis.leaveCount}</p>
          <p className="mt-0.5 text-[11px] text-sub">Total {kpis.leaveDays} hari izin/cuti</p>
        </div>

        <div className="rounded-2xl border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sub">Request Barang</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400">
              <Package size={16} />
            </span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-ink tabular-nums">{kpis.itemCount}</p>
          <p className="mt-0.5 text-[11px] text-sub">
            {kpis.itemPending > 0 ? `${kpis.itemPending} menunggu persetujuan` : "Semua sudah diproses"}
          </p>
        </div>

        <div className="rounded-2xl border bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sub">Reimburse & Dana</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <RupiahReceiptIcon size={16} />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-extrabold text-ink tabular-nums truncate" title={fmtRp(kpis.reimbTotal)}>
            {kpis.reimbTotal > 0 ? fmtRp(kpis.reimbTotal) : `${kpis.reimbCount} Klaim`}
          </p>
          <p className="mt-0.5 text-[11px] text-sub">{kpis.reimbCount} pengajuan tercatat</p>
        </div>
      </div>

      {/* Division Folder Tabs */}
      <div className="rounded-2xl border bg-surface p-3 space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-sub flex items-center gap-1.5">
            <FolderOpen size={13} className="text-brand" />
            <span>Folder Arsip per Divisi</span>
          </span>
          <span className="text-[11px] text-sub">{divisions.length} divisi</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {(canViewAll || divisions.length > 1) && (
            <button
              type="button"
              onClick={() => {
                playSound("tab");
                setActiveDivision("all");
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                activeDivision === "all"
                  ? "border-brand bg-brand text-white shadow-xs"
                  : "bg-surface2/50 text-ink hover:bg-surface2"
              }`}
              data-testid="archive-div-all"
            >
              <span>Semua Divisi</span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${
                  activeDivision === "all" ? "bg-white/20 text-white" : "bg-surface text-sub"
                }`}
              >
                {items.length}
              </span>
            </button>
          )}

          {divisions.map((divName) => {
            const active = activeDivision === divName;
            const st = divisionStats[divName] || { total: 0, pending: 0 };
            return (
              <button
                key={divName}
                type="button"
                onClick={() => {
                  playSound("tab");
                  setActiveDivision(divName);
                }}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? "border-brand bg-brand text-white shadow-xs"
                    : "bg-surface2/50 text-ink hover:bg-surface2"
                }`}
                data-testid={`archive-div-${divName}`}
              >
                <FolderOpen size={13} className={active ? "text-white" : "text-brand"} />
                <span>{divName}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-surface text-sub"
                  }`}
                >
                  {st.total}
                </span>
                {st.pending > 0 && (
                  <span
                    className={`h-2 w-2 rounded-full ${active ? "bg-amber-300" : "bg-amber-500"}`}
                    title={`${st.pending} menunggu approval`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-surface p-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-xl border bg-surface2/60 px-3">
            <Search size={15} className="text-sub shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari judul dokumen, nama karyawan, nomor arsip, nominal..."
              className="h-10 flex-1 bg-transparent text-sm text-ink outline-none"
              data-testid="archive-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-sub hover:text-ink cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AppSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border bg-surface2/60 px-3 text-xs font-bold text-ink"
              data-testid="archive-status-filter"
            >
              <option value="all">Semua Status</option>
              <option value="approved">Disetujui</option>
              <option value="pending">Menunggu</option>
              <option value="partial">Sebagian</option>
              <option value="rejected">Ditolak</option>
            </AppSelect>

            <AppSelect
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="h-10 rounded-xl border bg-surface2/60 px-3 text-xs font-bold text-ink"
              data-testid="archive-month-filter"
            >
              <option value="all">Semua Bulan</option>
              {availableMonths.map((ym) => (
                <option key={ym} value={ym}>{fmtMonthLabel(ym)}</option>
              ))}
            </AppSelect>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              setCategoryFilter("all");
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              categoryFilter === "all"
                ? "bg-ink text-surface"
                : "bg-surface2/60 text-sub hover:text-ink"
            }`}
          >
            <Filter size={12} />
            <span>Semua Kategori</span>
          </button>
          {ARCHIVE_CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = categoryFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  playSound("tab");
                  setCategoryFilter(c.id);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  active
                    ? "bg-brand text-white"
                    : "bg-surface2/60 text-sub hover:text-ink"
                }`}
              >
                <Icon size={13} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Archive Records List */}
      <div className="rounded-2xl border bg-surface overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-surface2/70 animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 px-4">
            <Empty
              icon={Archive}
              title="Belum ada arsip dokumen"
              text={
                items.length === 0
                  ? "Pengajuan Surat Izin, Request Barang, dan Reimburse dari Approval Card di Pesan akan otomatis terarsip di sini, atau klik Arsipkan Dokumen untuk menambah arsip manual."
                  : "Tidak ada dokumen yang sesuai dengan filter divisi, kategori, atau kata kunci saat ini."
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b bg-surface2/45 text-[11px] font-bold uppercase tracking-wider text-sub">
                    <th className="py-3 pl-4 pr-3">Dokumen & No. Arsip</th>
                    <th className="py-3 px-3">Karyawan & Divisi</th>
                    <th className="py-3 px-3">Ringkasan / Nilai</th>
                    <th className="py-3 px-3">Approver & Status</th>
                    <th className="py-3 px-3">Tanggal</th>
                    <th className="py-3 pl-3 pr-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredItems.map((it) => {
                    const catMeta = CATEGORY_MAP[it.category] || ARCHIVE_CATEGORIES[3];
                    const CatIcon = catMeta.icon;
                    const stMeta = STATUS_META[it.status] || STATUS_META.pending;
                    const StIcon = stMeta.icon;
                    const empUser = userMap?.[it.employee_id] || { user_id: it.employee_id, name: it.employee_name };
                    const needsMyAction =
                      (it.status === "pending" || it.status === "partial") &&
                      Array.isArray(it.approver_ids) &&
                      it.approver_ids.includes(me?.user_id) &&
                      !(it.approvals || []).some((a) => (typeof a === "string" ? a : a?.user_id) === me?.user_id);

                    return (
                      <tr
                        key={it.id}
                        onClick={() => setSelectedItem(it)}
                        className="group hover:bg-surface2/40 transition-colors cursor-pointer"
                        data-testid={`archive-row-${it.id}`}
                      >
                        <td className="py-3.5 pl-4 pr-3 max-w-[300px]">
                          <div className="flex items-start gap-2.5">
                            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${catMeta.iconBg}`}>
                              <CatIcon size={16} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold font-mono text-sub">{it.ref_code}</span>
                                <span className="text-[10px] text-sub">·</span>
                                <span className="text-[10px] font-semibold text-sub">
                                  {it.source === "form_approval" ? "Chat Approval" : "Manual"}
                                </span>
                                {Array.isArray(it.attachments) && it.attachments.length > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-surface2 px-1 py-0.5 text-[10px] font-bold text-sub">
                                    <Paperclip size={10} />
                                    {it.attachments.length}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-sm font-bold text-ink group-hover:text-brand transition-colors">
                                {it.title}
                              </p>
                              {it.sub_category && (
                                <p className="truncate text-[11px] text-sub">{it.sub_category}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <Avatar user={empUser} size={32} showStatus={false} />
                            <div className="min-w-0">
                              <p className="truncate max-w-[160px] text-xs font-bold text-ink">{it.employee_name}</p>
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sub">
                                <Building2 size={10} className="text-brand" />
                                {it.division}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {it.category === "leave" ? (
                            <div>
                              <p className="text-xs font-bold text-ink">{it.duration_days || 1} Hari</p>
                              <p className="text-[11px] text-sub">{fmtShortDate(it.date_start)}</p>
                            </div>
                          ) : it.category === "reimbursement" ? (
                            <div>
                              <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400">
                                {it.amount_numeric > 0 ? fmtRp(it.amount_numeric) : (it.amount_label || "—")}
                              </p>
                              <p className="text-[11px] text-sub">Klaim Dana</p>
                            </div>
                          ) : it.category === "item_request" ? (
                            <div>
                              <p className="text-xs font-bold text-ink">
                                {it.fields?.qty || 1} {it.fields?.unit || "Unit"}
                              </p>
                              <p className="text-[11px] text-sub">
                                {it.amount_numeric > 0 ? fmtRp(it.amount_numeric) : (it.fields?.urgency || "Pengadaan")}
                              </p>
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs font-bold text-ink">
                                {it.amount_numeric > 0 ? fmtRp(it.amount_numeric) : (it.sub_category || "Dokumen")}
                              </p>
                              <p className="text-[11px] text-sub">Administrasi</p>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${stMeta.badge}`}>
                              <StIcon size={11} />
                              <span>
                                {stMeta.label}
                                {it.status === "partial" ? ` (${it.progress}%)` : ""}
                              </span>
                            </span>
                            {Array.isArray(it.approver_ids) && it.approver_ids.length > 0 && (
                              <div className="flex items-center -space-x-1">
                                {it.approver_ids.slice(0, 3).map((uid) => (
                                  <Avatar
                                    key={uid}
                                    user={userMap?.[uid] || { user_id: uid, name: uid }}
                                    size={20}
                                    showStatus={false}
                                    ringDeadline={false}
                                  />
                                ))}
                                {it.approver_ids.length > 3 && (
                                  <span className="ml-1.5 text-[10px] font-bold text-sub">
                                    +{it.approver_ids.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 whitespace-nowrap text-xs font-medium text-sub">
                          {fmtShortDate(it.created_at)}
                        </td>

                        <td className="py-3.5 pl-3 pr-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItem(it);
                            }}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors cursor-pointer ${
                              needsMyAction
                                ? "bg-brand text-white hover:opacity-90"
                                : "border bg-surface hover:bg-surface2 text-ink"
                            }`}
                          >
                            <Eye size={13} />
                            <span>{needsMyAction ? "Tinjau" : "Detail"}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y">
              {filteredItems.map((it) => {
                const catMeta = CATEGORY_MAP[it.category] || ARCHIVE_CATEGORIES[3];
                const CatIcon = catMeta.icon;
                const stMeta = STATUS_META[it.status] || STATUS_META.pending;
                const StIcon = stMeta.icon;
                const empUser = userMap?.[it.employee_id] || { user_id: it.employee_id, name: it.employee_name };

                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setSelectedItem(it)}
                    className="flex w-full flex-col gap-2.5 p-4 text-left hover:bg-surface2/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${catMeta.iconBg}`}>
                          <CatIcon size={16} />
                        </span>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold font-mono text-sub">{it.ref_code} · {it.division}</span>
                          <p className="text-sm font-bold text-ink leading-snug line-clamp-2">{it.title}</p>
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${stMeta.badge}`}>
                        <StIcon size={10} />
                        {stMeta.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar user={empUser} size={24} showStatus={false} ringDeadline={false} />
                        <span className="truncate text-xs font-semibold text-ink">{it.employee_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-sub shrink-0">
                        {it.amount_numeric > 0 && (
                          <span className="font-bold text-amber-600 dark:text-amber-400">{fmtRp(it.amount_numeric)}</span>
                        )}
                        {it.category === "leave" && (
                          <span className="font-bold text-sky-600 dark:text-sky-400">{it.duration_days || 1} Hari</span>
                        )}
                        <span>{fmtShortDate(it.created_at)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <CreateArchiveDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        divisions={divisions}
        canViewAll={canViewAll}
        defaultDivision={activeDivision !== "all" ? activeDivision : me?.department}
        onCreated={() => loadArchives(true, true)}
      />

      <ArchiveDetailDialog
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onDecisionDone={() => loadArchives(true, true)}
        onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
        onPreviewImage={(img) => setLightboxImg(img)}
        canManageAll={canViewAll}
      />

      <ImageLightbox image={lightboxImg} onClose={() => setLightboxImg(null)} />
    </div>
  );
}
