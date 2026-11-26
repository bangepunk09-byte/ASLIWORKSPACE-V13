import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, LineChart as LineIcon, BarChart3, Users, Filter, MessageSquare, ArrowRight, CheckCircle2, AlertTriangle, Target, GitBranch, ChevronDown, Check } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { api, errMsg } from "../../lib/api";
import { scheduleJsonStorageWrite, upsertConversationInCache } from "../../lib/workspaceCaches";
import { Avatar, AvatarStack, LabelChip } from "../../components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { analyzeTaskFlow, toDayDate } from "../tasks/timelineFlow";

const WD = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WD_FULL = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const GREEN = "#4CB782";
const RED = "#E5484D";
const STATUS = { optimal: ["😄", "Optimal", "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10"], stabil: ["😐", "Stabil", "border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-500/10"], pressure: ["😰", "Under Pressure", "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10"] };
const seg = (on) => `h-9 rounded-xl px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${on ? "bg-surface text-ink shadow-sm" : "text-sub hover:text-ink"}`;

const FALLBACK_PEOPLE = [
  { user_id: "user_admin1", status: "optimal", active: 0, share: 0, day_deadlines: 0, tasks: [], more: 0 },
  { user_id: "user_superadmin_saeful", status: "optimal", active: 0, share: 0, day_deadlines: 0, tasks: [], more: 0 }
];

const INITIAL_DATA = {
  today: new Date().toISOString().slice(0, 10),
  anchor: new Date().toISOString().slice(0, 10),
  week: Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1) + i);
    return d.toISOString().slice(0, 10);
  }),
  range: "7d",
  summary: { done: 0, done_on_time: 0, done_late: 0, overdue: 0, active_on_track: 0, active: 0, total: 0, on_time: 0, due: 0, on_time_rate: 0 },
  series: [
    { start: "2026-11-02", name: "Senin", done: 0, overdue: 0 },
    { start: "2026-11-03", name: "Selasa", done: 0, overdue: 0 },
    { start: "2026-11-04", name: "Rabu", done: 0, overdue: 0 },
    { start: "2026-11-05", name: "Kamis", done: 0, overdue: 0 },
    { start: "2026-11-06", name: "Jumat", done: 0, overdue: 0 },
    { start: "2026-11-07", name: "Sabtu", done: 0, overdue: 0 },
    { start: "2026-11-08", name: "Minggu", done: 0, overdue: 0 }
  ],
  people: FALLBACK_PEOPLE
};

const statsMemoryCache = {};

function clearStatsMemoryCacheForUser(userId) {
  const prefix = `${userId || "anon"}::`;
  Object.keys(statsMemoryCache).forEach((k) => {
    if (k.startsWith(prefix)) delete statsMemoryCache[k];
  });
}

function isValidStats(d) {
  return Boolean(d && typeof d === "object" && d.summary && typeof d.summary === "object" && Array.isArray(d.series) && Array.isArray(d.people));
}

function makeStatsCacheKey(userId, boardScopeKey, rRange) {
  return `${userId || "anon"}::${boardScopeKey || "default"}::${rRange}`;
}

export function hydrateTeamStatsCache(userId, statsData, boardScopeKey = "default", rRange = "7d") {
  if (!isValidStats(statsData)) return;
  const key = makeStatsCacheKey(userId, boardScopeKey, rRange);
  statsMemoryCache[key] = statsData;
  scheduleJsonStorageWrite(`circle_stats_team_v2_cache_${key}`, statsData);
  if (statsData.scope?.board_id && statsData.scope.board_id !== boardScopeKey) {
    const altKey = makeStatsCacheKey(userId, statsData.scope.board_id, rRange);
    statsMemoryCache[altKey] = statsData;
    scheduleJsonStorageWrite(`circle_stats_team_v2_cache_${altKey}`, statsData);
  }
}

