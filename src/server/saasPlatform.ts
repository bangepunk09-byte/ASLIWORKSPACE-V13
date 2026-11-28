import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken, validatePasswordPolicy } from "./security.js";

export const DEFAULT_ROOM_SLUG = "asli-workspace";
export const PLATFORM_OWNER_DEFAULT_EMAIL = "owner@asliworkspace.id";
export const PLATFORM_OWNER_DEFAULT_PASS = "AsliOwner2026!";

export interface SaaSPlan {
  id: string;
  name: string;
  badge: string;
  description: string;
  monthly_price: number;
  annual_price: number;
  max_members: number;
  storage_mb: number;
  highlight?: boolean;
  is_active: boolean;
  features: string[];
}

export interface RoomMeta {
  slug: string;
  name: string;
  brand_name: string;
  invite_code: string;
  custom_domain: string;
  status: "active" | "suspended";
  plan_id: string;
  billing_cycle: "monthly" | "annual";
  owner_email: string;
  owner_name: string;
  created_at: string;
  last_active_at: string;
  expires_at?: string;
  telemetry: {
    req_24h: number;
    errors_4xx: number;
    errors_5xx: number;
    last_request_at: string;
  };
}

export interface SaaSTransaction {
  id: string;
  invoice_no: string;
  room_slug: string;
  room_name: string;
  plan_id: string;
  plan_name: string;
  billing_cycle: "monthly" | "annual";
  amount: number;
  method: string;
  gateway_mode: "sandbox" | "live";
  gateway_provider: string;
  payer_email: string;
  status: "paid" | "pending" | "failed";
  created_at: string;
  paid_at?: string;
  snap_url?: string;
  va_number?: string;
}

export interface PaymentGatewayConfig {
  mode: "sandbox" | "live";
  live_provider: "midtrans" | "xendit";
  midtrans_is_production: boolean;
  enabled_channels: string[];
  updated_at: string;
}

export interface GovernancePolicies {
  enforce_free_quota: boolean;
  local_gateway_enabled: boolean;
  custom_domain_cname: boolean;
  firestore_backup_sync: boolean;
  security_anomaly_alert: boolean;
  soft_delete_grace: boolean;
}

export interface PlatformSnapshot {
  id: string;
  created_at: string;
  created_by: string;
  rooms_count: number;
  total_size_kb: number;
  note: string;
}

export const DEFAULT_SAAS_PLANS: SaaSPlan[] = [
  {
    id: "free_starter",
    name: "Free Starter",
    badge: "Gratis",
    description: "Paket dasar untuk tim kecil hingga 5 anggota.",
    monthly_price: 0,
    annual_price: 0,
    max_members: 5,
    storage_mb: 512,
    highlight: false,
    is_active: true,
    features: [
      "Maksimal 5 anggota tim aktif",
      "Chat, Grup Divisi, Beranda & Kanban Tugas",
      "Sinkronisasi Google Calendar & Google Drive",
      "Penyimpanan workspace 512 MB",
    ],
  },
  {
    id: "growth_team",
    name: "Growth Team",
    badge: "Populer",
    description: "Untuk tim berkembang yang membutuhkan kuota hingga 25 anggota.",
    monthly_price: 149000,
    annual_price: 1490000,
    max_members: 25,
    storage_mb: 5120,
    highlight: true,
    is_active: true,
    features: [
      "Hingga 25 anggota tim aktif",
      "Penyimpanan workspace 5 GB",
      "Undangan Email & Google Workspace Sync penuh",
      "Auto Backup harian & Log Audit lengkap",
    ],
  },
  {
    id: "business_pro",
    name: "Business Pro",
    badge: "Terbaik",
    description: "Untuk perusahaan menengah hingga 100 karyawan aktif.",
    monthly_price: 399000,
    annual_price: 3990000,
    max_members: 100,
    storage_mb: 20480,
    highlight: false,
    is_active: true,
    features: [
      "Hingga 100 anggota tim aktif",
      "Penyimpanan workspace 20 GB",
      "Custom Domain Perusahaan (CNAME)",
      "Laporan Mingguan Email & Priority Support",
    ],
  },
  {
    id: "enterprise_scale",
    name: "Enterprise Scale",
    badge: "Enterprise",
    description: "Skala organisasi besar dengan kuota hingga 500 anggota.",
    monthly_price: 999000,
    annual_price: 9990000,
    max_members: 500,
    storage_mb: 102400,
    highlight: false,
    is_active: true,
    features: [
      "Hingga 500 anggota tim aktif",
      "Penyimpanan workspace 100 GB",
      "Custom Domain & Kontrol Kebijakan Penuh",
      "Dedicated Backup & Pemulihan Instan",
    ],
  },
];

export const roomAls = new AsyncLocalStorage<{ slug: string; db: Record<string, any> }>();

export function slugifyRoom(raw: string): string {
  return (
    String(raw || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace-baru"
  );
}

export function validateCustomInviteCode(raw: string): { ok: boolean; code: string; error?: string } {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { ok: false, code: "", error: "Kode undangan room wajib diisi." };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, code: "", error: "Kode undangan room tidak boleh mengandung spasi." };
  }
  const code = trimmed.toUpperCase();
  if (code.length < 9) {
    return { ok: false, code, error: "Kode undangan room minimal 9 karakter." };
  }
  if (code.length > 32) {
    return { ok: false, code, error: "Kode undangan room maksimal 32 karakter." };
  }
  if (!/[0-9]/.test(code)) {
    return { ok: false, code, error: "Kode undangan room wajib mengandung minimal 1 angka (0-9)." };
  }
  if (!/[^A-Z0-9]/.test(code)) {
    return { ok: false, code, error: "Kode undangan room wajib mengandung minimal 1 simbol (cth: -, #, @, !, _)." };
  }
  return { ok: true, code };
}

export function generateInviteCode(slug: string, existingCodes?: Set<string>): string {
  const prefix =
    slug
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase()
      .slice(0, 4)
      .padEnd(4, "X") || "ROOM";
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = ["#", "@", "!", "*"];
  for (let attempt = 0; attempt < 30; attempt++) {
    const b = crypto.randomBytes(6);
    const part = `${letters[b[0] % letters.length]}${digits[b[1] % digits.length]}${letters[b[2] % letters.length]}${digits[b[3] % digits.length]}`;
    const sym = symbols[b[4] % symbols.length];
    const tail = `${digits[b[5] % digits.length]}${(b[0] + b[3]) % 10}`;
    const candidate = `${prefix}-${part}${sym}${tail}`;
    if (!existingCodes || !existingCodes.has(candidate)) {
      return candidate;
    }
  }
  const fallback = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${fallback}#9`;
}

