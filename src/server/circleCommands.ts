import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { CIRCLE_FEATURE_CATALOG } from "./circleCatalog";
import {
  buildTaskReportPayload,
  buildSummaryReportPayload,
  type AssistantReportPayload
} from "./assistantReports";

const WIB_OFFSET_MS = 7 * 3600000;

export interface CircleReplyEffects {
  createdTask?: any;
  tasksChanged?: boolean;
  updatedTask?: any;
  projectsChanged?: boolean;
  remindersChanged?: boolean;
  meetingsChanged?: boolean;
  meetingNew?: any;
  postsChanged?: boolean;
  postNew?: any;
  pollsChanged?: boolean;
  notificationsChanged?: boolean;
  needsSave?: boolean;
  pendingAssignmentInvite?: { task: any; userIds: string[] };
}

export interface CircleCommandResult {
  handled: boolean;
  text: string;
  createdTask?: any;
  effects?: CircleReplyEffects;
  report?: AssistantReportPayload | null;
}

function getWibParts(dt: Date) {
  const wib = new Date(dt.getTime() + WIB_OFFSET_MS);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth() + 1,
    day: wib.getUTCDate(),
    hour: wib.getUTCHours(),
    minute: wib.getUTCMinutes(),
    isoDate: wib.toISOString().slice(0, 10)
  };
}

function makeWibIso(year: number, month: number, day: number, hour = 17, minute = 0): string {
  const utcMs = Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0);
  return new Date(utcMs).toISOString();
}

export function parseNaturalDateTime(rawInput: string, now = new Date(), defaultHour = 17, defaultMinute = 0): { iso: string; dateStr: string; timeStr: string } | null {
  const raw = String(rawInput || "").trim().toLowerCase();
  if (!raw) return null;

  let hour = defaultHour;
  let minute = defaultMinute;
  const timeMatch = raw.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (timeMatch) {
    hour = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)));
    minute = Math.min(59, Math.max(0, parseInt(timeMatch[2], 10)));
  }

  const baseWib = getWibParts(now);
  let targetDate = new Date(Date.UTC(baseWib.year, baseWib.month - 1, baseWib.day));

  const plusDaysMatch = raw.match(/\+\s*(\d+)\s*(hari|hr|h|day|days)?/i);
  const ymdMatch = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const dmyMatch = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);

  if (ymdMatch) {
    targetDate = new Date(Date.UTC(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10)));
  } else if (dmyMatch) {
    targetDate = new Date(Date.UTC(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10)));
  } else if (plusDaysMatch) {
    targetDate.setUTCDate(targetDate.getUTCDate() + parseInt(plusDaysMatch[1], 10));
  } else if (/\b(lusa)\b/.test(raw)) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 2);
  } else if (/\b(besok|tomorrow|bsk)\b/.test(raw)) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  } else if (/\b(hari ini|today|nanti|malam ini|sore ini)\b/.test(raw)) {
    // keep today
  } else if (!timeMatch) {
    return null;
  }

  const y = targetDate.getUTCFullYear();
  const m = targetDate.getUTCMonth() + 1;
  const d = targetDate.getUTCDate();
  const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    iso: makeWibIso(y, m, d, hour, minute),
    dateStr,
    timeStr
  };
}

function findTaskByRef(db: Record<string, any>, refRaw: string): any | null {
  const ref = String(refRaw || "").trim();
  if (!ref) return null;
  const tasks = Array.isArray(db.tasks) ? db.tasks : [];
  const clean = ref.toLowerCase();

  // Direct ID or number_str (TSK-001 / T-001)
  const exact = tasks.find((t: any) =>
    String(t.id || "").toLowerCase() === clean ||
    String(t.number_str || "").toLowerCase() === clean ||
    (t.number !== undefined && (`t-${t.number}` === clean || `tsk-${String(t.number).padStart(3, "0")}` === clean || String(t.number) === clean))
  );
  if (exact) return exact;

  // Numeric suffix match
  const numMatch = clean.match(/^(?:tsk|t)[-_]?0*(\d+)$/i);
  if (numMatch) {
    const numVal = parseInt(numMatch[1], 10);
    const byNum = tasks.find((t: any) => {
      if (Number(t.number) === numVal) return true;
      const m = String(t.number_str || "").match(/0*(\d+)$/);
      return m ? parseInt(m[1], 10) === numVal : false;
    });
    if (byNum) return byNum;
  }

  // Fallback partial title match
  return tasks.find((t: any) => String(t.title || "").toLowerCase().includes(clean)) || null;
}

function findHumanUserByRef(db: Record<string, any>, refRaw: string): any | null {
  const ref = String(refRaw || "").trim().replace(/^@/, "").toLowerCase();
  if (!ref) return null;
  const humans = (Array.isArray(db.users) ? db.users : []).filter(
    (u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
  return (
    humans.find((u: any) => String(u.user_id).toLowerCase() === ref || String(u.email || "").toLowerCase() === ref) ||
    humans.find((u: any) => String(u.name || "").toLowerCase() === ref) ||
    humans.find((u: any) => String(u.name || "").toLowerCase().includes(ref) || String(u.email || "").toLowerCase().includes(ref)) ||
    null
  );
}

function safeCalculateExpression(rawInput: string): { result: number; formatted: string; normalized: string } | null {
  const cleaned = String(rawInput || "")
    .replace(/rp\.?\s*/gi, "")
    .replace(/idr\s*/gi, "")
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, "($1/100)")
    .replace(/,/g, "")
    .replace(/\bx\b/gi, "*")
    .replace(/[×]/g, "*")
    .replace(/[÷]/g, "/")
    .trim();

  if (!cleaned || !/^[\d+\-*/().\s]+$/.test(cleaned)) return null;

  let pos = 0;
  const skipWs = () => {
    while (pos < cleaned.length && /\s/.test(cleaned[pos])) pos++;
  };

  const parseExpr = (): number => {
    let val = parseTerm();
    skipWs();
    while (pos < cleaned.length && (cleaned[pos] === "+" || cleaned[pos] === "-")) {
      const op = cleaned[pos++];
      const rhs = parseTerm();
      val = op === "+" ? val + rhs : val - rhs;
      skipWs();
    }
    return val;
  };

  const parseTerm = (): number => {
    let val = parseFactor();
    skipWs();
    while (pos < cleaned.length && (cleaned[pos] === "*" || cleaned[pos] === "/")) {
      const op = cleaned[pos++];
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new Error("Pembagian dengan nol tidak diizinkan.");
        val = val / rhs;
      } else {
        val = val * rhs;
      }
      skipWs();
    }
    return val;
  };

  const parseFactor = (): number => {
    skipWs();
    if (cleaned[pos] === "+") {
      pos++;
      return parseFactor();
    }
    if (cleaned[pos] === "-") {
      pos++;
      return -parseFactor();
    }
    if (cleaned[pos] === "(") {
      pos++;
      const val = parseExpr();
      skipWs();
      if (cleaned[pos] !== ")") throw new Error("Kurung tidak seimbang.");
      pos++;
      return val;
    }
    const start = pos;
    while (pos < cleaned.length && /[\d.]/.test(cleaned[pos])) pos++;
    if (start === pos) throw new Error("Ekspresi angka tidak valid.");
    const num = Number(cleaned.slice(start, pos));
    if (!Number.isFinite(num)) throw new Error("Angka tidak valid.");
    return num;
  };

  try {
    const res = parseExpr();
    skipWs();
    if (pos < cleaned.length || !Number.isFinite(res)) return null;
    const rounded = Math.round(res * 10000) / 10000;
    return {
      result: rounded,
      formatted: new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(rounded),
      normalized: cleaned
    };
  } catch {
    return null;
  }
}

async function tryGeminiAssist(
  aiClient: GoogleGenAI | null,
  systemInstruction: string,
  userPrompt: string,
  fallbackText: string
): Promise<string> {
  if (!aiClient) return fallbackText;
  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: userPrompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });
    const out = response.text?.trim();
    return out && out.length > 0 ? out : fallbackText;
  } catch {
    return fallbackText;
  }
}

function getGuideResponse(topicRaw: string): string {
  const topic = String(topicRaw || "").toLowerCase().trim();
  const guides: Array<{ match: RegExp; title: string; body: string }> = [
    {
      match: /(backup|restore|cadangan|pulihkan)/,
      title: "Panduan Auto Backup Harian & Restore",
      body: [
        `• **Auto Backup Harian**: Server mencadangkan seluruh database workspace setiap hari pukul **23:59 WIB** secara otomatis.`,
        `• **Struktur Folder Rapi**: Tersimpan terurut per \`Tahun / Bulan / DD-MM-YYYY\` pada menu **Pengaturan -> Backup & Restore**.`,
        `• **Manual & Restore**: Anda juga bisa memicu \`Backup Hari Ini Sekarang\`, mengunduh JSON arsip harian, atau melakukan Restore kapan saja tanpa kehilangan akun/chat.`
      ].join("\n")
    },
    {
      match: /(task|tugas|kanban|list|timeline|kalender|calendar|kolom|board)/,
      title: "Panduan Manajemen Tugas (Board, List, Timeline, Calendar)",
      body: [
        `• **4 Tampilan Database**: Ganti tampilan melalui switcher **Board | List | Timeline | Calendar** di kanan toolbar Tugas.`,
        `• **Checkpoints & Subtugas**: Buka kartu tugas untuk menambahkan tahap Checkpoint (dengan PIC & tenggat per tahap) yang otomatis menghitung progres %.`,
        `• **2-Person Approval**: Gunakan tombol *Kirim Approval* ke grup chat—ketika minimal 2 reviewer meng-approve (50% → 100%), status otomatis berpindah ke **Done**.`,
        `• **Kendala (Blocker)**: Tandai komentar sebagai *Kendala* agar langsung terdeteksi oleh manajer & Asisten ASLI.`
      ].join("\n")
    },
    {
      match: /(chat|pesan|polling|stiker|grup)/,
      title: "Panduan Chatting, Stiker Kustom & Polling Grup",
      body: [
        `• **Polling Grup & Beranda**: Klik ikon grafik batang di komposer grup atau ketik \`/poll\` di Asli untuk voting cepat.`,
        `• **Stiker Kustom**: Buka ikon Stiker -> tombol **+ Bikin** untuk membuat stiker teks/emoji atau unggah gambar sendiri.`,
        `• **Konversi Pesan ke Tugas**: Klik menu titik tiga pada pesan chat lalu pilih *Buat Tugas* untuk menyalin konteks obrolan ke papan tugas.`
      ].join("\n")
    },
    {
      match: /(akses|role|izin|admin|approval|reset|password|divisi)/,
      title: "Panduan Role, Approval Akses & Organisasi",
      body: [
        `• **Role Workspace**: Tersedia *Super Admin*, *Workspace Admin*, *Department Manager*, *Project Manager*, dan *Employee*.`,
        `• **Approval Masuk & Reset PW**: Permintaan akun baru & reset password dikirim otomatis ke kartu approval di chat Manager/Super Admin.`,
        `• **Board Divisi Otomatis**: Setiap divisi baru otomatis memiliki board terintegrasi dan kontrol anggota terundang.`
      ].join("\n")
    }
  ];

  const found = topic ? guides.find((g) => g.match.test(topic)) : null;
  if (found) {
    return `📘 **${found.title}**\n\n${found.body}`;
  }

  return [
    `📘 **Product Knowledge Center — ASLI Workspace**`,
    ``,
    `1. **Manajemen Tugas 4-View** — Board Kanban, List (kustomisasi kolom), Timeline Gantt, dan Calendar.`,
    `2. **Kolaborasi Real-Time** — DM, Grup Divisi Terverifikasi, Polling, Stiker Kustom, Beranda Feed & Hashtag Trending.`,
    `3. **Jadwal & Google Workspace** — Agenda Meeting internal & sinkronisasi jadwal tim.`,
    `4. **Keamanan & Auto Backup** — Penyimpanan permanen JSON/Firestore + Auto Backup harian jam **23:59 WIB** (\`Tahun/Bulan/Hari-Bulan-Tahun\`).`,
    `5. **ASLI AI Copilot (60+ Fitur)** — Eksekusi tugas, analitik load tim, KPI/SLA, notulensi MoM, brief konten, dan terjemahan bisnis.`,
    ``,
    `_Ketik \`/guide task\`, \`/guide backup\`, \`/guide chat\`, atau \`/guide akses\` untuk detail fitur tertentu._`
  ].join("\n");
}

function addTaskActivity(db: Record<string, any>, task: any, actorId: string, action: string, detail?: string) {
  const act = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    actor_id: actorId,
    action,
    detail,
    task_id: task.id,
    task_title: task.title,
    created_at: new Date().toISOString()
  };
  task.activity = Array.isArray(task.activity) ? task.activity : [];
  task.activity.unshift(act);
  db.activity = Array.isArray(db.activity) ? db.activity : [];
  db.activity.unshift(act);
}

