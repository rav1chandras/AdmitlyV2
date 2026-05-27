/**
 * lib/major-cip-map.ts
 * ────────────────────────────────────────────────────────────
 * Maps student major selections to the Program_Normalized
 * column in programs_master for filtering and matching.
 *
 * No more hardcoded CIP codes — the dropdown values match
 * the normalized program names in the data directly.
 * ────────────────────────────────────────────────────────────
 */

/**
 * All available majors derived from Program_Normalized column
 * in programs_master.csv. Used by the Settings page dropdown
 * for Primary Major and Alternate Major selection.
 *
 * 'Undecided' is a special value — it skips program filtering
 * so the student sees all colleges regardless of program.
 */
export const POPULAR_MAJORS: string[] = [
  'Undecided',
  'Accounting',
  'Art',
  'Biology',
  'Business Administration',
  'Chemistry',
  'Civil Engineering',
  'Computer Science',
  'Criminal Justice',
  'Design',
  'Drama/Theatre Arts',
  'Economics',
  'Electrical Engineering',
  'English',
  'Finance',
  'Health Sciences',
  'Health and Fitness',
  'History',
  'Interdisciplinary Studies',
  'Liberal Arts',
  'Marketing',
  'Mathematics',
  'Mechanical Engineering',
  'Music',
  'Nursing',
  'Political Science',
  'Psychology',
  'Public Health',
  'Research and Experimental Psychology',
  'Social Work',
  'Sociology',
  'Teacher Education',
];

/**
 * Given a major label, return it as a program_normalized filter value.
 * Returns empty array for Undecided or empty — meaning "show all colleges."
 */
export function getProgramNamesForMajor(major: string): string[] {
  if (!major || major.trim() === '' || major.trim() === 'Undecided') return [];
  return [major.trim()];
}

/**
 * Given primary + alternate major, return deduplicated program_normalized values.
 * Empty array means "Undecided / show all."
 */
export function getProgramNamesForStudent(primaryMajor: string, altMajor: string): string[] {
  const primary = getProgramNamesForMajor(primaryMajor);
  const alt = getProgramNamesForMajor(altMajor);
  return Array.from(new Set([...primary, ...alt]));
}

// ── Backwards compatibility shims ────────────────────────────
// These map to the same functions but keep the old import names
// so other files don't need renaming until you choose to.
export const getCIPCodesForMajor = getProgramNamesForMajor;
export const getCIPCodesForStudent = getProgramNamesForStudent;
