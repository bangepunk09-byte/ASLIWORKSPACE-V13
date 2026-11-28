import { api, errMsg } from "./api";

const AUTO_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
const lastAutoSyncByUser = new Map();

function mapGeolocationError(err) {
  if (!err) return "Gagal mendeteksi lokasi saat ini.";
  if (err.code === 1) {
    return "Izin lokasi ditolak browser. Aktifkan izin lokasi di pengaturan browser untuk melacak posisi Anda.";
  }
  if (err.code === 2) {
    return "Lokasi perangkat tidak dapat dideteksi saat ini. Pastikan GPS atau layanan lokasi aktif.";
  }
  if (err.code === 3) {
    return "Waktu pencarian lokasi habis. Silakan coba lagi.";
  }
  return err.message || "Gagal mendeteksi lokasi saat ini.";
}

function getCurrentBrowserPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Browser tidak mendukung pelacakan lokasi GPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => reject(new Error(mapGeolocationError(err))),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
        ...options,
      }
    );
  });
}

export async function detectAndSyncLiveLocation(options = {}) {
  const pos = await getCurrentBrowserPosition(options);
  const lat = pos?.coords?.latitude;
  const lng = pos?.coords?.longitude;
  const accuracy = pos?.coords?.accuracy;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Koordinat lokasi tidak valid.");
  }
  try {
    const { data } = await api.post("/users/me/live-location", {
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    });
    return data;
  } catch (e) {
    throw new Error(errMsg(e, "Gagal menyimpan lokasi ke server."));
  }
}

export async function trackUserLiveLocation(userId) {
  if (!userId) throw new Error("Pengguna tidak ditemukan.");
  try {
    const { data } = await api.post(`/users/${encodeURIComponent(userId)}/track-location`);
    return data;
  } catch (e) {
    throw new Error(errMsg(e, "Gagal melacak lokasi pengguna."));
  }
}

export async function autoSyncLocationIfGranted(user, { force = false } = {}) {
  const uid = user?.user_id;
  if (!uid || user?.share_location === false) return null;
  if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions?.query) {
    return null;
  }
  const now = Date.now();
  const lastAt = lastAutoSyncByUser.get(uid) || 0;
  if (!force && now - lastAt < AUTO_SYNC_MIN_INTERVAL_MS) {
    return null;
  }
  try {
    const perm = await navigator.permissions.query({ name: "geolocation" });
    if (perm?.state !== "granted") return null;
    lastAutoSyncByUser.set(uid, now);
    return await detectAndSyncLiveLocation({
      enableHighAccuracy: Boolean(force),
      timeout: 8000,
      maximumAge: force ? 0 : 120000,
    });
  } catch {
    return null;
  }
}

export function resolveRadiusMeters(liveLocation) {
  if (!liveLocation) return null;
  const raw = Number(liveLocation.radius_meters ?? liveLocation.accuracy);
  if (!Number.isFinite(raw) || raw <= 0) return 50;
  return Math.max(10, Math.round(raw));
}

export function formatRadiusMeters(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n <= 0) return "radius ±50 m";
  if (n >= 1000) {
    const km = (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",");
    return `radius ±${km} km`;
  }
  return `radius ±${Math.round(n)} m`;
}

export function formatDistanceMeters(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return `${Math.round(n)} m dari Anda`;
  const km = (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",");
  return `${km} km dari Anda`;
}

export function formatLocationTimeAgo(iso) {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  try {
    return new Date(ts).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
