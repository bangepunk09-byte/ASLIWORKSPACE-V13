import { useCallback, useEffect, useState } from "react";
import {
  Crown,
  RefreshCw,
  Users,
  HardDrive,
  CheckCircle2,
  ArrowUpRight,
  CreditCard,
  QrCode,
  Building2,
  Wallet,
  ExternalLink,
  Copy,
  Check,
  Pencil,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, invalidateApiGetCache } from "../lib/api";
import { getActiveRoomSlug, roomStorageKey } from "../lib/roomContext";
import { useApp } from "../context/AppContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

const BILLING_CACHE_KEY = "circle_billing_overview_v2";
const BILLING_MEMORY_CACHE = new Map();
const BILLING_INFLIGHT = new Map();

function readBillingCache(slug = getActiveRoomSlug()) {
  if (!slug) return null;
  const mem = BILLING_MEMORY_CACHE.get(slug);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(roomStorageKey(BILLING_CACHE_KEY, slug));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.active_plan) {
        BILLING_MEMORY_CACHE.set(slug, parsed);
        return parsed;
      }
    }
  } catch {}
  return null;
}

function writeBillingCache(payload, slug = getActiveRoomSlug()) {
  if (!slug || !payload || typeof payload !== "object") return;
  BILLING_MEMORY_CACHE.set(slug, payload);
  try {
    localStorage.setItem(roomStorageKey(BILLING_CACHE_KEY, slug), JSON.stringify(payload));
  } catch {}
}

export async function prefetchBillingOverview(force = false) {
  const slug = getActiveRoomSlug();
  if (!slug) return null;
  if (!force && BILLING_INFLIGHT.has(slug)) {
    return BILLING_INFLIGHT.get(slug);
  }
  const req = api
    .get("/billing/overview", force ? { noCache: true } : undefined)
    .then((res) => {
      if (res?.data && typeof res.data === "object") {
        writeBillingCache(res.data, slug);
        return res.data;
      }
      return readBillingCache(slug);
    })
    .catch(() => readBillingCache(slug))
    .finally(() => {
      BILLING_INFLIGHT.delete(slug);
    });
  BILLING_INFLIGHT.set(slug, req);
  return req;
}

const formatRupiah = (amount) => {
  const num = Number(amount || 0);
  if (num <= 0) return "Gratis";
  return `Rp ${num.toLocaleString("id-ID")}`;
};

