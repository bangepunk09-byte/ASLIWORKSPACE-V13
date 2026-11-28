import { hasCompletedInitialHydrate } from "./persistentMirror";
import { getActiveRoomSlug, roomStorageKey } from "./roomContext";

// ---- Poll Cache ----
export const POLL_CACHE = {};

export function seedPollCache(poll) {
  if (poll && poll.id) {
    POLL_CACHE[poll.id] = poll;
  }
}

// ---- Chat / Conversations Cache ----
export const CHAT_CACHE = {};

const pendingStorageWrites = new Map();
const lastWrittenStorageValues = new Map();
let storageFlushTimer = null;

function flushPendingStorageWrites() {
  storageFlushTimer = null;
  if (typeof localStorage === "undefined") {
    pendingStorageWrites.clear();
    return;
  }
  pendingStorageWrites.forEach((value, key) => {
    try {
      if (value === null) {
        lastWrittenStorageValues.delete(key);
        localStorage.removeItem(key);
      } else if (lastWrittenStorageValues.get(key) !== value) {
        localStorage.setItem(key, value);
        lastWrittenStorageValues.set(key, value);
      }
    } catch {}
  });
  pendingStorageWrites.clear();
}

export function cancelScheduledStorageWrite(key) {
  if (!key) return;
  pendingStorageWrites.delete(key);
}

export function scheduleStorageWrite(key, serializedValue) {
  if (!key) return;
  if (serializedValue !== null && lastWrittenStorageValues.get(key) === serializedValue && !pendingStorageWrites.has(key)) {
    return;
  }
  pendingStorageWrites.set(key, serializedValue);
  if (!storageFlushTimer) {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      storageFlushTimer = window.requestIdleCallback(flushPendingStorageWrites, { timeout: 250 });
    } else {
      storageFlushTimer = setTimeout(flushPendingStorageWrites, 64);
    }
  }
}

export function scheduleJsonStorageWrite(key, data) {
  if (!key) return;
  try {
    scheduleStorageWrite(key, data === null ? null : JSON.stringify(data));
  } catch {}
}

function stripMessagesFromConv(conv) {
  if (!conv || typeof conv !== "object") return conv;
  if (!("messages" in conv)) return conv;
  const { messages: _omitted, ...rest } = conv;
  return rest;
}

export function saveConversationListCache(convs, userId) {
  if (!Array.isArray(convs)) return;
  if (convs.length === 0 && !hasCompletedInitialHydrate()) return;
  const slim = convs.map(stripMessagesFromConv);
  const rid = getActiveRoomSlug();
  CHAT_CACHE[userId ? `__convs_list_${rid}_${userId}` : `__convs_list_${rid}`] = slim;
  try {
    const serialized = JSON.stringify(slim);
    if (userId) scheduleStorageWrite(roomStorageKey(`circle_convs_cache_${userId}`, rid), serialized);
    scheduleStorageWrite(roomStorageKey("circle_convs_cache", rid), serialized);
  } catch {}
}

