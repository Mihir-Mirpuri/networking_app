/**
 * Unsupported Query Steering -- QA Test Suite
 *
 * Validates that the Haiku extraction prompt correctly:
 * 1. Returns status: "unsupported" for queries with hard-unsupported criteria
 * 2. Returns status: "ready" for queries with industry terms (soft-unsupported -> searchQuery)
 * 3. Does NOT regress on existing statuses (ready, off_topic, person_lookup, needs_selection)
 * 4. Builds correct suggested_alternative with valid, executable filters
 * 5. Lists unsupported_criteria accurately
 *
 * Cost: ~$0.005 per query (Haiku only, no Apify). ~$0.20 for the full suite.
 *
 * Usage:
 *   npx tsx tests/unsupported-steering-qa.ts
 *   npx tsx tests/unsupported-steering-qa.ts --limit=5
 *   npx tsx tests/unsupported-steering-qa.ts --verbose
 */

import 'dotenv/config';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';
import { completeJsonAnthropic } from '../src/lib/services/anthropic';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const verbose = args.includes('--verbose');

// ─── LLM Response Schema ─────────────────────────────────────────────────────

interface LLMResponse {
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup' | 'unsupported';
  confidence?: 'high' | 'medium' | 'low';
  role_specificity?: 'narrow' | 'standard' | 'broad';
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  linkedin_filters: {
    search_query?: string;
    locations?: string[];
    current_companies?: string[];
    past_companies?: string[];
    schools?: string[];
    current_job_titles?: string[];
    past_job_titles?: string[];
    seniority_level_ids?: string[];
    function_ids?: string[];
    company_headcount?: string[];
    years_of_experience_ids?: string[];
    years_at_current_company_ids?: string[];
    recently_changed_jobs?: boolean;
    exclude_locations?: string[];
    exclude_current_companies?: string[];
    exclude_seniority_level_ids?: string[];
    exclude_function_ids?: string[];
  };
  unsupported_criteria?: string[];
  suggested_alternative?: {
    label: string;
    filters: {
      company: string | null;
      role: string | null;
      university: string | null;
      location: string | null;
    };
    linkedin_filters: LLMResponse['linkedin_filters'];
  };
  company_name_ambiguous?: boolean;
  person_name?: string | null;
  person_company?: string | null;
  selectables?: Array<{ label: string; filter_key: string; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}

// ─── Test Case Definitions ────────────────────────────────────────────────────

type ExpectedStatus = 'unsupported' | 'ready' | 'off_topic' | 'person_lookup' | 'needs_selection';

interface TestCase {
  id: string;
  query: string;
  category: string;
  expectedStatus: ExpectedStatus;
  /**
   * For unsupported: at least ONE of these substrings must appear (case-insensitive)
   * in the joined unsupported_criteria array. Uses OR logic -- the LLM may use
   * any reasonable phrasing as long as it captures the concept.
   */
  expectUnsupportedContainsAny?: string[];
  /** For unsupported: the suggested_alternative should preserve these filter keys */
  expectSuggestedPreserves?: {
    company?: string;
    role?: string;
    location?: string;
    university?: string;
  };
  /** For unsupported: suggested_alternative.linkedin_filters should contain these keys */
  expectSuggestedLinkedInHas?: string[];
  /** For ready: searchQuery should contain this substring (case-insensitive) */
  expectSearchQueryContains?: string;
  /** For ready: filters.company should be this value */
  expectCompany?: string;
  /** For ready: filters.role should contain this substring */
  expectRoleContains?: string;
  /** For person_lookup: person_name should be set */
  expectPersonName?: string;
  /** Allow either of two statuses (for edge cases) */
  allowAlternateStatus?: ExpectedStatus;
  /** Notes about this test case for the log */
  notes?: string;
}

// ─── HARD UNSUPPORTED tests ──────────────────────────────────────────────────

const UNSUPPORTED_TESTS: TestCase[] = [
  {
    id: 'unsup-01-phd',
    query: 'PhD engineers at Google',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['phd'],
    expectSuggestedPreserves: { company: 'Google' },
  },
  {
    id: 'unsup-02-remote',
    query: 'remote data scientists in NYC',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['remote'],
  },
  {
    id: 'unsup-03-salary',
    query: 'engineers making $200k+ at Meta',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['salary', 'compensation', '$200k'],
    expectSuggestedPreserves: { company: 'Meta' },
  },
  {
    id: 'unsup-04-cfa',
    query: 'CFA analysts at Goldman Sachs',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['cfa', 'certif'],
    expectSuggestedPreserves: { company: 'Goldman Sachs' },
  },
  {
    id: 'unsup-05-h1b',
    query: 'H1B engineers at Google',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['h1b', 'visa'],
    expectSuggestedPreserves: { company: 'Google' },
  },
  {
    id: 'unsup-06-aws-cert',
    query: 'AWS certified DevOps at Amazon',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['aws', 'certif'],
    expectSuggestedPreserves: { company: 'Amazon' },
  },
  {
    id: 'unsup-07-series-b',
    query: 'Series B startup engineers in SF',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['series b', 'funding'],
    expectSuggestedLinkedInHas: ['company_headcount'],
  },
  {
    id: 'unsup-08-hiring',
    query: 'engineers at companies that are hiring',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['hiring'],
  },
  {
    id: 'unsup-09-hybrid',
    query: 'hybrid PMs at Stripe',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['hybrid'],
    expectSuggestedPreserves: { company: 'Stripe' },
  },
  {
    id: 'unsup-10-connections',
    query: 'well-connected VPs at Google',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['connect'],
    expectSuggestedPreserves: { company: 'Google' },
  },
  // Additional hard unsupported
  {
    id: 'unsup-11-masters',
    query: 'Masters degree engineers at Apple',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['masters', 'degree'],
    expectSuggestedPreserves: { company: 'Apple' },
  },
  {
    id: 'unsup-12-wfh',
    query: 'work from home PMs at Salesforce',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['remote', 'work from home'],
    expectSuggestedPreserves: { company: 'Salesforce' },
  },
  {
    id: 'unsup-13-cpa',
    query: 'CPA accountants at Deloitte',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['cpa', 'certif'],
    expectSuggestedPreserves: { company: 'Deloitte' },
  },
  {
    id: 'unsup-14-pmp',
    query: 'PMP project managers at Microsoft',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['pmp', 'certif'],
    expectSuggestedPreserves: { company: 'Microsoft' },
  },
  {
    id: 'unsup-15-open-to-work',
    query: 'open to work designers at Meta',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['hiring', 'open to work', 'open role'],
    expectSuggestedPreserves: { company: 'Meta' },
  },
  {
    id: 'unsup-16-thought-leader',
    query: 'thought leaders in marketing at HubSpot',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['thought leader', 'connect', 'influencer', 'influence'],
    expectSuggestedPreserves: { company: 'HubSpot' },
  },
  {
    id: 'unsup-17-pre-ipo',
    query: 'pre-IPO startup engineers',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['pre-ipo', 'ipo', 'funding'],
  },
  {
    id: 'unsup-18-doctorate',
    query: 'doctorate researchers at MIT Lincoln Lab',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['doctor', 'phd', 'degree'],
  },
  {
    id: 'unsup-19-sponsorship',
    query: 'engineers with visa sponsorship at Netflix',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['visa', 'sponsor'],
    expectSuggestedPreserves: { company: 'Netflix' },
  },
  {
    id: 'unsup-20-board-certified',
    query: 'board certified doctors at Mayo Clinic',
    category: 'hard_unsupported',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['board certified', 'certif'],
  },
];

// ─── SOFT UNSUPPORTED / INDUSTRY TERMS (should be "ready") ──────────────────

const INDUSTRY_TERM_TESTS: TestCase[] = [
  {
    id: 'ind-01-fintech',
    query: 'fintech PMs at Stripe',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'fintech',
    expectCompany: 'Stripe',
  },
  {
    id: 'ind-02-biotech',
    query: 'biotech researchers in Boston',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'biotech',
  },
  {
    id: 'ind-03-healthtech',
    query: 'healthtech engineers at Google',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'healthtech',
    expectCompany: 'Google',
  },
  {
    id: 'ind-04-edtech',
    query: 'edtech designers at Coursera',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'edtech',
    expectCompany: 'Coursera',
  },
  {
    id: 'ind-05-cleantech',
    query: 'cleantech engineers at Tesla',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'cleantech',
    expectCompany: 'Tesla',
  },
  {
    id: 'ind-06-proptech',
    query: 'proptech PMs at Zillow',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'proptech',
    expectCompany: 'Zillow',
  },
  {
    id: 'ind-07-insurtech',
    query: 'insurtech analysts at Lemonade',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'insurtech',
    expectCompany: 'Lemonade',
  },
  {
    id: 'ind-08-martech',
    query: 'martech engineers at Adobe',
    category: 'industry_term',
    expectedStatus: 'ready',
    expectSearchQueryContains: 'martech',
    expectCompany: 'Adobe',
  },
];

// ─── REGRESSION tests (existing statuses must still work) ────────────────────

const REGRESSION_TESTS: TestCase[] = [
  {
    id: 'reg-01-swe-google',
    query: 'software engineers at Google',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Google',
  },
  {
    id: 'reg-02-pm-meta-nyc',
    query: 'PMs at Meta in NYC',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Meta',
  },
  {
    id: 'reg-03-weather',
    query: "how's the weather?",
    category: 'regression_off_topic',
    expectedStatus: 'off_topic',
  },
  {
    id: 'reg-04-person-lookup',
    query: 'Find John Smith at Google',
    category: 'regression_person_lookup',
    expectedStatus: 'person_lookup',
    expectPersonName: 'John Smith',
  },
  {
    id: 'reg-05-designers-figma',
    query: 'designers at Figma',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Figma',
  },
  {
    id: 'reg-06-directors-amazon',
    query: 'directors at Amazon',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Amazon',
  },
  {
    id: 'reg-07-consultants-mckinsey',
    query: 'consultants at McKinsey',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'McKinsey',
  },
  {
    id: 'reg-08-senior-eng-uber',
    query: 'senior engineers at Uber',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Uber',
  },
  {
    id: 'reg-09-vps-google',
    query: 'VPs at Google',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Google',
  },
  {
    id: 'reg-10-mit-stripe',
    query: 'MIT grads at Stripe',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Stripe',
  },
  {
    id: 'reg-11-mbb',
    query: 'consultants at MBB',
    category: 'regression_needs_selection',
    expectedStatus: 'needs_selection',
  },
  {
    id: 'reg-12-people-notion',
    query: 'people at Notion',
    category: 'regression_ready_no_role',
    expectedStatus: 'ready',
    expectCompany: 'Notion',
    notes: 'No role specified, linkedin_filters may be empty (company URL resolved downstream)',
  },
  {
    id: 'reg-13-recently-joined',
    query: 'people who recently joined Stripe',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Stripe',
  },
  {
    id: 'reg-14-ex-google-anthropic',
    query: 'ex-Google engineers now at Anthropic',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Anthropic',
  },
  {
    id: 'reg-15-quant-citadel',
    query: 'quantitative researchers at Citadel',
    category: 'regression_ready',
    expectedStatus: 'ready',
    expectCompany: 'Citadel',
  },
];

// ─── EDGE CASES ──────────────────────────────────────────────────────────────

const EDGE_CASE_TESTS: TestCase[] = [
  {
    id: 'edge-01-mba-consultants',
    query: 'MBA consultants at McKinsey',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    allowAlternateStatus: 'ready',
    expectUnsupportedContainsAny: ['mba', 'degree'],
    notes: 'MBA is a degree type, so should be unsupported. But "consultants at McKinsey" is valid.',
  },
  {
    id: 'edge-02-stanford-mba-pm',
    query: 'Stanford MBA PMs at Google',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    allowAlternateStatus: 'ready',
    expectUnsupportedContainsAny: ['mba', 'degree'],
    notes: 'Should keep Stanford as school filter, drop MBA. Suggested alt should have schools.',
  },
  {
    id: 'edge-03-senior-remote',
    query: 'senior remote engineers at Uber',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['remote'],
    expectSuggestedPreserves: { company: 'Uber' },
    notes: 'Remote is hard unsupported. Senior + engineers at Uber should be in suggested alt.',
  },
  {
    id: 'edge-04-fintech-series-b',
    query: 'fintech Series B startup PMs in NYC',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['series b', 'funding'],
    notes: 'Series B is hard unsupported. Fintech should go to searchQuery in suggested alt.',
  },
  {
    id: 'edge-05-multiple-unsupported',
    query: 'remote PhD engineers making $200k at Google',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['remote', 'phd'],
    expectSuggestedPreserves: { company: 'Google' },
    notes: 'Multiple hard unsupported criteria. All should be listed.',
  },
  {
    id: 'edge-06-in-office',
    query: 'in-office data scientists at Meta in NYC',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['in-office', 'office', 'work mode'],
    expectSuggestedPreserves: { company: 'Meta' },
    notes: 'in-office is a work arrangement filter, should be unsupported.',
  },
  {
    id: 'edge-07-bs-degree',
    query: 'BS CS engineers at Apple',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['bs', 'degree'],
    expectSuggestedPreserves: { company: 'Apple' },
    notes: 'BS is a degree type.',
  },
  {
    id: 'edge-08-seed-stage',
    query: 'seed stage startup PMs',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['seed', 'funding'],
    notes: 'Seed stage is funding-related, hard unsupported.',
  },
  {
    id: 'edge-09-undergrad',
    query: 'undergrad interns at Google',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    allowAlternateStatus: 'ready',
    expectUnsupportedContainsAny: ['undergrad', 'degree'],
    notes: 'Undergrad is degree type. Interns at Google is valid.',
  },
  {
    id: 'edge-10-earning',
    query: 'engineers earning over $300k at Netflix',
    category: 'edge_case',
    expectedStatus: 'unsupported',
    expectUnsupportedContainsAny: ['salary', 'earning', 'compensation', '$300k', '$'],
    expectSuggestedPreserves: { company: 'Netflix' },
  },
];

// ─── All Tests ────────────────────────────────────────────────────────────────

const ALL_TESTS: TestCase[] = [
  ...UNSUPPORTED_TESTS,
  ...INDUSTRY_TERM_TESTS,
  ...EDGE_CASE_TESTS,
  ...REGRESSION_TESTS,
];

// ─── Test Runner ─────────────────────────────────────────────────────────────

interface TestResult {
  test: TestCase;
  passed: boolean;
  failures: string[];
  response: LLMResponse | null;
  durationMs: number;
  error?: string;
}

/** The hard unsupported criteria keywords that should NEVER appear in suggested_alternative linkedin_filters */
const HARD_UNSUPPORTED_LEAK_KEYWORDS = [
  'phd', 'masters', 'mba', 'doctorate', 'degree', 'undergrad',
  'salary', 'compensation', '$', 'earning', 'making', 'paying',
  'remote', 'hybrid', 'wfh', 'work from home', 'in-office',
  'visa', 'h1b', 'sponsorship',
  'hiring', 'open to work', 'open roles', 'recruiting',
  'certified', 'cfa', 'cpa', 'pmp', 'aws certified', 'board certified',
  'well-connected', 'connections', 'thought leader', 'influencer',
];

function checkForUnsupportedLeaks(linkedinFilters: LLMResponse['linkedin_filters']): string[] {
  const leaks: string[] = [];
  const searchQuery = (linkedinFilters.search_query || '').toLowerCase();
  for (const kw of HARD_UNSUPPORTED_LEAK_KEYWORDS) {
    if (searchQuery.includes(kw)) {
      leaks.push(`search_query contains unsupported keyword "${kw}": "${linkedinFilters.search_query}"`);
    }
  }
  // Check current_job_titles for leaked unsupported terms
  for (const title of linkedinFilters.current_job_titles || []) {
    const lower = title.toLowerCase();
    for (const kw of HARD_UNSUPPORTED_LEAK_KEYWORDS) {
      if (lower.includes(kw)) {
        leaks.push(`current_job_titles contains unsupported keyword "${kw}": "${title}"`);
      }
    }
  }
  return leaks;
}

async function runTest(test: TestCase): Promise<TestResult> {
  const failures: string[] = [];
  let response: LLMResponse | null = null;
  const start = Date.now();

  try {
    const result = await completeJsonAnthropic<LLMResponse>({
      systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: `New user message: ${test.query}`,
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxTokens: 512,
    });
    response = result.content;
    const durationMs = Date.now() - start;

    // ── Check 1: Status ──
    const statusMatches = response.status === test.expectedStatus;
    const altStatusMatches = test.allowAlternateStatus && response.status === test.allowAlternateStatus;
    if (!statusMatches && !altStatusMatches) {
      failures.push(`STATUS: expected "${test.expectedStatus}"${test.allowAlternateStatus ? ` or "${test.allowAlternateStatus}"` : ''}, got "${response.status}"`);
    }

    // ── Check 2: unsupported_criteria (OR logic -- any keyword match = pass) ──
    if (response.status === 'unsupported' && test.expectUnsupportedContainsAny) {
      if (!response.unsupported_criteria || response.unsupported_criteria.length === 0) {
        failures.push('UNSUPPORTED_CRITERIA: array is empty or missing');
      } else {
        const allCriteriaText = response.unsupported_criteria.map(c => c.toLowerCase()).join(' | ');
        const anyMatch = test.expectUnsupportedContainsAny.some(expected =>
          allCriteriaText.includes(expected.toLowerCase())
        );
        if (!anyMatch) {
          failures.push(`UNSUPPORTED_CRITERIA: [${response.unsupported_criteria.join(', ')}] does not contain any of [${test.expectUnsupportedContainsAny.join(', ')}]`);
        }
      }
    }

    // ── Check 3: suggested_alternative preserves supported filters ──
    if (response.status === 'unsupported' && test.expectSuggestedPreserves) {
      if (!response.suggested_alternative) {
        failures.push('SUGGESTED_ALT: missing suggested_alternative');
      } else {
        const alt = response.suggested_alternative;
        for (const [key, expectedVal] of Object.entries(test.expectSuggestedPreserves)) {
          const actualVal = alt.filters[key as keyof typeof alt.filters];
          if (!actualVal) {
            failures.push(`SUGGESTED_ALT: filters.${key} is null, expected "${expectedVal}"`);
          } else if (!actualVal.toLowerCase().includes(expectedVal.toLowerCase())) {
            failures.push(`SUGGESTED_ALT: filters.${key} = "${actualVal}", expected to contain "${expectedVal}"`);
          }
        }
      }
    }

    // ── Check 4: suggested_alternative.linkedin_filters has expected keys ──
    if (response.status === 'unsupported' && test.expectSuggestedLinkedInHas) {
      if (!response.suggested_alternative) {
        failures.push('SUGGESTED_ALT_LINKEDIN: missing suggested_alternative');
      } else {
        const altLF = response.suggested_alternative.linkedin_filters;
        for (const key of test.expectSuggestedLinkedInHas) {
          const val = (altLF as Record<string, unknown>)[key];
          if (val === undefined || val === null || (Array.isArray(val) && val.length === 0)) {
            failures.push(`SUGGESTED_ALT_LINKEDIN: expected key "${key}" to be set, but it's missing/empty`);
          }
        }
      }
    }

    // ── Check 5: No unsupported criteria leaked into suggested_alternative linkedin_filters ──
    if (response.status === 'unsupported' && response.suggested_alternative) {
      const leaks = checkForUnsupportedLeaks(response.suggested_alternative.linkedin_filters);
      for (const leak of leaks) {
        failures.push(`LEAK: ${leak}`);
      }
    }

    // ── Check 6: suggested_alternative.label is non-empty ──
    if (response.status === 'unsupported') {
      if (!response.suggested_alternative?.label) {
        failures.push('SUGGESTED_ALT: label is empty or missing');
      }
    }

    // ── Check 7: message is non-empty and mentions what was dropped ──
    if (response.status === 'unsupported') {
      if (!response.message || response.message.trim().length === 0) {
        failures.push('MESSAGE: empty message for unsupported status');
      }
    }

    // ── Check 8: For ready status, verify searchQuery contains expected industry term ──
    if (response.status === 'ready' && test.expectSearchQueryContains) {
      const sq = (response.linkedin_filters.search_query || '').toLowerCase();
      if (!sq.includes(test.expectSearchQueryContains.toLowerCase())) {
        failures.push(`SEARCH_QUERY: expected to contain "${test.expectSearchQueryContains}", got "${response.linkedin_filters.search_query || '(empty)'}"`);
      }
    }

    // ── Check 9: For ready status, verify company ──
    if (response.status === 'ready' && test.expectCompany) {
      const company = (response.filters.company || '').toLowerCase();
      if (!company.includes(test.expectCompany.toLowerCase())) {
        failures.push(`COMPANY: expected "${test.expectCompany}", got "${response.filters.company}"`);
      }
    }

    // ── Check 10: For person_lookup, verify person_name ──
    if (response.status === 'person_lookup' && test.expectPersonName) {
      const pn = (response.person_name || '').toLowerCase();
      if (!pn.includes(test.expectPersonName.toLowerCase())) {
        failures.push(`PERSON_NAME: expected "${test.expectPersonName}", got "${response.person_name}"`);
      }
    }

    // ── Check 11: For ready with industry term, confidence should be medium ──
    if (response.status === 'ready' && test.category === 'industry_term') {
      if (response.confidence !== 'medium') {
        // This is a soft check -- log but don't fail
        if (verbose) {
          console.log(`    [INFO] confidence = "${response.confidence}", expected "medium" for industry term`);
        }
      }
    }

    // ── Check 12: For ready status, linkedin_filters should NOT be empty ──
    if (response.status === 'ready' && test.category === 'regression_ready') {
      const hasAnyFilter = Object.values(response.linkedin_filters).some(v =>
        v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== false
      );
      if (!hasAnyFilter) {
        failures.push('LINKEDIN_FILTERS: empty linkedin_filters for ready status');
      }
    }

    // ── Check 13: For needs_selection, verify selectables exist ──
    if (response.status === 'needs_selection') {
      if (!response.selectables || response.selectables.length < 2) {
        failures.push(`SELECTABLES: expected 2+ selectables, got ${response.selectables?.length || 0}`);
      }
    }

    return { test, passed: failures.length === 0, failures, response, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    failures.push(`ERROR: ${errorMsg}`);
    return { test, passed: false, failures, response, durationMs, error: errorMsg };
  }
}

// ─── Report Generation ───────────────────────────────────────────────────────

function generateReport(results: TestResult[]): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  lines.push('# Unsupported Query Steering -- QA Report');
  lines.push(`\nGenerated: ${timestamp}`);
  lines.push(`Total tests: ${results.length}`);
  lines.push(`Passed: ${passed} (${Math.round(passed / results.length * 100)}%)`);
  lines.push(`Failed: ${failed}`);
  lines.push(`Total time: ${(totalMs / 1000).toFixed(1)}s`);
  lines.push(`Avg latency: ${Math.round(totalMs / results.length)}ms`);

  // Category breakdown
  const categories = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const cat = r.test.category;
    if (!categories.has(cat)) categories.set(cat, { total: 0, passed: 0 });
    const c = categories.get(cat)!;
    c.total++;
    if (r.passed) c.passed++;
  }