export function createScopedDbProxy(defaultDb: Record<string, any>): Record<string, any> {
  return new Proxy(defaultDb, {
    get(_target, prop) {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      const val = Reflect.get(target, prop);
      return typeof val === "function" ? val.bind(target) : val;
    },
    set(_target, prop, value) {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      return Reflect.set(target, prop, value);
    },
    deleteProperty(_target, prop) {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys() {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    has(_target, prop) {
      const store = roomAls.getStore();
      const target = store?.db || defaultDb;
      return Reflect.has(target, prop);
    },
  });
}

export function createFreshRoomDb(params: {
  slug: string;
  workspaceName: string;
  tagline?: string;
  description?: string;
  orgLevels?: string[];
  divisions?: string[];
  logoFileId?: string | null;
  faviconFileId?: string | null;
  loginImageFileId?: string | null;
  allowedDomains?: string[];
  autoJoinDomain?: boolean;
  requireApproval?: boolean;
  superAdminName: string;
  superAdminEmail: string;
  superAdminPicture?: string;
}): Record<string, any> {
  const cleanDivisions =
    Array.isArray(params.divisions) && params.divisions.length > 0
      ? params.divisions
      : ["Management", "Marketing", "Sales", "IT", "Finance", "Legal", "HRGA"];
  const cleanLevels =
    Array.isArray(params.orgLevels) && params.orgLevels.length > 0
      ? params.orgLevels
      : ["Executive", "Division", "Department", "Team"];
  const nowIso = new Date().toISOString();
  const cleanAdminEmail = params.superAdminEmail.toLowerCase().trim();
  const adminDomain = cleanAdminEmail.split("@")[1] || "";
  const allowedDomains =
    Array.isArray(params.allowedDomains) && params.allowedDomains.length > 0
      ? params.allowedDomains
      : adminDomain && adminDomain !== "gmail.com"
      ? [adminDomain]
      : [];

  const boardPalette = ["#10B981", "#F59E0B", "#06B6D4", "#14B8A6", "#6366F1", "#F97316", "#EC4899"];
  const boards = cleanDivisions
    .filter((d) => d.toLowerCase() !== "management")
    .map((d, idx) => ({
      id: `brd_div_${d.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: d,
      department: d,
      color: boardPalette[idx % boardPalette.length],
    }));

  const adminUserId = `user_sa_${crypto.createHash("sha1").update(cleanAdminEmail).digest("hex").slice(0, 10)}`;
  const botId = "user_circle_assistant";
  const avatarUrl =
    params.superAdminPicture ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(params.superAdminName)}&backgroundColor=FF5364`;

  return {
    files: {},
    meetings: [],
    workspace: {
      id: `ws_${params.slug}`,
      slug: params.slug,
      app_name: "ASLIWORKSPACE",
      name: params.workspaceName,
      brand_name: params.workspaceName,
      assistant_name: "Asli",
      tagline: params.tagline || "Enterprise Collaboration & Management",
      description: params.description || "Portal kolaborasi resmi perusahaan",
      logo_file_id: params.logoFileId || "default_workspace_logo",
      favicon_file_id: params.faviconFileId || params.logoFileId || "default_workspace_logo",
      login_image_file_id: params.loginImageFileId || "default_login_bg",
      theme: { primary: "#FF5364", mode: "light" },
      task_statuses: ["todo", "in_progress", "in_review", "done"],
      division_task_statuses: {},
      task_fields: [],
      org_levels: cleanLevels,
      divisions: cleanDivisions,
      item_types: [],
      allowed_domains: allowedDomains,
      auto_join_domain: params.autoJoinDomain !== false,
      require_approval: params.requireApproval !== false,
      subscription: {
        plan_id: "free_starter",
        plan: "free_starter",
        billing_cycle: "monthly",
        updated_at: nowIso,
      },
    },
    users: [
      {
        user_id: adminUserId,
        email: cleanAdminEmail,
        name: params.superAdminName,
        role: "super_admin",
        job_title: "Super Admin Room",
        department: cleanDivisions[0] || "Management",
        auth_provider: "google",
        onboarding_completed: true,
        join_date: nowIso.slice(0, 10),
        token_version: 1,
        online: true,
        is_demo: false,
        status: "active",
        avatar: avatarUrl,
        picture: avatarUrl,
      },
      {
        user_id: botId,
        email: `asli-bot@${params.slug}.local`,
        name: "Asli",
        role: "assistant",
        job_title: "Workspace AI Assistant",
        department: "System",
        online: true,
        is_demo: false,
        is_bot: true,
        status: "active",
        avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=AsliWorkspace&backgroundColor=FF5364",
        picture: "https://api.dicebear.com/7.x/bottts/svg?seed=AsliWorkspace&backgroundColor=FF5364",
      },
    ],
    labels: [
      { id: "lbl_internal", name: "INTERNAL", color: "#1E293B", description: "Operasional Internal" },
      { id: "lbl_priority", name: "PRIORITAS", color: "#EF4444", description: "Prioritas Tinggi" },
    ],
    notifications: [],
    tasks: [],
    projects: [],
    boards,
    conversations: [],
    groups: [],
    messages: [],
    posts: [],
    org_units: [
      {
        id: "unit_mgmt",
        name: "Management",
        level: cleanLevels[0] || "Executive",
        parent_id: null,
        lead_user_id: adminUserId,
        color: "#FF5364",
      },
    ],
    activity: [],
    reminders: [],
    polls: [],
    task_automations: [],
    audit_logs: [],
    invitations: [],
    drive_shortcuts: [],
    prefs: {},
    marketplace_listings: [],
    marketplace_orders: [],
    marketplace_reviews: [],
    marketplace_vouchers: [],
    marketplace_carts: {},
    marketplace_wishlists: {},
    circle_notes: [],
    employee_archives: [],
    access_requests: [],
    password_reset_secrets: {},
    deleted_user_ids: [],
    deleted_user_emails: [],
    deleted_task_ids: [],
    deleted_marketplace_listing_ids: [],
    revision: 1,
    last_mutated_at: nowIso,
  };
}

export interface SaaSPersistenceHandlers {
  onSavePlatformState?: (snapshot: Record<string, any>, revision: number) => void | Promise<void>;
  onSaveRoomDb?: (slug: string, roomDb: Record<string, any>, immediate: boolean) => void | Promise<void>;
  onDeleteRoomDb?: (slug: string) => void | Promise<void>;
}

export class SaaSPlatformManager {
  rootDir: string;
  masterKey: Buffer;
  platformStateFile: string;
  platformStateTmpFile: string;
  defaultDb: Record<string, any>;
  roomDbs = new Map<string, Record<string, any>>();
  roomSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  platformRevision = 1;
  hadExistingLocalStateOnBoot = false;
  private isHydratingFromRemote = false;
  private persistenceHandlers: SaaSPersistenceHandlers = {};

  roomsMeta: Record<string, RoomMeta> = {};
  plans: SaaSPlan[] = JSON.parse(JSON.stringify(DEFAULT_SAAS_PLANS));
  gatewayConfig: PaymentGatewayConfig = {
    mode: "sandbox",
    live_provider: process.env.PAYMENT_GATEWAY_PROVIDER === "xendit" ? "xendit" : "midtrans",
    midtrans_is_production: process.env.MIDTRANS_IS_PRODUCTION === "true",
    enabled_channels: ["qris", "va_bca", "va_mandiri", "va_bni", "va_bri", "gopay", "ovo", "dana"],
    updated_at: new Date().toISOString(),
  };
  transactions: SaaSTransaction[] = [];
  governance: GovernancePolicies = {
    enforce_free_quota: true,
    local_gateway_enabled: true,
    custom_domain_cname: true,
    firestore_backup_sync: true,
    security_anomaly_alert: true,
    soft_delete_grace: true,
  };
  platformOwners: Array<{
    email: string;
    name: string;
    role: "superpower_admin";
    password_hash?: string;
    token_version?: number;
    job_title?: string;
    phone?: string;
    updated_at?: string;
    last_login_at?: string;
    password_updated_at?: string;
  }> = [
    {
      email: PLATFORM_OWNER_DEFAULT_EMAIL,
      name: "Superpower Admin",
      role: "superpower_admin",
      job_title: "Superpower Platform Owner",
      token_version: 1,
      password_hash: hashPassword(PLATFORM_OWNER_DEFAULT_PASS),
    },
    {
      email: "be.creativestudio21@gmail.com",
      name: "Platform Owner",
      role: "superpower_admin",
      job_title: "Superpower Platform Owner",
      token_version: 1,
    },
    {
      email: "saeful@asliri.id",
      name: "Saeful Rohman",
      role: "superpower_admin",
      job_title: "Superpower Platform Owner",
      token_version: 1,
    },
  ];
  snapshots: PlatformSnapshot[] = [];
  minuteTelemetryBuckets = new Map<number, { requests: number; errors_4xx: number; errors_5xx: number; online_users: number }>();
  hourTelemetryBuckets = new Map<number, { requests: number; errors_4xx: number; errors_5xx: number; online_users: number }>();
  private roomStorageCache = new Map<string, { mb: number; revision: number; computedAt: number }>();

  constructor(rootDir: string, masterKey: Buffer, defaultDb: Record<string, any>) {
    this.rootDir = rootDir;
    this.masterKey = masterKey;
    this.defaultDb = defaultDb;
    this.platformStateFile = path.join(rootDir, ".circle_platform_state.json");
    this.platformStateTmpFile = path.join(rootDir, ".circle_platform_state.tmp.json");
    this.hadExistingLocalStateOnBoot = fs.existsSync(this.platformStateFile);
    this.roomDbs.set(DEFAULT_ROOM_SLUG, defaultDb);
    this.loadPlatformState();
    this.ensureDefaultRoomSeed();
    if (!fs.existsSync(this.platformStateFile)) {
      this.savePlatformState();
    }
  }

  setPersistenceHandlers(handlers: SaaSPersistenceHandlers) {
    this.persistenceHandlers = handlers || {};
  }

  exportPlatformStateSnapshot(): Record<string, any> {
    return {
      roomsMeta: this.roomsMeta,
      plans: this.plans,
      gatewayConfig: this.gatewayConfig,
      transactions: this.transactions,
      governance: this.governance,
      platformOwners: this.platformOwners,
      snapshots: this.snapshots,
      platformRevision: this.platformRevision,
    };
  }

  exportNonDefaultRooms(): Array<{ slug: string; db: Record<string, any> }> {
    const out: Array<{ slug: string; db: Record<string, any> }> = [];
    for (const [slug, rdb] of this.roomDbs.entries()) {
      if (slug && slug !== DEFAULT_ROOM_SLUG && rdb && typeof rdb === "object") {
        out.push({ slug, db: rdb });
      }
    }
    return out;
  }

  hasCustomStateWorthSeeding(): boolean {
    if (this.hadExistingLocalStateOnBoot) return true;
    if (Object.keys(this.roomsMeta).some((s) => s !== DEFAULT_ROOM_SLUG)) return true;
    if (this.exportNonDefaultRooms().length > 0) return true;
    if (this.transactions.length > 0 || this.snapshots.length > 0) return true;
    return false;
  }

  applyHydratedPlatformState(
    parsed: Record<string, any> | null,
    hydratedRooms: Record<string, Record<string, any>> = {},
    revision = 0
  ) {
    this.isHydratingFromRemote = true;
    try {
      if (parsed && typeof parsed === "object") {
        if (parsed.roomsMeta && typeof parsed.roomsMeta === "object") {
          this.roomsMeta = parsed.roomsMeta;
          // Drop any stale non-default rooms from RAM not present in authoritative Postgres roomsMeta
          for (const existingSlug of Array.from(this.roomDbs.keys())) {
            if (existingSlug !== DEFAULT_ROOM_SLUG && !this.roomsMeta[existingSlug] && !hydratedRooms[existingSlug]) {
              this.roomDbs.delete(existingSlug);
            }
          }
        }
        if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
          this.plans = parsed.plans;
        }
        if (parsed.gatewayConfig && typeof parsed.gatewayConfig === "object") {
          this.gatewayConfig = { ...this.gatewayConfig, ...parsed.gatewayConfig };
        }
        if (Array.isArray(parsed.transactions)) {
          this.transactions = parsed.transactions;
        }
        if (parsed.governance && typeof parsed.governance === "object") {
          this.governance = { ...this.governance, ...parsed.governance };
        }
        if (Array.isArray(parsed.platformOwners) && parsed.platformOwners.length > 0) {
          this.platformOwners = parsed.platformOwners;
          const defOwner = this.platformOwners.find(
            (o) => o.email.toLowerCase() === PLATFORM_OWNER_DEFAULT_EMAIL
          );
          if (!defOwner) {
            this.platformOwners.unshift({
              email: PLATFORM_OWNER_DEFAULT_EMAIL,
              name: "Superpower Admin",
              role: "superpower_admin",
              job_title: "Superpower Platform Owner",
              token_version: 1,
              password_hash: hashPassword(PLATFORM_OWNER_DEFAULT_PASS),
            });
          } else if (!defOwner.password_hash) {
            defOwner.password_hash = hashPassword(PLATFORM_OWNER_DEFAULT_PASS);
          }
        }
        if (Array.isArray(parsed.snapshots)) {
          this.snapshots = parsed.snapshots;
        }
      }

      this.platformRevision = Math.max(
        this.platformRevision,
        Number(revision || parsed?.platformRevision || 1)
      );

      for (const [rawSlug, roomData] of Object.entries(hydratedRooms || {})) {
        const slug = slugifyRoom(rawSlug);
        if (!slug || slug === DEFAULT_ROOM_SLUG || !roomData || typeof roomData !== "object") continue;
        this.roomDbs.set(slug, roomData);
        if (!this.roomsMeta[slug]) {
          const admin =
            (roomData.users || []).find((u: any) => u?.role === "super_admin" && !u?.is_bot) ||
            (roomData.users || []).find((u: any) => !u?.is_bot);
          const nowIso = new Date().toISOString();
          this.roomsMeta[slug] = {
            slug,
            name: String(roomData.workspace?.name || slug),
            brand_name: String(roomData.workspace?.brand_name || roomData.workspace?.name || slug),
            invite_code: generateInviteCode(slug),
            custom_domain: "",
            status: "active",
            plan_id: roomData.workspace?.subscription?.plan_id || "free_starter",
            billing_cycle: roomData.workspace?.subscription?.billing_cycle || "monthly",
            owner_email: String(admin?.email || PLATFORM_OWNER_DEFAULT_EMAIL).toLowerCase(),
            owner_name: String(admin?.name || "Super Admin"),
            created_at: roomData.last_mutated_at || nowIso,
            last_active_at: roomData.last_mutated_at || nowIso,
            telemetry: { req_24h: 0, errors_4xx: 0, errors_5xx: 0, last_request_at: nowIso },
          };
        }
        try {
          const fp = this.roomDbFilePath(slug);
          const tmp = `${fp}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(roomData), "utf-8");
          fs.renameSync(tmp, fp);
        } catch {}
      }

      this.ensureDefaultRoomSeed();
      try {
        const payload = JSON.stringify(this.exportPlatformStateSnapshot());
        fs.writeFileSync(this.platformStateTmpFile, payload, "utf-8");
        fs.renameSync(this.platformStateTmpFile, this.platformStateFile);
      } catch {}
    } finally {
      this.isHydratingFromRemote = false;
    }
  }

  private roomDbFilePath(slug: string): string {
    const clean = slugifyRoom(slug);
    return path.join(this.rootDir, `.circle_room_${clean}.json`);
  }

  syncDefaultRoomFromDb() {
    this.ensureDefaultRoomSeed();
  }

  private ensureDefaultRoomSeed() {
    if (!this.defaultDb.workspace || typeof this.defaultDb.workspace !== "object") {
      this.defaultDb.workspace = {};
    }
    this.defaultDb.workspace.slug = DEFAULT_ROOM_SLUG;
    this.defaultDb.workspace.app_name = "ASLIWORKSPACE";
    if (!this.defaultDb.workspace.name || /^asli(\s+workspace)?$/i.test(String(this.defaultDb.workspace.name).trim())) {
      this.defaultDb.workspace.name = "ASLI WORKSPACE";
    }
    if (!this.defaultDb.workspace.subscription) {
      this.defaultDb.workspace.subscription = {
        plan_id: "free_starter",
        plan: "free_starter",
        billing_cycle: "monthly",
        updated_at: new Date().toISOString(),
      };
    } else if (!this.defaultDb.workspace.subscription.plan_id) {
      this.defaultDb.workspace.subscription.plan_id =
        this.defaultDb.workspace.subscription.plan || "free_starter";
    }

    const existing = this.roomsMeta[DEFAULT_ROOM_SLUG];
    const nowIso = new Date().toISOString();
    const superAdmin = (this.defaultDb.users || []).find((u: any) => u?.role === "super_admin");
    this.roomsMeta[DEFAULT_ROOM_SLUG] = {
      slug: DEFAULT_ROOM_SLUG,
      name: String(this.defaultDb.workspace.name || "ASLI WORKSPACE"),
      brand_name: String(this.defaultDb.workspace.brand_name || "ASLI"),
      invite_code: existing?.invite_code || "ASLI-MAIN",
      custom_domain: existing?.custom_domain || "",
      status: existing?.status || "active",
      plan_id: this.defaultDb.workspace.subscription?.plan_id || existing?.plan_id || "free_starter",
      billing_cycle: this.defaultDb.workspace.subscription?.billing_cycle || existing?.billing_cycle || "monthly",
      owner_email: existing?.owner_email || superAdmin?.email || "saeful@asliri.id",
      owner_name: existing?.owner_name || superAdmin?.name || "Saeful",
      created_at: existing?.created_at || nowIso,
      last_active_at: existing?.last_active_at || nowIso,
      expires_at: this.defaultDb.workspace.subscription?.expires_at || existing?.expires_at,
      telemetry: existing?.telemetry || {
        req_24h: 0,
        errors_4xx: 0,
        errors_5xx: 0,
        last_request_at: nowIso,
      },
    };
  }

  private loadPlatformState() {
    try {
      if (fs.existsSync(this.platformStateFile)) {
        const raw = fs.readFileSync(this.platformStateFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.roomsMeta && typeof parsed.roomsMeta === "object") {
            this.roomsMeta = parsed.roomsMeta;
          }
          if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
            this.plans = parsed.plans;
          }
          if (parsed.gatewayConfig && typeof parsed.gatewayConfig === "object") {
            this.gatewayConfig = { ...this.gatewayConfig, ...parsed.gatewayConfig };
          }
          if (Array.isArray(parsed.transactions)) {
            this.transactions = parsed.transactions;
          }
          if (parsed.governance && typeof parsed.governance === "object") {
            this.governance = { ...this.governance, ...parsed.governance };
          }
          if (Array.isArray(parsed.platformOwners) && parsed.platformOwners.length > 0) {
            this.platformOwners = parsed.platformOwners;
            // Ensure default superpower owner always has password_hash
            const defOwner = this.platformOwners.find(
              (o) => o.email.toLowerCase() === PLATFORM_OWNER_DEFAULT_EMAIL
            );
            if (!defOwner) {
              this.platformOwners.unshift({
                email: PLATFORM_OWNER_DEFAULT_EMAIL,
                name: "Superpower Admin",
                role: "superpower_admin",
                password_hash: hashPassword(PLATFORM_OWNER_DEFAULT_PASS),
              });
            } else if (!defOwner.password_hash) {
              defOwner.password_hash = hashPassword(PLATFORM_OWNER_DEFAULT_PASS);
            }
          }
          if (Array.isArray(parsed.snapshots)) {
            this.snapshots = parsed.snapshots;
          }
        }
      }
    } catch (e) {
      console.warn("[SaaSPlatform] Failed loading platform state:", e);
    }

    // Load all registered non-default rooms from disk
    for (const slug of Object.keys(this.roomsMeta)) {
      if (slug === DEFAULT_ROOM_SLUG) continue;
      const fp = this.roomDbFilePath(slug);
      try {
        if (fs.existsSync(fp)) {
          const parsedRoom = JSON.parse(fs.readFileSync(fp, "utf-8"));
          if (parsedRoom && typeof parsedRoom === "object") {
            this.roomDbs.set(slug, parsedRoom);
          }
        }
      } catch (e) {
        console.warn(`[SaaSPlatform] Failed loading room ${slug}:`, e);
      }
    }

    // Also recover any orphaned .circle_room_<slug>.json files on disk not present in roomsMeta
    try {
      const files = fs.readdirSync(this.rootDir);
      for (const file of files) {
        if (!file.startsWith(".circle_room_") || !file.endsWith(".json") || file.endsWith(".tmp.json")) continue;
        const rawSlug = file.slice(".circle_room_".length, -".json".length);
        const slug = slugifyRoom(rawSlug);
        if (!slug || slug === DEFAULT_ROOM_SLUG || this.roomsMeta[slug]) continue;
        try {
          const parsedRoom = JSON.parse(fs.readFileSync(path.join(this.rootDir, file), "utf-8"));
          if (parsedRoom && typeof parsedRoom === "object") {
            this.roomDbs.set(slug, parsedRoom);
            const admin = (parsedRoom.users || []).find((u: any) => u?.role === "super_admin" && !u?.is_bot) || (parsedRoom.users || []).find((u: any) => !u?.is_bot);
            const nowIso = new Date().toISOString();
            this.roomsMeta[slug] = {
              slug,
              name: String(parsedRoom.workspace?.name || slug),
              brand_name: String(parsedRoom.workspace?.brand_name || parsedRoom.workspace?.name || slug),
              invite_code: generateInviteCode(slug),
              custom_domain: "",
              status: "active",
              plan_id: parsedRoom.workspace?.subscription?.plan_id || "free_starter",
              billing_cycle: parsedRoom.workspace?.subscription?.billing_cycle || "monthly",
              owner_email: String(admin?.email || PLATFORM_OWNER_DEFAULT_EMAIL).toLowerCase(),
              owner_name: String(admin?.name || "Super Admin"),
              created_at: parsedRoom.last_mutated_at || nowIso,
              last_active_at: parsedRoom.last_mutated_at || nowIso,
              telemetry: { req_24h: 0, errors_4xx: 0, errors_5xx: 0, last_request_at: nowIso },
            };
          }
        } catch (err) {
          console.warn(`[SaaSPlatform] Failed recovering orphaned room ${slug}:`, err);
        }
      }
    } catch {}
  }

  savePlatformState() {
    this.platformRevision += 1;
    const snapshot = this.exportPlatformStateSnapshot();
    try {
      const payload = JSON.stringify(snapshot);
      fs.writeFileSync(this.platformStateTmpFile, payload, "utf-8");
      fs.renameSync(this.platformStateTmpFile, this.platformStateFile);
    } catch (e) {
      console.warn("[SaaSPlatform] Failed saving platform state:", e);
    }
    if (!this.isHydratingFromRemote && this.persistenceHandlers.onSavePlatformState) {
      try {
        void this.persistenceHandlers.onSavePlatformState(snapshot, this.platformRevision);
      } catch {}
    }
  }

  deleteRoom(slug: string): boolean {
    const clean = slugifyRoom(slug);
    if (!clean || clean === DEFAULT_ROOM_SLUG || !this.roomsMeta[clean]) {
      return false;
    }
    const existingTimer = this.roomSaveTimers.get(clean);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.roomSaveTimers.delete(clean);
    }
    delete this.roomsMeta[clean];
    this.roomDbs.delete(clean);
    const roomFile = this.roomDbFilePath(clean);
    try {
      if (fs.existsSync(roomFile)) fs.unlinkSync(roomFile);
    } catch {}
    if (!this.isHydratingFromRemote && this.persistenceHandlers.onDeleteRoomDb) {
      try {
        void this.persistenceHandlers.onDeleteRoomDb(clean);
      } catch {}
    }
    this.savePlatformState();
    return true;
  }

  scheduleSaveRoomDb(slug: string, immediate = false) {
    const clean = slugifyRoom(slug);
    if (clean === DEFAULT_ROOM_SLUG) return;
    const roomDb = this.roomDbs.get(clean);
    if (!roomDb) return;

    const existingTimer = this.roomSaveTimers.get(clean);
    if (existingTimer) clearTimeout(existingTimer);

    const writeFn = () => {
      this.roomSaveTimers.delete(clean);
      try {
        const fp = this.roomDbFilePath(clean);
        const tmp = `${fp}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(roomDb), "utf-8");
        fs.renameSync(tmp, fp);
      } catch (e) {
        console.warn(`[SaaSPlatform] Failed saving room ${clean}:`, e);
      }
    };

    if (immediate) {
      writeFn();
    } else {
      this.roomSaveTimers.set(clean, setTimeout(writeFn, 250));
    }

    if (!this.isHydratingFromRemote && this.persistenceHandlers.onSaveRoomDb) {
      try {
        void this.persistenceHandlers.onSaveRoomDb(clean, roomDb, immediate);
      } catch {}
    }
  }

  resolveRoomSlug(rawSlug?: string | null): string {
    if (!rawSlug) return DEFAULT_ROOM_SLUG;
    const clean = slugifyRoom(rawSlug);
    if (this.roomDbs.has(clean) || this.roomsMeta[clean]) {
      return clean;
    }
    return DEFAULT_ROOM_SLUG;
  }

  getAllInviteCodes(excludeSlug?: string): Set<string> {
    const codes = new Set<string>();
    const cleanExcl = excludeSlug ? slugifyRoom(excludeSlug) : "";
    for (const [slug, meta] of Object.entries(this.roomsMeta)) {
      if (cleanExcl && slug === cleanExcl) continue;
      const c = String(meta?.invite_code || "").trim().toUpperCase();
      if (c) codes.add(c);
    }
    return codes;
  }

  regenerateRoomInviteCode(slug: string): string | null {
    const clean = slugifyRoom(slug);
    const meta = this.roomsMeta[clean];
    if (!meta) return null;
    const existingCodes = this.getAllInviteCodes();
    const currentCode = String(meta.invite_code || "").trim().toUpperCase();
    if (currentCode) existingCodes.add(currentCode);
    const nextCode = generateInviteCode(clean, existingCodes);
    meta.invite_code = nextCode;
    this.savePlatformState();
    return nextCode;
  }

  setCustomRoomInviteCode(slug: string, rawCode: string): { ok: boolean; invite_code?: string; error?: string } {
    const clean = slugifyRoom(slug);
    const meta = this.roomsMeta[clean];
    if (!meta) return { ok: false, error: "Room tidak ditemukan." };
    const check = validateCustomInviteCode(rawCode);
    if (!check.ok) return { ok: false, error: check.error };
    const conflict = Object.entries(this.roomsMeta).find(
      ([s, m]) => s !== clean && String(m?.invite_code || "").trim().toUpperCase() === check.code
    );
    if (conflict) {
      return { ok: false, error: `Kode undangan "${check.code}" sudah dipakai oleh workspace lain.` };
    }
    meta.invite_code = check.code;
    this.savePlatformState();
    return { ok: true, invite_code: check.code };
  }

  findAccountExistingRoom(
    rawEmail: string,
    excludeSlug?: string
  ): {
    slug: string;
    meta: RoomMeta;
    user_status: "active" | "pending";
    user_role: string;
  } | null {
    const cleanEmail = String(rawEmail || "").toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes("@")) return null;
    const cleanExcl = excludeSlug ? slugifyRoom(excludeSlug) : "";

    // Check default room first, then newest rooms
    const slugs = Object.keys(this.roomsMeta).sort((a, b) => {
      if (a === DEFAULT_ROOM_SLUG) return -1;
      if (b === DEFAULT_ROOM_SLUG) return 1;
      return (
        new Date(this.roomsMeta[b]?.last_active_at || 0).getTime() -
        new Date(this.roomsMeta[a]?.last_active_at || 0).getTime()
      );
    });

    for (const slug of slugs) {
      if (cleanExcl && slug === cleanExcl) continue;
      const meta = this.roomsMeta[slug];
      if (!meta) continue;
      const rdb = this.getRoomDb(slug);
      const usersList = Array.isArray(rdb.users) ? rdb.users : [];
      const deletedEmails = new Set(
        (Array.isArray(rdb.deleted_user_emails) ? rdb.deleted_user_emails : [])
          .map((e: any) => String(e || "").toLowerCase().trim())
          .filter(Boolean)
      );
      const matchedUser = usersList.find(
        (u: any) =>
          u &&
          !u.is_bot &&
          u.role !== "assistant" &&
          String(u?.email || "").toLowerCase().trim() === cleanEmail
      );
      if (matchedUser) {
        if (matchedUser.status === "inactive" || matchedUser.status === "rejected") {
          continue;
        }
        return {
          slug,
          meta,
          user_status: matchedUser.status === "pending" ? "pending" : "active",
          user_role: String(matchedUser.role || "employee"),
        };
      }
      const isRoomOwner =
        !deletedEmails.has(cleanEmail) &&
        String(meta.owner_email || "").toLowerCase().trim() === cleanEmail;
      if (isRoomOwner) {
        return {
          slug,
          meta,
          user_status: "active",
          user_role: "super_admin",
        };
      }
    }
    return null;
  }

  findRoomByInviteCode(code?: string | null): { slug: string; meta: RoomMeta; db: Record<string, any> } | null {
    const clean = String(code || "").trim().toUpperCase();
    if (!clean) return null;
    for (const [slug, meta] of Object.entries(this.roomsMeta)) {
      if (String(meta.invite_code || "").trim().toUpperCase() === clean) {
        return { slug, meta, db: this.getRoomDb(slug) };
      }
    }
    return null;
  }

  resolveRoomSlugFromHost(hostHeader?: string | null): string | null {
    const cleanHost = String(hostHeader || "").split(":")[0].toLowerCase().trim();
    if (!cleanHost) return null;
    for (const [slug, meta] of Object.entries(this.roomsMeta)) {
      if (meta.custom_domain && String(meta.custom_domain).toLowerCase().trim() === cleanHost) {
        return slug;
      }
    }
    return null;
  }

  getRoomDb(slug: string): Record<string, any> {
    const clean = slugifyRoom(slug);
    return this.roomDbs.get(clean) || this.defaultDb;
  }

  getRoomMeta(slug: string): RoomMeta {
    const clean = slugifyRoom(slug);
    if (this.roomsMeta[clean]) return this.roomsMeta[clean];
    return this.roomsMeta[DEFAULT_ROOM_SLUG];
  }

  private countAllOnlineUsers(): number {
    let total = 0;
    for (const slug of Object.keys(this.roomsMeta)) {
      const rdb = this.getRoomDb(slug);
      total += (rdb.users || []).filter((u: any) => u && !u.is_bot && u.role !== "assistant" && u.status === "active" && u.online).length;
    }
    return total;
  }

  recordTelemetry(slug: string, statusCode: number) {
    const meta = this.roomsMeta[slug];
    if (!meta) return;
    if (!meta.telemetry) {
      meta.telemetry = { req_24h: 0, errors_4xx: 0, errors_5xx: 0, last_request_at: new Date().toISOString() };
    }
    meta.telemetry.req_24h += 1;
    if (statusCode >= 400 && statusCode < 500) meta.telemetry.errors_4xx += 1;
    if (statusCode >= 500) meta.telemetry.errors_5xx += 1;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    meta.telemetry.last_request_at = nowIso;
    meta.last_active_at = nowIso;

    const onlineNow = this.countAllOnlineUsers();
    const minKey = Math.floor(nowMs / 60000);
    const minBucket = this.minuteTelemetryBuckets.get(minKey) || { requests: 0, errors_4xx: 0, errors_5xx: 0, online_users: onlineNow };
    minBucket.requests += 1;
    if (statusCode >= 400 && statusCode < 500) minBucket.errors_4xx += 1;
    if (statusCode >= 500) minBucket.errors_5xx += 1;
    minBucket.online_users = Math.max(minBucket.online_users, onlineNow);
    this.minuteTelemetryBuckets.set(minKey, minBucket);
    if (this.minuteTelemetryBuckets.size > 90) {
      const cutoff = minKey - 65;
      for (const k of this.minuteTelemetryBuckets.keys()) {
        if (k < cutoff) this.minuteTelemetryBuckets.delete(k);
      }
    }

    const hourKey = Math.floor(nowMs / 3600000);
    const hourBucket = this.hourTelemetryBuckets.get(hourKey) || { requests: 0, errors_4xx: 0, errors_5xx: 0, online_users: onlineNow };
    hourBucket.requests += 1;
    if (statusCode >= 400 && statusCode < 500) hourBucket.errors_4xx += 1;
    if (statusCode >= 500) hourBucket.errors_5xx += 1;
    hourBucket.online_users = Math.max(hourBucket.online_users, onlineNow);
    this.hourTelemetryBuckets.set(hourKey, hourBucket);
    if (this.hourTelemetryBuckets.size > 36) {
      const cutoffHr = hourKey - 28;
      for (const k of this.hourTelemetryBuckets.keys()) {
        if (k < cutoffHr) this.hourTelemetryBuckets.delete(k);
      }
    }
  }

  getPlanById(planId?: string): SaaSPlan {
    const found = this.plans.find((p) => p.id === planId);
    if (found) return found;
    return this.plans[0] || DEFAULT_SAAS_PLANS[0];
  }

  getRoomActiveMemberCount(slug: string): number {
    const rdb = this.getRoomDb(slug);
    return (rdb.users || []).filter(
      (u: any) => u && !u.is_bot && u.role !== "assistant" && u.status === "active"
    ).length;
  }

  getRoomStorageUsedMb(slug: string, force = false): number {
    const rdb = this.getRoomDb(slug);
    const curRev = Number(rdb?.revision || 0);
    const now = Date.now();
    const cached = this.roomStorageCache.get(slug);
    if (
      !force &&
      cached &&
      ((cached.revision === curRev && now - cached.computedAt < 60_000) ||
        now - cached.computedAt < 15_000)
    ) {
      return cached.mb;
    }
    try {
      const jsonBytes = Buffer.byteLength(JSON.stringify(rdb), "utf-8");
      let filesBytes = 0;
      if (rdb.files && typeof rdb.files === "object") {
        for (const f of Object.values(rdb.files) as any[]) {
          filesBytes += Number(f?.size || 0);
        }
      }
      const mb = Math.max(0.1, Number(((jsonBytes + filesBytes) / (1024 * 1024)).toFixed(1)));
      this.roomStorageCache.set(slug, { mb, revision: curRev, computedAt: now });
      return mb;
    } catch {
      return cached?.mb ?? 0.1;
    }
  }

  checkRoomMemberQuota(slug: string): { exceeded: boolean; current: number; max: number; plan: SaaSPlan } {
    const rdb = this.getRoomDb(slug);
    const meta = this.getRoomMeta(slug);
    const planId = rdb.workspace?.subscription?.plan_id || meta?.plan_id || "free_starter";
    const plan = this.getPlanById(planId);
    const current = this.getRoomActiveMemberCount(slug);
    if (!this.governance.enforce_free_quota && plan.id === "free_starter") {
      return { exceeded: false, current, max: plan.max_members, plan };
    }
    const exceeded = plan.max_members > 0 && current >= plan.max_members;
    return { exceeded, current, max: plan.max_members, plan };
  }

  isPlatformOwnerEmail(email: string): boolean {
    const clean = String(email || "").toLowerCase().trim();
    if (!clean) return false;
    return this.platformOwners.some((o) => o.email.toLowerCase().trim() === clean);
  }

  getOwnerRecord(email: string) {
    const clean = String(email || "").toLowerCase().trim();
    return this.platformOwners.find((o) => o.email.toLowerCase().trim() === clean) || null;
  }

  sanitizeOwnerProfile(owner: {
    email: string;
    name: string;
    role: "superpower_admin";
    password_hash?: string;
    token_version?: number;
    job_title?: string;
    phone?: string;
    updated_at?: string;
    last_login_at?: string;
    password_updated_at?: string;
  }) {
    return {
      email: owner.email,
      name: owner.name || "Platform Owner",
      role: owner.role || "superpower_admin",
      job_title: owner.job_title || "Superpower Platform Owner",
      phone: owner.phone || "",
      has_password: Boolean(owner.password_hash),
      token_version: Number(owner.token_version || 1),
      updated_at: owner.updated_at || null,
      last_login_at: owner.last_login_at || null,
      password_updated_at: owner.password_updated_at || null,
    };
  }

  signOwnerToken(email: string, _name: string): string {
    const clean = String(email || "").toLowerCase().trim();
    const owner = this.getOwnerRecord(clean);
    const tv = Number(owner?.token_version || 1);
    if (owner) {
      owner.last_login_at = new Date().toISOString();
      this.savePlatformState();
    }
    return signSessionToken(
      `platform_owner_${clean}`,
      tv,
      this.masterKey,
      undefined,
      clean
    );
  }

  verifyOwnerToken(req: any) {
    const raw =
      String(req.headers?.["x-platform-owner-token"] || "").trim() ||
      String(req.headers?.["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
    if (!raw) return null;
    const payload = verifySessionToken(raw, this.masterKey);
    if (!payload?.email) return null;
    const owner = this.getOwnerRecord(payload.email);
    if (!owner) return null;
    if (Number(payload.tv || 1) !== Number(owner.token_version || 1)) return null;
    return this.sanitizeOwnerProfile(owner);
  }

  verifyOwnerCredentials(email: string, password: string) {
    const owner = this.getOwnerRecord(email);
    if (!owner || !owner.password_hash) return { ok: false };
    const res = verifyPassword(String(password || ""), { password_hash: owner.password_hash });
    if (!res.valid) return { ok: false };
    return { ok: true, owner: this.sanitizeOwnerProfile(owner) };
  }

  updateOwnerProfile(email: string, patch: { name?: string; job_title?: string; phone?: string }) {
    const owner = this.getOwnerRecord(email);
    if (!owner) return { ok: false, error: "Akun Platform Owner tidak ditemukan." };
    const cleanName = typeof patch.name === "string" ? patch.name.trim() : owner.name;
    if (!cleanName || cleanName.length < 2) {
      return { ok: false, error: "Nama lengkap minimal 2 karakter." };
    }
    owner.name = cleanName.slice(0, 80);
    if (typeof patch.job_title === "string") {
      owner.job_title = patch.job_title.trim().slice(0, 80) || "Superpower Platform Owner";
    }
    if (typeof patch.phone === "string") {
      owner.phone = patch.phone.trim().slice(0, 32);
    }
    owner.updated_at = new Date().toISOString();
    this.savePlatformState();
    return { ok: true, owner: this.sanitizeOwnerProfile(owner) };
  }

  changeOwnerPassword(
    email: string,
    input: { current_password?: string; new_password: string; revoke_other_sessions?: boolean }
  ) {
    const owner = this.getOwnerRecord(email);
    if (!owner) return { ok: false, error: "Akun Platform Owner tidak ditemukan." };
    if (owner.password_hash) {
      const check = verifyPassword(String(input.current_password || ""), { password_hash: owner.password_hash });
      if (!check.valid) {
        return { ok: false, error: "Passkey / kata sandi saat ini tidak sesuai." };
      }
    }
    const policy = validatePasswordPolicy(String(input.new_password || ""));
    if (!policy.ok) {
      return { ok: false, error: policy.detail || "Passkey baru tidak memenuhi syarat keamanan." };
    }
    if (String(input.new_password || "").length < 8) {
      return { ok: false, error: "Passkey Platform Owner minimal 8 karakter." };
    }
    owner.password_hash = hashPassword(String(input.new_password));
    owner.password_updated_at = new Date().toISOString();
    owner.updated_at = owner.password_updated_at;
    if (input.revoke_other_sessions !== false) {
      owner.token_version = Number(owner.token_version || 1) + 1;
    }
    this.savePlatformState();
    const token = this.signOwnerToken(owner.email, owner.name);
    return { ok: true, token, owner: this.sanitizeOwnerProfile(owner) };
  }

  resetOwnerPasskey(email: string) {
    const owner = this.getOwnerRecord(email);
    if (!owner) return { ok: false, error: "Akun Platform Owner tidak ditemukan." };
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = crypto.randomBytes(14);
    let generated = "";
    for (let i = 0; i < 14; i++) {
      generated += chars[bytes[i] % chars.length];
    }
    owner.password_hash = hashPassword(generated);
    owner.password_updated_at = new Date().toISOString();
    owner.updated_at = owner.password_updated_at;
    owner.token_version = Number(owner.token_version || 1) + 1;
    this.savePlatformState();
    const token = this.signOwnerToken(owner.email, owner.name);
    return { ok: true, generated_passkey: generated, token, owner: this.sanitizeOwnerProfile(owner) };
  }

  revokeOwnerSessions(email: string) {
    const owner = this.getOwnerRecord(email);
    if (!owner) return { ok: false, error: "Akun Platform Owner tidak ditemukan." };
    owner.token_version = Number(owner.token_version || 1) + 1;
    owner.updated_at = new Date().toISOString();
    this.savePlatformState();
    const token = this.signOwnerToken(owner.email, owner.name);
    return { ok: true, token, owner: this.sanitizeOwnerProfile(owner) };
  }

  resetOwnerDefaults(email: string, mode: "profile_and_governance" | "telemetry_only" = "profile_and_governance") {
    const owner = this.getOwnerRecord(email);
    if (!owner) return { ok: false, error: "Akun Platform Owner tidak ditemukan." };

    if (mode === "telemetry_only") {
      this.minuteTelemetryBuckets.clear();
      this.hourTelemetryBuckets.clear();
      for (const meta of Object.values(this.roomsMeta)) {
        meta.telemetry = {
          req_24h: 0,
          errors_4xx: 0,
          errors_5xx: 0,
          last_request_at: new Date().toISOString(),
        };
      }
      this.savePlatformState();
      return { ok: true, owner: this.sanitizeOwnerProfile(owner) };
    }

    owner.name =
      owner.email.toLowerCase() === PLATFORM_OWNER_DEFAULT_EMAIL
        ? "Superpower Admin"
        : owner.email.toLowerCase() === "saeful@asliri.id"
        ? "Saeful Rohman"
        : "Platform Owner";
    owner.job_title = "Superpower Platform Owner";
    owner.phone = "";
    owner.updated_at = new Date().toISOString();
    this.governance = {
      enforce_free_quota: true,
      local_gateway_enabled: true,
      custom_domain_cname: true,
      firestore_backup_sync: true,
      security_anomaly_alert: true,
      soft_delete_grace: true,
    };
    this.savePlatformState();
    return { ok: true, owner: this.sanitizeOwnerProfile(owner), governance: this.governance };
  }

  addPlatformOwnerAccount(rawEmail: string, rawName?: string) {
    const cleanEmail = String(rawEmail || "").toLowerCase().trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { ok: false, error: "Format email Google tidak valid." };
    }
    if (this.isPlatformOwnerEmail(cleanEmail)) {
      return { ok: false, error: `Email ${cleanEmail} sudah terdaftar sebagai Platform Owner.` };
    }
    const cleanName = String(rawName || "").trim() || cleanEmail.split("@")[0];
    this.platformOwners.push({
      email: cleanEmail,
      name: cleanName.slice(0, 80),
      role: "superpower_admin",
      job_title: "Superpower Platform Owner",
      token_version: 1,
      updated_at: new Date().toISOString(),
    });
    this.savePlatformState();
    return { ok: true, platform_owners: this.platformOwners.map((o) => this.sanitizeOwnerProfile(o)) };
  }

  removePlatformOwnerAccount(targetEmail: string, actorEmail: string) {
    const cleanTarget = String(targetEmail || "").toLowerCase().trim();
    const cleanActor = String(actorEmail || "").toLowerCase().trim();
    if (cleanTarget === cleanActor) {
      return { ok: false, error: "Anda tidak dapat menghapus akun yang sedang aktif digunakan." };
    }
    if (cleanTarget === PLATFORM_OWNER_DEFAULT_EMAIL) {
      return { ok: false, error: "Akun root owner@asliworkspace.id tidak dapat dihapus." };
    }
    if (this.platformOwners.length <= 1) {
      return { ok: false, error: "Minimal harus ada 1 akun Platform Owner aktif." };
    }
    const before = this.platformOwners.length;
    this.platformOwners = this.platformOwners.filter((o) => o.email.toLowerCase().trim() !== cleanTarget);
    if (this.platformOwners.length === before) {
      return { ok: false, error: "Akun Platform Owner tidak ditemukan." };
    }
    this.savePlatformState();
    return { ok: true, platform_owners: this.platformOwners.map((o) => this.sanitizeOwnerProfile(o)) };
  }

  findRoomsForGoogleAccount(rawEmail: string) {
    const cleanEmail = String(rawEmail || "").toLowerCase().trim();
    const domain = cleanEmail.split("@")[1] || "";

    const buildRoomCard = (
      slug: string,
      meta: RoomMeta,
      userStatus: "active" | "pending" | "invited" | "domain_eligible",
      userRole: string
    ) => {
      const rdb = this.getRoomDb(slug);
      const usersList = Array.isArray(rdb.users) ? rdb.users : [];
      const humanUsers = usersList.filter((u: any) => u && !u.is_bot && u.role !== "assistant" && u.status === "active");
      return {
        slug,
        name: String(rdb.workspace?.name || meta.name || slug),
        brand_name: String(rdb.workspace?.brand_name || meta.brand_name || meta.name),
        logo_file_id: rdb.workspace?.logo_file_id || null,
        member_count: humanUsers.length,
        member_avatars: humanUsers.slice(0, 3).map((u: any) => ({
          name: u.name || "Member",
          avatar: u.avatar || u.picture || "",
        })),
        last_active_at: meta.last_active_at || meta.created_at,
        user_status: userStatus,
        user_role: userRole,
        plan_id: rdb.workspace?.subscription?.plan_id || meta.plan_id || "free_starter",
        custom_domain: meta.custom_domain || "",
        status: meta.status || "active",
      };
    };

    // Rule: 1 akun Google hanya terhubung ke 1 workspace.
    const existingBinding = this.findAccountExistingRoom(cleanEmail);
    if (existingBinding) {
      return [
        buildRoomCard(
          existingBinding.slug,
          existingBinding.meta,
          existingBinding.user_status,
          existingBinding.user_role
        ),
      ];
    }

    const candidates: Array<{
      slug: string;
      name: string;
      brand_name: string;
      logo_file_id: string | null;
      member_count: number;
      member_avatars: Array<{ name: string; avatar: string }>;
      last_active_at: string;
      user_status: "active" | "pending" | "invited" | "domain_eligible";
      user_role: string;
      plan_id: string;
      custom_domain: string;
      status: "active" | "suspended";
      _priority: number;
    }> = [];

    for (const [slug, meta] of Object.entries(this.roomsMeta)) {
      const rdb = this.getRoomDb(slug);
      const usersList = Array.isArray(rdb.users) ? rdb.users : [];
      const deletedEmails = new Set(
        (Array.isArray(rdb.deleted_user_emails) ? rdb.deleted_user_emails : [])
          .map((e: any) => String(e || "").toLowerCase().trim())
          .filter(Boolean)
      );
      const matchedUser = usersList.find((u: any) => String(u?.email || "").toLowerCase().trim() === cleanEmail);
      if (matchedUser && (matchedUser.status === "inactive" || matchedUser.status === "rejected")) continue;

      const invited = (Array.isArray(rdb.invitations) ? rdb.invitations : []).find(
        (inv: any) => !inv?.used && String(inv?.email || "").toLowerCase().trim() === cleanEmail
      );
      const allowedDomains = Array.isArray(rdb.workspace?.allowed_domains) ? rdb.workspace.allowed_domains : [];
      const autoJoinDomain =
        rdb.workspace?.auto_join_domain !== false &&
        Boolean(domain) &&
        allowedDomains.some((d: string) => String(d || "").toLowerCase().replace(/^@+/, "").trim() === domain);

      if (!invited && !autoJoinDomain) continue;
      if (!invited && deletedEmails.has(cleanEmail) && !autoJoinDomain) continue;

      candidates.push({
        ...buildRoomCard(
          slug,
          meta,
          invited ? "invited" : "domain_eligible",
          invited?.role || "employee"
        ),
        _priority: invited ? 2 : 1,
      });
    }

    candidates.sort((a, b) => {
      if (b._priority !== a._priority) return b._priority - a._priority;
      if (a.slug === DEFAULT_ROOM_SLUG && b.slug !== DEFAULT_ROOM_SLUG) return -1;
      if (b.slug === DEFAULT_ROOM_SLUG && a.slug !== DEFAULT_ROOM_SLUG) return 1;
      return new Date(b.last_active_at || 0).getTime() - new Date(a.last_active_at || 0).getTime();
    });

    if (candidates.length === 0) return [];
    const { _priority: _ignored, ...singleEligible } = candidates[0];
    return [singleEligible];
  }

  createRoom(input: {
    workspace_name: string;
    slug?: string;
    tagline?: string;
    description?: string;
    org_levels?: string[] | string;
    divisions?: string[] | string;
    logo_file_id?: string | null;
    favicon_file_id?: string | null;
    login_image_file_id?: string | null;
    custom_domain?: string;
    allowed_domains?: string[] | string;
    auto_join_domain?: boolean;
    require_approval?: boolean;
    super_admin_name: string;
    super_admin_email: string;
    super_admin_picture?: string;
  }): { ok: boolean; error?: string; slug?: string; meta?: RoomMeta; db?: Record<string, any> } {
    const wsName = String(input.workspace_name || "").trim();
    const adminName = String(input.super_admin_name || "").trim();
    const adminEmail = String(input.super_admin_email || "").toLowerCase().trim();
    if (!wsName) return { ok: false, error: "Nama Workspace wajib diisi." };
    if (!adminName || !adminEmail || !adminEmail.includes("@")) {
      return { ok: false, error: "Nama Lengkap dan Email Google Super Admin wajib diisi dengan benar." };
    }

    const existingBinding = this.findAccountExistingRoom(adminEmail);
    if (existingBinding) {
      return {
        ok: false,
        error: `Akun Google ${adminEmail} sudah terhubung ke workspace "${existingBinding.meta.name}". 1 akun Google hanya dapat masuk ke 1 workspace.`,
      };
    }

    let slug = slugifyRoom(input.slug || wsName);
    if (this.roomsMeta[slug] || this.roomDbs.has(slug)) {
      return { ok: false, error: `Slug URL "/w/${slug}" sudah dipakai workspace lain. Gunakan nama atau slug lain.` };
    }

    const parseCsv = (val: string[] | string | undefined): string[] => {
      if (Array.isArray(val)) return val.map((x) => String(x || "").trim()).filter(Boolean);
      return String(val || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    };

    const divisions = parseCsv(input.divisions);
    const orgLevels = parseCsv(input.org_levels);
    const allowedDomains = parseCsv(input.allowed_domains).map((d) => d.toLowerCase().replace(/^@+/, ""));

    const freshDb = createFreshRoomDb({
      slug,
      workspaceName: wsName,
      tagline: input.tagline,
      description: input.description,
      orgLevels,
      divisions,
      logoFileId: input.logo_file_id,
      faviconFileId: input.favicon_file_id,
      loginImageFileId: input.login_image_file_id,
      allowedDomains,
      autoJoinDomain: input.auto_join_domain,
      requireApproval: input.require_approval,
      superAdminName: adminName,
      superAdminEmail: adminEmail,
      superAdminPicture: input.super_admin_picture,
    });

    const nowIso = new Date().toISOString();
    const existingCodes = this.getAllInviteCodes();
    const meta: RoomMeta = {
      slug,
      name: wsName,
      brand_name: wsName,
      invite_code: generateInviteCode(slug, existingCodes),
      custom_domain: String(input.custom_domain || "").trim(),
      status: "active",
      plan_id: "free_starter",
      billing_cycle: "monthly",
      owner_email: adminEmail,
      owner_name: adminName,
      created_at: nowIso,
      last_active_at: nowIso,
      telemetry: { req_24h: 1, errors_4xx: 0, errors_5xx: 0, last_request_at: nowIso },
    };

    this.roomDbs.set(slug, freshDb);
    this.roomsMeta[slug] = meta;
    this.scheduleSaveRoomDb(slug, true);
    this.savePlatformState();

    return { ok: true, slug, meta, db: freshDb };
  }

  getGatewayStatusInfo() {
    const midtransReady = Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY);
    const xenditReady = Boolean(process.env.XENDIT_SECRET_KEY);
    return {
      ...this.gatewayConfig,
      env_ready: {
        midtrans: midtransReady,
        xendit: xenditReady,
      },
      display_label:
        this.gatewayConfig.mode === "sandbox"
          ? "Gateway Pembayaran Lokal (sandbox)"
          : this.gatewayConfig.live_provider === "xendit"
          ? "Xendit Invoice (Production/Live)"
          : "Midtrans Snap (Production/Live)",
    };
  }

  buildDashboardPayload() {
    const roomRows = Object.entries(this.roomsMeta).map(([slug, meta]) => {
      const rdb = this.getRoomDb(slug);
      const humanUsers = (rdb.users || []).filter((u: any) => u && !u.is_bot && u.role !== "assistant");
      const activeUsers = humanUsers.filter((u: any) => u.status === "active");
      const onlineUsers = activeUsers.filter((u: any) => u.online);
      const pendingApprovals = (rdb.access_requests || []).filter((r: any) => r?.status === "pending").length;
      const plan = this.getPlanById(rdb.workspace?.subscription?.plan_id || meta.plan_id);
      const storageMb = this.getRoomStorageUsedMb(slug);
      return {
        ...meta,
        name: String(rdb.workspace?.name || meta.name),
        plan_id: plan.id,
        plan_name: plan.name,
        max_members: plan.max_members,
        storage_quota_mb: plan.storage_mb,
        active_members: activeUsers.length,
        online_members: onlineUsers.length,
        pending_approvals: pendingApprovals,
        tasks_count: Array.isArray(rdb.tasks) ? rdb.tasks.length : 0,
        messages_count: Array.isArray(rdb.messages) ? rdb.messages.length : 0,
        storage_mb: storageMb,
        storage_kb: Math.round(storageMb * 1024),
      };
    });

    const activeRooms = roomRows.filter((r) => r.status === "active").length;
    const suspendedRooms = roomRows.filter((r) => r.status !== "active").length;
    const totalUsers = roomRows.reduce((s, r) => s + r.active_members, 0);
    const totalOnline = roomRows.reduce((s, r) => s + r.online_members, 0);
    const totalPending = roomRows.reduce((s, r) => s + r.pending_approvals, 0);
    const paidTxs = this.transactions.filter((t) => t.status === "paid");
    const totalRevenue = paidTxs.reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalStorageKb = roomRows.reduce((s, r) => s + r.storage_kb, 0);
    const totalReq24h = roomRows.reduce((s, r) => s + Number(r.telemetry?.req_24h || 0), 0);

    const nowMs = Date.now();
    const curMinKey = Math.floor(nowMs / 60000);
    const realtimeSeries: Array<{ time: string; requests: number; errors: number; online_users: number }> = [];
    for (let i = 19; i >= 0; i--) {
      const k = curMinKey - i;
      const d = new Date(k * 60000);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const bucket = this.minuteTelemetryBuckets.get(k);
      realtimeSeries.push({
        time: `${hh}:${mm}`,
        requests: bucket ? bucket.requests : 0,
        errors: bucket ? bucket.errors_4xx + bucket.errors_5xx : 0,
        online_users: bucket ? bucket.online_users : i === 0 ? totalOnline : 0,
      });
    }

    const curHourKey = Math.floor(nowMs / 3600000);
    const hourlySeries: Array<{ time: string; requests: number; errors: number; online_users: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const k = curHourKey - i;
      const d = new Date(k * 3600000);
      const hh = String(d.getHours()).padStart(2, "0");
      const bucket = this.hourTelemetryBuckets.get(k);
      hourlySeries.push({
        time: `${hh}:00`,
        requests: bucket ? bucket.requests : i === 0 ? totalReq24h : 0,
        errors: bucket ? bucket.errors_4xx + bucket.errors_5xx : 0,
        online_users: bucket ? bucket.online_users : i === 0 ? totalOnline : 0,
      });
    }

    return {
      kpis: {
        total_rooms: roomRows.length,
        active_rooms: activeRooms,
        suspended_rooms: suspendedRooms,
        total_users: totalUsers,
        online_users: totalOnline,
        pending_approvals: totalPending,
        total_revenue: totalRevenue,
        paid_tx_count: paidTxs.length,
        total_tx_count: this.transactions.length,
        storage_kb: totalStorageKb,
        req_24h: totalReq24h,
        snapshot_count: this.snapshots.length,
      },
      realtime_series: realtimeSeries,
      hourly_series: hourlySeries,
      rooms: roomRows,
      plans: this.plans,
      transactions: this.transactions,
      gateway: this.getGatewayStatusInfo(),
      governance: this.governance,
      platform_owners: this.platformOwners.map((o) => this.sanitizeOwnerProfile(o)),
      snapshots: this.snapshots,
    };
  }
}
