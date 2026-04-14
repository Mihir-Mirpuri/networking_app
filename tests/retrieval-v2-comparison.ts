/**
 * Exhaustive comparison test: findPeopleByFilters (V1) vs findPeopleByFiltersV2 (V2)
 *
 * Usage: npx tsx tests/retrieval-v2-comparison.ts
 */

import 'dotenv/config';
import { findPeopleByFilters, findPeopleByFiltersV2 } from '../src/lib/db/person-service';
import type { PersonResult } from '../src/lib/db/person-service';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ──
const LOG_DIR = path.resolve(__dirname, '../logs/retrieval-comparison');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `run-${TIMESTAMP}.jsonl`);

fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Types ──
interface TestCase {
  test_id: string;
  category: string;
  description: string;
  v1_inputs: {
    company: string;
    role?: string;
    location?: string;
    university?: string;
    roleSpecificity?: 'narrow' | 'standard' | 'broad';
    requireEmail?: boolean;
    excludePersonIds?: string[];
    limit: number;
    companyAliases?: string[];
  };
  v2_inputs: {
    company: string;
    role?: string;
    location?: string;
    university?: string;
    roleSpecificity?: 'narrow' | 'standard' | 'broad';
    requireEmail?: boolean;
    excludePersonIds?: string[];
    limit: number;
    companyAliases?: string[];
    companyMatchMode?: 'exact' | 'fuzzy';
    companySimThreshold?: number;
  };
}

interface TestResult {
  test_id: string;
  category: string;
  description: string;
  inputs: Record<string, unknown>;
  old_function: {
    result_count: number;
    top_5: Array<{ id: string; name: string; role: string | null; company: string; distance?: number }>;
    timing_ms: number;
    error: string | null;
  };
  new_function: {
    result_count: number;
    top_5: Array<{ id: string; name: string; role: string | null; company: string; distance?: number }>;
    timing_ms: number;
    error: string | null;
  };
  comparison: {
    overlap_count: number;
    overlap_pct: number;
    only_in_old: number;
    only_in_new: number;
    verdict: 'V2_BETTER' | 'V1_BETTER' | 'TIE' | 'V2_CRASH' | 'V1_CRASH' | 'BOTH_CRASH' | 'BOTH_EMPTY';
  };
}

// ── Helpers ──
function top5(results: PersonResult[]): TestResult['old_function']['top_5'] {
  return results.slice(0, 5).map(r => ({
    id: r.id,
    name: r.fullName,
    role: r.role,
    company: r.company,
    distance: r.roleDistance,
  }));
}

function computeOverlap(old_r: PersonResult[], new_r: PersonResult[]): { overlap: number; only_old: number; only_new: number } {
  const oldIds = new Set(old_r.map(r => r.id));
  const newIds = new Set(new_r.map(r => r.id));
  let overlap = 0;
  for (const id of oldIds) {
    if (newIds.has(id)) overlap++;
  }
  return {
    overlap,
    only_old: oldIds.size - overlap,
    only_new: newIds.size - overlap,
  };
}

function verdict(
  oldResults: PersonResult[] | null,
  newResults: PersonResult[] | null,
  oldError: string | null,
  newError: string | null,
  overlap: { overlap: number; only_old: number; only_new: number }
): TestResult['comparison']['verdict'] {
  if (oldError && newError) return 'BOTH_CRASH';
  if (newError) return 'V2_CRASH';
  if (oldError) return 'V1_CRASH';
  if (!oldResults?.length && !newResults?.length) return 'BOTH_EMPTY';
  // V2 better if it returns more results (with overlap) or same count
  // V1 better if it returns more and V2 lost overlap
  const oldCount = oldResults?.length ?? 0;
  const newCount = newResults?.length ?? 0;
  if (newCount > oldCount && overlap.only_new > 0) return 'V2_BETTER';
  if (oldCount > newCount && overlap.only_old > 0) return 'V1_BETTER';
  if (newCount === oldCount && overlap.overlap === newCount) return 'TIE';
  // More nuanced: same count but different results
  if (newCount >= oldCount) return 'V2_BETTER';
  return 'V1_BETTER';
}

function logResult(result: TestResult) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(result) + '\n');
}

// ── Test runner ──
async function runTest(tc: TestCase): Promise<TestResult> {
  let oldResults: PersonResult[] | null = null;
  let newResults: PersonResult[] | null = null;
  let oldError: string | null = null;
  let newError: string | null = null;
  let oldMs = 0;
  let newMs = 0;

  // Run V1
  const t0 = performance.now();
  try {
    oldResults = await findPeopleByFilters(tc.v1_inputs);
  } catch (e: any) {
    oldError = `${e.message}\n${e.stack}`;
  }
  oldMs = Math.round(performance.now() - t0);

  // Run V2
  const t1 = performance.now();
  try {
    newResults = await findPeopleByFiltersV2(tc.v2_inputs);
  } catch (e: any) {
    newError = `${e.message}\n${e.stack}`;
  }
  newMs = Math.round(performance.now() - t1);

  const ol = computeOverlap(oldResults ?? [], newResults ?? []);
  const totalUnion = ol.overlap + ol.only_old + ol.only_new;

  const result: TestResult = {
    test_id: tc.test_id,
    category: tc.category,
    description: tc.description,
    inputs: tc.v2_inputs,
    old_function: {
      result_count: oldResults?.length ?? 0,
      top_5: top5(oldResults ?? []),
      timing_ms: oldMs,
      error: oldError,
    },
    new_function: {
      result_count: newResults?.length ?? 0,
      top_5: top5(newResults ?? []),
      timing_ms: newMs,
      error: newError,
    },
    comparison: {
      overlap_count: ol.overlap,
      overlap_pct: totalUnion > 0 ? Math.round((ol.overlap / totalUnion) * 100) / 100 : 1,
      only_in_old: ol.only_old,
      only_in_new: ol.only_new,
      verdict: verdict(oldResults, newResults, oldError, newError, ol),
    },
  };

  logResult(result);
  return result;
}

