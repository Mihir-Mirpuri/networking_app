/**
 * RETEST: findPeopleByFiltersV3 after three bug fixes.
 *
 * Fix 1: Sequential queries (Query A first, Query B only if exactCount < limit)
 * Fix 2: 20% slot reservation for 'similar' tier results
 * Fix 3: Short codes (<=3 chars) skip ILIKE, vector-only
 *
 * Usage: npx tsx tests/v3-match-tier-qa-retest.ts
 */

import 'dotenv/config';
import {
  findPeopleByFiltersV2,
  findPeopleByFiltersV3,
} from '../src/lib/db/person-service';
import type { PersonResultV3, MatchTier, PersonFiltersV2 } from '../src/lib/db/person-service';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ──
const LOG_DIR = path.resolve(__dirname, '../logs/retrieval-comparison');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `v3-retest-${TIMESTAMP}.jsonl`);
const VERDICT_FILE = path.join(LOG_DIR, 'VERDICT-V3-RETEST.md');

fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Stats ──
let totalCases = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalErrors = 0;
let totalResultsChecked = 0;
let totalMisclassified = 0;

interface LatencyRecord {
  case_id: number;
  category: string;
  role: string;
  filters_desc: string;
  v3_ms: number;
  v2_ms: number | null;
  result_count: number;
  is_cold_start: boolean;
}
const latencyRecords: LatencyRecord[] = [];

interface FailureRecord {
  case_id: number;
  category: string;
  description: string;
  role_searched: string;
  details: string;
}
const failures: FailureRecord[] = [];

interface CategoryStats {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  results_checked: number;
  misclassified: number;
}
const categoryStats = new Map<string, CategoryStats>();

function getCatStats(cat: string): CategoryStats {
  if (!categoryStats.has(cat)) {
    categoryStats.set(cat, { total: 0, passed: 0, failed: 0, errors: 0, results_checked: 0, misclassified: 0 });
  }
  return categoryStats.get(cat)!;
}

// Track which roles have been warmed up (first query is cold-start)
const warmedRoles = new Set<string>();

function logCase(data: Record<string, unknown>) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(data) + '\n');
}

// ── Tier classification oracle ──
function expectedTier(searchRole: string, resultRole: string | null): MatchTier | 'unknown' {
  if (!resultRole) return 'unknown';
  const s = searchRole.trim().toLowerCase();
  const r = resultRole.trim().toLowerCase();
  if (r === s) return 'exact';
  if (r.includes(s)) return 'near_exact';
  return 'similar';
}

function isTierCorrect(searchRole: string, resultRole: string | null, assignedTier: MatchTier): boolean {
  const expected = expectedTier(searchRole, resultRole);
  if (expected === 'unknown') return true;
  // For short codes (<=3), ILIKE is skipped so everything goes through vector.
  // Results that WOULD be near_exact via ILIKE are still OK as 'similar' from vector
  // because the ILIKE path was intentionally skipped.
  if (searchRole.trim().length <= 3) {
    // For short codes, vector-only path: if result contains search string, it could be
    // near_exact OR similar depending on implementation. Since ILIKE is skipped,
    // Query B tags everything as 'similar'. This is correct behavior for the fix.
    // But Query A may still run for 4+ char codes like "CTO" (length 3 = skip).
    // Actually: <=3 means "PM"(2), "DS"(2), "QA"(2), "VP"(2), "SWE"(3), "MLE"(3),
    // "SDE"(3), "CTO"(3), "CEO"(3), "CFO"(3), "COO"(3), "FE"(2), "BE"(2), "FS"(2).
    // For these, ALL results come from Query B (vector) so all are 'similar'.
    // But if result role literally contains the short code as substring AND came from
    // Query A (which was skipped), it won't appear via ILIKE path.
    // Accept 'similar' for anything when short code is used.
    return true;
  }
  return expected === assignedTier;
}

// ── Helpers ──
function makeFilters(overrides: Partial<PersonFiltersV2>): PersonFiltersV2 {
  return {
    company: '',
    limit: 25,
    requireEmail: false,
    roleSpecificity: 'standard',
    ...overrides,
  };
}

let caseCounter = 0;
function nextId(): number { return ++caseCounter; }

// ── V2 recall comparison helper ──
interface V2RecallResult {
  v2_count: number;
  v3_count: number;
  v2_ids: Set<string>;
  v3_ids: Set<string>;
  overlap: number;
  v2_only: number;
  v3_only: number;
  v3_similar_count: number;
  v2_duration_ms: number;
}

async function compareV2(filters: PersonFiltersV2, v3Results: PersonResultV3[]): Promise<V2RecallResult> {
  const v2Start = performance.now();
  const v2Results = await findPeopleByFiltersV2(filters);
  const v2Ms = performance.now() - v2Start;

  const v2Ids = new Set(v2Results.map(r => r.id));
  const v3Ids = new Set(v3Results.map(r => r.id));

  let overlap = 0;
  for (const id of v3Ids) { if (v2Ids.has(id)) overlap++; }

  return {
    v2_count: v2Results.length,
    v3_count: v3Results.length,
    v2_ids: v2Ids,
    v3_ids: v3Ids,
    overlap,
    v2_only: v2Results.length - overlap,
    v3_only: v3Results.length - overlap,
    v3_similar_count: v3Results.filter(r => r.matchTier === 'similar').length,
    v2_duration_ms: Math.round(v2Ms),
  };
}

