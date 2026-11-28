import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MessageCircle, Mail, MapPin, Briefcase, Users2, Pencil, Calendar, IdCard, Link2, Phone, Newspaper, CornerDownRight, Heart, BarChart3, Paperclip, Hash, ArrowUpRight, BadgeCheck, Sparkles, Palette, ImagePlus, RotateCcw, Check, Trash2, Clock, Video, Plus, ExternalLink, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg, fileUrl, uploadFile } from "../lib/api";
import { Avatar, Spinner, rel, AccentButton, GhostButton, getAvailabilityStatusMeta, VerifiedBadge, MentionText } from "../components/common";
import { getProfileCompletion } from "../lib/profileCompletion";
import { upsertAccountInVault, syncWorkspaceMirror } from "../lib/persistentMirror";
import { upsertConversationInCache } from "../lib/workspaceCaches";
import { createEvent } from "../lib/calendar";
import { getAccessToken, googleCalendarOAuthSignIn, getConnectedCalendarEmail } from "../lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { AppSelect } from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";
import { Switch } from "../components/ui/switch";
import { DEFAULT_ORG_LEVELS, inferUserOrgLevel, getOrgLevelMeta } from "../lib/orgLevels";

const MODES = ["Office", "Remote", "Hybrid", "On-site", "Kustom"];
const EMPLOYMENT_OPTIONS = [
  ["Full-time", "Penuh Waktu"],
  ["Part-time", "Paruh Waktu"],
  ["Contract", "Kontrak"],
  ["Intern", "Magang"],
  ["On leave", "Sedang Cuti"],
];
const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT_OPTIONS);

const DEFAULT_COVER_BG = "linear-gradient(120deg, var(--s-red), var(--s-purple), var(--s-blue))";
const COVER_PRESETS = [
  { id: "pastel_default", label: "Pastel Default", value: DEFAULT_COVER_BG },
  { id: "sunset_coral", label: "Sunset Coral", value: "linear-gradient(135deg, #FF6B6B 0%, #FF8E53 50%, #FBBF24 100%)" },
  { id: "ocean_breeze", label: "Samudra Biru", value: "linear-gradient(135deg, #0284C7 0%, #3B82F6 50%, #6366F1 100%)" },
  { id: "emerald_mint", label: "Hijau Zamrud", value: "linear-gradient(135deg, #059669 0%, #14B8A6 55%, #06B6D4 100%)" },
  { id: "royal_violet", label: "Ungu Elegan", value: "linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)" },
  { id: "warm_rose", label: "Mawar Hangat", value: "linear-gradient(135deg, #E11D48 0%, #FB7185 55%, #FDA4AF 100%)" },
  { id: "midnight_slate", label: "Midnight Gelap", value: "linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #334155 100%)" },
  { id: "aurora_indigo", label: "Aurora Malam", value: "linear-gradient(135deg, #1E1B4B 0%, #4338CA 50%, #0EA5E9 100%)" },
];

const COVER_POSITIONS = [
  { value: "top", label: "Atas" },
  { value: "center", label: "Tengah" },
  { value: "bottom", label: "Bawah" },
];

function Field({ label, children }) {
  return <div className="block text-xs font-semibold text-sub">{label}<div className="mt-1 text-sm font-normal text-ink">{children}</div></div>;
}
const inp = "h-10 w-full rounded-xl border border-border bg-surface2/75 px-3.5 text-sm outline-none";

function CustomInput({ f, value, onChange }) {
  if (f.type === "long_text") return <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${inp} h-20 py-2`} />;
  if (f.type === "boolean") return <Switch checked={!!value} onCheckedChange={onChange} />;
  if (f.type === "dropdown") return <AppSelect value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Pilih opsi" className={inp}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</AppSelect>;
  if (f.type === "multi_select") return <div className="flex flex-wrap gap-1">{f.options.map((o) => { const on = (value || []).includes(o); return <button type="button" key={o} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...(value || []), o])} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "bg-soft-red border-[var(--c-accent)]" : ""}`}>{o}</button>; })}</div>;
  if (f.type === "date") return <DatePicker showQuickPresets={false} value={value || ""} onChange={onChange} className={inp} />;
  const type = { email: "email", phone: "tel", url: "url" }[f.type] || "text";
  return <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inp} />;
}

