import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  LogOut,
  Mail,
  MessageCircle,
  CheckSquare,
  Users,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, setAuthToken, setAuthUserId } from "../lib/api";
import { getActiveRoomSlug, isValidRoomSlug, roomStorageKey, getRecentGoogleAccounts, recordRecentGoogleAccount } from "../lib/roomContext";
import { Avatar } from "../components/common";
import { googleBasicSignIn, setManualGoogleAuth } from "../lib/auth";
import { getTranslation } from "../lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import CreateRoomModal from "../components/CreateRoomModal";
import { attemptAutoHydrateServer } from "../lib/persistentMirror";
import { firebaseAuth, subscribeFirebaseAuth } from "../lib/firestoreBackup";

const DEFAULT_LOGO = "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png";
const DEFAULT_LOGIN_IMG = "/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg";

function formatRelativeIndo(isoStr) {
  if (!isoStr) return "baru saja";
  const ts = new Date(isoStr).getTime();
  if (!Number.isFinite(ts)) return "baru saja";
  const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} hari lalu`;
}

function resolveRoomLogo(logoId) {
  if (!logoId || logoId === "default_workspace_logo") return DEFAULT_LOGO;
  return fileUrl(logoId);
}

function GoogleLogoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.3 0 6.08-1.09 8.105-2.96l-3.88-3.05c-1.09.73-2.49 1.16-4.225 1.16-3.25 0-6.005-2.19-6.985-5.14H1.01v3.14C3.035 21.17 7.19 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.015 14.01a7.17 7.17 0 0 1 0-4.02V6.85H1.01a11.99 11.99 0 0 0 0 10.3l4.005-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.85c1.8 0 3.415.62 4.685 1.835l3.515-3.515C18.075 1.19 15.295 0 12 0 7.19 0 3.035 2.83 1.01 6.85l4.005 3.14C5.995 7.04 8.75 4.85 12 4.85Z"
      />
    </svg>
  );
}

function Floating({ image, t }) {
  const src =
    image && image !== "default_login_bg" ? `/api/public/login-image/${image}` : DEFAULT_LOGIN_IMG;
  const heroCards = [
    [MessageCircle, t("auth_hero_card_1", "Pesan & Panggilan")],
    [CheckSquare, t("auth_hero_card_2", "Tugas & Proyek")],
    [Users, t("auth_hero_card_3", "Tim & Organisasi")],
  ];
  return (
    <div
      className="relative hidden lg:flex lg:h-full flex-1 overflow-hidden rounded-[32px] bg-[#20283B] p-10 text-white shrink-0"
      data-testid="login-hero"
    >
      <img
        src={src}
        alt="ASLIWORKSPACE Showcase"
        onError={(e) => {
          e.currentTarget.src = DEFAULT_LOGIN_IMG;
        }}
        className="absolute inset-0 h-full w-full object-cover"
        data-testid="login-hero-image"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#20283B]/90 via-[#20283B]/35 to-transparent" />
      <div className="relative z-10 flex w-full flex-col justify-between">
        <span
          className="inline-flex w-fit items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium backdrop-blur"
          data-testid="login-hero-badge"
        >
          <Sparkles size={14} />
          {t("auth_hero_badge", "Satu Workspace. Satu Lingkaran Kolaborasi.")}
        </span>
        <div>
          <h2 className="max-w-md text-5xl font-extrabold leading-[1.05] tracking-tight" data-testid="login-hero-title">
            {t("auth_hero_title", "Satukan Tim, Percepat Eksekusi.")}
          </h2>
          <p className="mt-4 max-w-md text-white/85" data-testid="login-hero-subtitle">
            {t(
              "auth_hero_subtitle",
              "Satu ruang kerja terpadu untuk komunikasi tim, manajemen tugas, dan kontrol operasional perusahaan."
            )}
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {heroCards.map(([I, label], i) => (
              <div
                key={i}
                className="animate-float rounded-3xl bg-white/95 p-4 text-[#20283B] shadow-xl"
                style={{ animationDelay: `${i * 0.8}s` }}
              >
                <I size={20} className="text-[#FF5364]" />
                <p className="mt-6 text-sm font-semibold">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login({ roomSlugOverride = null }) {
  const { session, ws, enterRoomSession, currentRoomSlug } = useApp();
  const { slug: paramSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const targetRoomSlug = isValidRoomSlug(roomSlugOverride || paramSlug)
    ? roomSlugOverride || paramSlug
    : null;
  const switchMode = searchParams.get("switch") === "1";

  const [brand, setBrand] = useState({});
  const effectiveCopy = {
    ...(ws?.custom_copywriting || {}),
    ...(brand?.custom_copywriting || {}),
  };
  const t = (key, fallback) => getTranslation(key, effectiveCopy, fallback);

  // 'signin' | 'rooms' | 'onboarding'
  const [step, setStep] = useState("signin");
  const [googleAccount, setGoogleAccount] = useState(null); // { email, name, picture, idToken, rooms, is_platform_owner }
  const [recentGoogleAccounts, setRecentGoogleAccounts] = useState(() => getRecentGoogleAccounts());
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [busyRecentEmail, setBusyRecentEmail] = useState("");
  const [enteringSlug, setEnteringSlug] = useState("");
  const [loginAlert, setLoginAlert] = useState(null);

  // Onboarding Profile State (mandatory for first-time room entry / join-by-code)
  const [onboardingCtx, setOnboardingCtx] = useState(null); // { flow, slug, roomName, inviteCode, divisions, autoApproveEligible }
  const [obName, setObName] = useState("");
  const [obDept, setObDept] = useState("");
  const [obTitle, setObTitle] = useState("");
  const [obPhone, setObPhone] = useState("");
  const [obWorkMode, setObWorkMode] = useState("On-site");
  const [obNote, setObNote] = useState("");
  const [busyOnboarding, setBusyOnboarding] = useState(false);

  // Modals
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [fallbackEmailModalOpen, setFallbackEmailModalOpen] = useState(false);
  const [fallbackEmail, setFallbackEmail] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  const [fallbackError, setFallbackError] = useState("");
  const [busyFallback, setBusyFallback] = useState(false);

  const initialInviteCode = String(searchParams.get("invite") || "").trim().toUpperCase();
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [busyJoinCode, setBusyJoinCode] = useState(false);

  // Detect any active Firebase Google user on mount/change and merge with recent accounts
  useEffect(() => {
    const syncFirebaseUser = (fbUser) => {
      if (fbUser?.email) {
        recordRecentGoogleAccount({
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email.split("@")[0],
          picture: fbUser.photoURL || "",
          last_room_slug: targetRoomSlug || getActiveRoomSlug(),
        });
      }
      setRecentGoogleAccounts(getRecentGoogleAccounts());
    };
    if (firebaseAuth?.currentUser) {
      syncFirebaseUser(firebaseAuth.currentUser);
    }
    const unsub = subscribeFirebaseAuth((fbUser) => {
      syncFirebaseUser(fbUser);
    });
    return () => unsub?.();
  }, [targetRoomSlug]);

  // Fetch target room public branding (or default room branding)
  useEffect(() => {
    let active = true;
    const url = targetRoomSlug
      ? `/saas/rooms/${encodeURIComponent(targetRoomSlug)}/public-branding`
      : "/public/branding";
    api
      .get(url)
      .then((r) => {
        if (active && r?.data) setBrand(r.data);
      })
      .catch(() => {
        if (targetRoomSlug && active) {
          api.get("/public/branding").then((r) => active && setBrand(r.data)).catch(() => {});
        }
      });

    attemptAutoHydrateServer(api)
      .then((restored) => {
        if (restored && active) {
          api
            .get(url)
            .then((r) => active && r?.data && setBrand(r.data))
            .catch(() => {});
        }
      })
      .catch(() => false);
    return () => {
      active = false;
    };
  }, [targetRoomSlug]);

  // Clear orphaned credentials when logged out cleanly
  useEffect(() => {
    if (!session?.user?.user_id && !switchMode) {
      try {
        const rid = targetRoomSlug || getActiveRoomSlug();
        const hasStoredSession = Boolean(
          sessionStorage.getItem(roomStorageKey("circle_tab_session_cache", rid)) ||
            localStorage.getItem(roomStorageKey("circle_session_cache", rid))
        );
        if (!hasStoredSession) {
          setAuthToken(null, rid);
          setAuthUserId(null, rid);
        }
      } catch {
        setAuthToken(null);
        setAuthUserId(null);
      }
    }
  }, [session?.user?.user_id, targetRoomSlug, switchMode]);

  // Redirect if already authenticated and NOT switching rooms
  if (session?.user?.user_id && !switchMode) {
    if (!targetRoomSlug || targetRoomSlug === currentRoomSlug) {
      return <Navigate to={`/w/${currentRoomSlug}`} replace />;
    }
  }

  const runGoogleLookup = async ({ email, name, picture, idToken = "" }) => {
    const cleanEmail = String(email || "").toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Masukkan alamat Email Google yang valid.");
      return;
    }
    setLoginAlert(null);
    await attemptAutoHydrateServer(api).catch(() => false);
    const { data } = await api.post("/saas/auth/google-lookup", {
      email: cleanEmail,
      name: String(name || "").trim(),
      picture: String(picture || "").trim(),
      idToken,
    });

    const resolvedAcc = {
      email: data.email || cleanEmail,
      name: data.name || name || cleanEmail.split("@")[0],
      picture: data.picture || picture || "",
      idToken: idToken || "",
      verified_oauth: Boolean(data.verified_oauth),
      rooms: Array.isArray(data.rooms) ? data.rooms : [],
      is_platform_owner: Boolean(data.is_platform_owner),
    };

    recordRecentGoogleAccount({
      email: resolvedAcc.email,
      name: resolvedAcc.name,
      picture: resolvedAcc.picture,
      last_room_slug: resolvedAcc.rooms?.[0]?.slug || targetRoomSlug || getActiveRoomSlug(),
    });
    setRecentGoogleAccounts(getRecentGoogleAccounts());

    // Enforce 1 akun Google = 1 workspace:
    // Kalo akun Google sudah punya room -> langsung masuk ke room tersebut.
    if (resolvedAcc.rooms.length > 0) {
      const boundRoom = resolvedAcc.rooms[0];
      if (targetRoomSlug && targetRoomSlug !== boundRoom.slug) {
        setLoginAlert({
          type: "error",
          message: `Akun ${resolvedAcc.email} sudah terdaftar di workspace "${boundRoom.name}". 1 akun Google hanya dapat masuk ke 1 workspace.`,
        });
        setGoogleAccount(resolvedAcc);
        setStep("rooms");
        return;
      }
      await handleEnterRoom(boundRoom.slug, resolvedAcc);
      return;
    }

    // Jika belum punya room sama sekali -> tampilkan opsi Masukan Undangan atau Buat Room Baru
    setGoogleAccount(resolvedAcc);
    setStep("rooms");
  };

  const handleRecentAccountClick = async (acc) => {
    if (!acc?.email) return;
    setBusyRecentEmail(acc.email);
    setLoginAlert(null);
    try {
      let liveToken = "";
      if (
        firebaseAuth?.currentUser?.email &&
        firebaseAuth.currentUser.email.toLowerCase().trim() === acc.email.toLowerCase().trim()
      ) {
        liveToken = (await firebaseAuth.currentUser.getIdToken().catch(() => "")) || "";
      }
      await runGoogleLookup({
        email: acc.email,
        name: acc.name,
        picture: acc.picture,
        idToken: liveToken,
      });
    } catch (err) {
      const message = errMsg(err, "Gagal memeriksa room akun Google.");
      setLoginAlert({ type: "error", message });
      toast.error(message);
    } finally {
      setBusyRecentEmail("");
    }
  };

  const handleGooglePopupSignIn = async () => {
    setBusyGoogle(true);
    setLoginAlert(null);
    try {
      const authRes = await googleBasicSignIn();
      const fbUser = authRes?.user || authRes;
      const email = String(authRes?.email || fbUser?.email || "").trim().toLowerCase();
      const name = String(authRes?.name || fbUser?.displayName || (email ? email.split("@")[0] : "")).trim();
      const picture = String(authRes?.picture || fbUser?.photoURL || "").trim();
      const idToken = authRes?.idToken || (await fbUser?.getIdToken?.().catch(() => "")) || "";
      if (!email) {
        throw new Error("Akun Google tidak mengembalikan alamat email.");
      }
      await runGoogleLookup({
        email,
        name,
        picture,
        idToken,
      });
    } catch (err) {
      const code = err?.code || "";
      const msg = String(err?.message || "").toLowerCase();
      if (
        code === "auth/popup-blocked" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/unauthorized-domain" ||
        msg.includes("403") ||
        msg.includes("popup") ||
        msg.includes("blocked")
      ) {
        toast.info("Popup Google dibatasi browser. Silakan lanjutkan dengan Email Google Anda.");
        setFallbackError("");
        setFallbackEmailModalOpen(true);
      } else {
        const message = errMsg(err, "Autentikasi Google gagal. Gunakan opsi masuk Email Google.");
        setLoginAlert({ type: "error", message });
        toast.error(message);
      }
    } finally {
      setBusyGoogle(false);
    }
  };

  const handleFallbackEmailSubmit = async (e) => {
    e.preventDefault();
    const clean = fallbackEmail.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      setFallbackError("Masukkan alamat Email Google yang valid.");
      toast.error("Masukkan alamat Email Google yang valid.");
      return;
    }
    setBusyFallback(true);
    setFallbackError("");
    try {
      setManualGoogleAuth({ email: clean, name: fallbackName.trim() || clean.split("@")[0], picture: "" });
      await runGoogleLookup({
        email: clean,
        name: fallbackName.trim() || clean.split("@")[0],
        picture: "",
        idToken: "",
      });
      setFallbackEmailModalOpen(false);
    } catch (err) {
      const msg = errMsg(err, "Gagal memverifikasi Email Google.");
      setFallbackError(msg);
      toast.error(msg);
    } finally {
      setBusyFallback(false);
    }
  };

  const beginRoomOnboarding = (data, acc, flowFallback, codeFallback = "") => {
    const divisions =
      Array.isArray(data?.room?.divisions) && data.room.divisions.length > 0
        ? data.room.divisions
        : ["Executive / Management", "Product & Tech", "Marketing", "Design", "Finance", "Operations", "General"];
    const gp = data?.google_profile || {};
    setGoogleAccount(acc);
    setOnboardingCtx({
      flow: data?.flow || flowFallback,
      slug: data?.room?.slug || "",
      roomName: data?.room?.brand_name || data?.room?.name || data?.room?.slug || "Workspace",
      inviteCode: data?.invite_code || codeFallback || "",
      divisions,
      autoApproveEligible: Boolean(data?.auto_approve_eligible),
      wasRemoved: Boolean(data?.was_removed),
    });
    setObName(gp.name || acc?.name || "");
    setObDept(gp.department && divisions.includes(gp.department) ? gp.department : "");
    setObTitle(gp.job_title || "");
    setObPhone(gp.phone || "");
    setObWorkMode(gp.work_mode || "On-site");
    setObNote(gp.bio || "");
    setLoginAlert(
      data?.was_removed
        ? {
            type: "quota",
            message:
              "Akun Anda sebelumnya telah dihapus dari workspace ini. Silakan lengkapi kembali data profil Anda untuk melanjutkan.",
          }
        : null
    );
    setStep("onboarding");
  };

  const handleEnterRoom = async (roomSlug, accOverride = null) => {
    const acc = accOverride || googleAccount;
    if (!acc?.email) {
      toast.error("Pilih akun Google terlebih dahulu.");
      return;
    }
    setEnteringSlug(roomSlug);
    setLoginAlert(null);
    try {
      const { data } = await api.post(`/saas/rooms/${encodeURIComponent(roomSlug)}/enter`, {
        email: acc.email,
        name: acc.name,
        picture: acc.picture,
        idToken: acc.idToken || "",
      });
      if (data?.status === "needs_onboarding") {
        beginRoomOnboarding(data, acc, "enter");
        return;
      }
      if (data?.status === "registered_pending") {
        setGoogleAccount(acc);
        setLoginAlert({ type: "quota", message: data.detail });
        setStep("rooms");
        return;
      }
      enterRoomSession(data.slug, data);
      toast.success(`Selamat datang di ${data.workspace?.name || roomSlug}!`);
      navigate(`/w/${data.slug}`, { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      const errStatus = err?.response?.data?.status;
      const detail = errMsg(err, "Gagal masuk ke workspace room.");
      setLoginAlert({
        type: status === 402 || errStatus === "pending" ? "quota" : "error",
        message: detail,
      });
      toast.error(detail);
      setGoogleAccount(acc);
      setStep("rooms");
    } finally {
      setEnteringSlug("");
    }
  };

  const handleJoinByCodeSubmit = async (e) => {
    e.preventDefault();
    const cleanCode = inviteCode.trim().toUpperCase();
    const cleanEmail = (googleAccount?.email || "").trim().toLowerCase();
    if (!cleanCode) return toast.error("Masukkan kode undangan room.");
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return toast.error("Masuk dengan akun Google terlebih dahulu.");
    }
    setBusyJoinCode(true);
    setLoginAlert(null);
    try {
      const { data } = await api.post("/saas/rooms/join-by-code", {
        invite_code: cleanCode,
        email: cleanEmail,
        name: googleAccount?.name || cleanEmail.split("@")[0],
        picture: googleAccount?.picture || "",
        idToken: googleAccount?.idToken || "",
      });
      if (data?.status === "needs_onboarding") {
        beginRoomOnboarding(data, googleAccount, "join_by_code", cleanCode);
        return;
      }
      if (data?.status === "registered_pending") {
        setLoginAlert({ type: "quota", message: data.detail });
        toast.info(data.detail);
        return;
      }
      enterRoomSession(data.slug, data);
      toast.success(`Berhasil bergabung ke room ${data.workspace?.name || data.slug}!`);
      navigate(`/w/${data.slug}`, { replace: true });
    } catch (err) {
      const errStatus = err?.response?.data?.status;
      const detail = errMsg(err, "Gagal bergabung dengan kode undangan.");
      setLoginAlert({ type: errStatus === "pending" ? "quota" : "error", message: detail });
      toast.error(detail);
    } finally {
      setBusyJoinCode(false);
    }
  };

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    if (!googleAccount?.email || !onboardingCtx) return;
    if (!obName.trim() || !obDept.trim() || !obTitle.trim() || !obPhone.trim()) {
      const msg = "Nama lengkap, divisi, jabatan/posisi, dan nomor WhatsApp wajib diisi.";
      setLoginAlert({ type: "error", message: msg });
      toast.error(msg);
      return;
    }
    setBusyOnboarding(true);
    setLoginAlert(null);
    try {
      const endpoint =
        onboardingCtx.flow === "join_by_code"
          ? "/saas/rooms/join-by-code"
          : `/saas/rooms/${encodeURIComponent(onboardingCtx.slug)}/enter`;
      const payload = {
        ...(onboardingCtx.flow === "join_by_code" ? { invite_code: onboardingCtx.inviteCode } : {}),
        email: googleAccount.email,
        name: obName.trim(),
        picture: googleAccount.picture || "",
        idToken: googleAccount.idToken || "",
        department: obDept.trim(),
        job_title: obTitle.trim(),
        phone: obPhone.trim(),
        work_mode: obWorkMode || "On-site",
        note: obNote.trim(),
        profile_submitted: true,
      };
      const { data } = await api.post(endpoint, payload);
      if (data?.status === "registered_pending") {
        setOnboardingCtx(null);
        setLoginAlert({ type: "quota", message: data.detail });
        setStep("rooms");
        toast.success("Data diri terkirim! Menunggu persetujuan Super Admin room.");
        return;
      }
      enterRoomSession(data.slug, data);
      toast.success(`Selamat datang di ${data.workspace?.name || onboardingCtx.roomName}!`);
      navigate(`/w/${data.slug}`, { replace: true });
    } catch (err) {
      const detail = errMsg(err, "Gagal menyimpan data profil anggota.");
      setLoginAlert({ type: err?.response?.status === 402 ? "quota" : "error", message: detail });
      toast.error(detail);
    } finally {
      setBusyOnboarding(false);
    }
  };

  const handleSwitchGoogleAccount = () => {
    setGoogleAccount(null);
    setOnboardingCtx(null);
    setStep("signin");
    setLoginAlert(null);
  };

  return (
    <div
      className="flex min-h-screen w-full items-stretch bg-background p-3 sm:p-5 lg:h-screen lg:overflow-hidden font-sans"
      data-testid="login-page"
    >
      {/* Left Showcase Panel */}
      <Floating image={brand?.login_image_file_id} t={t} />

      {/* Right Auth / Room Picker Panel */}
      <div className="flex w-full flex-col items-center justify-center px-3 py-6 sm:px-8 lg:w-[540px] lg:shrink-0 lg:overflow-y-auto scroll-thin">
        <div className="w-full max-w-[440px] space-y-6">
          {/* Top Brand Bar (Clean Wordmark — Buat Room hanya muncul setelah Google Sign-In bagi akun yang belum punya room) */}
          <div className="flex items-center justify-center gap-3">
            <img
              src={resolveRoomLogo(brand?.logo_file_id)}
              alt="ASLIWORKSPACE"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_LOGO;
              }}
              className="h-10 w-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <p className="truncate text-base font-extrabold tracking-tight text-ink">
              {brand?.name || "ASLIWORKSPACE"}
            </p>
          </div>

          {/* Step 1: Google-Only Sign In */}
          {step === "signin" && (
            <div className="space-y-5 pt-2" data-testid="login-signin-step">
              <div className="text-center">
                <h1 className="text-3xl sm:text-[34px] font-extrabold tracking-tight text-ink leading-tight">
                  Selamat Datang Kembali
                </h1>
              </div>

              {loginAlert && (
                <div
                  className={`flex items-start gap-2.5 rounded-2xl border p-3.5 text-xs font-medium ${
                    loginAlert.type === "quota"
                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
                  }`}
                  data-testid="login-alert-banner"
                >
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{loginAlert.message}</p>
                </div>
              )}

              <button
                type="button"
                disabled={busyGoogle || Boolean(busyRecentEmail)}
                onClick={handleGooglePopupSignIn}
                data-testid="google-signin-btn"
                className="flex h-[54px] min-h-[54px] w-full items-center justify-center gap-3 rounded-full border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-surface px-6 py-3.5 text-[15px] font-bold text-ink shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition-all hover:bg-slate-50/90 dark:hover:bg-surface2 hover:shadow-[0_4px_16px_rgba(15,23,42,0.1)] disabled:opacity-60 cursor-pointer"
              >
                <GoogleLogoIcon size={20} />
                <span>{busyGoogle ? "Memverifikasi Akun Google..." : "Masuk dengan Akun Google"}</span>
              </button>

              {recentGoogleAccounts.length > 0 && (
                <div className="space-y-2 pt-1" data-testid="recent-google-accounts">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-sub">
                    Akun Google Pernah Masuk
                  </p>
                  <div className="space-y-2">
                    {recentGoogleAccounts.slice(0, 3).map((acc) => {
                      const isBusyAcc = busyRecentEmail === acc.email;
                      return (
                        <button
                          key={acc.email}
                          type="button"
                          disabled={busyGoogle || Boolean(busyRecentEmail)}
                          onClick={() => handleRecentAccountClick(acc)}
                          data-testid={`recent-google-account-${acc.email}`}
                          className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-surface px-3.5 py-2.5 text-left shadow-2xs transition-all hover:border-brand/50 hover:bg-surface2/50 disabled:opacity-60 cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar
                              user={{ name: acc.name, avatar: acc.picture }}
                              size={34}
                              showStatus={false}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-ink">{acc.name}</p>
                              <p className="truncate text-[11px] text-sub">{acc.email}</p>
                            </div>
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-[11px] font-bold text-ink group-hover:bg-brand group-hover:text-white transition-colors">
                            <span>{isBusyAcc ? "Memuat..." : "Masuk"}</span>
                            <ArrowRight size={12} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setFallbackError("");
                    setFallbackEmailModalOpen(true);
                  }}
                  data-testid="google-email-fallback-btn"
                  className="text-xs font-semibold text-brand hover:underline cursor-pointer"
                >
                  Muncul Error 403 / popup diblokir? Masuk menggunakan Email Google
                </button>
              </div>

              <div className="flex items-center justify-center gap-2 pt-1 text-xs text-sub">
                <ShieldCheck size={15} className="text-emerald-600 shrink-0" />
                <span>Autentikasi Google terisolasi aman per workspace room.</span>
              </div>

              <div className="text-center pt-1">
                <Link
                  to="/platform-owner"
                  data-testid="platform-owner-link"
                  className="text-xs font-semibold text-sub hover:text-ink transition-colors"
                >
                  Platform Owner Console
                </Link>
              </div>
            </div>
          )}

          {/* Step 2: Post-Google Onboarding (Unbound: Invite Code or Create Room | Bound fallback on error) */}
          {step === "rooms" && googleAccount && (
            <div className="space-y-5" data-testid="login-rooms-step">
              {/* Signed-in Google Profile Card */}
              <div className="flex items-center justify-between gap-3 rounded-[24px] border border-slate-200/90 dark:border-slate-800 bg-surface px-4 py-3 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    user={{ name: googleAccount.name, avatar: googleAccount.picture }}
                    size={40}
                    showStatus={false}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{googleAccount.name}</p>
                    <p className="truncate text-xs text-sub">{googleAccount.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchGoogleAccount}
                  data-testid="switch-google-account-btn"
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-brand hover:underline cursor-pointer"
                >
                  <LogOut size={13} />
                  <span>Ganti akun</span>
                </button>
              </div>

              {loginAlert && (
                <div
                  className={`flex items-start gap-2.5 rounded-2xl border p-3.5 text-xs font-medium ${
                    loginAlert.type === "quota"
                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
                  }`}
                  data-testid="rooms-alert-banner"
                >
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{loginAlert.message}</p>
                </div>
              )}

              {googleAccount.rooms.length > 0 ? (
                /* Fallback only shown if bound room blocked (quota/suspended/wrong URL) */
                <div className="space-y-4">
                  <div>
                    <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-ink">
                      Workspace Anda
                    </h1>
                    <p className="mt-1 text-sm text-sub">
                      Akun Google ini hanya terhubung ke 1 workspace berikut.
                    </p>
                  </div>

                  {googleAccount.rooms.slice(0, 1).map((room) => {
                    const isBusy = enteringSlug === room.slug;
                    const avatars = Array.isArray(room.member_avatars) ? room.member_avatars.slice(0, 3) : [];
                    return (
                      <button
                        key={room.slug}
                        type="button"
                        disabled={Boolean(enteringSlug) || room.status === "suspended"}
                        onClick={() => handleEnterRoom(room.slug)}
                        data-testid={`room-picker-card-${room.slug}`}
                        className="group flex w-full items-center justify-between gap-3 rounded-[24px] border border-slate-200/90 dark:border-slate-800 bg-surface px-4 py-3.5 text-left shadow-xs transition-colors hover:border-brand/50 disabled:opacity-60 cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <img
                            src={resolveRoomLogo(room.logo_file_id)}
                            alt={room.brand_name || room.name}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_LOGO;
                            }}
                            className="h-12 w-12 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-extrabold tracking-tight text-ink">
                                {room.name || room.brand_name}
                              </p>
                              <span className="text-xs font-sans text-sub">/w/{room.slug}</span>
                              {room.status === "suspended" && (
                                <span className="text-xs font-bold text-rose-600">· Suspended</span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-sub font-sans tabular-nums">
                              {avatars.length > 0 && (
                                <span className="flex -space-x-2 overflow-hidden">
                                  {avatars.map((m, idx) => (
                                    <Avatar
                                      key={`${room.slug}-av-${idx}`}
                                      user={{ name: m.name, avatar: m.avatar }}
                                      size={20}
                                      showStatus={false}
                                    />
                                  ))}
                                </span>
                              )}
                              <span className="truncate">
                                {room.member_count} anggota · {formatRelativeIndo(room.last_active_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ArrowRight
                          size={18}
                          className={`shrink-0 text-sub group-hover:text-brand ${isBusy ? "text-brand" : ""}`}
                        />
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* Akun Google belum memiliki room -> hanya opsi Masukan Undangan atau Buat Room Baru */
                <div className="space-y-4">
                  <div>
                    <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-ink">
                      Selamat datang!
                    </h1>
                    <p className="mt-1 text-sm text-sub leading-relaxed">
                      Akun Google ini belum terdaftar di workspace mana pun. Masukkan kode undangan room atau buat workspace baru.
                    </p>
                  </div>

                  {/* Opsi 1: Masukan Kode Undangan / Invitation */}
                  <form
                    onSubmit={handleJoinByCodeSubmit}
                    className="rounded-[24px] border border-slate-200/90 dark:border-slate-800 bg-surface p-4 sm:p-5 space-y-3 shadow-xs"
                    data-testid="onboarding-join-invite-card"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand shrink-0">
                        <Ticket size={18} />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-extrabold text-ink">Masukan Undangan / Invitation</h2>
                        <p className="text-xs text-sub mt-0.5">
                          Masukkan kode undangan unik room yang diberikan Admin perusahaan Anda.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.replace(/\s+/g, "").toUpperCase())}
                        placeholder="Kode undangan (cth: ASLI-9F2A#1)"
                        className="h-11 flex-1 rounded-full border border-border bg-surface2/60 px-4 font-sans text-sm font-bold uppercase tracking-wide text-ink placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-sub/70 outline-none focus:border-brand tabular-nums"
                        data-testid="join-invite-code-input"
                      />
                      <button
                        type="submit"
                        disabled={busyJoinCode || !inviteCode.trim()}
                        data-testid="join-code-submit-btn"
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <span>{busyJoinCode ? "Memproses..." : "Gabung Room"}</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </form>

                  <div className="flex items-center gap-3 py-0.5">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-sub">atau</span>
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  </div>

                  {/* Opsi 2: Buat Workspace / Room Baru */}
                  <button
                    type="button"
                    onClick={() => setCreateRoomOpen(true)}
                    data-testid="picker-create-room-btn"
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-amber-300 bg-amber-50/90 dark:bg-amber-950/30 dark:border-amber-700/60 px-4 text-sm font-bold text-ink hover:bg-amber-100/80 transition-colors cursor-pointer"
                  >
                    <Plus size={16} />
                    <span>Buat workspace / room baru</span>
                  </button>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 pt-1 text-xs text-sub">
                <ShieldCheck size={15} className="text-emerald-600 shrink-0" />
                <span>1 akun Google hanya dapat masuk ke 1 workspace room.</span>
              </div>

              <div className="text-center">
                <Link
                  to="/platform-owner"
                  className="text-xs font-semibold text-sub hover:text-ink transition-colors"
                >
                  Platform Owner Console
                </Link>
              </div>
            </div>
          )}

          {/* Step 3: Wajib Lengkapi Data Diri Sebelum Masuk Room */}
          {step === "onboarding" && googleAccount && onboardingCtx && (
            <div className="space-y-4" data-testid="login-onboarding-step">
              <div className="flex items-center justify-between gap-3 rounded-[24px] border border-slate-200/90 dark:border-slate-800 bg-surface px-4 py-3 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    user={{ name: googleAccount.name, avatar: googleAccount.picture }}
                    size={38}
                    showStatus={false}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{googleAccount.name}</p>
                    <p className="truncate text-xs text-sub">{googleAccount.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOnboardingCtx(null);
                    setStep("rooms");
                    setLoginAlert(null);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-sub hover:text-ink cursor-pointer"
                >
                  <ArrowLeft size={13} />
                  <span>Kembali</span>
                </button>
              </div>

              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-ink">Lengkapi Data Profil</h1>
                <p className="mt-1 text-xs text-sub leading-relaxed">
                  {onboardingCtx.autoApproveEligible ? (
                    <>Isi data diri Anda untuk langsung masuk ke <span className="font-bold text-ink">{onboardingCtx.roomName}</span>.</>
                  ) : (
                    <>Akun di luar <span className="font-semibold text-ink">@asliri.id</span> wajib mengisi data diri dan menunggu approval Super Admin sebelum masuk ke <span className="font-bold text-ink">{onboardingCtx.roomName}</span>.</>
                  )}
                </p>
              </div>

              {loginAlert && (
                <div
                  className={`flex items-start gap-2.5 rounded-2xl border p-3 text-xs font-medium ${
                    loginAlert.type === "quota"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  <ShieldAlert size={15} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{loginAlert.message}</p>
                </div>
              )}

              <form onSubmit={handleOnboardingSubmit} className="space-y-3 rounded-[24px] border border-slate-200/90 dark:border-slate-800 bg-surface p-4 sm:p-5 shadow-xs">
                <label className="block text-xs font-semibold text-sub">
                  Nama Lengkap *
                  <input
                    type="text"
                    required
                    value={obName}
                    onChange={(e) => setObName(e.target.value)}
                    placeholder="Nama lengkap sesuai identitas tim"
                    className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                    data-testid="onboarding-name-input"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="text-xs font-semibold text-sub">
                    <span>Divisi *</span>
                    <div className="mt-1.5">
                      <AppSelect
                        value={obDept}
                        onValueChange={setObDept}
                        options={(onboardingCtx.divisions || []).map((d) => ({ value: d, label: d }))}
                        placeholder="Pilih divisi"
                        data-testid="onboarding-dept-select"
                      />
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-sub">
                    <span>Mode Kerja *</span>
                    <div className="mt-1.5">
                      <AppSelect
                        value={obWorkMode}
                        onValueChange={setObWorkMode}
                        options={[
                          { value: "On-site", label: "On-site" },
                          { value: "Hybrid", label: "Hybrid" },
                          { value: "Remote", label: "Remote" },
                        ]}
                        placeholder="Pilih mode kerja"
                        data-testid="onboarding-workmode-select"
                      />
                    </div>
                  </div>
                </div>

                <label className="block text-xs font-semibold text-sub">
                  Jabatan / Posisi *
                  <input
                    type="text"
                    required
                    value={obTitle}
                    onChange={(e) => setObTitle(e.target.value)}
                    placeholder="Contoh: Product Manager, Backend Engineer"
                    className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                    data-testid="onboarding-title-input"
                  />
                </label>

                <label className="block text-xs font-semibold text-sub">
                  Nomor WhatsApp / Telepon *
                  <input
                    type="tel"
                    required
                    value={obPhone}
                    onChange={(e) => setObPhone(e.target.value)}
                    placeholder="Contoh: 081234567890"
                    className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand tabular-nums"
                    data-testid="onboarding-phone-input"
                  />
                </label>

                <label className="block text-xs font-semibold text-sub">
                  Catatan Singkat (Opsional)
                  <input
                    type="text"
                    value={obNote}
                    onChange={(e) => setObNote(e.target.value)}
                    placeholder="Peran atau tim yang dituju"
                    className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                    data-testid="onboarding-note-input"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busyOnboarding}
                  data-testid="onboarding-submit-btn"
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-60 cursor-pointer"
                >
                  <span>
                    {busyOnboarding
                      ? "Menyimpan Profil..."
                      : onboardingCtx.autoApproveEligible
                      ? "Simpan Data & Masuk Workspace"
                      : "Kirim Data & Ajukan Persetujuan"}
                  </span>
                  <ArrowRight size={15} />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Create New Company Room Modal */}
      <CreateRoomModal
        open={createRoomOpen}
        onOpenChange={setCreateRoomOpen}
        prefillGoogle={googleAccount}
        lockGoogleEmail={Boolean(googleAccount?.email)}
      />

      {/* Fallback Email Google Modal */}
      <Dialog open={fallbackEmailModalOpen} onOpenChange={setFallbackEmailModalOpen}>
        <DialogContent className="max-w-md rounded-3xl border bg-surface p-6 shadow-2xl" data-testid="google-email-fallback-modal">
          <DialogHeader className="pb-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand shrink-0">
                <Mail size={19} />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-extrabold text-ink">
                  Masuk Menggunakan Email Google
                </DialogTitle>
                <DialogDescription className="text-xs text-sub">
                  Alternatif aman apabila popup Google OAuth diblokir atau muncul Error 403 di iframe preview.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleFallbackEmailSubmit} className="space-y-4 pt-3">
            {fallbackError && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                <ShieldAlert size={15} className="shrink-0 mt-0.5" />
                <span>{fallbackError}</span>
              </div>
            )}
            <label className="block text-xs font-semibold text-sub">
              Alamat Email Google *
              <input
                type="email"
                required
                autoFocus
                value={fallbackEmail}
                onChange={(e) => setFallbackEmail(e.target.value)}
                placeholder="nama@perusahaan.com atau nama@gmail.com"
                className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                data-testid="fallback-google-email-input"
              />
            </label>

            <label className="block text-xs font-semibold text-sub">
              Nama Lengkap (Opsional)
              <input
                type="text"
                value={fallbackName}
                onChange={(e) => setFallbackName(e.target.value)}
                placeholder="Nama tampilan di workspace"
                className="mt-1.5 h-10 w-full rounded-full border border-border bg-surface2/70 px-4 text-sm text-ink outline-none focus:border-brand"
                data-testid="fallback-google-name-input"
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setFallbackEmailModalOpen(false)}
                className="h-10 rounded-full border bg-surface px-4 text-xs font-semibold text-sub hover:text-ink cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busyFallback}
                data-testid="fallback-google-submit-btn"
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand px-5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-60 cursor-pointer"
              >
                <span>{busyFallback ? "Memeriksa Room..." : "Deteksi Room Saya"}</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
