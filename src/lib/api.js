import axios from "axios";
import { getKnownAccountsFromVault, upsertAccountInVault, attemptAutoHydrateServer } from "./persistentMirror";
import { getActiveRoomSlug, setActiveRoomSlug, roomStorageKey } from "./roomContext";

export const BASE = "";
export const api = axios.create({ baseURL: `/api`, withCredentials: true });

let activeTabUserId = null;
let activeAuthToken = null;
let authGeneration = 0;
let recoveryInFlight = null;
let cachedProfileHeader = { uid: null, token: null, room: null, value: "", expiresAt: 0 };

export function switchActiveRoom(slug) {
  const clean = setActiveRoomSlug(slug);
  activeTabUserId = null;
  activeAuthToken = null;
  authGeneration += 1;
  apiGetCache.clear();
  apiInflightGets.clear();
  invalidateProfileHeaderCache();
  return clean;
}

export function getAuthGeneration() {
  return authGeneration;
}

export function invalidateProfileHeaderCache() {
  cachedProfileHeader = { uid: null, token: null, room: null, value: "", expiresAt: 0 };
}

const CACHEABLE_GET_PREFIXES = [
  "/groups/browse",
  "/projects",
  "/boards",
  "/meetings",
  "/drive-shortcuts",
  "/posts",
  "/conversations",
  "/stats/team",
  "/stickers",
  "/workspace",
  "/users",
  "/labels",
  "/marketplace/state",
  "/org/units",
  "/admin/stats",
  "/admin/users",
  "/billing/overview",
];
const GET_CACHE_TTL_MS = 10000;
const GET_CACHE_MAX_ENTRIES = 80;
const apiGetCache = new Map();
const apiInflightGets = new Map();

function buildGetCacheKey(url, params) {
  const uid = getAuthUserId() || "anon";
  const room = getActiveRoomSlug();
  let paramKey = "";
  if (params && typeof params === "object") {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length > 0) {
      paramKey = `?${entries.map(([k, v]) => `${k}=${String(v)}`).join("&")}`;
    }
  }
  return `${room}::${uid}::${url}${paramKey}`;
}