function EditProfile({ open, onOpenChange, p, onSaved }) {
  const { ws, isAdmin, users, t: tr } = useApp();
  const orgLevels = DEFAULT_ORG_LEVELS;
  const [f, setF] = useState(p);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setF({
        ...p,
        org_level: inferUserOrgLevel(p, orgLevels),
        custom: { ...(p?.custom_fields || {}), ...(p?.custom || {}) },
        skillsText: (p.skills || []).join(", "),
      });
    }
    wasOpenRef.current = open;
  }, [open, p]);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const liveCompletion = useMemo(() => getProfileCompletion(f), [f]);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    const keys = [
      "name",
      "picture",
      "avatar",
      "cover_bg",
      "cover_image",
      "cover_position",
      "phone",
      "employee_id",
      "employment_status",
      "join_date",
      "bio",
      "work_mode",
      "city",
      "office",
      "custom_location",
      "location_status",
      "share_location",
      "custom",
      ...(isAdmin ? ["job_title", "org_level", "department", "division", "team", "manager_id"] : []),
    ];
    const body = Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
    if (body.picture && !body.avatar) body.avatar = body.picture;
    if (body.avatar && !body.picture) body.picture = body.avatar;
    if (body.custom) body.custom_fields = body.custom;
    body.skills = (f.skillsText || "").split(",").map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      const { data } = await api.patch(`/users/${p.user_id}`, body);
      if (data?.is_verified && !p?.is_verified) {
        toast.success("Profil 100% lengkap! Akun Anda kini mendapat centang Verified.");
      } else {
        toast.success("Profil berhasil disimpan");
      }
      onSaved(data);
      onOpenChange(false);
    } catch (e) { toast.error(errMsg(e)); } finally {
      setSaving(false);
    }
  };
  const photo = async (e) => {
    try {
      const up = await uploadFile(e.target.files[0]);
      const url = fileUrl(up.id);
      setF((prev) => ({ ...prev, picture: url, avatar: url }));
    } catch (er) { toast.error(errMsg(er)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>{tr("profile_edit_modal_title", "Ubah Profil")}</DialogTitle></DialogHeader>
        <div
          className={`rounded-2xl border p-3.5 transition-colors ${
            liveCompletion.isVerified
              ? "border-sky-200 dark:border-sky-800/70 bg-sky-50/70 dark:bg-sky-950/30"
              : "border-slate-200/80 dark:border-slate-800 bg-surface2/70"
          }`}
          data-testid="edit-profile-completion-card"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-ink">
              {liveCompletion.isVerified ? (
                <>
                  <VerifiedBadge user={{ is_verified: true }} size={16} />
                  <span>{tr("profile_verified_ready", "Profil 100% Lengkap — Siap Terverifikasi!")}</span>
                </>
              ) : (
                <>
                  <BadgeCheck size={16} className="text-sky-500 shrink-0" />
                  <span>{tr("profile_verified_progress", "Kelengkapan Profil untuk Centang Verified")}</span>
                </>
              )}
            </span>
            <span className={liveCompletion.isVerified ? "text-sky-600 dark:text-sky-400" : "text-brand"}>
              {liveCompletion.percent}% ({liveCompletion.filledCount}/{liveCompletion.totalCount})
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                liveCompletion.isVerified ? "bg-sky-500" : "bg-brand"
              }`}
              style={{ width: `${liveCompletion.percent}%` }}
            />
          </div>
          {!liveCompletion.isVerified && liveCompletion.missingFields.length > 0 && (
            <p className="mt-2 text-[11px] text-sub leading-relaxed">
              {tr("profile_missing_prefix", "Belum terisi:")}{" "}
              <span className="font-medium text-ink">{liveCompletion.missingFields.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3"><Avatar user={f} size={56} showStatus={false} /><label className="cursor-pointer text-sm font-semibold text-brand">{tr("profile_change_photo", "Ganti Foto")}<input type="file" accept="image/*" hidden onChange={photo} data-testid="profile-photo-input" /></label></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("profile_field_name", "Nama Lengkap")}><input value={f.name || ""} onChange={set("name")} className={inp} data-testid="profile-name-input" /></Field>
          <Field label={tr("profile_field_phone", "No. Telepon")}><input value={f.phone || ""} onChange={set("phone")} className={inp} data-testid="profile-phone-input" /></Field>
          <Field label={tr("profile_field_empid", "ID Employee")}><input value={f.employee_id || ""} onChange={set("employee_id")} placeholder="mis. EMP-001" className={inp} data-testid="profile-employee-id-input" /></Field>
          <Field label={tr("profile_field_employment", "Status Kepegawaian")}><AppSelect value={f.employment_status || ""} onChange={set("employment_status")} placeholder="Pilih status" className={inp} data-testid="profile-employment-status-select">{EMPLOYMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AppSelect></Field>
          <Field label={tr("profile_field_join", "Tanggal Bergabung")}><DatePicker showQuickPresets={false} value={f.join_date || ""} onChange={(val) => setF({ ...f, join_date: val })} placeholder="Pilih tanggal bergabung" className={inp} data-testid="profile-join-date-input" /></Field>
          {isAdmin && <>
            <Field label={tr("profile_field_job", "Jabatan")}><input value={f.job_title || ""} onChange={set("job_title")} className={inp} data-testid="profile-title-input" /></Field>
            <Field label={tr("profile_field_level", "Level Hierarki")}>
              <AppSelect value={f.org_level || inferUserOrgLevel(f, orgLevels)} onChange={set("org_level")} placeholder="Pilih level" className={inp} data-testid="profile-org-level-select">
                {orgLevels.map((lvl, idx) => (
                  <option key={lvl} value={lvl}>{idx + 1}. {lvl}</option>
                ))}
              </AppSelect>
            </Field>
            <Field label={tr("profile_field_division", "Divisi")}><input value={f.department || ""} onChange={set("department")} className={inp} /></Field>
            <Field label={tr("profile_field_team", "Tim")}><input value={f.team || ""} onChange={set("team")} className={inp} /></Field>
            <Field label={tr("profile_field_manager", "Atasan Langsung")}><AppSelect value={f.manager_id || ""} onChange={set("manager_id")} placeholder={tr("profile_field_no_manager", "Tidak ada")} className={inp}><option value="">{tr("profile_field_no_manager", "Tidak ada")}</option>{users.filter((u) => u.user_id !== p.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</AppSelect></Field>
          </>}
          <Field label={tr("profile_field_workmode", "Mode Kerja")}><AppSelect value={f.work_mode || ""} onChange={set("work_mode")} placeholder={tr("profile_field_workmode_ph", "Pilih mode kerja")} className={inp} data-testid="profile-workmode-select">{MODES.map((m) => <option key={m}>{m}</option>)}</AppSelect></Field>
          <Field label={tr("profile_field_city", "Kota")}><input value={f.city || ""} onChange={set("city")} className={inp} data-testid="profile-city-input" /></Field>
          <Field label={tr("profile_field_office", "Kantor")}><input value={f.office || ""} onChange={set("office")} className={inp} /></Field>
          {(f.work_mode === "Custom" || f.work_mode === "Kustom") && <Field label={tr("profile_field_custom_loc", "Lokasi Kustom")}><input value={f.custom_location || ""} onChange={set("custom_location")} className={inp} /></Field>}
          <Field label={tr("profile_field_loc_status", "Status Lokasi")}><input value={f.location_status || ""} onChange={set("location_status")} placeholder={tr("profile_field_loc_status_ph", "mis. Di lokasi klien hari ini")} className={inp} /></Field>
        </div>
        <label className="flex items-center justify-between rounded-xl bg-surface2 p-3 text-sm">{tr("profile_share_location", "Bagikan lokasi kerja saya dengan rekan tim")}<Switch checked={f.share_location !== false} onCheckedChange={set("share_location")} data-testid="profile-share-location" /></label>
        <Field label={tr("profile_field_skills", "Keahlian")}><input value={f.skillsText || ""} onChange={set("skillsText")} placeholder={tr("profile_field_skills_ph", "Pisahkan dengan koma")} className={inp} data-testid="profile-skills-input" /></Field>
        <Field label={tr("profile_field_bio", "Biodata")}><textarea value={f.bio || ""} onChange={set("bio")} className={`${inp} h-20 py-2`} data-testid="profile-bio-input" /></Field>
        {(ws.profile_fields || []).length > 0 && <div className="grid gap-3 sm:grid-cols-2">{ws.profile_fields.map((cf) => <Field key={cf.key} label={cf.name}><CustomInput f={cf} value={f.custom?.[cf.key]} onChange={(v) => setF({ ...f, custom: { ...(f.custom || {}), [cf.key]: v } })} /></Field>)}</div>}
        <AccentButton onClick={save} disabled={saving} data-testid="profile-save-btn">{saving ? "Menyimpan…" : tr("profile_save_btn", "Simpan Profil")}</AccentButton>
      </DialogContent>
    </Dialog>
  );
}

function CustomizeCoverDialog({ open, onOpenChange, p, onSaved }) {
  const { t: tr } = useApp();
  const [coverBg, setCoverBg] = useState(p?.cover_bg || DEFAULT_COVER_BG);
  const [coverImage, setCoverImage] = useState(p?.cover_image || "");
  const [coverPosition, setCoverPosition] = useState(p?.cover_position || "center");
  const [customColor, setCustomColor] = useState("#3B82F6");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const currentBg = p?.cover_bg || DEFAULT_COVER_BG;
      setCoverBg(currentBg);
      setCoverImage(p?.cover_image || "");
      setCoverPosition(p?.cover_position || "center");
      if (/^#[0-9a-fA-F]{6}$/.test(currentBg)) {
        setCustomColor(currentBg);
      }
    }
    wasOpenRef.current = open;
  }, [open, p]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      setCoverImage(fileUrl(up.id));
    } catch (er) {
      toast.error(errMsg(er));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleReset = () => {
    setCoverImage("");
    setCoverBg(DEFAULT_COVER_BG);
    setCoverPosition("center");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/users/${p.user_id}`, {
        cover_bg: coverBg || DEFAULT_COVER_BG,
        cover_image: coverImage || "",
        cover_position: coverPosition || "center",
      });
      toast.success("Background cover profil berhasil diperbarui");
      onSaved(data);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const objectPositionClass =
    coverPosition === "top"
      ? "object-top"
      : coverPosition === "bottom"
      ? "object-bottom"
      : "object-center";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-2xl sm:rounded-3xl max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette size={18} className="text-brand" />
            <span>{tr("profile_cover_modal_title", "Kustomisasi Background Cover")}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Live Preview */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface shadow-xs" data-testid="cover-preview-card">
          <div
            className="relative h-28 w-full overflow-hidden transition-all"
            style={!coverImage ? { background: coverBg || DEFAULT_COVER_BG } : undefined}
          >
            {coverImage && (
              <img
                src={coverImage}
                alt="Preview cover"
                className={`h-full w-full object-cover ${objectPositionClass}`}
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />
          </div>
          <div className="px-4 pb-3 pt-2.5 flex items-center gap-3">
            <div className="-mt-10 w-fit shrink-0 rounded-full border-4 border-[var(--c-surface)] bg-[var(--c-surface)] shadow-xs">
              <Avatar user={p} size={56} showStatus={false} ringDeadline={false} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{p?.name}</p>
              <p className="truncate text-xs text-sub">{p?.job_title || "Anggota Tim"}</p>
            </div>
          </div>
        </div>

        {/* Upload Gambar Cover */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-sub">{tr("profile_cover_custom_img", "Gambar Cover Kustom")}</span>
            {coverImage && (
              <button
                type="button"
                onClick={() => setCoverImage("")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 cursor-pointer"
                data-testid="cover-remove-image-btn"
              >
                <Trash2 size={12} />
                {tr("profile_cover_remove_img", "Hapus Gambar")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-surface2/70 hover:bg-surface2 px-3.5 text-xs font-semibold text-ink transition-colors cursor-pointer ${
                uploading ? "opacity-60 pointer-events-none" : ""
              }`}
            >
              <ImagePlus size={14} className="text-brand" />
              <span>{uploading ? "Mengunggah..." : coverImage ? tr("profile_cover_change_img", "Ganti Gambar Cover") : tr("profile_cover_upload_img", "Unggah Foto / Banner")}</span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={handleUpload}
                data-testid="cover-image-input"
              />
            </label>
            {coverImage && (
              <div className="inline-flex items-center rounded-xl bg-surface2 p-0.5 text-[11px] font-semibold">
                {COVER_POSITIONS.map((pos) => (
                  <button
                    key={pos.value}
                    type="button"
                    onClick={() => setCoverPosition(pos.value)}
                    className={`rounded-lg px-2.5 py-1 transition-colors cursor-pointer ${
                      coverPosition === pos.value
                        ? "bg-surface text-ink shadow-xs"
                        : "text-sub hover:text-ink"
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preset Gradien */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-sub">{tr("profile_cover_presets", "Pilih Tema Gradien")}</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COVER_PRESETS.map((preset) => {
              const active = !coverImage && coverBg === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setCoverImage("");
                    setCoverBg(preset.value);
                  }}
                  data-testid={`cover-preset-${preset.id}`}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? "border-[var(--c-accent)] bg-brand/5"
                      : "border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  <div className="relative h-10 w-full" style={{ background: preset.value }}>
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-900 shadow-xs">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <span className="truncate bg-surface px-2 py-1.5 text-[11px] font-semibold text-ink">
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Warna Solid Kustom */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-sub">{tr("profile_cover_solid", "Warna Solid Kustom")}</span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-surface2/50 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomColor(val);
                  setCoverImage("");
                  setCoverBg(val);
                }}
                aria-label="Pilih warna cover kustom"
                data-testid="cover-custom-color-input"
                className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0"
              />
              <div>
                <p className="text-xs font-semibold text-ink">{tr("profile_cover_pick_free", "Pilih Warna Bebas")}</p>
                <p className="text-[11px] font-mono text-sub uppercase">{!coverImage && /^#/.test(coverBg) ? coverBg : customColor}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCoverImage("");
                setCoverBg(customColor);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface2 transition-colors cursor-pointer"
            >
              {tr("profile_cover_apply_color", "Terapkan Warna")}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
          <GhostButton type="button" onClick={handleReset} data-testid="cover-reset-btn">
            <RotateCcw size={14} />
            {tr("profile_cover_reset", "Reset Default")}
          </GhostButton>
          <AccentButton type="button" onClick={handleSave} disabled={saving || uploading} data-testid="cover-save-btn">
            {saving ? "Menyimpan..." : tr("profile_cover_save", "Simpan Cover")}
          </AccentButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const USER_FEED_CACHE = new Map();

function readCachedUserFeedHistory(uid, userMap) {
  if (!uid) return null;
  if (USER_FEED_CACHE.has(uid)) {
    return USER_FEED_CACHE.get(uid);
  }
  try {
    const raw = localStorage.getItem(`circle_user_feed_history_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        USER_FEED_CACHE.set(uid, parsed);
        return parsed;
      }
    }
  } catch {}
  // Fallback: extract posts/replies synchronously from Beranda/Dashboard feed cache so first visit is instant too
  try {
    const rawPosts =
      localStorage.getItem("circle_cache_posts_feed") ||
      localStorage.getItem("circle_cache_posts");
    if (rawPosts) {
      const posts = JSON.parse(rawPosts);
      if (Array.isArray(posts)) {
        const extracted = [];
        for (const post of posts) {
          if (post?.author_id === uid) extracted.push(post);
          if (Array.isArray(post?.replies_preview)) {
            for (const rep of post.replies_preview) {
              if (rep?.author_id === uid) {
                extracted.push({
                  ...rep,
                  parent_id: post.id,
                  parent_post: {
                    id: post.id,
                    text: post.text || "",
                    topic: post.topic || null,
                    author_id: post.author_id,
                    author_name: userMap?.[post.author_id]?.name || "Rekan Kerja",
                  },
                });
              }
            }
          }
        }
        extracted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return extracted;
      }
    }
  } catch {}
  return null;
}

export default function Profile() {
  const { uid } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { me, userMap, ws, online, reloadUsers, setSession, hasDeadlineToday, subscribe, t: tr } = useApp();
  const [rawP, setP] = useState(() => userMap?.[uid] || (uid === me?.user_id ? me : null));
  const [edit, setEdit] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [feedState, setFeedState] = useState(() => {
    const cached = readCachedUserFeedHistory(uid, userMap);
    return { uid, items: cached || [], loading: cached === null };
  });
  const [feedTab, setFeedTab] = useState("all");
  const navigate = useNavigate();

  const syncCachedFeed = readCachedUserFeedHistory(uid, userMap);
  const feedHistory = feedState.uid === uid ? feedState.items : (syncCachedFeed || []);
  const feedLoading = feedState.uid === uid ? feedState.loading : (syncCachedFeed === null);

  const loadFeedHistory = useCallback(() => {
    if (!uid) return;
    api.get(`/users/${uid}/posts`)
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        USER_FEED_CACHE.set(uid, list);
        try { localStorage.setItem(`circle_user_feed_history_${uid}`, JSON.stringify(list)); } catch {}
        setFeedState({ uid, items: list, loading: false });
      })
      .catch(() => {
        setFeedState((prev) => (prev.uid === uid ? { ...prev, loading: false } : { uid, items: [], loading: false }));
      });
  }, [uid]);

  const [profileMeetings, setProfileMeetings] = useState([]);
  const [statsPeriod, setStatsPeriod] = useState("week"); // "week" | "month"
  const [setMeetingOpen, setSetMeetingOpen] = useState(false);

  const loadProfileMeetings = useCallback(() => {
    if (!uid) return;
    api
      .get(`/meetings?user_id=${encodeURIComponent(uid)}`)
      .then((r) => {
        if (Array.isArray(r.data)) {
          setProfileMeetings(r.data);
        }
      })
      .catch(() => {});
  }, [uid]);

  useEffect(() => {
    const cachedFeed = readCachedUserFeedHistory(uid, userMap);
    setFeedState({
      uid,
      items: cachedFeed || [],
      loading: cachedFeed === null,
    });
    setFeedTab("all");
    const cachedUser = userMap?.[uid] || (uid === me?.user_id ? me : null);
    if (cachedUser) setP(cachedUser);
    api.get(`/users/${uid}`).then((r) => setP(r.data)).catch(() => {
      if (!cachedUser) navigate("/people");
    });
    loadFeedHistory();
    loadProfileMeetings();
  }, [uid, loadFeedHistory, loadProfileMeetings]); // eslint-disable-line

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((evt) => {
      if (evt?.type === "post:new" || evt?.type === "post:updated" || evt?.type === "post:deleted") {
        loadFeedHistory();
      }
      if (
        evt?.type === "meeting:new" ||
        evt?.type === "meeting:update" ||
        evt?.type === "meeting:delete" ||
        evt?.type === "meetings:synced"
      ) {
        loadProfileMeetings();
      }
    });
  }, [subscribe, loadFeedHistory, loadProfileMeetings]);

  const activeRawP = rawP?.user_id === uid ? rawP : null;
  const liveUser = (uid === me?.user_id ? me : null) || userMap?.[uid];
  const baseP = activeRawP || liveUser || { user_id: uid, name: "Employee", job_title: "Anggota Tim" };
  const p = liveUser
    ? {
        ...liveUser,
        ...baseP,
        online: liveUser.online ?? baseP.online,
        availability_status: liveUser.availability_status || baseP.availability_status,
        can_edit: baseP.can_edit ?? liveUser.can_edit,
      }
    : baseP;
  const syncSavedProfile = (d) => {
    if (!d?.user_id) return;
    setP(d);
    upsertAccountInVault(d);
    try {
      const cachedUsersRaw = localStorage.getItem("circle_users_cache");
      if (cachedUsersRaw) {
        const list = JSON.parse(cachedUsersRaw);
        if (Array.isArray(list)) {
          const next = list.map((u) => (u?.user_id === d.user_id ? { ...u, ...d } : u));
          localStorage.setItem("circle_users_cache", JSON.stringify(next));
        }
      }
    } catch {}
    if (d.user_id === me?.user_id) {
      setSession((s) => {
        if (!s) return s;
        const next = { ...s, user: { ...s.user, ...d } };
        try { localStorage.setItem("circle_session_cache", JSON.stringify(next)); } catch {}
        return next;
      });
    }
    reloadUsers();
  };
  const [dmBusy, setDmBusy] = useState(false);
  const openDm = async () => {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: uid });
      if (data?.id) {
        upsertConversationInCache(data, me?.user_id);
        navigate(`/messages/${data.id}`);
      }
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka pesan"));
    } finally {
      setDmBusy(false);
    }
  };
  const mgr = userMap[p.manager_id];
  const isDeadlineToday = Boolean(hasDeadlineToday?.(p.user_id));
  const canEdit = Boolean(p.can_edit || uid === me?.user_id || ["super_admin", "workspace_admin"].includes(me?.role));
  const profileComp = useMemo(() => getProfileCompletion(p), [p]);

  // Compute weekly & monthly meeting statistics for this profile user
  const meetingStats = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Current week (Monday - Sunday)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

    const fmtDate = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const weekStartStr = fmtDate(monday);
    const weekEndStr = fmtDate(sunday);

    // Current month
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const parseDurationMinutes = (m) => {
      if (!m?.start || !m?.end) return 60;
      const [sh, sm] = String(m.start).split(":").map(Number);
      const [eh, em] = String(m.end).split(":").map(Number);
      if (Number.isNaN(sh) || Number.isNaN(eh)) return 60;
      const diff = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
      return diff > 0 ? diff : 60;
    };

    const targetEmail = String(p?.email || "").toLowerCase();
    const belongsToProfile = (m) => {
      if (!m) return false;
      if (m.owner_user_id === uid || m.created_by === uid) return true;
      if (Array.isArray(m.attendee_ids) && m.attendee_ids.includes(uid)) return true;
      if (targetEmail && Array.isArray(m.attendee_emails) && m.attendee_emails.some((e) => String(e).toLowerCase() === targetEmail)) {
        return true;
      }
      if (!m.owner_user_id && (!Array.isArray(m.attendee_ids) || m.attendee_ids.length === 0)) return true;
      return false;
    };

    const userMeetings = (Array.isArray(profileMeetings) ? profileMeetings : []).filter(belongsToProfile);

    // Weekly buckets (Mon..Sun)
    const dayLabels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
    const weekBars = dayLabels.map((label, idx) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + idx);
      const dStr = fmtDate(d);
      return {
        key: dStr,
        label,
        isToday: dStr === todayStr,
        count: 0,
        minutes: 0,
      };
    });

    // Monthly buckets (Mgg 1..Mgg 4+)
    const monthBars = [
      { key: "w1", label: "Mgg 1", range: "1–7", count: 0, minutes: 0, isCurrent: now.getDate() <= 7 },
      { key: "w2", label: "Mgg 2", range: "8–14", count: 0, minutes: 0, isCurrent: now.getDate() >= 8 && now.getDate() <= 14 },
      { key: "w3", label: "Mgg 3", range: "15–21", count: 0, minutes: 0, isCurrent: now.getDate() >= 15 && now.getDate() <= 21 },
      { key: "w4", label: "Mgg 4+", range: "22–31", count: 0, minutes: 0, isCurrent: now.getDate() >= 22 },
    ];

    let weekCount = 0;
    let weekMinutes = 0;
    let monthCount = 0;
    let monthMinutes = 0;

    for (const m of userMeetings) {
      const dStr = String(m.date || "").slice(0, 10);
      if (!dStr) continue;
      const mins = parseDurationMinutes(m);

      if (dStr >= weekStartStr && dStr <= weekEndStr) {
        weekCount += 1;
        weekMinutes += mins;
        const bar = weekBars.find((b) => b.key === dStr);
        if (bar) {
          bar.count += 1;
          bar.minutes += mins;
        }
      }

      if (dStr.startsWith(monthPrefix)) {
        monthCount += 1;
        monthMinutes += mins;
        const dayNum = Number(dStr.slice(8, 10)) || 1;
        const bucketIdx = dayNum <= 7 ? 0 : dayNum <= 14 ? 1 : dayNum <= 21 ? 2 : 3;
        monthBars[bucketIdx].count += 1;
        monthBars[bucketIdx].minutes += mins;
      }
    }

    const upcomingNext = userMeetings
      .filter((m) => String(m.date || "") >= todayStr)
      .sort((a, b) => `${a.date} ${a.start || "00:00"}`.localeCompare(`${b.date} ${b.start || "00:00"}`))[0] || null;

    const formatHours = (mins) => {
      if (mins <= 0) return "0";
      const hrs = mins / 60;
      return Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1);
    };

    const isWeek = statsPeriod === "week";
    const activeCount = isWeek ? weekCount : monthCount;
    const activeMinutes = isWeek ? weekMinutes : monthMinutes;
    const activeHours = formatHours(activeMinutes);
    const avgMinutes = activeCount > 0 ? Math.round(activeMinutes / activeCount) : 0;
    const bars = isWeek ? weekBars : monthBars;
    const maxMinutes = Math.max(...bars.map((b) => b.minutes), 60);
    // Reference capacity: 15h/week or 60h/month
    const targetCapMinutes = isWeek ? 15 * 60 : 60 * 60;
    const loadPct = Math.min(100, Math.round((activeMinutes / targetCapMinutes) * 100));

    return {
      activeCount,
      activeMinutes,
      activeHours,
      avgMinutes,
      bars,
      maxMinutes,
      loadPct,
      weekCount,
      weekHours: formatHours(weekMinutes),
      monthCount,
      monthHours: formatHours(monthMinutes),
      upcomingNext,
    };
  }, [profileMeetings, statsPeriod, uid, p?.email]);

  useEffect(() => {
    if (searchParams.get("edit") === "1" && canEdit) {
      setEdit(true);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("edit");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, canEdit, setSearchParams]);

  const postItems = useMemo(() => feedHistory.filter((item) => !item.parent_id), [feedHistory]);
  const replyItems = useMemo(() => feedHistory.filter((item) => Boolean(item.parent_id)), [feedHistory]);
  const filteredFeed = useMemo(() => {
    if (feedTab === "posts") return postItems;
    if (feedTab === "replies") return replyItems;
    return feedHistory;
  }, [feedHistory, postItems, replyItems, feedTab]);

  const canSeeField = (vis) => {
    if (!vis || vis === "everyone") return true;
    if (uid === me?.user_id || ["super_admin", "workspace_admin"].includes(me?.role)) return true;
    if (vis === "managers") return Boolean(p.manager_id === me?.user_id || ["manager", "department_manager", "project_manager"].includes(me?.role));
    return false;
  };
  const fv = ws?.field_visibility || {};
  const info = [
    [Mail, tr("profile_info_email", "Email"), p.email, "email"],
    [Phone, tr("profile_info_phone", "Telepon"), p.phone, "phone"],
    [IdCard, tr("profile_info_empid", "ID Employee"), p.employee_id, "employee_id"],
    [Briefcase, tr("profile_info_employment", "Kepegawaian"), EMPLOYMENT_LABELS[p.employment_status] || p.employment_status, "employment_status"],
    [Calendar, tr("profile_info_join", "Bergabung"), p.join_date, "join_date"],
    [MapPin, tr("profile_info_location", "Lokasi"), [p.office, p.city, (p.work_mode === "Custom" || p.work_mode === "Kustom") ? p.custom_location : p.work_mode].filter(Boolean).join(" · ")],
    [Users2, tr("profile_info_division", "Divisi / Tim"), [p.division, p.team].filter(Boolean).join(" / ")],
  ].filter((x) => x[2] && canSeeField(x[3] ? fv[x[3]] : "everyone"));
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-10 animate-subpage-enter" data-testid="profile-page">
      <div className="card overflow-hidden">
        <div
          className="relative h-32 w-full overflow-hidden sm:h-40"
          style={!p.cover_image ? { background: p.cover_bg || DEFAULT_COVER_BG } : undefined}
          data-testid="profile-cover-banner"
        >
          {p.cover_image && (
            <img
              src={p.cover_image}
              alt={`Cover ${p.name}`}
              className={`h-full w-full object-cover ${
                p.cover_position === "top"
                  ? "object-top"
                  : p.cover_position === "bottom"
                  ? "object-bottom"
                  : "object-center"
              }`}
              referrerPolicy="no-referrer"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />
          {canEdit && (
            <button
              type="button"
              onClick={() => setCoverOpen(true)}
              data-testid="profile-cover-btn"
              className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-xl bg-slate-900/55 hover:bg-slate-900/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md border border-white/15 shadow-sm transition-all cursor-pointer"
            >
              <Palette size={14} />
              <span>{tr("profile_edit_cover_btn", "Ubah Cover")}</span>
            </button>
          )}
        </div>
        <div className="px-4 pb-5 pt-3.5 sm:px-8 sm:pb-6 sm:pt-4">
          <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5 min-w-0 flex-1">
              <div className="-mt-14 sm:-mt-16 w-fit shrink-0 rounded-full p-1 bg-[var(--c-surface)] shadow-sm">
                <Avatar user={p} size={96} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl sm:text-3xl font-bold tracking-tight leading-snug text-ink" data-testid="profile-name">
                  <span>{p.name}</span>
                  <VerifiedBadge user={p} size={22} />
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <p className="text-sub" data-testid="profile-job-title">
                    {p.job_title || tr("profile_no_job_title", "Belum ada jabatan")}{p.department && ` · ${p.department}`}
                  </p>
                  {(() => {
                    const lvl = inferUserOrgLevel(p, DEFAULT_ORG_LEVELS);
                    const meta = getOrgLevelMeta(lvl, DEFAULT_ORG_LEVELS);
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}
                        data-testid="profile-org-level-badge"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.rank}. {meta.label}
                      </span>
                    );
                  })()}
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  {(() => {
                    const statusMeta = getAvailabilityStatusMeta(p.availability_status);
                    const isOn = online.has(p.user_id) || p.online;
                    if (statusMeta.value !== "online") {
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold ${statusMeta.badgeClass}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                      );
                    }
                    return (
                      <span className={isOn ? "text-emerald-600 font-semibold" : "text-sub"}>
                        {isOn ? tr("profile_status_online", "● Online") : tr("profile_status_offline", "○ Offline")}
                      </span>
                    );
                  })()}
                  {p.location_status && <span className="text-sub"> · {p.location_status}</span>}
                  {isDeadlineToday ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2.5 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]" /> {tr("profile_deadline_today", "Ada Deadline Hari Ini")}
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" /> {tr("profile_deadline_free", "Bebas Deadline")}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pt-0.5">
              {uid !== me.user_id && <>
                <AccentButton onClick={openDm} disabled={dmBusy} data-testid="profile-message-btn"><MessageCircle size={16} />{tr("profile_msg_btn", "Pesan")}</AccentButton>
              </>}
              {canEdit && <GhostButton onClick={() => setEdit(true)} data-testid="profile-edit-btn"><Pencil size={15} />{tr("profile_edit_btn", "Ubah")}</GhostButton>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3 min-w-0">
        <div className="min-w-0 space-y-5">
          {uid === me?.user_id && !profileComp.isVerified && (
            <section className="card min-w-0 overflow-hidden p-4 sm:p-5 border-sky-200/80 dark:border-sky-800/70 bg-gradient-to-br from-sky-50/60 to-surface dark:from-sky-950/30 dark:to-surface" data-testid="profile-verify-cta">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-ink">{tr("profile_verify_cta_title", "Dapatkan Centang Verified")}</h3>
                    <p className="text-[11px] text-sub">Kelengkapan profil {profileComp.percent}% ({profileComp.filledCount}/{profileComp.totalCount})</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                <div className="h-full rounded-full bg-sky-500 transition-all duration-300" style={{ width: `${profileComp.percent}%` }} />
              </div>
              <p className="mt-2.5 text-xs text-sub leading-relaxed">
                Lengkapi {profileComp.missingFields.length} kolom tersisa agar akun Anda terverifikasi di workspace.
              </p>
              <button
                type="button"
                onClick={() => setEdit(true)}
                data-testid="profile-complete-now-btn"
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-xs font-bold text-white transition-colors"
              >
                <BadgeCheck size={15} />
                <span>{tr("profile_verify_cta_btn", "Lengkapi Profil 100%")}</span>
              </button>
            </section>
          )}
          <section className="card min-w-0 overflow-hidden p-4 sm:p-5"><h3 className="mb-3 text-sm font-bold">{tr("profile_about_title", "Tentang")}</h3><p className="text-sm text-sub break-words">{p.bio || tr("profile_no_bio", "Belum ada biodata.")}</p>
            {p.skills?.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full bg-soft-purple px-2.5 py-1 text-xs font-medium">{s}</span>)}</div>}</section>

          <section className="card min-w-0 overflow-hidden space-y-3 p-4 sm:p-5" data-testid="profile-contact-info">
            {info.map(([I, l, v]) => <div key={l} className="flex items-center gap-2.5 sm:gap-3 text-sm min-w-0"><I size={15} className="text-sub shrink-0" /><span className="w-24 sm:w-28 shrink-0 text-sub">{l}</span><span className="min-w-0 flex-1 truncate font-medium">{v}</span></div>)}
            {mgr && <button onClick={() => navigate(`/people/${mgr.user_id}`)} className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-surface2 p-2 text-left text-sm"><Avatar user={mgr} size={28} showStatus={false} /><span className="min-w-0"><span className="block text-[11px] text-sub">{tr("profile_reports_to", "Melapor ke")}</span><span className="block truncate font-semibold">{mgr.name}</span></span></button>}
            {(ws.profile_fields || [])
              .filter((cf) => canSeeField(cf.visibility) && (p.custom?.[cf.key] ?? p.custom_fields?.[cf.key]) !== undefined && (p.custom?.[cf.key] ?? p.custom_fields?.[cf.key]) !== "")
              .map((cf) => {
                const rawVal = p.custom?.[cf.key] ?? p.custom_fields?.[cf.key];
                const displayVal = typeof rawVal === "boolean" ? (rawVal ? "Ya" : "Tidak") : Array.isArray(rawVal) ? rawVal.join(", ") : String(rawVal);
                return (
                  <div key={cf.key} className="flex items-center gap-2.5 sm:gap-3 text-sm min-w-0">
                    <Link2 size={15} className="text-sub shrink-0" />
                    <span className="w-24 sm:w-28 shrink-0 text-sub">{cf.name}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{displayVal}</span>
                  </div>
                );
              })}
          </section>

          {/* Statistik & Jadwal Meeting Card */}
          <section
            className="card min-w-0 overflow-hidden p-4 sm:p-5"
            data-testid="profile-meeting-stats-card"
          >
            <div className="flex items-center justify-between gap-2 mb-3.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-ink">
                  <Calendar size={14} className="text-brand" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-ink truncate">
                    {tr("profile_meeting_stats_title", "Statistik Meeting")}
                  </h3>
                </div>
              </div>

              {/* Segmented Period Toggle */}
              <div
                className="inline-flex items-center rounded-lg bg-surface2 p-0.5 text-[11px] font-semibold shrink-0"
                data-testid="profile-meeting-stats-period"
              >
                <button
                  type="button"
                  onClick={() => setStatsPeriod("week")}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    statsPeriod === "week"
                      ? "bg-surface text-ink shadow-2xs"
                      : "text-sub hover:text-ink"
                  }`}
                >
                  Minggu Ini
                </button>
                <button
                  type="button"
                  onClick={() => setStatsPeriod("month")}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    statsPeriod === "month"
                      ? "bg-surface text-ink shadow-2xs"
                      : "text-sub hover:text-ink"
                  }`}
                >
                  Bulan Ini
                </button>
              </div>
            </div>

            {/* Minimalist Metric Summary Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-surface2/40 p-3">
                <div className="flex items-center justify-between text-[11px] font-medium text-sub">
                  <span>Jumlah Meeting</span>
                  <Video size={12} className="text-sub/70" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className="text-2xl font-extrabold tracking-tight text-ink tabular-nums"
                    data-testid="profile-meeting-count"
                  >
                    {meetingStats.activeCount}
                  </span>
                  <span className="text-[11px] font-medium text-sub">sesi</span>
                </div>
                <p className="mt-0.5 text-[10.5px] text-sub tabular-nums">
                  {statsPeriod === "week"
                    ? `${meetingStats.monthCount} sesi bulan ini`
                    : `${meetingStats.weekCount} sesi minggu ini`}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-surface2/40 p-3">
                <div className="flex items-center justify-between text-[11px] font-medium text-sub">
                  <span>Total Durasi</span>
                  <Clock size={12} className="text-sub/70" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className="text-2xl font-extrabold tracking-tight text-ink tabular-nums"
                    data-testid="profile-meeting-hours"
                  >
                    {meetingStats.activeHours}
                  </span>
                  <span className="text-[11px] font-medium text-sub">jam</span>
                </div>
                <p className="mt-0.5 text-[10.5px] text-sub tabular-nums">
                  {meetingStats.avgMinutes > 0
                    ? `Rata-rata ${meetingStats.avgMinutes} mnt/sesi`
                    : "Belum ada durasi tercatat"}
                </p>
              </div>
            </div>

            {/* Minimalist Graphic: Distribution Bar Chart */}
            <div className="mt-3.5 rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-surface2/30 px-3.5 pt-3 pb-2.5">
              <div className="flex items-center justify-between text-[11px] mb-2.5">
                <span className="font-semibold text-sub">
                  {statsPeriod === "week" ? "Distribusi Jam (Sen–Min)" : "Distribusi Mingguan"}
                </span>
                <span className="font-semibold text-ink tabular-nums">
                  {meetingStats.loadPct}% beban rapat
                </span>
              </div>

              <div className="flex items-end justify-between gap-1.5 h-16 pt-2">
                {meetingStats.bars.map((bar) => {
                  const pct = bar.minutes > 0 ? Math.max(18, Math.round((bar.minutes / meetingStats.maxMinutes) * 100)) : 8;
                  const hrsLabel = bar.minutes > 0 ? `${(bar.minutes / 60).toFixed(bar.minutes % 60 === 0 ? 0 : 1)}j` : "";
                  const isHighlighted = Boolean(bar.isToday || bar.isCurrent);
                  return (
                    <div
                      key={bar.key}
                      className="group relative flex-1 flex flex-col items-center h-full justify-end"
                      title={`${bar.label}: ${bar.count} meeting (${(bar.minutes / 60).toFixed(1)} jam)`}
                    >
                      {hrsLabel && (
                        <span className="mb-1 text-[9.5px] font-bold text-sub tabular-nums leading-none">
                          {hrsLabel}
                        </span>
                      )}
                      <div className="w-full max-w-[24px] h-10 flex items-end rounded-md bg-slate-200/60 dark:bg-slate-800/70 overflow-hidden p-0.5">
                        <div
                          className={`w-full rounded-xs transition-all duration-300 ${
                            bar.minutes > 0
                              ? isHighlighted
                                ? "bg-brand"
                                : "bg-slate-700 dark:bg-slate-300"
                              : "bg-slate-300/60 dark:bg-slate-700/50"
                          }`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={`mt-1.5 text-[10px] font-semibold leading-none ${
                          isHighlighted ? "text-brand font-bold" : "text-sub"
                        }`}
                      >
                        {bar.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Minimalist Workload Capacity Line */}
              <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-800/70">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      meetingStats.loadPct > 75
                        ? "bg-rose-500"
                        : meetingStats.loadPct > 40
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.max(4, meetingStats.loadPct)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Action Button: Set Meeting dengan [Nama Profil] */}
            <button
              type="button"
              onClick={() => setSetMeetingOpen(true)}
              data-testid="profile-set-meeting-btn"
              className="mt-3.5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ink dark:bg-white text-white dark:text-slate-900 hover:opacity-95 px-3.5 py-2.5 text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <CalendarPlus size={15} className="text-brand dark:text-rose-600 shrink-0" />
              <span className="truncate">Set Meeting dengan {p.name}</span>
            </button>
            <p className="mt-1.5 text-center text-[10.5px] text-sub flex items-center justify-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
              <span>Terkoneksi otomatis dengan Google Calendar</span>
            </p>
          </section>
        </div>
        <section className="card min-w-0 overflow-hidden p-4 sm:p-5 lg:col-span-2" data-testid="profile-feed-history">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Newspaper size={16} className="text-brand shrink-0" />
              <h3 className="text-sm font-bold text-ink">{tr("profile_feed_title", "Riwayat Aktivitas Feed")}</h3>
              <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-sub">
                {feedHistory.length}
              </span>
            </div>
            <div className="inline-flex items-center rounded-xl bg-surface2 p-0.5 text-xs font-semibold" data-testid="profile-feed-tabs">
              {[
                { key: "all", label: `${tr("profile_feed_tab_all", "Semua")} (${feedHistory.length})` },
                { key: "posts", label: `${tr("profile_feed_tab_posts", "Postingan")} (${postItems.length})` },
                { key: "replies", label: `${tr("profile_feed_tab_replies", "Balasan")} (${replyItems.length})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFeedTab(tab.key)}
                  data-testid={`profile-feed-tab-${tab.key}`}
                  className={`rounded-lg px-2.5 py-1 transition-colors ${
                    feedTab === tab.key
                      ? "bg-surface text-ink shadow-xs"
                      : "text-sub hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {feedLoading ? (
            <div className="py-10 flex justify-center">
              <Spinner label={tr("profile_feed_loading", "Memuat riwayat feed")} />
            </div>
          ) : filteredFeed.length > 0 ? (
            <div className="space-y-2.5">
              {filteredFeed.map((item) => {
                const isReply = Boolean(item.parent_id);
                const targetPostId = item.parent_id || item.id;
                const attachmentCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
                const reactionTotal = Object.values(item.reactions || {}).reduce(
                  (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
                  0
                );
                const totalLikes = (item.like_count || 0) + reactionTotal;

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/beranda/${targetPostId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/beranda/${targetPostId}`);
                      }
                    }}
                    data-testid={`profile-feed-item-${item.id}`}
                    className="group block w-full cursor-pointer rounded-2xl border border-slate-200/80 dark:border-slate-800/90 bg-surface2/40 hover:bg-surface2/80 p-3.5 text-left transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            isReply
                              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                              : "bg-soft-red text-brand"
                          }`}
                        >
                          {isReply ? <CornerDownRight size={11} /> : <Newspaper size={11} />}
                          {isReply ? tr("profile_feed_tab_replies", "Balasan") : tr("profile_feed_tab_posts", "Postingan")}
                        </span>
                        {item.topic && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-sub border border-slate-200/70 dark:border-slate-700/70">
                            <Hash size={10} />
                            {item.topic}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-sub">
                        <span>{rel(item.created_at)}</span>
                        <ArrowUpRight size={13} className="opacity-0 group-hover:opacity-100 text-brand transition-opacity" />
                      </span>
                    </div>

                    {isReply && item.parent_post && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border-l-2 border-brand/50 bg-surface/80 px-2.5 py-1.5 text-xs text-sub">
                        <span className="min-w-0 line-clamp-1">
                          {tr("profile_feed_reply_prefix", "Membalas")}{" "}
                          {item.parent_post.author_id ? (
                            <Link
                              to={`/people/${item.parent_post.author_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-ink font-semibold hover:underline"
                            >
                              {item.parent_post.author_name}
                            </Link>
                          ) : (
                            <strong className="text-ink font-semibold">{item.parent_post.author_name}</strong>
                          )}
                          {item.parent_post.text ? `: "${item.parent_post.text}"` : ""}
                        </span>
                      </div>
                    )}

                    {item.text && (
                      <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words line-clamp-4 leading-relaxed">
                        <MentionText text={item.text} mentionIds={item.mention_ids} />
                      </p>
                    )}

                    {item.poll?.question && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-soft-purple px-2.5 py-1 text-xs font-medium text-ink">
                        <BarChart3 size={13} className="text-purple-600 dark:text-purple-300 shrink-0" />
                        <span className="truncate max-w-xs">{tr("profile_feed_poll_prefix", "Polling:")} {item.poll.question}</span>
                      </div>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-sub">
                      <span className="inline-flex items-center gap-1">
                        <Heart size={12} className={item.liked ? "text-rose-500 fill-rose-500" : ""} />
                        {totalLikes}
                      </span>
                      {!isReply && (
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle size={12} />
                          {item.reply_count || 0} balasan
                        </span>
                      )}
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} />
                          {attachmentCount} {tr("profile_feed_attachments_unit", "lampiran")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 py-10 px-4 text-center">
              <p className="text-sm font-semibold text-ink">
                {feedTab === "posts"
                  ? tr("profile_feed_empty_posts", "Belum ada postingan di Beranda.")
                  : feedTab === "replies"
                  ? tr("profile_feed_empty_replies", "Belum ada balasan di Beranda.")
                  : tr("profile_feed_empty_all", "Belum ada aktivitas di Feed Beranda.")}
              </p>
              <p className="mt-1 text-xs text-sub">
                {tr("profile_feed_empty_desc", "Semua postingan dan balasan yang dikirim ke Beranda akan tercatat di sini.")}
              </p>
            </div>
          )}
        </section>
      </div>
      <EditProfile
        open={edit}
        onOpenChange={setEdit}
        p={p}
        onSaved={syncSavedProfile}
      />
      <CustomizeCoverDialog
        open={coverOpen}
        onOpenChange={setCoverOpen}
        p={p}
        onSaved={syncSavedProfile}
      />
      <SetProfileMeetingDialog
        open={setMeetingOpen}
        onOpenChange={setSetMeetingOpen}
        profileUser={p}
        me={me}
        onCreated={() => {
          loadProfileMeetings();
        }}
      />
    </div>
  );
}

