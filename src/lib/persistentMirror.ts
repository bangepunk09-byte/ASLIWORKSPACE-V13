import {
  firebaseAuth,
  getQuotaPauseUntilTimestamp,
  isFirestoreQuotaPaused,
  loadLiveSyncFromFirestore,
  saveLiveSyncToFirestore,
  syncServerQuotaPauseUntil,
} from './firestoreBackup';
import {
  getItemId,
  hasMeaningfulWorkspaceData,
  mergeItemsById,
  mergeTasksArrayNonDestructive,
  mergeTwoSnapshotsNonDestructive,
} from './snapshotMerge';

const IDB_NAME = 'circle_persistent_mirror_v1';
const IDB_STORE = 'snapshots';
const MIRROR_KEY = 'latest_workspace_mirror';
const RICHEST_MIRROR_KEY = 'richest_workspace_mirror';
const VAULT_STORAGE_KEY = 'circle_account_vault_v1';
const DELETED_TASK_IDS_KEY = 'circle_deleted_task_ids_v1';
const DELETED_CP_TEMPLATE_IDS_KEY = 'circle_deleted_cp_template_ids_v1';
const DELETED_ENTITY_IDS_KEY = 'circle_deleted_entity_ids_v1';

export interface PersistentMirrorEnvelope {
  snapshot: any;
  snapshot_sig?: string;
  revision: number;
  last_mutated_at?: string;
  saved_at: string;
}

export interface VaultAccountRecord {
  user_id: string;
  email: string;
  name: string;
  role?: string;
  job_title?: string;
  department?: string;
  org_unit_id?: string | null;
  status?: string;
  avatar?: string;
  picture?: string;
  phone?: string;
  employee_id?: string;
  employment_status?: string;
  join_date?: string;
  bio?: string;
  skills?: string[];
  work_mode?: string;
  custom_location?: string;
  city?: string;
  office?: string;
  location_status?: string;
  share_location?: boolean;
  timezone?: string;
  team?: string;
  division?: string;
  manager_id?: string | null;
  cover_bg?: string;
  cover_image?: string;
  cover_position?: string;
  is_verified?: boolean;
  verified_at?: string | null;
  profile_completion?: number;
  onboarded?: boolean;
  onboarding_completed?: boolean;
  auth_provider?: string;
  firebase_uid?: string;
  custom?: Record<string, any>;
  custom_fields?: Record<string, any>;
  nickname?: string;
  company?: string;
  password_hash?: string;
  password_updated_at?: string;
  token_version?: number;
  updated_at?: string;
}

const VAULT_PROFILE_KEYS = [
  'phone',
  'employee_id',
  'employment_status',
  'join_date',
  'bio',
  'skills',
  'work_mode',
  'custom_location',
  'city',
  'office',
  'location_status',
  'share_location',
  'timezone',
  'team',
  'division',
  'manager_id',
  'cover_bg',
  'cover_image',
  'cover_position',
  'is_verified',
  'verified_at',
  'profile_completion',
  'onboarded',
  'onboarding_completed',
  'auth_provider',
  'firebase_uid',
  'custom',
  'custom_fields',
  'nickname',
  'company',
] as const;

let vaultMemoryCache: VaultAccountRecord[] | null = null;
let vaultWriteTimer: ReturnType<typeof setTimeout> | null = null;

function readVaultRaw(): VaultAccountRecord[] {
  if (vaultMemoryCache !== null) return vaultMemoryCache;
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) {
      vaultMemoryCache = [];
      return vaultMemoryCache;
    }
    const parsed = JSON.parse(raw);
    vaultMemoryCache = Array.isArray(parsed) ? parsed.filter((u) => u && u.email && u.user_id) : [];
    return vaultMemoryCache;
  } catch {
    vaultMemoryCache = [];
    return vaultMemoryCache;
  }
}

function scheduleVaultFlush() {
  if (vaultWriteTimer) return;
  vaultWriteTimer = setTimeout(() => {
    vaultWriteTimer = null;
    try {
      if (vaultMemoryCache) {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vaultMemoryCache));
      }
    } catch {}
  }, 40);
}

export function getKnownAccountsFromVault(): VaultAccountRecord[] {
  return [...readVaultRaw()];
}

export function pruneDeletedAccountsFromVault(
  deletedIds: string[] = [],
  deletedEmails: string[] = []
): void {
  try {
    const idSet = new Set(
      (Array.isArray(deletedIds) ? deletedIds : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    );
    const emailSet = new Set(
      (Array.isArray(deletedEmails) ? deletedEmails : [])
        .map((x) => String(x || '').toLowerCase().trim())
        .filter(Boolean)
    );
    if (idSet.size === 0 && emailSet.size === 0) return;
    const list = readVaultRaw();
    const filtered = list.filter((u) => {
      const uid = String(u?.user_id || '').trim();
      const email = String(u?.email || '').toLowerCase().trim();
      return !idSet.has(uid) && !emailSet.has(email);
    });
    if (filtered.length !== list.length) {
      vaultMemoryCache = filtered;
      if (vaultWriteTimer) {
        clearTimeout(vaultWriteTimer);
        vaultWriteTimer = null;
      }
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {}
}

export function getLocalDeletedTaskIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_TASK_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function recordDeletedTaskIds(ids: string[] = []): void {
  const cleanIds = (Array.isArray(ids) ? ids : [ids])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (cleanIds.length === 0) return;

  const existing = getLocalDeletedTaskIds();
  const merged = Array.from(new Set([...existing, ...cleanIds]));
  const delSet = new Set(merged);

  try {
    localStorage.setItem(DELETED_TASK_IDS_KEY, JSON.stringify(merged));
    for (const cacheKey of ['circle_tasks_cache', 'circle_cache_tasks']) {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) continue;
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const next = list.filter((t) => !delSet.has(getItemId(t, 'task_id')));
        if (next.length !== list.length) {
          localStorage.setItem(cacheKey, JSON.stringify(next));
        }
      }
    }
  } catch {}

  if (cachedBootHarvest && Array.isArray(cachedBootHarvest.tasks)) {
    cachedBootHarvest.tasks = cachedBootHarvest.tasks.filter(
      (t) => !delSet.has(getItemId(t, 'task_id'))
    );
  }

  // Also purge deleted tasks from IndexedDB mirror snapshots immediately
  void (async () => {
    try {
      const db = await openMirrorDb();
      if (!db) return;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const key of [MIRROR_KEY, RICHEST_MIRROR_KEY]) {
        const req = store.get(key);
        req.onsuccess = () => {
          const env = req.result as PersistentMirrorEnvelope | undefined;
          if (!env?.snapshot) return;
          const root =
            env.snapshot.data && typeof env.snapshot.data === 'object'
              ? env.snapshot.data
              : env.snapshot;
          const prevDel = Array.isArray(root.deleted_task_ids) ? root.deleted_task_ids : [];
          root.deleted_task_ids = Array.from(new Set([...prevDel, ...merged]));
          if (Array.isArray(root.tasks)) {
            root.tasks = root.tasks.filter((t: any) => !delSet.has(getItemId(t, 'task_id')));
          }
          store.put(env, key);
        };
      }
    } catch {}
  })();
}

export function getLocalDeletedCheckpointTemplateIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_CP_TEMPLATE_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function recordDeletedCheckpointTemplateIds(ids: string[] = []): void {
  const cleanIds = (Array.isArray(ids) ? ids : [ids])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (cleanIds.length === 0) return;

  const existing = getLocalDeletedCheckpointTemplateIds();
  const merged = Array.from(new Set([...existing, ...cleanIds]));
  const delSet = new Set(merged);

  try {
    localStorage.setItem(DELETED_CP_TEMPLATE_IDS_KEY, JSON.stringify(merged));
    const raw = localStorage.getItem('circle_checkpoint_templates');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const next = list.filter((t) => !delSet.has(getItemId(t)));
        if (next.length !== list.length) {
          localStorage.setItem('circle_checkpoint_templates', JSON.stringify(next));
        }
      }
    }
  } catch {}

  if (cachedBootHarvest && Array.isArray(cachedBootHarvest.templates)) {
    cachedBootHarvest.templates = cachedBootHarvest.templates.filter(
      (t) => !delSet.has(getItemId(t))
    );
  }

  void (async () => {
    try {
      const db = await openMirrorDb();
      if (!db) return;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const key of [MIRROR_KEY, RICHEST_MIRROR_KEY]) {
        const req = store.get(key);
        req.onsuccess = () => {
          const env = req.result as PersistentMirrorEnvelope | undefined;
          if (!env?.snapshot) return;
          const root =
            env.snapshot.data && typeof env.snapshot.data === 'object'
              ? env.snapshot.data
              : env.snapshot;
          const prevDel = [
            ...(Array.isArray(root.deleted_checkpoint_template_ids)
              ? root.deleted_checkpoint_template_ids
              : []),
            ...(Array.isArray(root.workspace?.deleted_checkpoint_template_ids)
              ? root.workspace.deleted_checkpoint_template_ids
              : []),
          ];
          const nextDel = Array.from(new Set([...prevDel, ...merged]));
          root.deleted_checkpoint_template_ids = nextDel;
          if (root.workspace && typeof root.workspace === 'object') {
            root.workspace.deleted_checkpoint_template_ids = nextDel;
            if (Array.isArray(root.workspace.checkpoint_templates)) {
              root.workspace.checkpoint_templates = root.workspace.checkpoint_templates.filter(
                (t: any) => !delSet.has(getItemId(t))
              );
            }
          }
          store.put(env, key);
        };
      }
    } catch {}
  })();
}