function isCacheableGetUrl(url) {
  if (typeof url !== "string") return false;
  const clean = url.split("?")[0];
  if (clean.includes("/messages")) return false;
  return CACHEABLE_GET_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`));
}

export function invalidateApiGetCache(prefix = "") {
  if (!prefix) {
    apiGetCache.clear();
    return;
  }
  for (const key of apiGetCache.keys()) {
    if (key.includes(prefix)) {
      apiGetCache.delete(key);
    }
  }
}

export function setAuthToken(token) {
  const next = token || null;
  if (activeAuthToken !== next) {
    authGeneration += 1;
    apiGetCache.clear();
    apiInflightGets.clear();
  }
  activeAuthToken = next;
  invalidateProfileHeaderCache();
  try {
    const tokKey = roomStorageKey("circle_active_token");
    if (next) {
      sessionStorage.setItem(tokKey, next);
    } else {
      sessionStorage.removeItem(tokKey);
    }
  } catch {}
}

export function getAuthToken() {
  if (activeAuthToken) return activeAuthToken;
  try {
    const tabTok = sessionStorage.getItem(roomStorageKey("circle_active_token"));
    if (tabTok) {
      activeAuthToken = tabTok;
      return tabTok;
    }
    const tabSess = sessionStorage.getItem(roomStorageKey("circle_tab_session_cache"));
    if (tabSess) {
      const parsed = JSON.parse(tabSess);
      if (parsed?.token) {
        activeAuthToken = parsed.token;
        return activeAuthToken;
      }
    }
    const cached = localStorage.getItem(roomStorageKey("circle_session_cache"));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.token) {
        activeAuthToken = parsed.token;
        return activeAuthToken;
      }
    }
  } catch {}
  return null;
}

export function setAuthUserId(uid) {
  const next = uid || null;
  if (activeTabUserId !== next) {
    authGeneration += 1;
    apiGetCache.clear();
    apiInflightGets.clear();
  }
  activeTabUserId = next;
  invalidateProfileHeaderCache();
  try {
    const uidKey = roomStorageKey("circle_active_user_id");
    if (next) {
      sessionStorage.setItem(uidKey, next);
    } else {
      sessionStorage.removeItem(uidKey);
    }
  } catch {}
}

export function getAuthUserId() {
  if (activeTabUserId) return activeTabUserId;
  try {
    const tabUid = sessionStorage.getItem(roomStorageKey("circle_active_user_id"));
    if (tabUid) {
      activeTabUserId = tabUid;
      return tabUid;
    }
    const tabSess = sessionStorage.getItem(roomStorageKey("circle_tab_session_cache"));
    if (tabSess) {
      const parsed = JSON.parse(tabSess);
      if (parsed?.user?.user_id) {
        activeTabUserId = parsed.user.user_id;
        return activeTabUserId;
      }
    }
    const cached = localStorage.getItem(roomStorageKey("circle_session_cache"));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.user?.user_id) {
        activeTabUserId = parsed.user.user_id;
        return activeTabUserId;
      }
    }
  } catch {}
  return null;
}

export function getCachedSessionUser() {
  try {
    const tabSess = sessionStorage.getItem(roomStorageKey("circle_tab_session_cache"));
    const raw = tabSess || localStorage.getItem(roomStorageKey("circle_session_cache"));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.user?.user_id) return parsed.user;
    }
  } catch {}
  return null;
}

function encodeBase64Json(obj) {
  try {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return "";
  }
}

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  const uid = getAuthUserId();
  const activeRoom = getActiveRoomSlug();
  config._authGen = authGeneration;
  config.headers = config.headers || {};
  if (activeRoom && !config.headers["X-Workspace-Room"]) {
    config.headers["X-Workspace-Room"] = activeRoom;
  }
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  if (uid) {
    config.headers["x-user-id"] = uid;
  }

  // Attach compact self-healing session user profile header (memoized 5s to avoid per-request localStorage/btoa overhead)
  const nowTs = Date.now();
  if (
    cachedProfileHeader.value &&
    cachedProfileHeader.uid === uid &&
    cachedProfileHeader.token === token &&
    cachedProfileHeader.room === activeRoom &&
    nowTs < cachedProfileHeader.expiresAt
  ) {
    config.headers["x-user-profile"] = cachedProfileHeader.value;
  } else {
    const sessUser = getCachedSessionUser();
    if (sessUser?.user_id && sessUser?.email) {
      const vaultMatch = getKnownAccountsFromVault().find(
        (u) => u.user_id === sessUser.user_id || u.email?.toLowerCase() === sessUser.email?.toLowerCase()
      );
      const compactProfile = {
        user_id: sessUser.user_id,
        email: sessUser.email,
        name: sessUser.name,
        role: sessUser.role || vaultMatch?.role || "employee",
        department: sessUser.department || vaultMatch?.department || "Marketing",
        job_title: sessUser.job_title || vaultMatch?.job_title || "Staff Member",
        org_unit_id: sessUser.org_unit_id || vaultMatch?.org_unit_id || null,
        status: sessUser.status || "pending",
        avatar:
          sessUser.avatar && !String(sessUser.avatar).startsWith("data:")
            ? sessUser.avatar
            : undefined,
        token_version: Number(sessUser.token_version || vaultMatch?.token_version || 1),
      };
      const encoded = encodeBase64Json(compactProfile);
      if (encoded && encoded.length < 4096) {
        cachedProfileHeader = { uid, token, room: activeRoom, value: encoded, expiresAt: nowTs + 5000 };
        config.headers["x-user-profile"] = encoded;
      }
    }
  }

  // Only pass known_accounts to password-reset endpoints when needed; NEVER attach to login/google lookup
  const reqUrl = String(config.url || "");
  if (
    config.method === "post" &&
    config.data &&
    typeof config.data === "object" &&
    !(config.data instanceof FormData) &&
    (reqUrl.includes("/auth/forgot-password") ||
      reqUrl.includes("/auth/reset-with-recovery-key"))
  ) {
    const known = getKnownAccountsFromVault();
    if (known.length > 0 && !config.data.known_accounts) {
      config.data = { ...config.data, known_accounts: known };
    }
  }

  return config;
});

async function recoverActiveSession() {
  if (recoveryInFlight) return recoveryInFlight;
  recoveryInFlight = (async () => {
    try {
      const sessUser = getCachedSessionUser();
      const token = getAuthToken();
      const known = getKnownAccountsFromVault();
      if (!token && !sessUser?.user_id) return false;

      // 1. Hydrate workspace mirror if server cold-started
      await attemptAutoHydrateServer(api).catch(() => false);

      // 2. Request session self-healing from server
      const { data } = await api.post("/auth/session-recover", {
        token,
        user: sessUser,
        known_accounts: known,
      });

      if (data?.token && data?.user?.user_id) {
        setAuthToken(data.token);
        setAuthUserId(data.user.user_id);
        upsertAccountInVault(data.account_vault_entry || data.user);
        try {
          const tabKey = roomStorageKey("circle_tab_session_cache");
          const locKey = roomStorageKey("circle_session_cache");
          const tabRaw = sessionStorage.getItem(tabKey);
          const locRaw = localStorage.getItem(locKey);
          const prev = JSON.parse(tabRaw || locRaw || "{}");
          const next = {
            ...prev,
            token: data.token,
            user: data.user,
            workspace: data.workspace || prev.workspace,
          };
          const serialized = JSON.stringify(next);
          sessionStorage.setItem(tabKey, serialized);
          localStorage.setItem(locKey, serialized);
        } catch {}
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      recoveryInFlight = null;
    }
  })();
  return recoveryInFlight;
}

api.interceptors.response.use(
  (res) => {
    const method = String(res?.config?.method || "get").toLowerCase();
    if (method !== "get" && method !== "head" && method !== "options") {
      apiGetCache.clear();
    }
    return res;
  },
  async (err) => {
    const status = err?.response?.status;
    const originalConfig = err?.config;
    const reqUrl = String(originalConfig?.url || "");
    const isPublicOrLogin =
      reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/register") ||
      reqUrl.includes("/auth/forgot-password") ||
      reqUrl.includes("/auth/reset-with-recovery-key") ||
      reqUrl.includes("/auth/google") ||
      reqUrl.includes("/auth/session-recover") ||
      reqUrl.includes("/saas/") ||
      reqUrl.includes("/platform-owner/") ||
      reqUrl.includes("/workspace/persistence-status") ||
      reqUrl.includes("/workspace/auto-hydrate") ||
      reqUrl.includes("/public/");

    if (status === 401 && !isPublicOrLogin) {
      const reqAuthGen = originalConfig?._authGen;
      // If a newer login / token rotation already happened while this stale request was in-flight,
      // replay once with the fresh credentials instead of falsely kicking out the newly logged-in user.
      if (typeof reqAuthGen === "number" && reqAuthGen !== authGeneration) {
        const freshToken = getAuthToken();
        const freshUid = getAuthUserId();
        if (freshToken && freshUid && originalConfig && !originalConfig._retriedAfterAuthChange) {
          originalConfig._retriedAfterAuthChange = true;
          originalConfig._authGen = authGeneration;
          originalConfig.headers = originalConfig.headers || {};
          originalConfig.headers["Authorization"] = `Bearer ${freshToken}`;
          originalConfig.headers["x-user-id"] = freshUid;
          delete originalConfig.headers["x-user-profile"];
          return api.request(originalConfig);
        }
        return Promise.reject(err);
      }

      if (getAuthToken() || getAuthUserId()) {
        const wasExplicitlyRevoked = Boolean(err?.response?.data?.was_removed || err?.response?.data?.revoked);
        if (!wasExplicitlyRevoked && originalConfig && !originalConfig._retriedAfterRecover) {
          originalConfig._retriedAfterRecover = true;
          const recovered = await recoverActiveSession();
          // Re-check if user logged in manually while recovery was in-flight
          if (typeof reqAuthGen === "number" && reqAuthGen !== authGeneration) {
            const freshToken = getAuthToken();
            const freshUid = getAuthUserId();
            if (freshToken && freshUid && !originalConfig._retriedAfterAuthChange) {
              originalConfig._retriedAfterAuthChange = true;
              originalConfig._authGen = authGeneration;
              originalConfig.headers = originalConfig.headers || {};
              originalConfig.headers["Authorization"] = `Bearer ${freshToken}`;
              originalConfig.headers["x-user-id"] = freshUid;
              delete originalConfig.headers["x-user-profile"];
              return api.request(originalConfig);
            }
            return Promise.reject(err);
          }
          if (recovered) {
            const freshToken = getAuthToken();
            const freshUid = getAuthUserId();
            originalConfig._authGen = authGeneration;
            originalConfig.headers = originalConfig.headers || {};
            if (freshToken) {
              originalConfig.headers["Authorization"] = `Bearer ${freshToken}`;
            }
            if (freshUid) {
              originalConfig.headers["x-user-id"] = freshUid;
            }
            delete originalConfig.headers["x-user-profile"];
            return api.request(originalConfig);
          }
        }

        if (typeof reqAuthGen !== "number" || reqAuthGen === authGeneration) {
          try {
            window.dispatchEvent(
              new CustomEvent("circle:session-expired", {
                detail: { authGen: reqAuthGen ?? authGeneration, wasRemoved: wasExplicitlyRevoked },
              })
            );
          } catch {}
        }
      }
    }
    return Promise.reject(err);
  }
);

// Transparent in-memory GET deduplication & short-TTL cache for snappy menu switching
const rawApiGet = api.get.bind(api);
api.get = function cachedApiGet(url, config) {
  const skipCache = Boolean(
    config?.noCache ||
    config?.responseType === "blob" ||
    config?.responseType === "arraybuffer" ||
    config?.signal ||
    !isCacheableGetUrl(url)
  );
  if (skipCache) {
    return rawApiGet(url, config);
  }
  const cacheKey = buildGetCacheKey(url, config?.params);
  const now = Date.now();
  const cached = apiGetCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return Promise.resolve(cached.response);
  }
  const inflight = apiInflightGets.get(cacheKey);
  if (inflight) {
    return inflight;
  }
  const reqPromise = rawApiGet(url, config)
    .then((res) => {
      if (res && res.status >= 200 && res.status < 300) {
        if (apiGetCache.size >= GET_CACHE_MAX_ENTRIES) {
          const oldestKey = apiGetCache.keys().next().value;
          if (oldestKey) apiGetCache.delete(oldestKey);
        }
        apiGetCache.set(cacheKey, {
          response: res,
          expiresAt: Date.now() + GET_CACHE_TTL_MS,
        });
      }
      return res;
    })
    .finally(() => {
      apiInflightGets.delete(cacheKey);
    });
  apiInflightGets.set(cacheKey, reqPromise);
  return reqPromise;
};

export const fileUrl = (id) => {
  if (!id) return "";
  const slug = getActiveRoomSlug();
  const base = `/api/files/${id}`;
  if (slug && slug !== "asli-workspace") {
    return `${base}?room=${encodeURIComponent(slug)}`;
  }
  return base;
};
export const wsUrl = () => {
  const token = getAuthToken();
  const uid = getAuthUserId();
  const slug = getActiveRoomSlug();
  const base = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ws`;
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (uid) params.set("user_id", uid);
  if (slug) params.set("room", slug);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};

