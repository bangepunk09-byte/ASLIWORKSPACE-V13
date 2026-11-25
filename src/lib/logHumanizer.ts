type UserLike = {
  user_id?: string;
  name?: string;
  email?: string;
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Mendesak",
};

const MONTH_SHORT_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

function formatDateFriendly(raw: string): string {
  const s = String(raw || "").trim();
  if (!s || s === "Kosong" || s === "null" || s === "undefined") return "tanpa tenggat";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const monthName = MONTH_SHORT_ID[monthIdx] || m[2];
  if (m[4] && m[5]) {
    return `${day} ${monthName} ${year}, ${m[4]}:${m[5]}`;
  }
  return `${day} ${monthName} ${year}`;
}

function splitListItems(raw: string): string[] {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && x !== "Kosong" && x !== "Unassigned" && x !== "—");
}

function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} & ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, & ${items[items.length - 1]}`;
}

export function resolveRawUserTokens(
  text: string,
  userMap?: Record<string, UserLike> | Map<string, UserLike> | UserLike[]
): string {
  if (!text) return "";
  const lookup = (uid: string): string | null => {
    const clean = uid.trim();
    if (!clean) return null;
    if (Array.isArray(userMap)) {
      const found = userMap.find((u) => u?.user_id === clean || u?.email === clean);
      return found?.name || null;
    }
    if (userMap instanceof Map) {
      return userMap.get(clean)?.name || null;
    }
    if (userMap && typeof userMap === "object") {
      return userMap[clean]?.name || null;
    }
    return null;
  };

  return String(text).replace(
    /\b(user_google_\d+|user_superadmin_[a-z0-9_]+|user_admin\d+|user_[a-z0-9_]{6,})\b/gi,
    (match) => lookup(match) || "Anggota Tim"
  );
}

export function resolveActorName(
  actorId?: string | null,
  actorName?: string | null,
  userMap?: Record<string, UserLike> | Map<string, UserLike> | UserLike[]
): string {
  const fromMap = (() => {
    if (!actorId) return null;
    if (Array.isArray(userMap)) return userMap.find((u) => u?.user_id === actorId)?.name || null;
    if (userMap instanceof Map) return userMap.get(actorId)?.name || null;
    if (userMap && typeof userMap === "object") return userMap[actorId]?.name || null;
    return null;
  })();

  if (fromMap && !/^user_[a-z0-9_]+$/i.test(fromMap)) {
    return fromMap;
  }

  const rawName = String(actorName || "").trim();
  if (!rawName || /^user_[a-z0-9_]+$/i.test(rawName)) {
    return "Anggota Tim";
  }
  return resolveRawUserTokens(rawName, userMap);
}

export function humanizeLogAction(
  rawAction: string,
  userMap?: Record<string, UserLike> | Map<string, UserLike> | UserLike[]
): string {
  let s = resolveRawUserTokens(String(rawAction || "").trim(), userMap);
  if (!s) return "";

  // 1. "membuat tugas baru: TSK-090 - ID Card Security" -> 'membuat tugas baru "ID Card Security" (TSK-090)'
  let m = s.match(/^membuat tugas baru:\s*([A-Z0-9-]+)\s*-\s*(.+)$/i);
  if (m) {
    return `membuat tugas baru "${m[2].trim()}" (${m[1].trim()})`;
  }

  // 2. "mengubah Assignee tugas (TSK-089) — Dari [A] menjadi [B]"
  m = s.match(/^mengubah Assignee tugas\s*\(([^)]+)\)\s*[—-]\s*Dari\s*\[([^\]]*)\]\s*menjadi\s*\[([^\]]*)\]$/i);
  if (m) {
    const taskRef = m[1].trim();
    const oldList = splitListItems(m[2]);
    const newList = splitListItems(m[3]);
    const added = newList.filter((x) => !oldList.includes(x));
    const removed = oldList.filter((x) => !newList.includes(x));
    if (newList.length === 0) {
      return `mengosongkan pelaksana tugas ${taskRef}`;
    }
    if (added.length > 0 && removed.length === 0) {
      return `menugaskan ${joinNatural(added)} pada ${taskRef}`;
    }
    if (removed.length > 0 && added.length === 0) {
      return `melepas ${joinNatural(removed)} dari pelaksana ${taskRef}`;
    }
    if (oldList.length === 0) {
      return `menugaskan ${joinNatural(newList)} pada ${taskRef}`;
    }
    return `mengalihkan pelaksana ${taskRef} dari ${joinNatural(oldList)} ke ${joinNatural(newList)}`;
  }

  // 3. "memperbarui daftar Requestor (TSK-089) — Dari [A] menjadi [B]"
  m = s.match(/^memperbarui daftar Requestor\s*\(([^)]+)\)\s*[—-]\s*Dari\s*\[([^\]]*)\]\s*menjadi\s*\[([^\]]*)\]$/i);
  if (m) {
    const taskRef = m[1].trim();
    const oldList = splitListItems(m[2]);
    const newList = splitListItems(m[3]);
    const added = newList.filter((x) => !oldList.includes(x));
    const removed = oldList.filter((x) => !newList.includes(x));
    if (newList.length === 0) {
      return `mengosongkan daftar pemohon pada ${taskRef}`;
    }
    if (added.length > 0 && removed.length === 0) {
      return `menambahkan ${joinNatural(added)} sebagai pemohon di ${taskRef}`;
    }
    if (removed.length > 0 && added.length === 0) {
      return `menghapus ${joinNatural(removed)} dari pemohon ${taskRef}`;
    }
    if (oldList.length === 0) {
      return `menetapkan ${joinNatural(newList)} sebagai pemohon di ${taskRef}`;
    }
    return `mengubah pemohon ${taskRef} menjadi ${joinNatural(newList)}`;
  }

  // 4. "mengubah IP / Brand label (TSK-089) — Dari [A] menjadi [B]"
  m = s.match(/^mengubah IP\s*\/\s*Brand label\s*\(([^)]+)\)\s*[—-]\s*Dari\s*\[([^\]]*)\]\s*menjadi\s*\[([^\]]*)\]$/i);
  if (m) {
    const taskRef = m[1].trim();
    const newList = splitListItems(m[3]);
    if (newList.length === 0) return `menghapus label dari ${taskRef}`;
    return `memperbarui label ${taskRef} menjadi ${joinNatural(newList)}`;
  }

  // 5. "mengubah judul tugas (TSK-088) — Dari "A" menjadi "B""
  m = s.match(/^mengubah judul tugas\s*\(([^)]+)\)\s*[—-]\s*Dari\s*"([^"]*)"\s*menjadi\s*"([^"]*)"$/i);
  if (m) {
    return `mengganti judul ${m[1].trim()} menjadi "${m[3].trim()}"`;
  }

  // 6. "mengubah tenggat waktu (deadline) dari "X" ke "Y" (TSK-088)"
  m = s.match(/^mengubah tenggat waktu \(deadline\) dari "([^"]*)" ke "([^"]*)"\s*\(([^)]+)\)$/i);
  if (m) {
    const newD = formatDateFriendly(m[2]);
    return newD === "tanpa tenggat"
      ? `menghapus tenggat waktu ${m[3].trim()}`
      : `mengatur deadline ${m[3].trim()} ke ${newD}`;
  }

  // 7. "mengubah status tugas dari "X" ke "Y" (TSK-088)"
  m = s.match(/^mengubah status tugas dari "([^"]*)" ke "([^"]*)"\s*\(([^)]+)\)$/i);
  if (m) {
    return `memindahkan status ${m[3].trim()} dari ${m[1]} ke ${m[2]}`;
  }

  // 8. "mengubah prioritas tugas dari "X" ke "Y" (TSK-088)"
  m = s.match(/^mengubah prioritas tugas dari "([^"]*)" ke "([^"]*)"\s*\(([^)]+)\)$/i);
  if (m) {
    const pLabel = PRIORITY_LABELS[m[2].toLowerCase()] || m[2];
    return `mengubah prioritas ${m[3].trim()} menjadi ${pLabel}`;
  }

  // 9. "memindahkan tugas dari board "X" ke "Y" (TSK-088)"
  m = s.match(/^memindahkan tugas dari board "([^"]*)" ke "([^"]*)"\s*\(([^)]+)\)$/i);
  if (m) {
    return `memindahkan ${m[3].trim()} ke board ${m[2]}`;
  }

  // 10. Checkpoint wording cleanup
  s = s.replace(/membuka kembali \(uncheck\) checkpoint/gi, "membuka kembali tahap");
  s = s.replace(/menyelesaikan checkpoint "([^"]+)" pada tugas\s*\(([^)]+)\)/gi, 'menyelesaikan tahap "$1" di $2');
  s = s.replace(/menghapus checkpoint "([^"]+)"\s*\(([^)]+)\)/gi, 'menghapus tahap "$1" dari $2');
  s = s.replace(/menambahkan checkpoint baru "([^"]+)"\s*\(([^)]+)\)(?:\s*[—-]\s*PIC:\s*(.+))?/gi, (_all, cp, tRef, pic) =>
    pic ? `menambahkan tahap "${cp}" di ${tRef} untuk ${pic}` : `menambahkan tahap "${cp}" di ${tRef}`
  );
  s = s.replace(/memulihkan \(unarchive\) tugas kembali ke board aktif\s*\(([^)]+)\)/gi, "mengembalikan tugas $1 ke board aktif");
  s = s.replace(/mengarsipkan tugas ke folder ([^\s(]+)\s*\(([^)]+)\)/gi, "mengarsipkan tugas $2 ($1)");

  // 11. Strip technical crypto/internal jargon from security logs
  s = s.replace(/\s*\(scrypt\)/gi, "");
  s = s.replace(/\s*\(AES-256-GCM\)/gi, "");
  s = s.replace(/\bpassword\b/gi, "kata sandi");

  return s;
}
