import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Globe, Link2, Lock, ShieldCheck, Upload, Image as ImageIcon, ArrowRight, Layers } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl } from "../lib/api";
import { slugifyWorkspaceName } from "../lib/roomContext";

const DEFAULT_LOGO = "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png";
const DEFAULT_LOGIN_IMG = "/assets/aistudio/SIGN_DEPAN_2_86dd649d.jpg";

export default function CreateRoomModal({ open, onOpenChange, prefillGoogle = null, lockGoogleEmail = false, onCreated }) {
  const navigate = useNavigate();
  const { enterRoomSession } = useApp();

  const [workspaceName, setWorkspaceName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [tagline, setTagline] = useState("Enterprise Collaboration & Management");
  const [description, setDescription] = useState("");
  const [orgLevels, setOrgLevels] = useState("Executive, Division, Department, Team");
  const [divisions, setDivisions] = useState("Management, Marketing, Sales, IT, Finance, Legal, HRGA");
  const [customDomain, setCustomDomain] = useState("");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [autoJoinDomain, setAutoJoinDomain] = useState(true);
  const [requireApproval, setRequireApproval] = useState(true);
  const [superAdminName, setSuperAdminName] = useState("");
  const [superAdminEmail, setSuperAdminEmail] = useState("");

  const [logoFileId, setLogoFileId] = useState("");
  const [faviconFileId, setFaviconFileId] = useState("");
  const [loginImageFileId, setLoginImageFileId] = useState("");
  const [uploadingSlot, setUploadingSlot] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (prefillGoogle) {
      if (prefillGoogle.name && (!superAdminName || lockGoogleEmail)) setSuperAdminName(prefillGoogle.name);
      if (prefillGoogle.email) setSuperAdminEmail(prefillGoogle.email);
      const emailDomain = String(prefillGoogle.email || "").split("@")[1] || "";
      if (emailDomain && !["gmail.com", "googlemail.com"].includes(emailDomain.toLowerCase()) && !allowedDomains) {
        setAllowedDomains(emailDomain.toLowerCase());
      }
    }
  }, [open, prefillGoogle, lockGoogleEmail]);

  const handleWorkspaceNameChange = (val) => {
    setWorkspaceName(val);
    if (!slugEditedManually) {
      setSlug(val.trim() ? slugifyWorkspaceName(val) : "");
    }
  };

  const handleUploadBranding = async (slot, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(file.name || "")) {
      toast.error("Pilih file gambar (PNG, JPG, WebP, SVG, atau ICO).");
      return;
    }
    setUploadingSlot(slot);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/saas/upload-branding", fd);
      if (data?.id) {
        if (slot === "logo") setLogoFileId(data.id);
        if (slot === "favicon") setFaviconFileId(data.id);
        if (slot === "login") setLoginImageFileId(data.id);
        toast.success("Aset branding berhasil diunggah!");
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengunggah aset branding"));
    } finally {
      setUploadingSlot("");
    }
  };

  const resetDefaults = () => {
    setTagline("Enterprise Collaboration & Management");
    setOrgLevels("Executive, Division, Department, Team");
    setDivisions("Management, Marketing, Sales, IT, Finance, Legal, HRGA");
    setLogoFileId("");
    setFaviconFileId("");
    setLoginImageFileId("");
    toast.info("Pengaturan branding diselaraskan dengan standar Identitas Workspace.");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workspaceName.trim()) {
      return toast.error("Nama Workspace wajib diisi.");
    }
    const cleanSlug = slugifyWorkspaceName(slug || workspaceName);
    if (!cleanSlug) {
      return toast.error("Slug URL Workspace tidak valid.");
    }
    if (!superAdminName.trim()) {
      return toast.error("Nama Lengkap Super Admin wajib diisi.");
    }
    const cleanEmail = superAdminEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return toast.error("Email Google Super Admin yang valid wajib diisi.");
    }

    setBusy(true);
    try {
      const { data } = await api.post("/saas/rooms", {
        workspace_name: workspaceName.trim(),
        slug: cleanSlug,
        tagline: tagline.trim() || "Enterprise Collaboration & Management",
        description: description.trim(),
        org_levels: orgLevels.split(",").map((s) => s.trim()).filter(Boolean),
        divisions: divisions.split(",").map((s) => s.trim()).filter(Boolean),
        logo_file_id: logoFileId || null,
        favicon_file_id: faviconFileId || null,
        login_image_file_id: loginImageFileId || null,
        custom_domain: customDomain.trim().toLowerCase(),
        allowed_domains: allowedDomains.split(",").map((d) => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
        auto_join_domain: autoJoinDomain,
        require_approval: requireApproval,
        super_admin_name: superAdminName.trim(),
        super_admin_email: cleanEmail,
        super_admin_picture: prefillGoogle?.picture || "",
        idToken: prefillGoogle?.idToken || "",
      });

      enterRoomSession(data.slug, data);
      toast.success(`Room "${workspaceName.trim()}" berhasil dibuat! Selamat datang, Super Admin.`);
      onOpenChange(false);
      if (onCreated) {
        onCreated(data);
      } else {
        navigate(`/w/${data.slug}`, { replace: true });
      }
    } catch (err) {
      toast.error(errMsg(err, "Gagal membuat room workspace baru"));
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://asliworkspace.app";
  const previewSlug = slugifyWorkspaceName(slug || workspaceName || "workspace-baru");
  const logoSrc = logoFileId ? fileUrl(logoFileId) : DEFAULT_LOGO;
  const faviconSrc = faviconFileId ? fileUrl(faviconFileId) : logoSrc;
  const loginImgSrc = loginImageFileId ? `/api/public/login-image/${loginImageFileId}` : DEFAULT_LOGIN_IMG;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="max-w-3xl max-h-[92dvh] overflow-y-auto scroll-thin p-5 sm:p-7 rounded-[28px] bg-surface border border-border shadow-2xl font-sans"
        data-testid="create-room-modal"
      >
        <DialogHeader className="text-left pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand mt-0.5">
              <Layers size={20} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg sm:text-xl font-extrabold tracking-tight text-ink">
                Buat Room Workspace Baru
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-[13px] text-sub mt-0.5 leading-relaxed">
                Setiap room memiliki database, file unggahan, kode undangan, domain khusus, dan autentikasi Google terpisah.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-1">
          {/* SECTION 1: 1. Identitas & Branding Workspace */}
          <section className="rounded-3xl border border-border bg-surface p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-extrabold text-ink">
                <Building2 size={16} className="text-brand shrink-0" />
                <span>1. Identitas &amp; Branding Workspace</span>
              </div>
              <button
                type="button"
                onClick={resetDefaults}
                className="text-xs font-bold text-brand hover:underline cursor-pointer"
              >
                Sama seperti Identitas Workspace
              </button>
            </div>

            {/* 3 Upload Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Logo Workspace */}
              <div className="rounded-2xl border border-border bg-surface2/40 p-3 flex flex-col justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <img
                    src={logoSrc}
                    alt="Logo Workspace"
                    className="h-11 w-11 rounded-full object-cover border border-border shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-ink leading-tight">Logo Workspace</p>
                    <p className="text-[11px] text-sub leading-snug mt-0.5">Header sidebar &amp; room</p>
                  </div>
                </div>
                <label className="btn-accent h-9 w-full rounded-full text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
                  <Upload size={13} />
                  <span>{uploadingSlot === "logo" ? "Mengunggah..." : "Unggah Logo"}</span>
                  <input type="file" accept="image/*" hidden onChange={(e) => handleUploadBranding("logo", e)} />
                </label>
              </div>

              {/* Icon Website */}
              <div className="rounded-2xl border border-border bg-surface2/40 p-3 flex flex-col justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-11 w-11 rounded-2xl border border-border bg-surface flex items-center justify-center p-1.5 shrink-0">
                    <img src={faviconSrc} alt="Icon Website" className="h-8 w-8 rounded-lg object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-ink leading-tight">Icon Website</p>
                    <p className="text-[11px] text-sub leading-snug mt-0.5">Browser Tab &amp; PWA</p>
                  </div>
                </div>
                <label className="btn-accent h-9 w-full rounded-full text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
                  <Upload size={13} />
                  <span>{uploadingSlot === "favicon" ? "Mengunggah..." : "Unggah Icon"}</span>
                  <input type="file" accept="image/*,.ico,.svg" hidden onChange={(e) => handleUploadBranding("favicon", e)} />
                </label>
              </div>

              {/* Gambar Login */}
              <div className="rounded-2xl border border-border bg-surface2/40 p-3 flex flex-col justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <img
                    src={loginImgSrc}
                    alt="Gambar Login"
                    onError={(e) => { e.currentTarget.src = DEFAULT_LOGIN_IMG; }}
                    className="h-11 w-14 rounded-xl object-cover border border-border shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-ink leading-tight">Gambar Login</p>
                    <p className="text-[11px] text-sub leading-snug mt-0.5">Banner sisi kiri masuk</p>
                  </div>
                </div>
                <label className="btn-accent h-9 w-full rounded-full text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
                  <ImageIcon size={13} />
                  <span>{uploadingSlot === "login" ? "Mengunggah..." : "Unggah Foto"}</span>
                  <input type="file" accept="image/*" hidden onChange={(e) => handleUploadBranding("login", e)} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-sub">Nama Aplikasi *</label>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sub">
                    <Lock size={11} /> Terkunci
                  </span>
                </div>
                <input
                  value="ASLIWORKSPACE"
                  readOnly
                  className="h-11 w-full rounded-full border border-border bg-surface2/70 px-4 text-xs sm:text-sm font-extrabold text-ink outline-none cursor-not-allowed"
                  data-testid="create-room-app-name"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Nama Workspace *</label>
                <input
                  required
                  value={workspaceName}
                  onChange={(e) => handleWorkspaceNameChange(e.target.value)}
                  placeholder="Contoh: PT Acme Nusantara"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                  data-testid="create-room-workspace-name"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Tagline</label>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Enterprise Collaboration & Management"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Deskripsi</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Portal kolaborasi resmi perusahaan"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Level Organisasi</label>
                <input
                  value={orgLevels}
                  onChange={(e) => setOrgLevels(e.target.value)}
                  placeholder="Executive, Division, Department, Team"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Divisi Awal (pisahkan koma)</label>
                <input
                  value={divisions}
                  onChange={(e) => setDivisions(e.target.value)}
                  placeholder="Management, Marketing, Sales, IT, Finance, Legal, HRGA"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                />
              </div>
            </div>
          </section>

          {/* SECTION 2: 2. Subdomain, Domain Khusus & Kebijakan Akses */}
          <section className="rounded-3xl border border-border bg-surface p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-extrabold text-ink">
              <Globe size={16} className="text-brand shrink-0" />
              <span>2. Subdomain, Domain Khusus &amp; Kebijakan Akses</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Slug URL Workspace *</label>
                <div className="flex h-11 w-full items-center overflow-hidden rounded-full border border-border bg-surface focus-within:border-brand">
                  <span className="flex h-full items-center border-r border-border bg-surface2/80 px-3.5 text-xs font-semibold text-sub shrink-0">
                    /w/
                  </span>
                  <input
                    value={slug}
                    onChange={(e) => {
                      setSlugEditedManually(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                    }}
                    placeholder="nama-perusahaan"
                    className="h-full w-full bg-transparent px-3 text-xs sm:text-sm text-ink outline-none !border-0 !rounded-none"
                    data-testid="create-room-slug"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub leading-snug">
                  Domain Khusus (Custom Domain / CNAME Opsional)
                </label>
                <input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="mis. portal.perusahaananda.co.id"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface2/40 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-sub">
                <Link2 size={13} className="text-brand shrink-0" />
                <span>Alamat Portal Room:</span>
              </p>
              <p className="mt-1 text-xs sm:text-sm font-extrabold text-ink break-all">
                {origin}/w/{previewSlug}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-sub">
                Domain Email Perusahaan yang Diizinkan (pisahkan koma, opsional)
              </label>
              <input
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="mis. acmecorp.co.id, acme.id"
                className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3.5 cursor-pointer">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-ink">Auto-join domain email</p>
                  <p className="text-[11px] text-sub mt-0.5">Karyawan berdomain sama langsung aktif</p>
                </div>
                <Switch checked={autoJoinDomain} onCheckedChange={setAutoJoinDomain} />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3.5 cursor-pointer">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-ink">Approval Admin domain luar</p>
                  <p className="text-[11px] text-sub mt-0.5">Akun eksternal perlu approval admin</p>
                </div>
                <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
              </label>
            </div>
          </section>

          {/* SECTION 3: 3. Akun Google Super Admin Room */}
          <section className="rounded-3xl border border-border bg-surface p-4 sm:p-5 space-y-3.5">
            <div>
              <div className="flex items-center gap-2 text-sm font-extrabold text-ink">
                <ShieldCheck size={16} className="text-brand shrink-0" />
                <span>3. Akun Google Super Admin Room</span>
              </div>
              <p className="text-xs text-sub mt-1 leading-relaxed">
                Super Admin masuk menggunakan akun Google di bawah ini (tanpa password terpisah). Data room terisolasi penuh dari room lain.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Nama Lengkap Super Admin *</label>
                <input
                  required
                  value={superAdminName}
                  onChange={(e) => setSuperAdminName(e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                  className="h-11 w-full rounded-full border border-border bg-surface px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand"
                  data-testid="create-room-admin-name"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-sub">Email Google Super Admin *</label>
                <input
                  required
                  type="email"
                  readOnly={Boolean(lockGoogleEmail && prefillGoogle?.email)}
                  value={superAdminEmail}
                  onChange={(e) => {
                    if (lockGoogleEmail && prefillGoogle?.email) return;
                    setSuperAdminEmail(e.target.value);
                  }}
                  placeholder="admin@perusahaananda.co.id"
                  className={`h-11 w-full rounded-full border border-border px-4 text-xs sm:text-sm text-ink outline-none focus:border-brand ${
                    lockGoogleEmail && prefillGoogle?.email ? "bg-surface2/70 text-sub cursor-not-allowed" : "bg-surface"
                  }`}
                  data-testid="create-room-admin-email"
                />
                {lockGoogleEmail && prefillGoogle?.email && (
                  <p className="mt-1 text-[11px] text-sub">
                    Terikat ke akun Google yang sedang login (1 akun untuk 1 workspace).
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-full border border-border bg-surface px-6 text-xs sm:text-sm font-bold text-ink hover:bg-surface2 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-accent h-11 rounded-full px-6 text-xs sm:text-sm font-extrabold shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              data-testid="create-room-submit-btn"
            >
              <span>{busy ? "Membuat Room..." : "Buat Room & Masuk sebagai Super Admin"}</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
