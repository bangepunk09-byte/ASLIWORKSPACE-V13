export const DEFAULT_ORG_LEVELS = [
  "C Level",
  "Direktur",
  "Manager",
  "Lead",
  "Staff",
];

export const LEGACY_ORG_LEVEL_MAP = {
  executive: "C Level",
  "c-level": "C Level",
  "c level": "C Level",
  clevel: "C Level",
  division: "Direktur",
  director: "Direktur",
  direktur: "Direktur",
  department: "Manager",
  manager: "Manager",
  manajer: "Manager",
  team: "Lead",
  lead: "Lead",
  leader: "Lead",
  supervisor: "Lead",
  staff: "Staff",
  staf: "Staff",
  employee: "Staff",
};

export const ORG_LEVEL_META = {
  "C Level": {
    rank: 1,
    short: "L1",
    subtitle: "CEO, CTO, CFO, COO, CMO, Founder & Komisaris",
    accent: "#E11D48",
    badge: "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60",
    dot: "bg-rose-500",
    ring: "border-l-rose-500",
  },
  Direktur: {
    rank: 2,
    short: "L2",
    subtitle: "Direktur, VP, Head of Division & General Manager",
    accent: "#6366F1",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60",
    dot: "bg-indigo-500",
    ring: "border-l-indigo-500",
  },
  Manager: {
    rank: 3,
    short: "L3",
    subtitle: "Department Manager, Project Manager & Manajer",
    accent: "#D97706",
    badge: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
    dot: "bg-amber-500",
    ring: "border-l-amber-500",
  },
  Lead: {
    rank: 4,
    short: "L4",
    subtitle: "Team Lead, Creative/Tech Lead, Supervisor & Koordinator",
    accent: "#0284C7",
    badge: "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60",
    dot: "bg-sky-500",
    ring: "border-l-sky-500",
  },
  Staff: {
    rank: 5,
    short: "L5",
    subtitle: "Staff, Specialist, Officer, Designer, Engineer & Associate",
    accent: "#059669",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
    dot: "bg-emerald-500",
    ring: "border-l-emerald-500",
  },
};

export function normalizeOrgLevel(raw) {
  const s = String(raw || "").replace(/^\s*\d+\.\s*/, "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (LEGACY_ORG_LEVEL_MAP[lower]) return LEGACY_ORG_LEVEL_MAP[lower];
  return s;
}

export function resolveWorkspaceOrgLevels(wsLevels) {
  if (!Array.isArray(wsLevels) || wsLevels.length === 0) {
    return [...DEFAULT_ORG_LEVELS];
  }
  const lower = wsLevels.map((x) => String(x || "").trim().toLowerCase());
  const isLegacyDefault =
    lower.length === 4 &&
    lower[0] === "executive" &&
    lower[1] === "division" &&
    lower[2] === "department" &&
    lower[3] === "team";
  if (isLegacyDefault) return [...DEFAULT_ORG_LEVELS];
  const cleaned = wsLevels.map((x) => normalizeOrgLevel(x)).filter(Boolean);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...DEFAULT_ORG_LEVELS];
}

export function inferUserOrgLevel(user, levels = DEFAULT_ORG_LEVELS) {
  const validLevels = Array.isArray(levels) && levels.length > 0 ? levels : DEFAULT_ORG_LEVELS;
  if (user?.org_level) {
    const normalized = normalizeOrgLevel(user.org_level);
    if (normalized) return normalized;
  }

  const title = String(user?.job_title || "").toLowerCase();
  const role = String(user?.role || "").toLowerCase();

  // 1. C Level
  if (
    /\b(ceo|cto|cfo|coo|cmo|cio|cpo|chro|chief|c-level|c level|founder|co-founder|president|komisaris|commissioner)\b/i.test(title)
  ) {
    return validLevels[0] || "C Level";
  }

  // 2. Direktur
  if (
    /\b(direktur|director|vp|vice president|svp|evp|general manager|gm|head of)\b/i.test(title)
  ) {
    return validLevels[1] || "Direktur";
  }

  // 3. Manager
  if (
    /\b(manager|manajer|pm)\b/i.test(title) ||
    role === "department_manager" ||
    role === "project_manager"
  ) {
    return validLevels[2] || "Manager";
  }

  // 4. Lead
  if (
    /\b(lead|leader|supervisor|spv|koordinator|coordinator|principal|head|senior)\b/i.test(title) ||
    role === "workspace_admin"
  ) {
    return validLevels[3] || "Lead";
  }

  // 5. Staff (default)
  return validLevels[4] || validLevels[validLevels.length - 1] || "Staff";
}

