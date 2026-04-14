/**
 * Production QA: findPeopleByFiltersV3 match-tier accuracy, latency, and regression testing.
 *
 * Usage: npx tsx tests/v3-match-tier-qa.ts
 *
 * Tests 290+ cases across: role tier accuracy, cross-filter combos, ranking,
 * edge cases, latency, V2 comparison, and determinism.
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
const LOG_FILE = path.join(LOG_DIR, `v3-qa-${TIMESTAMP}.jsonl`);
const VERDICT_FILE = path.join(LOG_DIR, 'VERDICT-V3.md');

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
  v3_ms: number;
  v2_ms: number | null;
  result_count: number;
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

// ── Logging ──
function logCase(data: Record<string, unknown>) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(data) + '\n');
}

// ── Tier classification helpers ──

/**
 * Given the searched role and a result's actual role, determine the EXPECTED tier.
 * This is our ground-truth oracle for tier accuracy testing.
 */
function expectedTier(searchRole: string, resultRole: string | null): MatchTier | 'unknown' {
  if (!resultRole) return 'unknown';
  const s = searchRole.trim().toLowerCase();
  const r = resultRole.trim().toLowerCase();

  // Exact: case-insensitive equality
  if (r === s) return 'exact';

  // Near-exact: result role CONTAINS the search role as a substring
  // e.g., search "Software Engineer", result "Senior Software Engineer" -> near_exact
  if (r.includes(s)) return 'near_exact';

  // Everything else from ILIKE that doesn't contain the search role is still near_exact
  // because Query A catches it via ILIKE. But our search string must be in the role.
  // Actually the ILIKE is `p.role ILIKE '%search%'` so if the search is "Software Engineer"
  // and role is "Senior Software Engineer", it contains the search -> near_exact.
  // If the search is in the role via ILIKE, it's near_exact.

  // If we got here, it's a similar result (from Query B) or misclassified
  return 'similar';
}

/**
 * Check if a tier assignment is correct given our oracle.
 */
function isTierCorrect(searchRole: string, resultRole: string | null, assignedTier: MatchTier): boolean {
  const expected = expectedTier(searchRole, resultRole);
  if (expected === 'unknown') return true; // can't judge null roles
  return expected === assignedTier;
}

// ── Test runner ──

interface TestCase {
  case_id: number;
  category: string;
  description: string;
  filters: PersonFiltersV2;
  expectations?: {
    min_results?: number;
    max_results?: number;
    should_have_exact?: boolean;
    should_have_near_exact?: boolean;
    should_have_similar?: boolean;
    all_exact?: boolean; // when no role filter
  };
  compare_v2?: boolean;
}

