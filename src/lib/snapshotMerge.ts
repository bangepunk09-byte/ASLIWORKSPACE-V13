export const DEFAULT_SEED_USER_IDS = new Set([
  'user_admin1',
  'user_superadmin_saeful',
  'user_circle_assistant',
]);

export function getItemId(item: any, altKey?: string): string {
  if (!item || typeof item !== 'object') return '';
  const raw =
    item.id ??
    (altKey ? item[altKey] : undefined) ??
    item.task_id ??
    item.board_id ??
    item.post_id ??
    item.note_id ??
    item.user_id;
  return raw ? String(raw).trim() : '';
}

export function getTaskApprovedBy(task: any): string[] {
  if (!task || typeof task !== 'object') return [];
  const rawA = Array.isArray(task?.approvals?.approved_by) ? task.approvals.approved_by : [];
  const rawB = Array.isArray(task?.approval?.approved_by) ? task.approval.approved_by : [];
  return Array.from(
    new Set(
      [...rawA, ...rawB]
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)
    )
  );
}

export function hasTwoOrMoreApprovals(task: any): boolean {
  return getTaskApprovedBy(task).length >= 2;
}

export function enforceTaskApprovalInvariant(task: any, extraApproved: string[] = []): any {
  if (!task || typeof task !== 'object') return task;
  const approvedBy = Array.from(
    new Set([
      ...getTaskApprovedBy(task),
      ...(Array.isArray(extraApproved) ? extraApproved.map((x) => String(x || '').trim()).filter(Boolean) : []),
    ])
  );
  const existingApprovals =
    (task.approvals && typeof task.approvals === 'object' ? task.approvals : null) ||
    (task.approval && typeof task.approval === 'object' ? task.approval : null) ||
    {};

  if (approvedBy.length >= 2) {
    const completedAt = task.completed_at || task.updated_at || new Date().toISOString();
    let compliance = 'On time';
    if (task.deadline) {
      const dlMs = new Date(task.deadline).getTime();
      const compMs = new Date(completedAt).getTime();
      if (!Number.isNaN(dlMs) && !Number.isNaN(compMs) && compMs > dlMs) {
        compliance = 'Overdue';
      }
    }
    const syncedApprovals = {
      needed: 2,
      ...existingApprovals,
      approved_by: approvedBy,
      status: 'approved',
    };
    return {
      ...task,
      status: 'done',
      progress: 100,
      completed_at: completedAt,
      completed_by: task.completed_by || approvedBy[approvedBy.length - 1],
      deadline_compliance: compliance,
      approvals: syncedApprovals,
      approval: syncedApprovals,
    };
  }

  const nextStatus =
    task.status === 'done'
      ? 'approved'
      : approvedBy.length === 1
        ? 'partial'
        : existingApprovals.status || 'pending';
  const syncedApprovals = {
    needed: 2,
    ...existingApprovals,
    approved_by: approvedBy,
    status: nextStatus,
  };
  const nextProgress =
    approvedBy.length === 1 && (!Array.isArray(task.checkpoints) || task.checkpoints.length === 0)
      ? Math.max(Number(task.progress) || 0, 50)
      : task.progress;

  return {
    ...task,
    ...(nextProgress !== undefined ? { progress: nextProgress } : {}),
    approvals: syncedApprovals,
    approval: syncedApprovals,
  };
}

export function mergeItemsById(existingList: any[], incomingList: any[], altKey?: string): any[] {
  const out = Array.isArray(existingList) ? [...existingList] : [];
  const idxMap = new Map<string, number>();
  out.forEach((it, idx) => {
    const id = getItemId(it, altKey);
    if (id) idxMap.set(id, idx);
  });

  for (const inc of Array.isArray(incomingList) ? incomingList : []) {
    const id = getItemId(inc, altKey);
    if (!id) continue;
    const normalized = !inc.id && altKey !== 'user_id' ? { ...inc, id } : inc;
    const existingIdx = idxMap.get(id);
    if (existingIdx === undefined) {
      idxMap.set(id, out.length);
      out.push(normalized);
    } else {
      const cur = out[existingIdx];
      const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
      const incTime = new Date(normalized?.updated_at || normalized?.created_at || 0).getTime();
      if (incTime > curTime) {
        out[existingIdx] = { ...cur, ...normalized };
      } else {
        // Fill any missing non-empty sub-arrays (comments/attachments) if current has fewer
        if (
          altKey === 'task_id' &&
          Array.isArray(normalized?.comments) &&
          normalized.comments.length > (Array.isArray(cur?.comments) ? cur.comments.length : 0)
        ) {
          out[existingIdx] = {
            ...out[existingIdx],
            comments: mergeItemsById(cur?.comments || [], normalized.comments),
          };
        }
      }
    }
  }
  return out;
}

