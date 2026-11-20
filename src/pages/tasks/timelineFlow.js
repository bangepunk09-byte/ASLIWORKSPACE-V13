import { addDays, differenceInCalendarDays, format } from "date-fns";
import { id as localeId } from "date-fns/locale";

export function toDayDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function minDay(...list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

export function maxDay(...list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

export function fmtShortDay(d) {
  if (!d) return "";
  try {
    return format(d, "d MMM", { locale: localeId });
  } catch {
    return "";
  }
}

export function firstName(user) {
  if (!user?.name) return "Tanpa PIC";
  return String(user.name).trim().split(/\s+/)[0];
}

function collectTaskAssigneeIds(task, userMap) {
  const raw = [];
  if (Array.isArray(task.assignee_ids)) raw.push(...task.assignee_ids);
  if (task.assignee_id) raw.push(task.assignee_id);
  const uniq = Array.from(new Set(raw.filter(Boolean)));
  const validKnown = uniq.filter((id) => userMap?.[id]);
  return validKnown.length > 0 ? validKnown : uniq;
}

export function analyzeTaskFlow(task, userMap = {}, todayDayInput = null) {
  const todayDay = todayDayInput || toDayDate(new Date());
  const isTaskDone = task.status === "done";
  const taskStart = toDayDate(task.start_date) || toDayDate(task.created_at) || toDayDate(task.deadline) || todayDay;
  const taskDeadline = toDayDate(task.deadline);
  const taskPicIds = collectTaskAssigneeIds(task, userMap);
  const defaultPicId = taskPicIds[0] || null;
  const rawCps = Array.isArray(task.checkpoints) ? task.checkpoints : [];
  const comments = Array.isArray(task.comments) ? task.comments : [];

  const cps = rawCps.map((c, idx) => {
    if (typeof c === "string") {
      return {
        id: `cp_${idx}`,
        title: c,
        assignee_id: defaultPicId,
        unassigned: false,
        deadline: "",
        done: false,
        started_at: null,
        done_at: null,
      };
    }
    return {
      ...c,
      id: c.id || `cp_${idx}`,
      title: c.title || `Tahap ${idx + 1}`,
      assignee_id: c.assignee_id || (!c.unassigned ? defaultPicId : null),
      deadline: c.deadline || "",
      done: !!c.done,
      started_at: c.started_at || null,
      done_at: c.done_at || null,
    };
  });

  const activeIdx = isTaskDone ? -1 : cps.findIndex((c) => !c.done);
  const stages = [];

  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i];
    const prev = i > 0 ? stages[i - 1] : null;
    const explicitStart = toDayDate(cp.started_at);
    let startDay;

    if (i === 0) {
      startDay = explicitStart || taskStart;
    } else if (prev.done) {
      startDay = explicitStart || toDayDate(prev.done_at) || prev.endDay;
    } else {
      startDay = explicitStart || prev.endDay;
    }
    if (!startDay) startDay = taskStart;

    const cpDeadline = toDayDate(cp.deadline);
    const cpDoneDay = cp.done ? (toDayDate(cp.done_at) || cpDeadline || startDay) : null;
    const isActive = !isTaskDone && !cp.done && i === activeIdx;
    const unresolvedIssues = comments.filter(
      (cm) => cm && cm.checkpoint_id === cp.id && cm.kind === "issue" && !cm.resolved
    );
    const issueNotes = unresolvedIssues
      .map((cm) => String(cm.text || cm.body || "").trim())
      .filter(Boolean);

    let endDay;
    if (cp.done) {
      endDay = maxDay(startDay, cpDoneDay) || startDay;
    } else if (isActive) {
      if (cpDeadline) {
        endDay = todayDay > cpDeadline ? todayDay : maxDay(startDay, cpDeadline);
      } else {
        endDay = maxDay(startDay, todayDay) || startDay;
      }
    } else {
      if (cpDeadline && cpDeadline >= startDay) {
        endDay = cpDeadline;
      } else if (taskDeadline && taskDeadline > startDay) {
        const remainingCount = Math.max(1, cps.length - i);
        const spanDays = differenceInCalendarDays(taskDeadline, startDay);
        const sliceDays = Math.max(0, Math.floor(spanDays / remainingCount));
        endDay = addDays(startDay, sliceDays);
      } else {
        endDay = addDays(startDay, 1);
      }
    }

    if (endDay < startDay) endDay = startDay;

    const overdueDays =
      !isTaskDone && !cp.done && cpDeadline && todayDay > cpDeadline
        ? differenceInCalendarDays(todayDay, cpDeadline)
        : 0;
    const daysInStage = isActive ? Math.max(0, differenceInCalendarDays(todayDay, startDay)) : 0;
    const isStalled = isActive && daysInStage > 2;
    const issueCount = unresolvedIssues.length;
    const isBottleneck = !isTaskDone && !cp.done && (overdueDays > 0 || issueCount > 0 || isStalled);
    const severity = overdueDays > 0 || issueCount > 0 ? "critical" : isStalled ? "warning" : "normal";

    const stagePicIds = cp.assignee_id
      ? [cp.assignee_id]
      : (!cp.unassigned ? taskPicIds : []);
    const picUser = stagePicIds.map((id) => userMap?.[id]).find(Boolean) || null;
    const picUsers = stagePicIds.map((id) => userMap?.[id]).filter(Boolean);
    const picName = picUsers.length > 0 ? picUsers.map((u) => u.name).join(", ") : "Belum ada PIC";
    const picShort = picUser ? firstName(picUser) : "Tanpa PIC";

    const downstreamWaiting = cps.slice(i + 1).filter((x) => !x.done);
    const nextBlocked = downstreamWaiting[0] || null;
    const nextPicUser = nextBlocked?.assignee_id ? userMap?.[nextBlocked.assignee_id] : null;

    const reasonParts = [];
    if (overdueDays > 0) reasonParts.push(`Telat ${overdueDays} hr`);
    if (issueCount > 0) reasonParts.push(`${issueCount} kendala`);
    if (isStalled && overdueDays === 0) reasonParts.push(`Mandek ${daysInStage} hr`);
    const shortReason = reasonParts.join(" · ");

    const detailParts = [];
    if (overdueDays > 0) {
      detailParts.push(`telat ${overdueDays} hari dari target ${fmtShortDay(cpDeadline)}`);
    }
    if (issueCount > 0) {
      detailParts.push(`${issueCount} kendala aktif`);
    }
    if (isStalled) {
      detailParts.push(`mengendap ${daysInStage} hari tanpa selesai`);
    }
    let impactText = "";
    if (downstreamWaiting.length > 0 && nextBlocked) {
      const nextPicLabel = nextPicUser ? ` (${firstName(nextPicUser)})` : "";
      impactText = `Menahan ${downstreamWaiting.length} tahap berikutnya: ${nextBlocked.title}${nextPicLabel}`;
    }

    const status = cp.done
      ? "done"
      : isBottleneck
      ? "bottleneck"
      : isActive
      ? "active"
      : "waiting";

    stages.push({
      ...cp,
      index: i,
      startDay,
      endDay,
      deadlineDay: cpDeadline,
      doneDay: cpDoneDay,
      isActive,
      isBottleneck,
      severity,
      overdueDays,
      daysInStage,
      isStalled,
      issueCount,
      issueNotes,
      shortReason,
      detailSummary: detailParts.join(", "),
      impactText,
      downstreamCount: downstreamWaiting.length,
      status,
      picIds: stagePicIds,
      picUser,
      picUsers,
      picName,
      picShort,
      durationDays: Math.max(1, differenceInCalendarDays(endDay, startDay) + 1),
    });
  }

  // Fallback for tasks without checkpoints (or task-level unresolved issues)
  const taskIssues = comments.filter((cm) => cm && cm.kind === "issue" && !cm.resolved);
  const taskIssueNotes = taskIssues
    .map((cm) => String(cm.text || cm.body || "").trim())
    .filter(Boolean);
  const taskOverdueDays =
    !isTaskDone && taskDeadline && todayDay > taskDeadline
      ? differenceInCalendarDays(todayDay, taskDeadline)
      : 0;
  const taskActiveDays = !isTaskDone ? Math.max(0, differenceInCalendarDays(todayDay, taskStart)) : 0;

  let flowStart = taskStart;
  let flowEnd;
  if (stages.length > 0) {
    flowStart = minDay(taskStart, ...stages.map((s) => s.startDay)) || taskStart;
    flowEnd = maxDay(taskStart, taskDeadline, ...stages.map((s) => s.endDay)) || taskStart;
  } else {
    const doneDay = isTaskDone ? toDayDate(task.completed_at) : null;
    flowEnd = isTaskDone
      ? maxDay(taskStart, doneDay || taskDeadline || taskStart)
      : taskOverdueDays > 0
      ? todayDay
      : maxDay(taskStart, taskDeadline || todayDay);
  }
  if (!flowEnd || flowEnd < flowStart) flowEnd = flowStart;

  const bottlenecks = stages.filter((s) => s.isBottleneck);
  if (stages.length === 0 && !isTaskDone && (taskOverdueDays > 0 || taskIssues.length > 0)) {
    const picUsers = taskPicIds.map((id) => userMap?.[id]).filter(Boolean);
    const picUser = picUsers[0] || null;
    const reasonParts = [];
    if (taskOverdueDays > 0) reasonParts.push(`Telat ${taskOverdueDays} hr`);
    if (taskIssues.length > 0) reasonParts.push(`${taskIssues.length} kendala`);
    const detailParts = [];
    if (taskOverdueDays > 0) {
      detailParts.push(`melewati deadline ${taskOverdueDays} hari (${fmtShortDay(taskDeadline)})`);
    }
    if (taskIssues.length > 0) {
      detailParts.push(`${taskIssues.length} kendala aktif`);
    }
    bottlenecks.push({
      id: `${task.id}_task`,
      title: "Deadline Tugas",
      index: -1,
      picIds: taskPicIds,
      picUser,
      picUsers,
      picName: picUsers.length > 0 ? picUsers.map((u) => u.name).join(", ") : "Belum ada PIC",
      picShort: picUser ? firstName(picUser) : "Tanpa PIC",
      shortReason: reasonParts.join(" · "),
      detailSummary: detailParts.join(", "),
      issueNotes: taskIssueNotes,
      impactText: "",
      severity: "critical",
      overdueDays: taskOverdueDays,
      daysInStage: taskActiveDays,
      issueCount: taskIssues.length,
      isTaskLevel: true,
    });
  }

  const activeStage = stages.find((s) => s.isActive) || null;
  const doneCount = stages.filter((s) => s.done).length;
  const primaryBottleneck = bottlenecks[0] || null;

  return {
    task,
    taskStart,
    taskDeadline,
    flowStart,
    flowEnd,
    isTaskDone,
    stages,
    activeStage,
    doneCount,
    bottlenecks,
    primaryBottleneck,
    hasBottleneck: bottlenecks.length > 0,
    totalDurationDays: Math.max(1, differenceInCalendarDays(flowEnd, flowStart) + 1),
  };
}