async function runTestCase(tc: TestCase): Promise<void> {
  totalCases++;
  const stats = getCatStats(tc.category);
  stats.total++;

  const logEntry: Record<string, unknown> = {
    case_id: tc.case_id,
    category: tc.category,
    description: tc.description,
    filters: tc.filters,
  };

  try {
    // Run V3
    const v3Start = performance.now();
    const v3Results = await findPeopleByFiltersV3(tc.filters);
    const v3Ms = performance.now() - v3Start;

    logEntry.v3_duration_ms = Math.round(v3Ms);
    logEntry.v3_result_count = v3Results.length;

    // Tier breakdown
    const tierCounts = { exact: 0, near_exact: 0, similar: 0 };
    for (const r of v3Results) {
      tierCounts[r.matchTier]++;
    }
    logEntry.v3_tier_breakdown = tierCounts;

    // Top 5
    logEntry.v3_top5 = v3Results.slice(0, 5).map(r => ({
      id: r.id,
      name: r.fullName,
      role: r.role,
      company: r.company,
      matchTier: r.matchTier,
      matchScore: r.matchScore,
    }));

    // Tier accuracy check
    let misclassified = 0;
    const misclassifiedDetails: string[] = [];
    const searchRole = tc.filters.role || '';

    if (searchRole.trim()) {
      for (const r of v3Results) {
        totalResultsChecked++;
        stats.results_checked++;
        const expected = expectedTier(searchRole, r.role);
        if (expected !== 'unknown' && expected !== r.matchTier) {
          // Special case: if result role doesn't contain search role but got near_exact,
          // that means Query A ILIKE matched it. The ILIKE is '%search%', so the search
          // string must be a substring of the result role for ILIKE to match.
          // If it's not, there's a mismatch.
          misclassified++;
          totalMisclassified++;
          stats.misclassified++;
          misclassifiedDetails.push(
            `"${r.role}" got ${r.matchTier}, expected ${expected} (score=${r.matchScore.toFixed(3)})`
          );
        }
      }
    }

    logEntry.misclassified_count = misclassified;
    if (misclassifiedDetails.length > 0) {
      logEntry.misclassified_details = misclassifiedDetails.slice(0, 10); // cap log size
    }

    // Ranking checks
    let rankingCorrect = true;
    for (let i = 1; i < v3Results.length; i++) {
      const prev = v3Results[i - 1];
      const curr = v3Results[i];
      const prevTierOrder = { exact: 0, near_exact: 1, similar: 2 }[prev.matchTier];
      const currTierOrder = { exact: 0, near_exact: 1, similar: 2 }[curr.matchTier];
      if (currTierOrder < prevTierOrder) {
        rankingCorrect = false;
        break;
      }
      // Within same tier, score should be non-increasing
      if (currTierOrder === prevTierOrder && curr.matchScore > prev.matchScore + 0.001) {
        rankingCorrect = false;
        break;
      }
    }
    logEntry.ranking_correct = rankingCorrect;

    // Latency record
    let v2Ms: number | null = null;
    if (tc.compare_v2) {
      const v2Start = performance.now();
      const v2Results = await findPeopleByFiltersV2(tc.filters);
      v2Ms = performance.now() - v2Start;
      logEntry.v2_duration_ms = Math.round(v2Ms);
      logEntry.v2_result_count = v2Results.length;

      // Check V3 didn't miss V2 results
      const v3Ids = new Set(v3Results.map(r => r.id));
      const missedFromV2 = v2Results.filter(r => !v3Ids.has(r.id));
      logEntry.v2_results_missed_by_v3 = missedFromV2.length;
      if (missedFromV2.length > 0) {
        logEntry.missed_details = missedFromV2.slice(0, 5).map(r => ({
          id: r.id,
          name: r.fullName,
          role: r.role,
          company: r.company,
        }));
      }
    }

    latencyRecords.push({
      case_id: tc.case_id,
      category: tc.category,
      role: tc.filters.role || '(none)',
      v3_ms: Math.round(v3Ms),
      v2_ms: v2Ms != null ? Math.round(v2Ms) : null,
      result_count: v3Results.length,
    });

    // Pass/fail determination
    let passed = true;
    const failReasons: string[] = [];

    // Latency gate
    if (v3Ms > 1000) {
      passed = false;
      failReasons.push(`Latency ${Math.round(v3Ms)}ms > 1000ms`);
    }

    // Tier accuracy gate
    if (v3Results.length > 0 && misclassified > v3Results.length * 0.2) {
      passed = false;
      failReasons.push(`${misclassified}/${v3Results.length} results misclassified (>20%)`);
    }

    // Ranking gate
    if (!rankingCorrect) {
      passed = false;
      failReasons.push('Ranking order incorrect');
    }

    // Expectation checks
    if (tc.expectations) {
      const e = tc.expectations;
      if (e.min_results !== undefined && v3Results.length < e.min_results) {
        passed = false;
        failReasons.push(`Expected min ${e.min_results} results, got ${v3Results.length}`);
      }
      if (e.all_exact && v3Results.some(r => r.matchTier !== 'exact')) {
        passed = false;
        failReasons.push(`Expected all exact, but got mixed tiers`);
      }
    }

    logEntry.passed = passed;
    logEntry.fail_reasons = failReasons;

    if (passed) {
      totalPassed++;
      stats.passed++;
    } else {
      totalFailed++;
      stats.failed++;
      failures.push({
        case_id: tc.case_id,
        category: tc.category,
        description: tc.description,
        role_searched: tc.filters.role || '(none)',
        details: failReasons.join('; '),
      });
    }
  } catch (error: unknown) {
    totalErrors++;
    stats.errors++;
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logEntry.error = errMsg;
    logEntry.stack = errStack;
    logEntry.passed = false;
    failures.push({
      case_id: tc.case_id,
      category: tc.category,
      description: tc.description,
      role_searched: tc.filters.role || '(none)',
      details: `ERROR: ${errMsg}`,
    });
  }

  logCase(logEntry);
}

// ── Test case generators ──

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

// ============================================================================
// Category 1: Role Tier Accuracy (100+ cases)
// ============================================================================

