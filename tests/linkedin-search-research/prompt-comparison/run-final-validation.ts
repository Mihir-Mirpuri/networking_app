/**
 * Final Validation of v2 Search Extraction Prompt
 *
 * Focused re-test on the areas v2 was refined: seniority handling,
 * title vs function_ids routing, skill/keyword queries, edge cases,
 * and new v2-specific patterns.
 *
 * Usage:
 *   npx tsx tests/linkedin-search-research/prompt-comparison/run-final-validation.ts
 */

import 'dotenv/config';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT_V2 } from '../../../src/lib/prompts/search-extraction-prompt-v2';
import { completeJsonAnthropic } from '../../../src/lib/services/anthropic';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LLMOutput {
  status: string;
  confidence?: string;
  role_specificity?: string;
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  linkedin_filters?: Record<string, unknown>;
  company_name_ambiguous?: boolean;
  person_name?: string | null;
  person_company?: string | null;
  selectables?: Array<{ label: string; filter_key: string; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role?: string | null }>;
  message?: string;
}

type CheckType =
  | 'status_correct'
  | 'title_routing'
  | 'seniority_handling'
  | 'role_specificity'
  | 'school_expansion'
  | 'location_expansion'
  | 'no_company_in_searchquery'
  | 'message_appropriate';

interface CheckResult {
  type: CheckType;
  pass: boolean;
  detail: string;
}