export function getCachedConversationList(userId) {
  const rid = getActiveRoomSlug();
  const memKey = userId ? `__convs_list_${rid}_${userId}` : `__convs_list_${rid}`;
  if (Array.isArray(CHAT_CACHE[memKey])) return CHAT_CACHE[memKey];
  try {
    const saved =
      (userId && localStorage.getItem(roomStorageKey(`circle_convs_cache_${userId}`, rid))) ||
      localStorage.getItem(roomStorageKey("circle_convs_cache", rid));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        CHAT_CACHE[memKey] = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function getLastConvsHydratedAt(userId) {
  const rid = getActiveRoomSlug();
  return CHAT_CACHE[userId ? `__convs_hydrated_at_${rid}_${userId}` : `__convs_hydrated_at_${rid}`] || 0;
}

export function clearChatCache() {
  Object.keys(CHAT_CACHE).forEach((k) => delete CHAT_CACHE[k]);
  pendingStorageWrites.clear();
  lastWrittenStorageValues.clear();
  postsCache = DEFAULT_POSTS;
  trendingCache = [];
  groupsCache = [];
}

export function getInitialMsgs(cid) {
  if (!cid) return [];
  const rid = getActiveRoomSlug();
  const memKey = `msgs_${rid}_${cid}`;
  if (CHAT_CACHE[memKey]) return CHAT_CACHE[memKey];
  try {
    const saved = localStorage.getItem(roomStorageKey(`circle_msgs_cache_${cid}`, rid));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        CHAT_CACHE[memKey] = parsed;
        return parsed;
      }
    }
    const savedConvs = localStorage.getItem(roomStorageKey("circle_convs_cache", rid));
    if (savedConvs) {
      const arr = JSON.parse(savedConvs);
      const found = Array.isArray(arr) ? arr.find((x) => x && x.id === cid) : null;
      if (found && Array.isArray(found.messages)) {
        CHAT_CACHE[memKey] = found.messages;
        return found.messages;
      }
    }
  } catch {}
  return [];
}

export function hydrateConversationsCache(convs, userId) {
  if (!Array.isArray(convs)) return;
  const rid = getActiveRoomSlug();
  CHAT_CACHE[userId ? `__convs_hydrated_at_${rid}_${userId}` : `__convs_hydrated_at_${rid}`] = Date.now();
  convs.forEach((c) => {
    if (!c || !c.id) return;
    CHAT_CACHE[`conv_${rid}_${c.id}`] = stripMessagesFromConv(c);
    if (Array.isArray(c.messages)) {
      if (c.messages.length === 0 && !hasCompletedInitialHydrate()) {
        const existing = getInitialMsgs(c.id);
        if (existing.length > 0) return;
      }
      CHAT_CACHE[`msgs_${rid}_${c.id}`] = c.messages;
      try {
        scheduleStorageWrite(roomStorageKey(`circle_msgs_cache_${c.id}`, rid), JSON.stringify(c.messages));
      } catch {}
    }
  });
  saveConversationListCache(convs, userId);
}

export function upsertConversationInCache(conv, userId) {
  if (!conv || !conv.id) return;
  const rid = getActiveRoomSlug();
  const slimConv = stripMessagesFromConv(conv);
  const merged = { ...(CHAT_CACHE[`conv_${rid}_${conv.id}`] || {}), ...slimConv };
  CHAT_CACHE[`conv_${rid}_${conv.id}`] = merged;
  if (Array.isArray(conv.messages) && conv.messages.length > 0) {
    CHAT_CACHE[`msgs_${rid}_${conv.id}`] = conv.messages;
    try {
      scheduleStorageWrite(roomStorageKey(`circle_msgs_cache_${conv.id}`, rid), JSON.stringify(conv.messages));
    } catch {}
  }
  try {
    const key = roomStorageKey(userId ? `circle_convs_cache_${userId}` : "circle_convs_cache", rid);
    const fallbackKey = roomStorageKey("circle_convs_cache", rid);
    const raw = pendingStorageWrites.get(key) || localStorage.getItem(key) || localStorage.getItem(fallbackKey);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      const idx = list.findIndex((c) => c && c.id === conv.id);
      const next = idx !== -1
        ? list.map((c, i) => (i === idx ? stripMessagesFromConv({ ...c, ...merged }) : stripMessagesFromConv(c)))
        : [merged, ...list.map(stripMessagesFromConv)];
      const serialized = JSON.stringify(next);
      if (userId) scheduleStorageWrite(roomStorageKey(`circle_convs_cache_${userId}`, rid), serialized);
      scheduleStorageWrite(fallbackKey, serialized);
    }
  } catch {}
}