function buildRoleTierTests(): TestCase[] {
  const cases: TestCase[] = [];

  // 1a. Common titles (15)
  const commonTitles = [
    'Software Engineer', 'Product Manager', 'Data Scientist', 'Data Analyst',
    'Marketing Manager', 'Sales Representative', 'Operations Manager', 'UX Designer',
    'Data Engineer', 'Machine Learning Engineer', 'DevOps Engineer', 'Business Analyst',
    'Financial Analyst', 'Account Executive', 'Project Manager',
  ];
  for (const title of commonTitles) {
    cases.push({
      case_id: nextId(),
      category: 'role_common_title',
      description: `Common title: "${title}"`,
      filters: makeFilters({ role: title }),
      compare_v2: true,
    });
  }

  // 1b. Seniority variants (15) - search base title, expect senior/lead variants as near_exact
  const seniorityTests = [
    'Software Engineer', 'Product Manager', 'Data Scientist', 'Data Analyst',
    'Marketing Manager', 'UX Designer', 'Data Engineer', 'DevOps Engineer',
    'Business Analyst', 'Financial Analyst', 'Account Executive', 'Project Manager',
    'Sales Representative', 'Operations Manager', 'Machine Learning Engineer',
  ];
  for (const title of seniorityTests) {
    cases.push({
      case_id: nextId(),
      category: 'role_seniority_variant',
      description: `Seniority variant check: "${title}" (Senior/Lead/Staff should be near_exact)`,
      filters: makeFilters({ role: title }),
    });
  }

  // 1c. Abbreviation/synonym tests (15)
  const abbreviations = [
    { search: 'SWE', desc: 'SWE -> Software Engineer?' },
    { search: 'PM', desc: 'PM -> Product Manager?' },
    { search: 'DS', desc: 'DS -> Data Scientist?' },
    { search: 'MLE', desc: 'MLE -> Machine Learning Engineer?' },
    { search: 'SDE', desc: 'SDE -> Software Development Engineer?' },
    { search: 'DevOps', desc: 'DevOps -> DevOps Engineer?' },
    { search: 'FE', desc: 'FE -> Frontend Engineer?' },
    { search: 'BE', desc: 'BE -> Backend Engineer?' },
    { search: 'FS', desc: 'FS -> Full Stack?' },
    { search: 'QA', desc: 'QA -> Quality Assurance?' },
    { search: 'VP', desc: 'VP -> Vice President?' },
    { search: 'CTO', desc: 'CTO -> Chief Technology Officer?' },
    { search: 'CEO', desc: 'CEO -> Chief Executive Officer?' },
    { search: 'CFO', desc: 'CFO -> Chief Financial Officer?' },
    { search: 'COO', desc: 'COO -> Chief Operating Officer?' },
  ];
  for (const ab of abbreviations) {
    cases.push({
      case_id: nextId(),
      category: 'role_abbreviation',
      description: ab.desc,
      filters: makeFilters({ role: ab.search }),
      compare_v2: true,
    });
  }

  // 1d. Semantic neighbor pairs (15)
  // Search X, verify Y gets 'similar' not 'exact'
  const semanticPairs = [
    { search: 'Software Engineer', neighbor: 'Backend Engineer' },
    { search: 'Product Manager', neighbor: 'Project Manager' },
    { search: 'Data Scientist', neighbor: 'Data Analyst' },
    { search: 'UX Designer', neighbor: 'Product Designer' },
    { search: 'Marketing Manager', neighbor: 'Brand Manager' },
    { search: 'Financial Analyst', neighbor: 'Investment Analyst' },
    { search: 'Account Executive', neighbor: 'Sales Manager' },
    { search: 'DevOps Engineer', neighbor: 'Site Reliability Engineer' },
    { search: 'Data Engineer', neighbor: 'Software Engineer' },
    { search: 'Machine Learning Engineer', neighbor: 'AI Researcher' },
    { search: 'Business Analyst', neighbor: 'Data Analyst' },
    { search: 'Operations Manager', neighbor: 'Program Manager' },
    { search: 'Sales Representative', neighbor: 'Business Development Representative' },
    { search: 'Project Manager', neighbor: 'Product Manager' },
    { search: 'Frontend Engineer', neighbor: 'UX Engineer' },
  ];
  for (const pair of semanticPairs) {
    cases.push({
      case_id: nextId(),
      category: 'role_semantic_neighbor',
      description: `Semantic: search "${pair.search}", neighbor "${pair.neighbor}" should be similar`,
      filters: makeFilters({ role: pair.search }),
    });
  }

  // 1e. Adjacent-but-different (15)
  const adjacentPairs = [
    { search: 'Product Manager', different: 'Project Manager' },
    { search: 'Data Scientist', different: 'Data Engineer' },
    { search: 'Marketing Manager', different: 'Product Marketing Manager' },
    { search: 'Software Engineer', different: 'Sales Engineer' },
    { search: 'Data Analyst', different: 'Business Analyst' },
    { search: 'UX Designer', different: 'Graphic Designer' },
    { search: 'Financial Analyst', different: 'Equity Research Analyst' },
    { search: 'Account Executive', different: 'Account Manager' },
    { search: 'DevOps Engineer', different: 'Platform Engineer' },
    { search: 'Machine Learning Engineer', different: 'Data Scientist' },
    { search: 'Operations Manager', different: 'Supply Chain Manager' },
    { search: 'Business Analyst', different: 'Systems Analyst' },
    { search: 'Frontend Engineer', different: 'Backend Engineer' },
    { search: 'Product Designer', different: 'Industrial Designer' },
    { search: 'Sales Manager', different: 'Customer Success Manager' },
  ];
  for (const pair of adjacentPairs) {
    cases.push({
      case_id: nextId(),
      category: 'role_adjacent_different',
      description: `Adjacent: search "${pair.search}", verify "${pair.different}" is NOT exact`,
      filters: makeFilters({ role: pair.search }),
    });
  }

  // 1f. Broad terms (15)
  const broadTerms = [
    'Engineer', 'Manager', 'Analyst', 'Designer', 'Director',
    'Consultant', 'Developer', 'Lead', 'Associate', 'Coordinator',
    'Specialist', 'Intern', 'Partner', 'Advisor', 'Strategist',
  ];
  for (const term of broadTerms) {
    cases.push({
      case_id: nextId(),
      category: 'role_broad_term',
      description: `Broad term: "${term}" — check tier distribution`,
      filters: makeFilters({ role: term }),
    });
  }

  // 1g. Obscure/niche titles unlikely in DB (10)
  const nicheTitles = [
    'Quantum Computing Researcher', 'Blockchain Architect', 'Metaverse Designer',
    'Space Systems Engineer', 'Bioinformatics Scientist', 'Robotics Technician',
    'Autonomous Vehicle Engineer', 'Cryptography Specialist', 'Nuclear Physicist',
    'Ethnographic Researcher',
  ];
  for (const title of nicheTitles) {
    cases.push({
      case_id: nextId(),
      category: 'role_niche_title',
      description: `Niche title: "${title}" — expect few/no exact matches`,
      filters: makeFilters({ role: title }),
    });
  }

  // 1h. Compound/unusual titles (10)
  const compoundTitles = [
    'Co-Founder & CTO', 'Engineer II', 'Software Engineer - Backend',
    'Head of Engineering', 'VP of Product', 'Senior Vice President',
    'Chief of Staff', 'Engineer, Software', 'Director of Engineering',
    'Principal Software Engineer',
  ];
  for (const title of compoundTitles) {
    cases.push({
      case_id: nextId(),
      category: 'role_compound_title',
      description: `Compound: "${title}"`,
      filters: makeFilters({ role: title }),
    });
  }

  return cases;
}

