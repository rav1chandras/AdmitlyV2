export function parsePositiveAssignmentId(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value.trim())) return null;

  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

export type ResolveStudentAssignmentResult =
  | { ok: true; assignment: any; assignmentId: number }
  | { ok: false; status: 400 | 403; error: string };

export function resolveStudentAssignment(rows: any[], assignmentIdParam: string | null): ResolveStudentAssignmentResult {
  if (assignmentIdParam === null) {
    const assignment = rows[0];
    return { ok: true, assignment, assignmentId: Number(assignment.assignment_id) };
  }

  const requestedId = parsePositiveAssignmentId(assignmentIdParam);
  if (requestedId === null) {
    return { ok: false, status: 400, error: 'Invalid assignment_id' };
  }

  const assignment = rows.find((row) => {
    const rowId = parsePositiveAssignmentId(String(row?.assignment_id ?? ''));
    return rowId === requestedId;
  });

  if (!assignment) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, assignment, assignmentId: requestedId };
}