export function mergeTasksArrayNonDestructive(existingList: any[], incomingList: any[]): any[] {
  const out = (Array.isArray(existingList) ? existingList : [])
    .filter((t) => t && typeof t === 'object')
    .map((t) => enforceTaskApprovalInvariant(t));
  const idxMap = new Map<string, number>();
  out.forEach((it, idx) => {
    const id = getItemId(it, 'task_id');
    if (id) idxMap.set(id, idx);
  });

  for (const rawInc of Array.isArray(incomingList) ? incomingList : []) {
    const id = getItemId(rawInc, 'task_id');
    if (!id) continue;
    const normalized = enforceTaskApprovalInvariant(!rawInc.id ? { ...rawInc, id } : rawInc);
    const existingIdx = idxMap.get(id);
    if (existingIdx === undefined) {
      idxMap.set(id, out.length);
      out.push(normalized);
      continue;
    }

    const cur = out[existingIdx];
    const curTime = new Date(cur?.updated_at || cur?.created_at || 0).getTime();
    const incTime = new Date(normalized?.updated_at || normalized?.created_at || 0).getTime();

    const curApproved = getTaskApprovedBy(cur);
    const incApproved = getTaskApprovedBy(normalized);
    const incWasExplicitlyRevised =
      normalized?.approvals?.status === 'revised' &&
      incApproved.length === 0 &&
      curApproved.length < 2 &&
      incTime > curTime;

    // 2+ approvals is strictly monotonic ("saklek"): always union approvals unless <2 and explicitly revised
    const mergedApproved = incWasExplicitlyRevised
      ? []
      : Array.from(new Set([...curApproved, ...incApproved].filter(Boolean)));

    const isSaklekApprovedDone = mergedApproved.length >= 2;
    const curCompleted100Done =
      cur?.status === 'done' && Number(cur?.progress ?? 0) >= 100 && normalized?.approvals?.status !== 'revised';
    const incCompleted100Done =
      normalized?.status === 'done' && Number(normalized?.progress ?? 0) >= 100 && cur?.approvals?.status !== 'revised';

    const curComments = Array.isArray(cur?.comments) ? cur.comments : [];
    const incComments = Array.isArray(normalized?.comments) ? normalized.comments : [];
    const mergedComments =
      incComments.length > 0 ? mergeItemsById(curComments, incComments) : curComments;

    const curCps = Array.isArray(cur?.checkpoints) ? cur.checkpoints : [];
    const incCps = Array.isArray(normalized?.checkpoints) ? normalized.checkpoints : [];
    const mergedCps = incCps.length > curCps.length || incTime > curTime ? incCps : curCps;

    const base = incTime > curTime ? { ...cur, ...normalized } : { ...normalized, ...cur };

    // Prevent stale/older non-done status from reverting a 2/2-approved or 100%-done task
    let merged: any = {
      ...base,
      comments: mergedComments,
      checkpoints: mergedCps,
    };

    if (isSaklekApprovedDone) {
      merged = {
        ...merged,
        status: 'done',
        progress: 100,
        completed_at: cur?.completed_at || normalized?.completed_at || base.updated_at || new Date().toISOString(),
        completed_by: cur?.completed_by || normalized?.completed_by || mergedApproved[mergedApproved.length - 1],
      };
    } else if ((curCompleted100Done && incTime > curTime && normalized.status !== 'done') || incCompleted100Done) {
      const doneSource = curCompleted100Done ? cur : normalized;
      merged = {
        ...merged,
        status: 'done',
        progress: 100,
        completed_at: doneSource.completed_at || doneSource.updated_at || merged.completed_at,
        completed_by: doneSource.completed_by || merged.completed_by,
        deadline_compliance: doneSource.deadline_compliance || merged.deadline_compliance,
      };
    }

    out[existingIdx] = enforceTaskApprovalInvariant(merged, mergedApproved);
  }

  return out;
}

