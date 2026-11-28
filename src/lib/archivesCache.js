import { api } from "./api";

const STORAGE_PREFIX = "circle_employee_archives_cache_v1_";
const MEM_CACHE = new Map();
const IN_FLIGHT = new Map();

function normalizeKey(uid) {
  return String(uid || "anon").trim() || "anon";
}

export function readArchivesCache(uid) {
  const key = normalizeKey(uid);
  if (MEM_CACHE.has(key)) return MEM_CACHE.get(key);
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      MEM_CACHE.set(key, parsed);
      return parsed;
    }
  } catch {}
  return null;
}

export function writeArchivesCache(uid, payload) {
  if (!payload || !Array.isArray(payload.items)) return;
  const key = normalizeKey(uid);
  const entry = {
    items: payload.items,
    divisions: Array.isArray(payload.divisions) ? payload.divisions : [],
    access: payload.access || null,
    updatedAt: Date.now(),
  };
  MEM_CACHE.set(key, entry);
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {}
}

export async function prefetchEmployeeArchives(uid, { force = false } = {}) {
  if (!uid) return null;
  const key = normalizeKey(uid);
  if (!force && IN_FLIGHT.has(key)) return IN_FLIGHT.get(key);
  const existing = MEM_CACHE.get(key);
  if (!force && existing && Date.now() - (existing.updatedAt || 0) < 12000) {
    return existing;
  }
  const req = api
    .get("/employee-archives", force ? { noCache: true } : undefined)
    .then((res) => {
      if (res?.data && Array.isArray(res.data.items)) {
        writeArchivesCache(uid, res.data);
        return readArchivesCache(uid);
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      IN_FLIGHT.delete(key);
    });
  IN_FLIGHT.set(key, req);
  return req;
}
