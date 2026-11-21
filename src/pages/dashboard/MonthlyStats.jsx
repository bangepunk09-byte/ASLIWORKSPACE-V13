import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, LineChart as LineIcon, BarChart3, Users, Filter, MessageSquare, ArrowRight, CheckCircle2, AlertTriangle, Target, GitBranch, ChevronDown, Check } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { toast } from "sonner";
import { useApp } from "../../context/AppContext";
import { api, errMsg } from "../../lib/api";
import { upsertConversationInCache } from "../../lib/workspaceCaches";
import { Avatar, AvatarStack, LabelChip } from "../../components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { analyzeTaskFlow, toDayDate } from "../tasks/timelineFlow";

const WD = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WD_FULL = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const GREEN = "#4CB782";
const RED = "#E5484D";
const STATUS = { optimal: ["😄", "Optimal", "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10"], stabil: ["😐", "Stabil", "border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-500/10"], pressure: ["😰", "Under Pressure", "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10"] };
const seg = (on) => `h-9 rounded-xl px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${on ? "bg-surface text-ink shadow-sm" : "text-sub hover:text-ink"}`;

const FALLBACK_PEOPLE = [
  { user_id: "user_admin1", status: "optimal", active: 0, share: 0, day_deadlines: 0, tasks: [], more: 0 },
  { user_id: "user_superadmin_saeful", status: "optimal", active: 0, share: 0, day_deadlines: 0, tasks: [], more: 0 }
];

const INITIAL_DATA = {
  today: new Date().toISOString().slice(0, 10),
  anchor: new Date().toISOString().slice(0, 10),
  week: Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1) + i);
    return d.toISOString().slice(0, 10);
  }),
  range: "7d",
  summary: { done: 0, overdue: 0, on_time: 0, due: 0, on_time_rate: 100 },
  series: [
    { start: "2026-11-02", name: "Senin", done: 0, overdue: 0 },
    { start: "2026-11-03", name: "Selasa", done: 0, overdue: 0 },
    { start: "2026-11-04", name: "Rabu", done: 0, overdue: 0 },
    { start: "2026-11-05", name: "Kamis", done: 0, overdue: 0 },
    { start: "2026-11-06", name: "Jumat", done: 0, overdue: 0 },
    { start: "2026-11-07", name: "Sabtu", done: 0, overdue: 0 },
    { start: "2026-11-08", name: "Minggu", done: 0, overdue: 0 }
  ],
  people: FALLBACK_PEOPLE
};

const statsMemoryCache = {};

function isValidStats(d) {
  return Boolean(d && typeof d === "object" && d.summary && typeof d.summary === "object" && Array.isArray(d.series) && Array.isArray(d.people));
}

function makeStatsCacheKey(userId, boardScopeKey, rRange) {
  return `${userId || "anon"}::${boardScopeKey || "default"}::${rRange}`;
}

function getCachedStats(userId, boardScopeKey, rRange) {
  const key = makeStatsCacheKey(userId, boardScopeKey, rRange);
  if (isValidStats(statsMemoryCache[key])) return statsMemoryCache[key];
  try {
    const cached = localStorage.getItem(`circle_stats_team_cache_${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (isValidStats(parsed)) {
        statsMemoryCache[key] = parsed;
        return parsed;
      }
    }
  } catch {}
  return INITIAL_DATA;
}

function StatCard({ label, value, note, tone, icon: Icon, testid, className = "" }) {
  const t = {
    green: "border-emerald-200/90 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 dark:border-emerald-900/60",
    red: "border-rose-200/90 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 dark:border-rose-900/60",
    gray: "border bg-surface2/60 text-ink dark:border-slate-800"
  }[tone];

  const iconStyles = {
    green: "text-emerald-600 bg-emerald-100/90 dark:bg-emerald-900/50 dark:text-emerald-300",
    red: "text-rose-600 bg-rose-100/90 dark:bg-rose-900/50 dark:text-rose-300",
    gray: "text-blue-600 bg-blue-100/90 dark:bg-blue-900/50 dark:text-blue-300"
  }[tone];

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-2xl border p-3.5 sm:p-5 transition-all hover:shadow-md ${t} ${className}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.08em] sm:tracking-[0.12em] opacity-80 leading-snug break-words min-w-0">{label}</p>
        {Icon && (
          <span className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl ${iconStyles} shadow-xs`}>
            <Icon size={16} strokeWidth={2.4} />
          </span>
        )}
      </div>
      <p className="mt-1.5 sm:mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs sm:text-sm font-medium opacity-80 leading-snug">{note}</p>
    </div>
  );
}

