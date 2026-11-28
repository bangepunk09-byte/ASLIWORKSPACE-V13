import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  CalendarDays,
  Package,
  Users,
  Plus,
  X,
  CheckCircle2,
  Paperclip,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fileUrl, uploadFile } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AppSelect } from "../../components/ui/select";
import { DatePicker } from "../../components/ui/date-picker";
import { Avatar } from "../../components/common";
import { playSound } from "../../lib/sound";
import { RupiahReceiptIcon } from "../marketplace/catalogAssets";

export const APPROVAL_FORM_TYPES = [
  {
    id: "leave",
    label: "Form Izin Cuti",
    shortLabel: "Izin Cuti",
    icon: CalendarDays,
    badgeColor: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
    accentHex: "#0EA5E9",
  },
  {
    id: "item_request",
    label: "Form Request Barang",
    shortLabel: "Request Barang",
    icon: Package,
    badgeColor: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
    accentHex: "#6366F1",
  },
  {
    id: "reimbursement",
    label: "Form Reimbursement & Dana",
    shortLabel: "Reimbursement",
    icon: RupiahReceiptIcon,
    badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    accentHex: "#F59E0B",
  },
];

const LEAVE_CATEGORIES = [
  "Cuti Tahunan",
  "Izin Sakit",
  "Izin Keperluan Keluarga / Mendesak",
  "Cuti Menikah / Melahirkan",
  "Work From Home (WFH) / Dinas Luar",
];

const ITEM_CATEGORIES = [
  "Perangkat Kerja & IT",
  "Kebutuhan Produksi & Studio",
  "Perlengkapan Kantor (ATK & Inventaris)",
  "Lisensi Software & Langganan",
  "Lainnya",
];

const ITEM_UNITS = ["Unit", "Pcs", "Set / Paket", "Box", "Lisensi"];
const ITEM_URGENCY = ["Normal", "Penting", "Mendesak (Urgent)"];

const REIMBURSE_CATEGORIES = [
  "Transportasi & Perjalanan Dinas",
  "Kebutuhan Produksi & Operasional",
  "Konsumsi & Jamuan Klien",
  "Iklan & Kampanye Marketing",
  "Lainnya",
];