export function getLocalDeletedEntityIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_ENTITY_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function recordDeletedEntityIds(ids: string[] = []): void {
  const cleanIds = (Array.isArray(ids) ? ids : [ids])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (cleanIds.length === 0) return;

  const existing = getLocalDeletedEntityIds();
  const merged = Array.from(new Set([...existing, ...cleanIds]));
  const delSet = new Set(merged);

  const isDeletedObj = (item: any, altIdKey?: string): boolean => {
    const id = getItemId(item, altIdKey);
    if (id && delSet.has(id)) return true;
    if (item?.gcal_id && delSet.has(String(item.gcal_id).trim())) return true;
    return false;
  };

  try {
    localStorage.setItem(DELETED_ENTITY_IDS_KEY, JSON.stringify(merged));
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('circle_notes_cache_') ||
        key.startsWith('circle_sticky_notes_') ||
        key === 'circle_boards_cache' ||
        key.startsWith('circle_meetings_cache') ||
        key.startsWith('circle_cache_meetings') ||
        key.startsWith('circle_cache_posts') ||
        key.startsWith('circle_user_feed_history_') ||
        key.startsWith('circle_msgs_cache_') ||
        key.startsWith('circle_convs_cache') ||
        key.startsWith('circle_groups_cache') ||
        key === 'circle_drive_shortcuts_cache' ||
        key === 'circle_projects_cache' ||
        key === 'circle_org_units_cache'
      ) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const next = parsed.filter(
            (item) =>
              !isDeletedObj(item, 'note_id') &&
              !isDeletedObj(item, 'board_id') &&
              !isDeletedObj(item, 'post_id') &&
              !isDeletedObj(item, 'task_id')
          );
          if (next.length !== parsed.length) {
            localStorage.setItem(key, JSON.stringify(next));
          }
        } else if (parsed && Array.isArray(parsed.posts)) {
          const nextPosts = parsed.posts.filter((p: any) => !isDeletedObj(p, 'post_id'));
          if (nextPosts.length !== parsed.posts.length) {
            localStorage.setItem(key, JSON.stringify({ ...parsed, posts: nextPosts }));
          }
        }
      }
    }
  } catch {}

  if (cachedBootHarvest) {
    cachedBootHarvest.notes = (cachedBootHarvest.notes || []).filter(
      (n) => !isDeletedObj(n, 'note_id')
    );
    cachedBootHarvest.boards = (cachedBootHarvest.boards || []).filter(
      (b) => !isDeletedObj(b, 'board_id')
    );
    cachedBootHarvest.meetings = (cachedBootHarvest.meetings || []).filter(
      (m) => !isDeletedObj(m)
    );
    cachedBootHarvest.posts = (cachedBootHarvest.posts || []).filter(
      (p) => !isDeletedObj(p, 'post_id')
    );
    cachedBootHarvest.messages = (cachedBootHarvest.messages || []).filter(
      (m) => !isDeletedObj(m)
    );
    cachedBootHarvest.conversations = (cachedBootHarvest.conversations || []).filter(
      (c) => !isDeletedObj(c)
    );
    cachedBootHarvest.groups = (cachedBootHarvest.groups || []).filter(
      (g) => !isDeletedObj(g)
    );
    cachedBootHarvest.projects = (cachedBootHarvest.projects || []).filter(
      (p) => !isDeletedObj(p)
    );
    cachedBootHarvest.org_units = (cachedBootHarvest.org_units || []).filter(
      (o) => !isDeletedObj(o)
    );
    cachedBootHarvest.drive_shortcuts = (cachedBootHarvest.drive_shortcuts || []).filter(
      (d) => !isDeletedObj(d)
    );
  }

  void (async () => {
    try {
      const db = await openMirrorDb();
      if (!db) return;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const key of [MIRROR_KEY, RICHEST_MIRROR_KEY]) {
        const req = store.get(key);
        req.onsuccess = () => {
          const env = req.result as PersistentMirrorEnvelope | undefined;
          if (!env?.snapshot) return;
          const root =
            env.snapshot.data && typeof env.snapshot.data === 'object'
              ? env.snapshot.data
              : env.snapshot;
          const prevDel = Array.isArray(root.deleted_entity_ids) ? root.deleted_entity_ids : [];
          root.deleted_entity_ids = Array.from(new Set([...prevDel, ...merged]));
          const prevNoteDel = Array.isArray(root.deleted_note_ids) ? root.deleted_note_ids : [];
          root.deleted_note_ids = Array.from(new Set([...prevNoteDel, ...merged]));
          if (Array.isArray(root.circle_notes)) {
            root.circle_notes = root.circle_notes.filter((n: any) => !isDeletedObj(n, 'note_id'));
          }
          if (Array.isArray(root.boards)) {
            root.boards = root.boards.filter((b: any) => !isDeletedObj(b, 'board_id'));
          }
          if (Array.isArray(root.meetings)) {
            root.meetings = root.meetings.filter((m: any) => !isDeletedObj(m));
          }
          if (Array.isArray(root.posts)) {
            root.posts = root.posts.filter((p: any) => !isDeletedObj(p, 'post_id'));
          }
          if (Array.isArray(root.messages)) {
            root.messages = root.messages.filter((m: any) => !isDeletedObj(m));
          }
          if (Array.isArray(root.conversations)) {
            root.conversations = root.conversations.filter((c: any) => !isDeletedObj(c));
          }
          if (Array.isArray(root.groups)) {
            root.groups = root.groups.filter((g: any) => !isDeletedObj(g));
          }
          if (Array.isArray(root.projects)) {
            root.projects = root.projects.filter((p: any) => !isDeletedObj(p));
          }
          if (Array.isArray(root.org_units)) {
            root.org_units = root.org_units.filter((o: any) => !isDeletedObj(o));
          }
          if (Array.isArray(root.drive_shortcuts)) {
            root.drive_shortcuts = root.drive_shortcuts.filter((d: any) => !isDeletedObj(d));
          }
          if (root.workspace && Array.isArray(root.workspace.instagram_accounts)) {
            root.workspace.instagram_accounts = root.workspace.instagram_accounts.filter(
              (acc: any) => !isDeletedObj(acc)
            );
          }
          store.put(env, key);
        };
      }
    } catch {}
  })();
}

function mergeAccountIntoVaultList(list: VaultAccountRecord[], account: any): boolean {
  if (!account || typeof account !== 'object' || !account.email || !account.user_id) return false;
  if (
    account.is_bot ||
    account.role === 'assistant' ||
    account.user_id === 'user_circle_assistant'
  ) {
    return false;
  }
  const cleanEmail = String(account.email).toLowerCase().trim();
  const idx = list.findIndex(
    (u) =>
      u.user_id === account.user_id ||
      String(u.email || '').toLowerCase().trim() === cleanEmail
  );
  const prev: Partial<VaultAccountRecord> = idx >= 0 ? list[idx] : {};
  const merged: VaultAccountRecord = {
    ...prev,
    user_id: account.user_id || prev.user_id!,
    email: cleanEmail,
    name: account.name || prev.name || cleanEmail.split('@')[0],
    role: account.role || prev.role || 'employee',
    job_title:
      account.job_title !== undefined
        ? account.job_title
        : prev.job_title || 'Staff Member',
    department:
      account.department !== undefined
        ? account.department
        : prev.department || 'Marketing',
    org_unit_id:
      account.org_unit_id !== undefined ? account.org_unit_id : prev.org_unit_id ?? null,
    status:
      account.status === 'active' || (prev.status === 'active' && account.status === 'pending')
        ? 'active'
        : account.status || prev.status || 'active',
    avatar: account.avatar || account.picture || prev.avatar || '',
    picture: account.picture || account.avatar || prev.picture || '',
    password_hash: account.password_hash || prev.password_hash || undefined,
    password_updated_at: account.password_updated_at || prev.password_updated_at || undefined,
    token_version: Number(account.token_version || prev.token_version || 1),
    updated_at: account.updated_at || new Date().toISOString(),
  };
  for (const k of VAULT_PROFILE_KEYS) {
    if (account[k] !== undefined) {
      (merged as any)[k] = account[k];
    }
  }
  if (idx >= 0) {
    list[idx] = merged;
  } else {
    list.push(merged);
  }
  return true;
}