const formatStorageLimit = (mb) => {
  const num = Number(mb || 0);
  if (num >= 1024) {
    const gb = num / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${num} MB`;
};

const getPlanMonthlyPrice = (plan) => Number(plan?.monthly_price ?? plan?.price_monthly ?? 0);
const getPlanAnnualPrice = (plan) => Number(plan?.annual_price ?? plan?.price_yearly ?? 0);
const getPlanDescription = (plan) => {
  const raw = String(plan?.description ?? plan?.tagline ?? "").trim();
  if (!raw || /gratis selamanya untuk tim kecil hingga 5 anggota/i.test(raw)) return "";
  return raw;
};
const normalizeCycle = (val) => (val === "annual" || val === "yearly" ? "annual" : "monthly");

const CHANNEL_OPTIONS = [
  { id: "qris", label: "QRIS Instan", desc: "Scan QRIS semua bank & e-wallet", group: "QRIS", icon: QrCode },
  { id: "va_bca", label: "Virtual Account BCA", desc: "Transfer otomatis BCA", group: "VA", icon: Building2 },
  { id: "va_mandiri", label: "Virtual Account Mandiri", desc: "Mandiri Bill Payment", group: "VA", icon: Building2 },
  { id: "va_bni", label: "Virtual Account BNI", desc: "Transfer otomatis BNI", group: "VA", icon: Building2 },
  { id: "va_bri", label: "Virtual Account BRI", desc: "Transfer BRIVA", group: "VA", icon: Building2 },
  { id: "gopay", label: "GoPay", desc: "Pembayaran e-wallet GoPay", group: "E-Wallet", icon: Wallet },
  { id: "ovo", label: "OVO", desc: "Pembayaran e-wallet OVO", group: "E-Wallet", icon: Wallet },
  { id: "dana", label: "DANA", desc: "Pembayaran e-wallet DANA", group: "E-Wallet", icon: Wallet },
];

export default function BillingPanel() {
  const { reloadWs, isAdmin, currentRoomSlug } = useApp();
  const roomSlug = currentRoomSlug || getActiveRoomSlug();

  const [data, setData] = useState(() => readBillingCache(roomSlug));
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(() => !readBillingCache(roomSlug));
  const [cycle, setCycle] = useState(() => normalizeCycle(readBillingCache(roomSlug)?.billing_cycle));
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState("qris");
  const [busyCheckout, setBusyCheckout] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [customCodeInput, setCustomCodeInput] = useState("");
  const [savingCustomCode, setSavingCustomCode] = useState(false);

  const loadBilling = useCallback(
    async ({ manual = false, force = false } = {}) => {
      if (manual) setRefreshing(true);
      try {
        if (force) invalidateApiGetCache("/billing/overview");
        const res = await api.get("/billing/overview", force ? { noCache: true } : undefined);
        if (res?.data && typeof res.data === "object") {
          setData(res.data);
          writeBillingCache(res.data, roomSlug);
          if (res.data.billing_cycle) {
            setCycle(normalizeCycle(res.data.billing_cycle));
          }
        }
      } catch (err) {
        if (manual || !readBillingCache(roomSlug)) {
          toast.error(errMsg(err, "Gagal memuat informasi langganan"));
        }
      } finally {
        setInitialLoading(false);
        if (manual) setRefreshing(false);
      }
    },
    [roomSlug]
  );

  useEffect(() => {
    const cached = readBillingCache(roomSlug);
    if (cached) {
      setData(cached);
      setInitialLoading(false);
      if (cached.billing_cycle) setCycle(normalizeCycle(cached.billing_cycle));
    } else {
      setInitialLoading(true);
    }
    loadBilling({ manual: false, force: false });
  }, [roomSlug, loadBilling]);

  const handleOpenUpgrade = (plan) => {
    const enabled = data?.gateway?.enabled_channels || CHANNEL_OPTIONS.map((c) => c.id);
    setSelectedChannel(enabled[0] || "qris");
    setActiveInvoice(null);
    setCheckoutPlan(plan);
  };

  const handleStartCheckout = async () => {
    if (!checkoutPlan) return;
    setBusyCheckout(true);
    try {
      const res = await api.post("/billing/checkout", {
        plan_id: checkoutPlan.id,
        billing_cycle: cycle,
        method: selectedChannel,
      });
      const payload = res.data || {};
      if (payload.instant_activated) {
        toast.success(`Paket ${checkoutPlan.name} berhasil diaktifkan!`);
        setCheckoutPlan(null);
        await loadBilling({ force: true });
        await reloadWs?.();
        return;
      }
      setActiveInvoice(payload);
      toast.success("Tagihan pembayaran lokal berhasil dibuat.");
      await loadBilling({ force: true });
    } catch (err) {
      toast.error(errMsg(err, "Gagal membuat checkout pembayaran"));
    } finally {
      setBusyCheckout(false);
    }
  };

  const handleConfirmSandboxPaid = async (txId) => {
    if (!txId) return;
    setBusyConfirm(true);
    try {
      await api.post("/billing/confirm", { transaction_id: txId });
      toast.success("Pembayaran terverifikasi! Paket workspace Anda telah di-upgrade.");
      setCheckoutPlan(null);
      setActiveInvoice(null);
      await loadBilling({ force: true });
      await reloadWs?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengkonfirmasi pembayaran"));
    } finally {
      setBusyConfirm(false);
    }
  };

  const copyInviteCode = async () => {
    if (!data?.invite_code) return;
    try {
      await navigator.clipboard.writeText(data.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
      toast.success("Kode undangan room disalin!");
    } catch {}
  };

  const handleRegenerateInviteCode = async () => {
    setRegeneratingCode(true);
    try {
      const { data: resData } = await api.post("/admin/room-invite-code/regenerate");
      if (resData?.invite_code) {
        invalidateApiGetCache("/billing/overview");
        setData((prev) => {
          const next = prev ? { ...prev, invite_code: resData.invite_code } : prev;
          if (next) writeBillingCache(next, roomSlug);
          return next;
        });
        setEditingCode(false);
        toast.success(`Kode undangan baru: ${resData.invite_code}`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui kode undangan room"));
    } finally {
      setRegeneratingCode(false);
    }
  };

  const handleSaveCustomInviteCode = async (e) => {
    e.preventDefault();
    const clean = String(customCodeInput || "").trim().toUpperCase();
    setSavingCustomCode(true);
    try {
      const { data: resData } = await api.put("/admin/room-invite-code", { invite_code: clean });
      if (resData?.invite_code) {
        invalidateApiGetCache("/billing/overview");
        setData((prev) => {
          const next = prev ? { ...prev, invite_code: resData.invite_code } : prev;
          if (next) writeBillingCache(next, roomSlug);
          return next;
        });
        setEditingCode(false);
        toast.success(`Kode undangan custom disimpan: ${resData.invite_code}`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan kode undangan custom"));
    } finally {
      setSavingCustomCode(false);
    }
  };

  if (initialLoading && !data) {
    return (
      <div className="space-y-5 font-sans tabular-nums" data-testid="billing-panel">
        <section className="card overflow-hidden">
          <div className="p-5 sm:p-6 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="h-11 w-11 shrink-0 rounded-2xl bg-surface2 animate-pulse" />
              <div className="space-y-2 pt-0.5">
                <div className="h-3 w-28 rounded-md bg-surface2 animate-pulse" />
                <div className="h-5 w-48 rounded-md bg-surface2 animate-pulse" />
                <div className="h-3.5 w-64 rounded-md bg-surface2 animate-pulse" />
              </div>
            </div>
            <div className="h-9 w-24 shrink-0 rounded-xl bg-surface2 animate-pulse" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/70 border-t border-border/70">
            <div className="p-5 sm:p-6 space-y-3">
              <div className="h-3.5 w-36 rounded bg-surface2 animate-pulse" />
              <div className="h-7 w-40 rounded bg-surface2 animate-pulse" />
              <div className="h-1.5 w-full rounded-full bg-surface2 animate-pulse" />
              <div className="h-3 w-52 rounded bg-surface2 animate-pulse" />
            </div>
            <div className="p-5 sm:p-6 space-y-3">
              <div className="h-3.5 w-40 rounded bg-surface2 animate-pulse" />
              <div className="h-7 w-44 rounded bg-surface2 animate-pulse" />
              <div className="h-1.5 w-full rounded-full bg-surface2 animate-pulse" />
              <div className="h-3 w-56 rounded bg-surface2 animate-pulse" />
            </div>
          </div>
          <div className="border-t border-border/70 bg-surface2/35 px-5 py-3.5 sm:px-6 flex items-center justify-between gap-3">
            <div className="h-4 w-56 rounded bg-surface2 animate-pulse" />
            <div className="h-7 w-40 rounded bg-surface2 animate-pulse" />
          </div>
        </section>
      </div>
    );
  }

  const activePlan = data?.active_plan || {
    id: "free_starter",
    name: "Starter",
    monthly_price: 0,
    annual_price: 0,
    max_members: 5,
    storage_mb: 512,
  };
  const activeBillingCycle = normalizeCycle(data?.billing_cycle);
  const activePrice =
    activeBillingCycle === "annual"
      ? getPlanAnnualPrice(activePlan)
      : getPlanMonthlyPrice(activePlan);
  const activePriceLabel =
    activePrice <= 0
      ? "Gratis"
      : `${formatRupiah(activePrice)} / ${activeBillingCycle === "annual" ? "tahun" : "bulan"}`;

  const quota = data?.quota || {
    current_members: 0,
    max_members: activePlan.max_members || 5,
    remaining: activePlan.max_members || 5,
    exceeded: false,
  };
  const storage = data?.storage || {
    used_mb: 0.1,
    limit_mb: activePlan.storage_mb || 512,
  };
  const plans = Array.isArray(data?.plans) ? data.plans : [];
  const gateway = data?.gateway || {
    mode: "sandbox",
    display_label: "Gateway Pembayaran Lokal",
    enabled_channels: CHANNEL_OPTIONS.map((c) => c.id),
  };
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];

  const memberPct = Math.min(
    100,
    Math.round(((quota.current_members || 0) / Math.max(1, quota.max_members || 5)) * 100)
  );
  const rawStoragePct = ((storage.used_mb || 0) / Math.max(1, storage.limit_mb || 512)) * 100;
  const storagePct = Math.min(100, Math.max(rawStoragePct > 0 ? 2 : 0, Math.round(rawStoragePct)));
  const storagePctLabel =
    rawStoragePct > 0 && rawStoragePct < 1 ? `${rawStoragePct.toFixed(1)}%` : `${Math.min(100, Math.round(rawStoragePct))}%`;

  const enabledChannels = CHANNEL_OPTIONS.filter((ch) =>
    !Array.isArray(gateway.enabled_channels) || gateway.enabled_channels.length === 0
      ? true
      : gateway.enabled_channels.includes(ch.id)
  );

  const safeSnapUrl =
    activeInvoice?.snap_url && /^https:\/\//i.test(String(activeInvoice.snap_url))
      ? activeInvoice.snap_url
      : "";

  const checkoutPrice =
    cycle === "annual" ? getPlanAnnualPrice(checkoutPlan) : getPlanMonthlyPrice(checkoutPlan);

  return (
    <div className="space-y-5 font-sans tabular-nums" data-testid="billing-panel">
      {/* 1. Active Plan Summary + Quotas + Room Invite Code */}
      <section className="card overflow-hidden">
        {/* Top Plan Header */}
        <div className="p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Crown size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sub">
                Langganan Aktif
              </p>
              <h3 className="mt-0.5 text-lg sm:text-xl font-extrabold text-ink tracking-tight leading-snug">
                Paket {activePlan.name}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-sub">
                <span className="font-semibold text-ink">{activePriceLabel}</span>
                <span aria-hidden="true" className="text-border">•</span>
                <span>Maks. {quota.max_members} anggota</span>
                <span aria-hidden="true" className="text-border">•</span>
                <span>Penyimpanan {formatStorageLimit(storage.limit_mb)}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadBilling({ manual: true, force: true })}
            disabled={refreshing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-surface2 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            <span>Segarkan</span>
          </button>
        </div>

        {/* 2-Column Quota Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/70 border-t border-border/70">
          {/* Quota Members */}
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-sub">
                <Users size={14} className="text-brand shrink-0" />
                <span>Kuota Anggota Aktif</span>
              </span>
              <span className="whitespace-nowrap text-xs font-semibold text-sub">
                {memberPct}% terpakai
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-2xl font-extrabold tracking-tight text-ink">
                {quota.current_members}
              </span>
              <span className="text-xs sm:text-sm font-semibold text-sub">
                / {quota.max_members} anggota
              </span>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  quota.exceeded || memberPct >= 100 ? "bg-rose-500" : "bg-emerald-500"
                }`}
                style={{ width: `${memberPct}%` }}
              />
            </div>

            <p className="mt-2.5 text-xs text-sub leading-relaxed">
              {quota.exceeded || quota.remaining <= 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>Kuota penuh. Upgrade paket untuk menambah anggota baru.</span>
                </span>
              ) : (
                `Tersisa ${quota.remaining} slot anggota yang masih dapat diundang.`
              )}
            </p>
          </div>

          {/* Storage Quota */}
          <div className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-sub">
                <HardDrive size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
                <span>Penyimpanan Workspace</span>
              </span>
              <span className="whitespace-nowrap text-xs font-semibold text-sub">
                {storagePctLabel} terpakai
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-2xl font-extrabold tracking-tight text-ink">
                {Number(storage.used_mb || 0).toFixed(1)} MB
              </span>
              <span className="text-xs sm:text-sm font-semibold text-sub">
                / {formatStorageLimit(storage.limit_mb)}
              </span>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${storagePct}%` }}
              />
            </div>

            <p className="mt-2.5 text-xs text-sub leading-relaxed">
              Lampiran file, media obrolan, aset portal, dan snapshot lokal.
            </p>
          </div>
        </div>

        {/* Room Invite Code Footer Bar */}
        {data?.invite_code && (
          <div className="border-t border-border/70 bg-surface2/35 px-5 py-3.5 sm:px-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-sub">
                  <KeyRound size={13} className="text-sub shrink-0" />
                  <span>Kode Undangan Room</span>
                </span>
                <span className="text-sm font-extrabold tracking-wide text-ink select-all">
                  {data.invite_code}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={copyInviteCode}
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-brand hover:bg-surface2 transition-colors cursor-pointer"
                  title="Salin kode undangan"
                >
                  {copiedCode ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCode ? "Disalin" : "Salin"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomCodeInput(data.invite_code || "");
                    setEditingCode((v) => !v);
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                    editingCode
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border bg-surface text-ink hover:bg-surface2"
                  }`}
                  title="Atur kode undangan custom"
                  data-testid="billing-custom-invite-code-btn"
                >
                  <Pencil size={12} />
                  <span>Custom</span>
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateInviteCode}
                  disabled={regeneratingCode}
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-sub hover:text-ink hover:bg-surface2 transition-colors cursor-pointer disabled:opacity-50"
                  title="Buat kode undangan unik baru"
                >
                  <RefreshCw size={12} className={regeneratingCode ? "animate-spin" : ""} />
                  <span>Acak</span>
                </button>
              </div>
            </div>

            {editingCode &&
              (() => {
                const trimmed = String(customCodeInput || "").trim();
                const hasLen = trimmed.length >= 9 && !/\s/.test(trimmed);
                const hasNum = /[0-9]/.test(trimmed);
                const hasSym = /[^A-Za-z0-9\s]/.test(trimmed);
                const valid = hasLen && hasNum && hasSym;
                return (
                  <form
                    onSubmit={handleSaveCustomInviteCode}
                    className="rounded-xl border border-border bg-surface p-3 space-y-2.5 max-w-lg"
                  >
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        value={customCodeInput}
                        onChange={(e) => setCustomCodeInput(e.target.value.replace(/\s+/g, "").toUpperCase())}
                        placeholder="Contoh: ASLI-TIM#2026"
                        maxLength={32}
                        className="h-9 flex-1 min-w-[180px] rounded-xl border border-border bg-surface2/50 px-3 font-sans text-xs font-bold uppercase tracking-wide text-ink placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-sub/70 outline-none focus:border-brand tabular-nums"
                        data-testid="billing-custom-invite-input"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="submit"
                          disabled={!valid || savingCustomCode}
                          className="h-9 whitespace-nowrap rounded-xl bg-brand px-4 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                          data-testid="billing-save-custom-invite-btn"
                        >
                          {savingCustomCode ? "Menyimpan..." : "Simpan"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCode(false)}
                          className="h-9 whitespace-nowrap rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] font-medium">
                      <span className={hasLen ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-sub"}>
                        {hasLen ? "✓" : "•"} Min. 9 karakter
                      </span>
                      <span className={hasNum ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-sub"}>
                        {hasNum ? "✓" : "•"} Angka (0–9)
                      </span>
                      <span className={hasSym ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-sub"}>
                        {hasSym ? "✓" : "•"} Simbol (-, #, @, !)
                      </span>
                    </div>
                  </form>
                );
              })()}
          </div>
        )}
      </section>

      {/* 2. Plan Selection Grid */}
      <section className="card p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
              Pilihan Paket ASLIWORKSPACE
            </h3>
            <p className="text-xs sm:text-sm text-sub mt-0.5">
              Pembayaran lokal cepat melalui QRIS, Virtual Account Bank (BCA, Mandiri, BNI, BRI), &amp; E-Wallet.
            </p>
          </div>

          {/* Cycle Switcher */}
          <div className="inline-flex rounded-xl bg-surface2 p-1 border border-border shrink-0">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                cycle === "monthly" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
              }`}
            >
              Bulanan
            </button>
            <button
              type="button"
              onClick={() => setCycle("annual")}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                cycle === "annual" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
              }`}
            >
              Tahunan (Hemat 2 Bln)
            </button>
          </div>
        </div>

        {/* 2x2 Grid of Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((p) => {
            const isCurrent = p.id === activePlan.id;
            const isPopular = Boolean(p.is_popular || p.highlight) || p.id === "growth_team";
            const displayPrice = cycle === "annual" ? getPlanAnnualPrice(p) : getPlanMonthlyPrice(p);
            const isFree = displayPrice <= 0;
            const desc = getPlanDescription(p);

            return (
              <div
                key={p.id}
                className={`rounded-2xl border p-5 flex flex-col justify-between transition-all ${
                  isPopular
                    ? "border-brand/70 ring-1 ring-brand/15 bg-surface"
                    : "border-border bg-surface"
                }`}
                data-testid={`billing-plan-${p.id}`}
              >
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-base font-extrabold text-ink tracking-tight">{p.name}</h4>
                      {desc && (
                        <p className="text-xs text-sub mt-0.5 leading-relaxed">{desc}</p>
                      )}
                    </div>
                    {isPopular && (
                      <span className="shrink-0 whitespace-nowrap rounded-lg bg-brand/10 px-2.5 py-0.5 text-[11px] font-bold text-brand">
                        Populer
                      </span>
                    )}
                  </div>

                  <div className="pt-0.5">
                    {isFree ? (
                      <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">Gratis</p>
                    ) : (
                      <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight whitespace-nowrap">
                        {formatRupiah(displayPrice)}{" "}
                        <span className="text-xs sm:text-sm font-medium text-sub">
                          /{cycle === "annual" ? "tahun" : "bulan"}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-border/70 py-2.5 text-xs font-semibold text-ink">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Users size={14} className="text-brand shrink-0" />
                      <span>Maks. {p.max_members} anggota</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <HardDrive size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
                      <span>{formatStorageLimit(p.storage_mb)}</span>
                    </span>
                  </div>

                  <ul className="space-y-2">
                    {(p.features || []).map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-ink">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-5">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className="h-10 w-full rounded-xl border border-border bg-surface2/70 text-xs font-bold text-sub flex items-center justify-center gap-1.5 cursor-default"
                    >
                      <Check size={14} />
                      <span>Paket Aktif Saat Ini</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => handleOpenUpgrade(p)}
                      className={`h-10 w-full rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                        isPopular
                          ? "btn-accent shadow-xs"
                          : "bg-ink text-surface hover:opacity-90"
                      }`}
                      data-testid={`upgrade-plan-btn-${p.id}`}
                    >
                      <span>{isFree ? `Pilih ${p.name}` : `Upgrade ke ${p.name}`}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Transaction History */}
      <section className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-ink">
            <CreditCard size={17} className="text-brand shrink-0" />
            <span>Riwayat Transaksi &amp; Tagihan Lokal</span>
          </div>
          <span className="text-xs font-medium text-sub">
            Gateway: <span className="font-semibold text-ink">{gateway.display_label}</span> ({gateway.mode})
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface2/30 p-6 text-center text-xs text-sub">
            Belum ada riwayat transaksi langganan di room ini.
          </div>
        ) : (
          <div className="divide-y divide-border/70 rounded-xl border border-border overflow-hidden">
            {transactions.map((tx) => {
              const isPaid = tx.status === "paid";
              const txMode = tx.gateway_mode || tx.mode || gateway.mode;
              return (
                <div
                  key={tx.id}
                  className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-ink">{tx.plan_name || tx.plan_id}</span>
                      <span className="text-sub">•</span>
                      <span className="text-[11px] font-semibold uppercase text-sub">
                        {tx.method_label || tx.method}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${
                          isPaid
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {isPaid ? "Lunas" : "Menunggu Pembayaran"}
                      </span>
                    </div>
                    <p className="text-[11px] text-sub">
                      ID: {tx.id} · {tx.created_at ? new Date(tx.created_at).toLocaleString("id-ID") : "-"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-extrabold text-ink whitespace-nowrap">
                      {formatRupiah(tx.amount)}
                    </span>
                    {!isPaid && txMode === "sandbox" && isAdmin && (
                      <button
                        type="button"
                        disabled={busyConfirm}
                        onClick={() => handleConfirmSandboxPaid(tx.id)}
                        className="whitespace-nowrap rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                      >
                        Konfirmasi Lunas
                      </button>
                    )}
                    {!isPaid && tx.snap_url && /^https:\/\//i.test(String(tx.snap_url)) && (
                      <a
                        href={tx.snap_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-white"
                      >
                        <span>Bayar</span>
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Checkout Dialog */}
      <Dialog
        open={Boolean(checkoutPlan)}
        onOpenChange={(v) => !busyCheckout && !busyConfirm && !v && setCheckoutPlan(null)}
      >
        <DialogContent className="max-w-lg rounded-2xl p-5 sm:p-6 bg-surface border border-border shadow-2xl font-sans tabular-nums">
          <DialogHeader className="text-left pb-3 border-b border-border/70">
            <DialogTitle className="text-base sm:text-lg font-extrabold text-ink">
              {activeInvoice ? "Selesaikan Pembayaran Paket" : `Upgrade ke ${checkoutPlan?.name}`}
            </DialogTitle>
            <DialogDescription className="text-xs text-sub">
              Mode Gateway Aktif: <b className="text-ink">{gateway.display_label} ({gateway.mode})</b>
            </DialogDescription>
          </DialogHeader>

          {!activeInvoice ? (
            <div className="space-y-4 pt-2">
              <div className="rounded-xl border border-border bg-surface2/50 p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-sub">
                    Total Tagihan ({cycle === "annual" ? "Tahunan" : "Bulanan"})
                  </p>
                  <p className="text-xl font-extrabold text-ink mt-0.5">
                    {formatRupiah(checkoutPrice)}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs font-bold text-brand">
                  Maks. {checkoutPlan?.max_members} anggota
                </span>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-sub">Pilih Metode Pembayaran Lokal</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {enabledChannels.map((ch) => {
                    const Icon = ch.icon;
                    const active = selectedChannel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setSelectedChannel(ch.id)}
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                          active
                            ? "border-brand bg-brand/5 ring-1 ring-brand/20"
                            : "border-border bg-surface hover:bg-surface2/50"
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            active ? "bg-brand text-white" : "bg-surface2 text-sub"
                          }`}
                        >
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-ink truncate">{ch.label}</p>
                          <p className="text-[11px] text-sub truncate">{ch.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/70">
                <button
                  type="button"
                  disabled={busyCheckout}
                  onClick={() => setCheckoutPlan(null)}
                  className="h-10 rounded-xl border border-border bg-surface px-4 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={busyCheckout}
                  onClick={handleStartCheckout}
                  className="btn-accent h-10 rounded-xl px-5 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {busyCheckout ? "Memproses Tagihan..." : "Buat Tagihan Pembayaran"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="rounded-xl border border-border bg-surface2/50 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sub">ID Transaksi</span>
                  <span className="font-bold text-ink">{activeInvoice.transaction?.id}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sub">Nominal</span>
                  <span className="text-base font-extrabold text-ink">
                    {formatRupiah(activeInvoice.transaction?.amount)}
                  </span>
                </div>
                {activeInvoice.va_number && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                    <span className="text-sub">Nomor Virtual Account</span>
                    <span className="text-sm font-extrabold text-brand tracking-wide">
                      {activeInvoice.va_number}
                    </span>
                  </div>
                )}
                {activeInvoice.qris_code && (
                  <div className="pt-2 border-t border-border/60">
                    <p className="text-sub mb-1">Payload QRIS Dinamis</p>
                    <div className="rounded-lg bg-surface p-2.5 border border-border text-[11px] font-semibold text-ink break-all">
                      {activeInvoice.qris_code}
                    </div>
                  </div>
                )}
              </div>

              {safeSnapUrl ? (
                <div className="space-y-2.5">
                  <a
                    href={safeSnapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-accent h-10 w-full rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2"
                  >
                    <span>Lanjutkan ke Halaman Pembayaran {activeInvoice.provider || "Gateway"}</span>
                    <ExternalLink size={15} />
                  </a>
                  <p className="text-[11px] text-sub text-center">
                    Status paket akan otomatis aktif setelah webhook pembayaran diterima dari gateway.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={busyConfirm}
                    onClick={() => handleConfirmSandboxPaid(activeInvoice.transaction?.id)}
                    className="h-10 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                    data-testid="confirm-sandbox-payment-btn"
                  >
                    <CheckCircle2 size={16} />
                    <span>
                      {busyConfirm ? "Mengaktifkan Paket..." : "Konfirmasi Pembayaran Lunas (Sandbox)"}
                    </span>
                  </button>
                  <p className="text-[11px] text-sub text-center">
                    Simulasi pembayaran lokal instan. Untuk pembayaran real production, aktifkan Live Gateway di Platform Owner Console.
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
