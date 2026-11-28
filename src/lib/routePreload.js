import { api } from "./api";

// Shared dynamic import loaders so React.lazy routes and hover-prefetching share identical chunks.
export const routeLoaders = {
  "/login": () => import("../pages/Login"),
  "/": () => import("../pages/Dashboard"),
  "/beranda": () => import("../pages/Beranda"),
  "/messages": () => import("../pages/Messages"),
  "/groups": () => import("../pages/Groups"),
  "/directory": () => import("../pages/Directory"),
  "/employee": () => import("../pages/Employees"),
  "/people": () => import("../pages/Profile"),
  "/org": () => import("../pages/Org"),
  "/tasks": () => import("../pages/Tasks"),
  "/schedule": () => import("../pages/Schedule"),
  "/projects": () => import("../pages/Projects"),
  "/marketplace": () => import("../pages/Marketplace"),
  "/settings": () => import("../pages/Settings"),
  "/onboarding": () => import("../pages/Onboarding"),
};

const prefetched = new Set();
const dataPrefetchTimestamps = new Map();

function normalizeRoutePath(path) {
  if (!path || typeof path !== "string") return "";
  return path === "/" ? "/" : `/${path.split("/").filter(Boolean)[0] || ""}`;
}

export function preloadRoute(path) {
  const normalized = normalizeRoutePath(path);
  if (!normalized || prefetched.has(normalized)) return;
  const loader = routeLoaders[normalized];
  if (!loader) return;
  prefetched.add(normalized);
  try {
    void loader().catch(() => {
      prefetched.delete(normalized);
    });
  } catch {
    prefetched.delete(normalized);
  }
}

// Warm the primary read-only API endpoint for a menu item on hover/touchstart
// so data is already in the short-TTL RAM cache by the time the click completes.
export function prefetchRouteData(path) {
  const normalized = normalizeRoutePath(path);
  if (!normalized) return;
  const now = Date.now();
  const lastAt = dataPrefetchTimestamps.get(normalized) || 0;
  if (now - lastAt < 8000) return;
  dataPrefetchTimestamps.set(normalized, now);

  const warm = (url, params) => {
    api.get(url, params ? { params } : undefined).catch(() => {});
  };

  switch (normalized) {
    case "/messages":
      warm("/conversations");
      break;
    case "/groups":
      warm("/groups/browse");
      break;
    case "/projects":
      warm("/projects");
      break;
    case "/schedule":
      warm("/meetings");
      break;
    case "/directory":
      warm("/drive-shortcuts");
      break;
    case "/beranda":
      warm("/posts");
      break;
    case "/tasks":
      warm("/boards");
      break;
    case "/marketplace":
      warm("/marketplace/state");
      break;
    case "/":
      warm("/meetings");
      warm("/boards");
      break;
    default:
      break;
  }
}

let allRoutesPreloaded = false;
export function preloadAllRoutes() {
  if (allRoutesPreloaded) return;
  allRoutesPreloaded = true;
  if (typeof navigator !== "undefined" && navigator.connection) {
    const conn = navigator.connection;
    if (conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") {
      return;
    }
  }
  // Gently warm all sidebar workspace chunks during idle time right after first paint
  // so every menu switch renders instantaneously without waiting for chunk downloads.
  const allTargets = [
    "/messages",
    "/tasks",
    "/beranda",
    "/",
    "/groups",
    "/schedule",
    "/employee",
    "/projects",
    "/directory",
    "/org",
    "/marketplace",
    "/settings",
    "/people",
  ];
  const runNext = (idx) => {
    if (idx >= allTargets.length) return;
    preloadRoute(allTargets[idx]);
    if (idx + 1 < allTargets.length) {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => runNext(idx + 1), { timeout: 1500 });
      } else {
        setTimeout(() => runNext(idx + 1), 220);
      }
    }
  };
  setTimeout(() => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => runNext(0), { timeout: 1500 });
    } else {
      runNext(0);
    }
  }, 600);
}