interface TestCase {
  id: number;
  category: string;
  input: string;
  expected_status: string;
  /** Expected title routing: 'current_job_titles', 'function_ids', 'neither', or 'either' */
  expected_routing: 'current_job_titles' | 'function_ids' | 'neither' | 'either';
  expected_titles?: string[];
  expected_function_ids?: string[];
  /** Seniority check: 'no_120_110_inclusion' | 'inclusion_ok' with specific ids | 'na' */
  seniority_check: 'no_120_110_inclusion' | 'inclusion_ok' | 'na';
  seniority_inclusion_ids?: string[];
  expected_role_specificity?: 'narrow' | 'standard' | 'broad';
  expected_school_full_name?: string;
  expected_location_full_name?: string;
  check_no_company_in_sq?: boolean;
  message_check?: 'high_confidence' | 'medium_keyword' | 'off_topic' | 'na';
  notes: string;
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

const TEST_CASES: TestCase[] = [
  // ══════════════════════════════════════════════════════════════════════════════
  // SENIORITY HANDLING (10 cases) -- the CRITICAL area
  // ══════════════════════════════════════════════════════════════════════════════
  {
    id: 1, category: 'seniority', input: 'senior engineers at Google',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Software Engineer'],
    seniority_check: 'no_120_110_inclusion',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'CRITICAL: Must NOT use seniority_level_ids: ["120"]. Should use exclude_seniority_level_ids: ["110"].',
  },
  {
    id: 2, category: 'seniority', input: 'senior PMs at Meta',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Product Manager'],
    seniority_check: 'no_120_110_inclusion',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'CRITICAL: "senior" must NOT produce seniority_level_ids: ["120"].',
  },
  {
    id: 3, category: 'seniority', input: 'junior developers at Stripe',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Software Engineer'],
    seniority_check: 'na', // junior -> 110 as inclusion is acceptable per prompt
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Junior is a special case -- 110 as inclusion is slightly acceptable per the prompt exception.',
  },
  {
    id: 4, category: 'seniority', input: 'staff engineers at Netflix',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Staff Software Engineer'],
    seniority_check: 'no_120_110_inclusion',
    expected_role_specificity: 'narrow',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Staff should map to specific title "Staff Software Engineer", not seniority filter.',
  },
  {
    id: 5, category: 'seniority', input: 'lead designers at Figma',
    expected_status: 'ready',
    expected_routing: 'either', // could be title or function_ids
    seniority_check: 'no_120_110_inclusion',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"lead designers" -- tricky. Could use function_ids:3 or a title. Must not use 120 inclusion.',
  },
  {
    id: 6, category: 'seniority', input: 'experienced data scientists at Amazon',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Data Scientist'],
    seniority_check: 'no_120_110_inclusion',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"experienced" should use exclude_seniority_level_ids: ["110"], not 120 inclusion.',
  },
  {
    id: 7, category: 'seniority', input: 'directors at Apple',
    expected_status: 'ready',
    expected_routing: 'neither', // directors use seniority_level_ids only
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['220'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Director is high-reliability seniority. Should use seniority_level_ids: ["220"].',
  },
  {
    id: 8, category: 'seniority', input: 'managers at Microsoft',
    expected_status: 'ready',
    expected_routing: 'neither', // managers use seniority_level_ids
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['200', '210'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Manager is high-reliability. Should use seniority_level_ids: ["200","210"].',
  },
  {
    id: 9, category: 'seniority', input: 'VP of engineering at Uber',
    expected_status: 'ready',
    expected_routing: 'either', // could use title or seniority
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['300'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'VP is high-reliability. Should use seniority_level_ids: ["300"].',
  },
  {
    id: 10, category: 'seniority', input: 'founders at Stripe',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['310', '320'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Founders -> seniority_level_ids: ["310","320"].',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // TITLE vs FUNCTION_IDS ROUTING (10 cases)
  // ══════════════════════════════════════════════════════════════════════════════
  {
    id: 11, category: 'title_routing', input: 'software engineers at Stripe',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Software Engineer'],
    seniority_check: 'na',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Named title -> current_job_titles.',
  },
  {
    id: 12, category: 'title_routing', input: 'engineers at Figma',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['8'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"engineers" (generic discipline) -> function_ids: ["8"].',
  },
  {
    id: 13, category: 'title_routing', input: 'product managers at Google',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Product Manager'],
    seniority_check: 'na',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Named title -> current_job_titles.',
  },
  {
    id: 14, category: 'title_routing', input: 'designers at Airbnb',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['3'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"designers" (generic discipline) -> function_ids: ["3"].',
  },
  {
    id: 15, category: 'title_routing', input: 'recruiters at Meta',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['12'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"recruiters" -> function_ids: ["12"].',
  },
  {
    id: 16, category: 'title_routing', input: 'lawyers at Cravath',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['14'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"lawyers" -> function_ids: ["14"].',
  },
  {
    id: 17, category: 'title_routing', input: 'data scientists at Netflix',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Data Scientist'],
    seniority_check: 'na',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Named title -> current_job_titles.',
  },
  {
    id: 18, category: 'title_routing', input: 'HR at Amazon',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['12'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"HR" -> function_ids: ["12"].',
  },
  {
    id: 19, category: 'title_routing', input: 'SREs at Datadog',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Site Reliability Engineer'],
    seniority_check: 'na',
    expected_role_specificity: 'narrow',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'SRE is a niche title -> current_job_titles, narrow.',
  },
  {
    id: 20, category: 'title_routing', input: 'salespeople at Salesforce',
    expected_status: 'ready',
    expected_routing: 'function_ids',
    expected_function_ids: ['25'],
    seniority_check: 'na',
    expected_role_specificity: 'broad',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"salespeople" -> function_ids: ["25"].',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // SKILL/KEYWORD QUERIES (5 cases)
  // ══════════════════════════════════════════════════════════════════════════════
  {
    id: 21, category: 'skill_keyword', input: 'people who know Rust at Stripe',
    expected_status: 'ready',
    expected_routing: 'neither', // skill query, no title needed
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'medium_keyword',
    notes: 'Skill -> search_query with "rust". Should mention keyword is broad.',
  },
  {
    id: 22, category: 'skill_keyword', input: 'ML specialists at Google',
    expected_status: 'ready',
    expected_routing: 'either', // could be title "ML Engineer" or search_query
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'na',
    notes: '"ML specialists" could map to title or keyword. Either is acceptable.',
  },
  {
    id: 23, category: 'skill_keyword', input: 'Python and Kubernetes engineers at Amazon',
    expected_status: 'ready',
    expected_routing: 'either', // could be function_ids + search_query or just search_query
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'na',
    notes: 'Skill + discipline. search_query should contain python/kubernetes.',
  },
  {
    id: 24, category: 'skill_keyword', input: 'fintech people at Stripe',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'medium_keyword',
    notes: '"fintech" is a domain keyword -> search_query.',
  },
  {
    id: 25, category: 'skill_keyword', input: 'blockchain experts at Coinbase',
    expected_status: 'ready',
    expected_routing: 'either', // could be title or keyword
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'na',
    notes: '"blockchain" could map to title or keyword.',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // EDGE CASES AND MISC (10 cases)
  // ══════════════════════════════════════════════════════════════════════════════
  {
    id: 26, category: 'edge_case', input: 'MIT grads at Google',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'School expansion: MIT -> Massachusetts Institute of Technology.',
  },
  {
    id: 27, category: 'edge_case', input: 'ex-Google engineers at Anthropic',
    expected_status: 'ready',
    expected_routing: 'either', // could be title or function_ids for "engineers"
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'past_companies should include Google. Current company = Anthropic.',
  },
  {
    id: 28, category: 'edge_case', input: 'people at Chase',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Ambiguous company name. company_name_ambiguous should be true.',
  },
  {
    id: 29, category: 'edge_case', input: 'engineers at FAANG',
    expected_status: 'needs_selection',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: false,
    message_check: 'na',
    notes: 'FAANG is a category, not a company. Should return selectables.',
  },
  {
    id: 30, category: 'edge_case', input: 'Find Sarah Johnson at Meta',
    expected_status: 'person_lookup',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: false,
    message_check: 'na',
    notes: 'Person lookup with first + last name.',
  },
  {
    id: 31, category: 'edge_case', input: 'people who recently joined Stripe',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'recently_changed_jobs should be true.',
  },
  {
    id: 32, category: 'edge_case', input: '10+ year veterans at Apple',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'na',
    notes: 'years_of_experience_ids should include "5" (10+ yrs).',
  },
  {
    id: 33, category: 'edge_case', input: 'non-management engineers at Google',
    expected_status: 'ready',
    expected_routing: 'either',
    seniority_check: 'na',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Should use exclude_seniority_level_ids for management levels.',
  },
  {
    id: 34, category: 'edge_case', input: 'senior engineers at Uber not in California',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Software Engineer'],
    seniority_check: 'no_120_110_inclusion',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Combo: seniority + title + exclude_locations. No 120 inclusion.',
  },
  {
    id: 35, category: 'edge_case', input: "how's the weather?",
    expected_status: 'off_topic',
    expected_routing: 'neither',
    seniority_check: 'na',
    check_no_company_in_sq: false,
    message_check: 'off_topic',
    notes: 'Off-topic detection.',
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // NEW V2-SPECIFIC PATTERNS (5 cases)
  // ══════════════════════════════════════════════════════════════════════════════
  {
    id: 36, category: 'v2_specific', input: 'directors of engineering at Google',
    expected_status: 'ready',
    expected_routing: 'either', // could use seniority 220 + function_ids 8, or title
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['220'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"Directors of engineering" -- should combine seniority 220 with engineering context.',
  },
  {
    id: 37, category: 'v2_specific', input: 'engineering managers at Meta',
    expected_status: 'ready',
    expected_routing: 'either', // could use title "Engineering Manager" or seniority
    seniority_check: 'na', // manager seniority ids (200/210) are fine
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"Engineering managers" is a named title but also maps to seniority.',
  },
  {
    id: 38, category: 'v2_specific', input: 'principal engineers at Amazon',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    seniority_check: 'no_120_110_inclusion',
    expected_role_specificity: 'narrow',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: '"Principal Engineer" is a niche title. Must NOT use 120 as inclusion.',
  },
  {
    id: 39, category: 'v2_specific', input: 'C-suite at Stripe',
    expected_status: 'ready',
    expected_routing: 'neither',
    seniority_check: 'inclusion_ok',
    seniority_inclusion_ids: ['310'],
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'C-suite -> seniority_level_ids: ["310"]. High reliability.',
  },
  {
    id: 40, category: 'v2_specific', input: 'investment banking analysts at Goldman Sachs',
    expected_status: 'ready',
    expected_routing: 'current_job_titles',
    expected_titles: ['Investment Banking Analyst'],
    seniority_check: 'na',
    expected_role_specificity: 'standard',
    check_no_company_in_sq: true,
    message_check: 'high_confidence',
    notes: 'Named title at a specific firm -> current_job_titles.',
  },
];

// ─── Check Evaluation ────────────────────────────────────────────────────────

function getLinkedInFilters(output: LLMOutput): Record<string, unknown> {
  return output.linkedin_filters || {};
}

function evaluateChecks(tc: TestCase, output: LLMOutput): CheckResult[] {
  const results: CheckResult[] = [];
  const lf = getLinkedInFilters(output);

  // 1. status_correct
  results.push({
    type: 'status_correct',
    pass: output.status === tc.expected_status,
    detail: `expected="${tc.expected_status}" got="${output.status}"`,
  });

  // 2. title_routing
  const hasTitles = Array.isArray(lf.current_job_titles) && (lf.current_job_titles as string[]).length > 0;
  const hasFunctionIds = Array.isArray(lf.function_ids) && (lf.function_ids as string[]).length > 0;

  let titleRoutingPass = false;
  let titleRoutingDetail = '';

  switch (tc.expected_routing) {
    case 'current_job_titles':
      if (hasTitles && !hasFunctionIds) {
        // Check if expected titles match
        if (tc.expected_titles) {
          const actualTitles = lf.current_job_titles as string[];
          const match = tc.expected_titles.some(exp =>
            actualTitles.some(t => t.toLowerCase().includes(exp.toLowerCase()))
          );
          titleRoutingPass = match;
          titleRoutingDetail = `expected titles containing ${JSON.stringify(tc.expected_titles)}, got ${JSON.stringify(actualTitles)}`;
        } else {
          titleRoutingPass = true;
          titleRoutingDetail = `correctly used current_job_titles: ${JSON.stringify(lf.current_job_titles)}`;
        }
      } else {
        titleRoutingPass = false;
        titleRoutingDetail = `expected current_job_titles only. hasTitles=${hasTitles}, hasFunctionIds=${hasFunctionIds}. titles=${JSON.stringify(lf.current_job_titles)}, fids=${JSON.stringify(lf.function_ids)}`;
      }
      break;

    case 'function_ids':
      if (hasFunctionIds && !hasTitles) {
        if (tc.expected_function_ids) {
          const actualFids = lf.function_ids as string[];
          const match = tc.expected_function_ids.every(exp => actualFids.includes(exp));
          titleRoutingPass = match;
          titleRoutingDetail = `expected function_ids ${JSON.stringify(tc.expected_function_ids)}, got ${JSON.stringify(actualFids)}`;
        } else {
          titleRoutingPass = true;
          titleRoutingDetail = `correctly used function_ids: ${JSON.stringify(lf.function_ids)}`;
        }
      } else {
        titleRoutingPass = false;
        titleRoutingDetail = `expected function_ids only. hasTitles=${hasTitles}, hasFunctionIds=${hasFunctionIds}. titles=${JSON.stringify(lf.current_job_titles)}, fids=${JSON.stringify(lf.function_ids)}`;
      }
      break;

    case 'neither':
      titleRoutingPass = !hasTitles && !hasFunctionIds;
      // For seniority-only cases (directors, managers, VPs, founders, C-suite),
      // allow either no routing OR title-based routing
      if (!titleRoutingPass && ['directors at Apple', 'managers at Microsoft', 'founders at Stripe', 'C-suite at Stripe'].some(s => tc.input.includes(s.split(' at ')[0]))) {
        // These cases use seniority_level_ids as the primary filter.
        // Having no titles/function_ids is correct. Having titles is acceptable too.
        titleRoutingPass = true;
        titleRoutingDetail = `seniority-based query. titles=${JSON.stringify(lf.current_job_titles)}, fids=${JSON.stringify(lf.function_ids)}. Acceptable.`;
      } else if (!titleRoutingPass) {
        titleRoutingDetail = `expected neither titles nor function_ids. hasTitles=${hasTitles}, hasFunctionIds=${hasFunctionIds}`;
      } else {
        titleRoutingDetail = 'correctly used neither titles nor function_ids';
      }
      break;

    case 'either':
      titleRoutingPass = true; // any routing is acceptable
      titleRoutingDetail = `flexible routing accepted. titles=${JSON.stringify(lf.current_job_titles)}, fids=${JSON.stringify(lf.function_ids)}`;
      break;
  }

  // IMPORTANT: For both hasTitles AND hasFunctionIds, that is always a failure
  // per "NEVER set both current_job_titles AND function_ids for the same role"
  if (hasTitles && hasFunctionIds && tc.expected_routing !== 'either') {
    titleRoutingPass = false;
    titleRoutingDetail = `VIOLATION: both current_job_titles AND function_ids set. titles=${JSON.stringify(lf.current_job_titles)}, fids=${JSON.stringify(lf.function_ids)}`;
  }

  results.push({
    type: 'title_routing',
    pass: titleRoutingPass,
    detail: titleRoutingDetail,
  });

  // 3. seniority_handling
  let seniorityPass = false;
  let seniorityDetail = '';
  const seniorityIds = lf.seniority_level_ids as string[] | undefined;
  const excludeSeniorityIds = lf.exclude_seniority_level_ids as string[] | undefined;

  switch (tc.seniority_check) {
    case 'no_120_110_inclusion':
      // Must NOT have 120 or 110 in seniority_level_ids
      if (!seniorityIds || seniorityIds.length === 0) {
        seniorityPass = true;
        seniorityDetail = 'no seniority_level_ids set (correct)';
      } else {
        const has120 = seniorityIds.includes('120');
        const has110 = seniorityIds.includes('110');
        if (has120 || has110) {
          seniorityPass = false;
          seniorityDetail = `CRITICAL FAILURE: seniority_level_ids contains low-reliability IDs: ${JSON.stringify(seniorityIds)}`;
        } else {
          seniorityPass = true;
          seniorityDetail = `seniority_level_ids=${JSON.stringify(seniorityIds)} (no 120/110, ok)`;
        }
      }
      // Also check that exclude_seniority_level_ids is used appropriately
      if (seniorityPass && excludeSeniorityIds && excludeSeniorityIds.includes('110')) {
        seniorityDetail += '. Correctly uses exclude_seniority_level_ids: ["110"]';
      }
      break;

    case 'inclusion_ok':
      if (tc.seniority_inclusion_ids) {
        if (!seniorityIds || seniorityIds.length === 0) {
          seniorityPass = false;
          seniorityDetail = `expected seniority_level_ids containing ${JSON.stringify(tc.seniority_inclusion_ids)}, got none`;
        } else {
          const hasExpected = tc.seniority_inclusion_ids.some(id => seniorityIds.includes(id));
          seniorityPass = hasExpected;
          seniorityDetail = `expected one of ${JSON.stringify(tc.seniority_inclusion_ids)} in ${JSON.stringify(seniorityIds)}`;
        }
      } else {
        seniorityPass = true;
        seniorityDetail = 'seniority inclusion ok (no specific ids expected)';
      }
      break;

    case 'na':
      seniorityPass = true;
      seniorityDetail = 'n/a for this case';
      break;
  }

  results.push({
    type: 'seniority_handling',
    pass: seniorityPass,
    detail: seniorityDetail,
  });

  // 4. role_specificity
  if (tc.expected_role_specificity) {
    results.push({
      type: 'role_specificity',
      pass: output.role_specificity === tc.expected_role_specificity,
      detail: `expected="${tc.expected_role_specificity}" got="${output.role_specificity}"`,
    });
  } else {
    results.push({
      type: 'role_specificity',
      pass: true,
      detail: 'no specific expectation',
    });
  }

  // 5. school_expansion
  if (tc.id === 26) {
    // MIT grads at Google
    const schools = lf.schools as string[] | undefined;
    const hasFullName = schools?.some(s => s.toLowerCase().includes('massachusetts institute of technology'));
    results.push({
      type: 'school_expansion',
      pass: !!hasFullName,
      detail: `schools=${JSON.stringify(schools)}`,
    });
  } else {
    results.push({
      type: 'school_expansion',
      pass: true,
      detail: 'n/a',
    });
  }

  // 6. location_expansion
  if (tc.id === 34) {
    // "not in California" -- check exclude_locations
    const excludeLocs = lf.exclude_locations as string[] | undefined;
    const hasCA = excludeLocs?.some(l => l.toLowerCase().includes('california'));
    results.push({
      type: 'location_expansion',
      pass: !!hasCA,
      detail: `exclude_locations=${JSON.stringify(excludeLocs)}`,
    });
  } else {
    results.push({
      type: 'location_expansion',
      pass: true,
      detail: 'n/a',
    });
  }

  // 7. no_company_in_searchquery
  if (tc.check_no_company_in_sq) {
    const sq = lf.search_query as string | undefined;
    const company = (output.filters?.company || '').toLowerCase();
    let pass = true;
    if (sq && company && company.length > 2) {
      pass = !sq.toLowerCase().includes(company);
    }
    results.push({
      type: 'no_company_in_searchquery',
      pass,
      detail: `search_query="${sq || ''}", company="${company}"`,
    });
  } else {
    results.push({
      type: 'no_company_in_searchquery',
      pass: true,
      detail: 'n/a',
    });
  }

  // 8. message_appropriate
  const msg = (output.message || '').toLowerCase();
  let messagePass = false;
  let messageDetail = '';

  switch (tc.message_check) {
    case 'high_confidence':
      // Should NOT mention "broad", "keyword", "approximate", "noise"
      messagePass = !msg.includes('broad') && !msg.includes('keyword search') && msg.length > 5;
      messageDetail = `high confidence message check. msg="${output.message}"`;
      break;
    case 'medium_keyword':
      // Should mention "broad" or "keyword" or "mention"
      messagePass = msg.includes('broad') || msg.includes('keyword') || msg.includes('mention');
      messageDetail = `medium keyword message check. msg="${output.message}"`;
      break;
    case 'off_topic':
      messagePass = msg.includes('find') || msg.includes('professional') || msg.includes('help') || msg.includes('try');
      messageDetail = `off-topic message check. msg="${output.message}"`;
      break;
    case 'na':
      messagePass = true;
      messageDetail = 'n/a';
      break;
  }

  results.push({
    type: 'message_appropriate',
    pass: messagePass,
    detail: messageDetail,
  });

  return results;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callV2(userInput: string, maxRetries = 3): Promise<{ output: LLMOutput; durationMs: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const start = Date.now();
      const response = await completeJsonAnthropic<LLMOutput>({
        systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT_V2,
        userPrompt: `New user message: ${userInput}`,
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.1,
        maxTokens: 800,
      });
      return { output: response.content, durationMs: Date.now() - start };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('429') && attempt < maxRetries) {
        const backoff = (attempt + 1) * 15000; // 15s, 30s, 45s
        console.log(` [rate limited, retry in ${backoff / 1000}s]`);
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw new Error('Unreachable');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outputDir = join(__dirname);
  const jsonlPath = join(outputDir, 'final-validation-results.jsonl');
  const reportPath = join(outputDir, 'final-validation-report.md');

  // Clear previous results
  await writeFile(jsonlPath, '', 'utf-8');

  console.log(`\n=== FINAL VALIDATION: v2 Prompt (${TEST_CASES.length} cases) ===\n`);

  // Track results
  const allResults: Array<{
    case_id: number;
    category: string;
    input: string;
    output: LLMOutput | null;
    error: string | null;
    duration_ms: number;
    checks: CheckResult[];
  }> = [];

  // Per-check-type aggregation
  const checkTypeCounts: Record<CheckType, { pass: number; fail: number }> = {
    status_correct: { pass: 0, fail: 0 },
    title_routing: { pass: 0, fail: 0 },
    seniority_handling: { pass: 0, fail: 0 },
    role_specificity: { pass: 0, fail: 0 },
    school_expansion: { pass: 0, fail: 0 },
    location_expansion: { pass: 0, fail: 0 },
    no_company_in_searchquery: { pass: 0, fail: 0 },
    message_appropriate: { pass: 0, fail: 0 },
  };

  let totalDuration = 0;
  const durations: number[] = [];
  let errorCount = 0;
  let criticalSeniorityFailures: Array<{ id: number; input: string; detail: string }> = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    // Small delay between calls to stay under rate limits (50k input tokens/min)
    if (i > 0) await sleep(2000);

    process.stdout.write(`  Case ${tc.id} [${tc.category}]: "${tc.input.substring(0, 55)}"...`);

    let output: LLMOutput | null = null;
    let error: string | null = null;
    let durationMs = 0;

    try {
      const result = await callV2(tc.input);
      output = result.output;
      durationMs = result.durationMs;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      errorCount++;
      console.log(` ERROR: ${error}`);
    }

    let checks: CheckResult[] = [];

    if (output) {
      checks = evaluateChecks(tc, output);

      const allPass = checks.every(c => c.pass);
      const failedChecks = checks.filter(c => !c.pass);

      if (allPass) {
        console.log(` PASS (${durationMs}ms)`);
      } else {
        console.log(` FAIL (${durationMs}ms)`);
        for (const fc of failedChecks) {
          console.log(`    [${fc.type}] ${fc.detail}`);
        }
      }

      // Track per-check-type
      for (const c of checks) {
        if (c.pass) {
          checkTypeCounts[c.type].pass++;
        } else {
          checkTypeCounts[c.type].fail++;
          // Track critical seniority failures
          if (c.type === 'seniority_handling' && tc.seniority_check === 'no_120_110_inclusion') {
            criticalSeniorityFailures.push({ id: tc.id, input: tc.input, detail: c.detail });
          }
        }
      }

      totalDuration += durationMs;
      durations.push(durationMs);
    } else {
      // All checks fail for errored cases
      const checkTypes: CheckType[] = ['status_correct', 'title_routing', 'seniority_handling', 'role_specificity', 'school_expansion', 'location_expansion', 'no_company_in_searchquery', 'message_appropriate'];
      checks = checkTypes.map(t => ({ type: t, pass: false, detail: `ERROR: ${error}` }));
      for (const c of checks) {
        checkTypeCounts[c.type].fail++;
      }
    }

    // Log to JSONL
    const logEntry = {
      case_id: tc.id,
      category: tc.category,
      input: tc.input,
      output,
      error,
      duration_ms: durationMs,
      checks,
    };
    allResults.push(logEntry);
    await appendFile(jsonlPath, JSON.stringify(logEntry) + '\n', 'utf-8');
  }

  // ─── Generate Report ─────────────────────────────────────────────────────────

  console.log('\n\nGenerating report...\n');

  // Sort durations for percentiles
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
  const maxLatency = durations[durations.length - 1] || 0;
  const avgLatency = durations.length > 0 ? Math.round(totalDuration / durations.length) : 0;

  // Count overall pass/fail
  let totalChecks = 0;
  let totalPassed = 0;
  for (const ct of Object.values(checkTypeCounts)) {
    totalChecks += ct.pass + ct.fail;
    totalPassed += ct.pass;
  }

  // Build report
  let report = `# Final Validation Report: v2 Search Extraction Prompt\n\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Test cases:** ${TEST_CASES.length}\n`;
  report += `**Errors:** ${errorCount}\n\n`;

  report += `## Overall Results\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Total checks | ${totalChecks} |\n`;
  report += `| Passed | ${totalPassed} |\n`;
  report += `| Failed | ${totalChecks - totalPassed} |\n`;
  report += `| Overall pass rate | ${((totalPassed / totalChecks) * 100).toFixed(1)}% |\n\n`;

  report += `## Per-Check Pass Rates\n\n`;
  report += `| Check Type | Pass | Fail | Rate |\n`;
  report += `|------------|------|------|------|\n`;

  let anyCheckBelow90 = false;

  for (const [checkType, counts] of Object.entries(checkTypeCounts)) {
    const total = counts.pass + counts.fail;
    const rate = total > 0 ? ((counts.pass / total) * 100).toFixed(1) : 'N/A';
    const marker = Number(rate) < 90 ? ' **BELOW 90%**' : '';
    if (Number(rate) < 90) anyCheckBelow90 = true;
    report += `| ${checkType} | ${counts.pass} | ${counts.fail} | ${rate}%${marker} |\n`;
  }

  report += `\n## Latency\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| Average | ${avgLatency}ms |\n`;
  report += `| p50 | ${p50}ms |\n`;
  report += `| p95 | ${p95}ms |\n`;
  report += `| p99 | ${p99}ms |\n`;
  report += `| Max | ${maxLatency}ms |\n\n`;

  const slowQueries = allResults.filter(r => r.duration_ms > 500);
  if (slowQueries.length > 0) {
    report += `### Slow queries (>500ms)\n\n`;
    for (const sq of slowQueries) {
      report += `- Case ${sq.case_id}: "${sq.input}" -- ${sq.duration_ms}ms\n`;
    }
    report += '\n';
  }

  report += `## Seniority Handling (CRITICAL)\n\n`;
  if (criticalSeniorityFailures.length === 0) {
    report += `All seniority cases where 120/110 should NOT be used as inclusion PASSED.\n\n`;
  } else {
    report += `**CRITICAL FAILURES:**\n\n`;
    for (const f of criticalSeniorityFailures) {
      report += `- Case ${f.id}: "${f.input}" -- ${f.detail}\n`;
    }
    report += '\n';
  }

  report += `## Failed Cases Detail\n\n`;

  const failedCases = allResults.filter(r => r.checks.some(c => !c.pass));
  if (failedCases.length === 0) {
    report += `No failures.\n\n`;
  } else {
    for (const fc of failedCases) {
      const failedChecks = fc.checks.filter(c => !c.pass);
      report += `### Case ${fc.case_id}: "${fc.input}"\n`;
      report += `- Category: ${fc.category}\n`;
      report += `- Duration: ${fc.duration_ms}ms\n`;
      for (const check of failedChecks) {
        report += `- **FAIL [${check.type}]**: ${check.detail}\n`;
      }
      if (fc.output) {
        report += `- Output status: ${fc.output.status}\n`;
        report += `- Output filters: ${JSON.stringify(fc.output.linkedin_filters, null, 2)}\n`;
      }
      if (fc.error) {
        report += `- Error: ${fc.error}\n`;
      }
      report += '\n';
    }
  }

  report += `## Per-Category Results\n\n`;

  const categories = [...new Set(TEST_CASES.map(tc => tc.category))];
  for (const cat of categories) {
    const catResults = allResults.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.checks.every(c => c.pass)).length;
    const catTotal = catResults.length;
    report += `- **${cat}**: ${catPassed}/${catTotal} cases fully passed (${((catPassed / catTotal) * 100).toFixed(0)}%)\n`;
  }

  report += `\n## Verdict\n\n`;

  const hasCriticalSeniorityFailure = criticalSeniorityFailures.length > 0;
  const overallRate = (totalPassed / totalChecks) * 100;

  if (!hasCriticalSeniorityFailure && !anyCheckBelow90 && overallRate >= 90) {
    report += `**PRODUCTION READY**\n\n`;
    report += `- Overall pass rate: ${overallRate.toFixed(1)}% (>= 90%)\n`;
    report += `- All check types above 90%\n`;
    report += `- No critical seniority handling failures\n`;
    report += `- p95 latency: ${p95}ms\n`;
  } else {
    report += `**NEEDS MORE WORK**\n\n`;
    if (hasCriticalSeniorityFailure) {
      report += `- CRITICAL: ${criticalSeniorityFailures.length} seniority handling failure(s) detected\n`;
    }
    if (anyCheckBelow90) {
      report += `- Some check types below 90% pass rate:\n`;
      for (const [checkType, counts] of Object.entries(checkTypeCounts)) {
        const total = counts.pass + counts.fail;
        const rate = total > 0 ? (counts.pass / total) * 100 : 100;
        if (rate < 90) {
          report += `  - ${checkType}: ${rate.toFixed(1)}%\n`;
        }
      }
    }
    if (overallRate < 90) {
      report += `- Overall pass rate ${overallRate.toFixed(1)}% is below 90%\n`;
    }
  }

  await writeFile(reportPath, report, 'utf-8');

  console.log(`\n=== RESULTS ===\n`);
  console.log(`Total checks: ${totalChecks}`);
  console.log(`Passed: ${totalPassed} (${((totalPassed / totalChecks) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${totalChecks - totalPassed}`);
  console.log(`Critical seniority failures: ${criticalSeniorityFailures.length}`);
  console.log(`\nReport written to: ${reportPath}`);
  console.log(`JSONL written to: ${jsonlPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