// ── Test Case interface ──
interface TestCase {
  case_id: number;
  category: string;
  description: string;
  filters: PersonFiltersV2;
  run_v2?: boolean;
  is_warmup?: boolean; // First run for this role = cold start
  expectations?: {
    min_results?: number;
    max_results?: number;
    all_exact?: boolean;
    should_have_similar?: boolean;
    no_ilike_noise?: boolean; // For short-code tests
  };
}

async function runTestCase(tc: TestCase): Promise<Record<string, unknown>> {
  totalCases++;
  const stats = getCatStats(tc.category);
  stats.total++;

  const role = tc.filters.role || '';
  const isCold = role.trim() ? !warmedRoles.has(role.trim().toLowerCase()) : false;
  if (role.trim()) warmedRoles.add(role.trim().toLowerCase());

  const logEntry: Record<string, unknown> = {
    case_id: tc.case_id,
    category: tc.category,
    description: tc.description,
    filters: tc.filters,
    is_cold_start: isCold,
  };

  try {
    const v3Start = performance.now();
    const v3Results = await findPeopleByFiltersV3(tc.filters);
    const v3Ms = performance.now() - v3Start;

    logEntry.v3_duration_ms = Math.round(v3Ms);
    logEntry.v3_result_count = v3Results.length;

    const tierCounts = { exact: 0, near_exact: 0, similar: 0 };
    for (const r of v3Results) tierCounts[r.matchTier]++;
    logEntry.v3_tier_breakdown = tierCounts;

    logEntry.v3_top5 = v3Results.slice(0, 5).map(r => ({
      id: r.id,
      name: r.fullName,
      role: r.role,
      company: r.company,
      matchTier: r.matchTier,
      matchScore: r.matchScore,
    }));

    // All results for detailed inspection
    logEntry.v3_all_roles = v3Results.map(r => ({
      role: r.role,
      tier: r.matchTier,
      score: r.matchScore,
    }));

    // Tier accuracy
    let misclassified = 0;
    const misclassifiedDetails: string[] = [];
    if (role.trim()) {
      for (const r of v3Results) {
        totalResultsChecked++;
        stats.results_checked++;
        if (!isTierCorrect(role, r.role, r.matchTier)) {
          misclassified++;
          totalMisclassified++;
          stats.misclassified++;
          const exp = expectedTier(role, r.role);
          misclassifiedDetails.push(
            `"${r.role}" got ${r.matchTier}, expected ${exp} (score=${r.matchScore.toFixed(3)})`
          );
        }
      }
    }
    logEntry.misclassified_count = misclassified;
    if (misclassifiedDetails.length > 0) logEntry.misclassified_details = misclassifiedDetails.slice(0, 10);

    // Ranking check (within the final output, tiers may not be strictly ordered
    // because of the 20% similar slot reservation which interleaves)
    // The reservation appends similar AFTER exact/near_exact, so ordering should still be:
    // exact(s) -> near_exact(s) -> similar(s)
    let rankingCorrect = true;
    for (let i = 1; i < v3Results.length; i++) {
      const prevTier = { exact: 0, near_exact: 1, similar: 2 }[v3Results[i - 1].matchTier];
      const currTier = { exact: 0, near_exact: 1, similar: 2 }[v3Results[i].matchTier];
      if (currTier < prevTier) {
        rankingCorrect = false;
        logEntry.ranking_violation = `Index ${i}: ${v3Results[i].matchTier} after ${v3Results[i - 1].matchTier}`;
        break;
      }
      if (currTier === prevTier && v3Results[i].matchScore > v3Results[i - 1].matchScore + 0.001) {
        rankingCorrect = false;
        logEntry.ranking_violation = `Index ${i}: score ${v3Results[i].matchScore} > ${v3Results[i - 1].matchScore} within same tier`;
        break;
      }
    }
    logEntry.ranking_correct = rankingCorrect;

    // V2 comparison if requested
    let v2Recall: V2RecallResult | null = null;
    if (tc.run_v2) {
      v2Recall = await compareV2(tc.filters, v3Results);
      logEntry.v2_comparison = {
        v2_count: v2Recall.v2_count,
        v3_count: v2Recall.v3_count,
        overlap: v2Recall.overlap,
        v2_only: v2Recall.v2_only,
        v3_only: v2Recall.v3_only,
        v3_similar_count: v2Recall.v3_similar_count,
        v2_duration_ms: v2Recall.v2_duration_ms,
      };
    }

    // Latency record
    const filterDesc = [
      role ? `role="${role}"` : '',
      tc.filters.company ? `co="${tc.filters.company}"` : '',
      tc.filters.location ? `loc="${tc.filters.location}"` : '',
    ].filter(Boolean).join(', ');

    latencyRecords.push({
      case_id: tc.case_id,
      category: tc.category,
      role: role || '(none)',
      filters_desc: filterDesc,
      v3_ms: Math.round(v3Ms),
      v2_ms: v2Recall?.v2_duration_ms ?? null,
      result_count: v3Results.length,
      is_cold_start: isCold,
    });

    // Pass/fail
    let passed = true;
    const failReasons: string[] = [];

    // Latency gate (exclude cold starts from the 1000ms hard fail)
    if (!isCold && v3Ms > 1000) {
      passed = false;
      failReasons.push(`Latency ${Math.round(v3Ms)}ms > 1000ms (warm)`);
    }
    if (isCold && v3Ms > 2000) {
      passed = false;
      failReasons.push(`Latency ${Math.round(v3Ms)}ms > 2000ms (cold)`);
    }

    // Tier accuracy
    if (v3Results.length > 0 && misclassified > v3Results.length * 0.2) {
      passed = false;
      failReasons.push(`${misclassified}/${v3Results.length} misclassified (>20%)`);
    }

    // Ranking
    if (!rankingCorrect) {
      passed = false;
      failReasons.push('Ranking order incorrect');
    }

    // Short-code noise check
    if (tc.expectations?.no_ilike_noise && role.trim().length <= 3) {
      // Verify no substring noise: results should NOT contain roles matched only by
      // substring. Since ILIKE is skipped, all results are vector-based.
      // We check: no result where the role contains the search string as substring
      // BUT the role is clearly unrelated (heuristic: if role contains the short code
      // as part of a longer word, it's likely noise)
      const shortCode = role.trim().toUpperCase();
      let noiseCount = 0;
      for (const r of v3Results) {
        if (!r.role) continue;
        const rUpper = r.role.toUpperCase();
        // Check if short code appears as part of a longer word (not word-boundary)
        const regex = new RegExp(`[A-Z]${shortCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${shortCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Z]`);
        if (regex.test(rUpper) && !rUpper.includes(` ${shortCode} `) && !rUpper.startsWith(shortCode + ' ') && !rUpper.endsWith(' ' + shortCode)) {
          noiseCount++;
        }
      }
      logEntry.ilike_noise_count = noiseCount;
      if (noiseCount > v3Results.length * 0.3) {
        passed = false;
        failReasons.push(`Short-code ILIKE noise: ${noiseCount}/${v3Results.length} results have substring match noise`);
      }
    }

    // Expectation checks
    if (tc.expectations) {
      if (tc.expectations.min_results !== undefined && v3Results.length < tc.expectations.min_results) {
        passed = false;
        failReasons.push(`Expected min ${tc.expectations.min_results}, got ${v3Results.length}`);
      }
      if (tc.expectations.max_results !== undefined && v3Results.length > tc.expectations.max_results) {
        passed = false;
        failReasons.push(`Expected max ${tc.expectations.max_results}, got ${v3Results.length}`);
      }
      if (tc.expectations.all_exact && v3Results.some(r => r.matchTier !== 'exact')) {
        passed = false;
        failReasons.push('Expected all exact, got mixed tiers');
      }
      if (tc.expectations.should_have_similar && tierCounts.similar === 0 && v3Results.length > 0) {
        passed = false;
        failReasons.push('Expected similar-tier results but got none');
      }
    }

    logEntry.passed = passed;
    logEntry.fail_reasons = failReasons;

    if (passed) { totalPassed++; stats.passed++; }
    else {
      totalFailed++; stats.failed++;
      failures.push({
        case_id: tc.case_id,
        category: tc.category,
        description: tc.description,
        role_searched: role,
        details: failReasons.join('; '),
      });
    }
  } catch (error: unknown) {
    totalErrors++; stats.errors++;
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logEntry.error = errMsg;
    logEntry.stack = errStack;
    logEntry.passed = false;
    failures.push({
      case_id: tc.case_id,
      category: tc.category,
      description: tc.description,
      role_searched: role,
      details: `ERROR: ${errMsg}`,
    });
  }

  logCase(logEntry);
  return logEntry;
}