function TeamChart({ data, type }) {
  const safeData = data || INITIAL_DATA;
  const rows = (safeData.series || []).map((s, i) => {
    const d = new Date(`${s.start}T00:00:00`);
    const future = s.start > safeData.today;
    return {
      name: safeData.range === "4w" ? `${d.getDate()} ${MON[d.getMonth()]}` : (WD_FULL[i] || s.name || s.start),
      Selesai: future ? null : (s.done ?? s.Selesai ?? 0),
      Overdue: future ? null : (s.overdue ?? s.Overdue ?? 0)
    };
  });
  const common = { data: rows, margin: { top: 10, right: 12, left: -18, bottom: 0 } };
  const axes = [<CartesianGrid key="g" strokeDasharray="3 6" vertical={false} stroke="var(--c-border, #E5E7EB)" />, <XAxis key="x" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--c-sub, #7A8194)" }} />, <YAxis key="y" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--c-sub, #7A8194)" }} />, <Tooltip key="t" cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 12 }} />];
  return (
    <div className="h-64 sm:h-72 min-h-[260px] w-full transition-all duration-300" data-testid="team-chart">
      <ResponsiveContainer width="100%" height={260} debounce={50}>
        {type === "line" ? <LineChart {...common}>{axes}<Line type="monotone" dataKey="Selesai" stroke={GREEN} strokeWidth={3} dot={{ r: safeData.range === "4w" ? 2 : 3 }} isAnimationActive={true} animationDuration={300} /><Line type="monotone" dataKey="Overdue" stroke={RED} strokeWidth={3} dot={{ r: safeData.range === "4w" ? 2 : 3 }} isAnimationActive={true} animationDuration={300} /></LineChart>
          : <BarChart {...common}>{axes}<Bar dataKey="Selesai" fill={GREEN} radius={[6, 6, 0, 0]} maxBarSize={safeData.range === "4w" ? 14 : 28} isAnimationActive={true} animationDuration={300} /><Bar dataKey="Overdue" fill={RED} radius={[6, 6, 0, 0]} maxBarSize={safeData.range === "4w" ? 14 : 28} isAnimationActive={true} animationDuration={300} /></BarChart>}
      </ResponsiveContainer>
    </div>
  );
}

const Dot = ({ c, label }) => <span className="flex items-center gap-2 text-sm text-sub"><i className="h-3 w-3 rounded-full" style={{ background: c }} />{label}</span>;

function BoardScopeDropdown({ scopeLabel, boardColor, activeMode, availableScopes = [], activeBoardId, isAdmin, onSelectBoard, testId = "stats-board-dropdown" }) {
  const { t: tr } = useApp();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-xl border bg-surface2/80 px-2.5 sm:px-3.5 text-xs sm:text-sm font-semibold text-ink hover:bg-surface2 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
          data-testid={testId}
        >
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: activeMode === "all" ? "var(--c-sub, #64748B)" : (boardColor || "var(--c-brand, #3B82F6)") }}
          />
          <span>{scopeLabel}</span>
          <ChevronDown size={14} className="text-sub shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {availableScopes.map((sc) => {
          const isActive = activeMode === "board" && activeBoardId === sc.board_id;
          return (
            <DropdownMenuItem
              key={sc.board_id}
              onClick={() => onSelectBoard(sc.board_id)}
              className={isActive ? "bg-surface2 font-bold" : ""}
              data-testid={`${testId}-option-${sc.board_id}`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: sc.color || "#3B82F6" }}
              />
              <span className="flex-1 truncate">{sc.name}</span>
              <span className="text-[11px] font-bold text-sub tabular-nums">{sc.task_count ?? 0}</span>
              {isActive && <Check size={14} className="text-brand shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onSelectBoard("all")}
              className={activeMode === "all" ? "bg-surface2 font-bold" : ""}
              data-testid={`${testId}-option-all`}
            >
              <span className="h-2 w-2 rounded-full shrink-0 bg-slate-400" />
              <span className="flex-1 truncate">{tr("stats_all_divisions", "Semua Divisi")}</span>
              {activeMode === "all" && <Check size={14} className="text-brand shrink-0" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TeamPerformance({ data, anchor, setAnchor, range, setRange, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard }) {
  const { t: tr } = useApp();
  const [type, setType] = useState("line");
  const s = data?.summary || INITIAL_DATA.summary;
  const boardColor = data?.scope?.color;
  const activeMode = data?.scope?.mode || "board";

  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseTitle = tr("dash_perf_title", "Performa & Beban Kerja Tim");
  const headingTitle = !showDropdown && scopeLabel && activeMode !== "all"
    ? `${baseTitle} ${scopeLabel}`
    : baseTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-stats">
      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <TrendingUp size={19} className="text-emerald-500 shrink-0" />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>

          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={boardColor}
              activeMode={activeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="stats-board-dropdown"
            />
          )}
        </div>
        <div className="flex flex-col items-start gap-2.5 lg:items-end shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl bg-surface2 p-1"><button onClick={() => setRange("7d")} className={seg(range === "7d")} data-testid="team-range-7d">{tr("stats_range_7d", "7 Hari")}</button><button onClick={() => setRange("4w")} className={seg(range === "4w")} data-testid="team-range-4w"><span className="sm:hidden">{tr("stats_range_4w_short", "1 Bulan")}</span><span className="hidden sm:inline">{tr("stats_range_4w_long", "1 Bulan Terakhir")}</span></button></div>
            <div className="flex rounded-2xl bg-surface2 p-1"><button onClick={() => setType("line")} className={`${seg(type === "line")} px-2.5`} aria-label="Grafik garis" data-testid="team-chart-line"><LineIcon size={16} /></button><button onClick={() => setType("bar")} className={`${seg(type === "bar")} px-2.5`} aria-label="Grafik batang" data-testid="team-chart-bar"><BarChart3 size={16} /></button></div>
          </div>
        </div>
      </div>
      <div className="mt-4 sm:mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 min-w-0">
        <StatCard tone="green" label={tr("dash_perf_done", "Tugas Selesai")} value={s.done ?? 0} note={s.done ? `${s.done} ${tr("stats_done_unit", "tugas selesai")}` : tr("stats_no_done", "Belum ada selesai")} icon={CheckCircle2} testid="team-stat-done" />
        <StatCard tone="red" label={tr("dash_perf_overdue", "Overdue")} value={s.overdue ?? 0} note={s.overdue ? `${s.overdue} ${tr("stats_late_unit", "lewat deadline")}` : tr("stats_no_late", "Tidak ada telat")} icon={AlertTriangle} testid="team-stat-overdue" />
        <StatCard tone="gray" label={tr("dash_perf_ontime", "Ketepatan Waktu")} value={`${s.on_time_rate ?? 0}%`} note={s.due ? `${s.on_time} ${tr("stats_ontime_of", "dari")} ${s.due} ${tr("stats_ontime_suffix", "tugas tepat waktu")}` : tr("stats_no_task_data", "Belum ada data tugas")} icon={Target} testid="team-stat-ontime" className="col-span-2 sm:col-span-1" />
      </div>
      <div className="mt-4 sm:mt-5 w-full min-w-0">
        <TeamChart data={data} type={type} />
      </div>
      <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 sm:pt-4"><div className="flex flex-wrap gap-4 sm:gap-5"><Dot c={GREEN} label={tr("dash_perf_done", "Tugas Selesai")} /><Dot c={RED} label={tr("dash_perf_overdue", "Overdue")} /></div><span className="text-xs sm:text-sm text-sub">{scopeLabel ? `${tr("stats_updated_from_board", "Diperbarui otomatis dari board")} ${scopeLabel}` : tr("dash_perf_updated_note", "Diperbarui otomatis dari papan tugas")}</span></div>
    </section>
  );
}