export function upsertAccountInVault(account: any): void {
  try {
    const list = readVaultRaw();
    if (mergeAccountIntoVaultList(list, account)) {
      scheduleVaultFlush();
    }
  } catch {}
}

export function upsertAccountsListInVault(accounts: any[]): void {
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  try {
    const list = readVaultRaw();
    let changed = false;
    for (const acc of accounts) {
      if (mergeAccountIntoVaultList(list, acc)) changed = true;
    }
    if (changed) scheduleVaultFlush();
  } catch {}
}

function openMirrorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface LocalCacheHarvest {
  users: any[];
  tasks: any[];
  boards: any[];
  templates: any[];
  messages: any[];
  conversations: any[];
  groups: any[];
  meetings: any[];
  projects: any[];
  notes: any[];
  posts: any[];
  org_units: any[];
  divisions: string[];
  drive_shortcuts: any[];
}

function harvestAllLocalStorageCaches(): LocalCacheHarvest {
  const harvest: LocalCacheHarvest = {
    users: [],
    tasks: [],
    boards: [],
    templates: [],
    messages: [],
    conversations: [],
    groups: [],
    meetings: [],
    projects: [],
    notes: [],
    posts: [],
    org_units: [],
    divisions: [],
    drive_shortcuts: [],
  };

  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return harvest;
  }

  const readJsonArray = (key: string): any[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  harvest.users = mergeItemsById(
    mergeItemsById(getKnownAccountsFromVault(), readJsonArray('circle_users_cache'), 'user_id'),
    readJsonArray('circle_admin_users'),
    'user_id'
  );

  const localDelTaskSet = new Set(getLocalDeletedTaskIds());
  const localDelEntitySet = new Set(getLocalDeletedEntityIds());
  const isEntityDel = (item: any, altKey?: string) => {
    const id = getItemId(item, altKey);
    if (id && (localDelEntitySet.has(id) || localDelTaskSet.has(id))) return true;
    if (item?.gcal_id && localDelEntitySet.has(String(item.gcal_id).trim())) return true;
    return false;
  };

  harvest.tasks = mergeTasksArrayNonDestructive(
    readJsonArray('circle_tasks_cache'),
    readJsonArray('circle_cache_tasks')
  ).filter((t) => !isEntityDel(t, 'task_id'));

  const localDelTplSet = new Set(getLocalDeletedCheckpointTemplateIds());
  harvest.boards = readJsonArray('circle_boards_cache').filter(
    (b) => b && b.id !== 'brd_1' && !isEntityDel(b, 'board_id')
  );
  harvest.templates = readJsonArray('circle_checkpoint_templates').filter(
    (t) => !localDelTplSet.has(getItemId(t)) && !isEntityDel(t)
  );

  harvest.meetings = mergeItemsById(
    readJsonArray('circle_meetings_cache'),
    readJsonArray('circle_cache_meetings')
  ).filter((m) => !isEntityDel(m));
  harvest.projects = readJsonArray('circle_projects_cache').filter((p) => !isEntityDel(p));
  harvest.org_units = readJsonArray('circle_org_units_cache').filter((o) => !isEntityDel(o));
  harvest.divisions = readJsonArray('circle_admin_divisions').filter(
    (d) => typeof d === 'string' && d.trim()
  );
  harvest.drive_shortcuts = readJsonArray('circle_drive_shortcuts_cache').filter(
    (d) => !isEntityDel(d)
  );

  for (const pk of ['circle_cache_posts_feed', 'circle_cache_posts']) {
    try {
      const raw = localStorage.getItem(pk);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.posts)
          ? parsed.posts
          : [];
      if (list.length > 0) {
        harvest.posts = mergeItemsById(harvest.posts, list, 'post_id').filter(
          (p) => !isEntityDel(p, 'post_id')
        );
      }
    } catch {}
  }

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('circle_msgs_cache_')) {
        const msgs = readJsonArray(key).filter((m) => !isEntityDel(m));
        if (msgs.length > 0) {
          harvest.messages = mergeItemsById(harvest.messages, msgs);
          const extractedTasks: any[] = [];
          for (const m of msgs) {
            if (
              m &&
              m.task &&
              typeof m.task === 'object' &&
              (m.task.id || m.task.task_id) &&
              m.task.title
            ) {
              const tCopy = { ...m.task, id: String(m.task.id || m.task.task_id) };
              if (m.approvals && typeof m.approvals === 'object') {
                tCopy.approvals = m.approvals;
                tCopy.approval = m.approvals;
              }
              extractedTasks.push(tCopy);
            }
          }
          if (extractedTasks.length > 0) {
            harvest.tasks = mergeTasksArrayNonDestructive(harvest.tasks, extractedTasks).filter(
              (t) => !isEntityDel(t, 'task_id')
            );
          }
        }
      } else if (key === 'circle_convs_cache' || key.startsWith('circle_convs_cache_')) {
        const convs = readJsonArray(key).filter((c) => !isEntityDel(c));
        if (convs.length > 0) {
          harvest.conversations = mergeItemsById(harvest.conversations, convs);
        }
      } else if (key === 'circle_groups_cache' || key.startsWith('circle_groups_cache_')) {
        const grps = readJsonArray(key).filter((g) => !isEntityDel(g));
        if (grps.length > 0) {
          harvest.groups = mergeItemsById(harvest.groups, grps);
        }
      } else if (
        key.startsWith('circle_sticky_notes_') ||
        key.startsWith('circle_notes_cache_')
      ) {
        const notes = readJsonArray(key).filter((n) => !isEntityDel(n, 'note_id'));
        if (notes.length > 0) {
          harvest.notes = mergeItemsById(harvest.notes, notes, 'note_id');
        }
      } else if (key.startsWith('circle_user_feed_history_')) {
        const posts = readJsonArray(key).filter((p) => !isEntityDel(p, 'post_id'));
        if (posts.length > 0) {
          harvest.posts = mergeItemsById(harvest.posts, posts, 'post_id');
        }
      } else if (
        key.startsWith('circle_meetings_cache_') ||
        key.startsWith('circle_cache_meetings_')
      ) {
        const mtgs = readJsonArray(key).filter((m) => !isEntityDel(m));
        if (mtgs.length > 0) {
          harvest.meetings = mergeItemsById(harvest.meetings, mtgs);
        }
      }
    }
  } catch {}

  return harvest;
}

let cachedBootHarvest: LocalCacheHarvest | null = null;
function getBootHarvest(): LocalCacheHarvest {
  if (!cachedBootHarvest) {
    cachedBootHarvest = harvestAllLocalStorageCaches();
  }
  return cachedBootHarvest;
}

let inFlightPersistenceStatus: Promise<any> | null = null;
let cachedPersistenceStatus: { data: any; at: number } | null = null;
async function fetchPersistenceStatus(api: any, forceRefresh = false): Promise<any> {
  const now = Date.now();
  if (!forceRefresh && cachedPersistenceStatus && now - cachedPersistenceStatus.at < 4000) {
    return cachedPersistenceStatus.data;
  }
  if (inFlightPersistenceStatus) return inFlightPersistenceStatus;
  inFlightPersistenceStatus = api
    .get('/workspace/persistence-status')
    .then((res: any) => {
      cachedPersistenceStatus = { data: res?.data, at: Date.now() };
      const serverPausedUntil = Number(res?.data?.firestore_quota_paused_until || 0);
      if (serverPausedUntil > Date.now()) {
        syncServerQuotaPauseUntil(serverPausedUntil);
      }
      return res?.data;
    })
    .finally(() => {
      inFlightPersistenceStatus = null;
    });
  return inFlightPersistenceStatus;
}