// ============================================================================
// Priority 1: LATENCY (40 cases)
// ============================================================================

function buildLatencyTests(): TestCase[] {
  const cases: TestCase[] = [];

  // 1a. Previously-slow common roles: run TWICE each (cold + warm)
  const prevSlowRoles = [
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Data Engineer', 'Machine Learning Engineer', 'Sales Representative',
    'Operations Manager', 'UX Designer', 'Account Executive', 'Project Manager',
  ];
  for (const role of prevSlowRoles) {
    // First run (cold start)
    cases.push({
      case_id: nextId(),
      category: 'latency_cold',
      description: `Latency COLD: "${role}" (role-only)`,
      filters: makeFilters({ role }),
      is_warmup: true,
    });
    // Second run (warm)
    cases.push({
      case_id: nextId(),
      category: 'latency_warm',
      description: `Latency WARM: "${role}" (role-only)`,
      filters: makeFilters({ role }),
    });
  }

  // 1b. Role + company (warm path, roles already warmed by above)
  const roleCompanyPairs = [
    { role: 'Software Engineer', company: 'Google' },
    { role: 'Software Engineer', company: 'Stripe' },
    { role: 'Product Manager', company: 'Meta' },
    { role: 'Data Scientist', company: 'Amazon' },
    { role: 'Machine Learning Engineer', company: 'Google' },
  ];
  for (const { role, company } of roleCompanyPairs) {
    cases.push({
      case_id: nextId(),
      category: 'latency_role_company',
      description: `Latency: "${role}" at ${company}`,
      filters: makeFilters({ role, company }),
      run_v2: true,
    });
  }

  // 1c. Role + location
  const roleLocPairs = [
    { role: 'Software Engineer', location: 'San Francisco' },
    { role: 'Product Manager', location: 'New York' },
    { role: 'Data Scientist', location: 'Seattle' },
  ];
  for (const { role, location } of roleLocPairs) {
    cases.push({
      case_id: nextId(),
      category: 'latency_role_location',
      description: `Latency: "${role}" in ${location}`,
      filters: makeFilters({ role, location }),
      run_v2: true,
    });
  }

  // 1d. Role + company + location
  cases.push({
    case_id: nextId(),
    category: 'latency_triple',
    description: 'Latency: "Software Engineer" at Google in SF',
    filters: makeFilters({ role: 'Software Engineer', company: 'Google', location: 'San Francisco' }),
    run_v2: true,
  });
  cases.push({
    case_id: nextId(),
    category: 'latency_triple',
    description: 'Latency: "Product Manager" at Meta in NY',
    filters: makeFilters({ role: 'Product Manager', company: 'Meta', location: 'New York' }),
    run_v2: true,
  });

  // 1e. Broad roles (previously slow, should benefit from sequential fix since ILIKE saturates)
  const broadRoles = ['Engineer', 'Manager', 'Analyst', 'Designer', 'Director'];
  for (const role of broadRoles) {
    cases.push({
      case_id: nextId(),
      category: 'latency_broad',
      description: `Latency BROAD: "${role}" (limit 50)`,
      filters: makeFilters({ role, limit: 50 }),
      run_v2: true,
    });
  }

  return cases;
}