export function computePayloadSummary(payload: any): Record<string, number> {
  const d = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const uploads = payload?.uploaded_files_base64 || {};
  return {
    users: Array.isArray(d.users)
      ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant').length
      : 0,
    tasks: Array.isArray(d.tasks) ? d.tasks.length : 0,
    projects: Array.isArray(d.projects) ? d.projects.length : 0,
    boards: Array.isArray(d.boards) ? d.boards.length : 0,
    conversations: Array.isArray(d.conversations) ? d.conversations.length : 0,
    groups: Array.isArray(d.groups) ? d.groups.length : 0,
    messages: Array.isArray(d.messages) ? d.messages.length : 0,
    posts: Array.isArray(d.posts) ? d.posts.length : 0,
    org_units: Array.isArray(d.org_units) ? d.org_units.length : 0,
    polls: Array.isArray(d.polls) ? d.polls.length : 0,
    circle_notes: Array.isArray(d.circle_notes) ? d.circle_notes.length : 0,
    stickers: Array.isArray(d.stickers) ? d.stickers.length : 0,
    upload_files: uploads && typeof uploads === 'object' ? Object.keys(uploads).length : 0,
  };
}

export function hasMeaningfulWorkspaceData(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const d = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const humanUsers = Array.isArray(d.users)
    ? d.users.filter((u: any) => !u?.is_bot && u?.role !== 'assistant')
    : [];
  const hasCustomUser = humanUsers.some((u: any) => u?.user_id && !DEFAULT_SEED_USER_IDS.has(u.user_id));
  const usersCount = humanUsers.length;
  const tasksCount = Array.isArray(d.tasks) ? d.tasks.length : 0;
  const msgsCount = Array.isArray(d.messages) ? d.messages.length : 0;
  const postsCount = Array.isArray(d.posts) ? d.posts.length : 0;
  const notesCount = Array.isArray(d.circle_notes) ? d.circle_notes.length : 0;
  const ordersCount = Array.isArray(d.marketplace_orders) ? d.marketplace_orders.length : 0;
  const listingsCount = Array.isArray(d.marketplace_listings) ? d.marketplace_listings.length : 0;
  const accessReqCount = Array.isArray(d.access_requests) ? d.access_requests.length : 0;
  const templatesCount = Array.isArray(d.workspace?.checkpoint_templates)
    ? d.workspace.checkpoint_templates.length
    : 0;
  return (
    hasCustomUser ||
    usersCount > 2 ||
    tasksCount > 0 ||
    msgsCount > 0 ||
    postsCount > 1 ||
    notesCount > 0 ||
    ordersCount > 0 ||
    listingsCount > 4 ||
    accessReqCount > 0 ||
    templatesCount > 0
  );
}

