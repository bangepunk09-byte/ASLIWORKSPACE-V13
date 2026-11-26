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

export function preloadRoute(path) {
  if (!path || typeof path !== "string") return;
  const normalized = path === "/" ? "/" : `/${path.split("/").filter(Boolean)[0] || ""}`;
  if (prefetched.has(normalized)) return;
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

let allRoutesPreloaded = false;
export function preloadAllRoutes() {
  if (allRoutesPreloaded) return;
  allRoutesPreloaded = true;
  const targets = [
    "/tasks",
    "/messages",
    "/beranda",
    "/schedule",
    "/groups",
    "/directory",
    "/employee",
    "/people",
    "/org",
    "/projects",
    "/marketplace",
    "/settings",
  ];
  const runBatch = (idx) => {
    if (idx >= targets.length) return;
    const end = Math.min(idx + 3, targets.length);
    for (let i = idx; i < end; i++) {
      preloadRoute(targets[i]);
    }
    if (end < targets.length) {
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => runBatch(end), { timeout: 600 });
      } else {
        setTimeout(() => runBatch(end), 80);
      }
    }
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => runBatch(0), { timeout: 300 });
  } else {
    setTimeout(() => runBatch(0), 60);
  }
}
