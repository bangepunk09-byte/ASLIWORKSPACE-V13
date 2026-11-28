// Multi-Room Isolation & Context Helpers for ASLIWORKSPACE SaaS

const ACTIVE_ROOM_STORAGE_KEY = "asli_active_room_slug";
const PLATFORM_OWNER_TOKEN_KEY = "asli_platform_owner_token";
const PLATFORM_OWNER_USER_KEY = "asli_platform_owner_user";
const DEFAULT_ROOM_SLUG = "asli-workspace";

let inMemoryRoomSlug = null;
let inMemoryOwnerToken = null;

export function getDefaultRoomSlug() {
  return DEFAULT_ROOM_SLUG;
}

export function slugifyWorkspaceName(raw) {
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

export function isValidRoomSlug(slug) {
  if (!slug || typeof slug !== "string") return false;
  return /^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug.trim());
}

export function extractRoomSlugFromPath(pathname) {
  if (!pathname || typeof pathname !== "string") return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "w" && parts[1]) {
    return slugifyWorkspaceName(parts[1]);
  }
  return null;
}

export function getActiveRoomSlug() {
  if (inMemoryRoomSlug) return inMemoryRoomSlug;
  if (typeof window !== "undefined") {
    const pathSlug = extractRoomSlugFromPath(window.location.pathname);
    if (pathSlug) {
      inMemoryRoomSlug = pathSlug;
      return pathSlug;
    }
    try {
      const tabVal = sessionStorage.getItem(ACTIVE_ROOM_STORAGE_KEY);
      if (tabVal) {
        inMemoryRoomSlug = tabVal;
        return tabVal;
      }
      const locVal = localStorage.getItem(ACTIVE_ROOM_STORAGE_KEY);
      if (locVal) {
        inMemoryRoomSlug = locVal;
        return locVal;
      }
    } catch {}
  }
  return DEFAULT_ROOM_SLUG;
}

export function setActiveRoomSlug(slug) {
  const clean = slugifyWorkspaceName(slug || DEFAULT_ROOM_SLUG);
  inMemoryRoomSlug = clean;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, clean);
      localStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, clean);
    } catch {}
  }
  return clean;
}

export function roomStorageKey(key, rid = getActiveRoomSlug()) {
  const cleanRid = slugifyWorkspaceName(rid || DEFAULT_ROOM_SLUG);
  const cleanKey = String(key || "cache").trim();
  if (cleanRid === DEFAULT_ROOM_SLUG) {
    return cleanKey;
  }
  return `asli_w_${cleanRid}__${cleanKey}`;
}

export function getPlatformOwnerToken() {
  if (inMemoryOwnerToken) return inMemoryOwnerToken;
  if (typeof window !== "undefined") {
    try {
      const tok = sessionStorage.getItem(PLATFORM_OWNER_TOKEN_KEY);
      if (tok) {
        inMemoryOwnerToken = tok;
        return tok;
      }
    } catch {}
  }
  return null;
}

export function setPlatformOwnerSession(token, ownerUser) {
  inMemoryOwnerToken = token || null;
  if (typeof window !== "undefined") {
    try {
      if (token) {
        sessionStorage.setItem(PLATFORM_OWNER_TOKEN_KEY, token);
        if (ownerUser) {
          sessionStorage.setItem(PLATFORM_OWNER_USER_KEY, JSON.stringify(ownerUser));
        }
      } else {
        sessionStorage.removeItem(PLATFORM_OWNER_TOKEN_KEY);
        sessionStorage.removeItem(PLATFORM_OWNER_USER_KEY);
      }
    } catch {}
  }
}

export function getPlatformOwnerCachedUser() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLATFORM_OWNER_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const RECENT_GOOGLE_ACCOUNTS_KEY = "asli_recent_google_accounts_v1";

export function getRecentGoogleAccounts() {
  if (typeof window === "undefined") return [];
  const byEmail = new Map();
  const addEntry = (item) => {
    const email = String(item?.email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) return;
    if (email.endsWith(".local")) return;
    const prev = byEmail.get(email) || {};
    byEmail.set(email, {
      email,
      name: String(item?.name || item?.displayName || prev.name || email.split("@")[0]).trim(),
      picture: String(item?.picture || item?.avatar || item?.photoURL || prev.picture || "").trim(),
      last_room_slug: item?.last_room_slug || prev.last_room_slug || "",
      last_used_at: item?.last_used_at || prev.last_used_at || new Date().toISOString(),
    });
  };

  try {
    const raw = localStorage.getItem(RECENT_GOOGLE_ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) parsed.forEach(addEntry);
    }
  } catch {}

  // Also inspect legacy single-room caches so previously signed-in Google accounts remain detectable
  try {
    const legacyGoogle = localStorage.getItem("circle_google_user");
    if (legacyGoogle) addEntry(JSON.parse(legacyGoogle));
  } catch {}
  try {
    const legacySess = localStorage.getItem("circle_session_cache");
    if (legacySess) {
      const parsed = JSON.parse(legacySess);
      if (parsed?.user?.email) {
        addEntry({ ...parsed.user, last_room_slug: parsed?.workspace?.slug || DEFAULT_ROOM_SLUG });
      }
    }
  } catch {}

  return Array.from(byEmail.values())
    .sort((a, b) => new Date(b.last_used_at || 0).getTime() - new Date(a.last_used_at || 0).getTime())
    .slice(0, 6);
}

export function recordRecentGoogleAccount(entry) {
  if (typeof window === "undefined") return;
  const email = String(entry?.email || "").toLowerCase().trim();
  if (!email || !email.includes("@") || email.endsWith(".local")) return;
  try {
    const current = getRecentGoogleAccounts().filter((a) => a.email !== email);
    const updated = [
      {
        email,
        name: String(entry?.name || entry?.displayName || email.split("@")[0]).trim(),
        picture: String(entry?.picture || entry?.avatar || entry?.photoURL || "").trim(),
        last_room_slug: entry?.last_room_slug || entry?.slug || getActiveRoomSlug(),
        last_used_at: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 6);
    localStorage.setItem(RECENT_GOOGLE_ACCOUNTS_KEY, JSON.stringify(updated));
  } catch {}
}

