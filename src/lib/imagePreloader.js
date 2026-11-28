// In-memory tracker + background prewarmer + smart URL optimizer for avatars
// so profile photos render in 0ms across Pesan, Employee, Beranda, and Tasks.

const loadedUrls = new Set();
const failedUrls = new Map(); // url -> failedAt timestamp (TTL so post-hydration retries succeed)
const inflightUrls = new Set();
const FAILED_TTL_MS = 15000;

/**
 * Optimizes external avatar URLs (Google Photos, Unsplash) to crisp thumbnail sizes
 * matching rendered avatar dimensions, cutting transfer size by 85-95%.
 * Keeps internal `/api/files/...` URLs 100% cache-stable.
 */
export function optimizeAvatarUrl(rawUrl, size = 48) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const url = rawUrl.trim();
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;

  const targetPx = size > 72 ? 256 : 128;

  // Google account photos: lh3.googleusercontent.com/...=s96-c or without size param
  if (/^https?:\/\/lh\d*\.googleusercontent\.com\//i.test(url)) {
    if (/=s\d+(-c)?(\?.*)?$/i.test(url)) {
      return url.replace(/=s\d+(-c)?(\?.*)?$/i, `=s${targetPx}-c`);
    }
    if (!url.includes("=")) {
      return `${url}=s${targetPx}-c`;
    }
    return url;
  }

  // Unsplash avatars: cap width & quality for fast download
  if (/^https?:\/\/images\.unsplash\.com\//i.test(url)) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("w", String(targetPx * 2));
      parsed.searchParams.set("q", "75");
      parsed.searchParams.set("auto", "format");
      parsed.searchParams.set("fit", "crop");
      return parsed.toString();
    } catch {
      return url;
    }
  }

  return url;
}

export function isImageLoaded(url) {
  return Boolean(url && loadedUrls.has(url));
}

export function isImageFailed(url) {
  if (!url) return false;
  const ts = failedUrls.get(url);
  if (!ts) return false;
  if (Date.now() - ts > FAILED_TTL_MS) {
    failedUrls.delete(url);
    return false;
  }
  return true;
}

export function markImageLoaded(url) {
  if (!url) return;
  failedUrls.delete(url);
  loadedUrls.add(url);
}

export function markImageFailed(url) {
  if (!url) return;
  failedUrls.set(url, Date.now());
}

export function clearFailedImages() {
  failedUrls.clear();
}

function shouldSkipPrewarm() {
  if (typeof window === "undefined" || typeof Image === "undefined") return true;
  if (typeof navigator !== "undefined" && navigator.connection) {
    const conn = navigator.connection;
    if (conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") {
      return true;
    }
  }
  return false;
}

export function prewarmImage(rawUrl, { highPriority = false } = {}) {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url) return Promise.resolve(false);
  if (url.startsWith("data:")) {
    loadedUrls.add(url);
    return Promise.resolve(true);
  }
  if (loadedUrls.has(url)) return Promise.resolve(true);
  if (isImageFailed(url) || inflightUrls.has(url)) return Promise.resolve(false);
  if (typeof Image === "undefined") return Promise.resolve(false);

  inflightUrls.add(url);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    if (highPriority && "fetchPriority" in img) {
      img.fetchPriority = "high";
    }
    const done = (ok) => {
      inflightUrls.delete(url);
      if (ok) {
        loadedUrls.add(url);
        failedUrls.delete(url);
      } else {
        failedUrls.set(url, Date.now());
      }
      resolve(ok);
    };
    img.onload = () => {
      if (typeof img.decode === "function") {
        img.decode().catch(() => {}).finally(() => done(true));
      } else {
        done(true);
      }
    };
    img.onerror = () => done(false);
    img.src = url;
  });
}

export function prewarmImages(urls, { concurrency = 10, maxCount = 120, optimizeAsAvatar = false } = {}) {
  if (shouldSkipPrewarm() || !Array.isArray(urls) || urls.length === 0) return;
  const queue = [];
  const seen = new Set();
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    const u = optimizeAsAvatar ? optimizeAvatarUrl(raw, 48) : raw.trim();
    if (!u || seen.has(u) || loadedUrls.has(u) || isImageFailed(u) || inflightUrls.has(u)) continue;
    seen.add(u);
    queue.push(u);
    if (queue.length >= maxCount) break;
  }
  if (queue.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const idx = cursor++;
      const nextUrl = queue[idx];
      await prewarmImage(nextUrl, { highPriority: idx < 16 });
    }
  };

  const workerCount = Math.min(concurrency, queue.length);
  for (let i = 0; i < workerCount; i += 1) {
    void worker();
  }
}
