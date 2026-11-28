import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { api, errMsg } from "../lib/api";
import { googleBasicSignIn } from "../lib/auth";
import { getPlatformOwnerCachedUser, getPlatformOwnerToken, setPlatformOwnerSession } from "../lib/roomContext";
import { Switch } from "../components/ui/switch";
import { AppSelect } from "../components/ui/select";
import { PasswordStrengthMeter } from "../components/PasswordStrengthMeter";

const SIDEBAR_TABS = [
  { id: "rooms", label: "Overview & Rooms", icon: Layers },
  { id: "plans", label: "Paket & Harga SaaS", icon: Package },
  { id: "gateway", label: "Payment Gateway & Transaksi", icon: CreditCard },
  { id: "telemetry", label: "Trafik & Telemetri", icon: Activity },
  { id: "backup", label: "Backup & Recovery", icon: ArchiveRestore },
  { id: "governance", label: "Tata Kelola SaaS", icon: ShieldCheck },
  { id: "account", label: "Pengaturan Akun", icon: UserCog },
];

const ALL_PAYMENT_CHANNELS = [
  { id: "qris", label: "QRIS Dinamis" },
  { id: "va_bca", label: "Virtual Account BCA" },
  { id: "va_mandiri", label: "Virtual Account Mandiri" },
  { id: "va_bni", label: "Virtual Account BNI" },
  { id: "va_bri", label: "Virtual Account BRI" },
  { id: "gopay", label: "E-Wallet GoPay" },
  { id: "ovo", label: "E-Wallet OVO" },
  { id: "dana", label: "E-Wallet DANA" },
];

const GOVERNANCE_CARDS = [
  {
    key: "enforce_free_quota",
    priority: "Aktif",
    statusOn: "Aktif di Backend & Undangan",
    statusOff: "Bypass Kuota Free Aktif",
    title: "Enforce Kuota 5 Anggota Gratis & Paket Dinamis",
    desc: "Setiap workspace gratis otomatis dibatasi maksimal 5 anggota aktif. Tambahan anggota di atas batas ditolak otomatis (HTTP 402) dengan ajakan upgrade paket.",
  },
  {
    key: "local_gateway_enabled",
    priority: "Aktif",
    statusOn: "Webhook & Sandbox Siap",
    statusOff: "Checkout Dinonaktifkan",
    title: "Payment Gateway Lokal (QRIS, Virtual Account, E-Wallet)",
    desc: "Checkout paket langganan mendukung QRIS dinamis, VA BCA/Mandiri/BNI/BRI, GoPay/OVO/DANA, serta integrasi webhook Midtrans Snap & Xendit Invoice.",
  },
  {
    key: "custom_domain_cname",
    priority: "Tinggi",
    statusOn: "Path /w/slug + CNAME Siap",
    statusOff: "Hanya Path /w/slug",
    title: "Verifikasi DNS CNAME & Auto-SSL Custom Domain",
    desc: "Mendukung pemetaan domain perusahaan khusus (*.domain.com) dan resolusi otomatis portal klien berdasar Host Header.",
  },
  {
    key: "firestore_backup_sync",
    priority: "Tinggi",
    statusOn: "Snapshot Lokal & Cloud Aktif",
    statusOff: "Snapshot Manual Saja",
    title: "Replikasi Backup Cloud Firestore & Ekspor JSON",
    desc: "Snapshot JSON tersimpan terisolasi per workspace serta siap diekspor untuk pemulihan cepat lintas perangkat secara aman.",
  },
  {
    key: "security_anomaly_alert",
    priority: "Tinggi",
    statusOn: "Metrik 4xx/5xx Real-Time",
    statusOff: "Monitoring Standar",
    title: "Alert Anomali Keamanan & Pemantauan Error 5xx",
    desc: "Pantau percobaan login gagal berulang, token invalid, serta trafik 4xx/5xx per room agar owner proaktif menjaga stabilitas.",
  },
  {
    key: "soft_delete_grace",
    priority: "Menengah",
    statusOn: "Download Backup + Suspend Aktif",
    statusOff: "Hapus Langsung Tersedia",
    title: "Soft-Delete Grace Period & Export Final Sebelum Hapus Room",
    desc: "Suspend workspace terlebih dahulu dan unduh JSON backup final sebelum penghapusan permanen data klien.",
  },
];

function formatIdr(num) {
  return `Rp ${Number(num || 0).toLocaleString("id-ID")}`;
}

function getIndoGreeting() {
  const hr = new Date().getHours();
  if (hr < 11) return "Selamat Pagi";
  if (hr < 15) return "Selamat Siang";
  if (hr < 18) return "Selamat Sore";
  return "Selamat Malam";
}

