import { describe, expect, it } from 'vitest';
import { parsePositiveAssignmentId, resolveStudentAssignment } from '../lib/expert-portal-auth';

describe('parsePositiveAssignmentId', () => {
  it('returns null for missing, non-numeric, zero, and negative values', () => {
    expect(parsePositiveAssignmentId(null)).toBeNull();
    expect(parsePositiveAssignmentId('abc')).toBeNull();
    expect(parsePositiveAssignmentId('0')).toBeNull();
    expect(parsePositiveAssignmentId('-7')).toBeNull();
  });
});

describe('resolveStudentAssignment', () => {
  const rows = [
    { assignment_id: 101, plan: 'Full Cycle' },
    { assignment_id: '202', plan: 'Essay Only' },
  ];

  it('returns the first assignment when no assignment_id is provided', () => {
    const result = resolveStudentAssignment(rows, null);

    expect(result).toEqual({ ok: true, assignment: rows[0], assignmentId: 101 });
  });

  it('returns the requested assignment when assignment_id belongs to the student', () => {
    const result = resolveStudentAssignment(rows, '202');

    expect(result).toEqual({ ok: true, assignment: rows[1], assignmentId: 202 });
  });

  it('returns 403 when a numeric assignment_id is not in the student assignment list', () => {
    const result = resolveStudentAssignment(rows, '303');

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('returns 400 when assignment_id is non-numeric', () => {
    const result = resolveStudentAssignment(rows, 'not-a-number');

    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid assignment_id' });
  });

  it('returns 400 when assignment_id is zero or negative', () => {
    expect(resolveStudentAssignment(rows, '0')).toEqual({ ok: false, status: 400, error: 'Invalid assignment_id' });
    expect(resolveStudentAssignment(rows, '-1')).toEqual({ ok: false, status: 400, error: 'Invalid assignment_id' });
  });

  it('matches existing assignment ids whether pg returns strings or numbers', () => {
    expect(resolveStudentAssignment([{ assignment_id: '42' }], '42')).toEqual({
      ok: true,
      assignment: { assignment_id: '42' },
      assignmentId: 42,
    });
    expect(resolveStudentAssignment([{ assignment_id: 42 }], '42')).toEqual({
      ok: true,
      assignment: { assignment_id: 42 },
      assignmentId: 42,
    });
  });
});
