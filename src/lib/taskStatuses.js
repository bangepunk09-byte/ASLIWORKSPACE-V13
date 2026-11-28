export const DEFAULT_TASK_STATUSES = [
  { key: "todo", name: "To Do", color: "#F0F4FA", is_done: false },
  { key: "in_progress", name: "In Progress", color: "#EEF2FF", is_done: false },
  { key: "in_review", name: "In Review", color: "#FEF3C7", is_done: false },
  { key: "done", name: "Done", color: "#DCFCE7", is_done: true },
];

export function normalizeTaskStatusList(arr, fallbackToDefault = true) {
  const source = Array.isArray(arr) && arr.length > 0 ? arr : fallbackToDefault ? DEFAULT_TASK_STATUSES : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const raw = source[i];
    if (!raw) continue;
    let item;
    if (typeof raw === "string") {
      const key = raw.trim();
      if (!key) continue;
      item = {
        key,
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        color: key === "done" ? "#DCFCE7" : "#F0F4FA",
        is_done: key === "done",
      };
    } else {
      const rawKey = String(raw.key || "").trim();
      const rawName = String(raw.name || "").trim();
      const key = rawKey || (rawName ? rawName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : `st_${i + 1}`);
      if (!key) continue;
      item = {
        key,
        name: rawName || key.replace(/_/g, " "),
        color: raw.color || "#F0F4FA",
        is_done: Boolean(raw.is_done || key === "done"),
      };
    }
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out.length > 0 ? out : fallbackToDefault ? DEFAULT_TASK_STATUSES : [];
}

export function findDivisionStatusEntry(divisionMap, division) {
  if (!divisionMap || typeof divisionMap !== "object" || !division) return null;
  const target = String(division).trim().toLowerCase();
  if (!target || target === "__default__") return null;
  for (const [k, v] of Object.entries(divisionMap)) {
    if (String(k || "").trim().toLowerCase() === target && Array.isArray(v) && v.length > 0) {
      return { key: k, list: normalizeTaskStatusList(v, false) };
    }
  }
  return null;
}

export function getDivisionTaskStatuses(ws, division) {
  const entry = findDivisionStatusEntry(ws?.division_task_statuses, division);
  if (entry && entry.list.length > 0) {
    return entry.list;
  }
  return normalizeTaskStatusList(ws?.task_statuses, true);
}

export function getAllKnownTaskStatuses(ws) {
  const base = normalizeTaskStatusList(ws?.task_statuses, true);
  const map = new Map();
  base.forEach((s) => map.set(s.key, s));
  const divMap = ws?.division_task_statuses;
  if (divMap && typeof divMap === "object") {
    Object.values(divMap).forEach((arr) => {
      normalizeTaskStatusList(arr, false).forEach((s) => {
        if (!map.has(s.key)) map.set(s.key, s);
      });
    });
  }
  return Array.from(map.values());
}

export function collectWorkspaceDivisions(ws, users = [], boards = []) {
  const byLower = new Map();
  const add = (val) => {
    const clean = String(val || "").trim();
    if (!clean) return;
    const low = clean.toLowerCase();
    if (["umum", "general", "semua", "all", "kolaborasi", "proyek"].includes(low)) return;
    if (!byLower.has(low)) byLower.set(low, clean);
  };
  if (Array.isArray(ws?.divisions)) {
    ws.divisions.forEach((d) => add(typeof d === "string" ? d : d?.name));
  }
  if (Array.isArray(boards)) {
    boards.forEach((b) => add(b?.department));
  }
  if (Array.isArray(users)) {
    users.forEach((u) => {
      if (u && !u.is_bot && u.role !== "assistant") add(u.department);
    });
  }
  if (ws?.division_task_statuses && typeof ws.division_task_statuses === "object") {
    Object.keys(ws.division_task_statuses).forEach((k) => add(k));
  }
  return Array.from(byLower.values()).sort((a, b) => a.localeCompare(b, "id"));
}