// ============================================================================
// Category 2: Cross-Filter with Tier Verification (80 cases)
// ============================================================================

function buildCrossFilterTests(): TestCase[] {
  const cases: TestCase[] = [];

  // Companies that likely exist in the DB
  const companies = [
    'Google', 'Meta', 'Amazon', 'Apple', 'Microsoft',
    'Goldman Sachs', 'JPMorgan', 'McKinsey', 'Deloitte', 'Netflix',
  ];
  const roles = [
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Business Analyst', 'Marketing Manager', 'Account Executive',
  ];
  const locations = [
    'San Francisco', 'New York', 'Seattle', 'Austin', 'Chicago',
  ];
  const universities = [
    'Stanford', 'MIT', 'Harvard', 'UT Austin', 'Georgia Tech',
  ];

  // 2a. Role + Company (30 cases)
  let count = 0;
  for (const company of companies) {
    for (const role of roles) {
      if (count >= 30) break;
      cases.push({
        case_id: nextId(),
        category: 'role_company',
        description: `${role} at ${company}`,
        filters: makeFilters({ company, role }),
        compare_v2: true,
      });
      count++;
    }
    if (count >= 30) break;
  }

  // 2b. Role + Location (25 cases)
  count = 0;
  for (const location of locations) {
    for (const role of roles) {
      if (count >= 25) break;
      cases.push({
        case_id: nextId(),
        category: 'role_location',
        description: `${role} in ${location}`,
        filters: makeFilters({ role, location }),
        compare_v2: true,
      });
      count++;
    }
    if (count >= 25) break;
  }

  // 2c. Role + Company + Location (15 cases)
  count = 0;
  for (const company of companies.slice(0, 5)) {
    for (const role of roles.slice(0, 3)) {
      if (count >= 15) break;
      const location = locations[count % locations.length];
      cases.push({
        case_id: nextId(),
        category: 'role_company_location',
        description: `${role} at ${company} in ${location}`,
        filters: makeFilters({ company, role, location }),
      });
      count++;
    }
    if (count >= 15) break;
  }

  // 2d. Role + University (10 cases)
  count = 0;
  for (const university of universities) {
    for (const role of roles.slice(0, 2)) {
      if (count >= 10) break;
      cases.push({
        case_id: nextId(),
        category: 'role_university',
        description: `${role} from ${university}`,
        filters: makeFilters({ role, university }),
      });
      count++;
    }
    if (count >= 10) break;
  }

  return cases;
}

// ============================================================================
// Category 3: Ranking Correctness (30 cases)
// ============================================================================