export function errMsg(e, fallback = "Something went wrong") {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return e?.message || fallback;
}

async function compressImageForUpload(file, { maxDim = 1600, quality = 0.82 } = {}) {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return file;
    if (!(file instanceof Blob)) return file;
    const type = String(file.type || "").toLowerCase();
    // Skip non-raster images (SVG, GIF animations), tiny images (<60 KB), or non-images
    if (!type.startsWith("image/") || type.includes("svg") || type.includes("gif") || file.size < 60 * 1024) {
      return file;
    }
    const bitmap = typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await new Promise((resolve, reject) => {
          const img = new Image();
          const objUrl = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(objUrl);
            resolve(img);
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(objUrl);
            reject(err);
          };
          img.src = objUrl;
        });

    const srcW = bitmap.width || 0;
    const srcH = bitmap.height || 0;
    if (!srcW || !srcH) {
      if (typeof bitmap.close === "function") bitmap.close();
      return file;
    }

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (typeof bitmap.close === "function") bitmap.close();
      return file;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    if (typeof bitmap.close === "function") bitmap.close();

    const preferredMime = "image/webp";
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), preferredMime, quality)
    );
    const finalBlob =
      blob && blob.type === preferredMime
        ? blob
        : await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b), type === "image/png" ? "image/png" : "image/jpeg", quality)
          );

    if (!finalBlob || finalBlob.size >= file.size * 0.95) {
      return file;
    }

    const ext = finalBlob.type === "image/webp" ? ".webp" : finalBlob.type === "image/jpeg" ? ".jpg" : ".png";
    const baseName = String(file.name || "image").replace(/\.[^.]+$/, "");
    return new File([finalBlob], `${baseName}${ext}`, {
      type: finalBlob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export async function uploadFile(file, opts = {}) {
  const prepared = opts?.skipCompress ? file : await compressImageForUpload(file, opts);
  const fd = new FormData();
  fd.append("file", prepared);
  const { data } = await api.post("/upload", fd);
  return data;
}

export async function downloadFrom(path, params, filename) {
  const res = await api.get(path, { params, responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return res;
}