export function mergeTwoSnapshotsNonDestructive(primarySnap: any, secondarySnap: any): any {
  if (!primarySnap) return secondarySnap;
  if (!secondarySnap) return primarySnap;
  const clone = JSON.parse(JSON.stringify(primarySnap));
  const pRoot = clone.data && typeof clone.data === 'object' ? clone.data : clone;
  const sRoot =
    secondarySnap.data && typeof secondarySnap.data === 'object'
      ? secondarySnap.data
      : secondarySnap;

  const pDelTaskIds = Array.isArray(pRoot.deleted_task_ids) ? pRoot.deleted_task_ids : [];
  const sDelTaskIds = Array.isArray(sRoot.deleted_task_ids) ? sRoot.deleted_task_ids : [];
  pRoot.deleted_task_ids = Array.from(
    new Set([...pDelTaskIds, ...sDelTaskIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );

  const pDelNoteIds = Array.isArray(pRoot.deleted_note_ids) ? pRoot.deleted_note_ids : [];
  const sDelNoteIds = Array.isArray(sRoot.deleted_note_ids) ? sRoot.deleted_note_ids : [];
  pRoot.deleted_note_ids = Array.from(
    new Set([...pDelNoteIds, ...sDelNoteIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );

  const pDelMeetingIds = Array.isArray(pRoot.deleted_meeting_ids) ? pRoot.deleted_meeting_ids : [];
  const sDelMeetingIds = Array.isArray(sRoot.deleted_meeting_ids) ? sRoot.deleted_meeting_ids : [];
  pRoot.deleted_meeting_ids = Array.from(
    new Set([...pDelMeetingIds, ...sDelMeetingIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );

  const pDelGcalIds = Array.isArray(pRoot.deleted_gcal_ids) ? pRoot.deleted_gcal_ids : [];
  const sDelGcalIds = Array.isArray(sRoot.deleted_gcal_ids) ? sRoot.deleted_gcal_ids : [];
  pRoot.deleted_gcal_ids = Array.from(
    new Set([...pDelGcalIds, ...sDelGcalIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );

  const pDelEntityIds = Array.isArray(pRoot.deleted_entity_ids) ? pRoot.deleted_entity_ids : [];
  const sDelEntityIds = Array.isArray(sRoot.deleted_entity_ids) ? sRoot.deleted_entity_ids : [];
  pRoot.deleted_entity_ids = Array.from(
    new Set(
      [
        ...pDelEntityIds,
        ...sDelEntityIds,
        ...pRoot.deleted_task_ids,
        ...pRoot.deleted_note_ids,
        ...pRoot.deleted_meeting_ids,
      ]
        .map((id: any) => String(id || '').trim())
        .filter(Boolean)
    )
  );

  const deletedEntityIdSet = new Set<string>(pRoot.deleted_entity_ids);
  const deletedGcalIdSet = new Set<string>(pRoot.deleted_gcal_ids);

  const notDeleted = (altKey?: string) => (item: any) => {
    const id = getItemId(item, altKey);
    if (!id) return false;
    return !deletedEntityIdSet.has(id);
  };

  pRoot.users = mergeItemsById(pRoot.users || [], sRoot.users || [], 'user_id');
  pRoot.messages = mergeItemsById(pRoot.messages || [], sRoot.messages || []).filter(notDeleted());

  const msgApprovalsByTaskId = new Map<string, string[]>();
  for (const m of pRoot.messages || []) {
    if (m && m.type === 'approval_card' && m.task_id) {
      const cardApproved = [
        ...(Array.isArray(m.approvals?.approved_by) ? m.approvals.approved_by : []),
        ...(Array.isArray(m.task?.approvals?.approved_by) ? m.task.approvals.approved_by : []),
      ]
        .map((uid: any) => String(uid || '').trim())
        .filter(Boolean);
      if (cardApproved.length > 0) {
        const prev = msgApprovalsByTaskId.get(String(m.task_id)) || [];
        msgApprovalsByTaskId.set(String(m.task_id), Array.from(new Set([...prev, ...cardApproved])));
      }
    }
  }

  pRoot.tasks = mergeTasksArrayNonDestructive(pRoot.tasks || [], sRoot.tasks || [])
    .filter(notDeleted('task_id'))
    .map((t: any) => {
      const tid = getItemId(t, 'task_id');
      const cardApproved = tid ? msgApprovalsByTaskId.get(tid) || [] : [];
      return enforceTaskApprovalInvariant(t, cardApproved);
    });

  pRoot.boards = mergeItemsById(pRoot.boards || [], sRoot.boards || [], 'board_id').filter(
    notDeleted('board_id')
  );
  pRoot.conversations = mergeItemsById(pRoot.conversations || [], sRoot.conversations || []).filter(
    notDeleted()
  );
  pRoot.groups = mergeItemsById(pRoot.groups || [], sRoot.groups || []).filter(notDeleted());
  pRoot.posts = mergeItemsById(pRoot.posts || [], sRoot.posts || [], 'post_id').filter(
    notDeleted('post_id')
  );
  pRoot.circle_notes = mergeItemsById(
    pRoot.circle_notes || [],
    sRoot.circle_notes || [],
    'note_id'
  ).filter(notDeleted('note_id'));
  pRoot.meetings = mergeItemsById(pRoot.meetings || [], sRoot.meetings || []).filter((m: any) => {
    const id = getItemId(m);
    if (!id || deletedEntityIdSet.has(id)) return false;
    const gcalId = String(m?.gcal_event_id || '').trim();
    if (gcalId && (deletedGcalIdSet.has(gcalId) || deletedEntityIdSet.has(`gcal_${gcalId}`))) {
      return false;
    }
    return true;
  });
  pRoot.projects = mergeItemsById(pRoot.projects || [], sRoot.projects || []).filter(notDeleted());
  pRoot.org_units = mergeItemsById(pRoot.org_units || [], sRoot.org_units || []).filter(
    notDeleted()
  );
  pRoot.drive_shortcuts = mergeItemsById(
    pRoot.drive_shortcuts || [],
    sRoot.drive_shortcuts || []
  ).filter(notDeleted());
  pRoot.labels = mergeItemsById(pRoot.labels || [], sRoot.labels || []).filter(notDeleted());
  pRoot.notifications = mergeItemsById(pRoot.notifications || [], sRoot.notifications || []);
  pRoot.activity = mergeItemsById(pRoot.activity || [], sRoot.activity || []);
  pRoot.reminders = mergeItemsById(pRoot.reminders || [], sRoot.reminders || []).filter(
    notDeleted()
  );
  pRoot.polls = mergeItemsById(pRoot.polls || [], sRoot.polls || []).filter(notDeleted());
  pRoot.task_automations = mergeItemsById(
    pRoot.task_automations || [],
    sRoot.task_automations || []
  ).filter(notDeleted());
  pRoot.invitations = mergeItemsById(pRoot.invitations || [], sRoot.invitations || []).filter(
    notDeleted()
  );
  pRoot.access_requests = mergeItemsById(
    pRoot.access_requests || [],
    sRoot.access_requests || []
  ).filter(notDeleted());
  pRoot.sticker_packs = mergeItemsById(
    pRoot.sticker_packs || [],
    sRoot.sticker_packs || []
  ).filter(notDeleted());
  pRoot.stickers = mergeItemsById(pRoot.stickers || [], sRoot.stickers || []).filter(notDeleted());

  const pDelTplIds = [
    ...(Array.isArray(pRoot.deleted_checkpoint_template_ids) ? pRoot.deleted_checkpoint_template_ids : []),
    ...(Array.isArray(pRoot.workspace?.deleted_checkpoint_template_ids)
      ? pRoot.workspace.deleted_checkpoint_template_ids
      : []),
  ];
  const sDelTplIds = [
    ...(Array.isArray(sRoot.deleted_checkpoint_template_ids) ? sRoot.deleted_checkpoint_template_ids : []),
    ...(Array.isArray(sRoot.workspace?.deleted_checkpoint_template_ids)
      ? sRoot.workspace.deleted_checkpoint_template_ids
      : []),
  ];
  const mergedDelTplIds = Array.from(
    new Set([...pDelTplIds, ...sDelTplIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );
  pRoot.deleted_checkpoint_template_ids = mergedDelTplIds;
  const deletedTplIdSet = new Set<string>(mergedDelTplIds);

  if (
    sRoot.workspace?.checkpoint_templates ||
    pRoot.workspace?.checkpoint_templates ||
    mergedDelTplIds.length > 0
  ) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    pRoot.workspace.deleted_checkpoint_template_ids = mergedDelTplIds;
    pRoot.workspace.checkpoint_templates = mergeItemsById(
      pRoot.workspace.checkpoint_templates || [],
      sRoot.workspace?.checkpoint_templates || []
    ).filter((tpl: any) => !deletedTplIdSet.has(getItemId(tpl)));
    if (sRoot.workspace?.checkpoint_templates_initialized || pRoot.workspace?.checkpoint_templates_initialized) {
      pRoot.workspace.checkpoint_templates_initialized = true;
    }
  }

  const pDelIgIds = [
    ...(Array.isArray(pRoot.workspace?.deleted_instagram_account_ids)
      ? pRoot.workspace.deleted_instagram_account_ids
      : []),
  ];
  const sDelIgIds = [
    ...(Array.isArray(sRoot.workspace?.deleted_instagram_account_ids)
      ? sRoot.workspace.deleted_instagram_account_ids
      : []),
  ];
  const mergedDelIgIds = Array.from(
    new Set([...pDelIgIds, ...sDelIgIds].map((id: any) => String(id || '').trim()).filter(Boolean))
  );
  const deletedIgIdSet = new Set<string>([...mergedDelIgIds, ...pRoot.deleted_entity_ids]);
  if (
    sRoot.workspace?.instagram_accounts ||
    pRoot.workspace?.instagram_accounts ||
    mergedDelIgIds.length > 0
  ) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    pRoot.workspace.deleted_instagram_account_ids = mergedDelIgIds;
    pRoot.workspace.instagram_accounts = mergeItemsById(
      pRoot.workspace.instagram_accounts || [],
      sRoot.workspace?.instagram_accounts || []
    ).filter((ig: any) => !deletedIgIdSet.has(getItemId(ig)));
  }
  if (Array.isArray(sRoot.workspace?.divisions) && sRoot.workspace.divisions.length > 0) {
    pRoot.workspace = pRoot.workspace && typeof pRoot.workspace === 'object' ? pRoot.workspace : {};
    const existingDivs = Array.isArray(pRoot.workspace.divisions) ? pRoot.workspace.divisions : [];
    pRoot.workspace.divisions = Array.from(new Set([...existingDivs, ...sRoot.workspace.divisions]));
  }

  if (secondarySnap.uploaded_files_base64 && typeof secondarySnap.uploaded_files_base64 === 'object') {
    clone.uploaded_files_base64 = {
      ...secondarySnap.uploaded_files_base64,
      ...(clone.uploaded_files_base64 || {}),
    };
  }

  const pRev = Number(clone.revision ?? pRoot.revision ?? 0);
  const sRev = Number(secondarySnap.revision ?? sRoot.revision ?? 0);
  clone.revision = Math.max(pRev, sRev);
  clone.summary = computePayloadSummary(clone);
  return clone;
}
