import { scheduleJsonStorageWrite } from "./workspaceCaches";
import { enforceTaskApprovalInvariant } from "./snapshotMerge";

// ---- Shared Tasks & Boards Workspace Cache ----
export const DEFAULT_BOARDS = [
  { id: "brd_div_marketing", name: "Marketing", department: "Marketing", color: "#10B981", is_accessible: true },
  { id: "brd_div_sales", name: "Sales", department: "Sales", color: "#F59E0B", is_accessible: true },
  { id: "brd_div_it", name: "IT", department: "IT", color: "#06B6D4", is_accessible: true },
  { id: "brd_div_finance", name: "Finance", department: "Finance", color: "#14B8A6", is_accessible: true },
  { id: "brd_div_legal", name: "Legal", department: "Legal", color: "#6366F1", is_accessible: true },
  { id: "brd_div_hrga", name: "HRGA", department: "HRGA", color: "#F97316", is_accessible: true },
  { id: "brd_div_management", name: "Management", department: "Management", color: "#FF5364", is_accessible: true },
  { id: "brd_div_project", name: "Project", department: "Project", color: "#8B5CF6", is_accessible: true },
];

export const TASKS_CACHE_BOX = {
  tasks: null,
  boards: null,
  allBoards: null,
  projects: null,
};

export function hydrateTasksWorkspaceCache({ tasks, boards, allBoards, projects } = {}) {
  if (Array.isArray(tasks)) {
    TASKS_CACHE_BOX.tasks = tasks.map((t) => enforceTaskApprovalInvariant(t));
  }
  if (Array.isArray(boards) && boards.length > 0) {
    const clean = boards
      .filter((b) => b && b.id !== "brd_1")
      .map((b) => ({ ...b, is_accessible: b.is_accessible ?? true }));
    if (clean.length > 0) {
      TASKS_CACHE_BOX.boards = clean;
      scheduleJsonStorageWrite("circle_boards_cache", clean);
    }
  }
  if (Array.isArray(allBoards) && allBoards.length > 0) {
    TASKS_CACHE_BOX.allBoards = allBoards;
  }
  if (Array.isArray(projects)) {
    TASKS_CACHE_BOX.projects = Object.fromEntries(projects.map((p) => [p.id, p]));
  }
}

// ---- Shared Org Units Cache ----
export const INITIAL_UNITS = [
  { id: "unit_mgmt", name: "Management", division: "Management", description: "Board of Directors & Executive Leadership", level: "Executive", color: "#FF5364", head_id: "user_superadmin_saeful", parent_id: null, order: 0 },
  { id: "unit_mkt", name: "Marketing", division: "Marketing", description: "Brand Marketing, Campaign & Social Media Growth", level: "Division", color: "#10B981", head_id: null, parent_id: "unit_mgmt", order: 1 },
  { id: "unit_sales", name: "Sales", division: "Sales", description: "Enterprise Sales, Partnership & Business Development", level: "Division", color: "#F59E0B", head_id: null, parent_id: "unit_mgmt", order: 2 },
  { id: "unit_it", name: "IT", division: "IT", description: "IT Infrastructure, Security & Internal Support", level: "Division", color: "#06B6D4", head_id: "user_admin1", parent_id: "unit_mgmt", order: 3 },
  { id: "unit_fin", name: "Finance", division: "Finance", description: "Financial Planning, Accounting & Treasury", level: "Division", color: "#14B8A6", head_id: null, parent_id: "unit_mgmt", order: 4 },
  { id: "unit_legal", name: "Legal", division: "Legal", description: "Corporate Legal, Compliance & Contracts", level: "Division", color: "#6366F1", head_id: null, parent_id: "unit_mgmt", order: 5 },
  { id: "unit_hrga", name: "HRGA", division: "HRGA", description: "Human Resources, Talent & General Affairs", level: "Division", color: "#F97316", head_id: null, parent_id: "unit_mgmt", order: 6 },
];

export const ORG_UNITS_CACHE_BOX = {
  units: INITIAL_UNITS,
};

try {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem("circle_org_units_cache");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) ORG_UNITS_CACHE_BOX.units = parsed;
    }
  }
} catch {}

export function hydrateOrgUnitsCache(units) {
  if (Array.isArray(units) && units.length > 0) {
    ORG_UNITS_CACHE_BOX.units = units;
    scheduleJsonStorageWrite("circle_org_units_cache", units);
  }
}

// ---- Shared Admin Panels Cache ----
export const ADMIN_PANELS_CACHE_BOX = {
  stats: null,
  auditLogs: null,
  users: null,
  invites: null,
  accessReqs: null,
  divisions: null,
  stickers: null,
  recoveryKey: "",
};