function PersonCard({ p, boardId, className = "" }) {
  const { me, userMap, t: tr } = useApp();
  const navigate = useNavigate();
  const usr = userMap?.[p.user_id];
  const [emo, lbl, cls] = STATUS[p.status] || STATUS.optimal;
  const statusLabel = tr(`personnel_status_${p.status}`, lbl);
  const barColor = p.status === "pressure" ? "bg-rose-500" : p.status === "stabil" ? "bg-[#2563EB]" : "bg-emerald-500";
  const reasonTone = p.status === "pressure"
    ? "text-rose-600 dark:text-rose-400"
    : p.status === "stabil"
    ? "text-sky-700 dark:text-sky-400"
    : "text-emerald-700 dark:text-emerald-400";
  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
  const [dmBusy, setDmBusy] = useState(false);
  const dm = async () => {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const { data } = await api.post("/conversations/dm", { user_id: p.user_id });
      if (data?.id) {
        upsertConversationInCache(data, me?.user_id);
        navigate(`/messages/${data.id}`);
      }
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka obrolan"));
    } finally {
      setDmBusy(false);
    }
  };
  const boardLink = boardId && boardId !== "all"
    ? `/tasks?assignee=${p.user_id}&kanban=1&board=${encodeURIComponent(boardId)}`
    : `/tasks?assignee=${p.user_id}&kanban=1`;
  return (
    <div className={`flex min-w-0 w-full flex-col overflow-hidden rounded-2xl sm:rounded-3xl border bg-surface p-4 sm:p-5 transition-shadow hover:shadow-md ${className}`} data-testid={`person-card-${p.user_id}`}>
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
        <Avatar user={usr} size={44} />
        <div className="min-w-0 flex-1"><p className="truncate font-bold text-sm sm:text-base leading-snug">{usr?.name}</p><p className="truncate text-xs sm:text-sm text-sub leading-snug">{usr?.job_title || "—"}</p><p className="truncate text-xs text-sub opacity-80 leading-snug">{usr?.department || tr("personnel_no_div", "Tanpa divisi")}</p></div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-bold whitespace-nowrap ${cls}`} title={p.status_reason || `${p.day_deadlines ?? 0} deadline pada hari terpilih`} data-testid={`person-status-${p.user_id}`}>{emo} {statusLabel}</span>
      </div>
      <div className="mt-3.5 sm:mt-4 flex justify-between gap-2 text-xs sm:text-sm"><span className="font-medium text-sub truncate">{tr("personnel_active_load", "Beban Tugas Aktif")}</span><span className="font-semibold tabular-nums shrink-0" data-testid={`person-load-${p.user_id}`}>{p.active ?? 0} {tr("personnel_task_unit", "tugas")} ({p.share ?? 0}%)</span></div>
      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface2"><span className={`block h-full rounded-full ${barColor} transition-[width] duration-700`} style={{ width: `${p.share ?? 0}%` }} /></span>
      {p.status_reason && <p className={`mt-2 truncate text-[11px] font-semibold ${reasonTone}`}>{p.status_reason}</p>}
      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-sub">{tr("personnel_active_tasks_label", "Tugas sedang berjalan:")}</p>
      <div className="mt-1.5 sm:mt-2 flex-1 space-y-1 min-w-0">{tasks.length ? tasks.map((t) => <Link key={t.id} to={`/tasks?task=${t.id}`} className="block truncate text-xs sm:text-sm hover:text-brand">• {t.title}</Link>) : <p className="text-xs sm:text-sm italic text-sub">{tr("personnel_no_active_tasks", "Tidak ada tugas aktif saat ini.")}</p>}{(p.more ?? 0) > 0 && <p className="text-xs text-sub">+{p.more} {tr("personnel_more_tasks", "tugas lainnya")}</p>}</div>
      <div className="mt-3.5 sm:mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 sm:pt-4">
        <button onClick={dm} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap" data-testid={`person-message-${p.user_id}`}><MessageSquare size={15} />{tr("personnel_send_msg", "Kirim Pesan")}</button>
        <Link to={boardLink} className="flex items-center gap-1 text-xs sm:text-sm font-semibold text-[#2563EB] whitespace-nowrap" data-testid={`person-kanban-${p.user_id}`}>{tr("personnel_open_board", "Buka Board")}<ArrowRight size={14} /></Link>
      </div>
    </div>
  );
}

function Personnel({ data, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard }) {
  const { userMap, t: tr } = useApp();
  const [div, setDiv] = useState("");
  const [all, setAll] = useState(false);
  const scopeMode = data?.scope?.mode || "board";
  const scopeBoardId = data?.scope?.board_id || "";
  const boardColor = data?.scope?.color;

  useEffect(() => {
    setDiv("");
    setAll(false);
  }, [scopeBoardId]);

  const rawPeople = Array.isArray(data?.people) ? data.people : INITIAL_DATA.people;
  const depts = [...new Set(rawPeople.map((p) => userMap?.[p.user_id]?.department).filter(Boolean))].sort();
  const people = rawPeople.filter((p) => {
    const u = userMap?.[p.user_id];
    if (!u || u.is_bot || u.role === "assistant" || p.user_id === "user_circle_assistant") return false;
    return !div || u.department === div;
  });
  const count = (k) => people.filter((p) => p.status === k).length;

  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseTitle = tr("dash_personnel_title", "Kapasitas & Beban Kerja Personel");
  const headingTitle = !showDropdown && scopeLabel && scopeMode !== "all"
    ? `${baseTitle} ${scopeLabel}`
    : baseTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-personnel">
      <div className="flex flex-col gap-3 sm:gap-4 border-b pb-4 sm:pb-5 lg:flex-row lg:items-center lg:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <Users size={19} className="text-[#2563EB] shrink-0" />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>
          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={boardColor}
              activeMode={scopeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="personnel-board-dropdown"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">{Object.entries(STATUS).map(([k, [e, l, c]]) => <span key={k} className={`flex items-center gap-1 rounded-full border px-2.5 sm:px-3.5 py-1 sm:py-1.5 text-xs sm:text-sm font-bold ${c}`} data-testid={`personnel-count-${k}`}>{e} {count(k)} {tr(`personnel_status_${k}`, l)}</span>)}</div>
      </div>
      {scopeMode === "all" && depts.length > 1 && <div className="mt-3.5 sm:mt-4 flex w-full max-w-full min-w-0 flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0" data-testid="personnel-division-filter">
        <span className="flex shrink-0 items-center gap-1 text-xs sm:text-sm text-sub"><Filter size={13} />{tr("personnel_div_filter_label", "Divisi:")}</span>
        {[["", tr("stats_all_divisions", "Semua Divisi")], ...depts.map((d) => [d, d])].map(([k, l]) => <button key={k || "all"} onClick={() => setDiv(k)} className={`h-9 sm:h-10 shrink-0 whitespace-nowrap rounded-2xl px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${div === k ? "bg-brand text-white shadow-xs" : "bg-surface2 text-ink hover:bg-surface2/70"}`} data-testid={`personnel-div-${k ? k.replace(/\s/g, "-") : "all"}`}>{l}</button>)}
      </div>}
      <div className="mt-4 sm:mt-5 grid grid-cols-1 gap-3.5 sm:gap-4 md:grid-cols-2 xl:grid-cols-3 min-w-0">
        {(all ? people : people.slice(0, 6)).map((p, idx) => (
          <PersonCard key={p.user_id} p={p} boardId={scopeBoardId} className={!all && idx >= 3 ? "hidden md:flex" : ""} />
        ))}
      </div>
      {people.length > 3 && (
        <button
          onClick={() => setAll(!all)}
          className={`mt-4 sm:mt-5 w-full rounded-2xl border py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-sub hover:text-ink transition-colors ${people.length > 6 ? "" : "md:hidden"}`}
          data-testid="personnel-toggle-all"
        >
          {all ? tr("personnel_show_less", "Tampilkan lebih sedikit") : `${tr("personnel_show_all_prefix", "Lihat semua personel")} (${people.length})`}
        </button>
      )}
      {!people.length && <p className="mt-6 text-sm text-sub">{tr("personnel_empty_board", "Belum ada personel terdaftar di board divisi ini.")}</p>}
    </section>
  );
}

function BottleneckSummary({ tasks = [], projectsMap = {}, scope, scopeLabel, availableScopes = [], activeBoardId, canSwitchBoards, isAdmin, onSelectBoard, onOpenTask }) {
  const { userMap, labelMap, tasks: ctxTasks, me, t: tr } = useApp();
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);

  const sourceTasks = Array.isArray(tasks) && tasks.length > 0 ? tasks : Array.isArray(ctxTasks) ? ctxTasks : [];
  const todayDay = toDayDate(new Date());

  const rows = useMemo(() => {
    const scopeMode = scope?.mode;
    const scopeBoardId = scope?.board_id;
    const scopeDept = String(scope?.department || (!scope && me?.department ? me.department : "")).trim().toLowerCase();

    const active = sourceTasks.filter((t) => {
      if (!t || t.archived || t.status === "done") return false;
      const hasFlowSignal = t.deadline || t.start_date || t.created_at || (Array.isArray(t.checkpoints) && t.checkpoints.length > 0);
      if (!hasFlowSignal) return false;
      if (scopeMode === "board" && scopeBoardId) {
        if (t.board_id === scopeBoardId) return true;
        if (!t.board_id && scopeDept && String(t.department || "").trim().toLowerCase() === scopeDept) return true;
        return false;
      }
      if (!scope && scopeDept && me?.role !== "super_admin" && me?.role !== "workspace_admin") {
        if (t.department && String(t.department).trim().toLowerCase() !== scopeDept) return false;
      }
      return true;
    });

    const analyzed = active
      .map((t) => analyzeTaskFlow(t, userMap, todayDay))
      .filter((r) => r.hasBottleneck);

    analyzed.sort((a, b) => {
      const ba = a.primaryBottleneck;
      const bb = b.primaryBottleneck;
      const sevA = ba.severity === "critical" ? 2 : 1;
      const sevB = bb.severity === "critical" ? 2 : 1;
      if (sevB !== sevA) return sevB - sevA;
      if ((bb.overdueDays || 0) !== (ba.overdueDays || 0)) return (bb.overdueDays || 0) - (ba.overdueDays || 0);
      if ((bb.issueCount || 0) !== (ba.issueCount || 0)) return (bb.issueCount || 0) - (ba.issueCount || 0);
      return (bb.daysInStage || 0) - (ba.daysInStage || 0);
    });

    return analyzed;
  }, [sourceTasks, userMap, todayDay, scope, me?.department, me?.role]);

  const timelineHref = scope?.mode === "board" && scope?.board_id
    ? `/tasks?timeline=1&bottleneck=1&board=${encodeURIComponent(scope.board_id)}`
    : "/tasks?timeline=1&bottleneck=1";

  const visibleRows = showAll ? rows : rows.slice(0, 6);

  const capitalize = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const activeMode = scope?.mode || "board";
  const showDropdown = Boolean(canSwitchBoards && scopeLabel);
  const baseBnTitle = tr("bottleneck_title", "Rekap Bottleneck Proyek");
  const headingTitle = !showDropdown && scopeLabel && activeMode !== "all"
    ? `${baseBnTitle} ${scopeLabel}`
    : baseBnTitle;

  return (
    <section className="card w-full min-w-0 overflow-hidden p-4 sm:p-6 md:col-span-2 xl:col-span-3" data-testid="widget-bottleneck-summary">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h3 className="flex items-center gap-2 text-lg sm:text-xl font-bold leading-snug">
            <AlertTriangle size={19} className={rows.length > 0 ? "text-rose-500 shrink-0" : "text-emerald-500 shrink-0"} />
            <span className="truncate py-0.5">{headingTitle}</span>
          </h3>
          {showDropdown && (
            <BoardScopeDropdown
              scopeLabel={scopeLabel}
              boardColor={scope?.color}
              activeMode={activeMode}
              availableScopes={availableScopes}
              activeBoardId={activeBoardId}
              isAdmin={isAdmin}
              onSelectBoard={onSelectBoard}
              testId="bottleneck-board-dropdown"
            />
          )}
        </div>

        <Link
          to={timelineHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface2/70 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-brand hover:bg-surface2 transition-colors whitespace-nowrap self-start"
          data-testid="bottleneck-open-timeline"
        >
          <span>{tr("bottleneck_open_timeline", "Buka Timeline Flow")}</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3.5 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold">{tr("bottleneck_empty_title", "Tidak ada bottleneck terdeteksi saat ini")}</p>
            <p className="text-[11px] sm:text-xs opacity-80">{tr("bottleneck_empty_desc", "Semua proyek dan estafet checkpoint berjalan sesuai target deadline.")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/80 bg-surface">
            <div className="hidden md:grid md:grid-cols-12 gap-3 border-b bg-surface2/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-sub">
              <div className="col-span-4">{tr("bottleneck_col_task", "Task")}</div>
              <div className="col-span-5">{tr("bottleneck_col_issue", "Kendala")}</div>
              <div className="col-span-3">{tr("bottleneck_col_pic", "PIC")}</div>
            </div>

            <div className="divide-y divide-border/70">
              {visibleRows.map((row) => {
                const { task, primaryBottleneck: bn, stages, doneCount } = row;
                const isCrit = bn.severity === "critical";
                const firstLabel = (task.label_ids || []).map((id) => labelMap[id]).find(Boolean) || null;
                const projectObj = task.project_id ? projectsMap[task.project_id] : null;
                const projectLabel = (projectObj?.label_ids || []).map((id) => labelMap[id]).find(Boolean) || null;
                const projectName = projectObj?.name || firstLabel?.name || task.department || "";
                const matchedLabelByName = projectName
                  ? Object.values(labelMap).find((l) => String(l?.name || "").trim().toLowerCase() === String(projectName).trim().toLowerCase())
                  : null;
                const ipLabel = (!projectObj ? firstLabel : null) || matchedLabelByName || projectLabel || firstLabel || null;
                const ipColor = ipLabel?.color || projectObj?.color || "";
                const stageLabel = bn.isTaskLevel
                  ? ""
                  : stages.length > 0
                  ? `${tr("bottleneck_stage_prefix", "Tahap")} ${bn.index + 1}/${stages.length}: ${bn.title}`
                  : bn.title;
                const mainReason = capitalize(bn.detailSummary) || bn.shortReason || tr("bottleneck_default_reason", "Melewati target jadwal");
                const noteText = bn.issueNotes?.[0] || "";
                const picList = Array.isArray(bn.picUsers) ? bn.picUsers : bn.picUser ? [bn.picUser] : [];

                const handleOpen = () => {
                  if (typeof onOpenTask === "function") onOpenTask(task.id);
                  else navigate(`/tasks?task=${task.id}`);
                };

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={handleOpen}
                    className="group w-full text-left px-3.5 py-3 sm:px-4 hover:bg-surface2/60 transition-colors cursor-pointer grid grid-cols-1 md:grid-cols-12 gap-2.5 md:gap-3 items-start md:items-center"
                    data-testid={`bottleneck-row-${task.id}`}
                  >
                    {/* Col 1: Task & Tahap */}
                    <div className="md:col-span-4 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        {projectName && (
                          ipColor ? (
                            <LabelChip
                              label={{ id: ipLabel?.id || task.id, name: projectName, color: ipColor }}
                              small
                            />
                          ) : (
                            <span className="max-w-[140px] truncate rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sub">
                              {projectName}
                            </span>
                          )
                        )}
                        <span className="truncate text-xs sm:text-sm font-bold text-ink group-hover:text-brand transition-colors">
                          {task.title}
                        </span>
                      </div>
                      {!bn.isTaskLevel && (stageLabel || stages.length > 0) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {stageLabel && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                                isCrit
                                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                  : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                              }`}
                            >
                              <GitBranch size={10} />
                              <span className="truncate max-w-[200px]">{stageLabel}</span>
                            </span>
                          )}
                          {stages.length > 0 && (
                            <span className="text-[10.5px] font-medium text-sub">
                              ({doneCount}/{stages.length} {tr("bottleneck_done_suffix", "selesai")})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Col 2: Kendala & Dampak */}
                    <div className="md:col-span-5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            isCrit
                              ? "bg-rose-500 text-white"
                              : "bg-amber-500 text-white"
                          }`}
                        >
                          {bn.shortReason || "Bottleneck"}
                        </span>
                        <span className="text-xs font-medium text-ink truncate sm:whitespace-normal">
                          {mainReason}
                        </span>
                      </div>
                      {noteText && (
                        <p className="mt-1 truncate text-[11px] font-medium text-rose-700 dark:text-rose-300">
                          {tr("bottleneck_issue_prefix", "Kendala:")} &ldquo;{noteText}&rdquo;
                        </p>
                      )}
                      {bn.impactText && (
                        <p className="mt-0.5 truncate text-[11px] text-sub">
                          {bn.impactText}
                        </p>
                      )}
                    </div>

                    {/* Col 3: PIC */}
                    <div className="md:col-span-3 flex items-center justify-between md:justify-start gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {picList.length > 1 ? (
                          <AvatarStack ids={bn.picIds} max={3} size={24} />
                        ) : picList.length === 1 ? (
                          <Avatar user={picList[0]} size={24} showStatus={false} />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-[10px] font-bold text-sub">
                            ?
                          </span>
                        )}
                        <span className={`truncate text-xs font-semibold ${picList.length > 0 ? "text-ink" : "text-sub italic"}`}>
                          {bn.picName}
                        </span>
                      </div>
                      <ArrowRight size={14} className="shrink-0 text-sub opacity-60 group-hover:text-brand group-hover:translate-x-0.5 transition-all md:ml-auto" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {rows.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3.5 w-full rounded-2xl border py-2.5 text-xs sm:text-sm font-semibold text-sub hover:text-ink transition-colors cursor-pointer"
              data-testid="bottleneck-toggle-all"
            >
              {showAll ? tr("bottleneck_show_less", "Tampilkan lebih sedikit") : `${tr("bottleneck_show_all_prefix", "Lihat semua bottleneck")} (${rows.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function MonthlyStats({ showPerformance = true, showBottleneck = true, showPersonnel = true, tasks = [], onOpenTask }) {
  const { subscribe, me, isAdmin } = useApp();
  const [anchor, setAnchor] = useState(null);
  const [range, setRange] = useState("7d");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [data, setData] = useState(() => getCachedStats(me?.user_id, "default", "7d"));
  const [projectsMap, setProjectsMap] = useState({});

  useEffect(() => {
    setSelectedBoardId("");
    setData(getCachedStats(me?.user_id, "default", range));
  }, [me?.user_id]);

  const load = useCallback((targetRange, targetBoardId) => {
    const r = targetRange || range;
    const bId = targetBoardId !== undefined ? targetBoardId : selectedBoardId;
    const scopeKey = bId || "default";
    const cached = getCachedStats(me?.user_id, scopeKey, r);
    if (cached) setData(cached);

    api.get("/stats/team", {
      params: {
        range: r,
        ...(bId ? { board_id: bId } : {}),
        ...(anchor ? { anchor } : {})
      }
    })
      .then((res) => {
        if (isValidStats(res.data)) {
          const cacheKey = makeStatsCacheKey(me?.user_id, scopeKey, r);
          statsMemoryCache[cacheKey] = res.data;
          setData(res.data);
          try {
            localStorage.setItem(`circle_stats_team_cache_${cacheKey}`, JSON.stringify(res.data));
          } catch {}
        }
      })
      .catch(() => {});
  }, [anchor, range, selectedBoardId, me?.user_id]);

  useEffect(() => {
    load(range, selectedBoardId);
  }, [range, selectedBoardId, load]);

  useEffect(() => {
    if (!showBottleneck) return;
    api.get("/projects")
      .then((res) => {
        if (Array.isArray(res.data)) {
          setProjectsMap(Object.fromEntries(res.data.map((p) => [p.id, p])));
        }
      })
      .catch(() => {});
  }, [showBottleneck]);

  useEffect(() => {
    return subscribe((evt) => {
      if (evt.type === "tasks:changed" || evt.type === "tasks:deleted" || evt.type === "users:changed" || evt.type === "boards:changed") {
        load(range, selectedBoardId);
      }
    });
  }, [subscribe, load, range, selectedBoardId]);

  if (!showPerformance && !showBottleneck && !showPersonnel) return null;

  const isSuperAdmin = me?.role === "super_admin";
  const availableScopes = Array.isArray(data?.available_scopes) ? data.available_scopes : [];
  const activeScope = data?.scope || null;
  const activeBoardId = activeScope?.board_id || selectedBoardId;
  const activeScopeLabel = activeScope?.board_name || me?.department || "";
  const canSwitchBoards = isSuperAdmin && availableScopes.length > 0;

  return (
    <div className="space-y-4 sm:space-y-8">
      {showPerformance && (
        <TeamPerformance
          data={data || INITIAL_DATA}
          anchor={data?.anchor || INITIAL_DATA.anchor}
          setAnchor={setAnchor}
          range={range}
          setRange={setRange}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={setSelectedBoardId}
        />
      )}
      {showBottleneck && (
        <BottleneckSummary
          tasks={tasks}
          projectsMap={projectsMap}
          scope={activeScope}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={setSelectedBoardId}
          onOpenTask={onOpenTask}
        />
      )}
      {showPersonnel && (
        <Personnel
          data={data || INITIAL_DATA}
          scopeLabel={activeScopeLabel}
          availableScopes={availableScopes}
          activeBoardId={activeBoardId}
          canSwitchBoards={canSwitchBoards}
          isAdmin={isAdmin}
          onSelectBoard={setSelectedBoardId}
        />
      )}
    </div>
  );
}