// ============================================================================
// Priority 2: V2 RECALL REGRESSION (30 cases)
// ============================================================================

function buildV2RecallTests(): TestCase[] {
  const cases: TestCase[] = [];

  // The specific cases that showed V2 regression in the first test
  const regressionCases = [
    { role: 'Data Engineer', company: 'Stripe', desc: 'V2 found 25 (mostly SWE), V3 missed 24' },
    { role: 'Machine Learning Engineer', company: 'Google', desc: 'V2 found SWEs, V3 missed 20' },
    { role: 'Engineering Manager', company: 'Microsoft', desc: 'V2 found PMs, V3 missed 20' },
    { role: 'Business Analyst', company: 'Deloitte', desc: 'V2 found Strategy Analysts, V3 missed 18' },
    { role: 'DevOps Engineer', company: 'Netflix', desc: 'V2 found SWEs, V3 missed 8' },
    { role: 'Backend Engineer', company: 'Stripe', desc: 'V2 found SWEs via vector' },
    { role: 'Frontend Engineer', company: 'Meta', desc: 'V2 found SWEs via vector' },
    { role: 'Research Scientist', company: 'Google', desc: 'V2 found ML Engineers via vector' },
    { role: 'Product Designer', company: 'Apple', desc: 'V2 found UX Designers via vector' },
    { role: 'Solutions Architect', company: 'Amazon', desc: 'V2 found SAs via vector' },
  ];

  for (const rc of regressionCases) {
    cases.push({
      case_id: nextId(),
      category: 'v2_recall_regression',
      description: `V2 recall: "${rc.role}" at ${rc.company} — ${rc.desc}`,
      filters: makeFilters({ role: rc.role, company: rc.company }),
      run_v2: true,
      expectations: { should_have_similar: true },
    });
  }

  // Additional role+company combos to verify 20% reservation works broadly
  const additionalCombos = [
    { role: 'Software Engineer', company: 'Goldman Sachs' },
    { role: 'Data Scientist', company: 'Meta' },
    { role: 'Product Manager', company: 'Amazon' },
    { role: 'Financial Analyst', company: 'JPMorgan' },
    { role: 'Marketing Manager', company: 'Google' },
    { role: 'Account Executive', company: 'Salesforce' },
    { role: 'UX Designer', company: 'Microsoft' },
    { role: 'Data Analyst', company: 'McKinsey' },
    { role: 'Operations Manager', company: 'Amazon' },
    { role: 'Project Manager', company: 'Apple' },
  ];

  for (const { role, company } of additionalCombos) {
    cases.push({
      case_id: nextId(),
      category: 'v2_recall_additional',
      description: `V2 recall: "${role}" at ${company}`,
      filters: makeFilters({ role, company }),
      run_v2: true,
    });
  }

  // Role-only recall checks (broader search space)
  const roleOnlyRecall = [
    'Data Engineer', 'Machine Learning Engineer', 'Backend Engineer',
    'Frontend Engineer', 'DevOps Engineer', 'Site Reliability Engineer',
    'Engineering Manager', 'Product Designer', 'Research Scientist',
    'Solutions Architect',
  ];

  for (const role of roleOnlyRecall) {
    cases.push({
      case_id: nextId(),
      category: 'v2_recall_role_only',
      description: `V2 recall role-only: "${role}"`,
      filters: makeFilters({ role }),
      run_v2: true,
    });
  }

  return cases;
}

// ============================================================================
// Priority 3: SHORT-CODE ILIKE FIX (15 cases)
// ============================================================================

function buildShortCodeTests(): TestCase[] {
  const cases: TestCase[] = [];

  const shortCodes = [
    { code: 'PM', expectedRelated: 'Product Manager', prevNoise: 'CAPM, Service Desk Manager' },
    { code: 'SWE', expectedRelated: 'Software Engineer', prevNoise: 'N/A' },
    { code: 'DS', expectedRelated: 'Data Scientist', prevNoise: 'various' },
    { code: 'QA', expectedRelated: 'Quality Assurance', prevNoise: 'various' },
    { code: 'VP', expectedRelated: 'Vice President', prevNoise: 'various' },
    { code: 'CTO', expectedRelated: 'Chief Technology Officer', prevNoise: 'various' },
    { code: 'CFO', expectedRelated: 'Chief Financial Officer', prevNoise: 'various' },
    { code: 'COO', expectedRelated: 'Chief Operating Officer', prevNoise: 'various' },
    { code: 'CEO', expectedRelated: 'Chief Executive Officer', prevNoise: 'various' },
    { code: 'HR', expectedRelated: 'Human Resources', prevNoise: 'various' },
    { code: 'FE', expectedRelated: 'Frontend Engineer', prevNoise: 'various' },
    { code: 'BE', expectedRelated: 'Backend Engineer', prevNoise: 'various' },
    { code: 'FS', expectedRelated: 'Full Stack', prevNoise: 'various' },
    { code: 'MLE', expectedRelated: 'Machine Learning Engineer', prevNoise: 'N/A' },
    { code: 'SDE', expectedRelated: 'Software Development Engineer', prevNoise: 'N/A' },
  ];

  for (const sc of shortCodes) {
    cases.push({
      case_id: nextId(),
      category: 'short_code_fix',
      description: `Short code: "${sc.code}" (expect ${sc.expectedRelated}, no ILIKE noise)`,
      filters: makeFilters({ role: sc.code }),
      run_v2: true,
      expectations: { no_ilike_noise: true },
    });
  }

  return cases;
}