// ── Build test cases ──
function buildTestCases(): TestCase[] {
  const cases: TestCase[] = [];
  let id = 0;
  const nextId = (cat: string) => `${cat}_${String(++id).padStart(3, '0')}`;

  // Helper to create matched V1/V2 inputs
  function tc(
    category: string,
    description: string,
    params: {
      company: string;
      role?: string;
      location?: string;
      university?: string;
      roleSpecificity?: 'narrow' | 'standard' | 'broad';
      requireEmail?: boolean;
      excludePersonIds?: string[];
      limit?: number;
      companyAliases?: string[];
      companyMatchMode?: 'exact' | 'fuzzy';
      companySimThreshold?: number;
    }
  ): TestCase {
    const limit = params.limit ?? 20;
    return {
      test_id: nextId(category),
      category,
      description,
      v1_inputs: {
        company: params.company,
        role: params.role,
        location: params.location,
        university: params.university,
        roleSpecificity: params.roleSpecificity,
        requireEmail: params.requireEmail,
        excludePersonIds: params.excludePersonIds,
        limit,
        companyAliases: params.companyAliases,
      },
      v2_inputs: {
        company: params.company,
        role: params.role,
        location: params.location,
        university: params.university,
        roleSpecificity: params.roleSpecificity,
        requireEmail: params.requireEmail,
        excludePersonIds: params.excludePersonIds,
        limit,
        companyAliases: params.companyAliases,
        companyMatchMode: params.companyMatchMode ?? 'fuzzy',
        companySimThreshold: params.companySimThreshold ?? 0.3,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Role filter variations (80+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT1 = 'role_filter';

  // -- Common titles (10+)
  const commonRoles = [
    'Software Engineer', 'Product Manager', 'Consultant', 'Investment Banking Analyst',
    'Associate', 'Data Scientist', 'Analyst', 'Partner', 'Vice President',
    'Managing Director', 'Recruiter', 'Business Analyst',
  ];
  for (const role of commonRoles) {
    cases.push(tc(CAT1, `Common role: ${role} at Google`, { company: 'Google', role, requireEmail: false }));
  }

  // -- Common roles at top companies (high-density combos)
  const topCompanies = ['McKinsey', 'Goldman Sachs', 'Bain', 'BCG', 'Google'];
  for (const comp of topCompanies) {
    cases.push(tc(CAT1, `SWE at ${comp}`, { company: comp, role: 'Software Engineer', requireEmail: false }));
  }

  // -- Seniority prefix variations (10+)
  const seniorityPrefixes = [
    'Senior Software Engineer', 'Staff Engineer', 'Principal Engineer',
    'Lead Software Engineer', 'Junior Software Engineer', 'Senior Consultant',
    'Senior Associate', 'VP of Engineering', 'Senior Analyst',
    'Senior Product Manager', 'Staff Software Engineer', 'Head of Engineering',
  ];
  for (const role of seniorityPrefixes) {
    cases.push(tc(CAT1, `Seniority prefix: ${role}`, { company: 'Google', role, requireEmail: false }));
  }

  // -- Abbreviations and slang (10+)
  const abbreviations = [
    'SWE', 'PM', 'IB Analyst', 'BD', 'DS', 'MLE', 'DevOps', 'FE', 'BE', 'FS',
    'SDE', 'TPM', 'EM', 'IC',
  ];
  for (const role of abbreviations) {
    cases.push(tc(CAT1, `Abbreviation: ${role}`, { company: 'Google', role, requireEmail: false }));
  }

  // -- Broad/ambiguous terms (10+)
  const broadRoles = [
    'Engineer', 'Manager', 'Director', 'Analyst', 'Consultant', 'Designer',
    'Researcher', 'Specialist', 'Coordinator', 'Lead', 'Officer',
  ];
  for (const role of broadRoles) {
    cases.push(tc(CAT1, `Broad role: ${role}`, { company: 'Goldman Sachs', role, requireEmail: false, roleSpecificity: 'broad' }));
  }

  // -- Niche/specialized titles (10+)
  const nicheRoles = [
    'Quantitative Researcher', 'Site Reliability Engineer', 'Growth PM',
    'ML Infrastructure Engineer', 'Data Engineer', 'UX Designer', 'DevOps Engineer',
    'Solutions Architect', 'Technical Program Manager', 'Security Engineer',
    'Platform Engineer', 'Machine Learning Engineer',
  ];
  for (const role of nicheRoles) {
    cases.push(tc(CAT1, `Niche role: ${role}`, { company: 'Google', role, requireEmail: false }));
  }

  // -- Adjacent-but-different pairs (10+)
  const adjacentPairs = [
    ['Product Manager', 'Project Manager'],
    ['Software Engineer', 'Sales Engineer'],
    ['Data Scientist', 'Data Analyst'],
    ['Designer', 'Design Engineer'],
    ['Business Analyst', 'Business Development'],
    ['Consultant', 'Consulting Analyst'],
    ['Financial Analyst', 'Finance Manager'],
    ['Research Analyst', 'Researcher'],
    ['Marketing Manager', 'Market Analyst'],
    ['Operations Manager', 'Operations Analyst'],
  ];
  for (const [roleA, roleB] of adjacentPairs) {
    cases.push(tc(CAT1, `Adjacent A: ${roleA} at McKinsey`, { company: 'McKinsey', role: roleA, requireEmail: false }));
    cases.push(tc(CAT1, `Adjacent B: ${roleB} at McKinsey`, { company: 'McKinsey', role: roleB, requireEmail: false }));
  }

  // -- Compound/unusual titles (10+)
  const compoundRoles = [
    'Co-Founder & CTO', 'Engineer II', 'Software Engineer - Backend',
    'Head of Engineering', 'VP, Product', 'Associate Director',
    'Senior Vice President', 'Principal Software Engineer',
    'Engineering Manager', 'Chief of Staff', 'Founding Engineer',
  ];
  for (const role of compoundRoles) {
    cases.push(tc(CAT1, `Compound role: ${role}`, { company: 'Google', role, requireEmail: false }));
  }

  // -- roleSpecificity sweep for same query
  for (const spec of ['narrow', 'standard', 'broad'] as const) {
    cases.push(tc(CAT1, `Specificity ${spec}: Software Engineer at Google`, {
      company: 'Google', role: 'Software Engineer', roleSpecificity: spec, requireEmail: false,
    }));
    cases.push(tc(CAT1, `Specificity ${spec}: Consultant at McKinsey`, {
      company: 'McKinsey', role: 'Consultant', roleSpecificity: spec, requireEmail: false,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Company filter variations (30+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT2 = 'company_filter';

  // Top 5 exact names
  for (const comp of topCompanies) {
    cases.push(tc(CAT2, `Exact company: ${comp}`, { company: comp, requireEmail: false }));
  }

  // Abbreviations
  const companyAbbrevs: [string, string[]][] = [
    ['GS', ['Goldman Sachs']],
    ['McK', ['McKinsey']],
    ['BCG', ['BCG']],
    ['JPM', ['JPMorgan']],
    ['MS', ['Morgan Stanley']],
    ['EY', ['EY']],
    ['PwC', ['PwC']],
    ['IBM', ['IBM']],
  ];
  for (const [abbr, aliases] of companyAbbrevs) {
    cases.push(tc(CAT2, `Company abbreviation: ${abbr}`, { company: abbr, companyAliases: aliases, requireEmail: false }));
  }

  // Case variations
  cases.push(tc(CAT2, 'Case: GOOGLE', { company: 'GOOGLE', requireEmail: false }));
  cases.push(tc(CAT2, 'Case: google', { company: 'google', requireEmail: false }));
  cases.push(tc(CAT2, 'Case: Goldman sachs', { company: 'Goldman sachs', requireEmail: false }));
  cases.push(tc(CAT2, 'Case: MCKINSEY', { company: 'MCKINSEY', requireEmail: false }));

  // Special characters
  cases.push(tc(CAT2, 'Special: Goldman Sachs & Co.', { company: 'Goldman Sachs & Co.', requireEmail: false }));
  cases.push(tc(CAT2, 'Special: McKinsey & Company', { company: 'McKinsey & Company', requireEmail: false }));
  cases.push(tc(CAT2, 'Special: Boston Consulting Group', { company: 'Boston Consulting Group', companyAliases: ['BCG', 'Boston Consulting Group'], requireEmail: false }));

  // Misspellings
  cases.push(tc(CAT2, 'Misspell: McKinssey', { company: 'McKinssey', requireEmail: false }));
  cases.push(tc(CAT2, 'Misspell: Goldmann Sachs', { company: 'Goldmann Sachs', requireEmail: false }));
  cases.push(tc(CAT2, 'Misspell: Gogle', { company: 'Gogle', requireEmail: false }));
  cases.push(tc(CAT2, 'Misspell: Deloite', { company: 'Deloite', requireEmail: false }));

  // Partial names
  cases.push(tc(CAT2, 'Partial: Goldman', { company: 'Goldman', requireEmail: false }));
  cases.push(tc(CAT2, 'Partial: McKinsey', { company: 'McKinsey', requireEmail: false }));
  cases.push(tc(CAT2, 'Partial: Bain', { company: 'Bain', companyAliases: ['Bain'], requireEmail: false }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Location filter variations (20+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT3 = 'location_filter';

  const locations = [
    'New York', 'San Francisco', 'Chicago', 'Austin', 'Los Angeles',
    'Boston', 'Seattle', 'Houston', 'Dallas', 'Washington',
  ];
  for (const loc of locations) {
    cases.push(tc(CAT3, `City: ${loc}`, { company: 'Google', location: loc, requireEmail: false }));
  }

  // State-level
  cases.push(tc(CAT3, 'State: California', { company: 'Google', location: 'California', requireEmail: false }));
  cases.push(tc(CAT3, 'State: Texas', { company: 'Google', location: 'Texas', requireEmail: false }));
  cases.push(tc(CAT3, 'State: New York (state)', { company: 'Goldman Sachs', location: 'New York', requireEmail: false }));

  // Abbreviations
  cases.push(tc(CAT3, 'Abbrev: NYC', { company: 'Goldman Sachs', location: 'NYC', requireEmail: false }));
  cases.push(tc(CAT3, 'Abbrev: SF', { company: 'Google', location: 'SF', requireEmail: false }));
  cases.push(tc(CAT3, 'Abbrev: LA', { company: 'Google', location: 'LA', requireEmail: false }));

  // Metro areas
  cases.push(tc(CAT3, 'Metro: Bay Area', { company: 'Google', location: 'Bay Area', requireEmail: false }));
  cases.push(tc(CAT3, 'Metro: Greater New York', { company: 'Goldman Sachs', location: 'Greater New York', requireEmail: false }));

  // Compound location
  cases.push(tc(CAT3, 'Compound: New York, NY', { company: 'Goldman Sachs', location: 'New York, NY', requireEmail: false }));
  cases.push(tc(CAT3, 'Compound: San Francisco, CA', { company: 'Google', location: 'San Francisco, CA', requireEmail: false }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: University filter variations (15+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT4 = 'university_filter';

  const universities = [
    ['UT Austin', 'University of Texas at Austin'],
    ['MIT', 'Massachusetts Institute of Technology'],
    ['Stanford', 'Stanford University'],
    ['Harvard', 'Harvard University'],
    ['NYU', 'New York University'],
    ['CMU', 'Carnegie Mellon University'],
    ['USC', 'University of Southern California'],
    ['UCLA', 'University of California Los Angeles'],
    ['Georgia Tech', 'Georgia Institute of Technology'],
    ['Penn', 'University of Pennsylvania'],
    ['UT Dallas', 'University of Texas at Dallas'],
    ['SMU', 'Southern Methodist University'],
    ['UC Berkeley', 'University of California Berkeley'],
    ['TAMU', 'Texas A&M University'],
    ['Wharton', 'Wharton School'],
    ['Columbia', 'Columbia University'],
  ];
  for (const [abbr, full] of universities) {
    cases.push(tc(CAT4, `University abbrev: ${abbr}`, { company: 'McKinsey', university: abbr, requireEmail: false }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Role + Company combinations (30+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT5 = 'role_company';

  const roleCompanyCombos = [
    ['Software Engineer', 'Google'],
    ['Consultant', 'McKinsey'],
    ['Investment Banking Analyst', 'Goldman Sachs'],
    ['Associate', 'Bain'],
    ['Product Manager', 'Google'],
    ['Data Scientist', 'Google'],
    ['Analyst', 'Goldman Sachs'],
    ['Partner', 'McKinsey'],
    ['Vice President', 'Goldman Sachs'],
    ['Managing Director', 'Goldman Sachs'],
    ['Software Engineer', 'McKinsey'], // Tech role at consulting firm
    ['Consultant', 'Google'],          // Consulting role at tech company
    ['Engineer', 'McKinsey'],          // Broad role at consulting
    ['Analyst', 'Bain'],
    ['Associate', 'BCG'],
    ['Data Scientist', 'McKinsey'],
    ['Product Manager', 'BCG'],
    ['Recruiter', 'Goldman Sachs'],
    ['Business Analyst', 'McKinsey'],
    ['Financial Analyst', 'Goldman Sachs'],
    ['Senior Software Engineer', 'Google'],
    ['Senior Consultant', 'McKinsey'],
    ['VP', 'Goldman Sachs'],
    ['Director', 'Bain'],
    ['Manager', 'BCG'],
    ['Designer', 'Google'],
    ['Researcher', 'Google'],
    ['Operations', 'McKinsey'],
    ['Marketing', 'Google'],
    ['Sales', 'Goldman Sachs'],
    ['Machine Learning Engineer', 'Google'],
    ['Investment Banking', 'Goldman Sachs'],
  ];
  for (const [role, company] of roleCompanyCombos) {
    cases.push(tc(CAT5, `${role} at ${company}`, { company, role, requireEmail: false }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 6: Role + Location combinations (25+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT6 = 'role_location';

  const roleLocationCombos = [
    ['Software Engineer', 'San Francisco', 'Google'],
    ['Consultant', 'New York', 'McKinsey'],
    ['Analyst', 'Chicago', 'Goldman Sachs'],
    ['Product Manager', 'Seattle', 'Google'],
    ['Investment Banking Analyst', 'New York', 'Goldman Sachs'],
    ['Data Scientist', 'Austin', 'Google'],
    ['Associate', 'Boston', 'Bain'],
    ['Partner', 'New York', 'McKinsey'],
    ['Vice President', 'New York', 'Goldman Sachs'],
    ['Engineer', 'California', 'Google'],
    ['Consultant', 'Chicago', 'McKinsey'],
    ['Analyst', 'Houston', 'Goldman Sachs'],
    ['Software Engineer', 'New York', 'Google'],
    ['Recruiter', 'New York', 'Goldman Sachs'],
    ['Designer', 'San Francisco', 'Google'],
    ['Manager', 'Dallas', 'McKinsey'],
    ['Director', 'Boston', 'Bain'],
    ['Researcher', 'Austin', 'Google'],
    ['Senior Software Engineer', 'San Francisco', 'Google'],
    ['Senior Consultant', 'New York', 'McKinsey'],
    ['Business Analyst', 'Chicago', 'McKinsey'],
    ['Financial Analyst', 'New York', 'Goldman Sachs'],
    ['Machine Learning Engineer', 'San Francisco', 'Google'],
    ['Data Engineer', 'Austin', 'Google'],
    ['Product Manager', 'New York', 'Google'],
  ];
  for (const [role, location, company] of roleLocationCombos) {
    cases.push(tc(CAT6, `${role} in ${location} at ${company}`, { company, role, location, requireEmail: false }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: Triple/quad filter combinations (15+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT7 = 'multi_filter';

  // Role + Company + Location
  cases.push(tc(CAT7, 'SWE at Google in SF', { company: 'Google', role: 'Software Engineer', location: 'San Francisco', requireEmail: false }));
  cases.push(tc(CAT7, 'Consultant at McKinsey in NYC', { company: 'McKinsey', role: 'Consultant', location: 'New York', requireEmail: false }));
  cases.push(tc(CAT7, 'IB Analyst at GS in NYC', { company: 'Goldman Sachs', role: 'Investment Banking Analyst', location: 'New York', requireEmail: false }));
  cases.push(tc(CAT7, 'Associate at Bain in Boston', { company: 'Bain', role: 'Associate', location: 'Boston', requireEmail: false }));
  cases.push(tc(CAT7, 'PM at Google in Seattle', { company: 'Google', role: 'Product Manager', location: 'Seattle', requireEmail: false }));
  cases.push(tc(CAT7, 'Partner at McKinsey in Chicago', { company: 'McKinsey', role: 'Partner', location: 'Chicago', requireEmail: false }));
  cases.push(tc(CAT7, 'DS at Google in Austin', { company: 'Google', role: 'Data Scientist', location: 'Austin', requireEmail: false }));

  // Role + Company + University
  cases.push(tc(CAT7, 'SWE at Google from UT Austin', { company: 'Google', role: 'Software Engineer', university: 'UT Austin', requireEmail: false }));
  cases.push(tc(CAT7, 'Consultant at McKinsey from Harvard', { company: 'McKinsey', role: 'Consultant', university: 'Harvard', requireEmail: false }));
  cases.push(tc(CAT7, 'Analyst at GS from NYU', { company: 'Goldman Sachs', role: 'Analyst', university: 'NYU', requireEmail: false }));
  cases.push(tc(CAT7, 'Associate at Bain from MIT', { company: 'Bain', role: 'Associate', university: 'MIT', requireEmail: false }));
  cases.push(tc(CAT7, 'PM at Google from Stanford', { company: 'Google', role: 'Product Manager', university: 'Stanford', requireEmail: false }));

  // All four filters
  cases.push(tc(CAT7, 'SWE at Google in SF from Stanford', { company: 'Google', role: 'Software Engineer', location: 'San Francisco', university: 'Stanford', requireEmail: false }));
  cases.push(tc(CAT7, 'Consultant at McKinsey in NYC from Harvard', { company: 'McKinsey', role: 'Consultant', location: 'New York', university: 'Harvard', requireEmail: false }));
  cases.push(tc(CAT7, 'Analyst at GS in NYC from NYU', { company: 'Goldman Sachs', role: 'Analyst', location: 'New York', university: 'NYU', requireEmail: false }));
  cases.push(tc(CAT7, 'Associate at Bain in Boston from UT Austin', { company: 'Bain', role: 'Associate', location: 'Boston', university: 'UT Austin', requireEmail: false }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 8: Full filter stack with email + excludes (10+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT8 = 'full_stack';

  cases.push(tc(CAT8, 'Full stack: SWE at Google, email required', { company: 'Google', role: 'Software Engineer', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: Consultant at McKinsey, email required', { company: 'McKinsey', role: 'Consultant', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: Analyst at GS, email required', { company: 'Goldman Sachs', role: 'Analyst', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: Associate at Bain, email required, NYC', { company: 'Bain', role: 'Associate', location: 'New York', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: PM at Google, email, SF', { company: 'Google', role: 'Product Manager', location: 'San Francisco', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: Partner at McKinsey, email, Chicago', { company: 'McKinsey', role: 'Partner', location: 'Chicago', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: SWE Google email UT Austin', { company: 'Google', role: 'Software Engineer', university: 'UT Austin', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: Consultant McKinsey email Harvard NYC', { company: 'McKinsey', role: 'Consultant', location: 'New York', university: 'Harvard', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: DS Google email Stanford SF', { company: 'Google', role: 'Data Scientist', location: 'San Francisco', university: 'Stanford', requireEmail: true }));
  cases.push(tc(CAT8, 'Full stack: IB Analyst GS email NYU NYC', { company: 'Goldman Sachs', role: 'Investment Banking Analyst', location: 'New York', university: 'NYU', requireEmail: true }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 9: Edge cases (20+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT9 = 'edge_case';

  // Empty/missing optional params
  cases.push(tc(CAT9, 'No role filter', { company: 'Google', requireEmail: false }));
  cases.push(tc(CAT9, 'Empty role string', { company: 'Google', role: '', requireEmail: false }));
  cases.push(tc(CAT9, 'Whitespace role', { company: 'Google', role: '   ', requireEmail: false }));
  cases.push(tc(CAT9, 'Empty company + role', { company: '', role: 'Software Engineer', requireEmail: false }));

  // Zero results expected
  cases.push(tc(CAT9, 'Nonexistent company', { company: 'ZZZZNONEXISTENT', role: 'Software Engineer', requireEmail: false }));
  cases.push(tc(CAT9, 'Nonsense role', { company: 'Google', role: 'Chief Banana Officer', requireEmail: false }));
  cases.push(tc(CAT9, 'Impossible combo', { company: 'Google', role: 'Investment Banking Analyst', location: 'Antarctica', requireEmail: false }));

  // Special characters
  cases.push(tc(CAT9, 'Special chars in role: Engineer (Backend)', { company: 'Google', role: 'Engineer (Backend)', requireEmail: false }));
  cases.push(tc(CAT9, 'Special chars: C++ Engineer', { company: 'Google', role: 'C++ Engineer', requireEmail: false }));
  cases.push(tc(CAT9, 'Special chars: VP, Engineering', { company: 'Google', role: 'VP, Engineering', requireEmail: false }));
  cases.push(tc(CAT9, "Apostrophe in name: O'Brien search", { company: "O'Melveny", requireEmail: false }));

  // Very long search string
  cases.push(tc(CAT9, 'Long role string', { company: 'Google', role: 'Senior Staff Software Engineer specializing in distributed systems and machine learning infrastructure', requireEmail: false }));

  // requireEmail variations
  cases.push(tc(CAT9, 'requireEmail=true vs false: Google', { company: 'Google', requireEmail: true }));
  cases.push(tc(CAT9, 'requireEmail=false: Google', { company: 'Google', requireEmail: false }));

  // Single character searches
  cases.push(tc(CAT9, 'Single char company: G', { company: 'G', requireEmail: false }));
  cases.push(tc(CAT9, 'Single char role: A', { company: 'Google', role: 'A', requireEmail: false }));

  // Limit edge cases
  cases.push(tc(CAT9, 'Limit=1', { company: 'Google', role: 'Software Engineer', requireEmail: false, limit: 1 }));
  cases.push(tc(CAT9, 'Limit=50', { company: 'Google', role: 'Software Engineer', requireEmail: false, limit: 50 }));
  cases.push(tc(CAT9, 'Limit=100', { company: 'Google', requireEmail: false, limit: 100 }));

  // Unicode
  cases.push(tc(CAT9, 'Unicode role', { company: 'Google', role: 'Ingenieur', requireEmail: false }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 10: Pagination & ordering consistency (10+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT10 = 'pagination';

  // Different limits should produce consistent subsets
  cases.push(tc(CAT10, 'Pagination: Google SWE limit=5', { company: 'Google', role: 'Software Engineer', requireEmail: false, limit: 5 }));
  cases.push(tc(CAT10, 'Pagination: Google SWE limit=10', { company: 'Google', role: 'Software Engineer', requireEmail: false, limit: 10 }));
  cases.push(tc(CAT10, 'Pagination: Google SWE limit=20', { company: 'Google', role: 'Software Engineer', requireEmail: false, limit: 20 }));
  cases.push(tc(CAT10, 'Pagination: McKinsey Consultant limit=5', { company: 'McKinsey', role: 'Consultant', requireEmail: false, limit: 5 }));
  cases.push(tc(CAT10, 'Pagination: McKinsey Consultant limit=10', { company: 'McKinsey', role: 'Consultant', requireEmail: false, limit: 10 }));
  cases.push(tc(CAT10, 'Pagination: McKinsey Consultant limit=20', { company: 'McKinsey', role: 'Consultant', requireEmail: false, limit: 20 }));
  cases.push(tc(CAT10, 'Pagination: GS Analyst limit=5', { company: 'Goldman Sachs', role: 'Analyst', requireEmail: false, limit: 5 }));
  cases.push(tc(CAT10, 'Pagination: GS Analyst limit=10', { company: 'Goldman Sachs', role: 'Analyst', requireEmail: false, limit: 10 }));
  cases.push(tc(CAT10, 'Pagination: GS Analyst limit=20', { company: 'Goldman Sachs', role: 'Analyst', requireEmail: false, limit: 20 }));
  cases.push(tc(CAT10, 'Pagination: Bain no role limit=30', { company: 'Bain', requireEmail: false, limit: 30 }));

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 11: Determinism (10+ cases — same query 3x)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT11 = 'determinism';

  // These will be run 3x each and compared
  const determinismQueries = [
    { company: 'Google', role: 'Software Engineer', requireEmail: false },
    { company: 'McKinsey', role: 'Consultant', requireEmail: false },
    { company: 'Goldman Sachs', role: 'Investment Banking Analyst', requireEmail: false },
    { company: 'Bain', role: 'Associate', requireEmail: false },
    { company: 'Google', role: 'Product Manager', location: 'San Francisco', requireEmail: false },
  ];
  for (let i = 0; i < determinismQueries.length; i++) {
    for (let run = 1; run <= 3; run++) {
      cases.push(tc(CAT11, `Determinism run ${run}: ${determinismQueries[i].role} at ${determinismQueries[i].company}`, {
        ...determinismQueries[i],
        limit: 10,
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 12: Latency stress tests (15+ cases)
  // ═══════════════════════════════════════════════════════════════════════
  const CAT12 = 'latency_stress';

  // Broadest queries (company only, no role)
  cases.push(tc(CAT12, 'Broadest: McKinsey no role limit=50', { company: 'McKinsey', requireEmail: false, limit: 50 }));
  cases.push(tc(CAT12, 'Broadest: Goldman Sachs no role limit=50', { company: 'Goldman Sachs', requireEmail: false, limit: 50 }));
  cases.push(tc(CAT12, 'Broadest: Google no role limit=50', { company: 'Google', requireEmail: false, limit: 50 }));

  // Broad role terms that match many embeddings
  cases.push(tc(CAT12, 'Broad role: Engineer at McKinsey limit=50', { company: 'McKinsey', role: 'Engineer', requireEmail: false, limit: 50, roleSpecificity: 'broad' }));
  cases.push(tc(CAT12, 'Broad role: Manager at Google limit=50', { company: 'Google', role: 'Manager', requireEmail: false, limit: 50, roleSpecificity: 'broad' }));
  cases.push(tc(CAT12, 'Broad role: Analyst at GS limit=50', { company: 'Goldman Sachs', role: 'Analyst', requireEmail: false, limit: 50, roleSpecificity: 'broad' }));

  // Large exclude lists
  const fakeIds50 = Array.from({ length: 50 }, (_, i) => `fake-id-${i}`);
  cases.push(tc(CAT12, 'Exclude 50 IDs: Google SWE', { company: 'Google', role: 'Software Engineer', excludePersonIds: fakeIds50, requireEmail: false }));

  // All filters active
  cases.push(tc(CAT12, 'All filters: SWE Google SF Stanford email', { company: 'Google', role: 'Software Engineer', location: 'San Francisco', university: 'Stanford', requireEmail: true }));
  cases.push(tc(CAT12, 'All filters: Consultant McKinsey NYC Harvard email', { company: 'McKinsey', role: 'Consultant', location: 'New York', university: 'Harvard', requireEmail: true }));

  // Run the broadest 3x for min/avg/max
  for (let i = 0; i < 3; i++) {
    cases.push(tc(CAT12, `Latency repeat ${i + 1}: McKinsey no role`, { company: 'McKinsey', requireEmail: false, limit: 50 }));
  }
  for (let i = 0; i < 3; i++) {
    cases.push(tc(CAT12, `Latency repeat ${i + 1}: Google broad Engineer`, { company: 'Google', role: 'Engineer', requireEmail: false, limit: 50, roleSpecificity: 'broad' }));
  }

  return cases;
}

// ── Main ──
async function main() {
  const cases = buildTestCases();
  console.log(`\n=== RETRIEVAL V2 COMPARISON TEST ===`);
  console.log(`Total test cases: ${cases.length}`);
  console.log(`Log file: ${LOG_FILE}\n`);

  // Count by category
  const catCounts = new Map<string, number>();
  for (const c of cases) {
    catCounts.set(c.category, (catCounts.get(c.category) || 0) + 1);
  }
  for (const [cat, count] of catCounts.entries()) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log();

  const results: TestResult[] = [];
  let crashes = 0;
  const startTime = Date.now();

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const progress = `[${i + 1}/${cases.length}]`;
    process.stdout.write(`${progress} ${tc.description}... `);

    try {
      const result = await runTest(tc);
      results.push(result);

      const v = result.comparison.verdict;
      const symbol = v === 'TIE' ? '=' : v === 'V2_BETTER' ? '+' : v === 'BOTH_EMPTY' ? '0' : v.includes('CRASH') ? 'X' : '-';
      console.log(`${symbol} | V1:${result.old_function.result_count}(${result.old_function.timing_ms}ms) V2:${result.new_function.result_count}(${result.new_function.timing_ms}ms) overlap=${result.comparison.overlap_count} verdict=${v}`);

      if (v.includes('CRASH')) crashes++;
      if (crashes > cases.length * 0.2) {
        console.error('\n\n!!! CRASH RATE EXCEEDED 20% — ABORTING !!!\n');
        break;
      }
    } catch (e: any) {
      console.log(`FATAL: ${e.message}`);
      crashes++;
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== DONE in ${elapsed}s ===\n`);

  // ── Generate summary stats ──
  const verdictCounts = new Map<string, number>();
  for (const r of results) {
    const v = r.comparison.verdict;
    verdictCounts.set(v, (verdictCounts.get(v) || 0) + 1);
  }

  const totalRun = results.length;
  const v2Better = verdictCounts.get('V2_BETTER') || 0;
  const v1Better = verdictCounts.get('V1_BETTER') || 0;
  const ties = verdictCounts.get('TIE') || 0;
  const bothEmpty = verdictCounts.get('BOTH_EMPTY') || 0;
  const v2Crash = verdictCounts.get('V2_CRASH') || 0;
  const v1Crash = verdictCounts.get('V1_CRASH') || 0;
  const bothCrash = verdictCounts.get('BOTH_CRASH') || 0;
  const totalCrash = v2Crash + v1Crash + bothCrash;

  // Timing analysis
  const oldTimings = results.filter(r => !r.old_function.error).map(r => r.old_function.timing_ms).sort((a, b) => a - b);
  const newTimings = results.filter(r => !r.new_function.error).map(r => r.new_function.timing_ms).sort((a, b) => a - b);
  const percentile = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)] ?? 0;
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  // Per-category breakdown
  const catResults = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!catResults.has(r.category)) catResults.set(r.category, []);
    catResults.get(r.category)!.push(r);
  }

  // Find regressions
  const regressions = results.filter(r => r.comparison.verdict === 'V1_BETTER');
  const bigWins = results
    .filter(r => r.comparison.verdict === 'V2_BETTER')
    .sort((a, b) => (b.new_function.result_count - b.old_function.result_count) - (a.new_function.result_count - a.old_function.result_count))
    .slice(0, 10);

  // Crashes
  const crashResults = results.filter(r => r.comparison.verdict.includes('CRASH'));

  // Slow queries
  const slowQueries = results.filter(r =>
    r.new_function.timing_ms > 500 || r.old_function.timing_ms > 500
  );
  const verySlowQueries = results.filter(r =>
    r.new_function.timing_ms > 1000 || r.old_function.timing_ms > 1000
  );

  // ── Write VERDICT.md ──
  const verdictPath = path.join(LOG_DIR, 'VERDICT.md');
  let md = `# Retrieval V2 Comparison Verdict\n\n`;
  md += `**Run date:** ${new Date().toISOString()}\n`;
  md += `**Total test cases:** ${totalRun}\n`;
  md += `**Duration:** ${elapsed}s\n`;
  md += `**Log file:** ${LOG_FILE}\n\n`;

  md += `## Summary Stats\n\n`;
  md += `| Metric | Count | % |\n`;
  md += `|--------|-------|---|\n`;
  md += `| Total run | ${totalRun} | 100% |\n`;
  md += `| V2 Better | ${v2Better} | ${(v2Better / totalRun * 100).toFixed(1)}% |\n`;
  md += `| V1 Better | ${v1Better} | ${(v1Better / totalRun * 100).toFixed(1)}% |\n`;
  md += `| Tie | ${ties} | ${(ties / totalRun * 100).toFixed(1)}% |\n`;
  md += `| Both Empty | ${bothEmpty} | ${(bothEmpty / totalRun * 100).toFixed(1)}% |\n`;
  md += `| V2 Crash | ${v2Crash} | ${(v2Crash / totalRun * 100).toFixed(1)}% |\n`;
  md += `| V1 Crash | ${v1Crash} | ${(v1Crash / totalRun * 100).toFixed(1)}% |\n`;
  md += `| Both Crash | ${bothCrash} | ${(bothCrash / totalRun * 100).toFixed(1)}% |\n`;
  md += `| Pass rate (no crash) | ${totalRun - totalCrash} | ${((totalRun - totalCrash) / totalRun * 100).toFixed(1)}% |\n\n`;

  md += `## Performance Analysis\n\n`;
  md += `| Metric | V1 (ms) | V2 (ms) | Delta |\n`;
  md += `|--------|---------|---------|-------|\n`;
  md += `| Average | ${avg(oldTimings)} | ${avg(newTimings)} | ${avg(newTimings) - avg(oldTimings)} |\n`;
  md += `| p50 | ${percentile(oldTimings, 50)} | ${percentile(newTimings, 50)} | ${percentile(newTimings, 50) - percentile(oldTimings, 50)} |\n`;
  md += `| p95 | ${percentile(oldTimings, 95)} | ${percentile(newTimings, 95)} | ${percentile(newTimings, 95) - percentile(oldTimings, 95)} |\n`;
  md += `| p99 | ${percentile(oldTimings, 99)} | ${percentile(newTimings, 99)} | ${percentile(newTimings, 99) - percentile(oldTimings, 99)} |\n`;
  md += `| Max | ${oldTimings[oldTimings.length - 1] || 0} | ${newTimings[newTimings.length - 1] || 0} | ${(newTimings[newTimings.length - 1] || 0) - (oldTimings[oldTimings.length - 1] || 0)} |\n\n`;

  if (slowQueries.length > 0) {
    md += `### Slow Queries (>500ms)\n\n`;
    for (const r of slowQueries) {
      md += `- **${r.test_id}** ${r.description}: V1=${r.old_function.timing_ms}ms, V2=${r.new_function.timing_ms}ms\n`;
    }
    md += `\n`;
  }

  if (verySlowQueries.length > 0) {
    md += `### CRITICAL: Queries >1000ms (automatic failure)\n\n`;
    for (const r of verySlowQueries) {
      md += `- **${r.test_id}** ${r.description}: V1=${r.old_function.timing_ms}ms, V2=${r.new_function.timing_ms}ms\n`;
    }
    md += `\n`;
  }

  md += `## Per-Category Breakdown\n\n`;
  md += `| Category | Cases | V2 Win | V1 Win | Tie | Empty | Crash | Avg V1 ms | Avg V2 ms |\n`;
  md += `|----------|-------|--------|--------|-----|-------|-------|-----------|----------|\n`;
  for (const [cat, rs] of catResults.entries()) {
    const cV2 = rs.filter(r => r.comparison.verdict === 'V2_BETTER').length;
    const cV1 = rs.filter(r => r.comparison.verdict === 'V1_BETTER').length;
    const cTie = rs.filter(r => r.comparison.verdict === 'TIE').length;
    const cEmpty = rs.filter(r => r.comparison.verdict === 'BOTH_EMPTY').length;
    const cCrash = rs.filter(r => r.comparison.verdict.includes('CRASH')).length;
    const aV1 = avg(rs.filter(r => !r.old_function.error).map(r => r.old_function.timing_ms));
    const aV2 = avg(rs.filter(r => !r.new_function.error).map(r => r.new_function.timing_ms));
    md += `| ${cat} | ${rs.length} | ${cV2} | ${cV1} | ${cTie} | ${cEmpty} | ${cCrash} | ${aV1} | ${aV2} |\n`;
  }
  md += `\n`;

  md += `## Regression Analysis (V1 Better)\n\n`;
  if (regressions.length === 0) {
    md += `No regressions found.\n\n`;
  } else {
    md += `Found ${regressions.length} regressions:\n\n`;
    for (const r of regressions) {
      md += `### ${r.test_id}: ${r.description}\n`;
      md += `- V1: ${r.old_function.result_count} results (${r.old_function.timing_ms}ms)\n`;
      md += `- V2: ${r.new_function.result_count} results (${r.new_function.timing_ms}ms)\n`;
      md += `- Overlap: ${r.comparison.overlap_count}, Only V1: ${r.comparison.only_in_old}, Only V2: ${r.comparison.only_in_new}\n`;
      md += `- V1 top 5: ${r.old_function.top_5.map(p => `${p.name} (${p.role} @ ${p.company})`).join(', ')}\n`;
      md += `- V2 top 5: ${r.new_function.top_5.map(p => `${p.name} (${p.role} @ ${p.company})`).join(', ')}\n\n`;
    }
  }

  md += `## Top 10 Biggest Wins (V2 Better)\n\n`;
  for (const r of bigWins) {
    md += `### ${r.test_id}: ${r.description}\n`;
    md += `- V1: ${r.old_function.result_count} results (${r.old_function.timing_ms}ms)\n`;
    md += `- V2: ${r.new_function.result_count} results (${r.new_function.timing_ms}ms)\n`;
    md += `- V2 gained ${r.comparison.only_in_new} new results, lost ${r.comparison.only_in_old} old results\n`;
    md += `- V2 top 5: ${r.new_function.top_5.map(p => `${p.name} (${p.role} @ ${p.company})`).join(', ')}\n\n`;
  }

  md += `## Crash Report\n\n`;
  if (crashResults.length === 0) {
    md += `No crashes.\n\n`;
  } else {
    md += `Found ${crashResults.length} crashes:\n\n`;
    for (const r of crashResults) {
      md += `### ${r.test_id}: ${r.description} (${r.comparison.verdict})\n`;
      md += `- Inputs: \`${JSON.stringify(r.inputs)}\`\n`;
      if (r.old_function.error) md += `- V1 Error: \`${r.old_function.error.substring(0, 500)}\`\n`;
      if (r.new_function.error) md += `- V2 Error: \`${r.new_function.error.substring(0, 500)}\`\n`;
      md += `\n`;
    }
  }

  // Determinism check
  md += `## Determinism Analysis\n\n`;
  const detResults = results.filter(r => r.category === 'determinism');
  const detGroups = new Map<string, TestResult[]>();
  for (const r of detResults) {
    // Group by the core description minus "run N"
    const key = r.description.replace(/Determinism run \d+: /, '');
    if (!detGroups.has(key)) detGroups.set(key, []);
    detGroups.get(key)!.push(r);
  }
  for (const [key, runs] of detGroups.entries()) {
    const v2IdSets = runs.map(r => new Set(r.new_function.top_5.map(p => p.id)));
    const allSame = v2IdSets.every((s, _, arr) => {
      const first = arr[0];
      if (s.size !== first.size) return false;
      for (const id of s) if (!first.has(id)) return false;
      return true;
    });
    md += `- **${key}**: ${allSame ? 'DETERMINISTIC' : 'NOT DETERMINISTIC'} (${runs.map(r => `${r.new_function.result_count} results`).join(', ')})\n`;
  }
  md += `\n`;

  // Pagination consistency check
  md += `## Pagination Consistency\n\n`;
  const pagResults = results.filter(r => r.category === 'pagination');
  const pagGroups = new Map<string, TestResult[]>();
  for (const r of pagResults) {
    const key = r.description.replace(/ limit=\d+/, '');
    if (!pagGroups.has(key)) pagGroups.set(key, []);
    pagGroups.get(key)!.push(r);
  }
  for (const [key, runs] of pagGroups.entries()) {
    const sorted = runs.sort((a, b) => (a.inputs as any).limit - (b.inputs as any).limit);
    let consistent = true;
    for (let i = 0; i < sorted.length - 1; i++) {
      const smallerIds = new Set(sorted[i].new_function.top_5.map(p => p.id));
      const largerTop5 = sorted[i + 1].new_function.top_5;
      // The smaller set's top 5 should be a subset of the larger set's results
      for (const id of smallerIds) {
        if (!sorted[i + 1].new_function.top_5.some(p => p.id === id) &&
            sorted[i + 1].new_function.result_count >= sorted[i].new_function.result_count) {
          consistent = false;
        }
      }
    }
    md += `- **${key}**: ${consistent ? 'CONSISTENT' : 'INCONSISTENT'} (limits: ${sorted.map(r => `${(r.inputs as any).limit}→${r.new_function.result_count}`).join(', ')})\n`;
  }
  md += `\n`;

  // Latency by filter combo
  md += `## Latency by Filter Combination\n\n`;
  const filterCombos = new Map<string, number[]>();
  for (const r of results) {
    if (r.new_function.error) continue;
    const inp = r.inputs as any;
    const combo = [
      inp.company ? 'company' : '',
      inp.role ? 'role' : '',
      inp.location ? 'location' : '',
      inp.university ? 'university' : '',
    ].filter(Boolean).join('+') || 'none';
    if (!filterCombos.has(combo)) filterCombos.set(combo, []);
    filterCombos.get(combo)!.push(r.new_function.timing_ms);
  }
  md += `| Filter Combo | Count | Avg ms | p95 ms | Max ms |\n`;
  md += `|-------------|-------|--------|--------|--------|\n`;
  for (const [combo, timings] of filterCombos.entries()) {
    const sorted = timings.sort((a, b) => a - b);
    md += `| ${combo} | ${sorted.length} | ${avg(sorted)} | ${percentile(sorted, 95)} | ${sorted[sorted.length - 1]} |\n`;
  }
  md += `\n`;

  // Production readiness verdict
  md += `## Production Readiness Verdict\n\n`;
  const passRate = (totalRun - totalCrash) / totalRun;
  const v2WinOrTie = (v2Better + ties + bothEmpty) / totalRun;
  const p95V2 = percentile(newTimings, 95);
  const maxV2 = newTimings[newTimings.length - 1] || 0;
  const latencyRegression = avg(newTimings) > avg(oldTimings) * 1.2; // 20% slower = regression

  if (totalCrash === 0 && v2WinOrTie >= 0.9 && p95V2 <= 500 && maxV2 <= 1000 && !latencyRegression) {
    md += `**PRODUCTION READY**\n\n`;
    md += `V2 is better or equal in ${(v2WinOrTie * 100).toFixed(1)}% of cases. `;
    md += `No crashes. p95 latency: ${p95V2}ms. Max latency: ${maxV2}ms. `;
    md += `No latency regression vs V1.\n`;
  } else if (totalCrash > totalRun * 0.1 || v2WinOrTie < 0.5) {
    md += `**WRONG APPROACH**\n\n`;
    md += `Crash rate: ${(totalCrash / totalRun * 100).toFixed(1)}%. `;
    md += `V2 win+tie rate: ${(v2WinOrTie * 100).toFixed(1)}%. `;
    md += `This level of failure indicates fundamental issues.\n`;
  } else {
    md += `**NEEDS TUNING**\n\n`;
    const issues: string[] = [];
    if (totalCrash > 0) issues.push(`${totalCrash} crashes need investigation`);
    if (v2WinOrTie < 0.9) issues.push(`V2 win+tie rate is ${(v2WinOrTie * 100).toFixed(1)}% (target: 90%+). ${v1Better} regressions need root cause analysis`);
    if (p95V2 > 500) issues.push(`p95 latency ${p95V2}ms exceeds 500ms target`);
    if (maxV2 > 1000) issues.push(`Max latency ${maxV2}ms exceeds 1000ms hard limit`);
    if (latencyRegression) issues.push(`Average latency regression: V1=${avg(oldTimings)}ms vs V2=${avg(newTimings)}ms`);
    md += `Issues to fix:\n`;
    for (const issue of issues) {
      md += `1. ${issue}\n`;
    }
  }

  fs.writeFileSync(verdictPath, md);
  console.log(`\nVerdict written to: ${verdictPath}`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`V2 Better: ${v2Better} (${(v2Better / totalRun * 100).toFixed(1)}%)`);
  console.log(`V1 Better: ${v1Better} (${(v1Better / totalRun * 100).toFixed(1)}%)`);
  console.log(`Tie: ${ties} (${(ties / totalRun * 100).toFixed(1)}%)`);
  console.log(`Both Empty: ${bothEmpty} (${(bothEmpty / totalRun * 100).toFixed(1)}%)`);
  console.log(`Crashes: ${totalCrash} (${(totalCrash / totalRun * 100).toFixed(1)}%)`);
  console.log(`Avg latency — V1: ${avg(oldTimings)}ms | V2: ${avg(newTimings)}ms`);
  console.log(`p95 latency — V1: ${percentile(oldTimings, 95)}ms | V2: ${percentile(newTimings, 95)}ms`);

  // Exit with error if too many crashes
  if (totalCrash > totalRun * 0.2) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
