// In-memory tracker + background prewarmer for avatars and workspace images
// so profile photos render in 0ms across menu transitions with zero flash.

const loadedUrls = new Set();
const failedUrls = new Set();
const inflightUrls = new Set();

export function isImageLoaded(url) {
  return Boolean(url && loadedUrls.has(url));
}

export function isImageFailed(url) {
  return Boolean(url && failedUrls.has(url));
}

export function markImageLoaded(url) {
  if (!url) return;
  failedUrls.delete(url);
  loadedUrls.add(url);
}

export function markImageFailed(url) {
  if (!url) return;
  failedUrls.add(url);
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

export function prewarmImage(url) {
  if (!url || typeof url !== "string") return Promise.resolve(false);
  if (url.startsWith("data:")) {
    loadedUrls.add(url);
    return Promise.resolve(true);
  }
  if (loadedUrls.has(url)) return Promise.resolve(true);
  if (failedUrls.has(url) || inflightUrls.has(url)) return Promise.resolve(false);
  if (typeof Image === "undefined") return Promise.resolve(false);

  inflightUrls.add(url);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const done = (ok) => {
      inflightUrls.delete(url);
      if (ok) {
        loadedUrls.add(url);
        failedUrls.delete(url);
      } else {
        failedUrls.add(url);
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

export function prewarmImages(urls, { concurrency = 6, maxCount = 60 } = {}) {
  if (shouldSkipPrewarm() || !Array.isArray(urls) || urls.length === 0) return;
  const queue = [];
  const seen = new Set();
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    const u = raw.trim();
    if (!u || seen.has(u) || loadedUrls.has(u) || failedUrls.has(u) || inflightUrls.has(u)) continue;
    seen.add(u);
    queue.push(u);
    if (queue.length >= maxCount) break;
  }
  if (queue.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const nextUrl = queue[cursor++];
      await prewarmImage(nextUrl);
    }
  };

  const workerCount = Math.min(concurrency, queue.length);
  for (let i = 0; i < workerCount; i += 1) {
    void worker();
  }
}