  lines.push('\n## Category Breakdown\n');
  lines.push('| Category | Total | Passed | Rate |');
  lines.push('|----------|------:|-------:|-----:|');
  for (const [cat, counts] of categories) {
    lines.push(`| ${cat} | ${counts.total} | ${counts.passed} | ${Math.round(counts.passed / counts.total * 100)}% |`);
  }

  // Pass/Fail table
  lines.push('\n## Results\n');
  lines.push('| ID | Query | Expected | Got | Result |');
  lines.push('|----|-------|----------|-----|--------|');
  for (const r of results) {
    const status = r.response?.status || 'ERROR';
    const mark = r.passed ? 'PASS' : 'FAIL';
    const query = r.test.query.length > 45 ? r.test.query.slice(0, 42) + '...' : r.test.query;
    lines.push(`| ${r.test.id} | ${query} | ${r.test.expectedStatus} | ${status} | ${mark} |`);
  }

  // Failure details
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    lines.push('\n## Failure Details\n');
    for (const r of failures) {
      lines.push(`### ${r.test.id}: \`${r.test.query}\``);
      lines.push(`- **Expected**: ${r.test.expectedStatus}${r.test.allowAlternateStatus ? ` or ${r.test.allowAlternateStatus}` : ''}`);
      lines.push(`- **Got**: ${r.response?.status || 'ERROR'}`);
      for (const f of r.failures) {
        lines.push(`- ${f}`);
      }
      if (r.response?.unsupported_criteria?.length) {
        lines.push(`- **unsupported_criteria**: ${JSON.stringify(r.response.unsupported_criteria)}`);
      }
      if (r.response?.suggested_alternative) {
        lines.push(`- **suggested_alternative.label**: "${r.response.suggested_alternative.label}"`);
        lines.push(`- **suggested_alternative.filters**: ${JSON.stringify(r.response.suggested_alternative.filters)}`);
        lines.push(`- **suggested_alternative.linkedin_filters**: ${JSON.stringify(r.response.suggested_alternative.linkedin_filters)}`);
      }
      if (r.response?.message) {
        lines.push(`- **message**: "${r.response.message}"`);
      }
      if (r.test.notes) {
        lines.push(`- **notes**: ${r.test.notes}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── JSONL Logging ───────────────────────────────────────────────────────────

interface LogEntry {
  case_id: number;
  test_id: string;
  category: string;
  query: string;
  expected_status: string;
  actual_status: string | null;
  passed: boolean;
  failures: string[];
  duration_ms: number;
  response: {
    status: string | null;
    confidence: string | null;
    unsupported_criteria: string[] | null;
    suggested_alternative_label: string | null;
    suggested_alternative_filters: Record<string, unknown> | null;
    suggested_alternative_linkedin_filters: Record<string, unknown> | null;
    search_query: string | null;
    filters: Record<string, unknown> | null;
    message: string | null;
  };
  error?: string;
}

function buildLogEntry(result: TestResult, index: number): LogEntry {
  return {
    case_id: index + 1,
    test_id: result.test.id,
    category: result.test.category,
    query: result.test.query,
    expected_status: result.test.expectedStatus,
    actual_status: result.response?.status || null,
    passed: result.passed,
    failures: result.failures,
    duration_ms: result.durationMs,
    response: {
      status: result.response?.status || null,
      confidence: result.response?.confidence || null,
      unsupported_criteria: result.response?.unsupported_criteria || null,
      suggested_alternative_label: result.response?.suggested_alternative?.label || null,
      suggested_alternative_filters: result.response?.suggested_alternative?.filters || null,
      suggested_alternative_linkedin_filters: result.response?.suggested_alternative?.linkedin_filters || null,
      search_query: result.response?.linkedin_filters?.search_query || null,
      filters: result.response?.filters || null,
      message: result.response?.message || null,
    },
    error: result.error,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tests = ALL_TESTS.slice(0, limit);
  console.log(`\nRunning ${tests.length} unsupported-steering QA tests...\n`);

  const results: TestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const test of tests) {
    process.stdout.write(`  ${test.id} "${test.query}" ... `);
    const result = await runTest(test);
    results.push(result);

    if (result.passed) {
      passCount++;
      console.log(`PASS (${result.durationMs}ms) [${result.response?.status}]`);
    } else {
      failCount++;
      console.log(`FAIL (${result.durationMs}ms) [${result.response?.status || 'ERROR'}]`);
      for (const f of result.failures) {
        console.log(`    -> ${f}`);
      }
    }

    if (verbose && result.response) {
      if (result.response.unsupported_criteria?.length) {
        console.log(`    unsupported_criteria: ${JSON.stringify(result.response.unsupported_criteria)}`);
      }
      if (result.response.suggested_alternative) {
        console.log(`    suggested_alt.label: "${result.response.suggested_alternative.label}"`);
        console.log(`    suggested_alt.filters: ${JSON.stringify(result.response.suggested_alternative.filters)}`);
      }
      if (result.response.linkedin_filters.search_query) {
        console.log(`    search_query: "${result.response.linkedin_filters.search_query}"`);
      }
      console.log(`    message: "${result.response.message}"`);
    }
  }

  // Write JSONL log
  const logDir = join(__dirname, '..', 'logs', 'retrieval-comparison');
  await mkdir(logDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const jsonlPath = join(logDir, `unsupported-steering-qa-${timestamp}.jsonl`);
  const jsonlLines = results.map((r, i) => JSON.stringify(buildLogEntry(r, i)));
  await writeFile(jsonlPath, jsonlLines.join('\n') + '\n', 'utf-8');

  // Write report
  const reportPath = join(logDir, `unsupported-steering-qa-report-${timestamp}.md`);
  const report = generateReport(results);
  await writeFile(reportPath, report, 'utf-8');

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  TOTAL: ${results.length}  |  PASS: ${passCount}  |  FAIL: ${failCount}`);
  console.log(`  Pass rate: ${Math.round(passCount / results.length * 100)}%`);
  console.log(`${'='.repeat(60)}`);

  // Category breakdown
  const categories = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const cat = r.test.category;
    if (!categories.has(cat)) categories.set(cat, { total: 0, passed: 0 });
    const c = categories.get(cat)!;
    c.total++;
    if (r.passed) c.passed++;
  }
  console.log('\n  Category breakdown:');
  for (const [cat, counts] of categories) {
    const rate = Math.round(counts.passed / counts.total * 100);
    const mark = rate === 100 ? 'OK' : 'ISSUES';
    console.log(`    ${cat}: ${counts.passed}/${counts.total} (${rate}%) ${mark}`);
  }

  console.log(`\n  JSONL log: ${jsonlPath}`);
  console.log(`  Report:    ${reportPath}\n`);

  // Exit with failure if any test failed
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
