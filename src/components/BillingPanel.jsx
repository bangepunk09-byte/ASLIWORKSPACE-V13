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
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../lib/api";
import { useApp } from "../context/AppContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

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
  const { reloadWs, isAdmin } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState("qris");
  const [busyCheckout, setBusyCheckout] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/billing/overview", { noCache: true });
      setData(res.data);
      if (res.data?.billing_cycle === "yearly") setCycle("yearly");
    } catch (err) {
      toast.error(errMsg(err, "Gagal memuat informasi langganan"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

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
        await loadBilling();
        await reloadWs?.();
        return;
      }
      setActiveInvoice(payload);
      toast.success("Tagihan pembayaran lokal berhasil dibuat.");
      await loadBilling();
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
      await loadBilling();
      await reloadWs?.();
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengkonfirmasi pembayaran"));
    } finally {
      setBusyConfirm(false);
    }
  };

  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [customCodeInput, setCustomCodeInput] = useState("");
  const [savingCustomCode, setSavingCustomCode] = useState(false);

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
        setData((prev) => (prev ? { ...prev, invite_code: resData.invite_code } : prev));
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
        setData((prev) => (prev ? { ...prev, invite_code: resData.invite_code } : prev));
        setEditingCode(false);
        toast.success(`Kode undangan custom disimpan: ${resData.invite_code}`);
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan kode undangan custom"));
    } finally {
      setSavingCustomCode(false);
    }
  };

  const activePlan = data?.active_plan || {
    id: "free",
    name: "Free Starter",
    tagline: "Gratis selamanya untuk tim kecil hingga 5 anggota.",
    badge: "Gratis",
    max_members: 5,
    storage_mb: 512,
  };
  const quota = data?.quota || { current_members: 1, max_members: activePlan.max_members || 5, remaining: 4, exceeded: false };
  const storage = data?.storage || { used_mb: 0.1, limit_mb: activePlan.storage_mb || 512 };
  const plans = Array.isArray(data?.plans) ? data.plans : [];
  const gateway = data?.gateway || {
    mode: "sandbox",
    display_label: "Gateway Pembayaran Lokal",
    enabled_channels: CHANNEL_OPTIONS.map((c) => c.id),
  };
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];

  const memberPct = Math.min(100, Math.round(((quota.current_members || 0) / Math.max(1, quota.max_members || 5)) * 100));
  const storagePct = Math.min(100, Math.max(3, Math.round(((storage.used_mb || 0) / Math.max(1, storage.limit_mb || 512)) * 100)));

  const enabledChannels = CHANNEL_OPTIONS.filter((ch) =>
    !Array.isArray(gateway.enabled_channels) || gateway.enabled_channels.length === 0
      ? true
      : gateway.enabled_channels.includes(ch.id)
  );

  const safeSnapUrl =
    activeInvoice?.snap_url && /^https:\/\//i.test(String(activeInvoice.snap_url))
      ? activeInvoice.snap_url
      : "";

  return (
    <div className="space-y-5 font-sans tabular-nums" data-testid="billing-panel">
      {/* 1. Active Plan Summary + Quotas */}
      <section className="card p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-brand dark:bg-rose-950/50">
              <Crown size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
                  Paket {activePlan.name}
                </h3>
                <span className="rounded-full border border-border bg-surface2 px-2.5 py-0.5 text-[11px] font-bold text-ink">
                  {Number(activePlan.price_monthly || 0) === 0
                    ? `Gratis (Maks. ${activePlan.max_members} Anggota)`
                    : `${formatRupiah(activePlan.price_monthly)}/bln`}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-sub mt-0.5">
                {activePlan.tagline || "Gratis selamanya untuk tim kecil hingga 5 anggota."}
              </p>
              {data?.invite_code && (
                <div className="mt-2 space-y-2 text-xs text-sub font-sans tabular-nums">
                  <div className="inline-flex flex-wrap items-center gap-2.5">
                    <span>Kode Undangan Room:</span>
                    <span className="font-mono font-bold text-ink tracking-wide">{data.invite_code}</span>
                    <button
                      type="button"
                      onClick={copyInviteCode}
                      className="inline-flex items-center gap-1 font-semibold text-brand hover:underline cursor-pointer"
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
                      className="inline-flex items-center gap-1 font-semibold text-ink hover:underline cursor-pointer"
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
                      className="inline-flex items-center gap-1 font-semibold text-sub hover:text-ink cursor-pointer disabled:opacity-50"
                      title="Buat kode undangan unik baru"
                    >
                      <RefreshCw size={12} className={regeneratingCode ? "animate-spin" : ""} />
                      <span>Acak</span>
                    </button>
                  </div>
                  {editingCode && (() => {
                    const trimmed = String(customCodeInput || "").trim();
                    const hasLen = trimmed.length >= 9 && !/\s/.test(trimmed);
                    const hasNum = /[0-9]/.test(trimmed);
                    const hasSym = /[^A-Za-z0-9\s]/.test(trimmed);
                    const valid = hasLen && hasNum && hasSym;
                    return (
                      <form onSubmit={handleSaveCustomInviteCode} className="rounded-2xl border border-border bg-surface2/60 p-3 space-y-2 max-w-md">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={customCodeInput}
                            onChange={(e) => setCustomCodeInput(e.target.value.replace(/\s+/g, "").toUpperCase())}
                            placeholder="Cth: ASLI-TIM#2026"
                            maxLength={32}
                            className="h-9 flex-1 rounded-full border border-border bg-surface px-3.5 font-mono text-xs font-bold uppercase tracking-wider text-ink outline-none focus:border-brand"
                            data-testid="billing-custom-invite-input"
                          />
                          <button
                            type="submit"
                            disabled={!valid || savingCustomCode}
                            className="h-9 rounded-full bg-brand px-4 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                            data-testid="billing-save-custom-invite-btn"
                          >
                            {savingCustomCode ? "Simpan..." : "Simpan"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCode(false)}
                            className="h-9 rounded-full border border-border bg-surface px-3 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                          <span className={hasLen ? "text-emerald-600 font-semibold" : "text-sub"}>
                            {hasLen ? "✓" : "•"} Min. 9 karakter
                          </span>
                          <span className={hasNum ? "text-emerald-600 font-semibold" : "text-sub"}>
                            {hasNum ? "✓" : "•"} Angka (0-9)
                          </span>
                          <span className={hasSym ? "text-emerald-600 font-semibold" : "text-sub"}>
                            {hasSym ? "✓" : "•"} Simbol (-, #, @, !)
                          </span>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={loadBilling}
            disabled={loading}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-xs font-bold text-ink hover:bg-surface2 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>Segarkan</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Quota Members */}
          <div className="rounded-2xl border border-border bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="inline-flex items-center gap-1.5 font-bold text-ink">
                <Users size={15} className="text-brand" />
                <span>Kuota Anggota Aktif</span>
              </span>
              <span className="font-extrabold text-ink">
                {quota.current_members} / {quota.max_members} anggota
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  quota.exceeded || memberPct >= 100 ? "bg-rose-500" : "bg-emerald-500"
                }`}
                style={{ width: `${memberPct}%` }}
              />
            </div>
            <p className="text-xs text-sub leading-relaxed">
              {quota.exceeded || quota.remaining <= 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={12} /> Kuota penuh. Upgrade paket untuk menambah anggota tim baru.
                </span>
              ) : (
                `Tersisa ${quota.remaining} slot anggota yang masih dapat diundang.`
              )}
            </p>
          </div>

          {/* Storage Quota */}
          <div className="rounded-2xl border border-border bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <span className="inline-flex items-center gap-1.5 font-bold text-ink">
                <HardDrive size={15} className="text-sky-600" />
                <span>Penyimpanan Workspace</span>
              </span>
              <span className="font-extrabold text-ink">
                {Number(storage.used_mb || 0).toFixed(1)} MB / {formatStorageLimit(storage.limit_mb)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${storagePct}%` }}
              />
            </div>
            <p className="text-xs text-sub leading-relaxed">
              Meliputi file lampiran, media obrolan, aset portal, dan snapshot lokal.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Plan Selection Grid */}
      <section className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
              Pilihan Paket ASLIWORKSPACE
            </h3>
            <p className="text-xs sm:text-sm text-sub mt-0.5">
              Pembayaran lokal cepat melalui QRIS, Virtual Account Bank (BCA/Mandiri/BNI/BRI), &amp; E-Wallet.
            </p>
          </div>
        </div>

        {/* Cycle Switcher */}
        <div className="inline-flex rounded-full bg-surface2 p-1 border border-border">
          <button
            type="button"
            onClick={() => setCycle("monthly")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              cycle === "monthly" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
            }`}
          >
            Bulanan
          </button>
          <button
            type="button"
            onClick={() => setCycle("yearly")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              cycle === "yearly" ? "bg-surface text-ink shadow-xs" : "text-sub hover:text-ink"
            }`}
          >
            Tahunan (Hemat 2 Bln)
          </button>
        </div>

        {/* 2x2 Grid of Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((p) => {
            const isCurrent = p.id === activePlan.id;
            const isPopular = Boolean(p.highlight) || p.id === "growth";
            const displayPrice = cycle === "yearly" ? p.price_yearly : p.price_monthly;
            const isFree = Number(displayPrice || 0) <= 0;

            return (
              <div
                key={p.id}
                className={`rounded-3xl border p-5 flex flex-col justify-between transition-all ${
                  isPopular
                    ? "border-brand shadow-sm ring-1 ring-brand/15 bg-surface"
                    : "border-border bg-surface"
                }`}
                data-testid={`billing-plan-${p.id}`}
              >
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-base font-extrabold text-ink">{p.name}</h4>
                      <p className="text-xs text-sub mt-0.5 leading-relaxed">{p.tagline}</p>
                    </div>
                    {p.badge && (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          isPopular
                            ? "bg-brand text-white"
                            : "border border-border bg-surface text-ink"
                        }`}
                      >
                        {p.badge}
                      </span>
                    )}
                  </div>

                  <div className="pt-1">
                    {isFree ? (
                      <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">Gratis</p>
                    ) : (
                      <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                        {formatRupiah(displayPrice)}{" "}
                        <span className="text-xs sm:text-sm font-medium text-sub">
                          /{cycle === "yearly" ? "tahun" : "bulan"}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-y border-border/70 py-2.5 text-xs font-bold text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={14} className="text-brand" />
                      Maks. {p.max_members} anggota
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <HardDrive size={14} className="text-sky-600" />
                      {formatStorageLimit(p.storage_mb)}
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
                      className="h-11 w-full rounded-full border border-border bg-surface2/70 text-xs font-bold text-sub flex items-center justify-center gap-1.5 cursor-default"
                    >
                      <Check size={14} />
                      <span>Paket Aktif Saat Ini</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => handleOpenUpgrade(p)}
                      className={`h-11 w-full rounded-full text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                        isPopular
                          ? "btn-accent shadow-sm"
                          : "bg-[#1A2133] hover:bg-[#101522] text-white dark:bg-white dark:text-[#101522]"
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
          <span className="text-xs font-semibold text-sub">
            Gateway: <b className="text-ink">{gateway.display_label}</b> ({gateway.mode})
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface2/30 p-6 text-center text-xs text-sub">
            Belum ada riwayat transaksi langganan di room ini.
          </div>
        ) : (
          <div className="divide-y divide-border/70 rounded-2xl border border-border overflow-hidden">
            {transactions.map((tx) => {
              const isPaid = tx.status === "paid";
              return (
                <div
                  key={tx.id}
                  className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-ink">{tx.plan_name || tx.plan_id}</span>
                      <span className="rounded-full border border-border bg-surface2 px-2 py-0.5 text-[10px] font-bold uppercase text-sub">
                        {tx.method_label || tx.method}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
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
                    <span className="text-sm font-extrabold text-ink">{formatRupiah(tx.amount)}</span>
                    {!isPaid && tx.mode === "sandbox" && isAdmin && (
                      <button
                        type="button"
                        disabled={busyConfirm}
                        onClick={() => handleConfirmSandboxPaid(tx.id)}
                        className="rounded-full bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                      >
                        Konfirmasi Lunas
                      </button>
                    )}
                    {!isPaid && tx.snap_url && /^https:\/\//i.test(String(tx.snap_url)) && (
                      <a
                        href={tx.snap_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-white"
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
      <Dialog open={Boolean(checkoutPlan)} onOpenChange={(v) => !busyCheckout && !busyConfirm && !v && setCheckoutPlan(null)}>
        <DialogContent className="max-w-lg rounded-[28px] p-5 sm:p-6 bg-surface border border-border shadow-2xl font-sans tabular-nums">
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
              <div className="rounded-2xl border border-border bg-surface2/50 p-3.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-sub">Total Tagihan ({cycle === "yearly" ? "Tahunan" : "Bulanan"})</p>
                  <p className="text-xl font-extrabold text-ink mt-0.5">
                    {formatRupiah(cycle === "yearly" ? checkoutPlan?.price_yearly : checkoutPlan?.price_monthly)}
                  </p>
                </div>
                <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
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
                        className={`flex items-center gap-2.5 rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                          active
                            ? "border-brand bg-brand/5 ring-1 ring-brand/20"
                            : "border-border bg-surface hover:bg-surface2/50"
                        }`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? "bg-brand text-white" : "bg-surface2 text-sub"}`}>
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-ink truncate">{ch.label}</p>
                          <p className="text-[10.5px] text-sub truncate">{ch.desc}</p>
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
                  className="h-10 rounded-full border border-border bg-surface px-5 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={busyCheckout}
                  onClick={handleStartCheckout}
                  className="btn-accent h-10 rounded-full px-5 text-xs font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {busyCheckout ? "Memproses Tagihan..." : "Buat Tagihan Pembayaran"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl border border-border bg-surface2/50 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-sub">ID Transaksi</span>
                  <span className="font-bold text-ink">{activeInvoice.transaction?.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sub">Nominal</span>
                  <span className="text-base font-extrabold text-ink">{formatRupiah(activeInvoice.transaction?.amount)}</span>
                </div>
                {activeInvoice.va_number && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/60">
                    <span className="text-sub">Nomor Virtual Account</span>
                    <span className="text-sm font-extrabold text-brand tracking-wider">{activeInvoice.va_number}</span>
                  </div>
                )}
                {activeInvoice.qris_code && (
                  <div className="pt-2 border-t border-border/60">
                    <p className="text-sub mb-1">Payload QRIS Dinamis</p>
                    <div className="rounded-xl bg-surface p-2.5 border border-border text-[11px] font-semibold text-ink break-all">
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
                    className="btn-accent h-11 w-full rounded-full text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2"
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
                    className="h-11 w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                    data-testid="confirm-sandbox-payment-btn"
                  >
                    <CheckCircle2 size={16} />
                    <span>{busyConfirm ? "Mengaktifkan Paket..." : "Konfirmasi Pembayaran Lunas (Sandbox)"}</span>
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