function computeLeaveDays(startStr, endStr) {
  if (!startStr || !endStr) return 1;
  try {
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    return Math.max(1, diff);
  } catch {
    return 1;
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

export default function CreateApprovalDialog({ open, onOpenChange, conv, onCreated }) {
  const { me, users } = useApp();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const reimbFileInputRef = useRef(null);

  const [formType, setFormType] = useState("leave");
  const [approverIds, setApproverIds] = useState([]);
  const [pickerValue, setPickerValue] = useState("");
  const [busy, setBusy] = useState(false);

  // Leave form state
  const [leaveCategory, setLeaveCategory] = useState(LEAVE_CATEGORIES[0]);
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [delegateId, setDelegateId] = useState("");
  const [leaveReason, setLeaveReason] = useState("");

  // Item request state
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState(ITEM_CATEGORIES[0]);
  const [itemQty, setItemQty] = useState("1");
  const [itemUnit, setItemUnit] = useState("Unit");
  const [itemUrgency, setItemUrgency] = useState("Penting");
  const [itemPrice, setItemPrice] = useState("");
  const [itemLink, setItemLink] = useState("");
  const [itemReason, setItemReason] = useState("");

  // Reimbursement state
  const [reimbTitle, setReimbTitle] = useState("");
  const [reimbCategory, setReimbCategory] = useState(REIMBURSE_CATEGORIES[0]);
  const [reimbAmount, setReimbAmount] = useState("");
  const [reimbDate, setReimbDate] = useState(todayIso);
  const [reimbReason, setReimbReason] = useState("");
  const [reimbFiles, setReimbFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const activeCandidates = useMemo(() => {
    const convMems = new Set(conv?.member_ids || conv?.members || []);
    const allHumans = (Array.isArray(users) ? users : []).filter(
      (u) =>
        u &&
        u.user_id &&
        u.user_id !== me?.user_id &&
        u.user_id !== "user_circle_assistant" &&
        !u.is_bot &&
        u.role !== "assistant" &&
        u.status !== "suspended" &&
        u.status !== "pending"
    );
    return allHumans.sort((a, b) => {
      const aInConv = convMems.has(a.user_id) ? 1 : 0;
      const bInConv = convMems.has(b.user_id) ? 1 : 0;
      if (aInConv !== bInConv) return bInConv - aInConv;
      const aMgr = ["super_admin", "workspace_admin", "department_manager", "project_manager", "manager"].includes(a.role) ? 1 : 0;
      const bMgr = ["super_admin", "workspace_admin", "department_manager", "project_manager", "manager"].includes(b.role) ? 1 : 0;
      if (aMgr !== bMgr) return bMgr - aMgr;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [users, conv?.member_ids, conv?.members, me?.user_id]);

  // Pre-populate reasonable default approvers when dialog opens
  useEffect(() => {
    if (!open) return;
    if (approverIds.length > 0) return;
    const convMems = (conv?.member_ids || conv?.members || []).filter(
      (id) => id && id !== me?.user_id && id !== "user_circle_assistant"
    );
    if (conv?.type === "dm" && convMems.length === 1) {
      setApproverIds([convMems[0]]);
    } else {
      const managersInConv = activeCandidates
        .filter((u) => convMems.includes(u.user_id) && ["super_admin", "workspace_admin", "department_manager", "project_manager", "manager"].includes(u.role))
        .slice(0, 2)
        .map((u) => u.user_id);
      if (managersInConv.length > 0) {
        setApproverIds(managersInConv);
      } else if (activeCandidates.length > 0) {
        setApproverIds(activeCandidates.slice(0, Math.min(2, activeCandidates.length)).map((u) => u.user_id));
      }
    }
  }, [open]); // eslint-disable-line

  const toggleApprover = (uid) => {
    if (!uid) return;
    playSound("click");
    setApproverIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleUploadReimbFiles = async (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = "";
    if (fileList.length === 0) return;
    if (reimbFiles.length + fileList.length > 6) {
      toast.error("Maksimal 6 file lampiran per pengajuan.");
      return;
    }
    setUploadingFiles(true);
    try {
      const uploaded = [];
      for (const file of fileList) {
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
      if (uploaded.length > 0) {
        setReimbFiles((prev) => [...prev, ...uploaded]);
        playSound("pop");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah lampiran invoice"));
    } finally {
      setUploadingFiles(false);
    }
  };

  const removeReimbFile = (fileId) => {
    setReimbFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const leaveDurationDays = useMemo(() => computeLeaveDays(startDate, endDate), [startDate, endDate]);
  const stepPct = approverIds.length > 0 ? Math.round(100 / approverIds.length) : 100;

  const handleSubmit = async () => {
    if (approverIds.length === 0) {
      toast.error("Pilih minimal 1 orang tujuan approval");
      return;
    }
    if (uploadingFiles) {
      toast.info("Tunggu unggahan file selesai terlebih dahulu");
      return;
    }

    let title = "";
    let fields = {};
    let attachments = [];

    if (formType === "leave") {
      if (!leaveReason.trim()) {
        toast.error("Mohon isi alasan atau keterangan izin cuti");
        return;
      }
      const delegateUser = activeCandidates.find((u) => u.user_id === delegateId);
      title = `${leaveCategory} (${leaveDurationDays} Hari)`;
      fields = {
        category: leaveCategory,
        start_date: startDate,
        end_date: endDate,
        duration_days: leaveDurationDays,
        delegate_id: delegateId || null,
        delegate_name: delegateUser?.name || null,
        reason: leaveReason.trim(),
      };
    } else if (formType === "item_request") {
      if (!itemName.trim()) {
        toast.error("Nama barang atau perangkat wajib diisi");
        return;
      }
      if (!itemReason.trim()) {
        toast.error("Alasan kebutuhan barang wajib diisi");
        return;
      }
      title = `${itemName.trim()} (${itemQty || 1} ${itemUnit})`;
      fields = {
        item_name: itemName.trim(),
        category: itemCategory,
        qty: Number(itemQty) || 1,
        unit: itemUnit,
        urgency: itemUrgency,
        estimated_price: itemPrice.trim() || null,
        reference_link: itemLink.trim() || null,
        reason: itemReason.trim(),
      };
    } else {
      if (!reimbTitle.trim() || !reimbAmount.trim()) {
        toast.error("Judul klaim dan nominal wajib diisi");
        return;
      }
      title = `${reimbTitle.trim()} — ${reimbAmount.trim()}`;
      attachments = reimbFiles;
      fields = {
        claim_title: reimbTitle.trim(),
        category: reimbCategory,
        amount: reimbAmount.trim(),
        transaction_date: reimbDate,
        reason: reimbReason.trim(),
        attachments: reimbFiles,
      };
    }

    setBusy(true);
    try {
      const formMeta = APPROVAL_FORM_TYPES.find((f) => f.id === formType) || APPROVAL_FORM_TYPES[0];
      const tempId = `msg_appr_opt_${Date.now()}`;
      const nowIso = new Date().toISOString();
      const formApprovalObj = {
        id: `fappr_${Date.now()}`,
        form_type: formType,
        form_label: formMeta.label,
        title,
        fields,
        attachments,
        requester_id: me?.user_id || "user_admin1",
        requester_name: me?.name || "Anggota",
        requester_department: me?.department || "Umum",
        requester_job_title: me?.job_title || "Employee",
        approver_ids: approverIds,
        approvals: [],
        rejections: [],
        status: "pending",
        progress: 0,
        created_at: nowIso,
      };

      const optimisticMsg = {
        id: tempId,
        conversation_id: conv.id,
        sender_id: me?.user_id || "user_admin1",
        user_id: me?.user_id || "user_admin1",
        type: "form_approval",
        form_approval: formApprovalObj,
        mention_ids: approverIds,
        text: `📋 ${formMeta.label}: ${title}`,
        created_at: nowIso,
        _optimistic: true,
      };

      playSound("post");
      onOpenChange(false);
      onCreated?.(optimisticMsg);

      const { data } = await api.post(`/conversations/${conv.id}/form-approvals`, {
        form_type: formType,
        form_label: formMeta.label,
        title,
        fields,
        attachments,
        approver_ids: approverIds,
      });

      if (data?.message) {
        onCreated?.(data.message, tempId);
      }
      toast.success(`${formMeta.label} berhasil dikirim ke obrolan!`);

      // Reset fields
      setLeaveReason("");
      setItemName("");
      setItemPrice("");
      setItemLink("");
      setItemReason("");
      setReimbTitle("");
      setReimbAmount("");
      setReimbReason("");
      setReimbFiles([]);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengirim Approval Card"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl w-[min(94vw,54rem)] max-w-4xl max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <DialogHeader className="pb-1">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pr-7">
            <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-extrabold text-ink">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-brand">
                <ClipboardCheck size={19} />
              </span>
              <span>Buat Approval Card</span>
            </DialogTitle>

            {/* Horizontal Segmented Form Type Switcher */}
            <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-surface2/80 p-1 border">
              {APPROVAL_FORM_TYPES.map((ft) => {
                const Icon = ft.icon;
                const active = formType === ft.id;
                return (
                  <button
                    key={ft.id}
                    type="button"
                    onClick={() => {
                      playSound("tab");
                      setFormType(ft.id);
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-2.5 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      active
                        ? "bg-brand text-white shadow-xs"
                        : "text-sub hover:bg-surface hover:text-ink"
                    }`}
                    data-testid={`approval-type-tab-${ft.id}`}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{ft.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </DialogHeader>

        {/* Landscape 2-Column Body */}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
          {/* LEFT COLUMN: Form Fields */}
          <div className="md:col-span-7 flex flex-col">
            {/* FORM 1: FORM IZIN CUTI */}
            {formType === "leave" && (
              <div className="flex-1 space-y-3 rounded-2xl border bg-surface2/40 p-4" data-testid="approval-form-leave">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Kategori Izin / Cuti</label>
                    <AppSelect
                      value={leaveCategory}
                      onChange={(e) => setLeaveCategory(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                      data-testid="leave-category-select"
                    >
                      {LEAVE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </AppSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Delegasi / Backup (Opsional)</label>
                    <AppSelect
                      value={delegateId}
                      onChange={(e) => setDelegateId(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium text-ink"
                      data-testid="leave-delegate-select"
                    >
                      <option value="">— Tanpa delegasi khusus —</option>
                      {activeCandidates.map((u) => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.name} — {u.department || u.job_title || "Tim"}
                        </option>
                      ))}
                    </AppSelect>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Tanggal Mulai</label>
                    <DatePicker
                      value={startDate}
                      onChange={(v) => {
                        setStartDate(v);
                        if (endDate && v > endDate) setEndDate(v);
                      }}
                      placeholder="Pilih tanggal mulai"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                      data-testid="leave-start-date"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">
                      Tanggal Selesai{" "}
                      <span className="text-brand font-bold">· {leaveDurationDays} Hari</span>
                    </label>
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      placeholder="Pilih tanggal selesai"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                      data-testid="leave-end-date"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Alasan / Keterangan Cuti</label>
                  <textarea
                    rows={4}
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    placeholder="Tuliskan alasan pengajuan izin/cuti dan catatan serah terima tugas..."
                    className="w-full rounded-xl border bg-surface p-2.5 text-sm text-ink outline-none focus:border-brand resize-none"
                    data-testid="leave-reason-input"
                  />
                </div>
              </div>
            )}

            {/* FORM 2: FORM REQUEST BARANG */}
            {formType === "item_request" && (
              <div className="flex-1 space-y-3 rounded-2xl border bg-surface2/40 p-4" data-testid="approval-form-item">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-sub mb-1">Nama Barang / Spesifikasi</label>
                    <input
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                      placeholder="Contoh: Mouse Logitech MX Master 3S / SSD External 2TB"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-brand"
                      data-testid="item-name-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Kategori Barang</label>
                    <AppSelect
                      value={itemCategory}
                      onChange={(e) => setItemCategory(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                      data-testid="item-category-select"
                    >
                      {ITEM_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </AppSelect>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Prioritas Kebutuhan</label>
                    <AppSelect
                      value={itemUrgency}
                      onChange={(e) => setItemUrgency(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                      data-testid="item-urgency-select"
                    >
                      {ITEM_URGENCY.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </AppSelect>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Jumlah</label>
                    <input
                      type="number"
                      min={1}
                      value={itemQty}
                      onChange={(e) => setItemQty(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand"
                      data-testid="item-qty-input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Satuan</label>
                    <AppSelect
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                      data-testid="item-unit-select"
                    >
                      {ITEM_UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </AppSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Estimasi Harga</label>
                    <input
                      value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value)}
                      placeholder="Rp 1.500.000"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand"
                      data-testid="item-price-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Link Referensi / Toko (Opsional)</label>
                  <input
                    value={itemLink}
                    onChange={(e) => setItemLink(e.target.value)}
                    placeholder="https://tokopedia.com/... atau link katalog"
                    className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                    data-testid="item-link-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Alasan Kebutuhan & Kegunaan</label>
                  <textarea
                    rows={2}
                    value={itemReason}
                    onChange={(e) => setItemReason(e.target.value)}
                    placeholder="Jelaskan kebutuhan penggunaan barang ini untuk tim/proyek..."
                    className="w-full rounded-xl border bg-surface p-2.5 text-sm text-ink outline-none focus:border-brand resize-none"
                    data-testid="item-reason-input"
                  />
                </div>
              </div>
            )}

            {/* FORM 3: FORM REIMBURSEMENT */}
            {formType === "reimbursement" && (
              <div className="flex-1 space-y-3 rounded-2xl border bg-surface2/40 p-4" data-testid="approval-form-reimbursement">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-sub mb-1">Judul / Keperluan Klaim</label>
                    <input
                      value={reimbTitle}
                      onChange={(e) => setReimbTitle(e.target.value)}
                      placeholder="Contoh: Biaya Operasional Shooting Klien"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-brand"
                      data-testid="reimb-title-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Kategori Klaim</label>
                    <AppSelect
                      value={reimbCategory}
                      onChange={(e) => setReimbCategory(e.target.value)}
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                    >
                      {REIMBURSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </AppSelect>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-sub mb-1">Nominal Klaim</label>
                    <input
                      value={reimbAmount}
                      onChange={(e) => setReimbAmount(e.target.value)}
                      placeholder="Rp 750.000"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-brand"
                      data-testid="reimb-amount-input"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-sub mb-1">Tanggal Transaksi</label>
                    <DatePicker
                      value={reimbDate}
                      onChange={setReimbDate}
                      placeholder="Pilih tanggal transaksi"
                      className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sub mb-1">Rincian & Catatan Rekening</label>
                  <textarea
                    rows={2}
                    value={reimbReason}
                    onChange={(e) => setReimbReason(e.target.value)}
                    placeholder="Tuliskan rincian pengeluaran dan nomor rekening tujuan..."
                    className="w-full rounded-xl border bg-surface p-2.5 text-sm text-ink outline-none focus:border-brand resize-none"
                    data-testid="reimb-reason-input"
                  />
                </div>

                {/* Lampiran Invoice / Bukti Pembayaran */}
                <div>
                  <label className="block text-xs font-semibold text-sub mb-1.5">
                    Lampiran Invoice / Struk (Gambar, PDF, Dokumen)
                  </label>
                  <input
                    ref={reimbFileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                    hidden
                    onChange={handleUploadReimbFiles}
                    data-testid="reimb-file-input"
                  />

                  {reimbFiles.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-2" data-testid="reimb-attached-files">
                      {reimbFiles.map((f) => {
                        const isImg = isImageAttachment(f);
                        return (
                          <div
                            key={f.id}
                            className="group relative flex items-center gap-2 rounded-xl border bg-surface2/60 p-1.5 pr-2 max-w-[200px]"
                          >
                            {isImg ? (
                              <img
                                src={fileUrl(f.id)}
                                alt={f.name}
                                className="h-9 w-9 shrink-0 rounded-lg object-cover border"
                              />
                            ) : (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                                <FileText size={16} />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-bold text-ink">{f.name}</p>
                              {f.size > 0 && (
                                <p className="text-[10px] text-sub">{formatFileSize(f.size)}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeReimbFile(f.id)}
                              className="rounded-full p-0.5 text-sub hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                              title="Hapus lampiran"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        disabled={uploadingFiles}
                        onClick={() => reimbFileInputRef.current?.click()}
                        className="inline-flex h-9 items-center gap-1 rounded-xl border border-dashed border-border bg-surface2/40 hover:bg-surface2 px-2.5 text-[11px] font-bold text-sub hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                        data-testid="reimb-attach-more-btn"
                      >
                        {uploadingFiles ? (
                          <Loader2 size={12} className="animate-spin text-brand" />
                        ) : (
                          <Plus size={12} />
                        )}
                        <span>{uploadingFiles ? "Mengunggah..." : "Tambah"}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={uploadingFiles}
                      onClick={() => reimbFileInputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/70 hover:bg-surface px-3 py-2.5 text-xs font-medium text-sub hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                      data-testid="reimb-attach-file-btn"
                    >
                      {uploadingFiles ? (
                        <Loader2 size={14} className="animate-spin text-brand shrink-0" />
                      ) : (
                        <Paperclip size={14} className="text-amber-500 shrink-0" />
                      )}
                      <span>
                        {uploadingFiles
                          ? "Mengunggah lampiran..."
                          : "Klik untuk melampirkan nota, invoice PDF, foto struk, atau dokumen pendukung"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Approver Picker, Progress Preview & Submit */}
          <div className="md:col-span-5 flex flex-col justify-between gap-3 rounded-2xl border bg-surface2/50 p-4" data-testid="approval-approvers-section">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Users size={14} className="text-brand shrink-0" />
                  <span>Tujuan Approval ({approverIds.length} Orang)</span>
                </label>
                <p className="text-[11px] text-sub mt-0.5">
                  Progress bar otomatis mengikuti jumlah approver yang menyetujui.
                </p>
              </div>

              {/* Dropdown tambah approver */}
              <AppSelect
                value={pickerValue}
                onChange={(e) => {
                  const uid = e.target.value;
                  setPickerValue("");
                  if (uid && !approverIds.includes(uid)) {
                    toggleApprover(uid);
                  }
                }}
                className="h-10 w-full rounded-xl border bg-surface px-3 text-xs sm:text-sm font-semibold text-ink"
                data-testid="add-approver-select"
              >
                <option value="">+ Tambah Pihak Approver...</option>
                {activeCandidates.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {approverIds.includes(u.user_id) ? "✓ " : ""}
                    {u.name} — {u.job_title || u.department || "Tim"}
                  </option>
                ))}
              </AppSelect>

              {/* Selected Approvers Chips */}
              {approverIds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {approverIds.map((uid) => {
                    const u = activeCandidates.find((x) => x.user_id === uid) || { user_id: uid, name: uid };
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface pl-1.5 pr-2 py-1 text-xs font-bold text-ink shadow-2xs"
                        data-testid={`selected-approver-chip-${uid}`}
                      >
                        <Avatar user={u} size={18} showStatus={false} />
                        <span className="truncate max-w-[120px]">{u.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleApprover(uid)}
                          className="rounded-full p-0.5 text-sub hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Hapus dari daftar approver"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-rose-500 font-semibold">
                  Pilih minimal 1 orang approver.
                </p>
              )}

              {/* Quick Pick Member List */}
              {activeCandidates.length > 0 && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-sub mb-1.5">
                    Pilih Cepat:
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-0.5 scroll-thin">
                    {activeCandidates.slice(0, 10).map((u) => {
                      const selected = approverIds.includes(u.user_id);
                      return (
                        <button
                          key={u.user_id}
                          type="button"
                          onClick={() => toggleApprover(u.user_id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                            selected
                              ? "border-[var(--c-accent)] bg-rose-500/10 text-brand font-bold"
                              : "bg-surface text-sub hover:text-ink hover:bg-surface2"
                          }`}
                          data-testid={`quick-approver-${u.user_id}`}
                        >
                          <Avatar user={u} size={16} showStatus={false} />
                          <span className="truncate max-w-[95px]">{u.name?.split(" ")[0]}</span>
                          {selected ? <CheckCircle2 size={12} className="text-brand" /> : <Plus size={11} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t">
              {/* Progress Bar Preview Info */}
              {approverIds.length > 0 && (
                <div className="rounded-xl border bg-surface p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold gap-2">
                    <span className="text-sub">Simulasi Progress</span>
                    <span className="text-emerald-600 tabular-nums">
                      1/{approverIds.length} = {stepPct}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${stepPct}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={busy || uploadingFiles || approverIds.length === 0}
                onClick={handleSubmit}
                className="btn-accent w-full h-11 text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer"
                data-testid="submit-approval-card-btn"
              >
                {busy ? "Mengirim Approval Card..." : "Kirim Approval Card"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
