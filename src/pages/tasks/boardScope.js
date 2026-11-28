export function getHumanUsers(users = []) {
  return (users || []).filter(
    (u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
}

export function isBoardCollaborative(board) {
  if (!board) return false;
  const deptLower = String(board.department || "").trim().toLowerCase();
  return Boolean(
    board.is_collaborative ||
    board.board_type === "collaborative" ||
    board.board_type === "project" ||
    board.project_id ||
    !deptLower ||
    deptLower === "semua divisi" ||
    deptLower === "all" ||
    deptLower === "kolaborasi"
  );
}

export function getBoardAssigneeScope({
  board = null,
  boards = [],
  boardId = "",
  projectId = "",
  department = "",
  users = []
} = {}) {
  const humanUsers = getHumanUsers(users);
  const humanSet = new Set(humanUsers.map((u) => u.user_id));

  const activeBoard =
    board ||
    (boards || []).find((b) => b && b.id === boardId) ||
    (projectId ? (boards || []).find((b) => b && b.project_id === projectId) : null) ||
    null;

  const rawDept = activeBoard ? (activeBoard.department || "") : (department || "");
  const cleanDept = String(rawDept).trim();
  const deptLower = cleanDept.toLowerCase();
  const hasSpecificDept =
    Boolean(deptLower) &&
    !["semua divisi", "all", "kolaborasi"].includes(deptLower);
  const boardCollab = isBoardCollaborative(activeBoard);

  if (activeBoard) {
    // 1. Prefer authoritative server-computed allowed_member_ids (linked group members + board invited members)
    if (Array.isArray(activeBoard.allowed_member_ids)) {
      const allowedSet = new Set(activeBoard.allowed_member_ids.filter((id) => humanSet.has(id)));
      const ids = humanUsers.filter((u) => allowedSet.has(u.user_id)).map((u) => u.user_id);
      const groupName = activeBoard.linked_group_name || (hasSpecificDept ? cleanDept : activeBoard.name);
      return {
        ids,
        isCollaborative: boardCollab,
        activeBoard,
        divisionName: hasSpecificDept ? cleanDept : (activeBoard.name || "Kolaborasi"),
        scopeLabel: boardCollab
          ? `Khusus anggota grup ${groupName || "board"} & yang di-invite ke board ini`
          : `Khusus anggota grup/divisi ${cleanDept} & yang di-invite ke board ini`,
        emptyMessage: "Belum ada anggota grup atau orang yang di-invite ke board ini."
      };
    }

    // 2. Fallback when board comes from local cache before fresh server enrichment:
    //    Strictly restrict to linked group members + explicitly invited board members (and division members if division board).
    const hasLegacyInflatedMembers =
      boardCollab &&
      activeBoard.all_workspace_members === true &&
      Array.isArray(activeBoard.invited_member_ids) &&
      activeBoard.invited_member_ids.length > 0;

    const explicitSet = new Set([
      ...(Array.isArray(activeBoard.linked_group_member_ids) ? activeBoard.linked_group_member_ids : []),
      ...(Array.isArray(activeBoard.invited_member_ids) ? activeBoard.invited_member_ids : []),
      ...(Array.isArray(activeBoard.chat_invited_member_ids) ? activeBoard.chat_invited_member_ids : []),
      ...(!hasLegacyInflatedMembers && Array.isArray(activeBoard.member_ids) ? activeBoard.member_ids : []),
      ...(boardCollab && activeBoard.created_by ? [activeBoard.created_by] : []),
    ]);

    const ids = humanUsers
      .filter((u) => {
        if (explicitSet.has(u.user_id)) return true;
        if (!boardCollab && hasSpecificDept && String(u.department || "").trim().toLowerCase() === deptLower) {
          return true;
        }
        return false;
      })
      .map((u) => u.user_id);

    const groupName = activeBoard.linked_group_name || (hasSpecificDept ? cleanDept : activeBoard.name);
    return {
      ids,
      isCollaborative: boardCollab,
      activeBoard,
      divisionName: hasSpecificDept ? cleanDept : (activeBoard.name || "Kolaborasi"),
      scopeLabel: boardCollab
        ? `Khusus anggota grup ${groupName || "board"} & yang di-invite ke board ini`
        : `Khusus anggota grup/divisi ${cleanDept} & yang di-invite ke board ini`,
      emptyMessage: "Belum ada anggota grup atau orang yang di-invite ke board ini."
    };
  }

  // Fallback when no board object is resolved yet, but specific department is known
  if (hasSpecificDept) {
    const deptIds = humanUsers
      .filter((u) => String(u.department || "").trim().toLowerCase() === deptLower)
      .map((u) => u.user_id);
    return {
      ids: deptIds,
      isCollaborative: false,
      activeBoard: null,
      divisionName: cleanDept,
      scopeLabel: `Khusus anggota grup/divisi ${cleanDept} & yang di-invite ke board ini`,
      emptyMessage: `Belum ada anggota di grup/divisi ${cleanDept}.`
    };
  }

  return {
    ids: [],
    isCollaborative: false,
    activeBoard: null,
    divisionName: "",
    scopeLabel: "Pilih board terlebih dahulu untuk menampilkan anggota grup & yang di-invite",
    emptyMessage: "Pilih board terlebih dahulu atau invite anggota ke board ini."
  };
}