function readCachedBoardsList() {
  try {
    const raw = localStorage.getItem("circle_boards_cache");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function isCollabBoardClient(b) {
  if (!b) return false;
  const bd = String(b.department || "").trim().toLowerCase();
  return Boolean(
    b.is_collaborative ||
    b.board_type === "collaborative" ||
    b.board_type === "project" ||
    b.project_id ||
    !bd ||
    bd === "semua divisi" ||
    bd === "all" ||
    bd === "kolaborasi"
  );
}

function taskMatchesBoardClient(t, b) {
  if (!t || !b) return false;
  const bid = b.id || b.board_id;
  if (t.board_id && bid && t.board_id === bid) return true;
  const bDept = String(b.department || "").trim().toLowerCase();
  const tDept = String(t.department || "").trim().toLowerCase();
  if (!t.board_id && bDept && tDept && tDept === bDept && !isCollabBoardClient(b)) return true;
  return false;
}

function computeInstantClientStats(
  tasks = [],
  users = [],
  me = null,
  rRange = "7d",
  boardScopeKey = "default",
  boardsList = [],
  existingScopes = []
) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeUsers = Array.isArray(users) ? users.filter((u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant") : [];
  const isSuper = me?.role === "super_admin" || me?.role === "workspace_admin";
  const myDept = String(me?.department || "Marketing").trim();
  const myDeptLower = myDept.toLowerCase();

  // Merge board metadata from circle_boards_cache + existing available_scopes
  const boardById = new Map();
  (Array.isArray(boardsList) ? boardsList : []).forEach((b) => {
    if (b?.id) boardById.set(b.id, { ...b, id: b.id, board_id: b.id });
  });
  (Array.isArray(existingScopes) ? existingScopes : []).forEach((sc) => {
    const id = sc?.board_id || sc?.id;
    if (!id) return;
    const prev = boardById.get(id) || {};
    boardById.set(id, {
      ...prev,
      id,
      board_id: id,
      name: sc.name || prev.name || sc.department || "Board",
      department: sc.department ?? prev.department ?? "",
      color: sc.color || prev.color || "#3B82F6",
      is_collaborative: sc.is_collaborative ?? prev.is_collaborative ?? false,
    });
  });

  const allBoards = Array.from(boardById.values());
  const accessibleBoards = allBoards.filter((b) => {
    if (isSuper) return true;
    const bDept = String(b.department || "").trim().toLowerCase();
    const isCollab = isCollabBoardClient(b);
    const isDeptMember = Boolean(myDeptLower && bDept && bDept === myDeptLower);
    const isInvited = Boolean(me?.user_id && Array.isArray(b.invited_member_ids) && b.invited_member_ids.includes(me.user_id));
    const isCollabMember = Boolean(
      isCollab &&
      (b.all_workspace_members !== false ||
        bDept === "semua divisi" ||
        (me?.user_id && Array.isArray(b.member_ids) && b.member_ids.includes(me.user_id)))
    );
    const isCreator = Boolean(me?.user_id && b.created_by === me.user_id);
    return isDeptMember || isInvited || isCollabMember || isCreator;
  });

  const orderedBoards = [...accessibleBoards].sort((a, b) => {
    const aOwn = myDeptLower && String(a.department || "").trim().toLowerCase() === myDeptLower && !isCollabBoardClient(a) ? 1 : 0;
    const bOwn = myDeptLower && String(b.department || "").trim().toLowerCase() === myDeptLower && !isCollabBoardClient(b) ? 1 : 0;
    if (bOwn !== aOwn) return bOwn - aOwn;
    const aCol = isCollabBoardClient(a) ? 1 : 0;
    const bCol = isCollabBoardClient(b) ? 1 : 0;
    return aCol - bCol;
  });

  const requestedBoardId = boardScopeKey === "default" ? "" : String(boardScopeKey || "").trim();
  let scopeMode = "board";
  let targetBoard = null;

  if (requestedBoardId === "all" && isSuper) {
    scopeMode = "all";
  } else if (requestedBoardId) {
    targetBoard = orderedBoards.find((b) => b.id === requestedBoardId) || null;
    if (!targetBoard && requestedBoardId.startsWith("brd_div_")) {
      const inferredSlug = requestedBoardId.replace(/^brd_div_/, "").replace(/_/g, " ").toLowerCase();
      targetBoard = orderedBoards.find((b) => String(b.department || b.name || "").trim().toLowerCase() === inferredSlug) || {
        id: requestedBoardId,
        name: inferredSlug.replace(/\b\w/g, (c) => c.toUpperCase()),
        department: inferredSlug,
        color: "#3B82F6",
        is_collaborative: false
      };
    }
  }

  if (scopeMode === "board" && !targetBoard) {
    const ownBoard = orderedBoards.find(
      (b) => myDeptLower && String(b.department || "").trim().toLowerCase() === myDeptLower && !isCollabBoardClient(b)
    );
    if (ownBoard) {
      const ownHasTasks = safeTasks.some((t) => !t?.archived && taskMatchesBoardClient(t, ownBoard));
      if (isSuper && !ownHasTasks) {
        targetBoard =
          orderedBoards.find((b) => !isCollabBoardClient(b) && safeTasks.some((t) => !t?.archived && taskMatchesBoardClient(t, b))) ||
          ownBoard;
      } else {
        targetBoard = ownBoard;
      }
    } else if (orderedBoards.length > 0) {
      targetBoard =
        orderedBoards.find((b) => safeTasks.some((t) => !t?.archived && taskMatchesBoardClient(t, b))) ||
        orderedBoards[0];
    }
  }

  let scopedTasks = [];
  let scopedUsers = [];
  let targetDept = myDept;

  if (scopeMode === "board" && targetBoard) {
    targetDept = targetBoard.name || targetBoard.department || myDept;
    scopedTasks = safeTasks.filter((t) => taskMatchesBoardClient(t, targetBoard));
    const bDept = String(targetBoard.department || "").trim().toLowerCase();
    const isCollab = isCollabBoardClient(targetBoard);
    const invitedSet = new Set(Array.isArray(targetBoard.invited_member_ids) ? targetBoard.invited_member_ids : []);
    const explicitMemberSet = new Set(Array.isArray(targetBoard.member_ids) ? targetBoard.member_ids : []);
    const assignedOnBoardSet = new Set();
    scopedTasks.forEach((t) => {
      if (t?.assignee_id) assignedOnBoardSet.add(t.assignee_id);
      if (Array.isArray(t?.assignee_ids)) t.assignee_ids.forEach((id) => id && assignedOnBoardSet.add(id));
    });

    if (isCollab) {
      scopedUsers = safeUsers.filter((u) => {
        if (targetBoard.all_workspace_members !== false) {
          return assignedOnBoardSet.size > 0
            ? assignedOnBoardSet.has(u.user_id) || invitedSet.has(u.user_id) || explicitMemberSet.has(u.user_id)
            : true;
        }
        return explicitMemberSet.has(u.user_id) || invitedSet.has(u.user_id) || assignedOnBoardSet.has(u.user_id);
      });
    } else {
      scopedUsers = safeUsers.filter((u) => {
        const uDept = String(u.department || "").trim().toLowerCase();
        return (
          (bDept && uDept === bDept) ||
          invitedSet.has(u.user_id) ||
          assignedOnBoardSet.has(u.user_id)
        );
      });
    }
  } else if (scopeMode === "all" && isSuper) {
    scopedTasks = safeTasks;
    scopedUsers = safeUsers;
  } else {
    scopedTasks = safeTasks.filter((t) => String(t?.department || "").trim().toLowerCase() === myDeptLower);
    if (scopedTasks.length === 0 && isSuper && safeTasks.length > 0 && !requestedBoardId) {
      const firstWithDept = safeTasks.find((t) => t?.department && String(t.department).trim().toLowerCase() !== "semua divisi");
      if (firstWithDept?.department) {
        targetDept = String(firstWithDept.department).trim();
        const tdLower = targetDept.toLowerCase();
        scopedTasks = safeTasks.filter((t) => String(t?.department || "").trim().toLowerCase() === tdLower);
      } else {
        scopedTasks = safeTasks;
      }
    }
    const targetDeptLower = targetDept.toLowerCase();
    const assignedIds = new Set();
    scopedTasks.forEach((t) => {
      if (t?.assignee_id) assignedIds.add(t.assignee_id);
      if (Array.isArray(t?.assignee_ids)) t.assignee_ids.forEach((id) => id && assignedIds.add(id));
    });
    scopedUsers = safeUsers.filter((u) => {
      const ud = String(u.department || "").trim().toLowerCase();
      return ud === targetDeptLower || assignedIds.has(u.user_id);
    });
  }

  const nowMs = Date.now();
  const WIB_OFFSET_MS = 7 * 3600000;
  const wibNow = new Date(nowMs + WIB_OFFSET_MS);
  const wibTodayStr = wibNow.toISOString().slice(0, 10);
  const todayWibIdx = Math.floor((nowMs + WIB_OFFSET_MS) / 86400000);

  let week = [];
  if (rRange === "4w") {
    week = Array.from({ length: 30 }, (_, i) => new Date(wibNow.getTime() - (29 - i) * 86400000).toISOString().slice(0, 10));
  } else {
    const dayOfWeek = (wibNow.getUTCDay() + 6) % 7;
    const mondayMs = wibNow.getTime() - dayOfWeek * 86400000;
    week = Array.from({ length: 7 }, (_, i) => new Date(mondayMs + i * 86400000).toISOString().slice(0, 10));
  }

  const toWibDateStr = (val) => {
    if (!val) return "";
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  };

  const parseDlMs = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T23:59:59.999+07:00`);
      return isNaN(d.getTime()) ? null : d.getTime();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  };

  const parseCompMs = (t, fallbackMs) => {
    const raw = t?.completed_at || t?.submit_date || t?.archived_at || t?.updated_at || t?.created_at;
    if (!raw) return fallbackMs;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T12:00:00.000+07:00`);
      return isNaN(d.getTime()) ? fallbackMs : d.getTime();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? fallbackMs : d.getTime();
  };

  let doneOnTime = 0;
  let doneLate = 0;
  let activeOverdue = 0;
  let activeOnTrack = 0;

  scopedTasks.forEach((t) => {
    if (!t) return;
    const isDone = t.status === "done" || Boolean(t.archived);
    const dlMs = parseDlMs(t.deadline);
    if (isDone) {
      const compMs = parseCompMs(t, nowMs);
      if (dlMs !== null && compMs > dlMs) doneLate += 1;
      else doneOnTime += 1;
    } else {
      if (dlMs !== null && nowMs > dlMs) activeOverdue += 1;
      else activeOnTrack += 1;
    }
  });

  const doneCount = doneOnTime + doneLate;
  const activeCount = activeOverdue + activeOnTrack;
  const dueCount = doneCount + activeOverdue;
  const onTimeRate = dueCount > 0 ? Math.round((doneOnTime / dueCount) * 100) : 0;

  const series = week.map((d, idx) => {
    const matchedDone = scopedTasks.filter((t) => {
      const isDone = t.status === "done" || Boolean(t.archived);
      if (!isDone) return false;
      const compDate = toWibDateStr(t.completed_at || t.submit_date || t.archived_at || t.updated_at);
      return compDate === d;
    }).length;

    const matchedOverdue = scopedTasks.filter((t) => {
      const dlMs = parseDlMs(t.deadline);
      if (dlMs === null) return false;
      const deadDate = toWibDateStr(t.deadline);
      if (deadDate !== d) return false;
      const isDone = t.status === "done" || Boolean(t.archived);
      if (!isDone) return nowMs > dlMs;
      const compMs = parseCompMs(t, nowMs);
      return compMs > dlMs;
    }).length;

    return {
      start: d,
      name: rRange === "4w" ? d.slice(5) : (WD_FULL[idx] || d.slice(5)),
      done: matchedDone,
      Selesai: matchedDone,
      overdue: matchedOverdue,
      Overdue: matchedOverdue,
    };
  });

  const activeScopedTasks = scopedTasks.filter((t) => t && !t.archived && t.status !== "done");
  const totalActiveLoad = activeScopedTasks.length || 1;

  const people = scopedUsers.map((u) => {
    const myActive = activeScopedTasks.filter(
      (t) => t.assignee_id === u.user_id || (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(u.user_id))
    );
    let overdueCount = 0;
    let under6hCount = 0;
    let todayRestCount = 0;
    let dueByTomorrowCount = 0;
    let minHoursLeft = null;

    myActive.forEach((t) => {
      if (!t.deadline) return;
      const dl = new Date(t.deadline);
      if (isNaN(dl.getTime())) return;
      const hoursLeft = (dl.getTime() - nowMs) / 3600000;
      if (minHoursLeft === null || hoursLeft < minHoursLeft) minHoursLeft = hoursLeft;
      const dayDiff = Math.floor((dl.getTime() + WIB_OFFSET_MS) / 86400000) - todayWibIdx;
      if (hoursLeft <= 0) {
        overdueCount += 1;
        dueByTomorrowCount += 1;
      } else if (hoursLeft < 6) {
        under6hCount += 1;
        dueByTomorrowCount += 1;
      } else {
        if (dayDiff <= 0) todayRestCount += 1;
        if (dayDiff <= 1) dueByTomorrowCount += 1;
      }
    });

    const uActiveCount = myActive.length;
    let status = "optimal";
    let status_reason = "Tidak ada tugas aktif";
    if (uActiveCount === 0) {
      status = "optimal";
      status_reason = "Kapasitas tersedia penuh (0 tugas aktif)";
    } else if (overdueCount > 0) {
      status = "pressure";
      status_reason = `${overdueCount} tugas melewati tenggat waktu`;
    } else if (under6hCount > 0) {
      status = "pressure";
      const nearestH = minHoursLeft !== null ? Math.max(1, Math.ceil(minHoursLeft)) : 6;
      status_reason = `${under6hCount} tugas deadline < 6 jam (~${nearestH} jam lagi)`;
    } else if (dueByTomorrowCount >= 5) {
      status = "pressure";
      status_reason = `${dueByTomorrowCount} tugas harus disubmit ≤ besok`;
    } else if (uActiveCount >= 8) {
      status = "pressure";
      status_reason = `Beban sangat tinggi (${uActiveCount} tugas aktif)`;
    } else if (dueByTomorrowCount >= 3) {
      status = "stabil";
      status_reason = `${dueByTomorrowCount} tugas deadline ≤ besok (perlu fokus)`;
    } else if (todayRestCount > 0 || (minHoursLeft !== null && minHoursLeft < 18)) {
      status = "stabil";
      status_reason = `Ada deadline hari ini / < 18 jam (≥ 6 jam)`;
    } else if (uActiveCount >= 5) {
      status = "stabil";
      status_reason = `${uActiveCount} tugas aktif dengan deadline ≥ 2 hari`;
    } else if (dueByTomorrowCount > 0) {
      status = "optimal";
      status_reason = `${dueByTomorrowCount} tugas deadline 1 hari lagi (beban ringan)`;
    } else if (minHoursLeft !== null) {
      const daysLeft = Math.max(2, Math.floor(minHoursLeft / 24));
      status = "optimal";
      status_reason = `Deadline masih ${daysLeft}+ hari ke depan (${uActiveCount} tugas)`;
    } else {
      status = "optimal";
      status_reason = `${uActiveCount} tugas aktif tanpa tenggat mendesak`;
    }

    const dayDeadlines = myActive.filter((t) => t.deadline && String(t.deadline).slice(0, 10) === wibTodayStr).length;

    return {
      user_id: u.user_id,
      status,
      status_reason,
      active: uActiveCount,
      share: activeScopedTasks.length > 0 ? Math.round((uActiveCount / totalActiveLoad) * 100) : 0,
      day_deadlines: dayDeadlines,
      tasks: myActive.slice(0, 3).map((t) => ({ id: t.id, title: t.title })),
      more: Math.max(0, uActiveCount - 3),
    };
  });

  const computedAvailableScopes = orderedBoards.length > 0
    ? orderedBoards.map((b) => ({
        board_id: b.id,
        name: b.name || b.department || "Board",
        department: b.department || "",
        color: b.color || "#3B82F6",
        is_collaborative: isCollabBoardClient(b),
        task_count: safeTasks.filter((t) => !t?.archived && taskMatchesBoardClient(t, b)).length,
      }))
    : (Array.isArray(existingScopes) ? existingScopes : []);

  return {
    scope: {
      mode: scopeMode,
      board_id: scopeMode === "all" ? "all" : (targetBoard?.id || requestedBoardId || `brd_div_${targetDept.toLowerCase()}`),
      board_name: scopeMode === "all" ? "Semua Divisi" : (targetBoard?.name || targetBoard?.department || targetDept),
      department: scopeMode === "all" ? null : (targetBoard?.department || targetDept || null),
      color: scopeMode === "all" ? null : (targetBoard?.color || "#FF5364"),
      is_admin: isSuper,
      total_tasks: scopedTasks.length,
    },
    available_scopes: computedAvailableScopes,
    today: wibTodayStr,
    anchor: wibTodayStr,
    range: rRange,
    summary: {
      done: doneCount,
      done_on_time: doneOnTime,
      done_late: doneLate,
      overdue: activeOverdue,
      active_on_track: activeOnTrack,
      active: activeCount,
      total: scopedTasks.length,
      on_time_rate: onTimeRate,
      due: dueCount,
      on_time: doneOnTime,
    },
    week,
    series,
    people: scopedUsers.length > 0 || safeTasks.length > 0 || safeUsers.length > 0 ? people : FALLBACK_PEOPLE,
  };
}

function getCachedStats(
  userId,
  boardScopeKey,
  rRange,
  fallbackTasks = [],
  fallbackUsers = [],
  me = null,
  fallbackBoards = [],
  fallbackScopes = []
) {
  const preserveScopes = (stats) => {
    if (!stats) return stats;
    if ((!Array.isArray(stats.available_scopes) || stats.available_scopes.length === 0) && Array.isArray(fallbackScopes) && fallbackScopes.length > 0) {
      return { ...stats, available_scopes: fallbackScopes };
    }
    return stats;
  };

  const key = makeStatsCacheKey(userId, boardScopeKey, rRange);
  if (isValidStats(statsMemoryCache[key])) return preserveScopes(statsMemoryCache[key]);

  if (Array.isArray(fallbackTasks) && fallbackTasks.length > 0) {
    return computeInstantClientStats(fallbackTasks, fallbackUsers, me, rRange, boardScopeKey, fallbackBoards, fallbackScopes);
  }

  try {
    const cached = localStorage.getItem(`circle_stats_team_v2_cache_${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (isValidStats(parsed)) {
        statsMemoryCache[key] = parsed;
        return preserveScopes(parsed);
      }
    }
  } catch {}

  if (Array.isArray(fallbackScopes) && fallbackScopes.length > 0) {
    return computeInstantClientStats(fallbackTasks, fallbackUsers, me, rRange, boardScopeKey, fallbackBoards, fallbackScopes);
  }

  return INITIAL_DATA;
}

function statsSignature(d) {
  if (!d) return "";
  try {
    return JSON.stringify({
      s: d.summary,
      sc: d.scope,
      r: d.range,
      sr: d.series,
      p: (d.people || []).map((x) => [x.user_id, x.status, x.active, x.share, x.day_deadlines, x.more, (x.tasks || []).map((t) => t.id)]),
      av: (d.available_scopes || []).map((a) => [a.board_id, a.name, a.task_count, a.color]),
    });
  } catch {
    return "";
  }
}

function useScopeSmoothReveal(_scopeKey) {
  return useRef(null);
}

const StatCard = memo(function StatCard({ label, value, note, tone, icon: Icon, testid, className = "" }) {
  const t = {
    green: "border-emerald-200/90 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 dark:border-emerald-900/60",
    red: "border-rose-200/90 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 dark:border-rose-900/60",
    gray: "border bg-surface2/60 text-ink dark:border-slate-800"
  }[tone];

  const iconStyles = {
    green: "text-emerald-600 bg-emerald-100/90 dark:bg-emerald-900/50 dark:text-emerald-300",
    red: "text-rose-600 bg-rose-100/90 dark:bg-rose-900/50 dark:text-rose-300",
    gray: "text-blue-600 bg-blue-100/90 dark:bg-blue-900/50 dark:text-blue-300"
  }[tone];

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-2xl border p-3.5 sm:p-5 transition-shadow duration-150 hover:shadow-md ${t} ${className}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] opacity-80 leading-snug break-words min-w-0">{label}</p>
        {Icon && (
          <span className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl ${iconStyles} shadow-xs`}>
            <Icon size={16} strokeWidth={2.4} />
          </span>
        )}
      </div>
      <p className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs sm:text-sm font-medium opacity-80 leading-snug">{note}</p>
    </div>
  );
});