function buildGoogleCalendarTemplateUrl({ title, date, start, end, location, notes, attendeeEmail }) {
  try {
    const cleanDate = String(date || "").replace(/-/g, "");
    const cleanStart = String(start || "10:00").replace(/:/g, "") + "00";
    const cleanEnd = String(end || "11:00").replace(/:/g, "") + "00";
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title || "Meeting",
      dates: `${cleanDate}T${cleanStart}/${cleanDate}T${cleanEnd}`,
      details: notes || "Jadwal meeting dari ASLI Workspace",
      location: location || "Google Meet",
    });
    if (attendeeEmail) {
      params.set("add", attendeeEmail);
    }
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  } catch {
    return "https://calendar.google.com";
  }
}

function SetProfileMeetingDialog({ open, onOpenChange, profileUser, me, onCreated }) {
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const defaultTitle = useMemo(() => {
    const myFirst = me?.name?.split(" ")[0] || "Tim";
    const targetFirst = profileUser?.name?.split(" ")[0] || "Rekan";
    return me?.user_id === profileUser?.user_id
      ? `Focus / Jadwal Meeting — ${targetFirst}`
      : `Sync Meeting: ${myFirst} & ${targetFirst}`;
  }, [me?.name, me?.user_id, profileUser?.name, profileUser?.user_id]);

  const [title, setTitle] = useState(defaultTitle);
  const [date, setDate] = useState(todayStr);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [location, setLocation] = useState("Google Meet");
  const [notes, setNotes] = useState("");
  const [autoGcal, setAutoGcal] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setDate(todayStr);
      setStart("10:00");
      setEnd("11:00");
      setLocation("Google Meet");
      setNotes("");
      setAutoGcal(true);
    }
  }, [open, defaultTitle, todayStr]);

  const durationLabel = useMemo(() => {
    const [sh, sm] = String(start || "10:00").split(":").map(Number);
    const [eh, em] = String(end || "11:00").split(":").map(Number);
    if (Number.isNaN(sh) || Number.isNaN(eh)) return "1 jam";
    const mins = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
    if (mins <= 0) return "Durasi tidak valid";
    const hrs = mins / 60;
    return hrs >= 1
      ? `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} jam (${mins} mnt)`
      : `${mins} menit`;
  }, [start, end]);

  const connectedEmail = getConnectedCalendarEmail();

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!title.trim()) {
      toast.error("Judul meeting wajib diisi");
      return;
    }
    setSubmitting(true);
    try {
      const attendeeIds = Array.from(
        new Set([me?.user_id, profileUser?.user_id].filter(Boolean))
      );
      const attendeeEmails = Array.from(
        new Set([me?.email, profileUser?.email].filter(Boolean))
      );

      let gcalEventId = null;
      let gcalHtmlLink = null;
      let syncedViaApi = false;

      if (autoGcal) {
        try {
          let token = await getAccessToken();
          if (!token) {
            try {
              const authRes = await googleCalendarOAuthSignIn();
              token = authRes?.accessToken || null;
            } catch {
              token = null;
            }
          }

          if (token) {
            const startIso = new Date(`${date}T${start}:00`).toISOString();
            const endIso = new Date(`${date}T${end}:00`).toISOString();
            const gcalPayload = {
              summary: title.trim(),
              location: location.trim() || "Google Meet",
              description: notes.trim() || `Dijadwalkan melalui profil ${profileUser?.name} di ASLI Workspace`,
              start: { dateTime: startIso },
              end: { dateTime: endIso },
              attendees: attendeeEmails
                .filter((em) => em && em.includes("@"))
                .map((email) => ({ email })),
            };
            const createdGcal = await createEvent(gcalPayload);
            if (createdGcal?.id) {
              gcalEventId = createdGcal.id;
              gcalHtmlLink = createdGcal.htmlLink || null;
              syncedViaApi = true;
            }
          }
        } catch (gcalErr) {
          console.warn("Auto GCal API push fallback:", gcalErr);
        }
      }

      const templateUrl = buildGoogleCalendarTemplateUrl({
        title: title.trim(),
        date,
        start,
        end,
        location: location.trim(),
        notes: notes.trim(),
        attendeeEmail: profileUser?.email,
      });

      const payload = {
        title: title.trim(),
        date,
        start,
        end,
        location: location.trim() || "Google Meet",
        notes: notes.trim(),
        attendee_ids: attendeeIds,
        attendee_emails: attendeeEmails,
        owner_user_id: me?.user_id,
        source: syncedViaApi ? "google_calendar" : "local",
        gcal_id: gcalEventId,
        html_link: gcalHtmlLink || templateUrl,
      };

      await api.post("/meetings", payload);
      syncWorkspaceMirror();

      if (syncedViaApi) {
        toast.success(`Meeting dengan ${profileUser?.name} berhasil dijadwalkan & tersinkron otomatis ke Google Calendar!`);
      } else if (autoGcal) {
        toast.success(`Meeting dengan ${profileUser?.name} tersimpan! Mengarahkan sinkronisasi Google Calendar...`, {
          action: {
            label: "Buka Google Calendar",
            onClick: () => {
              const a = document.createElement("a");
              a.href = templateUrl;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.click();
            },
          },
        });
      } else {
        toast.success(`Meeting dengan ${profileUser?.name} berhasil dijadwalkan!`);
      }

      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err, "Gagal menjadwalkan meeting"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <CalendarPlus size={18} className="text-brand" />
            <span>Set Meeting dengan {profileUser?.name}</span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          {/* Attendee Pill */}
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-surface2/60 p-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar user={profileUser} size={34} showStatus={false} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink truncate">{profileUser?.name}</p>
                <p className="text-[11px] text-sub truncate">
                  {profileUser?.email || profileUser?.job_title || "Peserta Meeting"}
                </p>
              </div>
            </div>
            <span className="rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/70 dark:border-emerald-800/60 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
              Peserta Utama
            </span>
          </div>

          <Field label="Judul / Topik Meeting">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Weekly Sync / Review Project"
              className={inp}
              required
              data-testid="profile-meeting-title-input"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-1">
              <Field label="Tanggal">
                <DatePicker
                  showQuickPresets={false}
                  value={date}
                  onChange={setDate}
                  className={inp}
                />
              </Field>
            </div>
            <div>
              <Field label="Jam Mulai">
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className={`${inp} tabular-nums`}
                  required
                />
              </Field>
            </div>
            <div>
              <Field label="Jam Selesai">
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className={`${inp} tabular-nums`}
                  required
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-sub px-1">
            <span>Estimasi Durasi Meeting:</span>
            <span className="font-bold text-ink tabular-nums">{durationLabel}</span>
          </div>

          <Field label="Lokasi / Link Meeting">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Google Meet, Zoom, atau Ruang Rapat"
              className={inp}
            />
          </Field>

          <Field label="Agenda / Catatan (Opsional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tulis poin agenda diskusi..."
              className={`${inp} h-16 py-2 resize-none`}
            />
          </Field>

          {/* Auto Google Calendar Connection Toggle */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/25 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-xs font-bold text-ink">
                  Sinkron Otomatis ke Google Calendar
                </p>
              </div>
              <p className="mt-0.5 text-[11px] text-sub truncate">
                {connectedEmail
                  ? `Terhubung ke ${connectedEmail} & undang ${profileUser?.email || profileUser?.name}`
                  : `Otomatis buat event & undang ${profileUser?.email || profileUser?.name} di Google Calendar`}
              </p>
            </div>
            <Switch checked={autoGcal} onCheckedChange={setAutoGcal} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <GhostButton type="button" onClick={() => onOpenChange(false)}>
              Batal
            </GhostButton>
            <AccentButton
              type="submit"
              disabled={submitting}
              data-testid="profile-meeting-submit-btn"
            >
              <CalendarPlus size={15} />
              <span>{submitting ? "Menjadwalkan..." : "Jadwalkan & Sinkron"}</span>
            </AccentButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

