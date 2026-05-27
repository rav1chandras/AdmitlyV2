/**
 * Deadline templates for top 100 US colleges.
 * Dates are for the 2026-2027 application cycle.
 * Format: { school, type, date (YYYY-MM-DD), description }
 * Types: ED (Early Decision), ED2, EA (Early Action), REA (Restrictive EA), RD (Regular Decision), Rolling, CSS, Scholarship
 */

export interface DeadlineTemplate {
  school: string;
  type: string;
  date: string;
  description: string;
}

export const DEADLINE_TEMPLATES: DeadlineTemplate[] = [
  // ── Ivy League ──
  { school:'Harvard University', type:'REA', date:'2026-11-01', description:'Restrictive Early Action application' },
  { school:'Harvard University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'Harvard University', type:'CSS', date:'2026-11-01', description:'CSS Profile for financial aid (EA)' },
  { school:'Yale University', type:'REA', date:'2026-11-01', description:'Restrictive Early Action application' },
  { school:'Yale University', type:'RD', date:'2027-01-02', description:'Regular Decision application' },
  { school:'Yale University', type:'CSS', date:'2027-03-01', description:'CSS Profile for financial aid (RD)' },
  { school:'Princeton University', type:'REA', date:'2026-11-01', description:'Restrictive Early Action application' },
  { school:'Princeton University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'Columbia University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Columbia University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'University of Pennsylvania', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'University of Pennsylvania', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Brown University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Brown University', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Dartmouth College', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Dartmouth College', type:'RD', date:'2027-01-02', description:'Regular Decision application' },
  { school:'Cornell University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Cornell University', type:'RD', date:'2027-01-02', description:'Regular Decision application' },

  // ── Top Private ──
  { school:'Stanford University', type:'REA', date:'2026-11-01', description:'Restrictive Early Action application' },
  { school:'Stanford University', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Stanford University', type:'CSS', date:'2026-11-01', description:'CSS Profile for financial aid' },
  { school:'MIT', type:'EA', date:'2026-11-01', description:'Early Action application + 5 short essays' },
  { school:'MIT', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Caltech', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Caltech', type:'RD', date:'2027-01-03', description:'Regular Decision application' },
  { school:'Duke University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Duke University', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'Northwestern University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Northwestern University', type:'RD', date:'2027-01-03', description:'Regular Decision application' },
  { school:'Johns Hopkins University', type:'ED', date:'2026-11-01', description:'Early Decision I application (binding)' },
  { school:'Johns Hopkins University', type:'ED2', date:'2027-01-02', description:'Early Decision II (binding)' },
  { school:'Johns Hopkins University', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Rice University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Rice University', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'Vanderbilt University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Vanderbilt University', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Vanderbilt University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'Washington University in St. Louis', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Washington University in St. Louis', type:'ED2', date:'2027-01-02', description:'Early Decision II (binding)' },
  { school:'Washington University in St. Louis', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Emory University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Emory University', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Emory University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'Georgetown University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Georgetown University', type:'RD', date:'2027-01-10', description:'Regular Decision application' },
  { school:'Carnegie Mellon University', type:'ED', date:'2026-11-01', description:'Early Decision application (binding)' },
  { school:'Carnegie Mellon University', type:'RD', date:'2027-01-03', description:'Regular Decision application' },
  { school:'University of Notre Dame', type:'REA', date:'2026-11-01', description:'Restrictive Early Action' },
  { school:'University of Notre Dame', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'University of Virginia', type:'ED', date:'2026-11-01', description:'Early Decision (binding, in-state priority)' },
  { school:'University of Virginia', type:'EA', date:'2026-11-01', description:'Early Action (non-binding)' },
  { school:'University of Virginia', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'USC', type:'EA', date:'2026-11-01', description:'Early Action (non-binding, scholarship consideration)' },
  { school:'USC', type:'RD', date:'2027-01-15', description:'Regular Decision application' },

  // ── Top Liberal Arts ──
  { school:'Williams College', type:'ED', date:'2026-11-15', description:'Early Decision I (binding)' },
  { school:'Williams College', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Williams College', type:'RD', date:'2027-01-08', description:'Regular Decision application' },
  { school:'Amherst College', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Amherst College', type:'ED2', date:'2027-01-03', description:'Early Decision II (binding)' },
  { school:'Amherst College', type:'RD', date:'2027-01-03', description:'Regular Decision application' },
  { school:'Swarthmore College', type:'ED', date:'2026-11-15', description:'Early Decision I (binding)' },
  { school:'Swarthmore College', type:'ED2', date:'2027-01-04', description:'Early Decision II (binding)' },
  { school:'Swarthmore College', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'Pomona College', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Pomona College', type:'ED2', date:'2027-01-08', description:'Early Decision II (binding)' },
  { school:'Pomona College', type:'RD', date:'2027-01-08', description:'Regular Decision application' },
  { school:'Wellesley College', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Wellesley College', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Wellesley College', type:'RD', date:'2027-01-08', description:'Regular Decision application' },
  { school:'Bowdoin College', type:'ED', date:'2026-11-15', description:'Early Decision I (binding)' },
  { school:'Bowdoin College', type:'ED2', date:'2027-01-05', description:'Early Decision II (binding)' },
  { school:'Bowdoin College', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Middlebury College', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Middlebury College', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Middlebury College', type:'RD', date:'2027-01-01', description:'Regular Decision application' },

  // ── UC System (single app, Nov 30) ──
  { school:'UC Berkeley', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs (350 words each)' },
  { school:'UCLA', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs (350 words each)' },
  { school:'UC San Diego', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs' },
  { school:'UC Davis', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs' },
  { school:'UC Irvine', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs' },
  { school:'UC Santa Barbara', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs' },
  { school:'UC Santa Cruz', type:'RD', date:'2026-11-30', description:'UC application + 4 PIQs' },

  // ── Top Public (non-UC) ──
  { school:'University of Michigan', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'University of Michigan', type:'RD', date:'2027-02-01', description:'Regular Decision application' },
  { school:'Georgia Tech', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Georgia Tech', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'University of North Carolina', type:'EA', date:'2026-10-15', description:'Early Action application' },
  { school:'University of North Carolina', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'University of Texas at Austin', type:'RD', date:'2026-12-01', description:'Application deadline (priority)' },
  { school:'University of Florida', type:'RD', date:'2026-11-01', description:'Application deadline' },
  { school:'University of Illinois Urbana-Champaign', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'University of Illinois Urbana-Champaign', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'University of Wisconsin-Madison', type:'EA', date:'2026-11-01', description:'Early Action (priority)' },
  { school:'University of Wisconsin-Madison', type:'RD', date:'2027-02-01', description:'Regular Decision application' },
  { school:'Purdue University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Purdue University', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'University of Washington', type:'RD', date:'2026-11-15', description:'Application deadline' },
  { school:'Ohio State University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Ohio State University', type:'RD', date:'2027-02-01', description:'Regular Decision application' },
  { school:'Penn State', type:'Rolling', date:'2026-11-30', description:'Priority deadline (rolling admissions)' },

  // ── More Top Private ──
  { school:'NYU', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'NYU', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'NYU', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Tufts University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Tufts University', type:'ED2', date:'2027-01-04', description:'Early Decision II (binding)' },
  { school:'Tufts University', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'Boston College', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Boston College', type:'RD', date:'2027-01-02', description:'Regular Decision application' },
  { school:'Boston University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Boston University', type:'ED2', date:'2027-01-04', description:'Early Decision II (binding)' },
  { school:'Boston University', type:'RD', date:'2027-01-04', description:'Regular Decision application' },
  { school:'Northeastern University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Northeastern University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Northeastern University', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Wake Forest University', type:'ED', date:'2026-11-15', description:'Early Decision I (binding)' },
  { school:'Wake Forest University', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Wake Forest University', type:'RD', date:'2027-01-01', description:'Regular Decision application' },
  { school:'University of Rochester', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'University of Rochester', type:'ED2', date:'2027-01-05', description:'Early Decision II (binding)' },
  { school:'University of Rochester', type:'RD', date:'2027-01-05', description:'Regular Decision application' },
  { school:'Case Western Reserve University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Case Western Reserve University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Case Western Reserve University', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'Tulane University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Tulane University', type:'EA', date:'2026-11-15', description:'Early Action application' },
  { school:'Tulane University', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'Lehigh University', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'Lehigh University', type:'ED2', date:'2027-01-01', description:'Early Decision II (binding)' },
  { school:'Lehigh University', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'Villanova University', type:'ED', date:'2026-11-01', description:'Early Decision (binding)' },
  { school:'Villanova University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Villanova University', type:'RD', date:'2027-01-15', description:'Regular Decision application' },
  { school:'Santa Clara University', type:'EA', date:'2026-11-01', description:'Early Action application' },
  { school:'Santa Clara University', type:'RD', date:'2027-01-07', description:'Regular Decision application' },
  { school:'University of Richmond', type:'ED', date:'2026-11-01', description:'Early Decision I (binding)' },
  { school:'University of Richmond', type:'ED2', date:'2027-01-15', description:'Early Decision II (binding)' },
  { school:'University of Richmond', type:'RD', date:'2027-01-15', description:'Regular Decision application' },

  // ── Universal Deadlines (apply to all students) ──
  { school:'ALL', type:'FAFSA', date:'2026-10-01', description:'FAFSA opens for 2027-28 academic year' },
  { school:'ALL', type:'FAFSA', date:'2027-06-30', description:'Federal FAFSA deadline for 2027-28' },
  { school:'ALL', type:'CSS', date:'2026-10-01', description:'CSS Profile opens for 2027-28' },
];

/** Get unique school names from templates */
export function getTemplateSchools(): string[] {
  return Array.from(new Set(DEADLINE_TEMPLATES.filter(d => d.school !== 'ALL').map(d => d.school))).sort();
}

/** Get templates for a specific school */
export function getTemplatesForSchool(school: string): DeadlineTemplate[] {
  const universal = DEADLINE_TEMPLATES.filter(d => d.school === 'ALL');
  const specific = DEADLINE_TEMPLATES.filter(d => d.school.toLowerCase() === school.toLowerCase());
  return [...specific, ...universal];
}

/**
 * Alias map: IPEDS / colleges_master name → template school name.
 * Covers abbreviations, IPEDS variations, and common alternate names.
 * Keys are lowercase. Values must exactly match a school in DEADLINE_TEMPLATES.
 */
const SCHOOL_ALIASES: Record<string, string> = {
  // Abbreviations
  'massachusetts institute of technology': 'MIT',
  'new york university':                   'NYU',
  'university of southern california':     'USC',
  // IPEDS-style UC names (hyphenated)
  'university of california-berkeley':     'UC Berkeley',
  'university of california-los angeles':  'UCLA',
  'university of california-san diego':    'UC San Diego',
  'university of california-davis':        'UC Davis',
  'university of california-irvine':       'UC Irvine',
  'university of california-santa barbara':'UC Santa Barbara',
  'university of california-santa cruz':   'UC Santa Cruz',
  // Common alternate names
  'georgia institute of technology':       'Georgia Tech',
  'georgia institute of technology-main campus': 'Georgia Tech',
  'pennsylvania state university':         'Penn State',
  'pennsylvania state university-main campus': 'Penn State',
  'the pennsylvania state university':     'Penn State',
  'penn state university':                 'Penn State',
  'university of north carolina at chapel hill': 'University of North Carolina',
  'university of north carolina-chapel hill':    'University of North Carolina',
  'university of illinois at urbana-champaign':  'University of Illinois Urbana-Champaign',
  'university of illinois urbana champaign':     'University of Illinois Urbana-Champaign',
  'university of michigan-ann arbor':      'University of Michigan',
  'university of michigan ann arbor':      'University of Michigan',
  'ohio state university-main campus':     'Ohio State University',
  'the ohio state university':             'Ohio State University',
  'university of texas at austin':         'University of Texas at Austin',
  'purdue university-main campus':         'Purdue University',
  'university of wisconsin-madison':       'University of Wisconsin-Madison',
  'university of washington-seattle campus':'University of Washington',
  'university of florida':                 'University of Florida',
  'cornell university':                    'Cornell University',
  'washington university in st louis':     'Washington University in St. Louis',
  'johns hopkins university':              'Johns Hopkins University',
  'carnegie mellon university':            'Carnegie Mellon University',
  'case western reserve university':       'Case Western Reserve University',
  'boston college':                         'Boston College',
  'boston university':                      'Boston University',
  'northeastern university':               'Northeastern University',
  'wake forest university':                'Wake Forest University',
  'university of rochester':               'University of Rochester',
  'tulane university of louisiana':        'Tulane University',
  'santa clara university':                'Santa Clara University',
  'villanova university':                  'Villanova University',
  'lehigh university':                     'Lehigh University',
  'university of richmond':                'University of Richmond',
  'tufts university':                      'Tufts University',
  'university of notre dame':              'University of Notre Dame',
  'rice university':                       'Rice University',
  'duke university':                       'Duke University',
  'emory university':                      'Emory University',
  'georgetown university':                 'Georgetown University',
  'northwestern university':               'Northwestern University',
  'vanderbilt university':                 'Vanderbilt University',
  'stanford university':                   'Stanford University',
  'columbia university in the city of new york': 'Columbia University',
  'columbia university':                   'Columbia University',
  'university of pennsylvania':            'University of Pennsylvania',
  'university of virginia-main campus':    'University of Virginia',
  'university of virginia':                'University of Virginia',
  'harvard university':                    'Harvard University',
  'yale university':                       'Yale University',
  'princeton university':                  'Princeton University',
  'brown university':                      'Brown University',
  'dartmouth college':                     'Dartmouth College',
  'california institute of technology':    'Caltech',
  'williams college':                      'Williams College',
  'amherst college':                       'Amherst College',
  'swarthmore college':                    'Swarthmore College',
  'pomona college':                        'Pomona College',
  'wellesley college':                     'Wellesley College',
  'bowdoin college':                       'Bowdoin College',
  'middlebury college':                    'Middlebury College',
};

/**
 * Match a college name against deadline templates.
 *
 * Uses exact match first, then falls back to alias map for IPEDS names
 * and common abbreviations. No substring matching — avoids false positives
 * like "University of South Carolina" matching "USC" templates.
 */
export function matchSchoolName(name: string): DeadlineTemplate[] {
  const lower = name.toLowerCase().trim();

  // 1. Check alias map → canonical template name
  const canonical = SCHOOL_ALIASES[lower];

  // 2. Find the template school name to match against
  //    Priority: alias → exact match against template school names
  const templateSchoolList = Array.from(new Set(DEADLINE_TEMPLATES.filter(d => d.school !== 'ALL').map(d => d.school)));
  let matchName: string | null = null;

  if (canonical && templateSchoolList.includes(canonical)) {
    matchName = canonical;
  } else {
    // Direct exact match (case-insensitive) against template school names
    const found = templateSchoolList.find(ts => ts.toLowerCase() === lower);
    if (found) matchName = found;
  }

  if (!matchName) return [];

  return DEADLINE_TEMPLATES.filter(d => d.school === matchName);
}