const CHART_MARGIN = { top: 10, right: 12, left: -18, bottom: 0 };
const CHART_AXES = [
  <CartesianGrid key="g" strokeDasharray="3 6" vertical={false} stroke="var(--c-border, #E5E7EB)" />,
  <XAxis key="x" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--c-sub, #7A8194)" }} />,
  <YAxis key="y" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--c-sub, #7A8194)" }} />,
  <Tooltip key="t" cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 12 }} />
];

const TeamChart = memo(function TeamChart({ data, type }) {
  const safeData = data || INITIAL_DATA;
  const rows = useMemo(
    () =>
      (safeData.series || []).map((s, i) => {
        const d = new Date(`${s.start}T00:00:00`);
        const future = s.start > safeData.today;
        return {
          name: safeData.range === "4w" ? `${d.getDate()} ${MON[d.getMonth()]}` : (WD_FULL[i] || s.name || s.start),
          Selesai: future ? null : (s.done ?? s.Selesai ?? 0),
          Overdue: future ? null : (s.overdue ?? s.Overdue ?? 0)
        };
      }),
    [safeData.series, safeData.today, safeData.range]
  );
  const dotCfg = useMemo(() => ({ r: safeData.range === "4w" ? 2 : 3 }), [safeData.range]);
  const maxBar = safeData.range === "4w" ? 14 : 28;
  return (
    <div className="h-64 sm:h-72 min-h-[260px] w-full" data-testid="team-chart">
      <ResponsiveContainer width="100%" height={260} debounce={50}>
        {type === "line" ? (
          <LineChart data={rows} margin={CHART_MARGIN}>
            {CHART_AXES}
            <Line type="monotone" dataKey="Selesai" stroke={GREEN} strokeWidth={3} dot={dotCfg} isAnimationActive={false} />
            <Line type="monotone" dataKey="Overdue" stroke={RED} strokeWidth={3} dot={dotCfg} isAnimationActive={false} />
          </LineChart>
        ) : (
          <BarChart data={rows} margin={CHART_MARGIN}>
            {CHART_AXES}
            <Bar dataKey="Selesai" fill={GREEN} radius={[6, 6, 0, 0]} maxBarSize={maxBar} isAnimationActive={false} />
            <Bar dataKey="Overdue" fill={RED} radius={[6, 6, 0, 0]} maxBarSize={maxBar} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
});

const Dot = ({ c, label }) => <span className="flex items-center gap-2 text-sm text-sub"><i className="h-3 w-3 rounded-full" style={{ background: c }} />{label}</span>;

function BoardScopeDropdown({ scopeLabel, boardColor, activeMode, availableScopes = [], activeBoardId, isAdmin, onSelectBoard, testId = "stats-board-dropdown" }) {
  const { t: tr } = useApp();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface2/75 px-3 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:border-brand transition-[background-color,border-color,color] duration-150 whitespace-nowrap cursor-pointer shadow-xs"
          data-testid={testId}
        >
          <span
            className="h-2 w-2 rounded-full shrink-0 transition-colors duration-150"
            style={{ background: activeMode === "all" ? "var(--c-sub, #64748B)" : (boardColor || "var(--c-brand, #3B82F6)") }}
          />
          <span>{scopeLabel}</span>
          <ChevronDown size={14} className="text-sub opacity-75 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {availableScopes.map((sc) => {
          const isActive = activeMode === "board" && activeBoardId === sc.board_id;
          return (
            <DropdownMenuItem
              key={sc.board_id}
              onSelect={() => {
                if (!isActive) onSelectBoard(sc.board_id);
              }}
              className={isActive ? "bg-brand/10 text-brand font-semibold hover:bg-brand/15 data-[highlighted]:bg-brand/15 data-[highlighted]:text-brand" : ""}
              data-testid={`${testId}-option-${sc.board_id}`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: sc.color || "#3B82F6" }}
              />
              <span className="flex-1 truncate">{sc.name}</span>
              <span className="text-[11px] font-bold opacity-75 tabular-nums">{sc.task_count ?? 0}</span>
              {isActive && <Check size={14} className="text-brand shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (activeMode !== "all") onSelectBoard("all");
              }}
              className={activeMode === "all" ? "bg-brand/10 text-brand font-semibold hover:bg-brand/15 data-[highlighted]:bg-brand/15 data-[highlighted]:text-brand" : ""}
              data-testid={`${testId}-option-all`}
            >
              <span className="h-2 w-2 rounded-full shrink-0 bg-slate-400" />
              <span className="flex-1 truncate">{tr("stats_all_divisions", "Semua Divisi")}</span>
              {activeMode === "all" && <Check size={14} className="text-brand shrink-0" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TeamPerformance({ data, anchor, setAnchor, range, setRange, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard }) {
  const { t: tr } = useApp();
  const [type, setType] = useState("line");
  const s = data?.summary || INITIAL_DATA.summary;
  const boardColor = data?.scope?.color;
  const activeMode = data?.scope?.mode || "board";
  const revealKey = `${activeMode === "all" ? "all" : (activeBoardId || "default")}::${range}`;
  const contentRef = useScopeSmoothReveal(revealKey);

  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseTitle = tr("dash_perf_title", "Performa & Beban Kerja Tim");
  const headingTitle = !showDropdown && scopeLabel && activeMode !== "all"
    ? `${baseTitle} ${scopeLabel}`
    : baseTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-stats">
      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <TrendingUp size={19} className="text-emerald-500 shrink-0" />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>

          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={boardColor}
              activeMode={activeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="stats-board-dropdown"
            />
          )}
        </div>
        <div className="flex flex-col items-start gap-2.5 lg:items-end shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl bg-surface2 p-1"><button onClick={() => setRange("7d")} className={seg(range === "7d")} data-testid="team-range-7d">{tr("stats_range_7d", "7 Hari")}</button><button onClick={() => setRange("4w")} className={seg(range === "4w")} data-testid="team-range-4w"><span className="sm:hidden">{tr("stats_range_4w_short", "1 Bulan")}</span><span className="hidden sm:inline">{tr("stats_range_4w_long", "1 Bulan Terakhir")}</span></button></div>
            <div className="flex rounded-2xl bg-surface2 p-1"><button onClick={() => setType("line")} className={`${seg(type === "line")} px-2.5`} aria-label="Grafik garis" data-testid="team-chart-line"><LineIcon size={16} /></button><button onClick={() => setType("bar")} className={`${seg(type === "bar")} px-2.5`} aria-label="Grafik batang" data-testid="team-chart-bar"><BarChart3 size={16} /></button></div>
          </div>
        </div>
      </div>
      <div ref={contentRef}>
        <div className="mt-4 sm:mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 min-w-0">
          <StatCard
            tone="green"
            label={tr("dash_perf_done", "Tugas Selesai")}
            value={s.done ?? 0}
            note={
              s.done
                ? `${s.done} ${tr("stats_done_unit", "tugas selesai")}${
                    s.done_late > 0
                      ? ` (${s.done_on_time ?? 0} tepat waktu, ${s.done_late} telat)`
                      : s.total
                      ? ` dari ${s.total} tugas`
                      : ""
                  }`
                : s.active > 0
                ? `${tr("stats_no_done", "Belum ada selesai")} · ${s.active} tugas aktif`
                : tr("stats_no_done", "Belum ada selesai")
            }
            icon={CheckCircle2}
            testid="team-stat-done"
          />
          <StatCard
            tone="red"
            label={tr("dash_perf_overdue", "Overdue")}
            value={s.overdue ?? 0}
            note={
              s.overdue
                ? `${s.overdue} ${tr("stats_late_unit", "lewat deadline")}${
                    s.done_late > 0 ? ` (+${s.done_late} selesai telat)` : ""
                  }`
                : s.done_late > 0
                ? `${s.done_late} selesai lewat deadline`
                : tr("stats_no_late", "Tidak ada telat")
            }
            icon={AlertTriangle}
            testid="team-stat-overdue"
          />
          <StatCard
            tone="gray"
            label={tr("dash_perf_ontime", "Ketepatan Waktu")}
            value={`${s.on_time_rate ?? 0}%`}
            note={
              s.due > 0
                ? `${s.on_time ?? 0} ${tr("stats_ontime_of", "dari")} ${s.due} ${tr("stats_ontime_suffix", "tugas tepat waktu")}${
                    s.active_on_track > 0 ? ` · ${s.active_on_track} berjalan` : ""
                  }`
                : s.active_on_track > 0
                ? `Belum ada selesai · ${s.active_on_track} sedang berjalan`
                : tr("stats_no_task_data", "Belum ada data tugas")
            }
            icon={Target}
            testid="team-stat-ontime"
            className="col-span-2 sm:col-span-1"
          />
        </div>
        <div className="mt-4 sm:mt-5 w-full min-w-0">
          <TeamChart data={data} type={type} />
        </div>
        <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 sm:pt-4"><div className="flex flex-wrap gap-4 sm:gap-5"><Dot c={GREEN} label={tr("dash_perf_done", "Tugas Selesai")} /><Dot c={RED} label={tr("dash_perf_overdue", "Overdue")} /></div><span className="text-xs sm:text-sm text-sub">{scopeLabel ? `${tr("stats_updated_from_board", "Diperbarui otomatis dari board")} ${scopeLabel}` : tr("dash_perf_updated_note", "Diperbarui otomatis dari papan tugas")}</span></div>
      </div>
    </section>
  );
}

const PersonCard = memo(function PersonCard({ p, boardId, className = "" }) {
  const { me, userMap, t: tr } = useApp();
  const navigate = useNavigate();
  const usr = userMap?.[p.user_id];
  const [emo, lbl, cls] = STATUS[p.status] || STATUS.optimal;
  const statusLabel = tr(`personnel_status_${p.status}`, lbl);
  const barColor = p.status === "pressure" ? "bg-rose-500" : p.status === "stabil" ? "bg-[#2563EB]" : "bg-emerald-500";
  const reasonTone = p.status === "pressure"
    ? "text-rose-600 dark:text-rose-400"
    : p.status === "stabil"
    ? "text-sky-700 dark:text-sky-400"
    : "text-emerald-700 dark:text-emerald-400";
  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
  const [dmBusy, setDmBusy] = useState(false);
  const dm = async () => {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: p.user_id });
      if (data?.id) {
        upsertConversationInCache(data, me?.user_id);
        navigate(`/messages/${data.id}`);
      }
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka obrolan"));
    } finally {
      setDmBusy(false);
    }
  };
  const boardLink = boardId && boardId !== "all"
    ? `/tasks?assignee=${p.user_id}&kanban=1&board=${encodeURIComponent(boardId)}`
    : `/tasks?assignee=${p.user_id}&kanban=1`;
  return (
    <div className={`flex min-w-0 w-full flex-col overflow-hidden rounded-2xl sm:rounded-3xl border bg-surface p-4 sm:p-5 transition-shadow duration-150 hover:shadow-md ${className}`} data-testid={`person-card-${p.user_id}`}>
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
        <Avatar user={usr} size={44} />
        <div className="min-w-0 flex-1"><p className="truncate font-bold text-sm sm:text-base leading-snug">{usr?.name}</p><p className="truncate text-xs sm:text-sm text-sub leading-snug">{usr?.job_title || "—"}</p><p className="truncate text-xs text-sub opacity-80 leading-snug">{usr?.department || tr("personnel_no_div", "Tanpa divisi")}</p></div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-bold whitespace-nowrap ${cls}`} title={p.status_reason || `${p.day_deadlines ?? 0} deadline pada hari terpilih`} data-testid={`person-status-${p.user_id}`}>{emo} {statusLabel}</span>
      </div>
      <div className="mt-3.5 sm:mt-4 flex justify-between gap-2 text-xs sm:text-sm"><span className="font-medium text-sub truncate">{tr("personnel_active_load", "Beban Tugas Aktif")}</span><span className="font-semibold tabular-nums shrink-0" data-testid={`person-load-${p.user_id}`}>{p.active ?? 0} {tr("personnel_task_unit", "tugas")} ({p.share ?? 0}%)</span></div>
      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface2"><span className={`block h-full rounded-full ${barColor} transition-[width] duration-300`} style={{ width: `${p.share ?? 0}%` }} /></span>
      {p.status_reason && <p className={`mt-2 truncate text-[11px] font-semibold ${reasonTone}`}>{p.status_reason}</p>}
      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-sub">{tr("personnel_active_tasks_label", "Tugas sedang berjalan:")}</p>
      <div className="mt-1.5 sm:mt-2 flex-1 space-y-1 min-w-0">{tasks.length ? tasks.map((t) => <Link key={t.id} to={`/tasks?task=${t.id}`} className="block truncate text-xs sm:text-sm hover:text-brand">• {t.title}</Link>) : <p className="text-xs sm:text-sm italic text-sub">{tr("personnel_no_active_tasks", "Tidak ada tugas aktif saat ini.")}</p>}{(p.more ?? 0) > 0 && <p className="text-xs text-sub">+{p.more} {tr("personnel_more_tasks", "tugas lainnya")}</p>}</div>
      <div className="mt-3.5 sm:mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 sm:pt-4">
        <button onClick={dm} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap" data-testid={`person-message-${p.user_id}`}><MessageSquare size={15} />{tr("personnel_send_msg", "Kirim Pesan")}</button>
        <Link to={boardLink} className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-[#2563EB] whitespace-nowrap" data-testid={`person-kanban-${p.user_id}`}>{tr("personnel_open_board", "Buka Board")}<ArrowRight size={14} /></Link>
      </div>
    </div>
  );
});

function Personnel({ data, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard }) {
  const { userMap, t: tr } = useApp();
  const [div, setDiv] = useState("");
  const [all, setAll] = useState(false);
  const scopeMode = data?.scope?.mode || "board";
  const scopeBoardId = data?.scope?.board_id || "";
  const boardColor = data?.scope?.color;
  const effectiveScopeKey = scopeMode === "all" ? "all" : (scopeBoardId || activeBoardId || "default");
  const [prevScopeKey, setPrevScopeKey] = useState(effectiveScopeKey);
  if (prevScopeKey !== effectiveScopeKey) {
    setPrevScopeKey(effectiveScopeKey);
    if (div !== "") setDiv("");
    if (all !== false) setAll(false);
  }
  const contentRef = useScopeSmoothReveal(effectiveScopeKey);

  const rawPeople = Array.isArray(data?.people) ? data.people : INITIAL_DATA.people;
  const depts = [...new Set(rawPeople.map((p) => userMap?.[p.user_id]?.department).filter(Boolean))].sort();
  const people = rawPeople.filter((p) => {
    const u = userMap?.[p.user_id];
    if (!u || u.is_bot || u.role === "assistant" || p.user_id === "user_circle_assistant") return false;
    return !div || u.department === div;
  });
  const count = (k) => people.filter((p) => p.status === k).length;

  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseTitle = tr("dash_personnel_title", "Kapasitas & Beban Kerja Personel");
  const headingTitle = !showDropdown && scopeLabel && scopeMode !== "all"
    ? `${baseTitle} ${scopeLabel}`
    : baseTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-personnel">
      <div className="flex flex-col gap-3 sm:gap-4 border-b pb-4 sm:pb-5 lg:flex-row lg:items-center lg:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <Users size={19} className="text-[#2563EB] shrink-0" />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>
          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={boardColor}
              activeMode={scopeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="personnel-board-dropdown"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">{Object.entries(STATUS).map(([k, [e, l, c]]) => <span key={k} className={`flex items-center gap-1 rounded-full border px-2.5 sm:px-3.5 py-1 sm:py-1.5 text-xs sm:text-sm font-bold ${c}`} data-testid={`personnel-count-${k}`}>{e} {count(k)} {tr(`personnel_status_${k}`, l)}</span>)}</div>
      </div>
      <div ref={contentRef}>
        {scopeMode === "all" && depts.length > 1 && <div className="mt-3.5 sm:mt-4 flex w-full max-w-full min-w-0 flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0" data-testid="personnel-division-filter">
          <span className="flex shrink-0 items-center gap-1 text-xs sm:text-sm text-sub"><Filter size={13} />{tr("personnel_div_filter_label", "Divisi:")}</span>
          {[["", tr("stats_all_divisions", "Semua Divisi")], ...depts.map((d) => [d, d])].map(([k, l]) => <button key={k || "all"} onClick={() => setDiv(k)} className={`h-9 sm:h-10 shrink-0 whitespace-nowrap rounded-2xl px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${div === k ? "bg-brand text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"}`} data-testid={`personnel-div-${k ? k.replace(/\s/g, "-") : "all"}`}>{l}</button>)}
        </div>}
        <div className="mt-4 sm:mt-5 grid grid-cols-1 gap-3.5 sm:gap-4 md:grid-cols-2 xl:grid-cols-3 min-w-0">
          {(all ? people : people.slice(0, 6)).map((p, idx) => (
            <PersonCard key={p.user_id} p={p} boardId={scopeBoardId} className={!all && idx >= 3 ? "hidden md:flex" : ""} />
          ))}
        </div>
        {people.length > 3 && (
          <button
            onClick={() => setAll(!all)}
            className={`mt-4 sm:mt-5 w-full rounded-2xl border py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-sub hover:text-ink transition-colors ${people.length > 6 ? "" : "md:hidden"}`}
            data-testid="personnel-toggle-all"
          >
            {all ? tr("personnel_show_less", "Tampilkan lebih sedikit") : `${tr("personnel_show_all_prefix", "Lihat semua personel")} (${people.length})`}
          </button>
        )}
        {!people.length && <p className="mt-6 text-sm text-sub">{tr("personnel_empty_board", "Belum ada personel terdaftar di board divisi ini.")}</p>}
      </div>
    </section>
  );
}

function BottleneckSummary({ tasks = [], projectsMap = {}, scope, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard, onOpenTask }) {
  const { userMap, labelMap, tasks: ctxTasks, me, t: tr } = useApp();
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);

  const effectiveScopeKey = scope?.mode === "all" ? "all" : (scope?.board_id || activeBoardId || "default");
  const [prevScopeKey, setPrevScopeKey] = useState(effectiveScopeKey);
  if (prevScopeKey !== effectiveScopeKey) {
    setPrevScopeKey(effectiveScopeKey);
    if (showAll !== false) setShowAll(false);
  }
  const contentRef = useScopeSmoothReveal(effectiveScopeKey);

  const sourceTasks = Array.isArray(tasks) && tasks.length > 0 ? tasks : Array.isArray(ctxTasks) ? ctxTasks : [];
  const todayDay = toDayDate(new Date());

  const rows = useMemo(() => {
    const scopeMode = scope?.mode;
    const scopeBoardId = scope?.board_id;
    const scopeDept = String(scope?.department || (!scope && me?.department ? me.department : "")).trim().toLowerCase();

    const active = sourceTasks.filter((t) => {
      if (!t || t.archived || t.status === "done") return false;
      const hasFlowSignal = t.deadline || t.start_date || t.created_at || (Array.isArray(t.checkpoints) && t.checkpoints.length > 0);
      if (!hasFlowSignal) return false;
      if (scopeMode === "board" && scopeBoardId) {
        if (t.board_id === scopeBoardId) return true;
        if (!t.board_id && scopeDept && String(t.department || "").trim().toLowerCase() === scopeDept) return true;
        return false;
      }
      if (!scope && scopeDept && me?.role !== "super_admin" && me?.role !== "workspace_admin") {
        if (t.department && String(t.department).trim().toLowerCase() !== scopeDept) return false;
      }
      return true;
    });

    const analyzed = active
      .map((t) => analyzeTaskFlow(t, userMap, todayDay))
      .filter((r) => r.hasBottleneck);

    analyzed.sort((a, b) => {
      const ba = a.primaryBottleneck;
      const bb = b.primaryBottleneck;
      const sevA = ba.severity === "critical" ? 2 : 1;
      const sevB = bb.severity === "critical" ? 2 : 1;
      if (sevB !== sevA) return sevB - sevA;
      if ((bb.overdueDays || 0) !== (ba.overdueDays || 0)) return (bb.overdueDays || 0) - (ba.overdueDays || 0);
      if ((bb.issueCount || 0) !== (ba.issueCount || 0)) return (bb.issueCount || 0) - (ba.issueCount || 0);
      return (bb.daysInStage || 0) - (ba.daysInStage || 0);
    });

    return analyzed;
  }, [sourceTasks, userMap, todayDay, scope, me?.department, me?.role]);

  const timelineHref = scope?.mode === "board" && scope?.board_id
    ? `/tasks?timeline=1&bottleneck=1&board=${encodeURIComponent(scope.board_id)}`
    : "/tasks?timeline=1&bottleneck=1";

  const visibleRows = showAll ? rows : rows.slice(0, 6);

  const capitalize = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const activeMode = scope?.mode || "board";
  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseBnTitle = tr("bottleneck_title", "Rekap Bottleneck Proyek");
  const headingTitle = !showDropdown && scopeLabel && activeMode !== "all"
    ? `${baseBnTitle} ${scopeLabel}`
    : baseBnTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-bottleneck-summary">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <AlertTriangle size={19} className={rows.length > 0 ? "text-rose-500 shrink-0" : "text-emerald-500 shrink-0"} />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>
          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={scope?.color}
              activeMode={activeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="bottleneck-board-dropdown"
            />
          )}
        </div>

        <Link
          to={timelineHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface2/70 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-brand hover:bg-surface2 transition-colors whitespace-nowrap self-start"
          data-testid="bottleneck-open-timeline"
        >
          <span>{tr("bottleneck_open_timeline", "Buka Timeline Flow")}</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <div ref={contentRef}>
      {rows.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3.5 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold">{tr("bottleneck_empty_title", "Tidak ada bottleneck terdeteksi saat ini")}</p>
            <p className="text-[11px] sm:text-xs opacity-80">{tr("bottleneck_empty_desc", "Semua proyek dan estafet checkpoint berjalan sesuai target deadline.")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/80 bg-surface">
            <div className="hidden md:grid md:grid-cols-12 gap-3 border-b bg-surface2/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-sub">
              <div className="col-span-4">{tr("bottleneck_col_task", "Task")}</div>
              <div className="col-span-5">{tr("bottleneck_col_issue", "Kendala")}</div>
              <div className="col-span-3">{tr("bottleneck_col_pic", "PIC")}</div>
            </div>

            <div className="divide-y divide-border/70">
              {visibleRows.map((row) => {
                const { task, primaryBottleneck: bn, stages, doneCount } = row;
                const isCrit = bn.severity === "critical";
                const firstLabel = (task.label_ids || []).map((id) => labelMap[id]).find(Boolean) || null;
                const projectObj = task.project_id ? projectsMap[task.project_id] : null;
                const projectLabel = (projectObj?.label_ids || []).map((id) => labelMap[id]).find(Boolean) || null;
                const projectName = projectObj?.name || firstLabel?.name || task.department || "";
                const matchedLabelByName = projectName
                  ? Object.values(labelMap).find((l) => String(l?.name || "").trim().toLowerCase() === String(projectName).trim().toLowerCase())
                  : null;
                const ipLabel = (!projectObj ? firstLabel : null) || matchedLabelByName || projectLabel || firstLabel || null;
                const ipColor = ipLabel?.color || projectObj?.color || "";
                const stageLabel = bn.isTaskLevel
                  ? ""
                  : stages.length > 0
                  ? `${tr("bottleneck_stage_prefix", "Tahap")} ${bn.index + 1}/${stages.length}: ${bn.title}`
                  : bn.title;
                const mainReason = capitalize(bn.detailSummary) || bn.shortReason || tr("bottleneck_default_reason", "Melewati target jadwal");
                const noteText = bn.issueNotes?.[0] || "";
                const picList = Array.isArray(bn.picUsers) ? bn.picUsers : bn.picUser ? [bn.picUser] : [];

                const handleOpen = () => {
                  if (typeof onOpenTask === "function") onOpenTask(task.id);
                  else navigate(`/tasks?task=${task.id}`);
                };

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={handleOpen}
                    className="group w-full text-left px-3.5 py-3 sm:px-4 hover:bg-surface2/60 transition-colors cursor-pointer grid grid-cols-1 md:grid-cols-12 gap-2.5 md:gap-3 items-start md:items-center"
                    data-testid={`bottleneck-row-${task.id}`}
                  >
                    {/* Col 1: Task & Tahap */}
                    <div className="md:col-span-4 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        {projectName && (
                          ipColor ? (
                            <LabelChip
                              label={{ id: ipLabel?.id || task.id, name: projectName, color: ipColor }}
                              small
                            />
                          ) : (
                            <span className="max-w-[140px] truncate rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sub">
                              {projectName}
                            </span>
                          )
                        )}
                        <span className="truncate text-xs sm:text-sm font-bold text-ink group-hover:text-brand transition-colors">
                          {task.title}
                        </span>
                      </div>
                      {!bn.isTaskLevel && (stageLabel || stages.length > 0) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {stageLabel && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                                isCrit
                                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                              }`}
                            >
                              <GitBranch size={10} />
                              <span className="truncate max-w-[200px]">{stageLabel}</span>
                            </span>
                          )}
                          {stages.length > 0 && (
                            <span className="text-[10.5px] font-medium text-sub">
                              ({doneCount}/{stages.length} {tr("bottleneck_done_suffix", "selesai")})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Col 2: Kendala & Dampak */}
                    <div className="md:col-span-5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            isCrit
                              ? "bg-rose-500 text-white"
                              : "bg-amber-500 text-white"
                          }`}
                        >
                          {bn.shortReason || "Bottleneck"}
                        </span>
                        <span className="text-xs font-medium text-ink truncate sm:whitespace-normal">
                          {mainReason}
                        </span>
                      </div>
                      {noteText && (
                        <p className="mt-1 truncate text-[11px] font-medium text-rose-700 dark:text-rose-300">
                          {tr("bottleneck_issue_prefix", "Kendala:")} &ldquo;{noteText}&rdquo;
                        </p>
                      )}
                      {bn.impactText && (
                        <p className="mt-0.5 truncate text-[11px] text-sub">
                          {bn.impactText}
                        </p>
                      )}
                    </div>

                    {/* Col 3: PIC */}
                    <div className="md:col-span-3 flex items-center justify-between md:justify-start gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {picList.length > 1 ? (
                          <AvatarStack ids={bn.picIds} max={3} size={24} />
                        ) : picList.length === 1 ? (
                          <Avatar user={picList[0]} size={24} showStatus={false} />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-[10px] font-bold text-sub">
                            ?
                          </span>
                        )}
                        <span className={`truncate text-xs font-semibold ${picList.length > 0 ? "text-ink" : "text-sub italic"}`}>
                          {bn.picName}
                        </span>
                      </div>
                      <ArrowRight size={14} className="shrink-0 text-sub opacity-60 group-hover:text-brand group-hover:translate-x-0.5 transition-[transform,color] duration-150 md:ml-auto" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {rows.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3.5 w-full rounded-2xl border py-2.5 text-xs sm:text-sm font-semibold text-sub hover:text-ink transition-colors cursor-pointer"
              data-testid="bottleneck-toggle-all"
            >
              {showAll ? tr("bottleneck_show_less", "Tampilkan lebih sedikit") : `${tr("bottleneck_show_all_prefix", "Lihat semua bottleneck")} (${rows.length})`}
            </button>
          )}
        </>
      )}
      </div>
    </section>
  );
}

export default function MonthlyStats({ showPerformance = true, showBottleneck = true, showPersonnel = true, tasks = [], onOpenTask }) {
  const { subscribe, me, users, isAdmin } = useApp();
  const [anchor, setAnchor] = useState(null);
  const [range, setRange] = useState("7d");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [boards, setBoards] = useState(() => readCachedBoardsList());
  const [data, setData] = useState(() => getCachedStats(me?.user_id, "default", "7d", tasks, users, me, boards, []));
  const [projectsMap, setProjectsMap] = useState(() => {
    try {
      const saved = localStorage.getItem("circle_projects_cache") || localStorage.getItem("circle_cache_projects");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((p) => [p.id, p]));
      }
    } catch {}
    return {};
  });

  const tasksRef = useRef(tasks);
  const usersRef = useRef(users);
  const meRef = useRef(me);
  const boardsRef = useRef(boards);
  const availableScopesRef = useRef(Array.isArray(data?.available_scopes) ? data.available_scopes : []);
  const requestSeqRef = useRef(0);
  const abortRef = useRef(null);
  const lastBootstrapStatsAtRef = useRef(0);

  tasksRef.current = tasks;
  usersRef.current = users;
  meRef.current = me;
  boardsRef.current = boards;
  if (Array.isArray(data?.available_scopes) && data.available_scopes.length > 0) {
    availableScopesRef.current = data.available_scopes;
  }

  useEffect(() => {
    if (boards.length > 0) return;
    api.get("/boards")
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          setBoards(res.data);
          scheduleJsonStorageWrite("circle_boards_cache", res.data);
        }
      })
      .catch(() => {});
  }, [me?.user_id]);

  const prevUserIdRef = useRef(me?.user_id);
  useEffect(() => {
    if (prevUserIdRef.current === me?.user_id) return;
    prevUserIdRef.current = me?.user_id;
    availableScopesRef.current = [];
    setSelectedBoardId("");
    setData(getCachedStats(me?.user_id, "default", range, tasksRef.current, usersRef.current, me, boardsRef.current, []));
  }, [me?.user_id, range]);

  const load = useCallback((targetRange, targetBoardId) => {
    const r = targetRange || range;
    const bId = targetBoardId !== undefined ? targetBoardId : selectedBoardId;
    const scopeKey = bId || "default";
    const uid = meRef.current?.user_id;

    const cached = getCachedStats(
      uid,
      scopeKey,
      r,
      tasksRef.current,
      usersRef.current,
      meRef.current,
      boardsRef.current,
      availableScopesRef.current
    );
    if (cached) {
      setData((prev) => (statsSignature(prev) === statsSignature(cached) ? prev : cached));
    }

    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    api.get("/stats/team", {
      params: {
        range: r,
        ...(bId ? { board_id: bId } : {}),
        ...(anchor ? { anchor } : {})
      },
      ...(controller ? { signal: controller.signal } : {})
    })
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        if (isValidStats(res.data)) {
          if (Array.isArray(res.data.available_scopes) && res.data.available_scopes.length > 0) {
            availableScopesRef.current = res.data.available_scopes;
          }
          hydrateTeamStatsCache(uid, res.data, scopeKey, r);
          setData((prev) => (statsSignature(prev) === statsSignature(res.data) ? prev : res.data));
        }
      })
      .catch(() => {});
  }, [anchor, range, selectedBoardId, me?.user_id]);

  useEffect(() => {
    if (!selectedBoardId && range === "7d" && Date.now() - lastBootstrapStatsAtRef.current < 4000) {
      return undefined;
    }
    const tId = setTimeout(() => {
      if (!selectedBoardId && range === "7d" && Date.now() - lastBootstrapStatsAtRef.current < 4000) return;
      load(range, selectedBoardId);
    }, (!selectedBoardId && range === "7d") ? 200 : 0);
    return () => {
      clearTimeout(tId);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch {}
      }
    };
  }, [range, selectedBoardId, load]);

  useEffect(() => {
    if (!showBottleneck) return;
    if (Object.keys(projectsMap).length > 0) return;
    api.get("/projects")
      .then((res) => {
        if (Array.isArray(res.data)) {
          setProjectsMap(Object.fromEntries(res.data.map((p) => [p.id, p])));
          scheduleJsonStorageWrite("circle_projects_cache", res.data);
        }
      })
      .catch(() => {});
  }, [showBottleneck]);

  useEffect(() => {
    let wsReloadTimer = null;
    const unsub = subscribe((evt) => {
      if (evt.type === "bootstrap:dashboard") {
        if (isValidStats(evt.stats_team) && !selectedBoardId && range === "7d") {
          lastBootstrapStatsAtRef.current = Date.now();
          if (Array.isArray(evt.stats_team.available_scopes) && evt.stats_team.available_scopes.length > 0) {
            availableScopesRef.current = evt.stats_team.available_scopes;
          }
          hydrateTeamStatsCache(meRef.current?.user_id, evt.stats_team, "default", "7d");
          setData((prev) => (statsSignature(prev) === statsSignature(evt.stats_team) ? prev : evt.stats_team));
        }
        if (Array.isArray(evt.projects)) {
          setProjectsMap(Object.fromEntries(evt.projects.map((p) => [p.id, p])));
        }
        return;
      }
      if (evt.type === "tasks:changed" || evt.type === "tasks:deleted" || evt.type === "users:changed" || evt.type === "boards:changed") {
        clearStatsMemoryCacheForUser(meRef.current?.user_id);
        if (evt.type === "boards:changed") {
          api.get("/boards")
            .then((res) => {
              if (Array.isArray(res.data)) {
                setBoards(res.data);
                scheduleJsonStorageWrite("circle_boards_cache", res.data);
              }
            })
            .catch(() => {});
        }
        if (wsReloadTimer) clearTimeout(wsReloadTimer);
        wsReloadTimer = setTimeout(() => {
          wsReloadTimer = null;
          load(range, selectedBoardId);
        }, 220);
      }
    });
    return () => {
      if (wsReloadTimer) clearTimeout(wsReloadTimer);
      unsub();
    };
  }, [subscribe, load, range, selectedBoardId]);

  const handleSelectBoard = useCallback((nextBoardId) => {
    const targetId = String(nextBoardId || "");
    if (!targetId) return;
    const instantNext = getCachedStats(
      meRef.current?.user_id,
      targetId,
      range,
      tasksRef.current,
      usersRef.current,
      meRef.current,
      boardsRef.current,
      availableScopesRef.current
    );
    setSelectedBoardId((prev) => (prev === targetId ? prev : targetId));
    if (instantNext) {
      setData((prev) => (statsSignature(prev) === statsSignature(instantNext) ? prev : instantNext));
    }
  }, [range]);

  if (!showPerformance && !showBottleneck && !showPersonnel) return null;

  const isSuperAdmin = me?.role === "super_admin";
  const availableScopes = Array.isArray(data?.available_scopes) && data.available_scopes.length > 0
    ? data.available_scopes
    : availableScopesRef.current;
  const activeScope = data?.scope || null;
  const activeBoardId = activeScope?.board_id || selectedBoardId;
  const activeScopeLabel = activeScope?.board_name || me?.department || "";
  const canSwitchBoards = isSuperAdmin && availableScopes.length > 0;

  return (
    <div className="space-y-4 sm:space-y-8">
      {showPerformance && (
        <TeamPerformance
          data={data || INITIAL_DATA}
          anchor={data?.anchor || INITIAL_DATA.anchor}
          setAnchor={setAnchor}
          range={range}
          setRange={setRange}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={handleSelectBoard}
        />
      )}
      {showBottleneck && (
        <BottleneckSummary
          tasks={tasks}
          projectsMap={projectsMap}
          scope={activeScope}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={handleSelectBoard}
          onOpenTask={onOpenTask}
        />
      )}
      {showPersonnel && (
        <Personnel
          data={data || INITIAL_DATA}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={handleSelectBoard}
        />
      )}
    </div>
  );
}