export function removeConversationFromCache(convId, userId) {
  if (!convId) return;
  const rid = getActiveRoomSlug();
  delete CHAT_CACHE[`conv_${rid}_${convId}`];
  delete CHAT_CACHE[`msgs_${rid}_${convId}`];
  try {
    const msgsKey = roomStorageKey(`circle_msgs_cache_${convId}`, rid);
    scheduleStorageWrite(msgsKey, null);
    localStorage.removeItem(msgsKey);
    const keys = [
      userId ? roomStorageKey(`circle_convs_cache_${userId}`, rid) : null,
      roomStorageKey("circle_convs_cache", rid),
    ].filter(Boolean);
    keys.forEach((key) => {
      const raw = pendingStorageWrites.get(key) || localStorage.getItem(key);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const next = list.filter((c) => c && c.id !== convId);
        const serialized = JSON.stringify(next);
        localStorage.setItem(key, serialized);
        pendingStorageWrites.delete(key);
      }
    });
  } catch {}
}

export function clearConversationMessagesCache(convId, userId) {
  if (!convId) return;
  const rid = getActiveRoomSlug();
  CHAT_CACHE[`msgs_${rid}_${convId}`] = [];
  if (CHAT_CACHE[`conv_${rid}_${convId}`]) {
    CHAT_CACHE[`conv_${rid}_${convId}`] = {
      ...CHAT_CACHE[`conv_${rid}_${convId}`],
      last_message_preview: "",
      unread: 0,
    };
  }
  try {
    const msgsKey = roomStorageKey(`circle_msgs_cache_${convId}`, rid);
    localStorage.setItem(msgsKey, "[]");
    pendingStorageWrites.delete(msgsKey);
    const keys = [
      userId ? roomStorageKey(`circle_convs_cache_${userId}`, rid) : null,
      roomStorageKey("circle_convs_cache", rid),
    ].filter(Boolean);
    keys.forEach((key) => {
      const raw = pendingStorageWrites.get(key) || localStorage.getItem(key);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const next = list.map((c) =>
          c && c.id === convId
            ? { ...stripMessagesFromConv(c), last_message_preview: "", unread: 0 }
            : stripMessagesFromConv(c)
        );
        localStorage.setItem(key, JSON.stringify(next));
        pendingStorageWrites.delete(key);
      }
    });
  } catch {}
}

export function appendMessageToCache(msg) {
  if (!msg || !msg.conversation_id) return;
  const rid = getActiveRoomSlug();
  const cid = msg.conversation_id;
  const existing = getInitialMsgs(cid);
  const idx = existing.findIndex((m) => m.id === msg.id);
  const next = idx !== -1
    ? existing.map((m, i) => (i === idx ? msg : m))
    : [...existing, msg];
  CHAT_CACHE[`msgs_${rid}_${cid}`] = next;
  try {
    scheduleStorageWrite(roomStorageKey(`circle_msgs_cache_${cid}`, rid), JSON.stringify(next));
  } catch {}
}

export function updateMessageInCache(msg) {
  if (!msg || !msg.conversation_id) return;
  const rid = getActiveRoomSlug();
  const cid = msg.conversation_id;
  const existing = getInitialMsgs(cid);
  const next = existing.map((m) => (m.id === msg.id ? msg : m));
  CHAT_CACHE[`msgs_${rid}_${cid}`] = next;
  try {
    scheduleStorageWrite(roomStorageKey(`circle_msgs_cache_${cid}`, rid), JSON.stringify(next));
  } catch {}
}

// ---- Posts / Beranda Feed Cache ----
const DEFAULT_POSTS = [
  {
    id: "pst_init_1",
    author_id: "user_admin1",
    topic: null,
    text: "Selamat datang di workspace internal ASLIWORKSPACE! 🎉 Silakan gunakan Beranda ini untuk update info, obrolan santai, atau diskusi lintas divisi.",
    attachments: [],
    likes: [],
    like_count: 0,
    liked: false,
    reactions: { "👍": ["user_admin1"] },
    reply_count: 0,
    replies_preview: [],
    created_at: new Date(Date.now() - 3600000 * 24).toISOString()
  }
];

