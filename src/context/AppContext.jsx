import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, wsUrl, fileUrl, setAuthUserId, setAuthToken, getAuthToken, getAuthGeneration } from "../lib/api";
import { applyTheme, buildTheme } from "../lib/theme";
import { getTranslation, getEffectiveCopywriting } from "../lib/i18n";
import { playSound } from "../lib/sound";
import {
  hydrateConversationsCache,
  upsertConversationInCache,
  removeConversationFromCache,
  clearConversationMessagesCache,
  appendMessageToCache,
  updateMessageInCache,
  clearChatCache,
  hydratePostsCache,
  hydrateGroupsCache,
  upsertGroupInCache,
  removeGroupFromCache,
  scheduleJsonStorageWrite,
  cancelScheduledStorageWrite,
} from "../lib/workspaceCaches";
import { preloadAllRoutes } from "../lib/routePreload";
import { setCachedDriveShortcuts } from "../data/initialDriveShortcuts";
import { showSystemNotification, syncPushSubscription, syncAppBadge } from "../lib/systemNotifications";
import { attemptAutoHydrateServer, syncWorkspaceMirror, scheduleRealtimeCloudSync, upsertAccountInVault, upsertAccountsListInVault, getKnownAccountsFromVault, hasCompletedInitialHydrate, rehydrateIfServerRestarted, recordDeletedTaskIds, recordDeletedCheckpointTemplateIds, recordDeletedEntityIds } from "../lib/persistentMirror";
import { firebaseAuth, subscribeFirebaseAuth, getCloudSyncStatus, subscribeCloudSyncStatus, isFirestoreQuotaPaused } from "../lib/firestoreBackup";
import { googleBasicSignIn } from "../lib/auth";
import { prefetchMarketplaceState, reconcileMarketplaceEnabledCache } from "../pages/marketplace/marketplaceStore";
import { setTopQuickActionNotifActive } from "../lib/sonnerCompat";
import { hasTopNotifQuickAction } from "../components/TopNotificationPopup";
import { hydrateTeamStatsCache } from "../pages/dashboard/MonthlyStats";
import { enforceTaskApprovalInvariant, mergeTasksArrayNonDestructive } from "../lib/snapshotMerge";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const DEFAULT_USERS = [
  { user_id: "user_admin1", name: "Admin ASLI RI", email: "admin@asliri.local", role: "super_admin", job_title: "Super Admin", department: "Management", org_unit_id: "unit_mgmt", manager_id: "user_superadmin_saeful", status: "active", online: true, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" },
  { user_id: "user_superadmin_saeful", name: "Saeful", email: "saeful@asliri.id", role: "super_admin", job_title: "Super Administrator", department: "Management", org_unit_id: "unit_mgmt", manager_id: null, status: "active", online: true, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" }
];

try {
  if (typeof window !== "undefined" && localStorage.getItem("circle_prod_clean_v5") !== "1") {
    localStorage.setItem("circle_prod_clean_v5", "1");
  }
} catch {}

export function AppProvider({ children }) {
  const [session, setSessionState] = useState(() => {
    try {
      const tabCached = sessionStorage.getItem("circle_tab_session_cache");
      const cached = tabCached || localStorage.getItem("circle_session_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.user?.user_id) {
          setAuthUserId(parsed.user.user_id);
          setAuthToken(parsed.token || null);
          return parsed;
        }
      }
    } catch {}
    setAuthUserId(null);
    setAuthToken(null);
    return null;
  });
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const setSession = useCallback((updater) => {
    const prev = sessionRef.current;
    const rawNext = typeof updater === "function" ? updater(prev) : updater;
    const prevUid = prev?.user?.user_id || null;
    const rawNextUid = rawNext?.user?.user_id || null;
    const next =
      rawNext && rawNextUid && !rawNext.token && prev?.token && prevUid === rawNextUid
        ? { ...rawNext, token: prev.token }
        : rawNext;
    const nextUid = next?.user?.user_id || null;

    if (prevUid !== nextUid) {
      clearChatCache();
      lastBootstrapEtagRef.current = null;
      lastLoadAllAtRef.current = 0;
      try {
        [
          "circle_convs_cache",
          "circle_cache_conversations",
          "circle_tasks_cache",
          "circle_cache_tasks",
          "circle_admin_stats",
          "circle_admin_audit",
          "circle_admin_users",
          "circle_admin_invites",
          "circle_admin_access_reqs",
        ].forEach((k) => localStorage.removeItem(k));
      } catch {}
    }

    sessionRef.current = next;
    cancelScheduledStorageWrite("circle_session_cache");
    setAuthUserId(nextUid);
    setAuthToken(next?.token || null);

    try {
      if (next && nextUid) {
        upsertAccountInVault(next.account_vault_entry || next.user);
        const serialized = JSON.stringify(next);
        sessionStorage.setItem("circle_tab_session_cache", serialized);
        localStorage.setItem("circle_session_cache", serialized);
      } else {
        sessionStorage.removeItem("circle_tab_session_cache");
        localStorage.removeItem("circle_session_cache");
      }
    } catch {}

    setSessionState(next);
  }, []);

  const [users, setUsers] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_users_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_USERS;
  });
  const [labels, setLabels] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_labels_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      { id: "lbl_asliri", name: "ASLI RI", color: "#EF4444" },
      { id: "lbl_tixfly", name: "TIXFLY", color: "#8B5CF6" },
      { id: "lbl_internal", name: "INTERNAL", color: "#1E293B" }
    ];
  });
  const [online, setOnline] = useState(() => new Set(DEFAULT_USERS.map((u) => u.user_id)));
  const [unread, setUnread] = useState(0);
  const [themeDraft, setThemeDraft] = useState(null);
  const [topNotif, setTopNotif] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState(() => getCloudSyncStatus());
  const [tasks, setTasks] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_tasks_cache") || localStorage.getItem("circle_cache_tasks");
      const parsed = cached ? JSON.parse(cached) : [];
      return Array.isArray(parsed) ? parsed.map((t) => enforceTaskApprovalInvariant(t)) : [];
    } catch {
      return [];
    }
  });
  const subs = useRef(new Set());
  const sock = useRef(null);
  /** @type {import("react").MutableRefObject<((force?: boolean) => Promise<void>) | null>} */
  const loadAllRef = useRef(null);
  const loadAllInFlightRef = useRef(null);
  const lastLoadAllAtRef = useRef(0);
  const lastBootstrapEtagRef = useRef(null);
  const lastMsgSoundAtRef = useRef(0);

  const me = session?.user;
  const ws = session?.workspace;
  const prefs = useMemo(() => session?.prefs || {}, [session?.prefs]);
  const meRef = useRef(me);
  const wsRef = useRef(ws);
  const usersRef = useRef(users);
  const prefsRef = useRef(prefs);
  const tasksRef = useRef(tasks);
  meRef.current = me;
  wsRef.current = ws;
  usersRef.current = users;
  prefsRef.current = prefs;
  tasksRef.current = tasks;

  const applyServerTasksSafely = useCallback((incomingList, { silentSync = false } = {}) => {
    if (!Array.isArray(incomingList)) return false;
    if (incomingList.length === 0 && (!hasCompletedInitialHydrate() || (Array.isArray(tasksRef.current) && tasksRef.current.length > 0))) {
      rehydrateIfServerRestarted(api).then((restored) => {
        if (restored) {
          api.get("/tasks").then((r) => {
            if (Array.isArray(r.data)) {
              const normalized = r.data.map((t) => enforceTaskApprovalInvariant(t));
              setTasks(normalized);
              scheduleJsonStorageWrite("circle_tasks_cache", normalized);
              scheduleJsonStorageWrite("circle_cache_tasks", normalized);
              subs.current.forEach((fn) => fn({ type: "tasks:changed", silentSync: true }));
            }
          }).catch(() => {});
        } else {
          setTasks([]);
          scheduleJsonStorageWrite("circle_tasks_cache", []);
          scheduleJsonStorageWrite("circle_cache_tasks", []);
          subs.current.forEach((fn) => fn({ type: "tasks:changed", silentSync: true }));
        }
      }).catch(() => {});
      return false;
    }
    const normalized = incomingList.map((t) => enforceTaskApprovalInvariant(t));
    setTasks(normalized);
    scheduleJsonStorageWrite("circle_tasks_cache", normalized);
    scheduleJsonStorageWrite("circle_cache_tasks", normalized);
    if (silentSync) {
      subs.current.forEach((fn) => fn({ type: "tasks:changed", silentSync: true }));
    }
    return true;
  }, []);

  const { userDeadlinesToday, userDeadlineReasons } = useMemo(() => {
    const set = new Set();
    const reasons = {};
    const statsByUser = new Map();
    const now = new Date();
    const nowMs = now.getTime();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    const doneKeys = new Set(["done"]);
    if (Array.isArray(ws?.task_statuses)) {
      ws.task_statuses.forEach((s) => {
        if (s && typeof s === "object" && s.is_done && s.key) doneKeys.add(s.key);
      });
    }

    const ensureUserStat = (uid) => {
      let entry = statsByUser.get(uid);
      if (!entry) {
        entry = { active: 0, overdue: 0, today: 0, soon24h: 0, dueByTomorrow: 0 };
        statsByUser.set(uid, entry);
      }
      return entry;
    };

    (tasks || []).forEach((item) => {
      if (!item || item.archived || doneKeys.has(item.status)) return;

      const assignees = new Set();
      if (item.assignee_id) assignees.add(item.assignee_id);
      if (Array.isArray(item.assignee_ids)) {
        item.assignee_ids.forEach((id) => { if (id) assignees.add(id); });
      }
      if (Array.isArray(item.assignees)) {
        item.assignees.forEach((a) => {
          const uid = typeof a === "string" ? a : a?.user_id;
          if (uid) assignees.add(uid);
        });
      }
      if (assignees.size === 0) return;

      let isOverdue = false;
      let isToday = false;
      let isSoon24h = false;
      let isDueByTomorrow = false;

      if (item.deadline) {
        try {
          const dl = new Date(item.deadline);
          if (!isNaN(dl.getTime())) {
            const diffMs = dl.getTime() - nowMs;
            const hoursLeft = diffMs / 3600000;
            isToday = dl.getFullYear() === todayY && dl.getMonth() === todayM && dl.getDate() === todayD;
            isOverdue = diffMs < 0;
            isSoon24h = diffMs >= 0 && hoursLeft <= 24;
            isDueByTomorrow = diffMs < 0 || hoursLeft <= 48;
          }
        } catch {}
      }

      assignees.forEach((uid) => {
        const st = ensureUserStat(uid);
        st.active += 1;
        if (isOverdue) st.overdue += 1;
        if (isToday) st.today += 1;
        if (isSoon24h) st.soon24h += 1;
        if (isDueByTomorrow) st.dueByTomorrow += 1;
      });
    });

    statsByUser.forEach((st, uid) => {
      const isPressure = st.overdue > 0 || st.dueByTomorrow >= 5 || st.active >= 8;
      if (st.overdue > 0 || st.today > 0 || st.soon24h > 0 || isPressure) {
        set.add(uid);
        const parts = [];
        if (st.overdue > 0) parts.push(`${st.overdue} tugas overdue`);
        if (st.today > 0) parts.push(`${st.today} deadline hari ini`);
        else if (st.soon24h > 0) parts.push(`${st.soon24h} deadline < 24 jam`);
        if (st.dueByTomorrow >= 5 || st.active >= 8) parts.push(`Under Pressure (${st.active} tugas aktif)`);
        reasons[uid] = parts.join(" · ") || "Ada deadline mendesak / Under Pressure";
      }
    });

    return { userDeadlinesToday: set, userDeadlineReasons: reasons };
  }, [tasks, ws?.task_statuses]);

  const hasDeadlineToday = useCallback((userId) => {
    return Boolean(userId && userDeadlinesToday.has(userId));
  }, [userDeadlinesToday]);

  const loadAll = useCallback(async (force = false) => {
    if (!me?.user_id) return;
    if (loadAllInFlightRef.current) return loadAllInFlightRef.current;
    const now = Date.now();
    if (!force && now - lastLoadAllAtRef.current < 2000) {
      return;
    }
    const currentUid = me.user_id;
    const runPromise = (async () => {
      try {
        let bootData = null;
        try {
          const headers = !force && lastBootstrapEtagRef.current ? { "If-None-Match": lastBootstrapEtagRef.current } : {};
          const res = await api.get("/bootstrap", {
            headers,
            validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
          });
          if (res.status === 304) {
            lastLoadAllAtRef.current = Date.now();
            return;
          }
          if (res.headers?.etag) {
            lastBootstrapEtagRef.current = res.headers.etag;
          }
          bootData = res.data;
        } catch {
          // Fallback to legacy individual calls if /bootstrap fails
          const [w, u, l, n, c, t, ds, p, tr, g] = await Promise.all([
            api.get("/workspace").catch(() => ({ data: null })),
            api.get("/users").catch(() => ({ data: null })),
            api.get("/labels").catch(() => ({ data: null })),
            api.get("/notifications").catch(() => ({ data: null })),
            api.get("/conversations").catch(() => ({ data: null })),
            api.get("/tasks").catch(() => ({ data: null })),
            api.get("/drive-shortcuts").catch(() => ({ data: null })),
            api.get("/posts").catch(() => ({ data: null })),
            api.get("/posts/trending").catch(() => ({ data: null })),
            api.get("/groups/browse").catch(() => ({ data: null })),
          ]);
          bootData = {
            workspace: w?.data,
            users: u?.data,
            labels: l?.data,
            notifications: n?.data,
            conversations: c?.data,
            tasks: t?.data,
            drive_shortcuts: ds?.data,
            posts: p?.data,
            trending: tr?.data,
            groups: g?.data,
          };
        }

        if (!bootData || typeof bootData !== "object") return;

        if (bootData.workspace && typeof bootData.workspace === "object") {
          setSession((s) => (s ? { ...s, workspace: bootData.workspace } : s));
          reconcileMarketplaceEnabledCache(
            currentUid,
            bootData.workspace.marketplace_enabled !== false,
            bootData.workspace.marketplace_config
          );
        }
        if (Array.isArray(bootData.users) && bootData.users.length > 0) {
          const syncedUsers = bootData.users.map((x) => (x.user_id === currentUid ? { ...x, online: true } : x));
          setUsers(syncedUsers);
          upsertAccountsListInVault(syncedUsers);
          setOnline(new Set([...syncedUsers.filter((x) => x.online).map((x) => x.user_id), currentUid]));
          scheduleJsonStorageWrite("circle_users_cache", syncedUsers);
          const syncedMe = syncedUsers.find((x) => x.user_id === currentUid);
          if (syncedMe) {
            setSession((s) => {
              if (!s?.user) return s;
              return { ...s, user: { ...s.user, ...syncedMe } };
            });
            upsertAccountInVault(syncedMe);
          }
        } else {
          setOnline((prev) => (prev.has(currentUid) ? prev : new Set([...prev, currentUid])));
        }
        if (Array.isArray(bootData.labels)) {
          setLabels(bootData.labels);
          scheduleJsonStorageWrite("circle_labels_cache", bootData.labels);
        }
        if (bootData.notifications) {
          setUnread(bootData.notifications.unread || 0);
          scheduleJsonStorageWrite(`circle_notifications_cache_${currentUid}`, bootData.notifications);
        }
        if (Array.isArray(bootData.conversations)) {
          hydrateConversationsCache(bootData.conversations, currentUid);
        }
        if (Array.isArray(bootData.tasks)) {
          applyServerTasksSafely(bootData.tasks);
        }
        if (Array.isArray(bootData.drive_shortcuts)) {
          setCachedDriveShortcuts(bootData.drive_shortcuts);
        }
        if (Array.isArray(bootData.posts) || Array.isArray(bootData.trending)) {
          hydratePostsCache(
            Array.isArray(bootData.posts) ? bootData.posts : undefined,
            Array.isArray(bootData.trending) ? bootData.trending : undefined
          );
        }
        if (Array.isArray(bootData.groups)) {
          hydrateGroupsCache(bootData.groups, currentUid);
        }
        if (Array.isArray(bootData.meetings)) {
          scheduleJsonStorageWrite(`circle_meetings_cache_${currentUid}`, bootData.meetings);
          scheduleJsonStorageWrite("circle_meetings_cache", bootData.meetings);
        }
        if (Array.isArray(bootData.notes)) {
          scheduleJsonStorageWrite(`circle_sticky_notes_v1_${currentUid}`, bootData.notes);
          scheduleJsonStorageWrite("circle_sticky_notes_v1", bootData.notes);
        }
        if (Array.isArray(bootData.projects)) {
          scheduleJsonStorageWrite("circle_projects_cache", bootData.projects);
        }
        if (bootData.stats_team && typeof bootData.stats_team === "object") {
          hydrateTeamStatsCache(currentUid, bootData.stats_team, "default", "7d");
        }
        subs.current.forEach((fn) =>
          fn({
            type: "bootstrap:dashboard",
            meetings: bootData.meetings,
            notes: bootData.notes,
            projects: bootData.projects,
            stats_team: bootData.stats_team,
            drive_shortcuts: bootData.drive_shortcuts,
          })
        );
        lastLoadAllAtRef.current = Date.now();
      } finally {
        loadAllInFlightRef.current = null;
      }
    })();
    loadAllInFlightRef.current = runPromise;
    return runPromise;
  }, [me?.user_id, setSession, applyServerTasksSafely]);
  loadAllRef.current = loadAll;

  const checkAuth = useCallback(async () => {
    let cachedPrefs = {};
    try {
      cachedPrefs = JSON.parse(localStorage.getItem("circle_user_prefs") || "{}");
    } catch {}
    try {
      const { data } = await api.get("/auth/me");
      const mergedPrefs = { ...cachedPrefs, ...(data.prefs || {}) };
      const resolvedToken = data.token || getAuthToken();
      if (resolvedToken) setAuthToken(resolvedToken);
      const nextSession = {
        token: resolvedToken || undefined,
        user: data.user,
        account_vault_entry: data.account_vault_entry || data.user,
        workspace: data.workspace,
        prefs: mergedPrefs
      };
      setSession(nextSession);
      if (data.workspace && typeof data.workspace === "object") {
        reconcileMarketplaceEnabledCache(
          data.user?.user_id,
          data.workspace.marketplace_enabled !== false,
          data.workspace.marketplace_config
        );
      }
      if (data.account_vault_entry || data.user) {
        upsertAccountInVault(data.account_vault_entry || data.user);
      }
      if (Array.isArray(data.users) && data.users.length > 0) {
        setUsers(data.users);
        upsertAccountsListInVault(data.users);
        setOnline(new Set(data.users.filter((x) => x.online).map((x) => x.user_id)));
        scheduleJsonStorageWrite("circle_users_cache", data.users);
      }
      if (Array.isArray(data.labels) && data.labels.length > 0) {
        setLabels(data.labels);
        scheduleJsonStorageWrite("circle_labels_cache", data.labels);
      }
      if (Array.isArray(data.org_units)) {
        scheduleJsonStorageWrite("circle_org_units_cache", data.org_units);
      }
      if (Array.isArray(data.drive_shortcuts)) {
        setCachedDriveShortcuts(data.drive_shortcuts);
      }
      scheduleJsonStorageWrite("circle_user_prefs", mergedPrefs);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await attemptAutoHydrateServer(api).catch(() => false);
        try {
          const cachedRaw = sessionStorage.getItem("circle_tab_session_cache") || localStorage.getItem("circle_session_cache");
          const cachedSess = cachedRaw ? JSON.parse(cachedRaw) : null;
          if (cachedSess?.user?.user_id) {
            const { data: rec } = await api.post("/auth/session-recover", {
              token: cachedSess.token || getAuthToken(),
              user: cachedSess.user,
              known_accounts: getKnownAccountsFromVault()
            });
            if (rec?.token && rec?.user) {
              setAuthToken(rec.token);
              setSession({
                token: rec.token,
                user: rec.user,
                account_vault_entry: rec.account_vault_entry || rec.user,
                workspace: rec.workspace || cachedSess.workspace,
                prefs: { ...cachedPrefs, ...(rec.prefs || cachedSess.prefs || {}) }
              });
              return;
            }
          }
        } catch {}
        setSession(null);
      }
    }
  }, [setSession]);

  // Verify legacy tokenless cached sessions via cookie or cleanly return to Login
  useEffect(() => {
    if (me?.user_id && !session?.token) {
      checkAuth();
    }
  }, [me?.user_id, session?.token, checkAuth]);

  // Listen for 401 session revocation / expiration from API interceptor (attempt auto-hydrate & session-recover before kicking out)
  useEffect(() => {
    let lastNotified = 0;
    let handling = false;
    const handleExpired = async (evt) => {
      if (handling) return;
      const eventAuthGen = evt?.detail?.authGen;
      const currentGenBefore = getAuthGeneration();
      if (typeof eventAuthGen === "number" && eventAuthGen !== currentGenBefore) {
        return;
      }
      const hadSessionUid = sessionRef.current?.user?.user_id || null;
      const hadToken = sessionRef.current?.token || getAuthToken();
      if (!hadSessionUid && !hadToken) {
        return;
      }
      handling = true;
      try {
        await attemptAutoHydrateServer(api).catch(() => false);
        // If user just signed in manually while auto-hydrate ran, do NOT wipe out their new session
        if (getAuthGeneration() !== currentGenBefore && sessionRef.current?.user?.user_id && sessionRef.current?.token) {
          return;
        }
        try {
          const cachedRaw = sessionStorage.getItem("circle_tab_session_cache") || localStorage.getItem("circle_session_cache");
          const cachedSess = cachedRaw ? JSON.parse(cachedRaw) : null;
          if (cachedSess?.user?.user_id) {
            const { data: rec } = await api.post("/auth/session-recover", {
              token: cachedSess.token || getAuthToken(),
              user: cachedSess.user,
              known_accounts: getKnownAccountsFromVault()
            });
            if (rec?.token && rec?.user) {
              setSession((prev) => ({
                ...(prev || cachedSess),
                token: rec.token,
                user: rec.user,
                account_vault_entry: rec.account_vault_entry || rec.user,
                workspace: rec.workspace || prev?.workspace || cachedSess.workspace
              }));
              return;
            }
          }
        } catch {}
        if (getAuthGeneration() !== currentGenBefore && sessionRef.current?.user?.user_id && sessionRef.current?.token) {
          return;
        }
        const now = Date.now();
        setSession(null);
        if (now - lastNotified > 3000) {
          lastNotified = now;
          toast.error("Sesi login berakhir atau telah dicabut. Silakan masuk kembali.");
        }
      } finally {
        handling = false;
      }
    };
    window.addEventListener("circle:session-expired", handleExpired);
    return () => window.removeEventListener("circle:session-expired", handleExpired);
  }, [setSession, checkAuth]);

  useEffect(() => {
    if (me?.user_id) {
      setAuthUserId(me.user_id);
      if (session?.token) setAuthToken(session.token);
      let cancelled = false;
      let bgHydrateTimer = null;
      let bgMirrorTimer = null;
      let bgPrefetchTimer = null;
      (async () => {
        // 1. Critical path: 1 single /api/bootstrap request so workspace is interactive ASAP
        await loadAll(true).catch(() => {});
        if (cancelled) return;
        preloadAllRoutes();
        // 2. Defer non-critical background hydration, marketplace prefetch & push sync so first paint stays snappy
        bgHydrateTimer = setTimeout(async () => {
          if (cancelled) return;
          const restored = await attemptAutoHydrateServer(api).catch(() => false);
          if (!cancelled && restored) {
            await loadAll(true).catch(() => {});
          }
          if (!cancelled) {
            bgMirrorTimer = setTimeout(() => {
              if (!cancelled) {
                syncWorkspaceMirror(api, false).catch(() => {});
              }
            }, 3500);
          }
        }, 1200);
        bgPrefetchTimer = setTimeout(() => {
          if (cancelled) return;
          prefetchMarketplaceState(me.user_id).catch(() => null);
          syncPushSubscription(api).catch(() => {});
        }, 2500);
      })();
      return () => {
        cancelled = true;
        if (bgHydrateTimer) clearTimeout(bgHydrateTimer);
        if (bgMirrorTimer) clearTimeout(bgMirrorTimer);
        if (bgPrefetchTimer) clearTimeout(bgPrefetchTimer);
      };
    }
  }, [me?.user_id, session?.token, loadAll]);

  // Reactive Cloud Firestore sync status + automatic persistent mirror (IndexedDB + Firestore live sync)
  useEffect(() => {
    const unsubStatus = subscribeCloudSyncStatus(setCloudSyncStatus);
    const unsubFb = subscribeFirebaseAuth(async (fbUser) => {
      if (fbUser?.emailVerified && me?.user_id) {
        const restored = await attemptAutoHydrateServer(api).catch(() => false);
        if (restored) {
          loadAll().catch(() => {});
        } else {
          syncWorkspaceMirror(api, false, () => loadAllRef.current?.().catch(() => {})).catch(() => {});
        }
      }
    });

    if (!me?.user_id) {
      return () => {
        unsubStatus();
        unsubFb();
      };
    }

    const intervalId = setInterval(() => {
      syncWorkspaceMirror(api, false, () => loadAllRef.current?.().catch(() => {})).catch(() => {});
    }, 300000);

    const onHide = () => {
      if (document.visibilityState === "hidden") {
        syncWorkspaceMirror(api, false).catch(() => {});
      }
    };
    const onPageHide = () => syncWorkspaceMirror(api, false).catch(() => {});

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsubStatus();
      unsubFb();
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [me?.user_id, loadAll]);

  const syncCloudNow = useCallback(async () => {
    if (!firebaseAuth.currentUser?.emailVerified) {
      toast.info("Hubungkan akun Google terlebih dahulu agar Cloud Firestore aktif.");
      return false;
    }
    if (isFirestoreQuotaPaused()) {
      toast.warning("Kuota tulis harian gratis Firestore sudah tercapai hari ini (reset besok 00:05 UTC). Data Anda tetap aman tersimpan di server & cache lokal.");
      return false;
    }
    const res = await syncWorkspaceMirror(api, true, () => loadAllRef.current?.().catch(() => {}), true);
    const latest = getCloudSyncStatus();
    if (latest.lastError) {
      toast.error(latest.lastError);
      return false;
    }
    if (res?.pulledNewFromShared) {
      await loadAllRef.current?.().catch(() => {});
      toast.success("Data tim terbaru dari Cloud Firestore berhasil digabungkan & disinkronkan!");
    } else {
      toast.success("Semua data workspace tersimpan aman di Cloud Firestore!");
    }
    return true;
  }, []);

  const connectCloudGoogle = useCallback(async () => {
    try {
      const res = await googleBasicSignIn();
      if (res?.user) {
        await attemptAutoHydrateServer(api).catch(() => false);
        await syncWorkspaceMirror(api, false, () => loadAllRef.current?.().catch(() => {}), false).catch(() => {});
        await loadAllRef.current?.().catch(() => {});
        if (isFirestoreQuotaPaused()) {
          toast.info(`Akun Google terhubung (${res.user.email}). Sinkronisasi Firestore dijeda hingga reset kuota besok; data aman di server lokal.`);
        } else {
          toast.success(`Cloud Firestore aktif (${res.user.email})!`);
        }
        return true;
      }
      return false;
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/unauthorized-domain") {
        toast.error(`Domain "${window.location.hostname}" belum ditambahkan ke Authorized Domains Firebase Auth.`);
      } else if (code === "auth/popup-blocked") {
        toast.error("Popup Google diblokir browser. Izinkan pop-up untuk menghubungkan Cloud Firestore.");
      } else if (code === "auth/popup-closed-by-user") {
        toast.info("Popup login Google ditutup sebelum selesai.");
      } else {
        toast.error(err?.message || "Gagal menghubungkan Google OAuth (pastikan popup tidak diblokir atau email terverifikasi).");
      }
      return false;
    }
  }, []);

  // Sync PWA App Badge count with unread notifications
  useEffect(() => {
    syncAppBadge(unread);
  }, [unread]);

  // Forward Service Worker notificationclick navigation events into React Router
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const onSwMessage = (event) => {
      if (event?.data?.type === "CIRCLE_NAVIGATE" && event?.data?.url) {
        window.dispatchEvent(new CustomEvent("circle:navigate", { detail: { url: event.data.url } }));
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, []);

  useEffect(() => {
    applyTheme(buildTheme(ws?.theme, prefs, themeDraft));
  }, [ws?.theme, prefs, themeDraft]);

  // Synchronize browser tab Favicon dynamically with Workspace Favicon / Logo
  useEffect(() => {
    const faviconFileId = ws?.favicon_file_id || ws?.logo_file_id;
    const faviconHref = faviconFileId
      ? (faviconFileId === "default_workspace_logo" ? "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png" : fileUrl(faviconFileId))
      : "/assets/aistudio/657343220_18309991366279811_6828424809008890253_n_c00cf220.png";
    
    // Update or create standard icon link
    let iconLink = document.querySelector("link[rel='icon']");
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }
    iconLink.href = faviconHref;

    // Update or create Apple touch icon link
    let appleTouchLink = document.querySelector("link[rel='apple-touch-icon']");
    if (!appleTouchLink) {
      appleTouchLink = document.createElement("link");
      appleTouchLink.rel = "apple-touch-icon";
      document.head.appendChild(appleTouchLink);
    }
    appleTouchLink.href = faviconHref;
  }, [ws?.favicon_file_id, ws?.logo_file_id]);

  useEffect(() => {
    if (prefs.theme_mode !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme(buildTheme(ws?.theme, prefs, themeDraft));
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [prefs, ws?.theme, themeDraft]);

  const emit = (evt) => subs.current.forEach((fn) => fn(evt));

  useEffect(() => {
    if (!me?.user_id || me?.is_demo || me?.needs_onboarding || me?.is_verified) return;
    const seenKey = `circle_verify_prompt_seen_${me.user_id}`;
    try {
      if (localStorage.getItem(seenKey)) return;
      localStorage.setItem(seenKey, "1");
    } catch {}
    const timer = setTimeout(() => {
      setTopNotif({
        id: `verify_prompt_${me.user_id}`,
        title: "Lengkapi Profil 100% untuk Centang Verified",
        body: `Profil Anda baru terisi ${me.profile_completion || 0}%. Lengkapi seluruh form di Ubah Profil untuk mendapatkan centang Verified!`,
        type: "profile_verify",
        link: `/people/${me.user_id}?edit=1`,
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [me?.user_id, me?.is_demo, me?.needs_onboarding, me?.is_verified, me?.profile_completion]);

  useEffect(() => {
    if (!me?.user_id) return undefined;
    let closed = false;
    let timer;
    let hasWsConnectedOnce = false;
    const connect = () => {
      const s = new WebSocket(wsUrl());
      sock.current = s;
      s.onopen = () => {
        if (me?.user_id && s.readyState === 1) {
          s.send(JSON.stringify({ type: "identify", user_id: me.user_id, token: getAuthToken() }));
        }
        if (hasWsConnectedOnce) {
          api.get("/tasks").then((r) => {
            if (Array.isArray(r.data)) {
              applyServerTasksSafely(r.data, { silentSync: true });
            }
          }).catch(() => {});
        }
        hasWsConnectedOnce = true;
      };
      s.onmessage = (m) => {
        let evt;
        try {
          evt = JSON.parse(m.data);
        } catch {
          return;
        }
        if (!evt || typeof evt !== "object") return;
        if (evt.type === "presence" && evt.data?.user_id) {
          const targetUid = evt.data.user_id;
          const myUid = meRef.current?.user_id || me?.user_id;
          const isUserOnline = targetUid === myUid ? true : Boolean(evt.data.online);
          const incomingAvail = evt.data.availability_status;
          setOnline((prev) => {
            const hasTarget = prev.has(targetUid);
            const hasMe = !myUid || prev.has(myUid);
            if (hasTarget === isUserOnline && hasMe) return prev;
            const n = new Set(prev);
            isUserOnline ? n.add(targetUid) : n.delete(targetUid);
            if (myUid) n.add(myUid);
            return n;
          });
          setUsers((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const idx = list.findIndex((u) => u.user_id === targetUid);
            if (idx === -1) return prev;
            const cur = list[idx];
            const nextAvail = incomingAvail || cur.availability_status;
            if (Boolean(cur.online) === isUserOnline && cur.availability_status === nextAvail) {
              return prev;
            }
            const next = list.map((u, i) =>
              i === idx
                ? {
                    ...u,
                    online: isUserOnline,
                    ...(incomingAvail ? { availability_status: incomingAvail } : {}),
                  }
                : u
            );
            scheduleJsonStorageWrite("circle_users_cache", next);
            return next;
          });
          if (incomingAvail && targetUid === myUid) {
            setSession((s) => {
              if (!s?.user) return s;
              if (s.user.availability_status === incomingAvail && s.user.online === true) return s;
              return { ...s, user: { ...s.user, availability_status: incomingAvail, online: true } };
            });
          }
        }
        const playMsgSoundOnce = () => {
          const nowMs = Date.now();
          if (nowMs - lastMsgSoundAtRef.current > 450) {
            lastMsgSoundAtRef.current = nowMs;
            playSound("message_notif");
          }
        };
        if (evt.type === "notification") {
          if (evt.data?.user_id && me?.user_id && evt.data.user_id !== me.user_id) return;
          const isViewingThisChat = Boolean(
            evt.data?.conversation_id && window.location.pathname === `/messages/${evt.data.conversation_id}`
          );
          if (!isViewingThisChat) {
            setUnread((x) => x + 1);
            const nextNotif = {
              id: evt.data.id || `notif_${Date.now()}`,
              title: evt.data.title,
              body: evt.data.body,
              type: evt.data.type,
              category: evt.data.category,
              link: evt.data.link,
              access_request: evt.data.access_request,
              group_id: evt.data.group_id,
              requester_id: evt.data.requester_id,
              conversation_id: evt.data.conversation_id,
              task_id: evt.data.task_id,
              post_id: evt.data.post_id,
              sender: evt.data.sender
            };
            if (hasTopNotifQuickAction(nextNotif)) setTopQuickActionNotifActive(true);
            setTopNotif(nextNotif);
            const isMsgNotif =
              evt.data?.category === "messages" ||
              evt.data?.category === "dm" ||
              ["dm", "message", "group_message"].includes(evt.data?.type) ||
              Boolean(evt.data?.conversation_id);
            if (isMsgNotif) {
              playMsgSoundOnce();
            } else {
              playSound("notification");
            }
            const curPrefs = prefsRef.current || prefs;
            const catKey = evt.data?.category === "dm" ? "messages" : evt.data?.category;
            const catEnabled = !catKey || curPrefs?.notifications?.[catKey] !== false;
            if (catEnabled) {
              showSystemNotification(evt.data, {
                alwaysWhenVisible: Boolean(curPrefs?.notifications?.system_always_in_pwa)
              });
            }
          }
        }
        if (evt.type === "message:new" && evt.data) {
          // Ignore private messages meant for conversations this user is not part of
          if (Array.isArray(evt.data.member_ids) && me?.user_id && !evt.data.member_ids.includes(me.user_id)) {
            return;
          }
          if (String(evt.data.conversation_id || "").startsWith("conv_circle_") && evt.data.conversation_id !== `conv_circle_${me?.user_id}`) {
            return;
          }
          // Always cache incoming messages immediately in memory & localStorage so opening any chat has 0ms delay
          appendMessageToCache(evt.data);
          const alreadyNotifiedViaEvent =
            Array.isArray(evt.data.notified_user_ids) &&
            Boolean(me?.user_id) &&
            evt.data.notified_user_ids.includes(me.user_id);
          if (evt.data.sender_id !== me?.user_id && !evt.data.silent_popup && !alreadyNotifiedViaEvent) {
            const isCurrentlyInThisChat = window.location.pathname === `/messages/${evt.data.conversation_id}`;
            if (!isCurrentlyInThisChat) {
              const curUsers = usersRef.current || users;
              const curWs = wsRef.current || ws;
              const curPrefs = prefsRef.current || prefs;
              const userMapObj = Object.fromEntries((Array.isArray(curUsers) ? curUsers : []).map((u) => [u.user_id, u]));
              const sender = userMapObj[evt.data.sender_id] || (evt.data.sender_id === "user_circle_assistant" ? { name: curWs?.assistant_name || "Asli", avatar: curWs?.assistant_avatar } : null);
              const msgTitle = evt.data.conversation_type === "group" && evt.data.conversation_name
                ? `${sender?.name || "Rekan Kerja"} di ${evt.data.conversation_name}`
                : `Pesan Baru dari ${sender?.name || "Asli"}`;
              const msgBody = evt.data.text || "Mengirimkan pesan baru";
              const nextNotif = {
                id: `msg_notif_${Date.now()}`,
                title: msgTitle,
                body: msgBody,
                type: evt.data.type || "dm",
                conversation_id: evt.data.conversation_id,
                sender,
                access_request: evt.data.access_request
              };
              if (hasTopNotifQuickAction(nextNotif)) setTopQuickActionNotifActive(true);
              setTopNotif(nextNotif);
              const isMutedConv = (curPrefs?.muted_conversations || []).includes(evt.data.conversation_id);
              if (!isMutedConv && curPrefs?.notifications?.messages !== false) {
                playMsgSoundOnce();
              }
              // For group chats (which don't emit a separate notification event), trigger OS/PWA notification too
              if (evt.data.conversation_type === "group" && !isMutedConv && curPrefs?.notifications?.messages !== false) {
                showSystemNotification(
                  {
                    id: evt.data.id,
                    title: msgTitle,
                    body: msgBody,
                    type: "message",
                    conversation_id: evt.data.conversation_id,
                    tag: evt.data.conversation_id
                  },
                  { alwaysWhenVisible: Boolean(curPrefs?.notifications?.system_always_in_pwa) }
                );
              }
            }
          }
        }
        if (evt.type === "message:update" && evt.data) {
          updateMessageInCache(evt.data);
        }
        if (evt.type === "conversation:upsert" && evt.data) {
          upsertConversationInCache(evt.data, me?.user_id);
        }
        if ((evt.type === "groups:changed" || evt.type === "group:updated") && evt.data) {
          upsertGroupInCache(evt.data, me?.user_id);
          upsertConversationInCache({ ...evt.data, type: "group" }, me?.user_id);
        }
        if (evt.type === "conversations:changed") {
          api.get("/conversations").then((r) => {
            if (Array.isArray(r.data)) hydrateConversationsCache(r.data, me?.user_id);
          }).catch(() => {});
        }
        if (evt.type === "conversation:deleted" && evt.id) {
          const curUid = meRef.current?.user_id || me?.user_id;
          const delMsgIds = Array.isArray(evt.deleted_message_ids) ? evt.deleted_message_ids : [];
          if (evt.is_circle_clear) {
            if (delMsgIds.length > 0) recordDeletedEntityIds(delMsgIds);
            clearConversationMessagesCache(evt.id, curUid);
          } else {
            recordDeletedEntityIds([evt.id, ...delMsgIds]);
            removeConversationFromCache(evt.id, curUid);
            if (evt.conv_type === "group") {
              removeGroupFromCache(evt.id, curUid);
            }
          }
        }
        if (evt.type === "group:deleted" && evt.id) {
          const delMsgIds = Array.isArray(evt.deleted_message_ids) ? evt.deleted_message_ids : [];
          recordDeletedEntityIds([evt.id, ...delMsgIds]);
        }
        if (evt.type === "notes:changed" && evt.action === "delete" && evt.deleted_id) {
          recordDeletedEntityIds([evt.deleted_id]);
        }
        if (evt.type === "post:deleted" && (evt.id || Array.isArray(evt.deleted_ids))) {
          recordDeletedEntityIds(Array.isArray(evt.deleted_ids) ? evt.deleted_ids : [evt.id]);
        }
        if (evt.type === "meeting:delete" && (evt.id || Array.isArray(evt.deleted_ids))) {
          recordDeletedEntityIds([
            ...(evt.id ? [evt.id] : []),
            ...(Array.isArray(evt.deleted_ids) ? evt.deleted_ids : []),
          ]);
        }
        if (evt.type === "boards:changed" && evt.deleted_id) {
          recordDeletedEntityIds([evt.deleted_id]);
        }
        if (evt.type === "instagram_tracker:changed" && evt.deleted_id) {
          recordDeletedEntityIds([evt.deleted_id]);
        }
        if (evt.type === "checkpoint_templates:changed") {
          if (Array.isArray(evt.deleted_ids) && evt.deleted_ids.length > 0) {
            recordDeletedCheckpointTemplateIds(evt.deleted_ids);
          }
          if (Array.isArray(evt.templates)) {
            try {
              localStorage.setItem("circle_checkpoint_templates", JSON.stringify(evt.templates));
            } catch {}
            setSession((s) =>
              s
                ? {
                    ...s,
                    workspace: {
                      ...(s.workspace || {}),
                      checkpoint_templates: evt.templates,
                      checkpoint_templates_initialized: true,
                      deleted_checkpoint_template_ids:
                        evt.deleted_ids || s.workspace?.deleted_checkpoint_template_ids || [],
                    },
                  }
                : s
            );
          }
        }
        if (evt.type === "workspace:changed" || evt.type === "workspace:updated") {
          if (evt.data && typeof evt.data === "object") {
            if (Array.isArray(evt.data.deleted_checkpoint_template_ids) && evt.data.deleted_checkpoint_template_ids.length > 0) {
              recordDeletedCheckpointTemplateIds(evt.data.deleted_checkpoint_template_ids);
            }
            if (Array.isArray(evt.data.checkpoint_templates)) {
              try {
                localStorage.setItem("circle_checkpoint_templates", JSON.stringify(evt.data.checkpoint_templates));
              } catch {}
            }
            setSession((s) => (s ? { ...s, workspace: evt.data } : s));
            reconcileMarketplaceEnabledCache(
              me?.user_id,
              evt.data.marketplace_enabled !== false,
              evt.data.marketplace_config
            );
          } else {
            api.get("/workspace").then((r) => {
              if (r.data && typeof r.data === "object") {
                if (Array.isArray(r.data.deleted_checkpoint_template_ids) && r.data.deleted_checkpoint_template_ids.length > 0) {
                  recordDeletedCheckpointTemplateIds(r.data.deleted_checkpoint_template_ids);
                }
                if (Array.isArray(r.data.checkpoint_templates)) {
                  try {
                    localStorage.setItem("circle_checkpoint_templates", JSON.stringify(r.data.checkpoint_templates));
                  } catch {}
                }
                setSession((s) => (s ? { ...s, workspace: r.data } : s));
                reconcileMarketplaceEnabledCache(
                  me?.user_id,
                  r.data.marketplace_enabled !== false,
                  r.data.marketplace_config
                );
              }
            }).catch(() => {});
          }
          if (evt.data?.marketplace_enabled !== undefined) {
            prefetchMarketplaceState(me?.user_id).catch(() => null);
          }
        }
        if (evt.type === "users:changed") {
          api.get("/users").then((r) => {
            if (Array.isArray(r.data)) {
              const curUid = meRef.current?.user_id;
              const synced = r.data.map((u) => (u.user_id === curUid ? { ...u, online: true } : u));
              setUsers(synced);
              setOnline(new Set([...synced.filter((x) => x.online).map((x) => x.user_id), ...(curUid ? [curUid] : [])]));
              scheduleJsonStorageWrite("circle_users_cache", synced);
              setSession((s) => {
                if (!s?.user) return s;
                const updatedMe = synced.find((u) => u.user_id === s.user.user_id);
                if (!updatedMe) return s;
                return { ...s, user: updatedMe };
              });
            }
          }).catch(() => {});
        }
        if (evt.type === "org:changed" && Array.isArray(evt.units)) {
          scheduleJsonStorageWrite("circle_org_units_cache", evt.units);
        }
        if (evt.type === "drive_shortcuts:changed" && Array.isArray(evt.data)) {
          if (evt.deleted_id) recordDeletedEntityIds([evt.deleted_id]);
          setCachedDriveShortcuts(evt.data);
        }
        if (evt.type === "tasks:changed") {
          if (evt.deleted_id || (Array.isArray(evt.deleted_ids) && evt.deleted_ids.length > 0)) {
            const delList = evt.deleted_id ? [evt.deleted_id] : evt.deleted_ids;
            recordDeletedTaskIds(delList);
            const delSet = new Set(delList.map(String));
            setTasks((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              const next = list.filter((x) => !delSet.has(String(x.id)));
              scheduleJsonStorageWrite("circle_tasks_cache", next);
              scheduleJsonStorageWrite("circle_cache_tasks", next);
              return next;
            });
          } else if (evt.task) {
            const incoming = evt.task;
            const curMe = meRef.current || me;
            const uid = curMe?.user_id;
            const isSuper = ["super_admin", "workspace_admin"].includes(curMe?.role);
            const isInvolved = Boolean(
              uid && (
                incoming.assignee_id === uid ||
                (Array.isArray(incoming.assignee_ids) && incoming.assignee_ids.includes(uid)) ||
                incoming.created_by === uid ||
                (Array.isArray(incoming.requestor_ids) && incoming.requestor_ids.includes(uid)) ||
                (Array.isArray(incoming.collaborator_ids) && incoming.collaborator_ids.includes(uid)) ||
                (Array.isArray(incoming.checkpoints) && incoming.checkpoints.some((c) => c && c.assignee_id === uid))
              )
            );
            const matchesDept = Boolean(
              curMe?.department && incoming.department &&
              String(curMe.department).trim().toLowerCase() === String(incoming.department).trim().toLowerCase()
            );
            if (isSuper || isInvolved || matchesDept) {
              setTasks((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const existing = list.find((x) => x.id === incoming.id);
                const mergedIncoming = existing
                  ? (mergeTasksArrayNonDestructive([existing], [incoming])[0] || enforceTaskApprovalInvariant(incoming))
                  : enforceTaskApprovalInvariant(incoming);
                const next = existing
                  ? list.map((x) => (x.id === incoming.id ? mergedIncoming : x))
                  : [mergedIncoming, ...list];
                scheduleJsonStorageWrite("circle_tasks_cache", next);
                scheduleJsonStorageWrite("circle_cache_tasks", next);
                return next;
              });
            } else {
              // If user previously saw it or might have invited-board access, sync cleanly with server
              api.get("/tasks").then((r) => {
                if (Array.isArray(r.data)) {
                  applyServerTasksSafely(r.data);
                }
              }).catch(() => {});
            }
          } else {
            api.get("/tasks").then((r) => {
              if (Array.isArray(r.data)) {
                applyServerTasksSafely(r.data);
              }
            }).catch(() => {});
          }
        }
        if (evt.type === "tasks:deleted" && (evt.id || Array.isArray(evt.ids))) {
          const delList = evt.id ? [evt.id] : evt.ids;
          recordDeletedTaskIds(delList);
          const delSet = new Set(delList.map(String));
          setTasks((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.filter((x) => !delSet.has(String(x.id)));
            scheduleJsonStorageWrite("circle_tasks_cache", next);
            scheduleJsonStorageWrite("circle_cache_tasks", next);
            return next;
          });
        }
        if (evt.type === "marketplace:changed") {
          if (typeof evt.enabled === "boolean") {
            setSession((s) => {
              if (!s?.workspace || s.workspace.marketplace_enabled === evt.enabled) return s;
              return { ...s, workspace: { ...s.workspace, marketplace_enabled: evt.enabled } };
            });
            reconcileMarketplaceEnabledCache(me?.user_id, evt.enabled);
            prefetchMarketplaceState(me?.user_id).catch(() => null);
          }
        }
        if (
          [
            "tasks:changed",
            "tasks:deleted",
            "notes:changed",
            "message:new",
            "message:update",
            "posts:changed",
            "users:changed",
            "workspace:changed",
            "workspace:updated",
            "org:changed",
            "groups:changed",
            "conversations:changed",
            "conversation:deleted",
            "marketplace:changed",
            "auto_backup:created",
          ].includes(evt.type)
        ) {
          scheduleRealtimeCloudSync(api, 4000, () => {
            loadAllRef.current?.().catch(() => {});
          });
        }
        emit(evt);
      };
      s.onerror = () => {
        // Silent error handler to prevent unhandled rejection when connection closes prematurely
      };
      s.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000);
      };
    };
    connect();
    const ping = setInterval(() => {
      if (sock.current?.readyState === 1) {
        sock.current.send(JSON.stringify({ type: "ping", user_id: me.user_id }));
      }
    }, 20000);
    let lastFocusWorkspaceSync = 0;
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible" && me?.user_id) {
        const wsOpen = sock.current?.readyState === 1;
        if (wsOpen) {
          sock.current.send(JSON.stringify({ type: "identify", user_id: me.user_id, token: getAuthToken() }));
        }
        const now = Date.now();
        // Throttle focus sync to 30s and leverage ETag-cached /api/bootstrap (304 Not Modified when unchanged)
        if (now - lastFocusWorkspaceSync >= 30000) {
          lastFocusWorkspaceSync = now;
          if (!wsOpen) {
            loadAllRef.current?.(false).catch(() => {});
          }
        }
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      sock.current?.close();
    };
  }, [me?.user_id]);

  const userMap = useMemo(
    () => Object.fromEntries((Array.isArray(users) ? users : []).map((u) => [u.user_id, u])),
    [users]
  );
  const labelMap = useMemo(
    () => Object.fromEntries((Array.isArray(labels) ? labels : []).map((l) => [l.id, l])),
    [labels]
  );
  const statuses = useMemo(
    () =>
      (ws?.task_statuses || ["todo", "in_progress", "in_review", "done"]).map((s) =>
        typeof s === "string"
          ? { key: s, name: s.replace(/_/g, " "), color: "#F0F4FA", is_done: s === "done" }
          : s
      ),
    [ws?.task_statuses]
  );
  const effectiveCopywriting = useMemo(
    () => getEffectiveCopywriting(ws?.custom_copywriting, prefs?.custom_copywriting),
    [ws?.custom_copywriting, prefs?.custom_copywriting]
  );
  const t = useCallback(
    (key, fallback) => getTranslation(key, effectiveCopywriting, fallback),
    [effectiveCopywriting]
  );

  const reloadTasks = useCallback(() => api.get("/tasks").then((r) => {
    if (Array.isArray(r.data)) {
      applyServerTasksSafely(r.data);
    }
  }), [applyServerTasksSafely]);

  const handleSetTopNotif = useCallback((d) => {
    setTopQuickActionNotifActive(hasTopNotifQuickAction(d));
    setTopNotif(d);
  }, []);

  const closeTopNotif = useCallback(() => {
    setTopQuickActionNotifActive(false);
    setTopNotif(null);
  }, []);

  const reloadUsers = useCallback(() => api.get("/users").then((r) => {
    if (Array.isArray(r.data)) {
      const curUid = meRef.current?.user_id;
      const synced = r.data.map((u) => (u.user_id === curUid ? { ...u, online: true } : u));
      setUsers(synced);
      setOnline(new Set([...synced.filter((x) => x.online).map((x) => x.user_id), ...(curUid ? [curUid] : [])]));
      scheduleJsonStorageWrite("circle_users_cache", synced);
      setSession((s) => {
        if (!s?.user) return s;
        const updatedMe = synced.find((u) => u.user_id === s.user.user_id);
        if (!updatedMe) return s;
        return { ...s, user: updatedMe };
      });
    }
  }), [setSession]);

  const reloadLabels = useCallback(() => api.get("/labels").then((r) => {
    if (Array.isArray(r.data)) {
      setLabels(r.data);
      scheduleJsonStorageWrite("circle_labels_cache", r.data);
    }
  }), []);

  const reloadWs = useCallback(() => api.get("/workspace").then((r) => {
    if (r.data && typeof r.data === "object") {
      reconcileMarketplaceEnabledCache(
        meRef.current?.user_id,
        r.data.marketplace_enabled !== false,
        r.data.marketplace_config
      );
    }
    setSession((s) => {
      if (Array.isArray(r.data?.divisions)) {
        scheduleJsonStorageWrite("circle_admin_divisions", r.data.divisions);
      }
      return s ? { ...s, workspace: r.data } : s;
    });
  }), [setSession]);

  const savePrefs = useCallback(async (patch) => {
    setSession((s) => {
      const nextPrefs = { ...(s?.prefs || {}), ...patch };
      scheduleJsonStorageWrite("circle_user_prefs", nextPrefs);
      return s ? { ...s, prefs: nextPrefs } : s;
    });
    try {
      const { data } = await api.put("/prefs", patch);
      setSession((s) => {
        const synced = { ...(s?.prefs || {}), ...data };
        scheduleJsonStorageWrite("circle_user_prefs", synced);
        return s ? { ...s, prefs: synced } : s;
      });
    } catch (e) {
      console.warn("Server prefs sync warning:", e);
    }
  }, [setSession]);

  const subscribe = useCallback((fn) => {
    subs.current.add(fn);
    return () => subs.current.delete(fn);
  }, []);

  const send = useCallback(
    (obj) => sock.current?.readyState === 1 && sock.current.send(JSON.stringify(obj)),
    []
  );

  const updateAvailabilityStatus = useCallback(async (newStatus) => {
    const normalized = String(newStatus || "online").toLowerCase().trim();
    const uid = meRef.current?.user_id;
    if (!uid) return;
    setSession((s) => {
      if (!s?.user) return s;
      return { ...s, user: { ...s.user, availability_status: normalized, online: true } };
    });
    setUsers((prev) => {
      const next = (Array.isArray(prev) ? prev : []).map((u) =>
        u.user_id === uid ? { ...u, availability_status: normalized, online: true } : u
      );
      scheduleJsonStorageWrite("circle_users_cache", next);
      return next;
    });
    try {
      await api.post("/presence/status", { user_id: uid, availability_status: normalized });
    } catch (err) {
      console.warn("Failed to sync availability status:", err);
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setSession(null);
  }, [setSession]);

  const value = useMemo(() => {
    return {
      session, setSession, me, ws, prefs, users, userMap, labels, labelMap, online, unread, setUnread,
      tasks, userDeadlinesToday, userDeadlineReasons, hasDeadlineToday,
      reloadTasks,
      topNotif,
      setTopNotif: handleSetTopNotif,
      showTopNotif: handleSetTopNotif,
      closeTopNotif,
      statuses,
      isAdmin: ["super_admin", "workspace_admin"].includes(me?.role),
      isManager: ["super_admin", "workspace_admin", "department_manager", "project_manager"].includes(me?.role),
      isDemo: !!me?.is_demo,
      lang: "en",
      effectiveCopywriting,
      t,
      themeDraft, setThemeDraft,
      reloadUsers,
      reloadLabels,
      reloadWs,
      savePrefs,
      subscribe,
      send,
      updateAvailabilityStatus,
      logout,
      checkAuth,
      reloadAll: loadAll,
      cloudSyncStatus,
      syncCloudNow,
      connectCloudGoogle,
    };
  }, [session, setSession, me, ws, prefs, users, userMap, labels, labelMap, statuses, effectiveCopywriting, t, online, unread, topNotif, themeDraft, tasks, userDeadlinesToday, userDeadlineReasons, hasDeadlineToday, reloadTasks, handleSetTopNotif, closeTopNotif, reloadUsers, reloadLabels, reloadWs, savePrefs, subscribe, send, updateAvailabilityStatus, logout, checkAuth, loadAll, cloudSyncStatus, syncCloudNow, connectCloudGoogle]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