function mergeHarvestIntoSnapshotPayload(basePayload: any, harvest: LocalCacheHarvest): any {
  const clone = basePayload
    ? JSON.parse(JSON.stringify(basePayload))
    : { app: 'ASLI Workspace', version: 2, data: {} };
  const root = clone.data && typeof clone.data === 'object' ? clone.data : clone;

  const localDelTaskIds = getLocalDeletedTaskIds();
  const existingDelTaskIds = Array.isArray(root.deleted_task_ids) ? root.deleted_task_ids : [];
  root.deleted_task_ids = Array.from(
    new Set([...existingDelTaskIds, ...localDelTaskIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );

  const localDelEntityIds = getLocalDeletedEntityIds();
  const existingDelEntityIds = [
    ...(Array.isArray(root.deleted_entity_ids) ? root.deleted_entity_ids : []),
    ...(Array.isArray(root.deleted_note_ids) ? root.deleted_note_ids : []),
    ...(Array.isArray(root.deleted_meeting_ids) ? root.deleted_meeting_ids : []),
    ...(Array.isArray(root.deleted_gcal_ids) ? root.deleted_gcal_ids : []),
  ];
  root.deleted_entity_ids = Array.from(
    new Set(
      [...existingDelEntityIds, ...localDelEntityIds]
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  root.deleted_note_ids = Array.from(
    new Set(
      [...(Array.isArray(root.deleted_note_ids) ? root.deleted_note_ids : []), ...localDelEntityIds]
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  const delTaskSet = new Set<string>([...root.deleted_task_ids, ...root.deleted_entity_ids]);
  const delEntitySet = new Set<string>(root.deleted_entity_ids);
  const isDel = (item: any, altKey?: string) => {
    const id = getItemId(item, altKey);
    if (id && delEntitySet.has(id)) return true;
    if (item?.gcal_id && delEntitySet.has(String(item.gcal_id).trim())) return true;
    return false;
  };

  if (harvest.users.length > 0) {
    root.users = mergeItemsById(root.users || [], harvest.users, 'user_id');
  }
  if (harvest.tasks.length > 0 || Array.isArray(root.tasks)) {
    root.tasks = mergeTasksArrayNonDestructive(root.tasks || [], harvest.tasks).filter(
      (t: any) => !delTaskSet.has(getItemId(t, 'task_id'))
    );
  }
  if (harvest.boards.length > 0 || Array.isArray(root.boards)) {
    root.boards = mergeItemsById(root.boards || [], harvest.boards, 'board_id').filter(
      (b: any) => !isDel(b, 'board_id')
    );
  }
  if (harvest.messages.length > 0 || Array.isArray(root.messages)) {
    root.messages = mergeItemsById(root.messages || [], harvest.messages).filter(
      (m: any) => !isDel(m)
    );
  }
  if (harvest.conversations.length > 0 || Array.isArray(root.conversations)) {
    root.conversations = mergeItemsById(root.conversations || [], harvest.conversations).filter(
      (c: any) => !isDel(c)
    );
  }
  if (harvest.groups.length > 0 || Array.isArray(root.groups)) {
    root.groups = mergeItemsById(root.groups || [], harvest.groups).filter(
      (g: any) => !isDel(g)
    );
  }
  if (harvest.meetings.length > 0 || Array.isArray(root.meetings)) {
    root.meetings = mergeItemsById(root.meetings || [], harvest.meetings).filter(
      (m: any) => !isDel(m)
    );
  }
  if (harvest.projects.length > 0 || Array.isArray(root.projects)) {
    root.projects = mergeItemsById(root.projects || [], harvest.projects).filter(
      (p: any) => !isDel(p)
    );
  }
  if (harvest.notes.length > 0 || Array.isArray(root.circle_notes)) {
    root.circle_notes = mergeItemsById(root.circle_notes || [], harvest.notes, 'note_id').filter(
      (n: any) => !isDel(n, 'note_id')
    );
  }
  if (harvest.posts.length > 0 || Array.isArray(root.posts)) {
    root.posts = mergeItemsById(root.posts || [], harvest.posts, 'post_id').filter(
      (p: any) => !isDel(p, 'post_id')
    );
  }
  if (harvest.org_units.length > 0 || Array.isArray(root.org_units)) {
    root.org_units = mergeItemsById(root.org_units || [], harvest.org_units).filter(
      (o: any) => !isDel(o)
    );
  }
  if (harvest.drive_shortcuts.length > 0 || Array.isArray(root.drive_shortcuts)) {
    root.drive_shortcuts = mergeItemsById(root.drive_shortcuts || [], harvest.drive_shortcuts).filter(
      (d: any) => !isDel(d)
    );
  }
  const localDelTplIds = getLocalDeletedCheckpointTemplateIds();
  const existingDelTplIds = [
    ...(Array.isArray(root.deleted_checkpoint_template_ids)
      ? root.deleted_checkpoint_template_ids
      : []),
    ...(Array.isArray(root.workspace?.deleted_checkpoint_template_ids)
      ? root.workspace.deleted_checkpoint_template_ids
      : []),
  ];
  const mergedDelTplIds = Array.from(
    new Set(
      [...existingDelTplIds, ...localDelTplIds]
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  root.deleted_checkpoint_template_ids = mergedDelTplIds;
  const delTplSet = new Set<string>(mergedDelTplIds);

  if (
    harvest.templates.length > 0 ||
    harvest.divisions.length > 0 ||
    mergedDelTplIds.length > 0 ||
    Array.isArray(root.workspace?.checkpoint_templates)
  ) {
    root.workspace = root.workspace && typeof root.workspace === 'object' ? root.workspace : {};
    root.workspace.deleted_checkpoint_template_ids = mergedDelTplIds;
    if (harvest.templates.length > 0 || Array.isArray(root.workspace.checkpoint_templates)) {
      root.workspace.checkpoint_templates = mergeItemsById(
        root.workspace.checkpoint_templates || [],
        harvest.templates
      ).filter((t: any) => !delTplSet.has(getItemId(t)));
    }
    if (harvest.divisions.length > 0) {
      const existingDivs = Array.isArray(root.workspace.divisions)
        ? root.workspace.divisions
        : [];
      root.workspace.divisions = Array.from(new Set([...existingDivs, ...harvest.divisions]));
    }
  }
  return clone;
}

export async function saveMirrorSnapshot(envelope: PersistentMirrorEnvelope): Promise<void> {
  if (!envelope?.snapshot) return;
  try {
    const snapUsers = envelope.snapshot?.data?.users || envelope.snapshot?.users;
    const delIds = envelope.snapshot?.data?.deleted_user_ids || [];
    const delEmails = envelope.snapshot?.data?.deleted_user_emails || [];
    const delTaskIds =
      envelope.snapshot?.data?.deleted_task_ids || envelope.snapshot?.deleted_task_ids || [];
    const delTplIds = [
      ...(Array.isArray(envelope.snapshot?.data?.deleted_checkpoint_template_ids)
        ? envelope.snapshot.data.deleted_checkpoint_template_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.data?.workspace?.deleted_checkpoint_template_ids)
        ? envelope.snapshot.data.workspace.deleted_checkpoint_template_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.deleted_checkpoint_template_ids)
        ? envelope.snapshot.deleted_checkpoint_template_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.workspace?.deleted_checkpoint_template_ids)
        ? envelope.snapshot.workspace.deleted_checkpoint_template_ids
        : []),
    ];
    const delEntityIds = [
      ...(Array.isArray(envelope.snapshot?.data?.deleted_entity_ids)
        ? envelope.snapshot.data.deleted_entity_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.data?.deleted_note_ids)
        ? envelope.snapshot.data.deleted_note_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.data?.deleted_meeting_ids)
        ? envelope.snapshot.data.deleted_meeting_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.data?.deleted_gcal_ids)
        ? envelope.snapshot.data.deleted_gcal_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.deleted_entity_ids)
        ? envelope.snapshot.deleted_entity_ids
        : []),
      ...(Array.isArray(envelope.snapshot?.deleted_note_ids)
        ? envelope.snapshot.deleted_note_ids
        : []),
    ];
    pruneDeletedAccountsFromVault(delIds, delEmails);
    if (Array.isArray(delTaskIds) && delTaskIds.length > 0) {
      recordDeletedTaskIds(delTaskIds);
    }
    if (delTplIds.length > 0) {
      recordDeletedCheckpointTemplateIds(delTplIds);
    }
    if (delEntityIds.length > 0) {
      recordDeletedEntityIds(delEntityIds);
    }
    if (Array.isArray(snapUsers)) {
      upsertAccountsListInVault(snapUsers);
    }
  } catch {}
  const db = await openMirrorDb();
  if (!db) return;

  const existingPair = await new Promise<{
    latest: PersistentMirrorEnvelope | null;
    richest: PersistentMirrorEnvelope | null;
  }>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const reqLatest = store.get(MIRROR_KEY);
      const reqRichest = store.get(RICHEST_MIRROR_KEY);
      let latest: PersistentMirrorEnvelope | null = null;
      let richest: PersistentMirrorEnvelope | null = null;
      reqLatest.onsuccess = () => {
        latest = (reqLatest.result as PersistentMirrorEnvelope) || null;
      };
      reqRichest.onsuccess = () => {
        richest = (reqRichest.result as PersistentMirrorEnvelope) || null;
      };
      tx.oncomplete = () => resolve({ latest, richest });
      tx.onerror = () => resolve({ latest: null, richest: null });
    } catch {
      resolve({ latest: null, richest: null });
    }
  });

  let mergedSnapshot = envelope.snapshot;
  if (existingPair.latest?.snapshot) {
    mergedSnapshot = mergeTwoSnapshotsNonDestructive(
      mergedSnapshot,
      existingPair.latest.snapshot
    );
  }
  if (existingPair.richest?.snapshot) {
    mergedSnapshot = mergeTwoSnapshotsNonDestructive(
      mergedSnapshot,
      existingPair.richest.snapshot
    );
  }

  const mergedData = mergedSnapshot?.data || mergedSnapshot || {};
  const allDeletedTaskIds = Array.from(
    new Set([
      ...(Array.isArray(mergedData.deleted_task_ids) ? mergedData.deleted_task_ids : []),
      ...getLocalDeletedTaskIds(),
    ])
  );
  mergedData.deleted_task_ids = allDeletedTaskIds;
  if (Array.isArray(mergedData.tasks) && allDeletedTaskIds.length > 0) {
    const delSet = new Set(allDeletedTaskIds);
    mergedData.tasks = mergedData.tasks.filter((t: any) => !delSet.has(getItemId(t, 'task_id')));
  }

  const allDeletedEntityIds = Array.from(
    new Set([
      ...(Array.isArray(mergedData.deleted_entity_ids) ? mergedData.deleted_entity_ids : []),
      ...(Array.isArray(mergedData.deleted_note_ids) ? mergedData.deleted_note_ids : []),
      ...(Array.isArray(mergedData.deleted_meeting_ids) ? mergedData.deleted_meeting_ids : []),
      ...(Array.isArray(mergedData.deleted_gcal_ids) ? mergedData.deleted_gcal_ids : []),
      ...getLocalDeletedEntityIds(),
    ])
  );
  mergedData.deleted_entity_ids = allDeletedEntityIds;
  mergedData.deleted_note_ids = Array.from(
    new Set([
      ...(Array.isArray(mergedData.deleted_note_ids) ? mergedData.deleted_note_ids : []),
      ...getLocalDeletedEntityIds(),
    ])
  );
  if (allDeletedEntityIds.length > 0) {
    const delEntitySet = new Set(allDeletedEntityIds);
    const isDel = (item: any, altKey?: string) => {
      const id = getItemId(item, altKey);
      if (id && delEntitySet.has(id)) return true;
      if (item?.gcal_id && delEntitySet.has(String(item.gcal_id).trim())) return true;
      return false;
    };
    if (Array.isArray(mergedData.circle_notes)) {
      mergedData.circle_notes = mergedData.circle_notes.filter((n: any) => !isDel(n, 'note_id'));
    }
    if (Array.isArray(mergedData.boards)) {
      mergedData.boards = mergedData.boards.filter((b: any) => !isDel(b, 'board_id'));
    }
    if (Array.isArray(mergedData.meetings)) {
      mergedData.meetings = mergedData.meetings.filter((m: any) => !isDel(m));
    }
    if (Array.isArray(mergedData.posts)) {
      mergedData.posts = mergedData.posts.filter((p: any) => !isDel(p, 'post_id'));
    }
    if (Array.isArray(mergedData.messages)) {
      mergedData.messages = mergedData.messages.filter((m: any) => !isDel(m));
    }
    if (Array.isArray(mergedData.conversations)) {
      mergedData.conversations = mergedData.conversations.filter((c: any) => !isDel(c));
    }
    if (Array.isArray(mergedData.groups)) {
      mergedData.groups = mergedData.groups.filter((g: any) => !isDel(g));
    }
    if (Array.isArray(mergedData.projects)) {
      mergedData.projects = mergedData.projects.filter((p: any) => !isDel(p));
    }
    if (Array.isArray(mergedData.org_units)) {
      mergedData.org_units = mergedData.org_units.filter((o: any) => !isDel(o));
    }
    if (Array.isArray(mergedData.drive_shortcuts)) {
      mergedData.drive_shortcuts = mergedData.drive_shortcuts.filter((d: any) => !isDel(d));
    }
  }

  const allDeletedTplIds = Array.from(
    new Set([
      ...(Array.isArray(mergedData.deleted_checkpoint_template_ids)
        ? mergedData.deleted_checkpoint_template_ids
        : []),
      ...(Array.isArray(mergedData.workspace?.deleted_checkpoint_template_ids)
        ? mergedData.workspace.deleted_checkpoint_template_ids
        : []),
      ...getLocalDeletedCheckpointTemplateIds(),
    ])
  );
  mergedData.deleted_checkpoint_template_ids = allDeletedTplIds;
  if (mergedData.workspace && typeof mergedData.workspace === 'object') {
    mergedData.workspace.deleted_checkpoint_template_ids = allDeletedTplIds;
    if (Array.isArray(mergedData.workspace.checkpoint_templates) && allDeletedTplIds.length > 0) {
      const delTplSet = new Set(allDeletedTplIds);
      mergedData.workspace.checkpoint_templates = mergedData.workspace.checkpoint_templates.filter(
        (t: any) => !delTplSet.has(getItemId(t))
      );
    }
  }

  const finalEnvelope: PersistentMirrorEnvelope = {
    ...envelope,
    snapshot: mergedSnapshot,
  };

  const mergedTasksCount = Array.isArray(mergedData.tasks) ? mergedData.tasks.length : 0;
  const richestData =
    existingPair.richest?.snapshot?.data || existingPair.richest?.snapshot || {};
  const richestTasksCount = Array.isArray(richestData.tasks) ? richestData.tasks.length : 0;
  const shouldUpdateRichest =
    !existingPair.richest ||
    mergedTasksCount >= richestTasksCount ||
    allDeletedTaskIds.length > 0 ||
    allDeletedEntityIds.length > 0;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(finalEnvelope, MIRROR_KEY);
      if (shouldUpdateRichest && hasMeaningfulWorkspaceData(mergedSnapshot)) {
        store.put(finalEnvelope, RICHEST_MIRROR_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadMirrorSnapshot(): Promise<PersistentMirrorEnvelope | null> {
  const db = await openMirrorDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const reqLatest = store.get(MIRROR_KEY);
      const reqRichest = store.get(RICHEST_MIRROR_KEY);
      let latest: PersistentMirrorEnvelope | null = null;
      let richest: PersistentMirrorEnvelope | null = null;
      reqLatest.onsuccess = () => {
        latest = (reqLatest.result as PersistentMirrorEnvelope) || null;
      };
      reqRichest.onsuccess = () => {
        richest = (reqRichest.result as PersistentMirrorEnvelope) || null;
      };
      tx.oncomplete = () => {
        let env = latest || richest || null;
        if (latest?.snapshot && richest?.snapshot) {
          env = {
            ...latest,
            snapshot: mergeTwoSnapshotsNonDestructive(latest.snapshot, richest.snapshot),
            revision: Math.max(Number(latest.revision || 0), Number(richest.revision || 0)),
          };
        }
        try {
          const snapData = env?.snapshot?.data || env?.snapshot;
          const snapUsers = snapData?.users;
          const delIds = snapData?.deleted_user_ids || [];
          const delEmails = snapData?.deleted_user_emails || [];
          const delTaskIds = Array.from(
            new Set([...(snapData?.deleted_task_ids || []), ...getLocalDeletedTaskIds()])
          );
          if (snapData && delTaskIds.length > 0) {
            snapData.deleted_task_ids = delTaskIds;
            if (Array.isArray(snapData.tasks)) {
              const delSet = new Set(delTaskIds);
              snapData.tasks = snapData.tasks.filter(
                (t: any) => !delSet.has(getItemId(t, 'task_id'))
              );
            }
          }
          pruneDeletedAccountsFromVault(delIds, delEmails);
          if (Array.isArray(snapUsers)) {
            upsertAccountsListInVault(snapUsers);
          }
        } catch {}
        resolve(env);
      };
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const LAST_UPLOADED_SIG_KEY = 'circle_firestore_last_uploaded_sig_v1';

function readPersistedUploadedSig(): string {
  try {
    return localStorage.getItem(LAST_UPLOADED_SIG_KEY) || '';
  } catch {
    return '';
  }
}

function writePersistedUploadedSig(sig: string): void {
  try {
    localStorage.setItem(LAST_UPLOADED_SIG_KEY, sig);
  } catch {}
}

let inFlightHydrate: Promise<boolean> | null = null;
let lastSyncedRevision = -1;
let lastFirestoreUploadedSig = readPersistedUploadedSig();
let lastFirestoreSyncAt = 0;
let initialHydrateCompleted = false;

let inFlightMirrorSync: Promise<{ pulledNewFromShared?: boolean } | null> | null = null;
let pendingResyncAfterFlight = false;
let pendingResyncForce = false;
let realtimeSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function hasCompletedInitialHydrate(): boolean {
  return initialHydrateCompleted;
}

export async function rehydrateIfServerRestarted(api: any): Promise<boolean> {
  try {
    const status = await fetchPersistenceStatus(api, true);
    const serverTasksCount = Number(status?.counts?.tasks || 0);
    if (Boolean(status?.booted_fresh_seed) || serverTasksCount === 0) {
      const idbEnv = await loadMirrorSnapshot();
      const idbData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
      const liveHarvest = harvestAllLocalStorageCaches();
      const bootHarvest = getBootHarvest();
      const hasLocalData =
        (Array.isArray(idbData.tasks) && idbData.tasks.length > 0) ||
        bootHarvest.tasks.length > 0 ||
        liveHarvest.tasks.length > 0 ||
        (Array.isArray(idbData.messages) && idbData.messages.length > 3) ||
        liveHarvest.messages.length > 3 ||
        Boolean(firebaseAuth.currentUser?.emailVerified);
      if (hasLocalData) {
        initialHydrateCompleted = false;
        return await attemptAutoHydrateServer(api);
      }
    }
  } catch {}
  return false;
}

export async function inspectLocalMirrorSources() {
  const idbEnv = await loadMirrorSnapshot();
  const idbData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
  const liveHarvest = harvestAllLocalStorageCaches();
  const bootHarvest = getBootHarvest();
  const combinedTasks = mergeItemsById(
    mergeItemsById(bootHarvest.tasks, liveHarvest.tasks, 'task_id'),
    Array.isArray(idbData.tasks) ? idbData.tasks : [],
    'task_id'
  );
  const combinedMessages = mergeItemsById(
    mergeItemsById(bootHarvest.messages, liveHarvest.messages),
    Array.isArray(idbData.messages) ? idbData.messages : []
  );
  const combinedBoards = mergeItemsById(
    mergeItemsById(bootHarvest.boards, liveHarvest.boards, 'board_id'),
    Array.isArray(idbData.boards) ? idbData.boards : [],
    'board_id'
  );
  const combinedUsers = mergeItemsById(
    mergeItemsById(bootHarvest.users, liveHarvest.users, 'user_id'),
    Array.isArray(idbData.users) ? idbData.users : [],
    'user_id'
  ).filter((u: any) => u && !u.is_bot && u.role !== 'assistant');
  const combinedNotes = mergeItemsById(
    mergeItemsById(bootHarvest.notes, liveHarvest.notes, 'note_id'),
    Array.isArray(idbData.circle_notes) ? idbData.circle_notes : [],
    'note_id'
  );
  const combinedPosts = mergeItemsById(
    mergeItemsById(bootHarvest.posts, liveHarvest.posts, 'post_id'),
    Array.isArray(idbData.posts) ? idbData.posts : [],
    'post_id'
  );
  const combinedTemplates = mergeItemsById(
    mergeItemsById(bootHarvest.templates, liveHarvest.templates),
    Array.isArray(idbData.workspace?.checkpoint_templates)
      ? idbData.workspace.checkpoint_templates
      : []
  );

  return {
    indexedDbRevision: Number(idbEnv?.revision || 0),
    indexedDbSavedAt: idbEnv?.saved_at || null,
    counts: {
      tasks: combinedTasks.length,
      messages: combinedMessages.length,
      boards: combinedBoards.length,
      users: combinedUsers.length,
      notes: combinedNotes.length,
      posts: combinedPosts.length,
      templates: combinedTemplates.length,
    },
  };
}

export async function forceHydrateFromLocalSources(
  api: any
): Promise<{ restored: boolean; summary?: any }> {
  initialHydrateCompleted = false;
  lastSyncedRevision = -1;
  const restored = await attemptAutoHydrateServer(api);
  try {
    const { data: status } = await api.get('/workspace/persistence-status');
    return { restored, summary: status?.counts };
  } catch {
    return { restored };
  }
}

export async function attemptAutoHydrateServer(api: any): Promise<boolean> {
  if (inFlightHydrate) return inFlightHydrate;

  inFlightHydrate = (async () => {
    try {
      const status = await fetchPersistenceStatus(api, false);
      const deletedIdsList = Array.isArray(status?.deleted_user_ids)
        ? status.deleted_user_ids
        : [];
      const deletedEmailsList = Array.isArray(status?.deleted_user_emails)
        ? status.deleted_user_emails
        : [];
      pruneDeletedAccountsFromVault(deletedIdsList, deletedEmailsList);

      const idbEnv = await loadMirrorSnapshot();
      let cloudSync: { id: string; payload: any; updatedAtIso: string } | null = null;

      const serverEmails = new Set(
        Array.isArray(status?.user_emails)
          ? status.user_emails.map((e: string) => String(e || '').toLowerCase().trim())
          : []
      );
      const serverTaskIds = new Set(
        Array.isArray(status?.task_ids)
          ? status.task_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverBoardIds = new Set(
        Array.isArray(status?.board_ids)
          ? status.board_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverPostIds = new Set(
        Array.isArray(status?.post_ids)
          ? status.post_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverNoteIds = new Set(
        Array.isArray(status?.note_ids)
          ? status.note_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverMessageIds = new Set(
        Array.isArray(status?.message_ids)
          ? status.message_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverMeetingIds = new Set(
        Array.isArray(status?.meeting_ids)
          ? status.meeting_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverProjectIds = new Set(
        Array.isArray(status?.project_ids)
          ? status.project_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const serverTemplateIds = new Set(
        Array.isArray(status?.template_ids)
          ? status.template_ids.map((id: string) => String(id || '').trim())
          : []
      );

      const deletedTaskIdsList = Array.isArray(status?.deleted_task_ids)
        ? status.deleted_task_ids
        : [];
      if (deletedTaskIdsList.length > 0) {
        recordDeletedTaskIds(deletedTaskIdsList);
      }
      const deletedTaskIds = new Set(
        [...deletedTaskIdsList, ...getLocalDeletedTaskIds()]
          .map((id: string) => String(id || '').trim())
          .filter(Boolean)
      );

      const deletedTplIdsList = Array.isArray(status?.deleted_checkpoint_template_ids)
        ? status.deleted_checkpoint_template_ids
        : [];
      if (deletedTplIdsList.length > 0) {
        recordDeletedCheckpointTemplateIds(deletedTplIdsList);
      }
      const deletedTplIds = new Set(
        [...deletedTplIdsList, ...getLocalDeletedCheckpointTemplateIds()]
          .map((id: string) => String(id || '').trim())
          .filter(Boolean)
      );

      const deletedEntityIdsList = [
        ...(Array.isArray(status?.deleted_entity_ids) ? status.deleted_entity_ids : []),
        ...(Array.isArray(status?.deleted_note_ids) ? status.deleted_note_ids : []),
        ...(Array.isArray(status?.deleted_meeting_ids) ? status.deleted_meeting_ids : []),
      ];
      if (deletedEntityIdsList.length > 0) {
        recordDeletedEntityIds(deletedEntityIdsList);
      }
      const deletedEntityIds = new Set(
        [...deletedEntityIdsList, ...getLocalDeletedEntityIds()]
          .map((id: string) => String(id || '').trim())
          .filter(Boolean)
      );
      const isEntityDel = (item: any, altKey?: string) => {
        const id = getItemId(item, altKey);
        if (id && deletedEntityIds.has(id)) return true;
        if (item?.gcal_id && deletedEntityIds.has(String(item.gcal_id).trim())) return true;
        return false;
      };

      const deletedIds = new Set(deletedIdsList.map((id: string) => String(id || '').trim()));
      const deletedEmails = new Set(
        deletedEmailsList.map((e: string) => String(e || '').toLowerCase().trim())
      );

      const liveHarvest = harvestAllLocalStorageCaches();
      const bootHarvest = getBootHarvest();
      const combinedHarvest: LocalCacheHarvest = {
        users: mergeItemsById(bootHarvest.users, liveHarvest.users, 'user_id').filter(
          (u) =>
            u &&
            u.email &&
            !u.is_bot &&
            u.role !== 'assistant' &&
            !deletedIds.has(String(u.user_id || '').trim()) &&
            !deletedEmails.has(String(u.email).toLowerCase().trim())
        ),
        tasks: mergeItemsById(bootHarvest.tasks, liveHarvest.tasks, 'task_id').filter(
          (t) => !deletedTaskIds.has(getItemId(t, 'task_id')) && !isEntityDel(t, 'task_id')
        ),
        boards: mergeItemsById(bootHarvest.boards, liveHarvest.boards, 'board_id').filter(
          (b) => !isEntityDel(b, 'board_id')
        ),
        templates: mergeItemsById(bootHarvest.templates, liveHarvest.templates).filter(
          (t) => !deletedTplIds.has(getItemId(t)) && !isEntityDel(t)
        ),
        messages: mergeItemsById(bootHarvest.messages, liveHarvest.messages).filter(
          (m) => !isEntityDel(m)
        ),
        conversations: mergeItemsById(
          bootHarvest.conversations,
          liveHarvest.conversations
        ).filter((c) => !isEntityDel(c)),
        groups: mergeItemsById(bootHarvest.groups, liveHarvest.groups).filter(
          (g) => !isEntityDel(g)
        ),
        meetings: mergeItemsById(bootHarvest.meetings, liveHarvest.meetings).filter(
          (m) => !isEntityDel(m)
        ),
        projects: mergeItemsById(bootHarvest.projects, liveHarvest.projects).filter(
          (p) => !isEntityDel(p)
        ),
        notes: mergeItemsById(bootHarvest.notes, liveHarvest.notes, 'note_id').filter(
          (n) => !isEntityDel(n, 'note_id')
        ),
        posts: mergeItemsById(bootHarvest.posts, liveHarvest.posts, 'post_id').filter(
          (p) => !isEntityDel(p, 'post_id')
        ),
        org_units: mergeItemsById(bootHarvest.org_units, liveHarvest.org_units).filter(
          (o) => !isEntityDel(o)
        ),
        divisions: Array.from(
          new Set([...bootHarvest.divisions, ...liveHarvest.divisions])
        ),
        drive_shortcuts: mergeItemsById(
          bootHarvest.drive_shortcuts,
          liveHarvest.drive_shortcuts
        ).filter((d) => !isEntityDel(d)),
      };

      const activeVaultAccounts = getKnownAccountsFromVault().filter(
        (acc) =>
          acc.email &&
          !deletedIds.has(String(acc.user_id || '').trim()) &&
          !deletedEmails.has(String(acc.email).toLowerCase().trim())
      );

      const hasMissingVaultAccount =
        activeVaultAccounts.some(
          (acc) => acc.email && !serverEmails.has(String(acc.email).toLowerCase().trim())
        ) ||
        combinedHarvest.users.some(
          (u) => u.email && !serverEmails.has(String(u.email).toLowerCase().trim())
        );

      const snapData = idbEnv?.snapshot?.data || idbEnv?.snapshot || {};
      const snapUsers = Array.isArray(snapData.users) ? snapData.users : [];
      const snapTasks = (Array.isArray(snapData.tasks) ? snapData.tasks : []).filter(
        (t: any) => !deletedTaskIds.has(getItemId(t, 'task_id')) && !isEntityDel(t, 'task_id')
      );
      const snapBoards = (Array.isArray(snapData.boards) ? snapData.boards : []).filter(
        (b: any) => !isEntityDel(b, 'board_id')
      );
      const snapPosts = (Array.isArray(snapData.posts) ? snapData.posts : []).filter(
        (p: any) => !isEntityDel(p, 'post_id')
      );
      const snapNotes = (Array.isArray(snapData.circle_notes) ? snapData.circle_notes : []).filter(
        (n: any) => !isEntityDel(n, 'note_id')
      );
      const snapMessages = (Array.isArray(snapData.messages) ? snapData.messages : []).filter(
        (m: any) => !isEntityDel(m)
      );
      const snapMeetings = (Array.isArray(snapData.meetings) ? snapData.meetings : []).filter(
        (m: any) => !isEntityDel(m)
      );
      const snapProjects = (Array.isArray(snapData.projects) ? snapData.projects : []).filter(
        (p: any) => !isEntityDel(p)
      );
      const snapTemplates = (
        Array.isArray(snapData.workspace?.checkpoint_templates)
          ? snapData.workspace.checkpoint_templates
          : []
      ).filter((t: any) => !deletedTplIds.has(getItemId(t)) && !isEntityDel(t));

      const hasMissingSnapshotUser =
        snapUsers.length > 0 &&
        snapUsers.some(
          (u: any) =>
            u &&
            !u.is_bot &&
            u.role !== 'assistant' &&
            u.email &&
            !deletedEmails.has(String(u.email).toLowerCase().trim()) &&
            !serverEmails.has(String(u.email).toLowerCase().trim())
        );

      const hasMissingSnapshotData =
        snapTasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        combinedHarvest.tasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        snapBoards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        combinedHarvest.boards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        snapPosts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        combinedHarvest.posts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        snapNotes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        combinedHarvest.notes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        snapMessages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        }) ||
        combinedHarvest.messages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        }) ||
        snapMeetings.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMeetingIds.has(id);
        }) ||
        combinedHarvest.meetings.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMeetingIds.has(id);
        }) ||
        snapProjects.some((p: any) => {
          const id = getItemId(p);
          return id && !serverProjectIds.has(id);
        }) ||
        combinedHarvest.projects.some((p: any) => {
          const id = getItemId(p);
          return id && !serverProjectIds.has(id);
        }) ||
        snapTemplates.some((t: any) => {
          const id = getItemId(t);
          return id && !serverTemplateIds.has(id);
        }) ||
        combinedHarvest.templates.some((t: any) => {
          const id = getItemId(t);
          return id && !serverTemplateIds.has(id);
        });

      const serverRev = Number(status?.revision || 0);
      const idbRev = Number(
        idbEnv?.revision ?? idbEnv?.snapshot?.revision ?? idbEnv?.snapshot?.data?.revision ?? 0
      );
      const shouldCheckCloudDuringHydrate =
        Boolean(status?.booted_fresh_seed) ||
        idbRev > serverRev ||
        hasMissingSnapshotUser ||
        hasMissingSnapshotData;

      if (shouldCheckCloudDuringHydrate && firebaseAuth.currentUser?.emailVerified) {
        try {
          cloudSync = await loadLiveSyncFromFirestore();
        } catch {}
      }

      const cloudData = cloudSync?.payload?.data || cloudSync?.payload || {};
      const cloudTasks = (Array.isArray(cloudData.tasks) ? cloudData.tasks : []).filter(
        (t: any) => !deletedTaskIds.has(getItemId(t, 'task_id')) && !isEntityDel(t, 'task_id')
      );
      const cloudBoards = (Array.isArray(cloudData.boards) ? cloudData.boards : []).filter(
        (b: any) => !isEntityDel(b, 'board_id')
      );
      const cloudPosts = (Array.isArray(cloudData.posts) ? cloudData.posts : []).filter(
        (p: any) => !isEntityDel(p, 'post_id')
      );
      const cloudNotes = (Array.isArray(cloudData.circle_notes) ? cloudData.circle_notes : []).filter(
        (n: any) => !isEntityDel(n, 'note_id')
      );
      const cloudMessages = (Array.isArray(cloudData.messages) ? cloudData.messages : []).filter(
        (m: any) => !isEntityDel(m)
      );
      const hasMissingCloudData =
        cloudTasks.some((t: any) => {
          const id = getItemId(t, 'task_id');
          return id && !serverTaskIds.has(id);
        }) ||
        cloudBoards.some((b: any) => {
          const id = getItemId(b, 'board_id');
          return id && !serverBoardIds.has(id);
        }) ||
        cloudPosts.some((p: any) => {
          const id = getItemId(p, 'post_id');
          return id && !serverPostIds.has(id);
        }) ||
        cloudNotes.some((n: any) => {
          const id = getItemId(n, 'note_id');
          return id && !serverNoteIds.has(id);
        }) ||
        cloudMessages.some((m: any) => {
          const id = getItemId(m);
          return id && !serverMessageIds.has(id);
        });

      const idbValid = Boolean(idbEnv?.snapshot && hasMeaningfulWorkspaceData(idbEnv.snapshot));
      const cloudValid = Boolean(cloudSync?.payload && hasMeaningfulWorkspaceData(cloudSync.payload));
      const cloudRev = Number(
        cloudSync?.payload?.revision ?? cloudSync?.payload?.data?.revision ?? 0
      );
      const bestMirrorRev = Math.max(idbRev, cloudRev);
      const needsFullHydrate =
        Boolean(status?.booted_fresh_seed) ||
        bestMirrorRev > serverRev ||
        hasMissingSnapshotUser ||
        hasMissingSnapshotData ||
        hasMissingCloudData;

      if (!needsFullHydrate && !hasMissingVaultAccount) {
        initialHydrateCompleted = true;
        return false;
      }

      let chosenPayload: any = null;
      let chosenSig: string | undefined;
      let chosenSource = 'indexeddb';
      let chosenRev = Math.max(idbRev, cloudRev);

      if (cloudValid && idbValid) {
        const cloudTasksLen = cloudTasks.length;
        const idbTasksLen = snapTasks.length;
        if (cloudTasksLen > idbTasksLen || cloudRev > idbRev) {
          chosenPayload = mergeTwoSnapshotsNonDestructive(
            cloudSync!.payload,
            idbEnv!.snapshot
          );
          chosenSource = 'firestore+indexeddb';
        } else {
          chosenPayload = mergeTwoSnapshotsNonDestructive(
            idbEnv!.snapshot,
            cloudSync!.payload
          );
          chosenSig = idbEnv!.snapshot_sig;
          chosenSource = 'indexeddb+firestore';
        }
      } else if (idbValid) {
        chosenPayload = idbEnv!.snapshot;
        chosenSig = idbEnv!.snapshot_sig;
        chosenSource = 'indexeddb';
      } else if (cloudValid) {
        chosenPayload = cloudSync!.payload;
        chosenSource = 'firestore';
      } else {
        chosenPayload = {
          app: 'ASLI Workspace',
          version: 2,
          data: {
            users: activeVaultAccounts,
          },
        };
        chosenSource = 'local_caches';
        chosenRev = 0;
      }

      const enrichedPayload = mergeHarvestIntoSnapshotPayload(chosenPayload, combinedHarvest);

      if (!hasMeaningfulWorkspaceData(enrichedPayload) && activeVaultAccounts.length === 0) {
        initialHydrateCompleted = true;
        return false;
      }

      const { data: res } = await api.post('/workspace/auto-hydrate', {
        snapshot: enrichedPayload,
        snapshot_sig: chosenSig,
        revision: chosenRev,
        known_accounts: mergeItemsById(activeVaultAccounts, combinedHarvest.users, 'user_id'),
        source: chosenSource,
      });

      initialHydrateCompleted = true;
      if (res?.restored) {
        lastSyncedRevision = Number(res.revision || 0);
        void syncWorkspaceMirror(api, false);
        return true;
      }
      return false;
    } catch {
      initialHydrateCompleted = true;
      return false;
    } finally {
      inFlightHydrate = null;
    }
  })();

  return inFlightHydrate;
}

export async function syncWorkspaceMirror(
  api: any,
  force = false,
  onPulledCloud?: () => void,
  manualForce = false
): Promise<{ pulledNewFromShared?: boolean } | null> {
  if (inFlightMirrorSync) {
    pendingResyncAfterFlight = true;
    if (force) pendingResyncForce = true;
    return inFlightMirrorSync;
  }

  inFlightMirrorSync = (async () => {
    let pulledNewFromShared = false;
    try {
      if (!initialHydrateCompleted) {
        await attemptAutoHydrateServer(api).catch(() => false);
      }

      const status = await fetchPersistenceStatus(api, Boolean(force || manualForce));
      const rev = Number(status?.revision || 0);
      const statusCounts = status?.counts || {};
      const currentUploadSig = `${rev}|${status?.last_mutated_at || ''}|${Number(statusCounts.tasks || 0)}|${Number(statusCounts.messages || 0)}|${Number(statusCounts.posts || 0)}|${Number(statusCounts.users || 0)}`;

      const serverDeletedTaskIds = Array.isArray(status?.deleted_task_ids)
        ? status.deleted_task_ids
        : [];
      if (serverDeletedTaskIds.length > 0) {
        recordDeletedTaskIds(serverDeletedTaskIds);
      }
      const deletedTaskIdSet = new Set(
        [...serverDeletedTaskIds, ...getLocalDeletedTaskIds()]
          .map((id: string) => String(id || '').trim())
          .filter(Boolean)
      );

      const serverTaskIds = new Set(
        Array.isArray(status?.task_ids)
          ? status.task_ids.map((id: string) => String(id || '').trim())
          : []
      );
      const idbEnv = await loadMirrorSnapshot();
      const idbTasks = idbEnv?.snapshot?.data?.tasks || idbEnv?.snapshot?.tasks || [];
      const bootHarvest = getBootHarvest();
      const hasLocalTasksMissingOnServer =
        (Array.isArray(idbTasks) &&
          idbTasks.some((t: any) => {
            const tid = getItemId(t, 'task_id');
            return tid && !deletedTaskIdSet.has(tid) && !serverTaskIds.has(tid);
          })) ||
        bootHarvest.tasks.some((t: any) => {
          const tid = getItemId(t, 'task_id');
          return tid && !deletedTaskIdSet.has(tid) && !serverTaskIds.has(tid);
        });

      if (hasLocalTasksMissingOnServer) {
        await attemptAutoHydrateServer(api).catch(() => false);
      }

      if (!force && !manualForce && rev > 0 && rev === lastSyncedRevision) {
        if (
          !firebaseAuth.currentUser?.emailVerified ||
          currentUploadSig === lastFirestoreUploadedSig ||
          isFirestoreQuotaPaused()
        ) {
          return { pulledNewFromShared: false };
        }
      }

      let currentEnvelope: PersistentMirrorEnvelope | null = idbEnv;
      if (rev !== lastSyncedRevision || !currentEnvelope?.snapshot || manualForce) {
        const { data } = await api.get('/workspace/persistent-snapshot');
        if (!data?.snapshot) return { pulledNewFromShared: false };

        currentEnvelope = {
          snapshot: data.snapshot,
          snapshot_sig: data.snapshot_sig,
          revision: Number(data.revision || rev || 1),
          last_mutated_at: data.last_mutated_at,
          saved_at: new Date().toISOString(),
        };
        await saveMirrorSnapshot(currentEnvelope);
        lastSyncedRevision = currentEnvelope.revision;
      }

      const serverPausedUntil = Number(status?.firestore_quota_paused_until || 0);
      if (serverPausedUntil > Date.now()) {
        syncServerQuotaPauseUntil(serverPausedUntil);
      }

      if (firebaseAuth.currentUser?.emailVerified && !isFirestoreQuotaPaused()) {
        const now = Date.now();
        const currentRev = Number(currentEnvelope?.revision || rev || 0);
        const latestMerged = await loadMirrorSnapshot();
        const snapshotToUpload = latestMerged?.snapshot || currentEnvelope?.snapshot;
        const hasUnsyncedSig = currentUploadSig !== lastFirestoreUploadedSig;
        const meaningfulData = hasMeaningfulWorkspaceData(snapshotToUpload);
        const FIRESTORE_AUTO_SYNC_INTERVAL_MS = 180000; // 3 min cooldown to preserve free-tier daily quota

        if (
          manualForce ||
          (meaningfulData && hasUnsyncedSig && now - lastFirestoreSyncAt >= FIRESTORE_AUTO_SYNC_INTERVAL_MS)
        ) {
          lastFirestoreSyncAt = now;
          const result = await saveLiveSyncToFirestore(snapshotToUpload, {
            manualForce,
          }).catch(() => {
            if (isFirestoreQuotaPaused()) {
              const until = getQuotaPauseUntilTimestamp();
              if (until > Date.now()) {
                void api?.post?.('/workspace/firestore-quota-pause', { paused_until: until }).catch(() => {});
              }
            }
            return null;
          });

          if (result) {
            lastFirestoreUploadedSig = currentUploadSig;
            writePersistedUploadedSig(currentUploadSig);
          }

          if (result?.pulledNewFromShared && result.mergedPayload) {
            pulledNewFromShared = true;
            await saveMirrorSnapshot({
              snapshot: result.mergedPayload,
              revision: Number(result.mergedPayload.revision || currentRev),
              saved_at: new Date().toISOString(),
            });
            await api
              .post('/workspace/auto-hydrate', {
                snapshot: result.mergedPayload,
                revision: Number(result.mergedPayload.revision || currentRev),
                source: 'firestore_shared_merge',
              })
              .catch(() => {});
            onPulledCloud?.();
          }
        }
      }
      return { pulledNewFromShared };
    } catch {
      return null;
    } finally {
      inFlightMirrorSync = null;
      if (pendingResyncAfterFlight) {
        const nextForce = pendingResyncForce;
        pendingResyncAfterFlight = false;
        pendingResyncForce = false;
        setTimeout(() => {
          void syncWorkspaceMirror(api, nextForce, onPulledCloud, false);
        }, 1000);
      }
    }
  })();

  return inFlightMirrorSync;
}

export function scheduleRealtimeCloudSync(
  api: any,
  delayMs = 4000,
  onPulledCloud?: () => void
) {
  if (realtimeSyncTimer) {
    clearTimeout(realtimeSyncTimer);
  }
  realtimeSyncTimer = setTimeout(() => {
    realtimeSyncTimer = null;
    void syncWorkspaceMirror(api, false, onPulledCloud, false);
  }, delayMs);
}