export function hydrateAdminPanelsCache({
  adminStats,
  auditLogs,
  users,
  invitations,
  accessRequests,
  divisions,
  stickers,
  recoveryKey,
} = {}) {
  try {
    if (adminStats && typeof adminStats === "object") {
      ADMIN_PANELS_CACHE_BOX.stats = adminStats;
      scheduleJsonStorageWrite("circle_admin_stats", adminStats);
    }
    if (Array.isArray(auditLogs)) {
      ADMIN_PANELS_CACHE_BOX.auditLogs = auditLogs;
      scheduleJsonStorageWrite("circle_admin_audit", auditLogs);
    }
    if (Array.isArray(users) && users.length > 0) {
      ADMIN_PANELS_CACHE_BOX.users = users;
      scheduleJsonStorageWrite("circle_admin_users", users);
    }
    if (Array.isArray(invitations)) {
      ADMIN_PANELS_CACHE_BOX.invites = invitations;
      scheduleJsonStorageWrite("circle_admin_invites", invitations);
    }
    if (Array.isArray(accessRequests)) {
      ADMIN_PANELS_CACHE_BOX.accessReqs = accessRequests;
      scheduleJsonStorageWrite("circle_admin_access_reqs", accessRequests);
    }
    if (Array.isArray(divisions) && divisions.length > 0) {
      ADMIN_PANELS_CACHE_BOX.divisions = divisions;
      scheduleJsonStorageWrite("circle_admin_divisions", divisions);
    }
    if (stickers && Array.isArray(stickers.packs)) {
      ADMIN_PANELS_CACHE_BOX.stickers = stickers;
      scheduleJsonStorageWrite("circle_admin_stickers_data", stickers);
    }
    if (typeof recoveryKey === "string" && recoveryKey) {
      ADMIN_PANELS_CACHE_BOX.recoveryKey = recoveryKey;
    }
  } catch {}
}

// ---- Shared Team Stats Memory Cache ----
export const TEAM_STATS_MEMORY_CACHE = {};

export function resolveActiveStatsUserId(userIdOrMe) {
  if (typeof userIdOrMe === "string" && userIdOrMe && userIdOrMe !== "anon") return userIdOrMe;
  if (userIdOrMe && typeof userIdOrMe === "object" && userIdOrMe.user_id) return userIdOrMe.user_id;
  try {
    const raw =
      sessionStorage.getItem("circle_session_user") ||
      localStorage.getItem("circle_me_cache") ||
      localStorage.getItem("circle_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      const u = parsed?.user || parsed;
      if (u?.user_id) return String(u.user_id);
    }
  } catch {}
  return "anon";
}

export function isValidStats(d) {
  return Boolean(
    d &&
      typeof d === "object" &&
      d.summary &&
      typeof d.summary === "object" &&
      Array.isArray(d.series) &&
      Array.isArray(d.people)
  );
}

export function makeStatsCacheKey(userId, boardScopeKey, rRange) {
  const uid = resolveActiveStatsUserId(userId);
  return `${uid}::${boardScopeKey || "default"}::${rRange || "7d"}`;
}

export function hydrateTeamStatsCache(userId, statsData, boardScopeKey = "default", rRange = "7d") {
  if (!isValidStats(statsData)) return;
  const uid = resolveActiveStatsUserId(userId);
  const { scopes_stats: peerScopesMap, ...cleanPrimary } = statsData;
  const cleanPayload = { ...cleanPrimary, __serverAuthoritative: true };
  const key = makeStatsCacheKey(uid, boardScopeKey, rRange);
  TEAM_STATS_MEMORY_CACHE[key] = cleanPayload;
  scheduleJsonStorageWrite(`circle_stats_team_v2_cache_${key}`, cleanPayload);

  if (cleanPayload.scope?.board_id && cleanPayload.scope.board_id !== boardScopeKey) {
    const altKey = makeStatsCacheKey(uid, cleanPayload.scope.board_id, rRange);
    TEAM_STATS_MEMORY_CACHE[altKey] = cleanPayload;
    scheduleJsonStorageWrite(`circle_stats_team_v2_cache_${altKey}`, cleanPayload);
  }

  if (peerScopesMap && typeof peerScopesMap === "object") {
    Object.entries(peerScopesMap).forEach(([peerBoardId, peerData]) => {
      if (!peerBoardId || !isValidStats(peerData)) return;
      const { scopes_stats: _nested, ...cleanPeer } = peerData;
      const peerPayload = {
        ...cleanPeer,
        available_scopes:
          Array.isArray(cleanPeer.available_scopes) && cleanPeer.available_scopes.length > 0
            ? cleanPeer.available_scopes
            : cleanPayload.available_scopes || [],
        __serverAuthoritative: true,
      };
      const peerKey = makeStatsCacheKey(uid, peerBoardId, peerPayload.range || rRange);
      TEAM_STATS_MEMORY_CACHE[peerKey] = peerPayload;
      scheduleJsonStorageWrite(`circle_stats_team_v2_cache_${peerKey}`, peerPayload);
    });
  }
}

// ---- Lightweight Marketplace Flag Reconciliation (avoids importing heavy marketplace bundle into AppContext) ----
export function reconcileMarketplaceEnabledCacheLite(uid, enabled, wsConfig) {
  if (typeof enabled !== "boolean") return;
  const k = `circle_marketplace_state_${uid || "anon"}`;
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const updated = {
          ...parsed,
          enabled,
          ...(wsConfig && typeof wsConfig === "object"
            ? { config: { ...(parsed.config || {}), ...wsConfig } }
            : {}),
        };
        scheduleJsonStorageWrite(k, updated);
      }
    }
  } catch {}
}
