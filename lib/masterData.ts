/**
 * masterData.ts
 * 
 * Single source of truth for all college master data.
 * Parsed from MasterData_Colleges.txt and MasterData_Colleges_Addr.txt
 * Last updated: 2026-02-20
 */

export interface MasterCollege {
  college_id: number;
  name: string;
  avg_gpa: number;
  sat_range: string;
  act_range: string;
  acceptance_rate: number;       // numeric, e.g. 4 = 4%
  grad_rate: number;             // numeric, e.g. 96 = 96%
  tuition_in_state: number;
  tuition_out_state: number;
  room_board: number;
  ratio: string;                 // e.g. "5:1"
  median_salary: number;
  // Address fields
  college_url: string;
  map_url: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export const MASTER_COLLEGES: MasterCollege[] = [
  { college_id: 1, name: "Princeton University", avg_gpa: 3.94, sat_range: "1500-1580", act_range: "33-35", acceptance_rate: 4, grad_rate: 96, tuition_in_state: 65210, tuition_out_state: 65210, room_board: 18650, ratio: "5:1", median_salary: 139400, college_url: "https://www.princeton.edu", map_url: "https://goo.gl/maps/1", address: "1 Nassau Hall", city: "Princeton", state: "NJ", zip: "08544" },
  { college_id: 2, name: "Harvard University", avg_gpa: 4.00, sat_range: "1510-1590", act_range: "33-35", acceptance_rate: 3, grad_rate: 98, tuition_in_state: 64310, tuition_out_state: 64310, room_board: 20300, ratio: "7:1", median_salary: 146800, college_url: "https://www.harvard.edu", map_url: "https://goo.gl/maps/2", address: "Massachusetts Ave", city: "Cambridge", state: "MA", zip: "02138" },
  { college_id: 100, name: "Amherst College", avg_gpa: 3.94, sat_range: "1450-1550", act_range: "32-35", acceptance_rate: 7, grad_rate: 94, tuition_in_state: 58748, tuition_out_state: 58748, room_board: 16000, ratio: "7:1", median_salary: 98600, college_url: "https://www.amherst.edu", map_url: "https://goo.gl/maps/100", address: "Amherst", city: "Amherst", state: "MA", zip: "01002" }
];

// Lookup map for fast access by name
export const MASTER_COLLEGES_BY_NAME: Record<string, MasterCollege> = {};
for (const c of MASTER_COLLEGES) {
  MASTER_COLLEGES_BY_NAME[c.name.toLowerCase()] = c;
}

// Helper: find best match by partial name
export function findMasterCollegeByName(query: string): MasterCollege | undefined {
  const q = query.toLowerCase().trim();
  // Exact match first
  if (MASTER_COLLEGES_BY_NAME[q]) return MASTER_COLLEGES_BY_NAME[q];
  // Partial match
  return MASTER_COLLEGES.find(c => c.name.toLowerCase().includes(q));
}

// Helper: search colleges by partial name (for typeahead)
export function searchMasterColleges(query: string, limit = 10): MasterCollege[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return MASTER_COLLEGES.filter(c => c.name.toLowerCase().includes(q)).slice(0, limit);
}

// Determine bucket based on acceptance rate
export function determineBucket(acceptanceRate: number): 'reach' | 'target' | 'safety' {
  if (acceptanceRate <= 15) return 'reach';
  if (acceptanceRate <= 40) return 'target';
  return 'safety';
}