const RealtimeAnalyticsCard = memo(function RealtimeAnalyticsCard({
  realtimeSeries = [],
  hourlySeries = [],
  rooms = [],
  lastUpdatedAt,
  chartRange,
  onChangeRange,
  compact = false,
}) {
  const activeSeries = chartRange === "hourly" ? hourlySeries : realtimeSeries;
  const roomChartData = useMemo(
    () =>
      rooms.map((r) => ({
        name: r.name?.length > 14 ? `${r.name.slice(0, 14)}…` : r.name || r.slug,
        requests: Number(r.telemetry?.req_24h || 0),
        members: Number(r.active_members || 0),
        storage_kb: Number(r.storage_kb || 0),
      })),
    [rooms]
  );

  const totalWindowReq = activeSeries.reduce((s, p) => s + Number(p.requests || 0), 0);
  const peakOnline = activeSeries.reduce((m, p) => Math.max(m, Number(p.online_users || 0)), 0);
  const totalWindowErr = activeSeries.reduce((s, p) => s + Number(p.errors || 0), 0);

  return (
    <section
      className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5"
      data-testid="owner-realtime-analytics"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-brand dark:bg-rose-950/40">
            <TrendingUp size={18} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold text-ink">
                Grafik Analitik Penggunaan Realtime
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live{lastUpdatedAt ? ` · ${lastUpdatedAt}` : ""}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-sub">
              Pantau trafik request API, pengguna online, serta distribusi beban per workspace room secara langsung.
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/70 p-1">
          {[
            { id: "realtime", label: "Realtime (20m)" },
            { id: "hourly", label: "Per Jam (12j)" },
            { id: "rooms", label: "Per Room" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeRange(tab.id)}
              data-testid={`analytics-range-${tab.id}`}
              className={`h-8 rounded-xl px-3 text-xs font-bold transition-colors duration-75 ease-out cursor-pointer ${
                chartRange === tab.id
                  ? "bg-surface text-ink shadow-2xs"
                  : "text-sub hover:text-ink hover:bg-surface/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/40 px-3.5 py-2.5">
          <p className="text-[11px] font-semibold text-sub">
            {chartRange === "hourly" ? "Request (12 Jam)" : "Request (20 Menit)"}
          </p>
          <p className="mt-0.5 text-lg font-extrabold text-ink font-sans tabular-nums">
            {totalWindowReq} req
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/40 px-3.5 py-2.5">
          <p className="text-[11px] font-semibold text-sub">Puncak Online</p>
          <p className="mt-0.5 text-lg font-extrabold text-blue-600 font-sans tabular-nums">
            {peakOnline} user
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-surface2/40 px-3.5 py-2.5">
          <p className="text-[11px] font-semibold text-sub">Error (4xx/5xx)</p>
          <p className="mt-0.5 text-lg font-extrabold text-amber-600 font-sans tabular-nums">
            {totalWindowErr}
          </p>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className={compact ? "h-[240px] w-full" : "h-[290px] w-full"}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={compact ? 220 : 260}>
          {chartRange === "rooms" ? (
            <BarChart data={roomChartData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#64748B", fontWeight: 600, fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748B", fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "16px",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 10px 25px rgba(15,23,42,0.08)",
                  fontSize: "12px",
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                }}
              />
              <Bar dataKey="requests" name="Request 24j" fill="#FF5364" radius={[8, 8, 0, 0]} maxBarSize={42} />
              <Bar dataKey="members" name="Anggota Aktif" fill="#3B82F6" radius={[8, 8, 0, 0]} maxBarSize={42} />
            </BarChart>
          ) : (
            <AreaChart data={activeSeries} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="gradOwnerRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF5364" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#FF5364" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="gradOwnerOnline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "#64748B", fontWeight: 600, fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748B", fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "16px",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 10px 25px rgba(15,23,42,0.08)",
                  fontSize: "12px",
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                }}
              />
              <Area
                type="monotone"
                dataKey="requests"
                name="Request API"
                stroke="#FF5364"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#gradOwnerRequests)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="online_users"
                name="Pengguna Online"
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#gradOwnerOnline)"
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
});

export default function PlatformOwnerConsole() {
  const navigate = useNavigate();
  const [ownerToken, setOwnerToken] = useState(() => getPlatformOwnerToken());
  const [ownerUser, setOwnerUser] = useState(() => getPlatformOwnerCachedUser());

  // Auth form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busyAuth, setBusyAuth] = useState(false);

  // Dashboard state
  const [activeTab, setActiveTab] = useState("rooms");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [plansDraft, setPlansDraft] = useState([]);
  const [gatewayDraft, setGatewayDraft] = useState({
    mode: "sandbox",
    live_provider: "midtrans",
    midtrans_is_production: false,
    enabled_channels: ["qris", "va_bca", "va_mandiri", "va_bni", "gopay", "ovo", "dana"],
  });
  const [busyAction, setBusyAction] = useState("");
  const [chartRange, setChartRange] = useState("realtime");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");

  // Account Settings state
  const [accountName, setAccountName] = useState(() => ownerUser?.name || "");
  const [accountJobTitle, setAccountJobTitle] = useState(() => ownerUser?.job_title || "Superpower Platform Owner");
  const [accountPhone, setAccountPhone] = useState(() => ownerUser?.phone || "");
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [revokeOthersOnPassChange, setRevokeOthersOnPassChange] = useState(true);
  const [generatedPasskey, setGeneratedPasskey] = useState("");
  const [confirmResetAction, setConfirmResetAction] = useState(null);
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");

  const mainScrollRef = useRef(null);

  const handleTabChange = useCallback((nextTab) => {
    setActiveTab(nextTab);
    setConfirmResetAction(null);
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, []);

  const ownerHeaders = useCallback(
    (tok = ownerToken) => ({ "X-Platform-Owner-Token": tok }),
    [ownerToken]
  );

  const loadDashboard = useCallback(
    async (tok = ownerToken, { silent = false } = {}) => {
      if (!tok) return;
      if (!silent) setLoading(true);
      try {
        const res = await api.get("/platform-owner/dashboard", { headers: ownerHeaders(tok), noCache: true });
        setData(res.data);
        setLastUpdatedAt(format(new Date(), "HH:mm:ss"));
        if (res.data?.owner) {
          if (!silent) {
            setOwnerUser(res.data.owner);
            setPlatformOwnerSession(tok, res.data.owner);
            setAccountName(res.data.owner.name || "");
            setAccountJobTitle(res.data.owner.job_title || "Superpower Platform Owner");
            setAccountPhone(res.data.owner.phone || "");
          } else {
            setOwnerUser((prev) => {
              const nextStr = JSON.stringify(res.data.owner);
              const prevStr = prev ? JSON.stringify(prev) : "";
              if (nextStr === prevStr) return prev;
              setPlatformOwnerSession(tok, res.data.owner);
              return res.data.owner;
            });
          }
        }
        if (!silent) {
          if (Array.isArray(res.data?.plans)) {
            setPlansDraft(res.data.plans);
          }
          if (res.data?.gateway) {
            setGatewayDraft({
              mode: res.data.gateway.mode || "sandbox",
              live_provider: res.data.gateway.live_provider || "midtrans",
              midtrans_is_production: Boolean(res.data.gateway.midtrans_is_production),
              enabled_channels: Array.isArray(res.data.gateway.enabled_channels)
                ? res.data.gateway.enabled_channels
                : ["qris", "va_bca", "va_mandiri", "va_bni", "gopay", "ovo", "dana"],
            });
          }
        }
      } catch (err) {
        if (err?.response?.status === 401) {
          setPlatformOwnerSession(null, null);
          setOwnerToken(null);
          setOwnerUser(null);
          toast.error("Sesi Platform Owner berakhir. Silakan masuk kembali.");
        } else if (!silent) {
          toast.error(errMsg(err, "Gagal memuat data Platform Owner Console."));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [ownerHeaders, ownerToken]
  );

  useEffect(() => {
    if (!ownerToken) return;
    loadDashboard(ownerToken);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadDashboard(ownerToken, { silent: true });
    }, 5000);
    return () => clearInterval(id);
  }, [ownerToken, loadDashboard]);

  const handlePasswordAuth = async (e) => {
    e.preventDefault();
    setBusyAuth(true);
    try {
      const res = await api.post("/platform-owner/auth", {
        mode: "password",
        email: email.trim(),
        password,
      });
      setPlatformOwnerSession(res.data.token, res.data.owner);
      setOwnerToken(res.data.token);
      setOwnerUser(res.data.owner);
      toast.success("Berhasil masuk ke Platform Owner Console!");
    } catch (err) {
      toast.error(errMsg(err, "Kredensial Superpower Admin tidak valid."));
    } finally {
      setBusyAuth(false);
    }
  };

  const handleGoogleOwnerSignIn = async () => {
    setBusyAuth(true);
    try {
      const authRes = await googleBasicSignIn();
      const fbUser = authRes?.user || authRes;
      const emailVal = String(authRes?.email || fbUser?.email || "").trim().toLowerCase();
      const tokenVal = authRes?.idToken || (await fbUser?.getIdToken?.().catch(() => "")) || "";
      if (!emailVal) {
        throw new Error("Akun Google tidak mengembalikan email yang valid.");
      }
      const res = await api.post("/platform-owner/auth", {
        mode: "google",
        email: emailVal,
        idToken: tokenVal,
      });
      setPlatformOwnerSession(res.data.token, res.data.owner);
      setOwnerToken(res.data.token);
      setOwnerUser(res.data.owner);
      toast.success("Terautentikasi sebagai Platform Owner!");
    } catch (err) {
      toast.error(errMsg(err, "Akun Google tidak memiliki akses Platform Owner."));
    } finally {
      setBusyAuth(false);
    }
  };

  const handleOwnerLogout = () => {
    setPlatformOwnerSession(null, null);
    setOwnerToken(null);
    setOwnerUser(null);
    setData(null);
    toast.info("Keluar dari Platform Owner Console.");
  };

  const handleBackupAll = async () => {
    setBusyAction("backup_all");
    try {
      const res = await api.post("/platform-owner/backup-all", {}, { headers: ownerHeaders() });
      setData((prev) => (prev ? { ...prev, snapshots: res.data.snapshots } : prev));
      toast.success("Snapshot penuh seluruh room berhasil dibuat!");
      loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal membuat snapshot seluruh room."));
    } finally {
      setBusyAction("");
    }
  };

  const handleExportRoom = async (slug) => {
    setBusyAction(`export_${slug}`);
    try {
      const res = await api.get(`/platform-owner/rooms/${encodeURIComponent(slug)}/export`, {
        headers: ownerHeaders(),
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `asliworkspace-${slug}-backup.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Backup JSON room "${slug}" diunduh.`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengekspor data room."));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateRoom = async (slug, patch) => {
    setBusyAction(`room_${slug}`);
    try {
      await api.patch(`/platform-owner/rooms/${encodeURIComponent(slug)}`, patch, {
        headers: ownerHeaders(),
      });
      toast.success(`Room "${slug}" diperbarui!`);
      await loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui konfigurasi room."));
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteRoom = async (slug) => {
    setBusyAction(`delete_${slug}`);
    try {
      await api.delete(`/platform-owner/rooms/${encodeURIComponent(slug)}`, {
        headers: ownerHeaders(),
      });
      toast.success(`Room "${slug}" dihapus permanen.`);
      await loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menghapus room."));
    } finally {
      setBusyAction("");
    }
  };

  const handleSavePlans = async () => {
    setBusyAction("save_plans");
    try {
      await api.put("/platform-owner/plans", { plans: plansDraft }, { headers: ownerHeaders() });
      toast.success("Konfigurasi paket & harga SaaS diperbarui!");
      await loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan paket SaaS."));
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveGateway = async (overrideDraft = null) => {
    const payload = overrideDraft || gatewayDraft;
    setBusyAction("save_gateway");
    try {
      await api.put("/platform-owner/gateway", payload, { headers: ownerHeaders() });
      toast.success(
        `Mode gateway berhasil dialihkan ke ${
          payload.mode === "sandbox" ? "Sandbox Lokal" : `Live (${payload.live_provider.toUpperCase()})`
        }!`
      );
      await loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan pengaturan Payment Gateway."));
    } finally {
      setBusyAction("");
    }
  };

  const handleMarkTxPaid = async (txId) => {
    setBusyAction(`tx_${txId}`);
    try {
      await api.post(`/platform-owner/transactions/${encodeURIComponent(txId)}/mark-paid`, {}, {
        headers: ownerHeaders(),
      });
      toast.success("Transaksi ditandai lunas & kuota room aktif!");
      await loadDashboard();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menandai transaksi lunas."));
    } finally {
      setBusyAction("");
    }
  };

  const handleToggleGovernance = async (key, value) => {
    setBusyAction(`gov_${key}`);
    try {
      const res = await api.put(
        "/platform-owner/governance",
        { [key]: value },
        { headers: ownerHeaders() }
      );
      setData((prev) => (prev ? { ...prev, governance: res.data.governance } : prev));
      toast.success("Kebijakan tata kelola SaaS diperbarui.");
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui kebijakan tata kelola."));
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveAccountProfile = async (e) => {
    e.preventDefault();
    setBusyAction("save_profile");
    try {
      const res = await api.patch(
        "/platform-owner/account/profile",
        {
          name: accountName.trim(),
          job_title: accountJobTitle.trim(),
          phone: accountPhone.trim(),
        },
        { headers: ownerHeaders() }
      );
      setOwnerUser(res.data.owner);
      setPlatformOwnerSession(ownerToken, res.data.owner);
      setAccountName(res.data.owner.name || "");
      setAccountJobTitle(res.data.owner.job_title || "");
      setAccountPhone(res.data.owner.phone || "");
      toast.success("Profil akun Platform Owner diperbarui!");
      await loadDashboard(ownerToken, { silent: true });
    } catch (err) {
      toast.error(errMsg(err, "Gagal memperbarui profil akun."));
    } finally {
      setBusyAction("");
    }
  };

  const handleChangeOwnerPassword = async (e) => {
    e.preventDefault();
    if (!newPass || newPass.length < 8) {
      toast.error("Passkey baru minimal 8 karakter.");
      return;
    }
    if (newPass !== confirmPass) {
      toast.error("Konfirmasi passkey baru tidak cocok.");
      return;
    }
    setBusyAction("save_password");
    try {
      const res = await api.put(
        "/platform-owner/account/password",
        {
          current_password: currentPass,
          new_password: newPass,
          revoke_other_sessions: revokeOthersOnPassChange,
        },
        { headers: ownerHeaders() }
      );
      if (res.data?.token) {
        setPlatformOwnerSession(res.data.token, res.data.owner);
        setOwnerToken(res.data.token);
      }
      if (res.data?.owner) setOwnerUser(res.data.owner);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      toast.success("Passkey keamanan console berhasil diperbarui!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengganti passkey console."));
    } finally {
      setBusyAction("");
    }
  };

  const handleConfirmResetAction = async () => {
    if (!confirmResetAction) return;
    const action = confirmResetAction;
    setBusyAction(`reset_${action}`);
    try {
      if (action === "passkey") {
        const res = await api.post("/platform-owner/account/reset-passkey", {}, { headers: ownerHeaders() });
        setGeneratedPasskey(res.data.generated_passkey || "");
        if (res.data?.token) {
          setPlatformOwnerSession(res.data.token, res.data.owner);
          setOwnerToken(res.data.token);
        }
        if (res.data?.owner) setOwnerUser(res.data.owner);
        toast.success("Passkey baru berhasil dibuat. Segera salin dan simpan di tempat aman!");
      } else if (action === "sessions") {
        const res = await api.post("/platform-owner/account/revoke-sessions", {}, { headers: ownerHeaders() });
        if (res.data?.token) {
          setPlatformOwnerSession(res.data.token, res.data.owner);
          setOwnerToken(res.data.token);
        }
        if (res.data?.owner) setOwnerUser(res.data.owner);
        toast.success("Seluruh sesi di perangkat lain telah dicabut.");
      } else if (action === "telemetry") {
        await api.post(
          "/platform-owner/account/reset",
          { mode: "telemetry_only" },
          { headers: ownerHeaders() }
        );
        toast.success("Statistik grafik & counter telemetri berhasil direset.");
        await loadDashboard(ownerToken);
      } else if (action === "defaults") {
        const res = await api.post(
          "/platform-owner/account/reset",
          { mode: "profile_and_governance" },
          { headers: ownerHeaders() }
        );
        if (res.data?.owner) {
          setOwnerUser(res.data.owner);
          setPlatformOwnerSession(ownerToken, res.data.owner);
          setAccountName(res.data.owner.name || "");
          setAccountJobTitle(res.data.owner.job_title || "");
          setAccountPhone(res.data.owner.phone || "");
        }
        toast.success("Preferensi profil & kebijakan tata kelola dikembalikan ke bawaan.");
        await loadDashboard(ownerToken);
      }
      setConfirmResetAction(null);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menjalankan aksi reset akun."));
    } finally {
      setBusyAction("");
    }
  };

  const handleAddOwnerAccount = async (e) => {
    e.preventDefault();
    if (!newOwnerEmail.trim()) return;
    setBusyAction("add_owner");
    try {
      const res = await api.post(
        "/platform-owner/account/owners",
        { email: newOwnerEmail.trim(), name: newOwnerName.trim() },
        { headers: ownerHeaders() }
      );
      setData((prev) => (prev ? { ...prev, platform_owners: res.data.platform_owners } : prev));
      setNewOwnerEmail("");
      setNewOwnerName("");
      toast.success("Email Superpower Admin baru ditambahkan!");
    } catch (err) {
      toast.error(errMsg(err, "Gagal menambahkan akses Platform Owner."));
    } finally {
      setBusyAction("");
    }
  };

  const handleRemoveOwnerAccount = async (targetEmail) => {
    setBusyAction(`rm_owner_${targetEmail}`);
    try {
      const res = await api.delete("/platform-owner/account/owners", {
        headers: ownerHeaders(),
        data: { email: targetEmail },
      });
      setData((prev) => (prev ? { ...prev, platform_owners: res.data.platform_owners } : prev));
      toast.success(`Akses Platform Owner untuk ${targetEmail} dicabut.`);
    } catch (err) {
      toast.error(errMsg(err, "Gagal mencabut akses Platform Owner."));
    } finally {
      setBusyAction("");
    }
  };

  // Unauthenticated Console Gate
  if (!ownerToken) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background p-4 font-sans tabular-nums"
        style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
        data-testid="platform-owner-login"
      >
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 dark:border-slate-800 bg-surface p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <ShieldCheck size={22} />
              </div>
              <div>
                <p className="text-sm font-extrabold tracking-tight text-ink">ASLIWORKSPACE</p>
                <p className="text-xs font-medium text-sub">Platform Owner Console · Superpower Admin</p>
              </div>
            </div>
            <Link
              to="/login"
              className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold text-sub hover:text-ink"
            >
              <ArrowLeft size={13} /> Login
            </Link>
          </div>

          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink">
              Akses Control Plane SaaS
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-sub">
              Kelola seluruh workspace room, batas kuota member, harga paket berlangganan, dan mode Payment Gateway (Sandbox / Live).
            </p>
          </div>

          <button
            type="button"
            disabled={busyAuth}
            onClick={handleGoogleOwnerSignIn}
            data-testid="owner-google-signin-btn"
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-surface2/60 px-4 text-xs font-bold text-ink hover:bg-surface2 transition-colors cursor-pointer"
          >
            <KeyRound size={15} className="text-brand" />
            <span>Masuk dengan Google Platform Owner</span>
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
            <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-sub">
              atau kredensial owner
            </span>
            <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
          </div>

          <form onSubmit={handlePasswordAuth} className="space-y-3.5">
            <label className="block text-xs font-semibold text-sub">
              Email Superpower Admin
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@asliworkspace.id"
                className="mt-1 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                data-testid="owner-email-input"
              />
            </label>

            <label className="block text-xs font-semibold text-sub">
              Passkey Console
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan passkey Superpower Admin"
                className="mt-1 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                data-testid="owner-password-input"
              />
            </label>

            <button
              type="submit"
              disabled={busyAuth}
              data-testid="owner-login-submit-btn"
              className="h-11 w-full rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-hover transition-colors duration-100 ease-out disabled:opacity-60 cursor-pointer"
            >
              {busyAuth ? "Memverifikasi..." : "Masuk ke Control Plane"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const kpis = data?.kpis || {
    total_rooms: 1,
    active_rooms: 1,
    suspended_rooms: 0,
    total_users: 0,
    online_users: 0,
    pending_approvals: 0,
    total_revenue: 0,
    paid_tx_count: 0,
    total_tx_count: 0,
    storage_kb: 0,
    req_24h: 0,
    snapshot_count: 0,
  };
  const rooms = data?.rooms || [];
  const realtimeSeries = data?.realtime_series || [];
  const hourlySeries = data?.hourly_series || [];
  const transactions = data?.transactions || [];
  const governance = data?.governance || {};
  const snapshots = data?.snapshots || [];
  const ownerDisplayName = ownerUser?.name?.split(" ")?.[0] || "Owner";
  const indoDate = format(new Date(), "EEEE, d MMMM yyyy", { locale: localeId });
  const sidebarTabOptions = useMemo(
    () => SIDEBAR_TABS.map((t) => ({ value: t.id, label: t.label })),
    []
  );
  const roomPlanOptions = useMemo(
    () =>
      (data?.plans || []).map((p) => ({
        value: p.id,
        label: `${p.name} (${p.max_members} m)`,
      })),
    [data?.plans]
  );

  return (
    <div
      className="fixed inset-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] overflow-hidden overscroll-none bg-background text-ink font-sans tabular-nums"
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }}
      data-testid="platform-owner-console"
    >
      {/* Left Fixed White Sidebar (follows screen height, never scrolls) */}
      <aside
        data-testid="owner-fixed-sidebar"
        className="hidden md:flex fixed inset-y-0 left-0 z-30 w-[256px] h-[100dvh] max-h-[100dvh] shrink-0 flex-col justify-between overflow-hidden overscroll-none border-r border-slate-200/80 dark:border-slate-800 bg-surface p-4 select-none"
      >
        <div className="space-y-4 min-h-0">
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand shrink-0">
              <Layers size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-tight text-ink">ASLIWORKSPACE</p>
              <p className="truncate text-[11px] font-medium text-sub">Control Plane · Owner</p>
            </div>
          </div>

          <nav className="space-y-1">
            {SIDEBAR_TABS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTabChange(item.id)}
                  data-testid={`owner-nav-${item.id}`}
                  className={`flex w-full items-center gap-3 rounded-2xl border border-transparent px-3.5 py-2 text-left text-xs font-bold transition-colors duration-75 ease-out cursor-pointer ${
                    isActive
                      ? "bg-brand text-white"
                      : "text-sub hover:bg-surface2 hover:text-ink"
                  }`}
                >
                  <Icon size={16} className={`shrink-0 ${isActive ? "text-white" : ""}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Owner Info */}
        <div className="space-y-2 border-t border-slate-200/80 dark:border-slate-800 pt-3 shrink-0">
          <button
            type="button"
            onClick={() => handleTabChange("account")}
            className={`w-full rounded-2xl border px-3 py-2 text-left transition-colors duration-75 ease-out cursor-pointer ${
              activeTab === "account"
                ? "border-brand/30 bg-brand/5"
                : "border-transparent bg-surface2/70 hover:bg-surface2"
            }`}
            title="Buka Pengaturan Akun Owner"
          >
            <p className="truncate text-[10px] font-bold uppercase tracking-wider text-sub">
              {ownerUser?.name || "Akun Platform Owner"}
            </p>
            <p className="mt-0.5 truncate text-xs font-bold text-ink">
              {ownerUser?.email || "owner@asliworkspace.id"}
            </p>
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-surface px-2.5 text-xs font-semibold text-sub hover:bg-surface2 hover:text-ink transition-colors duration-75 ease-out cursor-pointer"
            >
              <ArrowLeft size={13} /> Workspace
            </button>
            <button
              type="button"
              onClick={handleOwnerLogout}
              data-testid="owner-logout-btn"
              className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors duration-75 ease-out cursor-pointer"
            >
              <LogOut size={13} /> Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content with Dashboard-style dotted backdrop & independent vertical scroll */}
      <div
        className="relative flex h-full max-h-full min-w-0 flex-1 flex-col overflow-hidden md:ml-[256px]"
        style={{
          backgroundImage: "radial-gradient(rgba(148,163,184,0.32) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <main
          ref={mainScrollRef}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-y-contain"
        >
          <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8">
          {/* Dashboard-Style Hero Header */}
          <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between" data-testid="owner-hero-header">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-sub" data-testid="owner-hero-date">
                {indoDate}
              </p>
              <h1 className="mt-0.5 text-2xl sm:text-4xl font-extrabold tracking-tight text-ink leading-[1.3] pb-0.5 break-words">
                {getIndoGreeting()}, {ownerDisplayName} 👋
              </h1>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
              {/* Mobile quick tab selector (Unified AppSelect) */}
              <div className="col-span-2 flex md:hidden">
                <AppSelect
                  value={activeTab}
                  onValueChange={handleTabChange}
                  options={sidebarTabOptions}
                  placeholder="Pilih Menu"
                  data-testid="owner-mobile-tab-select"
                  className="h-10 w-full rounded-full border-slate-200 dark:border-slate-700 bg-surface px-4 text-xs font-bold text-ink shadow-xs hover:bg-surface2"
                />
              </div>

              <button
                type="button"
                disabled={busyAction === "backup_all"}
                onClick={handleBackupAll}
                data-testid="owner-backup-all-btn"
                className="inline-flex h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-brand px-4 sm:px-5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-brand-hover transition-colors duration-100 ease-out disabled:opacity-60 cursor-pointer"
              >
                <ArchiveRestore size={15} className="shrink-0" />
                <span className="truncate">{busyAction === "backup_all" ? "Membackup..." : "Backup Semua Room"}</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => loadDashboard()}
                data-testid="owner-refresh-btn"
                className="inline-flex h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-surface px-4 text-xs sm:text-sm font-bold text-ink shadow-xs hover:bg-surface2 hover:border-slate-300 dark:hover:border-slate-600 transition-colors duration-100 ease-out cursor-pointer"
              >
                <RefreshCw size={14} className={`shrink-0 ${loading ? "animate-spin" : ""}`} />
                <span className="truncate">Refresh Data</span>
              </button>
            </div>
          </div>
          {/* Top 4 KPI Cards (Matches Image 5) */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-sub">Total Workspace Rooms</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-brand dark:bg-rose-950/40">
                  <Layers size={15} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-extrabold text-ink font-sans tabular-nums">
                {kpis.total_rooms}
              </p>
              <p className="mt-1 text-xs text-sub font-sans tabular-nums">
                <span className="font-bold text-emerald-600">{kpis.active_rooms} aktif</span> ·{" "}
                {kpis.suspended_rooms} suspended
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-sub">Pengguna Lintas Room</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                  <Users size={15} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-extrabold text-ink font-sans tabular-nums">
                {kpis.total_users}
              </p>
              <p className="mt-1 text-xs text-sub font-sans tabular-nums">
                {kpis.online_users} online · {kpis.pending_approvals} menunggu approval
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-sub">Pendapatan Langganan</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <Wallet size={15} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-extrabold text-ink font-sans tabular-nums">
                {formatIdr(kpis.total_revenue)}
              </p>
              <p className="mt-1 text-xs text-sub font-sans tabular-nums">
                {kpis.paid_tx_count} transaksi lunas · {kpis.total_tx_count} total
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-sub">Trafik & Penyimpanan</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40">
                  <HardDrive size={15} />
                </span>
              </div>
              <p className="mt-3 text-2xl font-extrabold text-ink font-sans tabular-nums">
                {Number(kpis.storage_kb || 0).toFixed(1)} KB
              </p>
              <p className="mt-1 text-xs text-sub font-sans tabular-nums">
                {kpis.req_24h} req 24j · {kpis.snapshot_count} snapshot
              </p>
            </div>
          </div>

          {/* TAB 1: Overview & Rooms */}
          {activeTab === "rooms" && (
            <div className="space-y-6">
              <RealtimeAnalyticsCard
                realtimeSeries={realtimeSeries}
                hourlySeries={hourlySeries}
                rooms={rooms}
                lastUpdatedAt={lastUpdatedAt}
                chartRange={chartRange}
                onChangeRange={setChartRange}
                compact
              />

              <section
                className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-4"
                data-testid="owner-rooms-section"
              >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-ink">Daftar Workspace Rooms Terisolasi</h2>
                  <p className="text-xs text-sub">
                    Setiap room berjalan dengan route /w/&lt;slug&gt;, database mandiri, kode undangan, dan kuota paket tersendiri.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {rooms.map((room) => (
                  <div
                    key={room.slug}
                    data-testid={`owner-room-row-${room.slug}`}
                    className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-ink">{room.name}</span>
                        <span className="rounded-full border bg-surface px-2.5 py-0.5 text-[11px] font-bold text-sub">
                          /w/{room.slug}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            room.status === "active"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {room.status === "active" ? "Aktif" : "Suspended"}
                        </span>
                        {room.custom_domain && (
                          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700">
                            {room.custom_domain}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-sub font-sans tabular-nums">
                        <span>Owner: <b className="text-ink">{room.owner_email}</b></span>
                        <span>·</span>
                        <span>
                          Anggota: <b className="text-ink">{room.active_members} / {room.max_members}</b>
                        </span>
                        <span>·</span>
                        <span>Storage: <b className="text-ink">{room.storage_kb} KB</b></span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          Kode: <b className="text-brand">{room.invite_code}</b>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(room.invite_code);
                              toast.success("Kode undangan disalin.");
                            }}
                            className="text-sub hover:text-ink cursor-pointer"
                            title="Salin kode undangan"
                          >
                            <Copy size={11} />
                          </button>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <AppSelect
                        value={room.plan_id}
                        disabled={busyAction === `room_${room.slug}`}
                        onValueChange={(val) => handleUpdateRoom(room.slug, { plan_id: val })}
                        options={roomPlanOptions}
                        placeholder="Pilih Paket"
                        data-testid={`owner-room-plan-${room.slug}`}
                        className="h-9 min-w-[178px] rounded-full border-slate-200 dark:border-slate-700 bg-surface px-3.5 text-xs font-bold text-ink shadow-2xs hover:bg-surface2"
                      />

                      {room.slug !== "asli-workspace" && (
                        <button
                          type="button"
                          disabled={busyAction === `room_${room.slug}`}
                          onClick={() =>
                            handleUpdateRoom(room.slug, {
                              status: room.status === "active" ? "suspended" : "active",
                            })
                          }
                          className={`h-9 rounded-full border px-3 text-xs font-bold transition-colors duration-100 ease-out cursor-pointer ${
                            room.status === "active"
                              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          }`}
                        >
                          {room.status === "active" ? "Suspend" : "Aktifkan"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleExportRoom(room.slug)}
                        disabled={busyAction === `export_${room.slug}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface2 transition-colors duration-100 ease-out cursor-pointer"
                      >
                        <Download size={13} /> JSON
                      </button>

                      <Link
                        to={`/w/${room.slug}/login`}
                        className="inline-flex h-9 items-center gap-1 rounded-full bg-ink px-3.5 text-xs font-bold text-surface hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors duration-100 ease-out"
                      >
                        Buka <ExternalLink size={12} />
                      </Link>

                      {room.slug !== "asli-workspace" && (
                        <button
                          type="button"
                          disabled={busyAction === `delete_${room.slug}`}
                          onClick={() => handleDeleteRoom(room.slug)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors duration-100 ease-out cursor-pointer"
                          title="Hapus Room Permanen"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              </section>
            </div>
          )}

          {/* TAB 2: Paket & Harga SaaS */}
          {activeTab === "plans" && (
            <section
              className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5"
              data-testid="owner-plans-section"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-extrabold text-ink">Manajemen Paket & Harga Langganan SaaS</h2>
                  <p className="text-xs text-sub">
                    Perubahan harga, batas kuota member, dan fitur langsung disinkronkan ke tab "Langganan & Kuota" setiap room.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyAction === "save_plans"}
                  onClick={handleSavePlans}
                  data-testid="owner-save-plans-btn"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-xs font-bold text-white shadow-sm hover:bg-brand-hover transition-colors duration-100 ease-out cursor-pointer"
                >
                  <Check size={14} />
                  <span>{busyAction === "save_plans" ? "Menyimpan..." : "Simpan Semua Paket"}</span>
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {plansDraft.map((plan, idx) => (
                  <div
                    key={plan.id}
                    className={`rounded-3xl border p-5 space-y-3 ${
                      plan.highlight ? "border-brand bg-brand/[0.02]" : "border-slate-200 dark:border-slate-800 bg-surface2/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-surface2 px-2.5 py-0.5 text-[10px] font-bold text-sub">
                        ID: {plan.id}
                      </span>
                      <div className="flex items-center gap-3 text-xs font-semibold">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <span>Highlight</span>
                          <Switch
                            checked={Boolean(plan.highlight)}
                            onCheckedChange={(v) =>
                              setPlansDraft((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, highlight: v } : p))
                              )
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <span>Aktif</span>
                          <Switch
                            checked={plan.is_active !== false}
                            onCheckedChange={(v) =>
                              setPlansDraft((prev) =>
                                prev.map((p, i) => (i === idx ? { ...p, is_active: v } : p))
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-sub">
                        Nama Paket
                        <input
                          value={plan.name || ""}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs font-bold text-ink"
                        />
                      </label>
                      <label className="text-xs font-semibold text-sub">
                        Badge Label
                        <input
                          value={plan.badge || ""}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, badge: e.target.value } : p))
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs text-ink"
                        />
                      </label>
                      <label className="text-xs font-semibold text-sub">
                        Harga Bulanan (IDR)
                        <input
                          type="number"
                          min={0}
                          value={plan.monthly_price ?? 0}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, monthly_price: Number(e.target.value || 0) } : p
                              )
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs font-bold text-ink font-sans tabular-nums"
                        />
                      </label>
                      <label className="text-xs font-semibold text-sub">
                        Harga Tahunan (IDR)
                        <input
                          type="number"
                          min={0}
                          value={plan.annual_price ?? 0}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, annual_price: Number(e.target.value || 0) } : p
                              )
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs font-bold text-ink font-sans tabular-nums"
                        />
                      </label>
                      <label className="text-xs font-semibold text-sub">
                        Maksimal Anggota Aktif
                        <input
                          type="number"
                          min={1}
                          value={plan.max_members ?? 5}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, max_members: Number(e.target.value || 1) } : p
                              )
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs font-bold text-ink font-sans tabular-nums"
                        />
                      </label>
                      <label className="text-xs font-semibold text-sub">
                        Kuota Storage (MB)
                        <input
                          type="number"
                          min={64}
                          value={plan.storage_mb ?? 512}
                          onChange={(e) =>
                            setPlansDraft((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, storage_mb: Number(e.target.value || 64) } : p
                              )
                            )
                          }
                          className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs font-bold text-ink font-sans tabular-nums"
                        />
                      </label>
                    </div>

                    <label className="block text-xs font-semibold text-sub">
                      Deskripsi Singkat
                      <input
                        value={plan.description || ""}
                        onChange={(e) =>
                          setPlansDraft((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p))
                          )
                        }
                        className="mt-1 h-9 w-full rounded-full border border-border bg-surface px-3 text-xs text-ink"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-sub">
                      Daftar Fitur (1 baris = 1 poin)
                      <textarea
                        rows={4}
                        value={(plan.features || []).join("\n")}
                        onChange={(e) =>
                          setPlansDraft((prev) =>
                            prev.map((p, i) =>
                              i === idx
                                ? { ...p, features: e.target.value.split("\n") }
                                : p
                            )
                          )
                        }
                        className="mt-1 w-full rounded-2xl border border-border bg-surface p-3 text-xs text-ink resize-none"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TAB 3: Payment Gateway & Transaksi */}
          {activeTab === "gateway" && (
            <div className="space-y-6" data-testid="owner-gateway-section">
              <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-extrabold text-ink">
                      Switch Mode Payment Gateway (Sandbox Lokal vs Live Production)
                    </h2>
                    <p className="text-xs text-sub">
                      Beralih instan antara simulasi pembayaran lokal atau payment gateway produksi Midtrans Snap / Xendit Invoice.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction === "save_gateway"}
                    onClick={() => handleSaveGateway()}
                    data-testid="owner-save-gateway-btn"
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-xs font-bold text-white shadow-sm hover:bg-brand-hover transition-colors duration-100 ease-out cursor-pointer"
                  >
                    <Check size={14} />
                    <span>Simpan Pengaturan Gateway</span>
                  </button>
                </div>

                {/* Mode Cards */}
                <div className="grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...gatewayDraft, mode: "sandbox" };
                      setGatewayDraft(next);
                      handleSaveGateway(next);
                    }}
                    data-testid="gateway-mode-sandbox-btn"
                    className={`rounded-3xl border p-5 text-left transition-colors duration-100 ease-out cursor-pointer ${
                      gatewayDraft.mode === "sandbox"
                        ? "border-brand bg-brand/[0.04]"
                        : "border-slate-200 dark:border-slate-800 hover:bg-surface2/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-extrabold text-ink">Mode Sandbox Lokal</span>
                      {gatewayDraft.mode === "sandbox" && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          Aktif Saat Ini
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-sub leading-relaxed">
                      Menyediakan simulasi QRIS Dinamis, Virtual Account (BCA, Mandiri, BNI, BRI), dan E-Wallet dengan konfirmasi pelunasan instan untuk demo atau uji coba.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...gatewayDraft, mode: "live" };
                      setGatewayDraft(next);
                      handleSaveGateway(next);
                    }}
                    data-testid="gateway-mode-live-btn"
                    className={`rounded-3xl border p-5 text-left transition-colors duration-100 ease-out cursor-pointer ${
                      gatewayDraft.mode === "live"
                        ? "border-brand bg-brand/[0.04]"
                        : "border-slate-200 dark:border-slate-800 hover:bg-surface2/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-extrabold text-ink">Mode Live Gateway (Production)</span>
                      {gatewayDraft.mode === "live" && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          Aktif Saat Ini
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-sub leading-relaxed">
                      Membuat link transaksi nyata melalui Midtrans Snap atau Xendit Invoice dengan verifikasi webhook otomatis dari server.
                    </p>
                  </button>
                </div>

                {/* Live Provider + Server Env Status (Read-only badges, zero secret inputs) */}
                <div className="grid gap-4 md:grid-cols-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4">
                  <div className="space-y-2.5">
                    <p className="text-xs font-extrabold text-ink">Penyedia Live Gateway</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: "midtrans", label: "Midtrans Snap" },
                        { id: "xendit", label: "Xendit Invoice" },
                      ].map((prov) => (
                        <button
                          key={prov.id}
                          type="button"
                          onClick={() =>
                            setGatewayDraft((prev) => ({ ...prev, live_provider: prov.id }))
                          }
                          className={`h-9 rounded-full border px-4 text-xs font-bold cursor-pointer ${
                            gatewayDraft.live_provider === prov.id
                              ? "border-brand bg-brand text-white"
                              : "bg-surface text-ink"
                          }`}
                        >
                          {prov.label}
                        </button>
                      ))}
                    </div>
                    {gatewayDraft.live_provider === "midtrans" && (
                      <label className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2 text-xs font-semibold">
                        <span>Gunakan Endpoint Midtrans Production (app.midtrans.com)</span>
                        <Switch
                          checked={gatewayDraft.midtrans_is_production}
                          onCheckedChange={(v) =>
                            setGatewayDraft((prev) => ({ ...prev, midtrans_is_production: v }))
                          }
                        />
                      </label>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                      <Lock size={13} className="text-emerald-600" />
                      Status Kesiapan Environment Server
                    </p>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2">
                        <span className="font-semibold">Midtrans Server & Client Key</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            data?.gateway?.env_ready?.midtrans
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {data?.gateway?.env_ready?.midtrans ? "Terpasang di Server" : "Belum Diset di Env"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border bg-surface px-3 py-2">
                        <span className="font-semibold">Xendit Secret Key</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            data?.gateway?.env_ready?.xendit
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {data?.gateway?.env_ready?.xendit ? "Terpasang di Server" : "Belum Diset di Env"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Enabled Sandbox Channels */}
                <div>
                  <p className="mb-2 text-xs font-extrabold text-ink">Kanal Pembayaran Lokal Aktif</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_PAYMENT_CHANNELS.map((ch) => {
                      const active = gatewayDraft.enabled_channels.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() =>
                            setGatewayDraft((prev) => ({
                              ...prev,
                              enabled_channels: active
                                ? prev.enabled_channels.filter((x) => x !== ch.id)
                                : [...prev.enabled_channels, ch.id],
                            }))
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold cursor-pointer ${
                            active
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "bg-surface text-sub"
                          }`}
                        >
                          {active && <CheckCircle2 size={12} />}
                          <span>{ch.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Global Transaction Ledger */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-4">
                <h3 className="text-sm font-extrabold text-ink">Riwayat Transaksi Lintas Room</h3>
                {transactions.length === 0 ? (
                  <p className="py-6 text-center text-xs text-sub">
                    Belum ada transaksi langganan yang tercatat.
                  </p>
                ) : (
                  <div className="divide-y">
                    {transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-ink">{tx.invoice_no}</span>
                            <span className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-bold text-sub">
                              /w/{tx.room_slug}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                tx.status === "paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {tx.status === "paid" ? "Lunas" : "Menunggu"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-sub">
                            {tx.plan_name} ({tx.billing_cycle}) · {tx.method?.toUpperCase()} · {tx.payer_email}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-extrabold text-ink font-sans tabular-nums">
                            {formatIdr(tx.amount)}
                          </span>
                          {tx.status !== "paid" && (
                            <button
                              type="button"
                              disabled={busyAction === `tx_${tx.id}`}
                              onClick={() => handleMarkTxPaid(tx.id)}
                              className="h-8 rounded-full bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              Tandai Lunas
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 4: Trafik & Telemetri */}
          {activeTab === "telemetry" && (
            <div className="space-y-6">
              <RealtimeAnalyticsCard
                realtimeSeries={realtimeSeries}
                hourlySeries={hourlySeries}
                rooms={rooms}
                lastUpdatedAt={lastUpdatedAt}
                chartRange={chartRange}
                onChangeRange={setChartRange}
              />

              <section
                className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-4"
                data-testid="owner-telemetry-section"
              >
                <div>
                  <h2 className="text-base font-extrabold text-ink">Trafik Request, Penyimpanan & Pengguna per Room</h2>
                  <p className="text-xs text-sub">
                    Pantau beban trafik API, error 4xx/5xx, dan pemakaian database terisolasi setiap workspace room.
                  </p>
                </div>
                <div className="divide-y">
                  {rooms.map((r) => (
                    <div key={r.slug} className="grid gap-3 py-3.5 sm:grid-cols-5 sm:items-center text-xs">
                      <div className="sm:col-span-2">
                        <p className="font-extrabold text-ink">{r.name}</p>
                        <p className="text-sub">/w/{r.slug}</p>
                      </div>
                      <div>
                        <p className="text-sub">Request 24 Jam</p>
                        <p className="font-extrabold text-ink font-sans tabular-nums">
                          {r.telemetry?.req_24h || 0} req
                        </p>
                      </div>
                      <div>
                        <p className="text-sub">Error 4xx / 5xx</p>
                        <p className="font-extrabold text-ink font-sans tabular-nums">
                          {r.telemetry?.errors_4xx || 0} / {r.telemetry?.errors_5xx || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-sub">Database Size</p>
                        <p className="font-extrabold text-ink font-sans tabular-nums">
                          {r.storage_kb} KB ({r.tasks_count} tugas)
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* TAB 5: Backup & Recovery */}
          {activeTab === "backup" && (
            <section
              className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5"
              data-testid="owner-backup-section"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-extrabold text-ink">Snapshot & Recovery Multi-Room</h2>
                  <p className="text-xs text-sub">
                    Buat cadangan penuh seluruh workspace atau ekspor JSON masing-masing room kapan saja.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyAction === "backup_all"}
                  onClick={handleBackupAll}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-xs font-bold text-white hover:bg-brand-hover transition-colors duration-100 ease-out cursor-pointer"
                >
                  <ArchiveRestore size={14} />
                  <span>Buat Snapshot Sekarang</span>
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {rooms.map((r) => (
                  <div
                    key={r.slug}
                    className="flex items-center justify-between gap-3 rounded-2xl border bg-surface2/40 p-3.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-ink">{r.name}</p>
                      <p className="text-sub font-sans tabular-nums">
                        /w/{r.slug} · {r.storage_kb} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExportRoom(r.slug)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-surface px-3 font-bold text-ink hover:bg-surface2 cursor-pointer"
                    >
                      <Download size={13} /> Unduh JSON
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-sub">
                  Riwayat Snapshot Platform ({snapshots.length})
                </h3>
                {snapshots.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-5 text-center text-xs text-sub">
                    Belum ada snapshot penuh. Klik "Backup Semua Room" di kanan atas untuk membuat snapshot pertama.
                  </p>
                ) : (
                  <div className="divide-y rounded-2xl border">
                    {snapshots.map((snap) => (
                      <div key={snap.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                        <div>
                          <p className="font-bold text-ink">{snap.note || snap.id}</p>
                          <p className="text-sub">
                            Oleh {snap.created_by} · {new Date(snap.created_at).toLocaleString("id-ID")}
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 font-sans tabular-nums">
                          {snap.rooms_count} room · {snap.total_size_kb} KB
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* TAB 6: Tata Kelola SaaS (Matches Image 5) */}
          {activeTab === "governance" && (
            <section
              className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5"
              data-testid="owner-governance-section"
            >
              <div>
                <h2 className="text-base font-extrabold text-ink">
                  Arsitektur & Tata Kelola SaaS Multi-Room ASLIWORKSPACE
                </h2>
                <p className="mt-1 text-xs text-sub">
                  Ringkasan kapabilitas monetisasi, batas kuota gratis 5 anggota, integrasi domain, serta keamanan platform saat menjual ASLIWORKSPACE sebagai layanan SaaS.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {GOVERNANCE_CARDS.map((card) => {
                  const enabled = governance[card.key] !== false;
                  return (
                    <div
                      key={card.key}
                      className="flex flex-col justify-between rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface p-4 sm:p-5 space-y-3"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-sub">
                            Prioritas: {card.priority}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                                enabled ? "text-emerald-600" : "text-sub"
                              }`}
                            >
                              <CheckCircle2 size={12} />
                              {enabled ? card.statusOn : card.statusOff}
                            </span>
                            <Switch
                              checked={enabled}
                              disabled={busyAction === `gov_${card.key}`}
                              onCheckedChange={(v) => handleToggleGovernance(card.key, v)}
                            />
                          </div>
                        </div>
                        <h3 className="text-sm font-extrabold text-ink">{card.title}</h3>
                        <p className="text-xs leading-relaxed text-sub">{card.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {/* TAB 7: Pengaturan Akun Owner */}
          {activeTab === "account" && (
            <div className="space-y-6" data-testid="owner-account-section">
              {/* One-time generated passkey banner if just reset */}
              {generatedPasskey && (
                <div
                  className="rounded-3xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-5 shadow-2xs space-y-3"
                  data-testid="owner-generated-passkey-banner"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
                      <KeyRound size={18} />
                      <h3 className="text-sm font-extrabold">Passkey Baru Berhasil Dibuat</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGeneratedPasskey("")}
                      className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Tutup
                    </button>
                  </div>
                  <p className="text-xs text-emerald-800/90 dark:text-emerald-200/90">
                    Salin dan simpan passkey baru di bawah ini sekarang. Demi keamanan, passkey hanya ditampilkan satu kali dan tidak tersimpan dalam teks biasa di server.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[200px] rounded-2xl border border-emerald-200 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-extrabold tracking-wide text-ink select-all">
                      {generatedPasskey}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(generatedPasskey);
                        toast.success("Passkey disalin ke clipboard.");
                      }}
                      className="inline-flex h-10 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                    >
                      <Copy size={14} /> Salin Passkey
                    </button>
                  </div>
                </div>
              )}

              {/* Profil & Identitas Akun */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-brand dark:bg-rose-950/40">
                      <UserCog size={18} />
                    </span>
                    <div>
                      <h2 className="text-base font-extrabold text-ink">Profil & Identitas Owner</h2>
                      <p className="text-xs text-sub">
                        Ubah nama tampilan konsol, jabatan, dan kontak darurat Platform Owner.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSaveAccountProfile} className="space-y-3.5">
                    <label className="block text-xs font-semibold text-sub">
                      Email Akun Platform Owner (Utama)
                      <input
                        type="email"
                        readOnly
                        value={ownerUser?.email || ""}
                        className="mt-1 h-10 w-full rounded-full border border-border bg-surface2/60 px-4 text-xs font-bold text-sub cursor-not-allowed"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-sub">
                      Nama Lengkap *
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="Contoh: Saeful Rohman"
                        data-testid="owner-account-name-input"
                        className="mt-1 h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-bold text-ink focus:border-brand"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-semibold text-sub">
                        Jabatan / Label Peran
                        <input
                          type="text"
                          value={accountJobTitle}
                          onChange={(e) => setAccountJobTitle(e.target.value)}
                          placeholder="Superpower Platform Owner"
                          data-testid="owner-account-job-input"
                          className="mt-1 h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink focus:border-brand"
                        />
                      </label>

                      <label className="block text-xs font-semibold text-sub">
                        No. Telepon / WhatsApp Darurat
                        <input
                          type="tel"
                          value={accountPhone}
                          onChange={(e) => setAccountPhone(e.target.value)}
                          placeholder="08xxxxxxxxxx"
                          data-testid="owner-account-phone-input"
                          className="mt-1 h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink font-sans tabular-nums focus:border-brand"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-3 text-[11px]">
                      <div>
                        <p className="text-sub font-medium">Login Terakhir</p>
                        <p className="mt-0.5 font-bold text-ink">
                          {ownerUser?.last_login_at
                            ? new Date(ownerUser.last_login_at).toLocaleString("id-ID")
                            : "Sesi aktif saat ini"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sub font-medium">Versi Sesi & Keamanan</p>
                        <p className="mt-0.5 font-bold text-ink">
                          Sesi v{ownerUser?.token_version || 1} · {ownerUser?.has_password ? "Passkey Aktif" : "Google Auth"}
                        </p>
                      </div>
                    </div>

                    <div className="pt-1 flex justify-end">
                      <button
                        type="submit"
                        disabled={busyAction === "save_profile"}
                        data-testid="owner-save-profile-btn"
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-xs font-bold text-white shadow-sm hover:bg-brand-hover transition-colors duration-100 ease-out disabled:opacity-60 cursor-pointer"
                      >
                        <Check size={14} />
                        <span>{busyAction === "save_profile" ? "Menyimpan..." : "Simpan Profil Akun"}</span>
                      </button>
                    </div>
                  </form>
                </section>

                {/* Keamanan Sandi & Passkey */}
                <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40">
                      <Lock size={18} />
                    </span>
                    <div>
                      <h2 className="text-base font-extrabold text-ink">Keamanan Sandi & Passkey Console</h2>
                      <p className="text-xs text-sub">
                        {ownerUser?.has_password
                          ? "Perbarui passkey login Console secara berkala demi keamanan penuh."
                          : "Akun Google ini belum memiliki passkey lokal. Buat passkey cadangan untuk akses cepat."}
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleChangeOwnerPassword} className="space-y-3.5">
                    {ownerUser?.has_password && (
                      <label className="block text-xs font-semibold text-sub">
                        Passkey / Kata Sandi Saat Ini *
                        <div className="relative mt-1">
                          <input
                            type={showCurrentPass ? "text" : "password"}
                            required
                            value={currentPass}
                            onChange={(e) => setCurrentPass(e.target.value)}
                            placeholder="Masukkan passkey saat ini"
                            data-testid="owner-current-pass-input"
                            className="h-10 w-full rounded-full border border-border bg-surface pl-4 pr-10 text-xs font-semibold text-ink focus:border-brand"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCurrentPass((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-sub hover:text-ink cursor-pointer"
                            aria-label="Tampilkan sandi saat ini"
                          >
                            {showCurrentPass ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </label>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-sub">
                        Passkey Baru (Min. 8 Karakter) *
                        <div className="relative mt-1">
                          <input
                            type={showNewPass ? "text" : "password"}
                            required
                            minLength={8}
                            value={newPass}
                            onChange={(e) => setNewPass(e.target.value)}
                            placeholder="Kombinasi huruf besar, angka & simbol"
                            data-testid="owner-new-pass-input"
                            className="h-10 w-full rounded-full border border-border bg-surface pl-4 pr-10 text-xs font-semibold text-ink focus:border-brand"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPass((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-sub hover:text-ink cursor-pointer"
                            aria-label="Tampilkan sandi baru"
                          >
                            {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </label>
                      <PasswordStrengthMeter password={newPass} />
                    </div>

                    <label className="block text-xs font-semibold text-sub">
                      Konfirmasi Passkey Baru *
                      <input
                        type={showNewPass ? "text" : "password"}
                        required
                        minLength={8}
                        value={confirmPass}
                        onChange={(e) => setConfirmPass(e.target.value)}
                        placeholder="Ulangi passkey baru"
                        data-testid="owner-confirm-pass-input"
                        className="mt-1 h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink focus:border-brand"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 px-3.5 py-2.5 text-xs font-semibold cursor-pointer">
                      <span className="text-ink">Keluar otomatis dari semua perangkat lain setelah ganti sandi</span>
                      <Switch
                        checked={revokeOthersOnPassChange}
                        onCheckedChange={setRevokeOthersOnPassChange}
                      />
                    </label>

                    <div className="pt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-sub">
                        {ownerUser?.password_updated_at
                          ? `Terakhir diubah: ${new Date(ownerUser.password_updated_at).toLocaleDateString("id-ID")}`
                          : "Belum pernah diganti"}
                      </span>
                      <button
                        type="submit"
                        disabled={busyAction === "save_password"}
                        data-testid="owner-save-password-btn"
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-xs font-bold text-surface hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors duration-100 ease-out disabled:opacity-60 cursor-pointer"
                      >
                        <ShieldCheck size={14} />
                        <span>{busyAction === "save_password" ? "Memproses..." : "Perbarui Passkey"}</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>

              {/* Reset Keamanan, Sesi & Preferensi */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/40">
                    <RotateCcw size={18} />
                  </span>
                  <div>
                    <h2 className="text-base font-extrabold text-ink">Pusat Reset Akun, Sesi & Telemetri</h2>
                    <p className="text-xs text-sub">
                      Kelola reset passkey otomatis, pencabutan token sesi aktif, reset grafik telemetri, hingga pemulihan preferensi default konsol.
                    </p>
                  </div>
                </div>

                {confirmResetAction && (
                  <div
                    className="rounded-2xl border border-rose-200 bg-rose-50/80 dark:bg-rose-950/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    data-testid="owner-reset-confirm-box"
                  >
                    <div className="flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5 text-rose-600" />
                      <div>
                        <p className="font-extrabold">
                          {confirmResetAction === "passkey" && "Konfirmasi Reset Passkey Acak Baru"}
                          {confirmResetAction === "sessions" && "Konfirmasi Cabut Semua Sesi Aktif"}
                          {confirmResetAction === "telemetry" && "Konfirmasi Reset Grafik & Counter Telemetri"}
                          {confirmResetAction === "defaults" && "Konfirmasi Reset Profil & Kebijakan Tata Kelola"}
                        </p>
                        <p className="mt-0.5 opacity-90">
                          {confirmResetAction === "passkey" &&
                            "Passkey lama akan langsung tidak berlaku dan semua sesi perangkat lain akan dicabut."}
                          {confirmResetAction === "sessions" &&
                            "Semua token login Platform Owner di browser atau perangkat lain akan langsung dikeluarkan."}
                          {confirmResetAction === "telemetry" &&
                            "Counter request API dan grafik realtime akan direset ke 0 tanpa menghapus data workspace room."}
                          {confirmResetAction === "defaults" &&
                            "Nama tampilan, jabatan, nomor darurat, dan toggle tata kelola SaaS dikembalikan ke standar awal."}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmResetAction(null)}
                        className="h-9 rounded-full border border-slate-300 bg-surface px-4 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={handleConfirmResetAction}
                        data-testid="owner-confirm-reset-execute-btn"
                        className="h-9 rounded-full bg-rose-600 px-4 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
                      >
                        {busyAction ? "Memproses..." : "Ya, Jalankan"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                        <KeyRound size={14} className="text-brand" /> Reset Passkey Acak
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-sub">
                        Buat passkey acak baru yang kuat dan batalkan passkey sebelumnya secara instan.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmResetAction("passkey")}
                      data-testid="owner-trigger-reset-passkey"
                      className="h-9 w-full rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      Generate Passkey Baru
                    </button>
                  </div>

                  <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                        <Smartphone size={14} className="text-blue-600" /> Cabut Semua Sesi
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-sub">
                        Putuskan seluruh token sesi Platform Owner di perangkat lain (perbarui token sesi saat ini).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmResetAction("sessions")}
                      data-testid="owner-trigger-revoke-sessions"
                      className="h-9 w-full rounded-full border border-slate-200 bg-surface px-3 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                    >
                      Logout Perangkat Lain
                    </button>
                  </div>

                  <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                        <Activity size={14} className="text-amber-600" /> Reset Telemetri Trafik
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-sub">
                        Bersihkan metrik grafik realtime dan hitungan error 4xx/5xx sementara tanpa mengubah data room.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmResetAction("telemetry")}
                      data-testid="owner-trigger-reset-telemetry"
                      className="h-9 w-full rounded-full border border-slate-200 bg-surface px-3 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                    >
                      Reset Statistik Trafik
                    </button>
                  </div>

                  <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/40 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                        <RotateCcw size={14} className="text-emerald-600" /> Reset Pengaturan Awal
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-sub">
                        Kembalikan profil tampilan owner dan kebijakan tata kelola SaaS ke pengaturan standar bawaan.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmResetAction("defaults")}
                      data-testid="owner-trigger-reset-defaults"
                      className="h-9 w-full rounded-full border border-slate-200 bg-surface px-3 text-xs font-bold text-ink hover:bg-surface2 cursor-pointer"
                    >
                      Pulihkan Default Konsol
                    </button>
                  </div>
                </div>
              </section>

              {/* Manajemen Akun Superpower Admin / Google Owner */}
              <section className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-surface p-5 sm:p-6 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                      <Users size={18} />
                    </span>
                    <div>
                      <h2 className="text-base font-extrabold text-ink">Daftar Akses Superpower Admin Console</h2>
                      <p className="text-xs text-sub">
                        Kelola email akun Google yang berhak mengakses Platform Owner Console.
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleAddOwnerAccount} className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    type="email"
                    required
                    value={newOwnerEmail}
                    onChange={(e) => setNewOwnerEmail(e.target.value)}
                    placeholder="Email Google Owner baru (mis. ceo@perusahaan.com)"
                    data-testid="owner-add-email-input"
                    className="h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink focus:border-brand"
                  />
                  <input
                    type="text"
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    placeholder="Nama Lengkap (opsional)"
                    data-testid="owner-add-name-input"
                    className="h-10 w-full rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === "add_owner"}
                    data-testid="owner-add-submit-btn"
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-xs font-bold text-white hover:bg-brand-hover transition-colors duration-100 ease-out disabled:opacity-60 cursor-pointer"
                  >
                    <UserPlus size={14} /> Tambah Owner
                  </button>
                </form>

                <div className="divide-y rounded-2xl border border-slate-200/80 dark:border-slate-800">
                  {(data?.platform_owners || []).map((acc) => {
                    const isSelf = acc.email?.toLowerCase() === ownerUser?.email?.toLowerCase();
                    const isRoot = acc.email?.toLowerCase() === "owner@asliworkspace.id";
                    return (
                      <div
                        key={acc.email}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-extrabold text-ink">{acc.name}</span>
                            {isSelf && (
                              <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-bold text-brand">
                                Sedang Aktif
                              </span>
                            )}
                            {acc.has_password && (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                Passkey + Google
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-sub">
                            {acc.email} · {acc.job_title || "Superpower Platform Owner"}
                          </p>
                        </div>

                        {!isSelf && !isRoot && (
                          <button
                            type="button"
                            disabled={busyAction === `rm_owner_${acc.email}`}
                            onClick={() => handleRemoveOwnerAccount(acc.email)}
                            className="inline-flex h-8 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-rose-600 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 size={12} /> Cabut Akses
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