let trendingCache = [];
try {
  localStorage.removeItem(roomStorageKey("circle_cache_trending"));
} catch {}

let postsCache = DEFAULT_POSTS;
try {
  const saved = localStorage.getItem(roomStorageKey("circle_cache_posts_feed"));
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) postsCache = parsed;
  }
} catch {}

export function getPostsCache() {
  return postsCache;
}

export function setPostsCache(next) {
  if (Array.isArray(next)) postsCache = next;
  return postsCache;
}

export function getTrendingCache() {
  return trendingCache;
}

export function setTrendingCache(next) {
  if (Array.isArray(next)) trendingCache = next;
  return trendingCache;
}

export function hydratePostsCache(posts, trending) {
  const rid = getActiveRoomSlug();
  if (Array.isArray(posts)) {
    postsCache = posts;
    posts.forEach((p) => {
      if (p?.poll) seedPollCache(p.poll);
    });
    scheduleJsonStorageWrite(roomStorageKey("circle_cache_posts_feed", rid), posts);
  }
  if (Array.isArray(trending)) {
    trendingCache = trending;
    scheduleJsonStorageWrite(roomStorageKey("circle_cache_trending", rid), trending);
  }
}

// ---- Groups Cache ----
let groupsCache = [];

function getGroupsCacheKey(userId, rid = getActiveRoomSlug()) {
  return roomStorageKey(userId ? `circle_groups_cache_${userId}` : "circle_groups_cache", rid);
}

export function getGroupsCache() {
  return groupsCache;
}

export function setGroupsCache(next) {
  if (Array.isArray(next)) groupsCache = next;
  return groupsCache;
}

export function readGroupsCacheForUser(userId) {
  try {
    const saved = localStorage.getItem(getGroupsCacheKey(userId));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((g) => {
          if (!g || !g.id) return false;
          const mems = Array.isArray(g.member_ids) ? g.member_ids : [];
          const isMem = userId ? mems.includes(userId) : Boolean(g.is_member);
          return isMem || Boolean(g.has_invitation);
        });
      }
    }
  } catch {}
  return [];
}

export function hydrateGroupsCache(arr, userId) {
  if (!Array.isArray(arr)) return;
  const filtered = arr.filter((g) => g && g.id && (g.is_member || g.has_invitation));
  groupsCache = filtered;
  scheduleJsonStorageWrite(getGroupsCacheKey(userId), filtered);
}

export function upsertGroupInCache(group, userId) {
  if (!group || !group.id) return groupsCache;
  const mems = Array.isArray(group.member_ids) ? group.member_ids : null;
  const isMember = mems && userId ? mems.includes(userId) : Boolean(group.is_member);
  const hasInvite = Boolean(group.has_invitation);
  let next;
  if (!isMember && !hasInvite) {
    next = groupsCache.filter((g) => g.id !== group.id);
  } else {
    const idx = groupsCache.findIndex((g) => g.id === group.id);
    next = idx !== -1
      ? groupsCache.map((g, i) => (i === idx ? { ...g, ...group, is_member: isMember } : g))
      : [{ ...group, is_member: isMember }, ...groupsCache];
  }
  groupsCache = next;
  scheduleJsonStorageWrite(getGroupsCacheKey(userId), next);
  return next;
}

export function removeGroupFromCache(groupId, userId) {
  if (!groupId) return groupsCache;
  const rid = getActiveRoomSlug();
  const next = groupsCache.filter((g) => g && g.id !== groupId);
  groupsCache = next;
  try {
    const keys = [getGroupsCacheKey(userId, rid), roomStorageKey("circle_groups_cache", rid)];
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        localStorage.setItem(key, JSON.stringify(parsed.filter((g) => g && g.id !== groupId)));
      }
    });
  } catch {}
  return next;
}