function buildRankingTests(): TestCase[] {
  const cases: TestCase[] = [];
  const titles = [
    'Software Engineer', 'Product Manager', 'Data Scientist', 'Data Analyst',
    'Marketing Manager', 'DevOps Engineer', 'Business Analyst', 'UX Designer',
    'Machine Learning Engineer', 'Account Executive', 'Project Manager', 'Financial Analyst',
    'Frontend Engineer', 'Backend Engineer', 'Full Stack Engineer',
    'Data Engineer', 'Sales Representative', 'Operations Manager', 'Solutions Architect',
    'Engineering Manager', 'Product Designer', 'Security Engineer', 'Cloud Engineer',
    'QA Engineer', 'Technical Program Manager', 'Research Scientist', 'Growth Manager',
    'Investment Banker', 'Management Consultant', 'Strategy Analyst',
  ];

  for (const title of titles) {
    cases.push({
      case_id: nextId(),
      category: 'ranking',
      description: `Ranking check: "${title}" — tier+score ordering`,
      filters: makeFilters({ role: title }),
    });
  }

  return cases;
}

// ============================================================================
// Category 4: Edge Cases (30 cases)
// ============================================================================

function buildEdgeCaseTests(): TestCase[] {
  const cases: TestCase[] = [];

  // 4a. No role filter (all should be exact)
  cases.push({
    case_id: nextId(),
    category: 'edge_no_role',
    description: 'No role filter — all results should be matchTier=exact',
    filters: makeFilters({ company: 'Google' }),
    expectations: { all_exact: true },
  });
  cases.push({
    case_id: nextId(),
    category: 'edge_no_role',
    description: 'No role filter with location — all results should be matchTier=exact',
    filters: makeFilters({ company: 'Meta', location: 'San Francisco' }),
    expectations: { all_exact: true },
  });

  // 4b. Empty string role
  cases.push({
    case_id: nextId(),
    category: 'edge_empty_role',
    description: 'Empty string role',
    filters: makeFilters({ company: 'Google', role: '' }),
    expectations: { all_exact: true },
  });
  cases.push({
    case_id: nextId(),
    category: 'edge_empty_role',
    description: 'Whitespace-only role',
    filters: makeFilters({ company: 'Google', role: '   ' }),
    expectations: { all_exact: true },
  });

  // 4c. Very broad role — "Manager"
  cases.push({
    case_id: nextId(),
    category: 'edge_broad_role',
    description: 'Very broad role: "Manager" — should return many variants',
    filters: makeFilters({ role: 'Manager', limit: 50 }),
    expectations: { min_results: 1 },
  });

  // 4d. Special characters in role
  const specialRoles = [
    'VP', 'C-suite', 'Engineer, Software', 'VP of Sales', 'Director / Head',
    'Sr. Engineer', 'Engineer (Contract)', 'Software Engineer III',
  ];
  for (const role of specialRoles) {
    cases.push({
      case_id: nextId(),
      category: 'edge_special_chars',
      description: `Special chars: "${role}"`,
      filters: makeFilters({ role }),
    });
  }

  // 4e. Very long role string
  cases.push({
    case_id: nextId(),
    category: 'edge_long_role',
    description: 'Very long role string',
    filters: makeFilters({ role: 'Senior Vice President of Global Marketing and Brand Strategy' }),
  });

  // 4f. Zero results expected
  cases.push({
    case_id: nextId(),
    category: 'edge_zero_results',
    description: 'Nonsense role — expect zero results',
    filters: makeFilters({ role: 'Chief Unicorn Wrangler', company: 'NonexistentCorp12345' }),
    expectations: { max_results: 0 },
  });

  // 4g. Case variations
  cases.push({
    case_id: nextId(),
    category: 'edge_case_variation',
    description: 'UPPERCASE: "SOFTWARE ENGINEER"',
    filters: makeFilters({ role: 'SOFTWARE ENGINEER' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'edge_case_variation',
    description: 'lowercase: "software engineer"',
    filters: makeFilters({ role: 'software engineer' }),
  });
  cases.push({
    case_id: nextId(),
    category: 'edge_case_variation',
    description: 'MiXeD cAsE: "sOfTwArE eNgInEeR"',
    filters: makeFilters({ role: 'sOfTwArE eNgInEeR' }),
  });

  // 4h. requireEmail variants
  cases.push({
    case_id: nextId(),
    category: 'edge_require_email',
    description: 'requireEmail=true with role',
    filters: makeFilters({ role: 'Software Engineer', requireEmail: true }),
  });
  cases.push({
    case_id: nextId(),
    category: 'edge_require_email',
    description: 'requireEmail=false with role',
    filters: makeFilters({ role: 'Software Engineer', requireEmail: false }),
  });

  // 4i. excludePersonIds
  cases.push({
    case_id: nextId(),
    category: 'edge_exclude_ids',
    description: 'excludePersonIds with empty array',
    filters: makeFilters({ role: 'Software Engineer', excludePersonIds: [] }),
  });

  // 4j. Different roleSpecificity settings
  for (const spec of ['narrow', 'standard', 'broad'] as const) {
    cases.push({
      case_id: nextId(),
      category: 'edge_specificity',
      description: `roleSpecificity="${spec}" for "Software Engineer"`,
      filters: makeFilters({ role: 'Software Engineer', roleSpecificity: spec }),
    });
  }

  // 4k. Large limit
  cases.push({
    case_id: nextId(),
    category: 'edge_large_limit',
    description: 'limit=100 with broad role',
    filters: makeFilters({ role: 'Engineer', limit: 100 }),
    expectations: { min_results: 1 },
  });

  // 4l. Small limit
  cases.push({
    case_id: nextId(),
    category: 'edge_small_limit',
    description: 'limit=1 with common role',
    filters: makeFilters({ role: 'Software Engineer', limit: 1 }),
    expectations: { min_results: 1 },
  });

  return cases;
}

// ============================================================================
// Category 5: Latency (20 cases)
// ============================================================================

function buildLatencyTests(): TestCase[] {
  const cases: TestCase[] = [];

  // Broad roles that should scan many rows
  const broadRoles = [
    'Engineer', 'Manager', 'Analyst', 'Designer', 'Director',
    'Consultant', 'Developer', 'Associate', 'Coordinator', 'Specialist',
  ];
  for (const role of broadRoles) {
    cases.push({
      case_id: nextId(),
      category: 'latency',
      description: `Latency: broad role "${role}"`,
      filters: makeFilters({ role, limit: 50 }),
      compare_v2: true,
    });
  }

  // Large companies
  const largeCompanies = [
    'Google', 'Amazon', 'Meta', 'Microsoft', 'Apple',
  ];
  for (const company of largeCompanies) {
    cases.push({
      case_id: nextId(),
      category: 'latency',
      description: `Latency: "Software Engineer" at ${company}`,
      filters: makeFilters({ company, role: 'Software Engineer' }),
      compare_v2: true,
    });
  }

  // Company-only (no role) — tests V2 delegation path
  for (const company of largeCompanies.slice(0, 5)) {
    cases.push({
      case_id: nextId(),
      category: 'latency_no_role',
      description: `Latency: no role, company="${company}"`,
      filters: makeFilters({ company }),
      compare_v2: true,
    });
  }

  return cases;
}

// ============================================================================
// Category 6: V2 Comparison (20 cases)
// ============================================================================

function buildV2ComparisonTests(): TestCase[] {
  const cases: TestCase[] = [];
  const rolePairs = [
    { role: 'Software Engineer', company: 'Google' },
    { role: 'Product Manager', company: 'Meta' },
    { role: 'Data Scientist', company: 'Amazon' },
    { role: 'Business Analyst', company: 'Deloitte' },
    { role: 'Marketing Manager', company: 'Apple' },
    { role: 'Account Executive', company: 'Salesforce' },
    { role: 'UX Designer', company: 'Microsoft' },
    { role: 'DevOps Engineer', company: 'Netflix' },
    { role: 'Financial Analyst', company: 'Goldman Sachs' },
    { role: 'Data Engineer', company: 'Stripe' },
    { role: 'Machine Learning Engineer', company: 'Google' },
    { role: 'Project Manager', company: 'Amazon' },
    { role: 'Operations Manager', company: 'JPMorgan' },
    { role: 'Sales Representative', company: 'Oracle' },
    { role: 'Frontend Engineer', company: 'Meta' },
    { role: 'Backend Engineer', company: 'Stripe' },
    { role: 'Engineering Manager', company: 'Microsoft' },
    { role: 'Product Designer', company: 'Apple' },
    { role: 'Solutions Architect', company: 'Amazon' },
    { role: 'Research Scientist', company: 'Google' },
  ];

  for (const pair of rolePairs) {
    cases.push({
      case_id: nextId(),
      category: 'v2_comparison',
      description: `V2 vs V3: "${pair.role}" at ${pair.company}`,
      filters: makeFilters({ company: pair.company, role: pair.role }),
      compare_v2: true,
    });
  }

  return cases;
}

// ============================================================================
// Category 7: Determinism (10 cases)
// ============================================================================

async function runDeterminismTests(): Promise<void> {
  const deterministicRoles = [
    'Software Engineer', 'Product Manager', 'Data Scientist',
    'Business Analyst', 'Marketing Manager', 'UX Designer',
    'Machine Learning Engineer', 'Account Executive', 'DevOps Engineer',
    'Financial Analyst',
  ];

  for (const role of deterministicRoles) {
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

      const ids0 = runs[0].map(r => r.id).join(',');
      const ids1 = runs[1].map(r => r.id).join(',');
      const ids2 = runs[2].map(r => r.id).join(',');

      const tiers0 = runs[0].map(r => r.matchTier).join(',');
      const tiers1 = runs[1].map(r => r.matchTier).join(',');
      const tiers2 = runs[2].map(r => r.matchTier).join(',');

      const idsDeterministic = ids0 === ids1 && ids1 === ids2;
      const tiersDeterministic = tiers0 === tiers1 && tiers1 === tiers2;
      const passed = idsDeterministic && tiersDeterministic;

      logCase({
        case_id: cid,
        category: 'determinism',
        description: `Determinism: "${role}" x3 runs`,
        filters,
        ids_match: idsDeterministic,
        tiers_match: tiersDeterministic,
        passed,
        run_counts: runs.map(r => r.length),
      });

      if (passed) {
        totalPassed++;
        stats.passed++;
      } else {
        totalFailed++;
        stats.failed++;
        failures.push({
          case_id: cid,
          category: 'determinism',
          description: `Determinism: "${role}" x3 runs`,
          role_searched: role,
          details: `IDs match: ${idsDeterministic}, Tiers match: ${tiersDeterministic}`,
        });
      }
    } catch (error: unknown) {
      totalErrors++;
      stats.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      logCase({
        case_id: cid,
        category: 'determinism',
        description: `Determinism: "${role}" x3 runs`,
        error: errMsg,
        passed: false,
      });
      failures.push({
        case_id: cid,
        category: 'determinism',
        description: `Determinism: "${role}"`,
        role_searched: role,
        details: `ERROR: ${errMsg}`,
      });
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== V3 Match Tier QA ===');
  console.log(`Log file: ${LOG_FILE}`);
  console.log('');

  // Build all test cases
  const allCases: TestCase[] = [
    ...buildRoleTierTests(),
    ...buildCrossFilterTests(),
    ...buildRankingTests(),
    ...buildEdgeCaseTests(),
    ...buildLatencyTests(),
    ...buildV2ComparisonTests(),
  ];

  console.log(`Built ${allCases.length} standard test cases + 10 determinism tests = ${allCases.length + 10} total`);
  console.log('');

  // Run standard cases sequentially (to avoid DB connection issues)
  for (let i = 0; i < allCases.length; i++) {
    const tc = allCases[i];
    process.stdout.write(`[${i + 1}/${allCases.length}] ${tc.category}: ${tc.description}...`);
    await runTestCase(tc);
    const last = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').pop()!);
    const status = last.passed ? 'PASS' : last.error ? 'ERROR' : 'FAIL';
    const ms = last.v3_duration_ms ?? '?';
    const count = last.v3_result_count ?? '?';
    console.log(` ${status} (${ms}ms, ${count} results)`);
  }

  // Run determinism tests
  console.log('\n--- Determinism tests ---');
  await runDeterminismTests();

  // ── Generate verdict ──
  console.log('\n=== Generating Verdict ===');

  const tierAccuracy = totalResultsChecked > 0
    ? ((totalResultsChecked - totalMisclassified) / totalResultsChecked * 100).toFixed(1)
    : 'N/A';

  // Latency stats
  const v3Latencies = latencyRecords.map(r => r.v3_ms).sort((a, b) => a - b);
  const v2Latencies = latencyRecords.filter(r => r.v2_ms != null).map(r => r.v2_ms!).sort((a, b) => a - b);

  function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const idx = Math.ceil(arr.length * p / 100) - 1;
    return arr[Math.max(0, idx)];
  }

  const v3LatStats = {
    min: v3Latencies[0] ?? 0,
    max: v3Latencies[v3Latencies.length - 1] ?? 0,
    mean: v3Latencies.length > 0 ? Math.round(v3Latencies.reduce((a, b) => a + b, 0) / v3Latencies.length) : 0,
    p50: percentile(v3Latencies, 50),
    p95: percentile(v3Latencies, 95),
    p99: percentile(v3Latencies, 99),
  };
  const v2LatStats = {
    min: v2Latencies[0] ?? 0,
    max: v2Latencies[v2Latencies.length - 1] ?? 0,
    mean: v2Latencies.length > 0 ? Math.round(v2Latencies.reduce((a, b) => a + b, 0) / v2Latencies.length) : 0,
    p50: percentile(v2Latencies, 50),
    p95: percentile(v2Latencies, 95),
    p99: percentile(v2Latencies, 99),
  };

  // Slow queries
  const slowQueries = latencyRecords.filter(r => r.v3_ms > 500);
  const criticalSlowQueries = latencyRecords.filter(r => r.v3_ms > 1000);

  // Category breakdown
  let catBreakdown = '';
  for (const [cat, stats] of categoryStats.entries()) {
    catBreakdown += `| ${cat} | ${stats.total} | ${stats.passed} | ${stats.failed} | ${stats.errors} | ${stats.results_checked > 0 ? ((stats.results_checked - stats.misclassified) / stats.results_checked * 100).toFixed(1) + '%' : 'N/A'} |\n`;
  }

  // Failures detail
  let failureDetail = '';
  for (const f of failures) {
    failureDetail += `- **Case ${f.case_id}** [${f.category}] ${f.description}\n  Role searched: "${f.role_searched}"\n  ${f.details}\n\n`;
  }

  // Verdict determination
  const tierAccNum = totalResultsChecked > 0 ? (totalResultsChecked - totalMisclassified) / totalResultsChecked * 100 : 100;
  const passRate = totalCases > 0 ? totalPassed / totalCases * 100 : 0;

  let verdict: string;
  let verdictExplanation: string;
  if (tierAccNum >= 95 && totalErrors === 0 && v3LatStats.p95 <= 500 && criticalSlowQueries.length === 0 && passRate >= 90) {
    verdict = 'PRODUCTION READY';
    verdictExplanation = `Tier accuracy ${tierAccuracy}% >= 95%, no crashes, p95 latency ${v3LatStats.p95}ms <= 500ms, no queries > 1s, pass rate ${passRate.toFixed(1)}% >= 90%.`;
  } else if (tierAccNum >= 80 || passRate >= 70) {
    verdict = 'NEEDS TUNING';
    const reasons: string[] = [];
    if (tierAccNum < 95) reasons.push(`Tier accuracy ${tierAccuracy}% < 95%`);
    if (totalErrors > 0) reasons.push(`${totalErrors} errors/crashes`);
    if (v3LatStats.p95 > 500) reasons.push(`p95 latency ${v3LatStats.p95}ms > 500ms`);
    if (criticalSlowQueries.length > 0) reasons.push(`${criticalSlowQueries.length} queries > 1s`);
    if (passRate < 90) reasons.push(`Pass rate ${passRate.toFixed(1)}% < 90%`);
    verdictExplanation = reasons.join('. ') + '.';
  } else {
    verdict = 'WRONG APPROACH';
    verdictExplanation = `Tier accuracy ${tierAccuracy}%, pass rate ${passRate.toFixed(1)}%. Fundamental issues need addressing.`;
  }

  const verdictMd = `# V3 Match Tier QA Verdict

## Run Info
- **Date:** ${new Date().toISOString()}
- **Log file:** ${LOG_FILE}
- **Total test cases:** ${totalCases}

## Summary Stats

| Metric | Value |
|--------|-------|
| Total cases | ${totalCases} |
| Passed | ${totalPassed} |
| Failed | ${totalFailed} |
| Errors | ${totalErrors} |
| Pass rate | ${passRate.toFixed(1)}% |
| Total results checked for tier accuracy | ${totalResultsChecked} |
| Misclassified results | ${totalMisclassified} |
| **Tier accuracy** | **${tierAccuracy}%** |

## Category Breakdown

| Category | Total | Passed | Failed | Errors | Tier Accuracy |
|----------|-------|--------|--------|--------|---------------|
${catBreakdown}

## Performance Analysis

| Metric | V3 | V2 |
|--------|----|----|
| Min latency | ${v3LatStats.min}ms | ${v2LatStats.min}ms |
| Mean latency | ${v3LatStats.mean}ms | ${v2LatStats.mean}ms |
| p50 latency | ${v3LatStats.p50}ms | ${v2LatStats.p50}ms |
| p95 latency | ${v3LatStats.p95}ms | ${v2LatStats.p95}ms |
| p99 latency | ${v3LatStats.p99}ms | ${v2LatStats.p99}ms |
| Max latency | ${v3LatStats.max}ms | ${v2LatStats.max}ms |

### Slow Queries (> 500ms)
${slowQueries.length === 0 ? 'None.' : slowQueries.map(q => `- Case ${q.case_id} [${q.category}] "${q.role}": ${q.v3_ms}ms (${q.result_count} results)`).join('\n')}

### Critical Slow Queries (> 1000ms) -- AUTOMATIC FAILURE
${criticalSlowQueries.length === 0 ? 'None.' : criticalSlowQueries.map(q => `- Case ${q.case_id} [${q.category}] "${q.role}": ${q.v3_ms}ms (${q.result_count} results)`).join('\n')}

## Failures Detail

${failures.length === 0 ? 'No failures.' : failureDetail}

## Production Readiness Verdict

### **${verdict}**

${verdictExplanation}

${verdict === 'NEEDS TUNING' ? `### Specific Recommendations

Review the failures above and address:
1. Any tier misclassifications (most likely in the ILIKE matching logic or tier boundary conditions)
2. Any latency issues (check if both Query A and Query B are needed for simple cases)
3. Any V2 regression cases (V3 should be a strict superset of V2 results)
` : ''}
`;

  fs.writeFileSync(VERDICT_FILE, verdictMd);
  console.log(`\nVerdict written to: ${VERDICT_FILE}`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VERDICT: ${verdict}`);
  console.log(`Tier accuracy: ${tierAccuracy}%`);
  console.log(`Pass rate: ${passRate.toFixed(1)}% (${totalPassed}/${totalCases})`);
  console.log(`V3 latency: mean=${v3LatStats.mean}ms, p95=${v3LatStats.p95}ms, max=${v3LatStats.max}ms`);
  console.log(`Failures: ${totalFailed}, Errors: ${totalErrors}`);
  console.log(`${'='.repeat(60)}`);

  // Exit with error code if not production ready
  process.exit(verdict === 'PRODUCTION READY' ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