export async function tryExecuteCircleCommand(params: {
  question: string;
  db: Record<string, any>;
  senderUser: any;
  intel: any;
  now: Date;
  aiClient: GoogleGenAI | null;
  formatWibDateTime: (iso?: string | null) => string;
}): Promise<CircleCommandResult> {
  const { question, db, senderUser, intel, now, aiClient, formatWibDateTime } = params;
  const trimmed = (question || "").trim();
  const lower = trimmed.toLowerCase();
  const actorId = senderUser?.user_id || "user_admin1";
  const actorName = senderUser?.name || "Pengguna";

  // Helper to split command & args
  const isSlash = trimmed.startsWith("/");
  const firstSpace = trimmed.search(/\s/);
  const cmdToken = isSlash ? (firstSpace === -1 ? lower : lower.slice(0, firstSpace)) : "";
  const argRaw = isSlash ? (firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim()) : trimmed;
  const partsPipe = argRaw.split("|").map((s) => s.trim());

  // =========================================================================
  // 1. /help — Daftar Lengkap Fitur ASLI AI
  // =========================================================================
  if (cmdToken === "/help" || lower === "daftar fitur asli" || lower === "perintah asli" || lower === "daftar fitur circle" || lower === "perintah circle") {
    const groups = new Map<string, typeof CIRCLE_FEATURE_CATALOG>();
    CIRCLE_FEATURE_CATALOG.forEach((f) => {
      if (!groups.has(f.category)) groups.set(f.category, []);
      groups.get(f.category)!.push(f);
    });
    const sections = Array.from(groups.entries()).map(([cat, items]) => {
      const lines = items.map((i) => `• \`${i.command}\` — **${i.title}**`);
      return `**${cat} (${items.length})**\n${lines.join("\n")}`;
    });
    return {
      handled: true,
      text: [
        `🚀 **Katalog Lengkap ASLI AI (${CIRCLE_FEATURE_CATALOG.length} Fitur Siap Pakai)**`,
        `Anda bisa langsung mengetik perintah di bawah atau membuka tombol **Fitur ASLI AI** di layar chat.`,
        ``,
        ...sections
      ].join("\n\n")
    };
  }

  // =========================================================================
  // 2. /task — Smart Task Creation (@nama, !priority, #brand, deadline ...)
  // =========================================================================
  if (cmdToken === "/task" || lower.startsWith("buat task") || lower.startsWith("buatkan tugas")) {
    let body = isSlash ? argRaw : trimmed.replace(/^(buat task|buatkan tugas)\s*/i, "").trim();

    // Parse priority (!urgent, !high, !medium, !low)
    let priority = "medium";
    const prioMatch = body.match(/!(urgent|high|medium|low)\b/i);
    if (prioMatch) {
      priority = prioMatch[1].toLowerCase();
      body = body.replace(prioMatch[0], " ").trim();
    }

    // Parse assignee (@nama)
    const assigneeIds: string[] = [];
    const mentionMatches = [...body.matchAll(/@([^\s!#|]+)/g)];
    for (const m of mentionMatches) {
      const matchedUser = findHumanUserByRef(db, m[1]);
      if (matchedUser && !assigneeIds.includes(matchedUser.user_id)) {
        assigneeIds.push(matchedUser.user_id);
      }
      body = body.replace(m[0], " ").trim();
    }
    if (assigneeIds.length === 0 && actorId !== "user_circle_assistant") {
      assigneeIds.push(actorId);
    }

    // Parse brand/label (#label)
    const labelIds: string[] = [];
    const tagMatches = [...body.matchAll(/#([\w-]+)/g)];
    for (const m of tagMatches) {
      const rawTag = m[1].replace(/[_-]/g, " ").toLowerCase();
      const matchedLbl = (db.labels || []).find((l: any) =>
        String(l.name || "").toLowerCase().includes(rawTag)
      );
      if (matchedLbl) labelIds.push(matchedLbl.id);
      body = body.replace(m[0], " ").trim();
    }

    // Parse deadline phrase (`deadline ...` or `dl ...`)
    let deadlineIso: string | null = null;
    const dlMatch = body.match(/\b(?:deadline|dl|tenggat)\s+([^!@#]+)$/i);
    if (dlMatch) {
      const parsedDl = parseNaturalDateTime(dlMatch[1], now, 17, 0);
      if (parsedDl) {
        deadlineIso = parsedDl.iso;
        body = body.replace(dlMatch[0], " ").trim();
      }
    }

    // Parse explicit board in [BoardName]
    let matchedBoard = (db.boards || []).find(
      (b: any) => senderUser?.department && String(b.department || b.name || "").toLowerCase() === String(senderUser.department).toLowerCase()
    );
    const brdMatch = body.match(/\[([^\]]+)\]/);
    if (brdMatch) {
      const targetB = (db.boards || []).find((b: any) =>
        String(b.name || b.department || "").toLowerCase().includes(brdMatch[1].toLowerCase())
      );
      if (targetB) matchedBoard = targetB;
      body = body.replace(brdMatch[0], " ").trim();
    }

    const cleanTitle = body.replace(/\s+/g, " ").trim() || "Tugas Baru dari Asli";
    let maxTsk = 0;
    for (const tk of (db.tasks || [])) {
      const m = typeof tk?.number_str === "string" ? tk.number_str.match(/TSK-(\d+)/i) : null;
      const n = m ? Number(m[1]) : Number(tk?.number || 0);
      if (Number.isFinite(n) && n > maxTsk) maxTsk = n;
    }
    const nextNum = Math.max(maxTsk + 1, (db.tasks?.length || 0) + 1);
    const newTaskId = `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const immediateAssigneeIds = assigneeIds.filter((uid: string) => uid === actorId);
    const pendingInviteIds = assigneeIds.filter((uid: string) => uid !== actorId);
    const primaryPic = immediateAssigneeIds[0] || null;
    const newTask = {
      id: newTaskId,
      number: nextNum,
      number_str: `TSK-${String(nextNum).padStart(3, "0")}`,
      title: cleanTitle,
      description: "",
      status: "todo",
      priority,
      board_id: matchedBoard?.id || db.boards?.[0]?.id || "brd_div_marketing",
      department: matchedBoard?.department || senderUser?.department || "Marketing",
      assignee_id: primaryPic,
      assignee_ids: immediateAssigneeIds,
      pending_assignees: [],
      requestor_id: actorId,
      requestor_ids: [actorId],
      reviewer_ids: [actorId],
      label_ids: labelIds,
      deadline: deadlineIso,
      checkpoints: [],
      subtasks: [],
      comments: [],
      attachments: [],
      activity: [],
      progress: 0,
      archived: false,
      approvals: { needed: 2, approved_by: [], status: "pending" },
      created_by: actorId,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    addTaskActivity(db, newTask, actorId, `membuat tugas baru "${newTask.title}" melalui Asisten ASLI`);
    db.tasks.unshift(newTask);

    const activePicNames = immediateAssigneeIds.map((uid) => findHumanUserByRef(db, uid)?.name || uid).join(", ");
    const pendingPicNames = pendingInviteIds.map((uid) => findHumanUserByRef(db, uid)?.name || uid).join(", ");
    const picSummary = pendingPicNames
      ? (activePicNames ? `${activePicNames} · Menunggu konfirmasi japri: ${pendingPicNames}` : `Menunggu konfirmasi japri (${pendingPicNames})`)
      : (activePicNames || "Belum di-assign");
    return {
      handled: true,
      createdTask: newTask,
      effects: {
        createdTask: newTask,
        tasksChanged: true,
        needsSave: true,
        ...(pendingInviteIds.length > 0 ? { pendingAssignmentInvite: { task: newTask, userIds: pendingInviteIds } } : {}),
      },
      text: [
        `✨ **Tugas Baru Berhasil Dibuat oleh Asli!**`,
        ``,
        `📌 **${newTask.number_str}: ${newTask.title}**`,
        `• Status: **To Do** · Prioritas: **${priority.toUpperCase()}**`,
        `• Board: **${matchedBoard?.name || newTask.department}** · PIC: **${picSummary}**`,
        ...(deadlineIso ? [`• Deadline: **${formatWibDateTime(deadlineIso)}**`] : []),
        ...(labelIds.length ? [`• Brand/Label: **${labelIds.map((id) => (db.labels || []).find((l: any) => l.id === id)?.name || id).join(", ")}**`] : []),
        ``,
        pendingPicNames
          ? `💡 _Kartu tugas sudah dibuat tanpa nama PIC. Box approval terima/tolak telah dikirim lewat japri ke ${pendingPicNames}._`
          : `💡 _Kartu tugas sudah langsung masuk ke menu Tugas secara real-time._`
      ].join("\n")
    };
  }

  // =========================================================================
  // 3. /subtask [TSK-xxx] | [judul]
  // =========================================================================
  if (cmdToken === "/subtask") {
    const task = findTaskByRef(db, partsPipe[0]);
    const subTitle = partsPipe.slice(1).join(" | ").trim();
    if (!task || !subTitle) {
      return { handled: true, text: `⚠️ Format: \`/subtask TSK-001 | Judul subtugas\`\nPastikan kode/judul tugas dan isi subtugas lengkap.` };
    }
    task.subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const sub = { id: `sub_${Date.now()}`, title: subTitle, done: false };
    task.subtasks.push(sub);
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `menambahkan subtugas "${subTitle}" via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `✅ Subtugas **"${subTitle}"** berhasil ditambahkan ke **${task.number_str} (${task.title})**. Total subtugas sekarang: **${task.subtasks.length}**.`
    };
  }

  // =========================================================================
  // 4. /checkpoint [TSK-xxx] | [judul]
  // =========================================================================
  if (cmdToken === "/checkpoint") {
    const task = findTaskByRef(db, partsPipe[0]);
    const cpTitle = partsPipe.slice(1).join(" | ").trim();
    if (!task || !cpTitle) {
      return { handled: true, text: `⚠️ Format: \`/checkpoint TSK-001 | Judul checkpoint\`` };
    }
    task.checkpoints = Array.isArray(task.checkpoints) ? task.checkpoints : [];
    task.checkpoints.push({
      id: `cp_${Date.now()}`,
      title: cpTitle,
      assignee_id: task.assignee_id || actorId,
      deadline: task.deadline || "",
      done: false
    });
    const doneCount = task.checkpoints.filter((c: any) => c.done).length;
    const approvedCount = Array.isArray(task.approvals?.approved_by)
      ? task.approvals.approved_by.length
      : Array.isArray(task.approval?.approved_by)
      ? task.approval.approved_by.length
      : 0;
    if (approvedCount >= 2) {
      task.status = "done";
      task.progress = 100;
    } else {
      task.progress = Math.round((doneCount / task.checkpoints.length) * 100);
    }
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `menambahkan checkpoint "${cpTitle}" via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `🎯 Checkpoint **"${cpTitle}"** ditambahkan ke **${task.number_str} (${task.title})**. Progres tugas saat ini: **${task.progress}%** (${doneCount}/${task.checkpoints.length} selesai).`
    };
  }

  // =========================================================================
  // 5. /done [TSK-xxx]
  // =========================================================================
  if (cmdToken === "/done") {
    const task = findTaskByRef(db, argRaw);
    if (!task) {
      return { handled: true, text: `⚠️ Tugas tidak ditemukan untuk \`${argRaw || "-"}\`. Contoh: \`/done TSK-001\`` };
    }
    task.status = "done";
    task.progress = 100;
    task.completed_at = task.completed_at || now.toISOString();
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `menandai tugas selesai (Done) via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `🎉 Mantap! **${task.number_str}: ${task.title}** resmi ditandai **Done (100%)** pada ${formatWibDateTime(now.toISOString())}.`
    };
  }

  // =========================================================================
  // 6. /status [TSK-xxx] | [todo|in_progress|in_review|done]
  // =========================================================================
  if (cmdToken === "/status") {
    const task = findTaskByRef(db, partsPipe[0]);
    const stRaw = String(partsPipe[1] || "").toLowerCase().replace(/\s+/g, "_");
    const valid = ["todo", "in_progress", "in_review", "done"];
    if (!task || !valid.includes(stRaw)) {
      return { handled: true, text: `⚠️ Format: \`/status TSK-001 | todo|in_progress|in_review|done\`` };
    }
    const approvedCount = Array.isArray(task.approvals?.approved_by)
      ? task.approvals.approved_by.length
      : Array.isArray(task.approval?.approved_by)
      ? task.approval.approved_by.length
      : 0;
    if (approvedCount >= 2 && stRaw !== "done") {
      return {
        handled: true,
        text: `🔒 **${task.number_str} (${task.title})** sudah mendapat **2/2 Approval (100%)** dan terkunci saklek di **Done**.`
      };
    }
    task.status = stRaw;
    if (stRaw === "done") {
      task.progress = 100;
      task.completed_at = task.completed_at || now.toISOString();
    }
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `mengubah status tugas menjadi ${stRaw} via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `🔄 Status **${task.number_str} (${task.title})** berhasil diperbarui ke **${stRaw}**.`
    };
  }

  // =========================================================================
  // 7. /priority [TSK-xxx] | [urgent|high|medium|low]
  // =========================================================================
  if (cmdToken === "/priority") {
    const task = findTaskByRef(db, partsPipe[0]);
    const prRaw = String(partsPipe[1] || "").toLowerCase().trim();
    if (!task || !["urgent", "high", "medium", "low"].includes(prRaw)) {
      return { handled: true, text: `⚠️ Format: \`/priority TSK-001 | urgent|high|medium|low\`` };
    }
    task.priority = prRaw;
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `mengubah prioritas menjadi ${prRaw.toUpperCase()} via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `⚡ Prioritas **${task.number_str} (${task.title})** berhasil diubah ke **${prRaw.toUpperCase()}**.`
    };
  }

  // =========================================================================
  // 8. /assign [TSK-xxx] | [nama/email]
  // =========================================================================
  if (cmdToken === "/assign") {
    const task = findTaskByRef(db, partsPipe[0]);
    const targetUser = findHumanUserByRef(db, partsPipe.slice(1).join(" | "));
    if (!task || !targetUser) {
      return { handled: true, text: `⚠️ Tugas atau nama employee tidak ditemukan. Format: \`/assign TSK-001 | Nama Employee\`` };
    }
    const existingAssignees = Array.isArray(task.assignee_ids) ? task.assignee_ids : (task.assignee_id ? [task.assignee_id] : []);
    if (targetUser.user_id === actorId || existingAssignees.includes(targetUser.user_id)) {
      task.assignee_ids = Array.from(new Set([...existingAssignees, targetUser.user_id]));
      task.assignee_id = task.assignee_ids[0] || targetUser.user_id;
      task.updated_at = now.toISOString();
      addTaskActivity(db, task, actorId, `menugaskan kepada ${targetUser.name} via Asli`);
      return {
        handled: true,
        effects: { tasksChanged: true, updatedTask: task, needsSave: true },
        text: `👤 **${targetUser.name}** (${targetUser.department}) berhasil ditetapkan sebagai PIC untuk **${task.number_str}: ${task.title}**.`
      };
    }
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `mengirim konfirmasi penugasan via japri ke ${targetUser.name} via Asli`);
    return {
      handled: true,
      effects: {
        tasksChanged: true,
        updatedTask: task,
        needsSave: true,
        pendingAssignmentInvite: { task, userIds: [targetUser.user_id] },
      },
      text: `📨 Box approval terima/tolak untuk **${task.number_str}: ${task.title}** telah dikirim lewat japri ke **${targetUser.name}** (${targetUser.department}). Tugas akan aktif atas nama **${targetUser.name}** setelah diterima.`
    };
  }

  // =========================================================================
  // 9. /deadline [TSK-xxx] | [hari ini|besok|+3 hari|YYYY-MM-DD]
  // =========================================================================
  if (cmdToken === "/deadline") {
    const task = findTaskByRef(db, partsPipe[0]);
    const parsedDl = parseNaturalDateTime(partsPipe.slice(1).join(" | "), now, 17, 0);
    if (!task || !parsedDl) {
      return { handled: true, text: `⚠️ Format: \`/deadline TSK-001 | besok\` atau \`/deadline TSK-001 | +3 hari\` atau \`YYYY-MM-DD HH:MM\`` };
    }
    task.deadline = parsedDl.iso;
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, `memperbarui deadline menjadi ${formatWibDateTime(parsedDl.iso)} via Asli`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: `⏰ Deadline **${task.number_str} (${task.title})** berhasil diatur ke **${formatWibDateTime(parsedDl.iso)}**.`
    };
  }

  // =========================================================================
  // 10. /comment & 11. /issue
  // =========================================================================
  if (cmdToken === "/comment" || cmdToken === "/issue") {
    const isIssue = cmdToken === "/issue";
    const task = findTaskByRef(db, partsPipe[0]);
    const bodyText = partsPipe.slice(1).join(" | ").trim();
    if (!task || !bodyText) {
      return {
        handled: true,
        text: `⚠️ Format: \`${cmdToken} TSK-001 | ${isIssue ? "Jelaskan kendala/blocker" : "Isi komentar Anda"}\``
      };
    }
    task.comments = Array.isArray(task.comments) ? task.comments : [];
    task.comments.push({
      id: `cmt_${Date.now()}`,
      user_id: actorId,
      author_id: actorId,
      kind: isIssue ? "issue" : "comment",
      text: bodyText,
      resolved: false,
      created_at: now.toISOString()
    });
    task.updated_at = now.toISOString();
    addTaskActivity(db, task, actorId, isIssue ? `melaporkan kendala via Asli: "${bodyText}"` : `menambahkan komentar via Asli: "${bodyText}"`);
    return {
      handled: true,
      effects: { tasksChanged: true, updatedTask: task, needsSave: true },
      text: isIssue
        ? `🚨 Kendala resmi dicatat pada **${task.number_str} (${task.title})**:\n_"${bodyText}"_\n\nManajer dapat memantau ini lewat \`/blockers\`.`
        : `💬 Komentar terkirim ke **${task.number_str} (${task.title})**:\n_"${bodyText}"_`
    };
  }

  // =========================================================================
  // 12. /auto-archive
  // =========================================================================
  if (cmdToken === "/auto-archive") {
    let archivedCount = 0;
    (db.tasks || []).forEach((t: any) => {
      if (t.status === "done" && !t.archived) {
        t.archived = true;
        t.archived_at = t.archived_at || now.toISOString();
        t.archived_month = t.archived_month || now.toISOString().slice(0, 7);
        archivedCount++;
      }
    });
    return {
      handled: true,
      effects: { tasksChanged: archivedCount > 0, needsSave: archivedCount > 0 },
      text: archivedCount > 0
        ? `📦 **Auto-Archive Berhasil!** Sebanyak **${archivedCount} tugas Done** dipindahkan ke folder Arsip Bulanan (${now.toISOString().slice(0, 7)}).`
        : `📦 Tidak ada tugas berstatus Done baru yang perlu diarsipkan saat ini.`
    };
  }

  // =========================================================================
  // 13. /sprint-plan
  // =========================================================================
  if (cmdToken === "/sprint-plan" || lower.includes("rencana sprint") || lower.includes("sprint plan")) {
    const prioWeight: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    const ranked = [...intel.tasks.all_active].sort((a: any, b: any) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      const pw = (prioWeight[b.priority] || 2) - (prioWeight[a.priority] || 2);
      if (pw !== 0) return pw;
      const ah = a.hours_left ?? 9999;
      const bh = b.hours_left ?? 9999;
      return ah - bh;
    });
    const mustDo = ranked.slice(0, 5);
    const nextUp = ranked.slice(5, 10);
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: "Rencana Prioritas Sprint",
        subtitle: intel.generated_at_wib,
        tasks: ranked.slice(0, 12),
        doneCount: intel.tasks.done,
        totalCount: intel.tasks.total
      }),
      text: [
        `🧭 **Rencana Prioritas Sprint Otomatis (${intel.generated_at_wib})**`,
        `Berdasarkan urgensi deadline, status overdue, & bobot prioritas dari **${ranked.length} tugas aktif**:`,
        ``,
        `🔥 **Prioritas Utama (Eksekusi Sekarang):**`,
        ...(mustDo.length
          ? mustDo.map((t: any, i: number) => `${i + 1}. **${t.number_str}** (${t.priority.toUpperCase()}) — ${t.title} | PIC: ${t.assignee_names.join(", ") || "Unassigned"}`)
          : ["• Semua tugas prioritas utama sudah beres."]),
        ...(nextUp.length
          ? [
              ``,
              `⏭️ **Antrean Sprint Berikutnya:**`,
              ...nextUp.map((t: any) => `• **${t.number_str}** — ${t.title} (${t.deadline_wib})`)
            ]
          : [])
      ].join("\n")
    };
  }

  // =========================================================================
  // 14. /recommend — Smart Assignee Recommender
  // =========================================================================
  if (cmdToken === "/recommend" || /(siapa yang cocok|rekomendasi pic)/i.test(lower)) {
    const divFilter = argRaw && isSlash ? argRaw.toLowerCase() : "";
    let candidates = [...intel.workload_summary.people];
    if (divFilter) {
      const matched = candidates.filter((p: any) => String(p.department || "").toLowerCase().includes(divFilter));
      if (matched.length > 0) candidates = matched;
    }
    candidates.sort((a: any, b: any) => {
      if (a.overdue !== b.overdue) return a.overdue - b.overdue;
      const rank: Record<string, number> = { optimal: 1, stabil: 2, pressure: 3 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.active - b.active;
    });
    const top = candidates.slice(0, 8);
    const readyCount = candidates.filter((p: any) => p.status === "optimal").length;
    const readyPct = candidates.length > 0 ? Math.round((readyCount / candidates.length) * 100) : 100;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Rekomendasi PIC Paling Siap${divFilter ? ` · ${argRaw}` : ""}`,
        subtitle: `${candidates.length} employee dianalisis`,
        progressPercent: readyPct,
        progressLabel: "Kapasitas optimal",
        progressTone: readyPct >= 60 ? "good" : "brand",
        metrics: [
          { label: `${readyCount} optimal`, tone: "good" },
          { label: `${candidates.filter((p: any) => p.status === "stabil").length} stabil` },
          ...(candidates.filter((p: any) => p.status === "pressure").length > 0
            ? [{ label: `${candidates.filter((p: any) => p.status === "pressure").length} padat`, tone: "danger" as const }]
            : [])
        ],
        rows: top.map((p: any, idx: number) => ({
          id: p.user_id,
          code: `#${idx + 1}`,
          title: p.name,
          subtitle: `${p.department || "Umum"} · ${p.active} aktif${p.overdue > 0 ? ` · ${p.overdue} terlambat` : ""}${p.online ? " · Online" : ""}`,
          status_label: p.status_label,
          status_tone: p.status === "optimal" ? "good" : p.status === "pressure" ? "danger" : "warn",
          user_ids: [p.user_id],
          user_names: [p.name],
          href: `/people/${p.user_id}`
        })),
        footerNote: top[0] ? `Gunakan /assign TSK-xxx | ${top[0].name} untuk menetapkan PIC langsung.` : undefined,
        ctaLabel: "Buka Employee",
        ctaHref: "/people"
      }),
      text: [
        `🎯 **Rekomendasi PIC Paling Siap${divFilter ? ` (Filter: ${argRaw})` : ""}:**`,
        ...top.slice(0, 5).map((p: any, idx: number) =>
          `${idx + 1}. **${p.name}** (${p.department}) — Load: **${p.status_label}** (${p.active} aktif, ${p.overdue} telat)${p.online ? " 🟢" : ""}`
        ),
        ``,
        `💡 _Gunakan \`/assign TSK-xxx | ${top[0]?.name || "Nama"}\` untuk langsung menetapkan PIC._`
      ].join("\n")
    };
  }

  // =========================================================================
  // 15. /rebalance — Rebalance Workload Planner
  // =========================================================================
  if (cmdToken === "/rebalance" || /(seimbangkan beban|rebalance)/i.test(lower)) {
    const totalPeople = intel.workload_summary.people.length || 1;
    const overloaded = intel.workload_summary.people
      .filter((p: any) => p.status === "pressure" || p.active >= 5)
      .sort((a: any, b: any) => b.overdue - a.overdue || b.active - a.active);
    const available = intel.workload_summary.people
      .filter((p: any) => p.status === "optimal")
      .sort((a: any, b: any) => a.active - b.active);
    const balancedPct = Math.round(((totalPeople - overloaded.length) / totalPeople) * 100);

    if (overloaded.length === 0) {
      return {
        handled: true,
        report: buildSummaryReportPayload({
          title: "Penyeimbang Beban Kerja Tim",
          subtitle: intel.workspace_name,
          progressPercent: 100,
          progressLabel: "Keseimbangan tim",
          progressTone: "good",
          metrics: [
            { label: `${intel.workload_summary.optimal_count} optimal`, tone: "good" },
            { label: `${intel.workload_summary.stabil_count} stabil` },
            { label: "0 under pressure", tone: "good" }
          ],
          rows: [],
          emptyNote: "Beban kerja tim sudah seimbang — tidak ada anggota dalam kategori Under Pressure.",
          ctaLabel: "Buka Employee",
          ctaHref: "/people"
        }),
        text: `⚖️ **Beban Tim Sudah Seimbang!**\nTidak ada anggota yang masuk kategori *Under Pressure* atau kelebihan beban saat ini.`
      };
    }

    const suggestions: string[] = [];
    const rebalanceRows: any[] = [];
    overloaded.slice(0, 6).forEach((p: any, idx: number) => {
      const target = available.find((a: any) => a.department === p.department) || available[idx % Math.max(1, available.length)];
      const sampleTask = p.tasks?.[0];
      if (target && sampleTask) {
        suggestions.push(
          `• Pindahkan **${sampleTask.number_str || sampleTask.title}** dari **${p.name}** (${p.active} aktif, ${p.overdue} telat) → ke **${target.name}** (${target.active} aktif, ${target.status_label})\n  ↳ _Perintah cepat:_ \`/assign ${sampleTask.number_str || sampleTask.id} | ${target.name}\``
        );
        rebalanceRows.push({
          id: sampleTask.id || `${p.user_id}-${idx}`,
          code: sampleTask.number_str || "REASSIGN",
          title: `${p.name} → ${target.name}`,
          subtitle: `${sampleTask.title || "Tugas aktif"} · ${p.active} aktif (${p.overdue} telat) ke ${target.active} aktif`,
          status_label: target.status_label,
          status_tone: "good",
          user_ids: [p.user_id, target.user_id],
          user_names: [p.name, target.name],
          href: sampleTask.id ? `/tasks?task=${sampleTask.id}` : "/tasks"
        });
      } else {
        suggestions.push(`• **${p.name}** (${p.status_label}) membutuhkan relaksasi deadline pada ${p.active} tugas aktif.`);
        rebalanceRows.push({
          id: p.user_id,
          title: p.name,
          subtitle: `${p.department || "Umum"} · ${p.active} aktif · ${p.overdue} terlambat — perlu relaksasi deadline`,
          status_label: p.status_label,
          status_tone: "danger",
          user_ids: [p.user_id],
          user_names: [p.name],
          href: `/people/${p.user_id}`
        });
      }
    });

    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Planner Penyeimbang Beban Kerja",
        subtitle: `${overloaded.length} anggota terdeteksi padat`,
        progressPercent: balancedPct,
        progressLabel: "Keseimbangan tim",
        progressTone: balancedPct >= 75 ? "good" : balancedPct >= 50 ? "warn" : "danger",
        metrics: [
          { label: `${overloaded.length} padat`, tone: "danger" },
          { label: `${available.length} kapasitas luang`, tone: "good" },
          { label: `${intel.workload_summary.total_active_tasks} tugas aktif` }
        ],
        rows: rebalanceRows,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `⚖️ **Planner Penyeimbang Beban Kerja (${overloaded.length} orang terdeteksi padat)**`,
        ``,
        ...suggestions
      ].join("\n")
    };
  }

  // =========================================================================
  // 16. /blockers — Bottleneck & Blocker Scanner
  // =========================================================================
  if (cmdToken === "/blockers" || /(kendala tim|ada kendala|bottleneck|blocker)/i.test(lower)) {
    const rawTasks = Array.isArray(db.tasks) ? db.tasks : [];
    const issueItems: string[] = [];
    const issueRows: any[] = [];
    rawTasks.forEach((t: any) => {
      if (t.archived || t.status === "done") return;
      (t.comments || []).forEach((c: any) => {
        if (c.kind === "issue" && !c.resolved) {
          issueItems.push(`• **${t.number_str || t.id}** (${t.title}): _"${String(c.text || "").slice(0, 120)}"_`);
          issueRows.push({
            id: `${t.id}_${c.id || issueRows.length}`,
            code: t.number_str || "ISSUE",
            title: t.title || "Tugas Terkendala",
            subtitle: String(c.text || "").slice(0, 110),
            status_label: "Kendala",
            status_tone: "danger",
            href: `/tasks?task=${t.id}`
          });
        }
      });
    });
    const stuckReview = intel.tasks.all_active.filter((t: any) => t.status === "in_review");
    const unassigned = intel.tasks.all_active.filter((t: any) => t.assignee_ids.length === 0);
    const overdueCount = intel.tasks.overdue_count || 0;
    const totalBottlenecks = issueItems.length + stuckReview.length + unassigned.length + overdueCount;
    const activeBase = Math.max(intel.tasks.active || 0, totalBottlenecks, 1);
    const healthScore = totalBottlenecks === 0
      ? 100
      : Math.max(0, Math.min(99, Math.round(((activeBase - Math.min(activeBase, totalBottlenecks)) / activeBase) * 100)));

    const summaryRows = [
      {
        id: "blk_issues",
        title: "Kendala / Issue Terbuka",
        subtitle: issueItems.length > 0 ? `${issueItems.length} laporan kendala pada kartu tugas` : "Belum ada kendala terbuka yang dilaporkan",
        right_value: String(issueItems.length),
        status_label: issueItems.length > 0 ? "Perlu aksi" : "Aman",
        status_tone: issueItems.length > 0 ? ("danger" as const) : ("good" as const),
        href: "/tasks"
      },
      {
        id: "blk_review",
        title: "Tugas Menunggu Review",
        subtitle: stuckReview.length > 0 ? "Menunggu approval di kolom In Review" : "Tidak ada antrean review menumpuk",
        right_value: String(stuckReview.length),
        status_label: stuckReview.length > 0 ? "Antre" : "Aman",
        status_tone: stuckReview.length > 0 ? ("warn" as const) : ("good" as const),
        href: "/tasks"
      },
      {
        id: "blk_unassigned",
        title: "Tugas Aktif Tanpa PIC",
        subtitle: unassigned.length > 0 ? "Belum memiliki penanggung jawab" : "Seluruh tugas aktif sudah memiliki PIC",
        right_value: String(unassigned.length),
        status_label: unassigned.length > 0 ? "Unassigned" : "Aman",
        status_tone: unassigned.length > 0 ? ("warn" as const) : ("good" as const),
        href: "/tasks"
      },
      {
        id: "blk_overdue",
        title: "Tugas Terlambat (Overdue)",
        subtitle: overdueCount > 0 ? "Melewati tenggat waktu berjalan" : "Semua tugas berada dalam tenggat waktu",
        right_value: String(overdueCount),
        status_label: overdueCount > 0 ? "Terlambat" : "Aman",
        status_tone: overdueCount > 0 ? ("danger" as const) : ("good" as const),
        href: "/tasks"
      },
      ...issueRows.slice(0, 6)
    ];

    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Scanner Bottleneck & Kendala Workspace",
        subtitle: intel.workspace_name,
        progressPercent: healthScore,
        progressLabel: "Skor kelancaran",
        progressTone: healthScore >= 85 ? "good" : healthScore >= 60 ? "warn" : "danger",
        metrics: [
          { label: `${issueItems.length} kendala`, tone: issueItems.length > 0 ? "danger" : "good" },
          { label: `${stuckReview.length} review`, tone: stuckReview.length > 0 ? "warn" : "default" },
          { label: `${unassigned.length} tanpa PIC`, tone: unassigned.length > 0 ? "warn" : "default" },
          { label: `${overdueCount} terlambat`, tone: overdueCount > 0 ? "danger" : "good" }
        ],
        rows: summaryRows,
        footerNote: issueItems.length === 0 ? "Belum ada kendala (issue) terbuka yang dilaporkan di kartu tugas." : undefined,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `🚧 **Scanner Bottleneck & Kendala Workspace**`,
        `• Kendala/Issue Terbuka: **${issueItems.length}**`,
        `• Tugas Menunggu Review: **${stuckReview.length}**`,
        `• Tugas Aktif Tanpa PIC: **${unassigned.length}**`,
        `• Tugas Telat (Overdue): **${intel.tasks.overdue_count}**`,
        ``,
        ...(issueItems.length ? [`🚨 **Kendala Dilaporkan:**`, ...issueItems.slice(0, 8)] : [`✅ Belum ada kendala (issue) terbuka yang dilaporkan di kartu tugas.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 17. /kpi — Employee KPI & Scorecard
  // =========================================================================
  if (cmdToken === "/kpi" || /\b(kpi|scorecard)\b/i.test(lower)) {
    const targetUser = argRaw && isSlash ? findHumanUserByRef(db, argRaw) : null;
    const rawTasks = Array.isArray(db.tasks) ? db.tasks : [];
    const computeScorecard = (u: any) => {
      const assigned = rawTasks.filter((t: any) => (Array.isArray(t.assignee_ids) && t.assignee_ids.includes(u.user_id)) || t.assignee_id === u.user_id);
      const done = assigned.filter((t: any) => t.status === "done" || t.archived);
      const onTime = done.filter((t: any) => {
        if (!t.deadline) return true;
        const compAt = t.completed_at || t.submit_date || t.archived_at || t.updated_at;
        return !compAt || new Date(compAt) <= new Date(t.deadline);
      });
      const active = assigned.filter((t: any) => t.status !== "done" && !t.archived);
      const overdue = active.filter((t: any) => t.deadline && new Date(t.deadline) < now);
      const evaluatedDue = done.length + overdue.length;
      const completionRate = assigned.length ? Math.round((done.length / assigned.length) * 100) : 0;
      const slaRate = evaluatedDue > 0 ? Math.round((onTime.length / evaluatedDue) * 100) : 0;
      return {
        name: u.name,
        dept: u.department || "-",
        total: assigned.length,
        done: done.length,
        onTime: onTime.length,
        evaluatedDue,
        active: active.length,
        overdue: overdue.length,
        completionRate,
        slaRate
      };
    };

    if (targetUser) {
      const s = computeScorecard(targetUser);
      return {
        handled: true,
        report: buildSummaryReportPayload({
          title: `KPI & Scorecard · ${s.name}`,
          subtitle: s.dept,
          progressPercent: s.completionRate,
          progressLabel: "Penyelesaian",
          progressTone: s.completionRate >= 80 ? "good" : "brand",
          metrics: [
            { label: `${s.done}/${s.total} selesai`, tone: "strong" },
            { label: `${s.active} aktif` },
            { label: `SLA ${s.slaRate}%`, tone: s.slaRate >= 85 ? "good" : "warn" },
            ...(s.overdue > 0 ? [{ label: `${s.overdue} terlambat`, tone: "danger" as const }] : [])
          ],
          rows: [
            {
              id: "kpi_completion",
              title: "Tingkat Penyelesaian Tugas",
              subtitle: `${s.done} dari ${s.total} tugas selesai`,
              progress: s.completionRate,
              href: `/people/${targetUser.user_id}`
            },
            {
              id: "kpi_sla",
              title: "Ketepatan Waktu (SLA)",
              subtitle: `${s.onTime} dari ${s.evaluatedDue} tugas tepat waktu`,
              progress: s.slaRate,
              href: `/people/${targetUser.user_id}`
            },
            {
              id: "kpi_active",
              title: "Beban Tugas Berjalan",
              subtitle: `${s.active} tugas aktif · ${s.overdue} melewati tenggat`,
              right_value: `${s.active} aktif`,
              status_label: s.overdue > 0 ? `${s.overdue} terlambat` : "Terkendali",
              status_tone: s.overdue > 0 ? "danger" : "good",
              href: `/people/${targetUser.user_id}`
            }
          ],
          ctaLabel: "Buka Profil",
          ctaHref: `/people/${targetUser.user_id}`
        }),
        text: [
          `🏅 **KPI & Scorecard: ${s.name}** (${s.dept})`,
          `• Total Tugas Ditangani: **${s.total}** (${s.done} selesai · ${s.active} aktif · ${s.overdue} telat)`,
          `• Tingkat Penyelesaian: **${s.completionRate}%** (${s.done}/${s.total})`,
          `• Ketepatan Waktu (SLA): **${s.slaRate}%** (${s.onTime}/${s.evaluatedDue} tugas tepat waktu)`
        ].join("\n")
      };
    }

    const humans = (db.users || []).filter((u: any) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant");
    const cards = humans.map((u: any) => ({ ...computeScorecard(u), user_id: u.user_id })).sort((a: any, b: any) => b.done - a.done || b.slaRate - a.slaRate);
    const totalDoneAll = cards.reduce((acc: number, c: any) => acc + c.done, 0);
    const totalAll = cards.reduce((acc: number, c: any) => acc + c.total, 0);
    const avgCompletion = totalAll > 0 ? Math.round((totalDoneAll / totalAll) * 100) : 0;
    const totalOnTimeAll = cards.reduce((acc: number, c: any) => acc + c.onTime, 0);
    const totalEvalAll = cards.reduce((acc: number, c: any) => acc + c.evaluatedDue, 0);
    const teamSla = totalEvalAll > 0 ? Math.round((totalOnTimeAll / totalEvalAll) * 100) : 0;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Scorecard KPI Seluruh Tim",
        subtitle: `${cards.length} employee`,
        progressPercent: avgCompletion,
        progressLabel: "Rata-rata selesai",
        progressTone: avgCompletion >= 80 ? "good" : "brand",
        metrics: [
          { label: `${totalDoneAll}/${totalAll} selesai`, tone: "strong" },
          { label: `SLA ${teamSla}%`, tone: teamSla >= 85 ? "good" : "warn" },
          { label: `${cards.length} anggota` }
        ],
        rows: cards.slice(0, 15).map((c: any, idx: number) => ({
          id: c.user_id,
          code: `#${idx + 1}`,
          title: c.name,
          subtitle: `${c.dept} · ${c.done}/${c.total} selesai · SLA ${c.slaRate}%${c.overdue > 0 ? ` · ${c.overdue} telat` : ""}`,
          progress: c.completionRate,
          user_ids: [c.user_id],
          user_names: [c.name],
          href: `/people/${c.user_id}`
        })),
        ctaLabel: "Buka Employee",
        ctaHref: "/people"
      }),
      text: [
        `🏅 **Scorecard KPI Seluruh Tim (${cards.length} Anggota)**`,
        ...cards.slice(0, 12).map((c: any) =>
          `• **${c.name}** (${c.dept}): **${c.done} selesai** (${c.completionRate}%) · Ketepatan Waktu **${c.slaRate}%** (${c.onTime}/${c.evaluatedDue}) · ${c.active} aktif${c.overdue > 0 ? ` · ⚠️ ${c.overdue} telat` : ""}`
        )
      ].join("\n")
    };
  }

  // =========================================================================
  // 18. /sla — SLA Compliance Report
  // =========================================================================
  if (cmdToken === "/sla" || /(ketepatan deadline|laporan sla)/i.test(lower)) {
    const rawTasks = Array.isArray(db.tasks) ? db.tasks : [];
    const doneTasks = rawTasks.filter((t: any) => t.status === "done" || t.archived);
    const doneOnTime = doneTasks.filter((t: any) => {
      if (!t.deadline) return true;
      const compAt = t.completed_at || t.submit_date || t.archived_at || t.updated_at;
      return !compAt || new Date(compAt) <= new Date(t.deadline);
    });
    const activeOverdueCount = intel.tasks.overdue_count || 0;
    const evaluatedTotal = doneTasks.length + activeOverdueCount;
    const overallSla = evaluatedTotal > 0 ? Math.round((doneOnTime.length / evaluatedTotal) * 100) : 100;

    const divRows: any[] = [];
    const divLines = intel.divisions.map((d: any) => {
      const divDoneCount = d.done_tasks_count || 0;
      const divOverdueCount = d.overdue_tasks.length || 0;
      const divEvaluated = divDoneCount + divOverdueCount;
      const divOnTimeCount = rawTasks.filter((t: any) => {
        const isDone = t.status === "done" || Boolean(t.archived);
        if (!isDone) return false;
        const bMatch = d.boards?.some((b: any) => b.id === t.board_id);
        const deptMatch = String(t.department || "").trim().toLowerCase() === d.key;
        if (!bMatch && !deptMatch) return false;
        if (!t.deadline) return true;
        const compAt = t.completed_at || t.submit_date || t.archived_at || t.updated_at;
        return !compAt || new Date(compAt) <= new Date(t.deadline);
      }).length;
      const rate = divEvaluated > 0 ? Math.round((divOnTimeCount / divEvaluated) * 100) : 100;
      divRows.push({
        id: d.key || d.name,
        title: d.name,
        subtitle: `${divOnTimeCount}/${divEvaluated} tepat waktu · ${d.active_tasks_count} aktif${divOverdueCount > 0 ? ` · ${divOverdueCount} terlambat` : ""}`,
        progress: rate,
        href: "/tasks"
      });
      return `• **${d.name}**: Ketepatan Waktu **${rate}%** (${divOnTimeCount} dari ${divEvaluated} tugas tepat waktu · ${divOverdueCount} overdue · ${d.active_tasks_count} aktif)`;
    });

    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Laporan Ketepatan Waktu & SLA",
        subtitle: intel.workspace_name,
        progressPercent: overallSla,
        progressLabel: "Ketepatan waktu",
        progressTone: overallSla >= 85 ? "good" : overallSla >= 65 ? "warn" : "danger",
        metrics: [
          { label: `${doneOnTime.length}/${evaluatedTotal} tepat waktu`, tone: "strong" },
          { label: `${doneTasks.length} selesai`, tone: "good" },
          ...(activeOverdueCount > 0 ? [{ label: `${activeOverdueCount} terlambat`, tone: "danger" as const }] : [{ label: "0 terlambat", tone: "good" as const }])
        ],
        rows: divRows,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `📏 **Laporan Ketepatan Waktu & Kepatuhan SLA Workspace**`,
        `• Ketepatan Waktu: **${overallSla}%** (${doneOnTime.length} dari ${evaluatedTotal} tugas tepat waktu)`,
        `• Tugas Selesai: **${doneTasks.length} kartu** (${doneOnTime.length} tepat waktu, ${Math.max(0, doneTasks.length - doneOnTime.length)} selesai telat)`,
        `• Tugas Aktif Overdue: **${activeOverdueCount} kartu**`,
        ``,
        `🏢 **Ketepatan Waktu per Divisi:**`,
        ...divLines
      ].join("\n")
    };
  }

  // =========================================================================
  // 19. /leaderboard — Division & Contributor Leaderboard
  // =========================================================================
  if (cmdToken === "/leaderboard" || /(leaderboard|ranking produktivitas)/i.test(lower)) {
    const divRank = [...intel.divisions].sort((a: any, b: any) => b.done_tasks_count - a.done_tasks_count);
    const peopleRank = [...intel.workload_summary.people].sort((a: any, b: any) => b.done - a.done || a.overdue - b.overdue);
    const wsCompletion = intel.tasks.total > 0 ? Math.round((intel.tasks.done / intel.tasks.total) * 100) : 0;
    const lbRows = [
      ...peopleRank.slice(0, 5).map((p: any, i: number) => {
        const tot = p.done + p.active;
        return {
          id: p.user_id,
          code: `#${i + 1}`,
          title: p.name,
          subtitle: `${p.department || "Umum"} · ${p.done} selesai · ${p.active} aktif · Load ${p.status_label}`,
          progress: tot > 0 ? Math.round((p.done / tot) * 100) : 0,
          user_ids: [p.user_id],
          user_names: [p.name],
          href: `/people/${p.user_id}`
        };
      }),
      ...divRank.slice(0, 6).map((d: any, i: number) => ({
        id: `div_${d.key || d.name}`,
        code: `DIV #${i + 1}`,
        title: `Divisi ${d.name}`,
        subtitle: `${d.done_tasks_count} selesai · ${d.active_tasks_count} aktif · ${d.member_count} anggota`,
        progress: d.total_tasks > 0 ? Math.round((d.done_tasks_count / d.total_tasks) * 100) : 0,
        href: "/tasks"
      }))
    ];
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Leaderboard Produktivitas Workspace",
        subtitle: `${intel.divisions.length} divisi · ${intel.employees.active} employee`,
        progressPercent: wsCompletion,
        progressLabel: "Penyelesaian total",
        progressTone: wsCompletion >= 75 ? "good" : "brand",
        metrics: [
          { label: `${intel.tasks.done}/${intel.tasks.total} selesai`, tone: "strong" },
          { label: `Top: ${peopleRank[0]?.name || "-"}`, tone: "good" }
        ],
        rows: lbRows,
        ctaLabel: "Buka Employee",
        ctaHref: "/people"
      }),
      text: [
        `🏆 **Leaderboard Produktivitas Workspace**`,
        ``,
        `🏢 **Peringkat Divisi (Berdasarkan Penyelesaian Tugas):**`,
        ...divRank.slice(0, 7).map((d: any, i: number) => `${i + 1}. **${d.name}** — **${d.done_tasks_count} selesai** (${d.active_tasks_count} aktif)`),
        ``,
        `⭐ **Top Contributor:**`,
        ...peopleRank.slice(0, 5).map((p: any, i: number) => `${i + 1}. **${p.name}** (${p.department}) — **${p.done} selesai** · Load: ${p.status_label}`)
      ].join("\n")
    };
  }

  // =========================================================================
  // 20. /risk — Priority Risk Matrix
  // =========================================================================
  if (cmdToken === "/risk" || /(risiko deadline|risk matrix)/i.test(lower)) {
    const highRisk = intel.tasks.all_active.filter(
      (t: any) => t.is_overdue || t.is_under_6h || ((t.priority === "urgent" || t.priority === "high") && (t.is_due_today || t.is_due_tomorrow || t.status === "todo"))
    );
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: "Matriks Risiko Keterlambatan",
        subtitle: `${highRisk.length} tugas berisiko tinggi`,
        tasks: highRisk,
        doneCount: 0,
        totalCount: highRisk.length
      }),
      text: [
        `⚠️ **Matriks Risiko Keterlambatan (${highRisk.length} Tugas Berisiko Tinggi)**`,
        ...(highRisk.length
          ? highRisk.slice(0, 10).map((t: any) =>
              `• **${t.number_str}** [${t.priority.toUpperCase()} · ${t.status}] — ${t.title} | PIC: ${t.assignee_names.join(", ") || "Unassigned"} | ${t.is_overdue ? `Telat ${t.late_duration}` : t.deadline_wib}`
            )
          : [`🟢 Mantap! Tidak ada tugas prioritas tinggi yang berisiko terlambat.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 21. /unassigned
  // =========================================================================
  if (cmdToken === "/unassigned" || /(tugas tanpa pic|belum ada pic|unassigned)/i.test(lower)) {
    const list = intel.tasks.all_active.filter((t: any) => t.assignee_ids.length === 0);
    const best = [...intel.workload_summary.people].sort((a: any, b: any) => a.active - b.active)[0];
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: "Radar Tugas Aktif Tanpa PIC",
        subtitle: intel.workspace_name,
        tasks: list,
        doneCount: 0,
        totalCount: list.length,
        footerNote: list.length > 0 && best ? `Saran PIC paling luang: ${best.name} (${best.active} aktif)` : undefined
      }),
      text: [
        `🕳️ **Radar Tugas Aktif Tanpa PIC (${list.length} Tugas)**`,
        ...(list.length
          ? [
              ...list.slice(0, 10).map((t: any) => `• **${t.number_str}** — ${t.title} (Board: ${t.board_name} · ${t.deadline_wib})`),
              ...(best ? [``, `💡 Saran PIC paling luang saat ini: **${best.name}** (${best.active} aktif) → ketik \`/assign ${list[0].number_str} | ${best.name}\``] : [])
            ]
          : [`✅ Seluruh tugas aktif saat ini sudah memiliki penanggung jawab (PIC).`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 22. /review-queue
  // =========================================================================
  if (cmdToken === "/review-queue" || /(antrean review|menunggu review|butuh approval)/i.test(lower)) {
    const queue = intel.tasks.all_active.filter((t: any) => t.status === "in_review");
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: "Antrean Review & Approval",
        subtitle: intel.workspace_name,
        tasks: queue,
        doneCount: 0,
        totalCount: queue.length
      }),
      text: [
        `👀 **Antrean Review & Approval (${queue.length} Tugas)**`,
        ...(queue.length
          ? queue.slice(0, 10).map((t: any) => `• **${t.number_str}** — ${t.title} | PIC: ${t.assignee_names.join(", ") || "-"} | Board: ${t.board_name}`)
          : [`✅ Tidak ada tugas yang sedang menumpuk di kolom *In Review*.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 23. /standup
  // =========================================================================
  if (cmdToken === "/standup" || /(daily standup|laporan standup)/i.test(lower)) {
    const myDone = (intel.my_summary?.tasks_done || []).slice(0, 4);
    const myActive = (intel.my_summary?.tasks_active || []).slice(0, 5);
    const myOverdue = intel.my_summary?.tasks_overdue || [];
    const totalMine = (intel.my_summary?.tasks_done?.length || 0) + (intel.my_summary?.tasks_active?.length || 0);
    const myPct = totalMine > 0 ? Math.round(((intel.my_summary?.tasks_done?.length || 0) / totalMine) * 100) : 100;
    const standupRows = [
      ...myActive.map((t: any) => ({
        id: t.id,
        code: t.number_str,
        title: t.title,
        subtitle: `Fokus Hari Ini · ${t.board_name} · ${t.is_overdue ? `Terlambat ${t.late_duration}` : (t.deadline ? t.deadline_wib : "Tanpa deadline")}`,
        progress: t.progress,
        status_label: t.is_overdue ? "Blocker" : "Fokus",
        status_tone: t.is_overdue ? ("danger" as const) : ("default" as const),
        href: `/tasks?task=${t.id}`
      })),
      ...myDone.map((t: any) => ({
        id: `done_${t.id}`,
        code: t.number_str,
        title: t.title,
        subtitle: `Selesai terbaru · ${t.board_name}`,
        progress: 100,
        status_label: "Selesai",
        status_tone: "good" as const,
        href: `/tasks?task=${t.id}`
      }))
    ];
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Draft Daily Standup · ${actorName}`,
        subtitle: formatWibDateTime(now.toISOString()),
        progressPercent: myPct,
        progressLabel: "Penyelesaian",
        progressTone: myPct >= 75 ? "good" : "brand",
        metrics: [
          { label: `${intel.my_summary?.tasks_done?.length || 0} selesai`, tone: "good" },
          { label: `${intel.my_summary?.tasks_active?.length || 0} fokus` },
          { label: `${myOverdue.length} blocker`, tone: myOverdue.length > 0 ? "danger" : "good" }
        ],
        rows: standupRows,
        emptyNote: "Tidak ada tugas aktif — siap menerima tugas baru dari board divisi.",
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `📋 **Draft Daily Standup — ${actorName} (${formatWibDateTime(now.toISOString())})**`,
        ``,
        `✅ **Selesai (Yesterday / Terbaru):**`,
        ...(myDone.length ? myDone.map((t: any) => `• ${t.number_str}: ${t.title}`) : ["• Memproses progres tugas aktif tim."]),
        ``,
        `⚡ **Fokus Hari Ini (Today):**`,
        ...(myActive.length ? myActive.map((t: any) => `• ${t.number_str}: ${t.title} (${t.priority.toUpperCase()})`) : ["• Siap menerima tugas baru dari board divisi."]),
        ``,
        `🚧 **Kendala / Risiko (Blockers):**`,
        ...(myOverdue.length ? myOverdue.map((t: any) => `• ${t.number_str}: ${t.title} (telat ${t.late_duration})`) : ["• Tidak ada blocker mendesak."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 24. /meeting [Judul] | [tanggal] | [jam]
  // =========================================================================
  if (cmdToken === "/meeting") {
    const mTitle = partsPipe[0];
    if (!mTitle) {
      return { handled: true, text: `⚠️ Format: \`/meeting Judul Rapat | besok | 14:00\` atau \`/meeting Evaluasi Bulanan | 2026-12-01 | 10:00\`` };
    }
    const parsed = parseNaturalDateTime(`${partsPipe[1] || "besok"} ${partsPipe[2] || "10:00"}`, now, 10, 0) || {
      dateStr: now.toISOString().slice(0, 10),
      timeStr: "10:00",
      iso: now.toISOString()
    };
    const [hh, mm] = parsed.timeStr.split(":").map(Number);
    const endHour = String((hh + 1) % 24).padStart(2, "0");
    const endTime = `${endHour}:${String(mm).padStart(2, "0")}`;
    const m = {
      id: `mtg_${Date.now()}`,
      title: mTitle,
      description: `Dijadwalkan via Asisten ASLI oleh ${actorName}`,
      date: parsed.dateStr,
      start_time: parsed.timeStr,
      end_time: endTime,
      location: "Google Meet",
      meet_link: `https://meet.google.com/asli-${Math.random().toString(36).substring(2, 6)}`,
      attendee_ids: [actorId],
      gcal_synced: false,
      created_by: actorId,
      created_at: now.toISOString()
    };
    db.meetings = Array.isArray(db.meetings) ? db.meetings : [];
    db.meetings.push(m);
    db.activity = Array.isArray(db.activity) ? db.activity : [];
    db.activity.unshift({
      id: `act_${Date.now()}`,
      actor_id: actorId,
      action: `menjadwalkan meeting "${m.title}" via Asli`,
      task_id: m.id,
      task_title: m.title,
      created_at: now.toISOString()
    });
    return {
      handled: true,
      effects: { meetingsChanged: true, meetingNew: m, needsSave: true },
      text: [
        `📅 **Jadwal Meeting Berhasil Dibuat!**`,
        `• Judul: **${m.title}**`,
        `• Tanggal & Jam: **${m.date}** pukul **${m.start_time} – ${m.end_time} WIB**`,
        `• Link Meet: ${m.meet_link}`,
        ``,
        `Sudah langsung muncul di halaman **Jadwal** workspace.`
      ].join("\n")
    };
  }

  // =========================================================================
  // 25. /schedule-today
  // =========================================================================
  if (cmdToken === "/schedule-today" || /(jadwal hari ini|agenda hari ini)/i.test(lower)) {
    const todayStr = getWibParts(now).isoDate;
    const todayMeetings = (db.meetings || []).filter((m: any) => String(m.date || m.start || "").slice(0, 10) === todayStr);
    const todayDeadlines = intel.tasks.due_today_list || [];
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Agenda & Deadline Hari Ini`,
        subtitle: todayStr,
        progressPercent: todayDeadlines.length === 0 ? 100 : Math.round((todayDeadlines.reduce((a: number, t: any) => a + (t.progress || 0), 0)) / todayDeadlines.length),
        progressLabel: todayDeadlines.length === 0 ? "Jadwal terkendali" : "Progres hari ini",
        progressTone: todayDeadlines.length === 0 ? "good" : "brand",
        metrics: [
          { label: `${todayMeetings.length} meeting`, tone: "strong" },
          { label: `${todayDeadlines.length} deadline hari ini`, tone: todayDeadlines.length > 0 ? "warn" : "good" }
        ],
        rows: [
          ...todayMeetings.map((m: any) => ({
            id: m.id,
            code: m.start_time || "10:00",
            title: m.title,
            subtitle: `Meeting · ${m.location || "Meet"}`,
            status_label: "Meeting",
            href: "/schedule"
          })),
          ...todayDeadlines.map((t: any) => ({
            id: t.id,
            code: t.number_str,
            title: t.title,
            subtitle: `${t.board_name} · ${t.deadline_wib}`,
            progress: t.progress,
            href: `/tasks?task=${t.id}`
          }))
        ],
        emptyNote: "Tidak ada meeting maupun deadline tugas yang jatuh tempo hari ini.",
        ctaLabel: "Buka Jadwal",
        ctaHref: "/schedule"
      }),
      text: [
        `🗓️ **Agenda & Deadline Hari Ini (${todayStr})**`,
        ``,
        `🎥 **Jadwal Meeting (${todayMeetings.length}):**`,
        ...(todayMeetings.length
          ? todayMeetings.map((m: any) => `• **${m.start_time || "10:00"} WIB** — **${m.title}** (${m.location || "Meet"})`)
          : ["• Tidak ada meeting terjadwal hari ini."]),
        ``,
        `⏰ **Tugas Jatuh Tempo Hari Ini (${todayDeadlines.length}):**`,
        ...(todayDeadlines.length
          ? todayDeadlines.map((t: any) => `• **${t.number_str}** — ${t.title} (${t.deadline_wib})`)
          : ["• Tidak ada tugas yang jatuh tempo hari ini."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 26. /meeting-prep [kata kunci]
  // =========================================================================
  if (cmdToken === "/meeting-prep") {
    const kw = argRaw.toLowerCase();
    const matchedTasks = kw
      ? intel.tasks.all_active.filter((t: any) =>
          `${t.title} ${t.board_name} ${t.label_names.join(" ")}`.toLowerCase().includes(kw)
        )
      : intel.tasks.all_active;
    const overdueOnes = matchedTasks.filter((t: any) => t.is_overdue);
    const upcomingOnes = matchedTasks.slice(0, 5);
    const prepTasks = Array.from(new Map([...overdueOnes, ...upcomingOnes].map((t: any) => [t.id, t])).values());
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: `Persiapan Meeting${argRaw ? ` · ${argRaw}` : ""}`,
        subtitle: `${overdueOnes.length} terlambat · ${matchedTasks.length} tugas terkait`,
        tasks: prepTasks,
        doneCount: 0,
        totalCount: prepTasks.length,
        footerNote: "Konfirmasi ulang target deadline & kebutuhan resource antar divisi."
      }),
      text: [
        `🗒️ **Brief & Agenda Persiapan Meeting${argRaw ? ` — Topik: ${argRaw}` : ""}**`,
        ``,
        `1️⃣ **Pembahasan Keterlambatan (${overdueOnes.length} item):**`,
        ...(overdueOnes.length ? overdueOnes.slice(0, 4).map((t: any) => `• **${t.number_str}** — ${t.title} (PIC: ${t.assignee_names.join(", ") || "-"})`) : ["• Semua deliverable masih sesuai jadwal."]),
        ``,
        `2️⃣ **Review Progres Tugas Aktif:**`,
        ...(upcomingOnes.length ? upcomingOnes.map((t: any) => `• **${t.number_str}** — ${t.title} [${t.status}]`) : ["• Tidak ada item aktif yang cocok."]),
        ``,
        `3️⃣ **Keputusan yang Perlu Disepakati:**`,
        `• Konfirmasi ulang target deadline & kebutuhan resource antar divisi.`
      ].join("\n")
    };
  }

  // =========================================================================
  // 27. /free-slot [tanggal]
  // =========================================================================
  if (cmdToken === "/free-slot") {
    const parsed = parseNaturalDateTime(argRaw || "hari ini", now, 9, 0);
    const dateStr = parsed?.dateStr || getWibParts(now).isoDate;
    const dayMeetings = (db.meetings || []).filter((m: any) => String(m.date || m.start || "").slice(0, 10) === dateStr);
    const busyHours = new Set(
      dayMeetings.map((m: any) => parseInt(String(m.start_time || "10:00").split(":")[0], 10))
    );
    const workHours = [9, 10, 11, 13, 14, 15, 16];
    const freeHours = workHours.filter((h) => !busyHours.has(h));
    const freeSlots = freeHours.map((h) => `• **${String(h).padStart(2, "0")}:00 – ${String(h + 1).padStart(2, "0")}:00 WIB**`);
    const freePct = Math.round((freeHours.length / workHours.length) * 100);
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Slot Jam Kosong Rapat`,
        subtitle: dateStr,
        progressPercent: freePct,
        progressLabel: "Ketersediaan slot",
        progressTone: freePct >= 50 ? "good" : "warn",
        metrics: [
          { label: `${freeHours.length}/${workHours.length} slot tersedia`, tone: "strong" },
          { label: `${dayMeetings.length} meeting terjadwal` }
        ],
        rows: freeHours.map((h) => ({
          id: `slot_${h}`,
          code: `${String(h).padStart(2, "0")}:00`,
          title: `${String(h).padStart(2, "0")}:00 – ${String(h + 1).padStart(2, "0")}:00 WIB`,
          subtitle: "Tersedia untuk jadwal meeting",
          status_label: "Tersedia",
          status_tone: "good",
          href: "/schedule"
        })),
        emptyNote: "Jadwal penuh sepanjang jam kerja pada tanggal ini.",
        ctaLabel: "Buka Jadwal",
        ctaHref: "/schedule"
      }),
      text: [
        `🕰️ **Slot Jam Kosong Rapat — ${dateStr}**`,
        `• Terjadwal ${dayMeetings.length} meeting pada tanggal ini.`,
        ``,
        `✅ **Rekomendasi Jam Kosong (09:00–17:00 WIB):**`,
        ...(freeSlots.length ? freeSlots : ["• Jadwal penuh sepanjang jam kerja!"])
      ].join("\n")
    };
  }

  // =========================================================================
  // 28. /mom [catatan rapat]
  // =========================================================================
  if (cmdToken === "/mom") {
    if (!argRaw) {
      return { handled: true, text: `⚠️ Ketik \`/mom [catatan rapat mentah]\` untuk disusun otomatis menjadi Notulensi Rapat & Action Items.` };
    }
    const fallbackMom = [
      `📝 **Notulensi Rapat (MoM) — ${formatWibDateTime(now.toISOString())}**`,
      `• **Ringkasan Bahasan:** ${argRaw}`,
      `• **Tindak Lanjut (Action Items):**`,
      ...argRaw.split(/[.;\n]+/).map((s) => s.trim()).filter(Boolean).map((s, i) => `${i + 1}. ${s}`)
    ].join("\n");
    const aiMom = await tryGeminiAssist(
      aiClient,
      "Kamu asisten eksekutif berbahasa Indonesia korporat modern. Ubah catatan rapat mentah menjadi Notulensi Rapat (MoM) rapi dengan bagian: Ringkasan, Keputusan Utama, dan Action Items (tabel/poin dengan PIC jika disebut).",
      `Catatan rapat:\n${argRaw}`,
      fallbackMom
    );
    return { handled: true, text: aiMom };
  }

  // =========================================================================
  // 29. /cancel-meeting [kata kunci]
  // =========================================================================
  if (cmdToken === "/cancel-meeting") {
    const kw = argRaw.toLowerCase();
    if (!kw) return { handled: true, text: `⚠️ Format: \`/cancel-meeting [kata kunci judul meeting]\`` };
    const idx = (db.meetings || []).findIndex((m: any) => String(m.title || "").toLowerCase().includes(kw) || m.id === argRaw);
    if (idx === -1) return { handled: true, text: `⚠️ Tidak ditemukan jadwal meeting dengan kata kunci **"${argRaw}"**.` };
    const removed = db.meetings.splice(idx, 1)[0];
    return {
      handled: true,
      effects: { meetingsChanged: true, needsSave: true },
      text: `🗑️ Jadwal meeting **"${removed.title}"** (${removed.date} ${removed.start_time || ""}) berhasil dibatalkan & dihapus.`
    };
  }

  // =========================================================================
  // 30. /deadline-calendar
  // =========================================================================
  if (cmdToken === "/deadline-calendar" || /(kalender deadline|jadwal deadline 7 hari)/i.test(lower)) {
    const baseWib = getWibParts(now);
    const days: string[] = [];
    const dayRows: any[] = [];
    let totalUpcoming = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(baseWib.year, baseWib.month - 1, baseWib.day + i));
      const dStr = d.toISOString().slice(0, 10);
      const count = intel.tasks.all_active.filter((t: any) => String(t.deadline || "").slice(0, 10) === dStr);
      totalUpcoming += count.length;
      const tag = i === 0 ? " (Hari Ini)" : i === 1 ? " (Besok)" : "";
      days.push(`• **${dStr}${tag}**: ${count.length} tugas${count.length ? ` (${count.slice(0, 2).map((t: any) => t.number_str).join(", ")}${count.length > 2 ? ", ..." : ""})` : ""}`);
      dayRows.push({
        id: `dl_${dStr}`,
        code: dStr.slice(5),
        title: `${dStr}${tag}`,
        subtitle: count.length > 0 ? count.slice(0, 3).map((t: any) => `${t.number_str} ${t.title}`).join(" · ") : "Tidak ada tenggat terjadwal",
        right_value: `${count.length} tugas`,
        status_label: count.length === 0 ? "Luang" : i <= 1 ? "Mendesak" : "Terjadwal",
        status_tone: count.length === 0 ? "good" : i <= 1 ? "warn" : "default",
        href: count[0]?.id ? `/tasks?task=${count[0].id}` : "/tasks"
      });
    }
    const freeDays = dayRows.filter((r) => r.right_value === "0 tugas").length;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Kalender Deadline 7 Hari ke Depan",
        subtitle: intel.workspace_name,
        progressPercent: Math.round((freeDays / 7) * 100),
        progressLabel: "Hari tanpa tenggat",
        progressTone: totalUpcoming === 0 ? "good" : "brand",
        metrics: [
          { label: `${totalUpcoming} tugas terjadwal`, tone: "strong" },
          { label: `${freeDays}/7 hari luang`, tone: "good" }
        ],
        rows: dayRows,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [`📆 **Kalender Deadline 7 Hari ke Depan**`, ``, ...days].join("\n")
    };
  }

  // =========================================================================
  // 31. /remind [pesan] | [waktu]
  // =========================================================================
  if (cmdToken === "/remind") {
    const msg = partsPipe[0];
    if (!msg) return { handled: true, text: `⚠️ Format: \`/remind Pesan pengingat | besok 09:00\`` };
    const parsed = parseNaturalDateTime(partsPipe.slice(1).join(" ") || "besok 09:00", now, 9, 0);
    const r = {
      id: `rem_${Date.now()}`,
      user_id: actorId,
      title: msg,
      due: parsed?.iso || now.toISOString(),
      done: false,
      created_at: now.toISOString()
    };
    db.reminders = Array.isArray(db.reminders) ? db.reminders : [];
    db.reminders.push(r);
    return {
      handled: true,
      effects: { remindersChanged: true, needsSave: true },
      text: `🔔 **Pengingat Tersimpan!**\n• Pesan: **${r.title}**\n• Target: **${formatWibDateTime(r.due)}**`
    };
  }

  // =========================================================================
  // 32. /reminders
  // =========================================================================
  if (cmdToken === "/reminders") {
    const allMine = (db.reminders || []).filter((r: any) => !r.user_id || r.user_id === actorId);
    const mine = allMine.filter((r: any) => !r.done);
    const doneMine = allMine.length - mine.length;
    const remPct = allMine.length > 0 ? Math.round((doneMine / allMine.length) * 100) : 100;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Pengingat Aktif · ${actorName}`,
        subtitle: `${mine.length} aktif · ${doneMine} selesai`,
        progressPercent: remPct,
        progressLabel: "Penyelesaian",
        progressTone: mine.length === 0 ? "good" : "brand",
        metrics: [
          { label: `${mine.length} aktif`, tone: "strong" },
          { label: `${doneMine} selesai`, tone: "good" }
        ],
        rows: mine.slice(0, 12).map((r: any, i: number) => ({
          id: r.id || `rem_${i}`,
          code: `#${i + 1}`,
          title: r.title,
          subtitle: r.due ? formatWibDateTime(r.due) : "Tanpa tenggat",
          status_label: "Aktif",
          href: "/schedule"
        })),
        emptyNote: "Tidak ada pengingat aktif. Buat baru dengan /remind [pesan] | besok 09:00.",
        ctaLabel: "Buka Jadwal",
        ctaHref: "/schedule"
      }),
      text: [
        `🔔 **Pengingat Aktif Anda (${mine.length} item):**`,
        ...(mine.length
          ? mine.map((r: any, i: number) => `${i + 1}. **${r.title}** — ${r.due ? formatWibDateTime(r.due) : "Tanpa tenggat"}`)
          : [`• Tidak ada pengingat aktif. Buat baru via \`/remind [pesan] | besok 09:00\`.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 33. /done-reminder
  // =========================================================================
  if (cmdToken === "/done-reminder") {
    const kw = argRaw.toLowerCase();
    if (!kw) return { handled: true, text: `⚠️ Format: \`/done-reminder [kata kunci]\`` };
    const r = (db.reminders || []).find((x: any) => !x.done && (String(x.title || "").toLowerCase().includes(kw) || x.id === argRaw));
    if (!r) return { handled: true, text: `⚠️ Pengingat aktif dengan kata kunci **"${argRaw}"** tidak ditemukan.` };
    r.done = true;
    r.completed_at = now.toISOString();
    return {
      handled: true,
      effects: { remindersChanged: true, needsSave: true },
      text: `✅ Pengingat **"${r.title}"** ditandai selesai!`
    };
  }

  // =========================================================================
  // 34. /focus / /pomodoro — Top 3 MIT
  // =========================================================================
  if (cmdToken === "/focus" || cmdToken === "/pomodoro" || /(mode fokus|prioritas hari ini|top 3)/i.test(lower)) {
    const myTasks = [...(intel.my_summary?.tasks_active || intel.tasks.all_active)];
    const pw: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    myTasks.sort((a: any, b: any) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      const p = (pw[b.priority] || 2) - (pw[a.priority] || 2);
      return p !== 0 ? p : (a.hours_left ?? 9999) - (b.hours_left ?? 9999);
    });
    const top3 = myTasks.slice(0, 3);
    return {
      handled: true,
      report: buildTaskReportPayload({
        title: `Mode Fokus Top 3 · ${actorName}`,
        subtitle: "Sesi deep work 25 menit per prioritas",
        tasks: top3,
        doneCount: 0,
        totalCount: top3.length
      }),
      text: [
        `🎯 **Mode Fokus Kerja — Top 3 Most Important Tasks (${actorName})**`,
        ``,
        ...(top3.length
          ? top3.map((t: any, i: number) => `${i + 1}. **${t.number_str}** (${t.priority.toUpperCase()}) — **${t.title}**\n   ⏱️ Sesi 1–${i + 1} (25 menit deep work) · ${t.is_overdue ? `Telat ${t.late_duration}` : t.deadline_wib}`)
          : [`🟢 Tugas aktif Anda kosong — waktu luang untuk evaluasi strategis atau membantu tim!`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 35. /note & 36. /notes
  // =========================================================================
  if (cmdToken === "/note") {
    const title = partsPipe.length > 1 ? partsPipe[0] : `Catatan ${getWibParts(now).isoDate}`;
    const content = partsPipe.length > 1 ? partsPipe.slice(1).join(" | ") : partsPipe[0];
    if (!content) return { handled: true, text: `⚠️ Format: \`/note Judul | Isi catatan kerja\`` };
    db.circle_notes = Array.isArray(db.circle_notes) ? db.circle_notes : [];
    const note = {
      id: `note_${Date.now()}`,
      user_id: actorId,
      title,
      content,
      created_at: now.toISOString()
    };
    db.circle_notes.unshift(note);
    return {
      handled: true,
      effects: { needsSave: true },
      text: `📒 **Catatan Kerja Tersimpan Permanen!**\n• **${note.title}**\n• _"${note.content}"_\n\nKetik \`/notes\` kapan saja untuk melihat seluruh memo Anda.`
    };
  }

  if (cmdToken === "/notes") {
    const mine = (db.circle_notes || []).filter((n: any) => n.user_id === actorId);
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Catatan Tersimpan · ${actorName}`,
        subtitle: `${mine.length} memo tersimpan`,
        progressPercent: mine.length > 0 ? 100 : 0,
        progressLabel: "Tersinkronisasi",
        progressTone: "good",
        metrics: [{ label: `${mine.length} catatan`, tone: "strong" }],
        rows: mine.slice(0, 12).map((n: any, i: number) => ({
          id: n.id || `note_${i}`,
          code: `#${i + 1}`,
          title: n.title,
          subtitle: `${formatWibDateTime(n.created_at)} · ${String(n.content || "").slice(0, 90)}`
        })),
        emptyNote: "Belum ada catatan tersimpan. Gunakan /note Judul | Isi untuk mencatat cepat."
      }),
      text: [
        `📒 **Catatan Tersimpan Milik ${actorName} (${mine.length} memo):**`,
        ...(mine.length
          ? mine.slice(0, 12).map((n: any, i: number) => `${i + 1}. **${n.title}** (${formatWibDateTime(n.created_at)})\n   ${n.content}`)
          : [`• Belum ada catatan tersimpan. Gunakan \`/note Judul | Isi\` untuk mencatat cepat.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 37. /post [teks]
  // =========================================================================
  if (cmdToken === "/post") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/post Isi update yang ingin dipublikasikan ke Beranda\`` };
    db.posts = Array.isArray(db.posts) ? db.posts : [];
    const newPost = {
      id: `pst_${Date.now()}`,
      author_id: actorId,
      text: argRaw,
      attachments: [],
      poll_id: null,
      poll: null,
      mention_ids: [],
      parent_id: null,
      likes: [],
      like_count: 0,
      liked: false,
      reactions: {},
      reply_count: 0,
      replies_preview: [],
      created_at: now.toISOString()
    };
    db.posts.unshift(newPost);
    return {
      handled: true,
      effects: { postsChanged: true, postNew: newPost, needsSave: true },
      text: `📣 **Postingan Berhasil Diterbitkan ke Beranda!**\n_"${argRaw}"_\n\nSeluruh tim sudah dapat melihat & memberi komentar di halaman **Beranda**.`
    };
  }

  // =========================================================================
  // 38. /poll [Pertanyaan] | [Opsi 1] | [Opsi 2] ...
  // =========================================================================
  if (cmdToken === "/poll") {
    const questionText = partsPipe[0];
    const options = partsPipe.slice(1).filter(Boolean);
    if (!questionText || options.length < 2) {
      return { handled: true, text: `⚠️ Format: \`/poll Pertanyaan polling? | Opsi 1 | Opsi 2 | Opsi 3\` (minimal 2 opsi).` };
    }
    db.polls = Array.isArray(db.polls) ? db.polls : [];
    db.posts = Array.isArray(db.posts) ? db.posts : [];
    const pollObj = {
      id: `poll_${Date.now()}`,
      question: questionText,
      multiple: false,
      anonymous: false,
      allow_change: true,
      expires_at: null,
      status: "open",
      options: options.map((opt, idx) => ({ id: `opt_${idx + 1}`, text: opt })),
      votes_by_user: {},
      created_by: actorId,
      created_at: now.toISOString()
    };
    db.polls.push(pollObj);
    const newPost = {
      id: `pst_${Date.now()}`,
      author_id: actorId,
      text: `📊 **Polling Baru:** ${questionText}`,
      attachments: [],
      poll_id: pollObj.id,
      poll: { ...pollObj, counts: Object.fromEntries(pollObj.options.map((o) => [o.id, 0])), voters: Object.fromEntries(pollObj.options.map((o) => [o.id, []])), my_vote: [], total_votes: 0 },
      mention_ids: [],
      parent_id: null,
      likes: [],
      like_count: 0,
      liked: false,
      reactions: {},
      reply_count: 0,
      replies_preview: [],
      created_at: now.toISOString()
    };
    db.posts.unshift(newPost);
    return {
      handled: true,
      effects: { postsChanged: true, postNew: newPost, pollsChanged: true, needsSave: true },
      text: [
        `📊 **Polling Resmi Diluncurkan di Beranda!**`,
        `• Pertanyaan: **${questionText}**`,
        `• Pilihan: ${options.map((o, i) => `${i + 1}) ${o}`).join(" · ")}`
      ].join("\n")
    };
  }

  // =========================================================================
  // 39. /trending
  // =========================================================================
  if (cmdToken === "/trending" || /(topik trending|hashtag populer)/i.test(lower)) {
    const tagMap = new Map<string, number>();
    const mainPosts = (db.posts || []).filter((p: any) => !p.parent_id);
    mainPosts.forEach((p: any) => {
      const matches = String(p.text || p.content || "").match(/#[\w-]+/g) || [];
      matches.forEach((tag: string) => {
        const key = tag.toLowerCase();
        tagMap.set(key, (tagMap.get(key) || 0) + 1);
      });
    });
    const sortedTags = Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]);
    const engagementPct = intel.feed.posts_count > 0 ? Math.min(100, Math.round((intel.feed.comments_count / Math.max(intel.feed.posts_count, 1)) * 25)) : 0;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Analisa Topik Trending Beranda",
        subtitle: intel.workspace_name,
        progressPercent: engagementPct,
        progressLabel: "Aktivitas interaksi",
        metrics: [
          { label: `${intel.feed.posts_count} postingan`, tone: "strong" },
          { label: `${intel.feed.comments_count} komentar` },
          { label: `${sortedTags.length} hashtag` }
        ],
        rows: [
          ...sortedTags.slice(0, 8).map(([tag, cnt], idx) => ({
            id: `tag_${idx}`,
            code: `#${idx + 1}`,
            title: tag,
            subtitle: `Muncul di ${cnt} postingan Beranda`,
            right_value: `${cnt} post`,
            href: "/beranda"
          })),
          ...(intel.feed.top_post ? [{
            id: "top_post",
            code: "TOP",
            title: String(intel.feed.top_post.content || "Postingan Terpopuler").slice(0, 72),
            subtitle: `Oleh ${intel.feed.top_post.author} · ${intel.feed.top_post.likes} suka`,
            status_label: "Terpopuler",
            status_tone: "good" as const,
            href: "/beranda"
          }] : [])
        ],
        emptyNote: "Belum ada hashtag trending di postingan Beranda.",
        ctaLabel: "Buka Beranda",
        ctaHref: "/beranda"
      }),
      text: [
        `🔥 **Analisa Topik Trending Beranda**`,
        `• Total Postingan: **${intel.feed.posts_count}** · Total Interaksi Komentar: **${intel.feed.comments_count}**`,
        ``,
        `🏷️ **Hashtag Terpopuler:**`,
        ...(sortedTags.length ? sortedTags.slice(0, 8).map(([t, c]) => `• **${t}** — muncul di ${c} postingan`) : ["• Belum ada hashtag di postingan Beranda."]),
        ...(intel.feed.top_post ? [``, `⭐ **Postingan Terpopuler:** "${intel.feed.top_post.content}" (❤️ ${intel.feed.top_post.likes})`] : [])
      ].join("\n")
    };
  }

  // =========================================================================
  // 40. /poll-summary
  // =========================================================================
  if (cmdToken === "/poll-summary" || /(analisa hasil polling|rekap polling)/i.test(lower)) {
    const polls = intel.polls || [];
    const totalVotesAll = polls.reduce((acc: number, pl: any) => acc + (pl.total_votes || 0), 0);
    const activePolls = polls.filter((pl: any) => !pl.closed).length;
    const participationPct = polls.length > 0 && intel.employees.active > 0
      ? Math.min(100, Math.round((totalVotesAll / (polls.length * intel.employees.active)) * 100))
      : 0;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Rekap Hasil Seluruh Polling",
        subtitle: `${polls.length} polling tercatat`,
        progressPercent: participationPct,
        progressLabel: "Partisipasi suara",
        metrics: [
          { label: `${totalVotesAll} total suara`, tone: "strong" },
          { label: `${activePolls} aktif` },
          { label: `${polls.length - activePolls} selesai` }
        ],
        rows: polls.map((pl: any, idx: number) => {
          const sorted = [...(pl.options || [])].sort((a: any, b: any) => b.votes - a.votes);
          const leader = sorted[0];
          const leaderPct = pl.total_votes && leader ? Math.round((leader.votes / pl.total_votes) * 100) : 0;
          return {
            id: pl.id || `poll_${idx}`,
            title: pl.question,
            subtitle: leader ? `Unggul: ${leader.text} (${leader.votes}/${pl.total_votes} suara)` : `${pl.total_votes} suara`,
            progress: leaderPct,
            status_label: pl.closed ? "Selesai" : "Aktif",
            status_tone: pl.closed ? "good" : "default",
            href: "/beranda"
          };
        }),
        emptyNote: "Belum ada polling yang dibuat di workspace.",
        ctaLabel: "Buka Beranda",
        ctaHref: "/beranda"
      }),
      text: [
        `📊 **Rekap Hasil Seluruh Polling (${polls.length} polling):**`,
        ...(polls.length
          ? polls.map((pl: any) => {
              const sorted = [...pl.options].sort((a: any, b: any) => b.votes - a.votes);
              const optStr = sorted
                .map((o: any) => {
                  const pct = pl.total_votes ? Math.round((o.votes / pl.total_votes) * 100) : 0;
                  return `${o.text}: ${o.votes} suara (${pct}%)`;
                })
                .join(" | ");
              return `• **${pl.question}** — Total ${pl.total_votes} suara [${pl.closed ? "Selesai" : "Aktif"}]\n  ↳ ${optStr}`;
            })
          : ["• Belum ada polling yang dibuat di workspace."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 41. /announce [divisi/semua] | [pengumuman]
  // =========================================================================
  if (cmdToken === "/announce") {
    const targetRaw = partsPipe.length > 1 ? partsPipe[0] : "Semua";
    const bodyText = partsPipe.length > 1 ? partsPipe.slice(1).join(" | ") : partsPipe[0];
    if (!bodyText) return { handled: true, text: `⚠️ Format: \`/announce Semua | Isi pengumuman resmi perusahaan\`` };

    const newPost = {
      id: `pst_${Date.now()}`,
      author_id: actorId,
      text: `📢 **[PENGUMUMAN — ${targetRaw.toUpperCase()}]**\n${bodyText}`,
      attachments: [],
      poll_id: null,
      poll: null,
      mention_ids: [],
      parent_id: null,
      likes: [],
      like_count: 0,
      liked: false,
      reactions: {},
      reply_count: 0,
      replies_preview: [],
      created_at: now.toISOString()
    };
    db.posts = Array.isArray(db.posts) ? db.posts : [];
    db.posts.unshift(newPost);

    const isAll = targetRaw.toLowerCase() === "semua" || targetRaw.toLowerCase() === "all";
    const targetUsers = (db.users || []).filter((u: any) => {
      if (u.is_bot || u.role === "assistant" || u.user_id === actorId) return false;
      if (isAll) return true;
      return String(u.department || "").toLowerCase().includes(targetRaw.toLowerCase());
    });
    db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
    targetUsers.forEach((u: any) => {
      db.notifications.unshift({
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        user_id: u.user_id,
        title: `Pengumuman Internal (${targetRaw})`,
        body: bodyText.slice(0, 120),
        type: "announcement",
        category: "beranda",
        actor_id: actorId,
        post_id: newPost.id,
        link: `/beranda/${newPost.id}`,
        read: false,
        created_at: now.toISOString()
      });
    });

    return {
      handled: true,
      effects: { postsChanged: true, postNew: newPost, notificationsChanged: true, needsSave: true },
      text: `📢 **Pengumuman Resmi Terkirim!**\n• Target: **${targetRaw}** (${targetUsers.length} notifikasi terkirim)\n• Dipublikasikan ke Beranda secara langsung.`
    };
  }

  // =========================================================================
  // 42. /dm-draft [tujuan]
  // =========================================================================
  if (cmdToken === "/dm-draft") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/dm-draft follow up approval deck ke manajer marketing\`` };
    const fallback = [
      `💬 **Draf Pesan Profesional (Siap Salin):**`,
      ``,
      `Halo Bapak/Ibu / Rekan,`,
      `Izin menindaklanjuti terkait **${argRaw}**. Mohon konfirmasi atau masukannya apabila sudah sempat meninjau agar tim dapat segera melanjutkan ke tahap berikutnya.`,
      `Terima kasih banyak atas perhatian dan kerja samanya!`
    ].join("\n");
    const aiDraft = await tryGeminiAssist(
      aiClient,
      "Tulis 2 opsi draf pesan chat kerja singkat dalam Bahasa Indonesia korporat modern yang sopan, hangat, dan jelas (Opsi Ringkas & Opsi Formal).",
      `Buatkan draf pesan untuk tujuan: ${argRaw}`,
      fallback
    );
    return { handled: true, text: aiDraft };
  }

  // =========================================================================
  // 43. /chat-recap
  // =========================================================================
  if (cmdToken === "/chat-recap") {
    const groupLines = (intel.chat.groups || []).map((g: any) => `• **${g.name}** — ${g.members_count} anggota`);
    const latestMsgs = [...(db.messages || [])]
      .filter((m: any) => !m.deleted && m.sender_id !== "user_circle_assistant" && m.text)
      .slice(-5)
      .reverse();
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Recap Aktivitas Chat & Grup",
        subtitle: intel.workspace_name,
        progressPercent: intel.employees.active > 0 ? Math.round((intel.employees.online / intel.employees.active) * 100) : 100,
        progressLabel: "Employee online",
        metrics: [
          { label: `${intel.chat.groups_count} grup`, tone: "strong" },
          { label: `${intel.chat.dm_count} DM` },
          { label: `${intel.chat.messages_count} pesan` }
        ],
        rows: (intel.chat.groups || []).map((g: any, idx: number) => ({
          id: g.id || `grp_${idx}`,
          title: g.name,
          subtitle: `Grup percakapan aktif`,
          right_value: `${g.members_count} anggota`,
          href: "/messages"
        })),
        emptyNote: "Belum ada grup chat aktif.",
        ctaLabel: "Buka Pesan",
        ctaHref: "/messages"
      }),
      text: [
        `💬 **Recap Aktivitas Chat & Grup Workspace**`,
        `• Grup Chat Aktif: **${intel.chat.groups_count}** · DM: **${intel.chat.dm_count}** · Total Pesan: **${intel.chat.messages_count}**`,
        ``,
        `🏢 **Daftar Grup:**`,
        ...(groupLines.length ? groupLines : ["• Belum ada grup chat."]),
        ...(latestMsgs.length
          ? [
              ``,
              `🕒 **Cuplikan Pesan Terbaru:**`,
              ...latestMsgs.map((m: any) => {
                const who = findHumanUserByRef(db, m.sender_id)?.name || "Anggota";
                return `• **${who}**: _"${String(m.text).slice(0, 90)}"_`;
              })
            ]
          : [])
      ].join("\n")
    };
  }

  // =========================================================================
  // 44. /project-create [nama proyek]
  // =========================================================================
  if (cmdToken === "/project-create") {
    const name = argRaw;
    if (!name) return { handled: true, text: `⚠️ Format: \`/project-create Nama Proyek Baru\`` };
    db.projects = Array.isArray(db.projects) ? db.projects : [];
    const prj = {
      id: `prj_${Date.now()}`,
      name,
      status: "active",
      progress: 0,
      member_ids: [actorId],
      label_ids: [],
      created_by: actorId,
      created_at: now.toISOString()
    };
    db.projects.push(prj);
    return {
      handled: true,
      effects: { projectsChanged: true, needsSave: true },
      text: `🗂️ Proyek baru **"${prj.name}"** berhasil dibuat dan siap digunakan di menu Proyek!`
    };
  }

  // =========================================================================
  // 45. /project-health
  // =========================================================================
  if (cmdToken === "/project-health" || /(kesehatan proyek|status rag proyek)/i.test(lower)) {
    const prjs = intel.projects || [];
    const avgProj = prjs.length > 0 ? Math.round(prjs.reduce((a: number, p: any) => a + (p.progress_percent || 0), 0) / prjs.length) : 0;
    const healthyCount = prjs.filter((p: any) => p.overdue_tasks === 0).length;
    const criticalCount = prjs.filter((p: any) => p.overdue_tasks >= 2).length;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Monitor Kesehatan Proyek",
        subtitle: `${prjs.length} proyek terdaftar`,
        progressPercent: avgProj,
        progressLabel: "Rata-rata progres",
        progressTone: criticalCount > 0 ? "warn" : "good",
        metrics: [
          { label: `${healthyCount} sehat`, tone: "good" },
          ...(criticalCount > 0 ? [{ label: `${criticalCount} kritis`, tone: "danger" as const }] : []),
          { label: `${prjs.length} total proyek` }
        ],
        rows: prjs.map((p: any) => ({
          id: p.id,
          title: p.name,
          subtitle: `${p.done_tasks}/${p.total_tasks} selesai${p.overdue_tasks > 0 ? ` · ${p.overdue_tasks} terlambat` : ""}`,
          status_label: p.overdue_tasks >= 2 ? "Kritis" : p.overdue_tasks === 1 ? "Waspada" : "Sehat",
          status_tone: p.overdue_tasks >= 2 ? "danger" : p.overdue_tasks === 1 ? "warn" : "good",
          progress: p.progress_percent,
          href: "/projects"
        })),
        emptyNote: "Belum ada proyek yang terdaftar di workspace.",
        ctaLabel: "Buka Proyek",
        ctaHref: "/projects"
      }),
      text: [
        `🩺 **Monitor Kesehatan Proyek (${prjs.length} Proyek):**`,
        ...(prjs.length
          ? prjs.map((p: any) => {
              const rag = p.overdue_tasks >= 2 ? "🔴 KRITIS" : p.overdue_tasks === 1 ? "🟡 WASPADA" : "🟢 SEHAT";
              return `• **${p.name}** — ${rag} | Progress **${p.progress_percent}%** (${p.done_tasks}/${p.total_tasks} selesai, ${p.overdue_tasks} telat)`;
            })
          : ["• Belum ada proyek yang terdaftar di workspace."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 46. /brand-report [nama brand]
  // =========================================================================
  if (cmdToken === "/brand-report") {
    const kw = argRaw.toLowerCase();
    const list = kw
      ? intel.tasks.by_label.filter((l: any) => l.name.toLowerCase().includes(kw))
      : intel.tasks.by_label;
    const sumDone = list.reduce((a: number, l: any) => a + (l.done || 0), 0);
    const sumTotal = list.reduce((a: number, l: any) => a + (l.total || 0), 0);
    const sumOverdue = list.reduce((a: number, l: any) => a + (l.overdue || 0), 0);
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Laporan Performa Brand / Label${argRaw ? ` · ${argRaw}` : ""}`,
        subtitle: `${list.length} label terpantau`,
        progressPercent: sumTotal > 0 ? Math.round((sumDone / sumTotal) * 100) : 0,
        progressLabel: "Penyelesaian",
        metrics: [
          { label: `${sumDone}/${sumTotal} selesai`, tone: "strong" },
          ...(sumOverdue > 0 ? [{ label: `${sumOverdue} terlambat`, tone: "danger" as const }] : [])
        ],
        rows: list.map((l: any, idx: number) => ({
          id: l.id || `lbl_${idx}`,
          title: l.name,
          subtitle: `${l.done}/${l.total} selesai · ${l.active} aktif${l.overdue > 0 ? ` · ${l.overdue} terlambat` : ""}`,
          progress: l.total > 0 ? Math.round((l.done / l.total) * 100) : 0,
          href: "/tasks"
        })),
        emptyNote: `Label/Brand "${argRaw}" belum memiliki data tugas.`,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `🏷️ **Laporan Performa Brand / IP (${list.length} label):**`,
        ...(list.length
          ? list.map((l: any) => `• **${l.name}** — **${l.total} tugas** (${l.active} aktif · ${l.done} selesai · ${l.overdue} telat)`)
          : [`• Label/Brand "${argRaw}" belum memiliki data tugas.`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 47. /content-matrix
  // =========================================================================
  if (cmdToken === "/content-matrix" || /(rekap jenis item|matriks konten)/i.test(lower)) {
    const countByType: Record<string, { total: number; done: number }> = {};
    (db.tasks || []).forEach((t: any) => {
      if (t.archived) return;
      const it = t.item_type || "Lainnya";
      if (!countByType[it]) countByType[it] = { total: 0, done: 0 };
      countByType[it].total += 1;
      if (t.status === "done") countByType[it].done += 1;
    });
    const sorted = Object.entries(countByType).sort((a, b) => b[1].total - a[1].total);
    const totalAll = sorted.reduce((acc, [, v]) => acc + v.total, 0);
    const doneAll = sorted.reduce((acc, [, v]) => acc + v.done, 0);
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Matriks Volume Produksi per Jenis Item",
        subtitle: `${sorted.length} kategori item`,
        progressPercent: totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0,
        progressLabel: "Penyelesaian",
        metrics: [
          { label: `${totalAll} total tugas`, tone: "strong" },
          { label: `${doneAll} selesai`, tone: "good" }
        ],
        rows: sorted.map(([k, v]) => ({
          id: `item_${k}`,
          title: k,
          subtitle: `${v.done}/${v.total} selesai · ${v.total - v.done} berjalan`,
          progress: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0,
          href: "/tasks"
        })),
        emptyNote: "Belum ada data tugas berdasarkan jenis item.",
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `🎬 **Matriks Volume Produksi per Jenis Item:**`,
        ...(sorted.length
          ? sorted.map(([k, v]) => `• **${k}**: **${v.total} tugas aktif/tercatat**`)
          : ["• Belum ada data tugas berdasarkan jenis item."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 48. /content-brief [jenis item] | [topik]
  // =========================================================================
  if (cmdToken === "/content-brief") {
    const itemType = partsPipe.length > 1 ? partsPipe[0] : "Konten Digital";
    const topic = partsPipe.length > 1 ? partsPipe.slice(1).join(" | ") : partsPipe[0];
    if (!topic) return { handled: true, text: `⚠️ Format: \`/content-brief Reels | Peluncuran produk terbaru\`` };
    const fallback = [
      `🎨 **Creative Brief — ${itemType}: ${topic}**`,
      `• **Tujuan:** Meningkatkan awareness & konversi audiens target.`,
      `• **Hook / 3 Detik Pertama:** Sorot masalah utama audiens dengan visual kontras tinggi.`,
      `• **Pesan Kunci (Key Message):** Solusi cepat, relevan, dan kredibel untuk **${topic}**.`,
      `• **Arahan Visual:** Komposisi bersih, warna brand dominan, teks headline besar terbaca di mobile.`,
      `• **Call to Action (CTA):** Klik tautan profil / Hubungi tim sekarang.`
    ].join("\n");
    const aiBrief = await tryGeminiAssist(
      aiClient,
      "Kamu Creative Director agensi korporat modern. Buat Creative Brief singkat namun padat (Hook, Key Message, Visual Direction, Deliverable Specs, CTA) dalam Bahasa Indonesia.",
      `Buatkan Creative Brief untuk jenis item "${itemType}" dengan topik "${topic}".`,
      fallback
    );
    return { handled: true, text: aiBrief };
  }

  // =========================================================================
  // 49. /caption [topik/brand]
  // =========================================================================
  if (cmdToken === "/caption") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/caption Promo akhir bulan produk unggulan\`` };
    const fallback = [
      `✍️ **3 Variasi Caption Siap Posting — ${argRaw}**`,
      ``,
      `1️⃣ **Engaging & Kekinian (IG / TikTok):**`,
      `Jangan sampai ketinggalan! ✨ Cek **${argRaw}** yang bikin aktivitasmu jauh lebih sat-set & efisien. Simpan postingan ini sekarang! 🚀`,
      ``,
      `2️⃣ **Profesional (LinkedIn):**`,
      `Komitmen kami dalam menghadirkan inovasi melalui **${argRaw}** terus bertumbuh untuk mendukung kolaborasi dan produktivitas terbaik.`,
      ``,
      `3️⃣ **Singkat & To-the-Point (Story / Ads):**`,
      `Waktunya upgrade dengan **${argRaw}** — Klik selengkapnya hari ini!`
    ].join("\n");
    const aiCaption = await tryGeminiAssist(
      aiClient,
      "Kamu Senior Social Media Copywriter Indonesia. Berikan 3 variasi caption (Instagram/TikTok Kekinian, LinkedIn Profesional, Ads Singkat) lengkap dengan 4-5 hashtag relevan.",
      `Buatkan 3 variasi caption untuk: ${argRaw}`,
      fallback
    );
    return { handled: true, text: aiCaption };
  }

  // =========================================================================
  // 50. /checklist [topik]
  // =========================================================================
  if (cmdToken === "/checklist") {
    const topic = argRaw || "Launch Campaign";
    const fallback = [
      `☑️ **Template Checklist SOP: ${topic}**`,
      `1. [ ] Finalisasi brief, objektif, dan KPI keberhasilan`,
      `2. [ ] Konfirmasi PIC & pembagian peran lintas divisi`,
      `3. [ ] Produksi & review aset kreatif / materi teknis`,
      `4. [ ] Quality Assurance (QA) & uji coba alur akhir`,
      `5. [ ] Approval manajemen / stakeholder terkait`,
      `6. [ ] Eksekusi publikasi / Go-Live sesuai jadwal`,
      `7. [ ] Monitoring performa 24–72 jam pasca-rilis & evaluasi`
    ].join("\n");
    const aiChecklist = await tryGeminiAssist(
      aiClient,
      "Kamu Operations Lead korporat. Buat daftar 7-9 poin checklist eksekusi SOP praktis & runtut dalam Bahasa Indonesia.",
      `Buat checklist SOP lengkap untuk aktivitas: ${topic}`,
      fallback
    );
    return { handled: true, text: aiChecklist };
  }

  // =========================================================================
  // 51. /translate [en|id|jp|kr] | [teks]
  // =========================================================================
  if (cmdToken === "/translate") {
    const langCode = (partsPipe.length > 1 ? partsPipe[0] : "en").toLowerCase();
    const content = partsPipe.length > 1 ? partsPipe.slice(1).join(" | ") : partsPipe[0];
    if (!content) return { handled: true, text: `⚠️ Format: \`/translate en | Teks yang ingin diterjemahkan\`` };
    const langMap: Record<string, string> = { en: "Bahasa Inggris Bisnis", id: "Bahasa Indonesia Korporat Modern", jp: "Bahasa Jepang Sopan (Keigo)", kr: "Bahasa Korea Formal" };
    const targetName = langMap[langCode] || langCode;
    const fallback = `🌐 **Mode Penerjemah (${targetName})**\nTeks asli: _"${content}"_\n_(Aktifkan GEMINI_API_KEY di environment server untuk terjemahan neural instan multi-bahasa.)_`;
    const aiTrans = await tryGeminiAssist(
      aiClient,
      `Terjemahkan teks berikut ke ${targetName} dengan gaya korporat profesional. Tampilkan hasil terjemahan yang bersih beserta 1 alternatif kalimat jika relevan.`,
      content,
      fallback
    );
    return { handled: true, text: aiTrans };
  }

  // =========================================================================
  // 52. /polish [teks]
  // =========================================================================
  if (cmdToken === "/polish") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/polish kalimat mentah yang ingin dirapikan\`` };
    const cleanBasic = argRaw.charAt(0).toUpperCase() + argRaw.slice(1).replace(/\byg\b/gi, "yang").replace(/\bgak\b|\bga\b/gi, "tidak").replace(/\budah\b/gi, "sudah");
    const fallback = [
      `✨ **Kalimat Telah Dipoles (Korporat Modern):**`,
      `• **Versi Rapi:** "${cleanBasic}."`,
      `• **Versi Eksekutif:** "Terkait hal tersebut, berikut pembaruan terbaru: ${cleanBasic}. Mohon konfirmasinya apabila ada penyesuaian lebih lanjut."`
    ].join("\n");
    const aiPolish = await tryGeminiAssist(
      aiClient,
      "Kamu editor komunikasi korporat Indonesia modern. Poles kalimat user menjadi 2 versi: (1) Korporat Kekinian & Luwes, (2) Formal Eksekutif. Hindari kalimat kaku berlebihan.",
      argRaw,
      fallback
    );
    return { handled: true, text: aiPolish };
  }

  // =========================================================================
  // 53. /summarize [teks panjang]
  // =========================================================================
  if (cmdToken === "/summarize") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/summarize tempel paragraf atau teks panjang di sini\`` };
    const sentences = argRaw.split(/(?<=[.!?])\s+/).filter(Boolean);
    const fallback = [
      `📑 **Ringkasan Eksekutif Cepat:**`,
      ...(sentences.slice(0, 4).map((s) => `• ${s}`)),
      ``,
      `📊 _Diringkas dari ${argRaw.split(/\s+/).length} kata menjadi ${Math.min(4, sentences.length)} poin utama._`
    ].join("\n");
    const aiSum = await tryGeminiAssist(
      aiClient,
      "Ringkas teks berikut ke dalam format Bahasa Indonesia: 1) Inti Utama (1-2 kalimat), 2) Poin Penting (bullet), 3) Tindak Lanjut yang Disarankan.",
      argRaw,
      fallback
    );
    return { handled: true, text: aiSum };
  }

  // =========================================================================
  // 54. /email [tujuan]
  // =========================================================================
  if (cmdToken === "/email") {
    if (!argRaw) return { handled: true, text: `⚠️ Format: \`/email penawaran sponsorship ke partner\`` };
    const fallback = [
      `📧 **Draf Email Bisnis Siap Kirim**`,
      `**Subjek:** Tindak Lanjut — ${argRaw}`,
      ``,
      `Yth. Bapak/Ibu,`,
      ``,
      `Semoga kabar Anda senantiasa baik. Bersama email ini, kami bermaksud menyampaikan informasi terkait **${argRaw}**.`,
      `Kami sangat terbuka untuk menjadwalkan diskusi singkat apabila Bapak/Ibu membutuhkan detail tambahan.`,
      ``,
      `Hormat kami,`,
      `**${actorName}** · ${senderUser?.department || "Tim"}`
    ].join("\n");
    const aiEmail = await tryGeminiAssist(
      aiClient,
      `Tulis draf email bisnis lengkap (Subjek, Pembuka, Isi Jelas, Penutup) dalam Bahasa Indonesia korporat modern dari pengirim bernama ${actorName}.`,
      `Tujuan email: ${argRaw}`,
      fallback
    );
    return { handled: true, text: aiEmail };
  }

  // =========================================================================
  // 55. /calc [ekspresi]
  // =========================================================================
  if (cmdToken === "/calc") {
    const calc = safeCalculateExpression(argRaw);
    if (!calc) {
      return { handled: true, text: `⚠️ Ekspresi tidak valid. Contoh: \`/calc 25000000 * 11% + 1500000\` atau \`/calc (12000000 - 2500000) / 4\`` };
    }
    return {
      handled: true,
      text: [
        `🧮 **Hasil Kalkulasi Cepat**`,
        `• Ekspresi: \`${argRaw}\``,
        `• Hasil: **${calc.formatted}**`,
        `• Format Rupiah: **Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(calc.result)}**`
      ].join("\n")
    };
  }

  // =========================================================================
  // 56. /guide [topik]
  // =========================================================================
  if (cmdToken === "/guide" || /(product knowledge|cara pakai fitur|panduan workspace)/i.test(lower)) {
    return { handled: true, text: getGuideResponse(argRaw) };
  }

  // =========================================================================
  // 57. /drive [kata kunci]
  // =========================================================================
  if (cmdToken === "/drive") {
    const kw = argRaw.toLowerCase();
    const items = (db.drive_shortcuts || []).filter((d: any) =>
      !kw || `${d.title || d.name} ${d.division || d.department || ""}`.toLowerCase().includes(kw)
    );
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Shortcut Google Drive${argRaw ? ` · ${argRaw}` : ""}`,
        subtitle: `${items.length} folder ditemukan`,
        progressPercent: items.length > 0 ? 100 : 0,
        progressLabel: "Tersedia",
        progressTone: "good",
        metrics: [{ label: `${items.length} folder`, tone: "strong" }],
        rows: items.map((d: any, idx: number) => ({
          id: d.id || `drv_${idx}`,
          title: d.title || d.name || "Folder Drive",
          subtitle: d.division || d.department || "Umum",
          status_label: "Drive",
          href: "/drive"
        })),
        emptyNote: `Tidak ada shortcut Drive yang cocok dengan "${argRaw}".`,
        ctaLabel: "Buka Drive",
        ctaHref: "/drive"
      }),
      text: [
        `📁 **Shortcut Google Drive${argRaw ? ` (Filter: ${argRaw})` : ""} — ${items.length} Folder:**`,
        ...(items.length
          ? items.map((d: any) => `• **${d.title || d.name}** (${d.division || d.department || "Umum"}) — ${d.url || d.link || "Tautan tersedia di menu Drive"}`)
          : [`• Tidak ada shortcut Drive yang cocok dengan "${argRaw}".`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 58. /audit
  // =========================================================================
  if (cmdToken === "/audit") {
    const logs = (db.audit_logs || []).slice(0, 8);
    const acts = (db.activity || []).slice(0, 6);
    const auditRows = [
      ...logs.map((l: any, i: number) => ({
        id: l.id || `aud_${i}`,
        code: "AUDIT",
        title: l.actor_name || l.actor_id || "Admin",
        subtitle: `${formatWibDateTime(l.created_at)} · ${l.action || l.detail || "Perubahan konfigurasi"}`,
        href: "/settings"
      })),
      ...acts.map((a: any, i: number) => ({
        id: a.id || `act_${i}`,
        code: "LOG",
        title: `${a.action || a.text || "Aktivitas"}${a.task_title ? ` — ${a.task_title}` : ""}`,
        subtitle: a.created_at ? formatWibDateTime(a.created_at) : "Aktivitas terbaru"
      }))
    ];
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Log Audit & Aktivitas Keamanan",
        subtitle: intel.workspace_name,
        progressPercent: 100,
        progressLabel: "Terpantau",
        progressTone: "good",
        metrics: [
          { label: `${logs.length} log audit`, tone: "strong" },
          { label: `${acts.length} aktivitas terbaru` }
        ],
        rows: auditRows,
        emptyNote: "Belum ada log audit administratif tercatat.",
        ctaLabel: "Buka Pengaturan",
        ctaHref: "/settings"
      }),
      text: [
        `🛡️ **Log Audit & Aktivitas Keamanan Terkini**`,
        ...(logs.length
          ? logs.map((l: any) => `• [${formatWibDateTime(l.created_at)}] **${l.actor_name || l.actor_id || "Admin"}** — ${l.action || l.detail || "Perubahan konfigurasi"}`)
          : ["• Belum ada log audit administratif."]),
        ``,
        `🕒 **Aktivitas Workspace Terbaru:**`,
        ...(acts.length ? acts.map((a: any) => `• ${a.action || a.text}${a.task_title ? ` ("${a.task_title}")` : ""}`) : ["• Belum ada aktivitas baru."])
      ].join("\n")
    };
  }

  // =========================================================================
  // 59. /access-pending
  // =========================================================================
  if (cmdToken === "/access-pending") {
    const reqs = intel.access_requests.pending_list || [];
    const totalPending = (intel.access_requests.pending_count || 0) + (intel.access_requests.pending_invitations_count || 0);
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Permintaan Akses & Undangan Pending",
        subtitle: intel.workspace_name,
        progressPercent: totalPending === 0 ? 100 : Math.max(20, 100 - totalPending * 15),
        progressLabel: totalPending === 0 ? "Semua diproses" : "Antrean persetujuan",
        progressTone: totalPending === 0 ? "good" : "warn",
        metrics: [
          { label: `${intel.access_requests.pending_count} permintaan akses`, tone: intel.access_requests.pending_count > 0 ? "warn" : "good" },
          { label: `${intel.access_requests.pending_invitations_count} undangan pending` }
        ],
        rows: reqs.map((r: any, idx: number) => ({
          id: r.id || `req_${idx}`,
          title: r.name,
          subtitle: `${r.email} · Divisi ${r.department}`,
          status_label: r.type || "Pending",
          status_tone: "warn",
          href: "/settings"
        })),
        emptyNote: "Semua permintaan akses sudah diproses (0 pending).",
        ctaLabel: "Buka Pengaturan",
        ctaHref: "/settings"
      }),
      text: [
        `🔐 **Monitor Permintaan Akses & Undangan Pending**`,
        `• Permintaan Masuk / Reset PW Pending: **${intel.access_requests.pending_count}**`,
        `• Undangan Email Pending: **${intel.access_requests.pending_invitations_count}**`,
        ``,
        ...(reqs.length
          ? reqs.map((r: any) => `• **${r.name}** (${r.email}) — Divisi ${r.department} [${r.type}]`)
          : [`✅ Semua permintaan akses sudah diproses (0 pending).`])
      ].join("\n")
    };
  }

  // =========================================================================
  // 60. /export-summary
  // =========================================================================
  if (cmdToken === "/export-summary") {
    const header = `| Divisi | Anggota | Aktif | Selesai | Telat | Status Load |`;
    const sep = `|---|---:|---:|---:|---:|---|`;
    const rows = intel.divisions.map(
      (d: any) => `| ${d.name} | ${d.member_count} | ${d.active_tasks_count} | ${d.done_tasks_count} | ${d.overdue_tasks.length} | ${d.load_status_label} |`
    );
    const totalDone = intel.tasks.done || 0;
    const totalAll = intel.tasks.total || 0;
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: "Ringkasan Performa Divisi",
        subtitle: intel.generated_at_wib,
        progressPercent: totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0,
        progressLabel: "Penyelesaian total",
        metrics: [
          { label: `${intel.divisions.length} divisi`, tone: "strong" },
          { label: `${totalDone}/${totalAll} selesai` },
          ...(intel.tasks.overdue_count > 0 ? [{ label: `${intel.tasks.overdue_count} terlambat`, tone: "danger" as const }] : [])
        ],
        rows: intel.divisions.map((d: any) => ({
          id: d.key || d.name,
          title: d.name,
          subtitle: `${d.member_count} anggota · ${d.done_tasks_count}/${d.total_tasks} selesai · ${d.active_tasks_count} aktif${d.overdue_tasks.length > 0 ? ` · ${d.overdue_tasks.length} telat` : ""}`,
          status_label: d.load_status_label,
          status_tone: d.load_status === "pressure" ? "danger" : d.load_status === "stabil" ? "warn" : "good",
          progress: d.total_tasks > 0 ? Math.round((d.done_tasks_count / d.total_tasks) * 100) : 0,
          href: "/tasks"
        })),
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `📊 **Ringkasan Ekspor Performa Divisi (${intel.generated_at_wib})**`,
        ``,
        header,
        sep,
        ...rows
      ].join("\n")
    };
  }

  // =========================================================================
  // 61. /morning-brief & /weekly-digest
  // =========================================================================
  if (cmdToken === "/morning-brief" || cmdToken === "/weekly-digest" || /(morning brief|weekly digest|briefing pagi)/i.test(lower)) {
    const isWeekly = cmdToken === "/weekly-digest" || lower.includes("weekly");
    const overdueTop = (intel.tasks.overdue_list || []).slice(0, 4);
    const pressureList = intel.workload_summary.people.filter((p: any) => p.status === "pressure");
    const todayStr = getWibParts(now).isoDate;
    const todayMeetings = (db.meetings || []).filter((m: any) => String(m.date || "").slice(0, 10) === todayStr);
    const completionPct = intel.tasks.total > 0 ? Math.round((intel.tasks.done / intel.tasks.total) * 100) : 0;

    const briefRows = [
      {
        id: "mb_pulse",
        title: "Pulse Organisasi",
        subtitle: `${intel.employees.online}/${intel.employees.active} online · ${intel.workload_summary.optimal_count} Optimal · ${intel.workload_summary.stabil_count} Stabil · ${intel.workload_summary.pressure_count} Under Pressure`,
        status_label: pressureList.length > 0 ? `${pressureList.length} padat` : "Optimal",
        status_tone: pressureList.length > 0 ? ("danger" as const) : ("good" as const),
        href: "/people"
      },
      {
        id: "mb_tasks",
        title: "Status Tugas Workspace",
        subtitle: `${intel.tasks.active} aktif · ${intel.tasks.done} selesai · ${intel.tasks.overdue_count} overdue · ${intel.tasks.due_today_count} jatuh tempo hari ini`,
        progress: completionPct,
        href: "/tasks"
      },
      {
        id: "mb_agenda",
        title: "Agenda & Persetujuan Hari Ini",
        subtitle: `${todayMeetings.length} meeting terjadwal · ${intel.access_requests.pending_count} approval akses pending`,
        right_value: `${todayMeetings.length} meeting`,
        href: "/schedule"
      },
      ...overdueTop.map((t: any) => ({
        id: t.id,
        code: t.number_str,
        title: t.title,
        subtitle: `${t.board_name} · Terlambat ${t.late_duration || ""}`.trim(),
        progress: t.progress,
        status_label: "Eskalasi",
        status_tone: "danger" as const,
        href: `/tasks?task=${t.id}`
      }))
    ];

    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: isWeekly ? "Executive Weekly Digest" : "Executive Morning Brief",
        subtitle: `${intel.workspace_name} · ${intel.generated_at_wib}`,
        progressPercent: completionPct,
        progressLabel: "Penyelesaian",
        progressTone: intel.tasks.overdue_count === 0 ? "good" : "brand",
        metrics: [
          { label: `${intel.tasks.done}/${intel.tasks.total} selesai`, tone: "strong" },
          { label: `${intel.tasks.active} aktif` },
          ...(intel.tasks.overdue_count > 0 ? [{ label: `${intel.tasks.overdue_count} terlambat`, tone: "danger" as const }] : [{ label: "0 terlambat", tone: "good" as const }]),
          { label: `${todayMeetings.length} meeting` }
        ],
        rows: briefRows,
        footerNote: pressureList.length > 0
          ? `Perhatian khusus (Under Pressure): ${pressureList.map((p: any) => `${p.name} (${p.active} aktif)`).join(", ")}`
          : undefined,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `${isWeekly ? "📈" : "☀️"} **${isWeekly ? "Executive Weekly Digest" : "Executive Morning Brief"} — ${intel.workspace_name}**`,
        `_${intel.generated_at_wib}_`,
        ``,
        `1️⃣ **Pulse Organisasi:** ${intel.employees.online}/${intel.employees.active} employee sedang online · ${intel.workload_summary.optimal_count} Optimal · ${intel.workload_summary.stabil_count} Stabil · ${intel.workload_summary.pressure_count} Under Pressure`,
        `2️⃣ **Status Tugas:** ${intel.tasks.active} aktif · ${intel.tasks.done} selesai · **${intel.tasks.overdue_count} overdue** · ${intel.tasks.due_today_count} jatuh tempo hari ini`,
        `3️⃣ **Agenda Hari Ini:** ${todayMeetings.length} meeting terjadwal · ${intel.access_requests.pending_count} approval akses pending`,
        ...(pressureList.length
          ? [``, `🚨 **Perhatian Khusus (Under Pressure):** ${pressureList.map((p: any) => `${p.name} (${p.overdue} telat, ${p.active} aktif)`).join(", ")}`]
          : []),
        ...(overdueTop.length
          ? [``, `⏰ **Overdue Teratas yang Perlu Eskalasi:**`, ...overdueTop.map((t: any) => `• **${t.number_str}** — ${t.title} (${t.board_name})`)]
          : [])
      ].join("\n")
    };
  }

  // =========================================================================
  // 62. /search [kata kunci]
  // =========================================================================
  if (cmdToken === "/search") {
    const kw = argRaw.toLowerCase();
    if (!kw) return { handled: true, text: `⚠️ Format: \`/search kata kunci\`` };

    const matchedTasks = (db.tasks || []).filter((t: any) =>
      `${t.number_str || ""} ${t.title || ""} ${t.description || ""}`.toLowerCase().includes(kw)
    ).slice(0, 5);
    const matchedUsers = (db.users || []).filter((u: any) =>
      !u.is_bot && `${u.name || ""} ${u.department || ""} ${u.job_title || ""}`.toLowerCase().includes(kw)
    ).slice(0, 5);
    const matchedProjects = (db.projects || []).filter((p: any) =>
      String(p.name || "").toLowerCase().includes(kw)
    ).slice(0, 4);
    const matchedMeetings = (db.meetings || []).filter((m: any) =>
      String(m.title || "").toLowerCase().includes(kw)
    ).slice(0, 4);
    const matchedPosts = (db.posts || []).filter((p: any) =>
      !p.parent_id && String(p.text || p.content || "").toLowerCase().includes(kw)
    ).slice(0, 3);
    const matchedDrive = (db.drive_shortcuts || []).filter((d: any) =>
      `${d.title || d.name || ""} ${d.division || ""}`.toLowerCase().includes(kw)
    ).slice(0, 3);

    const total = matchedTasks.length + matchedUsers.length + matchedProjects.length + matchedMeetings.length + matchedPosts.length + matchedDrive.length;
    const searchRows = [
      ...matchedTasks.map((t: any) => ({
        id: t.id,
        code: t.number_str || "TSK",
        title: t.title,
        subtitle: `Tugas · ${t.status || "todo"}`,
        href: `/tasks?task=${t.id}`
      })),
      ...matchedUsers.map((u: any) => ({
        id: u.user_id,
        code: "EMP",
        title: u.name,
        subtitle: `${u.department || "Umum"} · ${u.job_title || "Member"}`,
        user_ids: [u.user_id],
        user_names: [u.name],
        href: `/people/${u.user_id}`
      })),
      ...matchedProjects.map((p: any) => ({
        id: p.id,
        code: "PRJ",
        title: p.name,
        subtitle: `Proyek · ${p.status}`,
        href: "/projects"
      })),
      ...matchedMeetings.map((m: any) => ({
        id: m.id,
        code: "MEET",
        title: m.title,
        subtitle: `Meeting · ${m.date} ${m.start_time || ""}`.trim(),
        href: "/schedule"
      })),
      ...matchedDrive.map((d: any, i: number) => ({
        id: d.id || `drv_${i}`,
        code: "DRIVE",
        title: d.title || d.name,
        subtitle: `Drive · ${d.division || "Umum"}`,
        href: "/drive"
      }))
    ];
    return {
      handled: true,
      report: buildSummaryReportPayload({
        title: `Hasil Pencarian · "${argRaw}"`,
        subtitle: `${total} temuan teratas`,
        progressPercent: total > 0 ? 100 : 0,
        progressLabel: total > 0 ? "Ditemukan" : "Kosong",
        progressTone: total > 0 ? "good" : "brand",
        metrics: [
          ...(matchedTasks.length ? [{ label: `${matchedTasks.length} tugas`, tone: "strong" as const }] : []),
          ...(matchedUsers.length ? [{ label: `${matchedUsers.length} employee` }] : []),
          ...(matchedProjects.length ? [{ label: `${matchedProjects.length} proyek` }] : []),
          ...(matchedMeetings.length ? [{ label: `${matchedMeetings.length} meeting` }] : []),
          ...(total === 0 ? [{ label: "0 temuan" }] : [])
        ],
        rows: searchRows,
        emptyNote: `Tidak ditemukan data yang cocok dengan "${argRaw}".`,
        ctaLabel: "Buka Tugas",
        ctaHref: "/tasks"
      }),
      text: [
        `🔎 **Hasil Pencarian Global: "${argRaw}" (${total} temuan teratas)**`,
        ...(matchedTasks.length ? [`\n📌 **Tugas:**\n${matchedTasks.map((t: any) => `• **${t.number_str || t.id}** — ${t.title} [${t.status}]`).join("\n")}`] : []),
        ...(matchedUsers.length ? [`\n👥 **Employee:**\n${matchedUsers.map((u: any) => `• **${u.name}** — ${u.department} (${u.job_title || "Member"})`).join("\n")}`] : []),
        ...(matchedProjects.length ? [`\n🗂️ **Proyek:**\n${matchedProjects.map((p: any) => `• **${p.name}** (${p.status})`).join("\n")}`] : []),
        ...(matchedMeetings.length ? [`\n📅 **Meeting:**\n${matchedMeetings.map((m: any) => `• **${m.title}** (${m.date} ${m.start_time || ""})`).join("\n")}`] : []),
        ...(matchedPosts.length ? [`\n📰 **Beranda:**\n${matchedPosts.map((p: any) => `• "${String(p.text || p.content || "").slice(0, 80)}"`).join("\n")}`] : []),
        ...(matchedDrive.length ? [`\n📁 **Drive:**\n${matchedDrive.map((d: any) => `• **${d.title || d.name}**`).join("\n")}`] : []),
        ...(total === 0 ? [`\nTidak ditemukan data yang cocok dengan **"${argRaw}"**.`] : [])
      ].filter(Boolean).join("\n")
    };
  }

  // =========================================================================
  // 63. /ai atau /gemini [pertanyaan bebas / instruksi AI]
  // =========================================================================
  if (cmdToken === "/ai" || cmdToken === "/gemini") {
    if (!argRaw) {
      return {
        handled: true,
        text: [
          `✨ **ASLI Gemini AI Aktif!**`,
          `Kamu bisa langsung chat bebas dengan bahasa sehari-hari atau gunakan \`/ai [pertanyaan/instruksi]\`.`,
          ``,
          `**Contoh yang bisa kamu tanyakan ke Asli:**`,
          `• **Analisa Workspace Live:** _"Siapa yang lagi under pressure dan tugas apa yang paling kritis hari ini?"_`,
          `• **Brainstorming & Strategi:** \`/ai Buatkan 5 ide campaign kreatif untuk akhir tahun beserta KPI-nya\``,
          `• **Copywriting & Konten:** \`/caption\`, \`/content-brief\`, \`/polish\`, \`/email\`, \`/translate\`, \`/summarize\``,
          `• **Eksekusi Langsung:** \`/task\`, \`/done\`, \`/meeting\`, \`/post\`, \`/poll\`, \`/remind\``
        ].join("\n")
      };
    }
    // Return handled: false if argRaw is present so it flows directly into the full context-grounded Gemini AI engine in circleBot.ts,
    // or execute via aiClient directly with full workspace intelligence:
    if (aiClient) {
      const aiResp = await tryGeminiAssist(
        aiClient,
        [
          `Kamu adalah Asli (ditenagai oleh Google Gemini AI), asisten AI eksekutif & partner brainstorming di workspace "${intel.workspace_name}".`,
          `Jika pertanyaan menyangkut data internal workspace, mengaculah 100% pada data JSON live berikut: ${JSON.stringify(intel)}.`,
          `Jika pertanyaan berupa brainstorming, copywriting, strategi, coding, atau pengetahuan umum, jawab dengan cerdas, lengkap, rapi (gunakan bullet • dan **bold**), serta solutif dalam Bahasa Indonesia.`
        ].join("\n"),
        `Pengguna: ${actorName} (${senderUser?.department || "Tim"})\nPermintaan: ${argRaw}`,
        ""
      );
      if (aiResp) {
        return { handled: true, text: aiResp };
      }
    }
    return { handled: false, text: "" };
  }

  return { handled: false, text: "" };
}