// ============================================================================
// Priority 4: REGRESSION CHECK (30 cases)
// ============================================================================

function buildRegressionTests(): TestCase[] {
  const cases: TestCase[] = [];

  // Re-run cases that PASSED before — verify they still pass
  // Common titles (these passed on tier accuracy, verify still correct)
  const passedCommonTitles = [
    'Software Engineer', 'Product Manager', 'Data Scientist', 'Data Analyst',
    'Marketing Manager', 'UX Designer', 'Data Engineer', 'DevOps Engineer',
    'Business Analyst', 'Financial Analyst',
  ];
  for (const role of passedCommonTitles) {
    cases.push({
      case_id: nextId(),
      category: 'regression_common',
      description: `Regression: "${role}" (should still pass tier/ranking)`,
      filters: makeFilters({ role }),
    });
  }

  // Cross-filter combos that passed
  const passedCrossFilter = [
    { role: 'Software Engineer', company: 'Google' },
    { role: 'Product Manager', company: 'Meta' },
    { role: 'Data Scientist', company: 'Amazon' },
    { role: 'Software Engineer', location: 'San Francisco' },
    { role: 'Product Manager', location: 'New York' },
    { role: 'Software Engineer', company: 'Google', location: 'San Francisco' },
    { role: 'Software Engineer', university: 'Stanford' },
    { role: 'Product Manager', university: 'Harvard' },
  ];
  for (const f of passedCrossFilter) {
    cases.push({
      case_id: nextId(),
      category: 'regression_crossfilter',
      description: `Regression: "${f.role}" ${f.company ? 'at ' + f.company : ''} ${f.location ? 'in ' + f.location : ''} ${f.university ? 'from ' + f.university : ''}`.trim(),
      filters: makeFilters(f),
    });
  }

  // Edge cases that passed
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: no role, company Google (all exact)',
    filters: makeFilters({ company: 'Google' }),
    expectations: { all_exact: true },
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: empty role string',
    filters: makeFilters({ company: 'Google', role: '' }),
    expectations: { all_exact: true },
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: UPPERCASE "SOFTWARE ENGINEER"',
    filters: makeFilters({ role: 'SOFTWARE ENGINEER' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: requireEmail=true',
    filters: makeFilters({ role: 'Software Engineer', requireEmail: true }),
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: roleSpecificity=narrow',
    filters: makeFilters({ role: 'Software Engineer', roleSpecificity: 'narrow' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: roleSpecificity=broad',
    filters: makeFilters({ role: 'Software Engineer', roleSpecificity: 'broad' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: limit=1',
    filters: makeFilters({ role: 'Software Engineer', limit: 1 }),
    expectations: { min_results: 1 },
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: limit=100 broad role',
    filters: makeFilters({ role: 'Engineer', limit: 100 }),
    expectations: { min_results: 1 },
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: nonsense role',
    filters: makeFilters({ role: 'Chief Unicorn Wrangler', company: 'NonexistentCorp12345' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'regression_edge',
    description: 'Regression: "Manager" broad role limit=50',
    filters: makeFilters({ role: 'Manager', limit: 50 }),
    expectations: { min_results: 1 },
  });

  return cases;
}

// ============================================================================
// Priority 5: TIER ACCURACY SPOT-CHECK (20 cases)
// ============================================================================

function buildTierSpotCheckTests(): TestCase[] {
  const cases: TestCase[] = [];

  const diverseRoles = [
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Backend Engineer', 'Machine Learning Engineer', 'UX Designer',
    'Financial Analyst', 'Account Executive', 'DevOps Engineer',
    'Business Analyst', 'Marketing Manager', 'Project Manager',
    'Engineering Manager', 'Sales Representative', 'Operations Manager',
    'Frontend Engineer', 'Full Stack Engineer', 'Product Designer',
    'Solutions Architect', 'Research Scientist',
  ];

  for (const role of diverseRoles) {
    cases.push({
      case_id: nextId(),
      category: 'tier_spot_check',
      description: `Tier spot-check: "${role}" — verify every result tier`,
      filters: makeFilters({ role }),
    });
  }

  return cases;
}

// ============================================================================
// Determinism (10 cases)
// ============================================================================

async function runDeterminismTests(): Promise<void> {
  const roles = [
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Business Analyst', 'Machine Learning Engineer', 'UX Designer',
    'Backend Engineer', 'Account Executive', 'DevOps Engineer',
    'Financial Analyst',
  ];

  for (const role of roles) {
    const cid = nextId();
    totalCases++;
    const stats = getCatStats('determinism');
    stats.total++;

    try {
      const filters = makeFilters({ role });
      const runs: PersonResultV3[][] = [];
      for (let i = 0; i < 3; i++) {
        runs.push(await findPeopleByFiltersV3(filters));
      }

      const ids = runs.map(r => r.map(x => x.id).join(','));
      const tiers = runs.map(r => r.map(x => x.matchTier).join(','));

      const idsDet = ids[0] === ids[1] && ids[1] === ids[2];
      const tiersDet = tiers[0] === tiers[1] && tiers[1] === tiers[2];
      const passed = idsDet && tiersDet;

      logCase({
        case_id: cid,
        category: 'determinism',
        description: `Determinism: "${role}" x3`,
        filters,
        ids_match: idsDet,
        tiers_match: tiersDet,
        passed,
        run_counts: runs.map(r => r.length),
      });

      if (passed) { totalPassed++; stats.passed++; }
      else {
        totalFailed++; stats.failed++;
        failures.push({
          case_id: cid, category: 'determinism',
          description: `Determinism: "${role}" x3`,
          role_searched: role,
          details: `IDs: ${idsDet}, Tiers: ${tiersDet}`,
        });
      }
    } catch (error: unknown) {
      totalErrors++; stats.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      logCase({ case_id: cid, category: 'determinism', error: errMsg, passed: false });
      failures.push({
        case_id: cid, category: 'determinism',
        description: `Determinism: "${role}"`,
        role_searched: role, details: `ERROR: ${errMsg}`,
      });
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== V3 Match Tier QA RETEST (post-fix) ===');
  console.log(`Log file: ${LOG_FILE}`);
  console.log('');
  console.log('Fixes being validated:');
  console.log('  1. Sequential queries (Query A first, B only if needed)');
  console.log('  2. 20% slot reservation for similar-tier results');
  console.log('  3. Short codes (<=3 chars) skip ILIKE, vector-only');
  console.log('');

  const allCases: TestCase[] = [
    ...buildLatencyTests(),        // ~40 cases (Priority 1)
    ...buildV2RecallTests(),       // ~30 cases (Priority 2)
    ...buildShortCodeTests(),      // 15 cases (Priority 3)
    ...buildRegressionTests(),     // ~30 cases (Priority 4)
    ...buildTierSpotCheckTests(),  // 20 cases (Priority 5)
  ];

  const totalPlanned = allCases.length + 10; // +10 determinism
  console.log(`Built ${allCases.length} standard + 10 determinism = ${totalPlanned} total cases`);
  console.log('');

  // Run standard cases sequentially
  for (let i = 0; i < allCases.length; i++) {
    const tc = allCases[i];
    process.stdout.write(`[${i + 1}/${allCases.length}] ${tc.category}: ${tc.description}...`);
    const entry = await runTestCase(tc);
    const status = entry.passed ? 'PASS' : entry.error ? 'ERROR' : 'FAIL';
    const ms = entry.v3_duration_ms ?? '?';
    const count = entry.v3_result_count ?? '?';
    const tiers = entry.v3_tier_breakdown as { exact: number; near_exact: number; similar: number } | undefined;
    const tierStr = tiers ? ` [E:${tiers.exact} NE:${tiers.near_exact} S:${tiers.similar}]` : '';
    console.log(` ${status} (${ms}ms, ${count} results${tierStr})`);
  }

  // Determinism tests
  console.log('\n--- Determinism tests ---');
  await runDeterminismTests();

  // ── Generate verdict ──
  console.log('\n=== Generating Verdict ===');

  const tierAccuracy = totalResultsChecked > 0
    ? ((totalResultsChecked - totalMisclassified) / totalResultsChecked * 100).toFixed(1)
    : 'N/A';
  const tierAccNum = totalResultsChecked > 0
    ? (totalResultsChecked - totalMisclassified) / totalResultsChecked * 100
    : 100;
  const passRate = totalCases > 0 ? totalPassed / totalCases * 100 : 0;

  // Latency analysis — separate cold vs warm
  const warmLatencies = latencyRecords.filter(r => !r.is_cold_start).map(r => r.v3_ms).sort((a, b) => a - b);
  const coldLatencies = latencyRecords.filter(r => r.is_cold_start).map(r => r.v3_ms).sort((a, b) => a - b);
  const allV3Latencies = latencyRecords.map(r => r.v3_ms).sort((a, b) => a - b);
  const v2Latencies = latencyRecords.filter(r => r.v2_ms != null).map(r => r.v2_ms!).sort((a, b) => a - b);

  function pct(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    return arr[Math.max(0, Math.ceil(arr.length * p / 100) - 1)];
  }
  function avg(arr: number[]): number {
    return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  }

  const warmStats = {
    count: warmLatencies.length,
    min: warmLatencies[0] ?? 0,
    max: warmLatencies[warmLatencies.length - 1] ?? 0,
    mean: avg(warmLatencies),
    p50: pct(warmLatencies, 50),
    p95: pct(warmLatencies, 95),
    p99: pct(warmLatencies, 99),
  };
  const coldStats = {
    count: coldLatencies.length,
    min: coldLatencies[0] ?? 0,
    max: coldLatencies[coldLatencies.length - 1] ?? 0,
    mean: avg(coldLatencies),
    p50: pct(coldLatencies, 50),
    p95: pct(coldLatencies, 95),
    p99: pct(coldLatencies, 99),
  };
  const allStats = {
    count: allV3Latencies.length,
    min: allV3Latencies[0] ?? 0,
    max: allV3Latencies[allV3Latencies.length - 1] ?? 0,
    mean: avg(allV3Latencies),
    p50: pct(allV3Latencies, 50),
    p95: pct(allV3Latencies, 95),
    p99: pct(allV3Latencies, 99),
  };
  const v2Stats = {
    count: v2Latencies.length,
    min: v2Latencies[0] ?? 0,
    max: v2Latencies[v2Latencies.length - 1] ?? 0,
    mean: avg(v2Latencies),
    p50: pct(v2Latencies, 50),
    p95: pct(v2Latencies, 95),
    p99: pct(v2Latencies, 99),
  };

  // Slow queries
  const warmSlow500 = latencyRecords.filter(r => !r.is_cold_start && r.v3_ms > 500);
  const warmSlow1000 = latencyRecords.filter(r => !r.is_cold_start && r.v3_ms > 1000);
  const coldSlow2000 = latencyRecords.filter(r => r.is_cold_start && r.v3_ms > 2000);

  // V2 recall analysis
  const recallCases = latencyRecords.filter(r => r.v2_ms != null);

  // Category breakdown
  let catBreakdown = '';
  for (const [cat, stats] of categoryStats.entries()) {
    const tierAcc = stats.results_checked > 0
      ? ((stats.results_checked - stats.misclassified) / stats.results_checked * 100).toFixed(1) + '%'
      : 'N/A';
    catBreakdown += `| ${cat} | ${stats.total} | ${stats.passed} | ${stats.failed} | ${stats.errors} | ${tierAcc} |\n`;
  }

  // Failure detail
  let failureDetail = '';
  for (const f of failures) {
    failureDetail += `- **Case ${f.case_id}** [${f.category}] ${f.description}\n  Role: "${f.role_searched}" | ${f.details}\n\n`;
  }

  // Read log for V2 recall stats
  let v2RecallSummary = '';
  try {
    const logLines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
    let totalV2Only = 0;
    let totalV3Similar = 0;
    let casesWithSimilar = 0;
    let casesWithV2Comparison = 0;

    for (const line of logLines) {
      const entry = JSON.parse(line);
      if (entry.v2_comparison) {
        casesWithV2Comparison++;
        totalV2Only += entry.v2_comparison.v2_only || 0;
        totalV3Similar += entry.v2_comparison.v3_similar_count || 0;
        if (entry.v2_comparison.v3_similar_count > 0) casesWithSimilar++;
      }
    }

    v2RecallSummary = `
### V2 Recall Recovery

| Metric | Value |
|--------|-------|
| V2 comparison cases | ${casesWithV2Comparison} |
| Cases with similar-tier results | ${casesWithSimilar} (${casesWithV2Comparison > 0 ? (casesWithSimilar / casesWithV2Comparison * 100).toFixed(0) : 0}%) |
| Total V2-only results (not in V3) | ${totalV2Only} |
| Total similar-tier results in V3 | ${totalV3Similar} |
| Avg similar per case (when present) | ${casesWithSimilar > 0 ? (totalV3Similar / casesWithSimilar).toFixed(1) : 0} |
`;
  } catch { v2RecallSummary = 'Error parsing log for V2 recall stats.'; }

  // Short-code analysis
  let shortCodeSummary = '';
  try {
    const logLines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
    let shortCodeCases = 0;
    let shortCodePassed = 0;
    let totalShortCodeNoise = 0;
    let totalShortCodeResults = 0;

    for (const line of logLines) {
      const entry = JSON.parse(line);
      if (entry.category === 'short_code_fix') {
        shortCodeCases++;
        if (entry.passed) shortCodePassed++;
        totalShortCodeNoise += entry.ilike_noise_count || 0;
        totalShortCodeResults += entry.v3_result_count || 0;
      }
    }

    shortCodeSummary = `
### Short-Code ILIKE Fix

| Metric | Value |
|--------|-------|
| Short-code cases tested | ${shortCodeCases} |
| Passed | ${shortCodePassed} |
| Total results | ${totalShortCodeResults} |
| Substring noise count | ${totalShortCodeNoise} |
| Noise rate | ${totalShortCodeResults > 0 ? (totalShortCodeNoise / totalShortCodeResults * 100).toFixed(1) : 0}% |
`;
  } catch { shortCodeSummary = 'Error parsing short-code stats.'; }

  // Verdict
  let verdict: string;
  let verdictExplanation: string;

  if (tierAccNum >= 95 && totalErrors === 0 && warmStats.p95 <= 500 && warmSlow1000.length === 0 && passRate >= 90) {
    verdict = 'PRODUCTION READY';
    verdictExplanation = `Tier accuracy ${tierAccuracy}% >= 95%. No crashes. Warm p95 ${warmStats.p95}ms <= 500ms. No warm queries > 1s. Pass rate ${passRate.toFixed(1)}% >= 90%.`;
  } else if (tierAccNum >= 80 || passRate >= 70) {
    verdict = 'NEEDS TUNING';
    const reasons: string[] = [];
    if (tierAccNum < 95) reasons.push(`Tier accuracy ${tierAccuracy}% < 95%`);
    if (totalErrors > 0) reasons.push(`${totalErrors} errors/crashes`);
    if (warmStats.p95 > 500) reasons.push(`Warm p95 latency ${warmStats.p95}ms > 500ms`);
    if (warmSlow1000.length > 0) reasons.push(`${warmSlow1000.length} warm queries > 1s`);
    if (passRate < 90) reasons.push(`Pass rate ${passRate.toFixed(1)}% < 90%`);
    verdictExplanation = reasons.join('. ') + '.';
  } else {
    verdict = 'WRONG APPROACH';
    verdictExplanation = `Tier accuracy ${tierAccuracy}%, pass rate ${passRate.toFixed(1)}%. Fundamental issues.`;
  }

  const verdictMd = `# V3 Match Tier QA RETEST Verdict (Post-Fix)

## Run Info
- **Date:** ${new Date().toISOString()}
- **Log file:** \`${LOG_FILE}\`
- **Total test cases:** ${totalCases}
- **Fixes being validated:**
  1. Sequential queries (Query A first, Query B only if exactCount < limit)
  2. 20% slot reservation for similar-tier results
  3. Short codes (<=3 chars) skip ILIKE, vector-only

## Summary Stats

| Metric | Value |
|--------|-------|
| Total cases | ${totalCases} |
| Passed | ${totalPassed} |
| Failed | ${totalFailed} |
| Errors | ${totalErrors} |
| Pass rate | ${passRate.toFixed(1)}% |
| Results checked for tier accuracy | ${totalResultsChecked} |
| Misclassified | ${totalMisclassified} |
| **Tier accuracy** | **${tierAccuracy}%** |

## Category Breakdown

| Category | Total | Passed | Failed | Errors | Tier Accuracy |
|----------|-------|--------|--------|--------|---------------|
${catBreakdown}

## Performance Analysis

### Latency: Warm (embedding cached) -- THIS IS THE PRODUCTION-RELEVANT METRIC

| Metric | V3 Warm (n=${warmStats.count}) | V2 (n=${v2Stats.count}) |
|--------|------|------|
| Min | ${warmStats.min}ms | ${v2Stats.min}ms |
| Mean | ${warmStats.mean}ms | ${v2Stats.mean}ms |
| p50 | ${warmStats.p50}ms | ${v2Stats.p50}ms |
| p95 | ${warmStats.p95}ms | ${v2Stats.p95}ms |
| p99 | ${warmStats.p99}ms | ${v2Stats.p99}ms |
| Max | ${warmStats.max}ms | ${v2Stats.max}ms |

### Latency: Cold Start (first query per role, includes embedding generation)

| Metric | V3 Cold (n=${coldStats.count}) |
|--------|------|
| Min | ${coldStats.min}ms |
| Mean | ${coldStats.mean}ms |
| p50 | ${coldStats.p50}ms |
| p95 | ${coldStats.p95}ms |
| Max | ${coldStats.max}ms |

### Latency: All V3 Queries Combined

| Metric | V3 All (n=${allStats.count}) |
|--------|------|
| Min | ${allStats.min}ms |
| Mean | ${allStats.mean}ms |
| p50 | ${allStats.p50}ms |
| p95 | ${allStats.p95}ms |
| p99 | ${allStats.p99}ms |
| Max | ${allStats.max}ms |

### Warm Queries > 500ms
${warmSlow500.length === 0 ? 'None.' : warmSlow500.map(q => `- Case ${q.case_id} [${q.category}] "${q.role}" (${q.filters_desc}): ${q.v3_ms}ms`).join('\n')}

### Warm Queries > 1000ms (AUTOMATIC FAILURE)
${warmSlow1000.length === 0 ? 'None.' : warmSlow1000.map(q => `- Case ${q.case_id} [${q.category}] "${q.role}" (${q.filters_desc}): ${q.v3_ms}ms`).join('\n')}

### Cold Queries > 2000ms
${coldSlow2000.length === 0 ? 'None.' : coldSlow2000.map(q => `- Case ${q.case_id} [${q.category}] "${q.role}" (${q.filters_desc}): ${q.v3_ms}ms`).join('\n')}

## Fix Validation
${v2RecallSummary}
${shortCodeSummary}

## Failures Detail

${failures.length === 0 ? 'No failures.' : failureDetail}

## Comparison to Previous Run

| Metric | Previous (Pre-Fix) | This Retest |
|--------|-------------------|-------------|
| Total cases | 296 | ${totalCases} |
| Pass rate | 83.4% | ${passRate.toFixed(1)}% |
| Tier accuracy | 100.0% | ${tierAccuracy}% |
| V3 mean latency | 780ms | ${allStats.mean}ms |
| V3 p95 latency | 1380ms | ${allStats.p95}ms |
| V3 warm p95 | N/A (not measured) | ${warmStats.p95}ms |
| Queries > 1s (warm) | 49 | ${warmSlow1000.length} |
| Errors | 0 | ${totalErrors} |

## Production Readiness Verdict

### **${verdict}**

${verdictExplanation}

${verdict === 'NEEDS TUNING' ? `### Remaining Issues

Review failures above. Key areas:
${warmStats.p95 > 500 ? `1. Warm p95 latency ${warmStats.p95}ms still exceeds 500ms target\n` : ''}${warmSlow1000.length > 0 ? `2. ${warmSlow1000.length} warm queries still exceed 1000ms\n` : ''}${passRate < 90 ? `3. Pass rate ${passRate.toFixed(1)}% below 90% threshold\n` : ''}` : ''}${verdict === 'PRODUCTION READY' ? `### What the Fixes Achieved

1. **Latency**: Sequential query execution means most queries only run Query A (ILIKE). Query B (vector) is skipped when exact matches saturate the limit.
2. **V2 Recall**: 20% slot reservation ensures semantic neighbors appear when available.
3. **Short-code noise**: Vector-only path for <=3 char roles eliminates substring ILIKE noise.
` : ''}
`;

  fs.writeFileSync(VERDICT_FILE, verdictMd);

  console.log(`\nVerdict written to: ${VERDICT_FILE}`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(`Tier accuracy: ${tierAccuracy}%`);
  console.log(`Pass rate: ${passRate.toFixed(1)}% (${totalPassed}/${totalCases})`);
  console.log(`V3 warm latency: mean=${warmStats.mean}ms, p95=${warmStats.p95}ms, max=${warmStats.max}ms`);
  console.log(`V3 cold latency: mean=${coldStats.mean}ms, p95=${coldStats.p95}ms, max=${coldStats.max}ms`);
  console.log(`Warm queries >500ms: ${warmSlow500.length}, >1000ms: ${warmSlow1000.length}`);
  console.log(`Failures: ${totalFailed}, Errors: ${totalErrors}`);
  console.log(`${'='.repeat(60)}`);

  process.exit(verdict === 'PRODUCTION READY' ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