export function getOrgLevelRank(level, levels = DEFAULT_ORG_LEVELS) {
  const normalized = normalizeOrgLevel(level);
  const list = Array.isArray(levels) && levels.length > 0 ? levels : DEFAULT_ORG_LEVELS;
  const idx = list.findIndex((l) => String(l).toLowerCase() === normalized.toLowerCase());
  if (idx !== -1) return idx + 1;
  return ORG_LEVEL_META[normalized]?.rank || list.length + 1;
}

export function getOrgLevelMeta(level, levels = DEFAULT_ORG_LEVELS) {
  const normalized = normalizeOrgLevel(level) || "Staff";
  const rank = getOrgLevelRank(normalized, levels);
  const preset = ORG_LEVEL_META[normalized];
  if (preset) return { ...preset, rank, label: normalized };
  return {
    rank,
    short: `L${rank}`,
    label: normalized,
    subtitle: "Level organisasi",
    accent: "#64748B",
    badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    dot: "bg-slate-500",
    ring: "border-l-slate-400",
  };
}

const ARCHIVE_APPROVER_DEPT_OR_TITLE_RE =
  /\b(hr|hrd|human resource|people ops|finance|accounting|ga|general affair|procurement|legal|office manager|admin)\b/i;

export function canViewAllArchiveDivisions(user) {
  if (!user || user.is_bot || user.role === "assistant") return false;
  const role = String(user.role || "").toLowerCase();
  if (role === "super_admin" || role === "workspace_admin") return true;
  const level = inferUserOrgLevel(user);
  const rank = getOrgLevelRank(level);
  if (rank <= 2) return true; // C Level & Direktur
  const dept = String(user.department || "");
  const title = String(user.job_title || "");
  if (ARCHIVE_APPROVER_DEPT_OR_TITLE_RE.test(dept) || ARCHIVE_APPROVER_DEPT_OR_TITLE_RE.test(title)) {
    return true;
  }
  return false;
}

export function canAccessEmployeeArchives(user, { users = [], serverFlag = false } = {}) {
  if (!user || user.is_bot || user.role === "assistant") return false;
  if (serverFlag || user.can_access_archives || user.can_approve || user.archive_access) return true;
  const role = String(user.role || "").toLowerCase();
  if (["super_admin", "workspace_admin", "department_manager", "project_manager", "manager"].includes(role)) {
    return true;
  }
  const level = inferUserOrgLevel(user);
  const rank = getOrgLevelRank(level);
  // Rank 1..4 = C Level, Direktur, Manager, Lead
  if (rank <= 4) return true;
  const dept = String(user.department || "");
  const title = String(user.job_title || "");
  if (ARCHIVE_APPROVER_DEPT_OR_TITLE_RE.test(dept) || ARCHIVE_APPROVER_DEPT_OR_TITLE_RE.test(title)) {
    return true;
  }
  if (Array.isArray(users) && user.user_id && users.some((u) => u && u.manager_id === user.user_id)) {
    return true;
  }
  return false;
}

export function canAccessLocationTracking(user) {
  if (!user || user.is_bot || user.role === "assistant") return false;
  const role = String(user.role || "").toLowerCase();
  if (["super_admin", "workspace_admin", "department_manager", "project_manager", "manager"].includes(role)) {
    return true;
  }
  const level = inferUserOrgLevel(user);
  const rank = getOrgLevelRank(level);
  // Rank 1..4 = C Level, Direktur, Manager, Lead. Level Staff (rank >= 5) tidak dapat mengakses fitur lacak.
  return rank <= 4;
}


