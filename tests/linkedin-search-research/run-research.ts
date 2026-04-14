/**
 * LinkedIn Search Optimization Research
 *
 * Systematically tests the Apify `harvestapi/linkedin-profile-search` actor
 * to understand parameter behavior and build a definitive system prompt.
 *
 * Budget: $10 (~100 queries at $0.10/page)
 *
 * Usage:
 *   npx tsx tests/linkedin-search-research/run-research.ts
 *   npx tsx tests/linkedin-search-research/run-research.ts --start=15  # Resume from query 15
 *   npx tsx tests/linkedin-search-research/run-research.ts --only=5,6,7  # Run specific queries
 */

import 'dotenv/config';
process.env.DISCOVERY_LOGGER_ENABLED = '1';

import { searchLinkedInShort, type LinkedInSearchParams, type ShortProfileResult, type LinkedInSearchResult } from '../../src/lib/services/linkedin-search';
import { appendFile, writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const startArg = args.find(a => a.startsWith('--start='));
const onlyArg = args.find(a => a.startsWith('--only='));
const startFrom = startArg ? parseInt(startArg.split('=')[1], 10) : 0;
const onlyIds = onlyArg ? onlyArg.split('=')[1].split(',').map(Number) : null;

// ─── Paths ────────────────────────────────────────────────────────────────────

const RESEARCH_DIR = join(__dirname);
const LOG_FILE = join(RESEARCH_DIR, 'search_log.jsonl');
const FINDINGS_FILE = join(RESEARCH_DIR, 'findings.md');

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResearchQuery {
  id: number;
  phase: string;
  question: string;
  hypothesis: string;
  params: LinkedInSearchParams;
  /** Compare against this query to evaluate behavior */
  compareWith?: number;
  /** Tags for filtering/grouping */
  tags: string[];
}

interface LogEntry {
  query_number: number;
  phase: string;
  question_being_tested: string;
  hypothesis: string;
  params: LinkedInSearchParams;
  total_elements: number;
  results_returned: number;
  valid: number;
  invalid: number;
  precision: number;
  sample_profiles: Array<{
    name: string;
    title: string;
    company: string;
    location: string;
  }>;
  invalid_breakdown: Array<{
    index: number;
    name: string;
    title: string;
    company: string;
    reason: string;
  }>;
  observations: string[];
  confirmed: string;
  new_questions: string[];
  confidence_tier: string;
  tags: string[];
  cost_usd: number;
  duration_ms: number;
  budget_remaining: number;
}

// ─── Research Queries ─────────────────────────────────────────────────────────
// Designed to answer the unknowns in CLAUDE.md tiers

const QUERIES: ResearchQuery[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Critical Unknowns — searchQuery behavior
  // ═══════════════════════════════════════════════════════════════════════════

  // Q1: searchQuery alone — what does it match against?
  {
    id: 1,
    phase: 'tier1-searchQuery',
    question: 'Does searchQuery alone return relevant results? What fields does it match?',
    hypothesis: 'searchQuery "kubernetes" will return profiles mentioning kubernetes in title, headline, or skills',
    params: { searchQuery: 'kubernetes', locations: ['San Francisco'] },
    tags: ['searchQuery', 'keyword-matching', 'field-scope'],
  },

  // Q2: searchQuery with quotes vs without
  {
    id: 2,
    phase: 'tier1-searchQuery',
    question: 'Does quoting searchQuery change matching? "machine learning" vs machine learning',
    hypothesis: 'Quoted searchQuery will return more focused results than unquoted',
    params: { searchQuery: '"machine learning"', locations: ['San Francisco'] },
    tags: ['searchQuery', 'operators', 'quotes'],
  },
  {
    id: 3,
    phase: 'tier1-searchQuery',
    question: 'Unquoted multi-word searchQuery for comparison with Q2',
    hypothesis: 'Unquoted will return similar or same results as quoted — LinkedIn may not support quote operators',
    params: { searchQuery: 'machine learning', locations: ['San Francisco'] },
    compareWith: 2,
    tags: ['searchQuery', 'operators', 'quotes'],
  },

  // Q4: searchQuery + currentJobTitles interaction
  {
    id: 4,
    phase: 'tier1-searchQuery',
    question: 'How does searchQuery interact with currentJobTitles? AND or OR?',
    hypothesis: 'searchQuery "python" + currentJobTitles ["Software Engineer"] will AND them — return SWEs who also mention python',
    params: { searchQuery: 'python', currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['searchQuery', 'filter-interaction', 'currentJobTitles'],
  },

  // Q5: searchQuery "python" alone for comparison
  {
    id: 5,
    phase: 'tier1-searchQuery',
    question: 'searchQuery "python" alone — baseline for comparison with Q4',
    hypothesis: 'Will return broader results including non-engineers who mention python',
    params: { searchQuery: 'python', locations: ['San Francisco'] },
    compareWith: 4,
    tags: ['searchQuery', 'baseline'],
  },

  // Q6: Does searchQuery support AND/OR operators?
  {
    id: 6,
    phase: 'tier1-searchQuery',
    question: 'Does searchQuery support AND operator?',
    hypothesis: 'searchQuery "python AND kubernetes" may not support boolean operators — likely treated as literal text',
    params: { searchQuery: 'python AND kubernetes', locations: ['San Francisco'] },
    tags: ['searchQuery', 'operators', 'boolean'],
  },

  // Q7: Does searchQuery support OR operator?
  {
    id: 7,
    phase: 'tier1-searchQuery',
    question: 'Does searchQuery support OR operator?',
    hypothesis: 'searchQuery "python OR golang" probably treated as literal keywords',
    params: { searchQuery: 'python OR golang', locations: ['San Francisco'] },
    tags: ['searchQuery', 'operators', 'boolean'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: currentJobTitles precision
  // ═══════════════════════════════════════════════════════════════════════════

  // Q8: Is currentJobTitles exact or fuzzy?
  {
    id: 8,
    phase: 'tier1-titlePrecision',
    question: 'Does currentJobTitles "Software Engineer" return exact match only or also fuzzy matches like "Senior Software Engineer"?',
    hypothesis: 'Will return fuzzy matches — "Software Engineer" will also match Senior, Staff, Lead variations',
    params: { currentJobTitles: ['Software Engineer'], locations: ['San Francisco'], currentCompanies: ['https://www.linkedin.com/company/google'] },
    tags: ['currentJobTitles', 'fuzzy-matching', 'precision'],
  },

  // Q9: Exact niche title test
  {
    id: 9,
    phase: 'tier1-titlePrecision',
    question: 'Does a very specific title like "Staff Software Engineer" match only staff level?',
    hypothesis: 'More specific title will still be fuzzy — may also return "Software Engineer" without Staff prefix',
    params: { currentJobTitles: ['Staff Software Engineer'], locations: ['San Francisco'] },
    tags: ['currentJobTitles', 'fuzzy-matching', 'specificity'],
  },

  // Q10: Multiple titles — OR logic?
  {
    id: 10,
    phase: 'tier1-titlePrecision',
    question: 'Are multiple currentJobTitles treated as OR? ["Product Manager", "Program Manager"]',
    hypothesis: 'Multiple titles will be OR — results will include both PMs and PgMs',
    params: { currentJobTitles: ['Product Manager', 'Program Manager'], locations: ['New York'] },
    tags: ['currentJobTitles', 'OR-logic', 'multiple-values'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Location behavior
  // ═══════════════════════════════════════════════════════════════════════════

  // Q11: City-level location
  {
    id: 11,
    phase: 'tier1-location',
    question: 'Does locations "San Francisco" match metro area or just city?',
    hypothesis: 'Will match greater SF metro area including nearby cities',
    params: { currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['locations', 'metro-area', 'city'],
  },

  // Q12: State-level location
  {
    id: 12,
    phase: 'tier1-location',
    question: 'Does locations "California" work as a state-level filter?',
    hypothesis: 'State name will work and return results from across California',
    params: { currentJobTitles: ['Software Engineer'], locations: ['California'] },
    tags: ['locations', 'state-level'],
  },

  // Q13: Country-level location
  {
    id: 13,
    phase: 'tier1-location',
    question: 'Does locations "United States" work as country-level filter?',
    hypothesis: 'Country name will work and return results from across the US',
    params: { currentJobTitles: ['Product Manager'], locations: ['United States'] },
    tags: ['locations', 'country-level'],
  },

  // Q14: Abbreviated location
  {
    id: 14,
    phase: 'tier1-location',
    question: 'Does abbreviated state name "CA" work?',
    hypothesis: 'Abbreviated "CA" may not work or may return different results than "California"',
    params: { currentJobTitles: ['Software Engineer'], locations: ['CA'] },
    compareWith: 12,
    tags: ['locations', 'abbreviation'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Filter stacking / interactions
  // ═══════════════════════════════════════════════════════════════════════════

  // Q15: currentJobTitles + functionIds — conflict or complement?
  {
    id: 15,
    phase: 'tier1-filterInteraction',
    question: 'What happens when currentJobTitles and functionIds are both set?',
    hypothesis: 'They will AND together — only return people matching both title AND function',
    params: { currentJobTitles: ['Software Engineer'], functionIds: ['8'], locations: ['San Francisco'] },
    tags: ['filter-interaction', 'currentJobTitles', 'functionIds'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE GATE — stop after Q15, review, update findings
  // ═══════════════════════════════════════════════════════════════════════════

  // Q16: currentJobTitles alone for comparison with Q15
  {
    id: 16,
    phase: 'tier1-filterInteraction',
    question: 'currentJobTitles alone — baseline to compare with Q15 (title + functionId)',
    hypothesis: 'Should return similar count but possibly more varied function categories',
    params: { currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    compareWith: 15,
    tags: ['filter-interaction', 'baseline', 'currentJobTitles'],
  },

  // Q17: functionIds alone
  {
    id: 17,
    phase: 'tier1-filterInteraction',
    question: 'functionIds alone — does it return all Engineering roles regardless of title?',
    hypothesis: 'functionIds ["8"] (Engineering) alone will return diverse engineering titles',
    params: { functionIds: ['8'], locations: ['San Francisco'], currentCompanies: ['https://www.linkedin.com/company/google'] },
    tags: ['functionIds', 'baseline'],
  },

  // Q18: Heavy filter stacking — many filters at once
  {
    id: 18,
    phase: 'tier1-filterInteraction',
    question: 'Does stacking 4+ filters degrade results or just narrow them?',
    hypothesis: 'Heavy stacking will work as AND but may return 0 results if too narrow',
    params: {
      currentJobTitles: ['Software Engineer'],
      functionIds: ['8'],
      seniorityLevelIds: ['120'],
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
    },
    tags: ['filter-interaction', 'stacking', 'degradation'],
  },

  // Q19: searchQuery + company filter — does company in searchQuery conflict?
  {
    id: 19,
    phase: 'tier1-searchQuery',
    question: 'What happens if company name appears in searchQuery AND currentCompanies?',
    hypothesis: 'Putting "Google" in searchQuery while also using currentCompanies URL will be redundant but not harmful',
    params: {
      searchQuery: 'Google',
      currentCompanies: ['https://www.linkedin.com/company/google'],
      currentJobTitles: ['Software Engineer'],
    },
    tags: ['searchQuery', 'currentCompanies', 'redundancy'],
  },

  // Q20: Company name in searchQuery WITHOUT currentCompanies
  {
    id: 20,
    phase: 'tier1-searchQuery',
    question: 'Can searchQuery be used to filter by company name instead of currentCompanies?',
    hypothesis: 'Putting "Stripe" in searchQuery will match people who mention Stripe broadly, not just current employees',
    params: { searchQuery: 'Stripe', currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['searchQuery', 'company-in-query'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Seniority & function accuracy
  // ═══════════════════════════════════════════════════════════════════════════

  // Q21: seniorityLevelIds accuracy — does "120" (Senior) actually filter seniors?
  {
    id: 21,
    phase: 'tier2-seniority',
    question: 'Does seniorityLevelIds ["120"] (Senior) actually return senior-level people?',
    hypothesis: 'Seniority is LinkedIn automated classification — may be inaccurate for many profiles',
    params: { seniorityLevelIds: ['120'], locations: ['San Francisco'], currentCompanies: ['https://www.linkedin.com/company/google'] },
    tags: ['seniorityLevelIds', 'accuracy'],
  },

  // Q22: seniorityLevelIds "300" (VP) — more obvious seniority
  {
    id: 22,
    phase: 'tier2-seniority',
    question: 'Does seniorityLevelIds "300" (VP) return actual VPs?',
    hypothesis: 'VP level should be more accurately classified since it is a clearer title',
    params: { seniorityLevelIds: ['300'], locations: ['New York'], functionIds: ['25'] },
    tags: ['seniorityLevelIds', 'VP-level', 'accuracy'],
  },

  // Q23: seniorityLevelIds "310" (CXO) — C-suite
  {
    id: 23,
    phase: 'tier2-seniority',
    question: 'Does seniorityLevelIds "310" (CXO) return actual C-level executives?',
    hypothesis: 'CXO filter should be quite accurate since C-level titles are distinctive',
    params: { seniorityLevelIds: ['310'], locations: ['San Francisco'] },
    tags: ['seniorityLevelIds', 'CXO', 'accuracy'],
  },

  // Q24: functionIds "25" (Sales) accuracy
  {
    id: 24,
    phase: 'tier2-function',
    question: 'Does functionIds "25" (Sales) accurately return sales professionals?',
    hypothesis: 'Sales function should be reasonably accurate based on titles like AE, SDR, Account Exec',
    params: { functionIds: ['25'], locations: ['New York'], currentCompanies: ['https://www.linkedin.com/company/salesforce'] },
    tags: ['functionIds', 'sales', 'accuracy'],
  },

  // Q25: functionIds "19" (Product Mgmt) accuracy
  {
    id: 25,
    phase: 'tier2-function',
    question: 'Does functionIds "19" (Product Mgmt) return product people?',
    hypothesis: 'Product management function should be reasonably accurate',
    params: { functionIds: ['19'], locations: ['San Francisco'], currentCompanies: ['https://www.linkedin.com/company/meta'] },
    tags: ['functionIds', 'product-management', 'accuracy'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Company filters
  // ═══════════════════════════════════════════════════════════════════════════

  // Q26: companyHeadcount filter
  {
    id: 26,
    phase: 'tier2-company',
    question: 'Does companyHeadcount "E" (201-500) actually filter by company size?',
    hypothesis: 'Will return people at companies with 201-500 employees — useful for "Series B" approximation',
    params: { companyHeadcount: ['E'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['companyHeadcount', 'company-size'],
  },

  // Q27: companyHeadcount multiple values — OR logic?
  {
    id: 27,
    phase: 'tier2-company',
    question: 'Are multiple companyHeadcount values OR? ["D","E"] (51-500)',
    hypothesis: 'Multiple values will be OR — return people at companies in either size range',
    params: { companyHeadcount: ['D', 'E'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    compareWith: 26,
    tags: ['companyHeadcount', 'OR-logic'],
  },

  // Q28: currentCompanies URL sensitivity — trailing slash
  {
    id: 28,
    phase: 'tier2-company',
    question: 'Does trailing slash in company URL matter?',
    hypothesis: 'Trailing slash should not matter — both formats should work',
    params: { currentCompanies: ['https://www.linkedin.com/company/stripe/'], currentJobTitles: ['Software Engineer'] },
    tags: ['currentCompanies', 'URL-format', 'trailing-slash'],
  },

  // Q29: companyHeadquarterLocations vs locations
  {
    id: 29,
    phase: 'tier2-company',
    question: 'What does companyHeadquarterLocations filter? Company HQ location or person location?',
    hypothesis: 'companyHeadquarterLocations filters by where the company is HQed, not where the person is',
    params: { companyHeadquarterLocations: ['San Francisco'], currentJobTitles: ['Software Engineer'] },
    tags: ['companyHeadquarterLocations', 'locations', 'distinction'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE GATE — stop after Q30, review, update findings
  // ═══════════════════════════════════════════════════════════════════════════

  // Q30: companyHeadquarterLocations + locations — can use both?
  {
    id: 30,
    phase: 'tier2-company',
    question: 'Can you use both locations and companyHeadquarterLocations simultaneously?',
    hypothesis: 'Both filters should AND together — person in NYC at company HQed in SF',
    params: { locations: ['New York'], companyHeadquarterLocations: ['San Francisco'], currentJobTitles: ['Software Engineer'] },
    tags: ['companyHeadquarterLocations', 'locations', 'combined'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Exclude filters
  // ═══════════════════════════════════════════════════════════════════════════

  // Q31: Baseline for exclude test
  {
    id: 31,
    phase: 'tier2-exclude',
    question: 'Baseline: SWEs at Google in SF — for exclude filter comparison',
    hypothesis: 'Establish baseline results to compare with Q32 exclude',
    params: { currentJobTitles: ['Software Engineer'], locations: ['San Francisco'], currentCompanies: ['https://www.linkedin.com/company/google'] },
    tags: ['exclude', 'baseline'],
  },

  // Q32: excludeCurrentJobTitles
  {
    id: 32,
    phase: 'tier2-exclude',
    question: 'Does excludeCurrentJobTitles work? Exclude "Software Engineer" from Google SF',
    hypothesis: 'Excluding SWE from Google SF should remove software engineers and return other roles',
    params: {
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      excludeCurrentJobTitles: ['Software Engineer'],
    },
    compareWith: 31,
    tags: ['exclude', 'excludeCurrentJobTitles'],
  },

  // Q33: excludeLocations
  {
    id: 33,
    phase: 'tier2-exclude',
    question: 'Does excludeLocations work? SWEs at Google excluding SF',
    hypothesis: 'excludeLocations should remove people in SF — results will be from other cities',
    params: {
      currentJobTitles: ['Software Engineer'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      excludeLocations: ['San Francisco'],
    },
    compareWith: 31,
    tags: ['exclude', 'excludeLocations'],
  },

  // Q34: excludeSeniorityLevelIds
  {
    id: 34,
    phase: 'tier2-exclude',
    question: 'Does excludeSeniorityLevelIds work? Exclude entry-level from engineering results',
    hypothesis: 'Excluding entry-level (110) should remove junior profiles',
    params: {
      functionIds: ['8'],
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/meta'],
      excludeSeniorityLevelIds: ['100', '110'],
    },
    tags: ['exclude', 'excludeSeniorityLevelIds'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: Pagination & totalElements
  // ═══════════════════════════════════════════════════════════════════════════

  // Q35: Page 1 for consistency test
  {
    id: 35,
    phase: 'tier2-pagination',
    question: 'Page 1 baseline — are results consistent?',
    hypothesis: 'Page 1 results should be consistent across calls (within short timeframe)',
    params: { currentJobTitles: ['Product Manager'], locations: ['New York'], startPage: 1 },
    tags: ['pagination', 'consistency', 'page1'],
  },

  // Q36: Page 2 of same query
  {
    id: 36,
    phase: 'tier2-pagination',
    question: 'Page 2 — are results different from page 1? No overlap?',
    hypothesis: 'Page 2 will have different profiles than page 1 with no duplicates',
    params: { currentJobTitles: ['Product Manager'], locations: ['New York'], startPage: 2 },
    compareWith: 35,
    tags: ['pagination', 'page2', 'no-overlap'],
  },

  // Q37: Page 5 — deep pagination
  {
    id: 37,
    phase: 'tier2-pagination',
    question: 'Do results degrade at page 5? Less relevant?',
    hypothesis: 'Results at page 5 should still be relevant but may be less precisely sorted',
    params: { currentJobTitles: ['Product Manager'], locations: ['New York'], startPage: 5 },
    compareWith: 35,
    tags: ['pagination', 'deep-page', 'degradation'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: pastCompanies filter
  // ═══════════════════════════════════════════════════════════════════════════

  // Q38: pastCompanies with URL
  {
    id: 38,
    phase: 'tier2-pastCompanies',
    question: 'Does pastCompanies filter work with LinkedIn URL?',
    hypothesis: 'pastCompanies should return people who PREVIOUSLY worked at the company',
    params: { pastCompanies: ['https://www.linkedin.com/company/google'], locations: ['San Francisco'], currentJobTitles: ['Software Engineer'] },
    tags: ['pastCompanies', 'accuracy'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Schools filter
  // ═══════════════════════════════════════════════════════════════════════════

  // Q39: schools with full name
  {
    id: 39,
    phase: 'tier3-schools',
    question: 'Does schools filter with full name work? "Stanford University"',
    hypothesis: 'Full university name should work well',
    params: { schools: ['Stanford University'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['schools', 'full-name'],
  },

  // Q40: schools with abbreviation
  {
    id: 40,
    phase: 'tier3-schools',
    question: 'Does schools filter with abbreviation work? "MIT"',
    hypothesis: 'Abbreviation may or may not work — LinkedIn may require full name',
    params: { schools: ['MIT'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['schools', 'abbreviation'],
  },

  // Q41: schools full name for MIT comparison
  {
    id: 41,
    phase: 'tier3-schools',
    question: 'schools with full name "Massachusetts Institute of Technology" — compare with Q40',
    hypothesis: 'Full name should work — compare count with abbreviated version',
    params: { schools: ['Massachusetts Institute of Technology'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    compareWith: 40,
    tags: ['schools', 'full-name', 'MIT'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: recentlyChangedJobs
  // ═══════════════════════════════════════════════════════════════════════════

  // Q42: recentlyChangedJobs filter
  {
    id: 42,
    phase: 'tier3-recentlyChangedJobs',
    question: 'Does recentlyChangedJobs work? How recent is "recently"?',
    hypothesis: 'Will return people who changed jobs in last ~90 days based on LinkedIn criteria',
    params: { recentlyChangedJobs: true, locations: ['San Francisco'], currentJobTitles: ['Software Engineer'] },
    tags: ['recentlyChangedJobs', 'recency'],
  },

  // Q43: recentlyChangedJobs + company — recently joined specific company
  {
    id: 43,
    phase: 'tier3-recentlyChangedJobs',
    question: 'recentlyChangedJobs + currentCompanies — recently joined a specific company',
    hypothesis: 'Should narrow to people who recently started at the company — useful for networking',
    params: { recentlyChangedJobs: true, currentCompanies: ['https://www.linkedin.com/company/stripe'] },
    tags: ['recentlyChangedJobs', 'currentCompanies', 'combined'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: yearsOfExperience
  // ═══════════════════════════════════════════════════════════════════════════

  // Q44: yearsOfExperienceIds ["5"] (10+ years)
  {
    id: 44,
    phase: 'tier3-experience',
    question: 'Does yearsOfExperienceIds "5" (10+yr) filter accurately?',
    hypothesis: 'Should return experienced professionals — check if tenure data confirms >10 years',
    params: { yearsOfExperienceIds: ['5'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['yearsOfExperienceIds', 'accuracy'],
  },

  // Q45: yearsOfExperienceIds ["1"] (<1yr) — early career
  {
    id: 45,
    phase: 'tier3-experience',
    question: 'Does yearsOfExperienceIds "1" (<1yr) return new grads/early career?',
    hypothesis: 'Should return people very early in career — check titles for junior/intern/entry',
    params: { yearsOfExperienceIds: ['1'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['yearsOfExperienceIds', 'early-career'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Result ordering
  // ═══════════════════════════════════════════════════════════════════════════

  // Q46: Broad query — what determines result order?
  {
    id: 46,
    phase: 'tier3-ordering',
    question: 'What determines result ordering? Premium/OpenProfile first? Relevance? Recency?',
    hypothesis: 'LinkedIn likely ranks by relevance/activity, premium profiles may be boosted',
    params: { locations: ['San Francisco'], functionIds: ['8'] },
    tags: ['ordering', 'ranking'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL TIER 1: Edge cases for searchQuery
  // ═══════════════════════════════════════════════════════════════════════════

  // Q47: searchQuery with niche skill
  {
    id: 47,
    phase: 'tier1-searchQuery',
    question: 'Does searchQuery work with niche/specific skills like "terraform"?',
    hypothesis: 'Niche skills should produce focused results with people who specifically use terraform',
    params: { searchQuery: 'terraform', locations: ['San Francisco'] },
    tags: ['searchQuery', 'niche-skill'],
  },

  // Q48: searchQuery with industry term
  {
    id: 48,
    phase: 'tier1-searchQuery',
    question: 'Does searchQuery work for industry terms like "fintech"?',
    hypothesis: 'Industry terms should match headline/summary/industry fields',
    params: { searchQuery: 'fintech', locations: ['New York'] },
    tags: ['searchQuery', 'industry-term'],
  },

  // Q49: Empty searchQuery + no title + company only
  {
    id: 49,
    phase: 'tier1-searchQuery',
    question: 'What happens with just company filter and no other constraints?',
    hypothesis: 'Should return diverse roles at the company',
    params: { currentCompanies: ['https://www.linkedin.com/company/anthropic'] },
    tags: ['currentCompanies', 'no-other-filters'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL TIER 2: yearsAtCurrentCompanyIds
  // ═══════════════════════════════════════════════════════════════════════════

  // Q50: yearsAtCurrentCompanyIds
  {
    id: 50,
    phase: 'tier2-tenure',
    question: 'Does yearsAtCurrentCompanyIds work? "1" (<1yr) at current company',
    hypothesis: 'Should return people who recently joined their current company',
    params: { yearsAtCurrentCompanyIds: ['1'], currentCompanies: ['https://www.linkedin.com/company/stripe'], currentJobTitles: ['Software Engineer'] },
    tags: ['yearsAtCurrentCompanyIds', 'new-hires'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION QUERIES (Q51-60) — confirm key findings
  // ═══════════════════════════════════════════════════════════════════════════

  // Q51: Validate title fuzziness with different company
  {
    id: 51,
    phase: 'validation',
    question: 'Validate: Does title fuzziness behavior hold for a different company?',
    hypothesis: 'Same fuzzy behavior as Q8 — "Data Scientist" should also return senior variants',
    params: { currentJobTitles: ['Data Scientist'], currentCompanies: ['https://www.linkedin.com/company/meta'], locations: ['San Francisco'] },
    tags: ['validation', 'currentJobTitles', 'fuzzy-matching'],
  },

  // Q52: Validate location metro area with different city
  {
    id: 52,
    phase: 'validation',
    question: 'Validate: Does "New York" location include metro area?',
    hypothesis: 'New York should include surrounding areas like Jersey City, Brooklyn, etc.',
    params: { currentJobTitles: ['Software Engineer'], locations: ['New York'] },
    tags: ['validation', 'locations', 'metro-area'],
  },

  // Q53: Validate searchQuery with a completely different skill
  {
    id: 53,
    phase: 'validation',
    question: 'Validate: searchQuery with "blockchain" — does it match broadly?',
    hypothesis: 'Should work similar to "kubernetes" (Q1) — matching across multiple profile fields',
    params: { searchQuery: 'blockchain', locations: ['San Francisco'] },
    tags: ['validation', 'searchQuery'],
  },

  // Q54: Validate exclude with different filter
  {
    id: 54,
    phase: 'validation',
    question: 'Validate: excludeFunctionIds — exclude engineering from broad search',
    hypothesis: 'Should remove engineering roles and return only non-engineering functions',
    params: {
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/stripe'],
      excludeFunctionIds: ['8'],
    },
    tags: ['validation', 'exclude', 'excludeFunctionIds'],
  },

  // Q55: Validate companyHeadcount with a different size
  {
    id: 55,
    phase: 'validation',
    question: 'Validate: companyHeadcount "I" (10000+) — large companies',
    hypothesis: 'Should only return people at large enterprises',
    params: { companyHeadcount: ['I'], currentJobTitles: ['Software Engineer'], locations: ['San Francisco'] },
    tags: ['validation', 'companyHeadcount', 'large-companies'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Filling remaining gaps (Q56-Q80)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Multiple companies OR logic ──────────────────────────────────────────

  // Q56: Multiple currentCompanies — is it OR?
  {
    id: 56,
    phase: 'phase2-multiCompany',
    question: 'Are multiple currentCompanies treated as OR? [stripe, anthropic]',
    hypothesis: 'Multiple company URLs should return people at EITHER company (OR logic)',
    params: {
      currentCompanies: [
        'https://www.linkedin.com/company/stripe',
        'https://www.linkedin.com/company/anthropic',
      ],
      currentJobTitles: ['Software Engineer'],
    },
    tags: ['currentCompanies', 'OR-logic', 'multiple-values'],
  },

  // Q57: Single company baseline for comparison — Stripe SWEs
  {
    id: 57,
    phase: 'phase2-multiCompany',
    question: 'Baseline: Stripe SWEs only — for multi-company comparison',
    hypothesis: 'Stripe SWEs alone should be a subset of Q56 multi-company results',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/stripe'],
      currentJobTitles: ['Software Engineer'],
    },
    compareWith: 56,
    tags: ['currentCompanies', 'baseline'],
  },

  // Q58: Single company baseline — Anthropic SWEs
  {
    id: 58,
    phase: 'phase2-multiCompany',
    question: 'Baseline: Anthropic SWEs only — for multi-company comparison',
    hypothesis: 'Anthropic SWEs alone — Q56 total should be roughly Q57 + Q58',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/anthropic'],
      currentJobTitles: ['Software Engineer'],
    },
    compareWith: 56,
    tags: ['currentCompanies', 'baseline'],
  },

  // ── pastCompanies with raw company name (no URL) ─────────────────────────

  // Q59: pastCompanies with raw name instead of URL
  {
    id: 59,
    phase: 'phase2-pastCompanies',
    question: 'Does pastCompanies work with raw company name instead of LinkedIn URL?',
    hypothesis: 'Raw company name may not work — might need URL like currentCompanies',
    params: {
      pastCompanies: ['Google'],
      currentJobTitles: ['Software Engineer'],
      locations: ['San Francisco'],
    },
    compareWith: 38,
    tags: ['pastCompanies', 'raw-name', 'no-URL'],
  },

  // Q60: pastCompanies with partial URL (no https)
  {
    id: 60,
    phase: 'phase2-pastCompanies',
    question: 'Does pastCompanies work with partial URL (no protocol)?',
    hypothesis: 'Partial URL like "linkedin.com/company/google" may or may not work',
    params: {
      pastCompanies: ['linkedin.com/company/google'],
      currentJobTitles: ['Software Engineer'],
      locations: ['San Francisco'],
    },
    compareWith: 38,
    tags: ['pastCompanies', 'partial-URL'],
  },

  // ── Boolean operators — definitive tests ─────────────────────────────────

  // Q61: AND operator with very niche terms
  {
    id: 61,
    phase: 'phase2-booleanOps',
    question: 'Definitive AND test: "terraform AND kubernetes" — both niche, should be small intersection',
    hypothesis: 'If AND works, total should be much less than terraform(15K) or kubernetes(42K) alone',
    params: { searchQuery: 'terraform AND kubernetes', locations: ['San Francisco'] },
    tags: ['searchQuery', 'boolean', 'AND', 'definitive'],
  },

  // Q62: Same terms without AND — just space-separated
  {
    id: 62,
    phase: 'phase2-booleanOps',
    question: 'Space-separated "terraform kubernetes" — compare with AND version Q61',
    hypothesis: 'If AND is just ignored, space-separated should give same results as Q61',
    params: { searchQuery: 'terraform kubernetes', locations: ['San Francisco'] },
    compareWith: 61,
    tags: ['searchQuery', 'boolean', 'space-separated'],
  },

  // Q63: OR with niche terms
  {
    id: 63,
    phase: 'phase2-booleanOps',
    question: 'Definitive OR test: "terraform OR rust" — should be larger than either alone',
    hypothesis: 'If OR works, total should be at least as large as the larger single term',
    params: { searchQuery: 'terraform OR rust', locations: ['San Francisco'] },
    tags: ['searchQuery', 'boolean', 'OR', 'definitive'],
  },

  // Q64: "rust" alone for OR comparison
  {
    id: 64,
    phase: 'phase2-booleanOps',
    question: 'Baseline: "rust" alone in SF — for OR comparison with Q63',
    hypothesis: 'Rust alone count + terraform alone (Q47=15K) should approximate Q63 if OR works',
    params: { searchQuery: 'rust', locations: ['San Francisco'] },
    compareWith: 63,
    tags: ['searchQuery', 'baseline', 'rust'],
  },

  // ── Q49 anomaly: company-only queries ────────────────────────────────────

  // Q65: Company-only with a larger company (Google)
  {
    id: 65,
    phase: 'phase2-companyOnly',
    question: 'Company-only query for Google — does it return more than Anthropic (Q49=5)?',
    hypothesis: 'Google should return many more results than Anthropic — Q49 was likely an indexing issue',
    params: { currentCompanies: ['https://www.linkedin.com/company/google'] },
    compareWith: 49,
    tags: ['currentCompanies', 'company-only', 'anomaly'],
  },

  // Q66: Company-only for Stripe
  {
    id: 66,
    phase: 'phase2-companyOnly',
    question: 'Company-only query for Stripe — no other filters',
    hypothesis: 'Mid-size tech company should return reasonable results without extra filters',
    params: { currentCompanies: ['https://www.linkedin.com/company/stripe'] },
    tags: ['currentCompanies', 'company-only'],
  },

  // Q67: Anthropic with functionIds (to see if adding a filter helps)
  {
    id: 67,
    phase: 'phase2-companyOnly',
    question: 'Anthropic + functionIds:Engineering — does adding a filter fix the Q49 anomaly?',
    hypothesis: 'Adding a function filter might return more/better results than company-only',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/anthropic'],
      functionIds: ['8'],
    },
    compareWith: 49,
    tags: ['currentCompanies', 'company-only', 'anomaly', 'functionIds'],
  },

  // ── yearsOfExperience accuracy ───────────────────────────────────────────

  // Q68: yearsOfExperience "3" (3-5yr) — check if mid-career people appear
  {
    id: 68,
    phase: 'phase2-experience',
    question: 'yearsOfExperience "3" (3-5yr) — does it match mid-career profiles?',
    hypothesis: 'Should return people ~3-5 years into career — titles like "Software Engineer" not "Senior"',
    params: {
      yearsOfExperienceIds: ['3'],
      currentJobTitles: ['Software Engineer'],
      locations: ['New York'],
    },
    tags: ['yearsOfExperienceIds', 'mid-career', 'accuracy'],
  },

  // Q69: yearsOfExperience "5" (10+yr) at a specific company — cross-check with titles
  {
    id: 69,
    phase: 'phase2-experience',
    question: 'yearsOfExperience "5" at Google — do titles reflect seniority?',
    hypothesis: 'People with 10+ years at Google should mostly have senior/staff/principal titles',
    params: {
      yearsOfExperienceIds: ['5'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      functionIds: ['8'],
    },
    tags: ['yearsOfExperienceIds', 'senior-titles', 'cross-check'],
  },

  // Q70: yearsOfExperience "1" (<1yr) — are these actually new grads?
  {
    id: 70,
    phase: 'phase2-experience',
    question: 'yearsOfExperience "1" at Google — are these actually entry-level?',
    hypothesis: 'Should see intern, new grad, junior titles if filter is accurate',
    params: {
      yearsOfExperienceIds: ['1'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      functionIds: ['8'],
    },
    tags: ['yearsOfExperienceIds', 'entry-level', 'cross-check'],
  },

  // ── Deep pagination ──────────────────────────────────────────────────────

  // Q71: Page 10
  {
    id: 71,
    phase: 'phase2-pagination',
    question: 'Page 10 — do results still hold up?',
    hypothesis: 'Page 10 should still return valid results with same precision as earlier pages',
    params: { currentJobTitles: ['Product Manager'], locations: ['New York'], startPage: 10 },
    compareWith: 35,
    tags: ['pagination', 'page10', 'deep'],
  },

  // Q72: Page 20
  {
    id: 72,
    phase: 'phase2-pagination',
    question: 'Page 20 — does quality degrade significantly?',
    hypothesis: 'Page 20 may show some degradation but should still return relevant profiles',
    params: { currentJobTitles: ['Product Manager'], locations: ['New York'], startPage: 20 },
    compareWith: 35,
    tags: ['pagination', 'page20', 'deep'],
  },

  // ── profileLanguages ─────────────────────────────────────────────────────

  // Q73: profileLanguages with ISO code
  {
    id: 73,
    phase: 'phase2-profileLanguages',
    question: 'Does profileLanguages work? Test with "es" (Spanish)',
    hypothesis: 'Should return profiles with Spanish language — useful for international searches',
    params: {
      profileLanguages: ['es'],
      currentJobTitles: ['Software Engineer'],
      locations: ['San Francisco'],
    },
    tags: ['profileLanguages', 'ISO-code'],
  },

  // Q74: profileLanguages with full language name
  {
    id: 74,
    phase: 'phase2-profileLanguages',
    question: 'Does profileLanguages work with full name "Spanish"?',
    hypothesis: 'Full language name may or may not work — compare with ISO code Q73',
    params: {
      profileLanguages: ['Spanish'],
      currentJobTitles: ['Software Engineer'],
      locations: ['San Francisco'],
    },
    compareWith: 73,
    tags: ['profileLanguages', 'full-name'],
  },

  // ── companyHeadcount accuracy verification ───────────────────────────────

  // Q75: Google is 10K+ employees — headcount "I" should include Google people
  {
    id: 75,
    phase: 'phase2-headcountVerify',
    question: 'Google SWEs with headcount "I" (10K+) — should match since Google is huge',
    hypothesis: 'Adding headcount "I" to Google search should return same/similar count as without',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/google'],
      currentJobTitles: ['Software Engineer'],
      companyHeadcount: ['I'],
    },
    tags: ['companyHeadcount', 'verification', 'known-company'],
  },

  // Q76: Google SWEs WITHOUT headcount — baseline for Q75
  {
    id: 76,
    phase: 'phase2-headcountVerify',
    question: 'Google SWEs without headcount filter — baseline for Q75',
    hypothesis: 'Should have similar totalElements as Q75 if headcount accurately classifies Google as I',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/google'],
      currentJobTitles: ['Software Engineer'],
    },
    compareWith: 75,
    tags: ['companyHeadcount', 'verification', 'baseline'],
  },

  // Q77: Google SWEs with WRONG headcount "C" (11-50) — should return 0 or very few
  {
    id: 77,
    phase: 'phase2-headcountVerify',
    question: 'Google SWEs with headcount "C" (11-50) — should return 0 since Google is huge',
    hypothesis: 'Wrong headcount + correct company URL should return 0 (filters AND together)',
    params: {
      currentCompanies: ['https://www.linkedin.com/company/google'],
      currentJobTitles: ['Software Engineer'],
      companyHeadcount: ['C'],
    },
    compareWith: 76,
    tags: ['companyHeadcount', 'verification', 'wrong-size'],
  },

  // ── Remaining validation ─────────────────────────────────────────────────

  // Q78: Multiple locations — OR logic?
  {
    id: 78,
    phase: 'phase2-multiLocation',
    question: 'Are multiple locations OR? ["San Francisco", "New York"]',
    hypothesis: 'Should return people from EITHER metro area',
    params: {
      locations: ['San Francisco', 'New York'],
      currentJobTitles: ['Product Manager'],
      currentCompanies: ['https://www.linkedin.com/company/stripe'],
    },
    tags: ['locations', 'OR-logic', 'multiple-values'],
  },

  // Q79: Multiple schools — OR logic?
  {
    id: 79,
    phase: 'phase2-multiSchool',
    question: 'Are multiple schools OR? ["Stanford University", "Harvard University"]',
    hypothesis: 'Should return alumni from EITHER school',
    params: {
      schools: ['Stanford University', 'Harvard University'],
      currentJobTitles: ['Software Engineer'],
      locations: ['San Francisco'],
    },
    tags: ['schools', 'OR-logic', 'multiple-values'],
  },

  // Q80: firstName + lastName filter — person lookup accuracy
  {
    id: 80,
    phase: 'phase2-personLookup',
    question: 'Do firstName + lastName filters work for person lookup?',
    hypothesis: 'Should find specific people — useful for "find John Smith at Google" queries',
    params: {
      firstNames: ['Sundar'],
      lastNames: ['Pichai'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
    },
    tags: ['firstNames', 'lastNames', 'person-lookup'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Final Gap-Filling (Q81-Q84)
  // ═══════════════════════════════════════════════════════════════════════════

  // Q81: searchQuery ranking — page 1 vs page 5 relevance
  // If searchQuery influences ranking, page 1 profiles should have more visible
  // connection to "kubernetes" than page 5 profiles.
  {
    id: 81,
    phase: 'phase3-ranking',
    question: 'Does searchQuery influence result ranking? Are page 1 results more relevant than deeper pages?',
    hypothesis: 'Page 1 results will have more visible kubernetes connections (in title/company) than page 5, indicating ranking by relevance',
    params: {
      searchQuery: 'kubernetes',
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      startPage: 1,
    },
    tags: ['searchQuery', 'ranking', 'page1'],
  },

  // Q82: searchQuery ranking — page 5 of same query for comparison
  {
    id: 82,
    phase: 'phase3-ranking',
    question: 'Page 5 of same kubernetes+Google query — do results degrade in relevance?',
    hypothesis: 'Page 5 profiles will have fewer visible kubernetes connections in title/headline compared to page 1',
    params: {
      searchQuery: 'kubernetes',
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      startPage: 5,
    },
    compareWith: 81,
    tags: ['searchQuery', 'ranking', 'page5'],
  },

  // Q83: searchQuery ranking — page 10 for deeper comparison
  {
    id: 83,
    phase: 'phase3-ranking',
    question: 'Page 10 of same kubernetes+Google query — does relevance degrade further?',
    hypothesis: 'Page 10 will show more generic titles with less visible kubernetes connection than pages 1 and 5',
    params: {
      searchQuery: 'kubernetes',
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/google'],
      startPage: 10,
    },
    compareWith: 81,
    tags: ['searchQuery', 'ranking', 'page10'],
  },

  // Q84: pastJobTitles fuzzy behavior — does it match like currentJobTitles?
  {
    id: 84,
    phase: 'phase3-pastJobTitles',
    question: 'Does pastJobTitles use fuzzy matching like currentJobTitles? Does "Product Manager" return "Senior PM" variants?',
    hypothesis: 'pastJobTitles will be fuzzy like currentJobTitles — "Product Manager" will return Senior/VP/Group PM variants from past roles',
    params: {
      pastJobTitles: ['Product Manager'],
      locations: ['San Francisco'],
      currentCompanies: ['https://www.linkedin.com/company/stripe'],
    },
    tags: ['pastJobTitles', 'fuzzy-matching'],
  },
];

// ─── Execution ────────────────────────────────────────────────────────────────

let totalSpent = 0;
const BUDGET = 10.0; // $10

async function logResult(entry: LogEntry): Promise<void> {
  await appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

function analyzeResults(
  profiles: ShortProfileResult[],
  query: ResearchQuery
): { valid: number; invalid: number; invalidBreakdown: LogEntry['invalid_breakdown'] } {
  // Generic analysis based on what the query tests
  const invalidBreakdown: LogEntry['invalid_breakdown'] = [];
  let valid = 0;
  let invalid = 0;

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const issues: string[] = [];

    // Check title relevance if we set a title filter
    if (query.params.currentJobTitles?.length) {
      const titleLower = (p.role || '').toLowerCase();
      const anyTitleMatch = query.params.currentJobTitles.some(t => {
        const filterLower = t.toLowerCase();
        // Check if any word from the filter appears in the title
        const filterWords = filterLower.split(/\s+/);
        return filterWords.some(w => titleLower.includes(w));
      });
      if (!anyTitleMatch && p.role) {
        issues.push(`Title "${p.role}" doesn't match filter ${JSON.stringify(query.params.currentJobTitles)}`);
      }
    }

    // Check company if we set a company filter
    if (query.params.currentCompanies?.length) {
      // Can't easily validate since we have URL, just note the company
    }

    // Check location if we set a location filter
    if (query.params.locations?.length) {
      const locLower = (p.location || '').toLowerCase();
      const anyLocMatch = query.params.locations.some(l => locLower.includes(l.toLowerCase()));
      if (!anyLocMatch && p.location) {
        issues.push(`Location "${p.location}" doesn't match filter ${JSON.stringify(query.params.locations)}`);
      }
    }

    if (issues.length > 0) {
      invalid++;
      invalidBreakdown.push({
        index: i,
        name: p.fullName,
        title: p.role || '(no title)',
        company: p.company || '(no company)',
        reason: issues.join('; '),
      });
    } else {
      valid++;
    }
  }

  return { valid, invalid, invalidBreakdown };
}

async function runQuery(query: ResearchQuery): Promise<LogEntry> {
  const cost = 0.10;
  totalSpent += cost;

  const start = Date.now();
  let result: LinkedInSearchResult;

  try {
    result = await searchLinkedInShort({
      ...query.params,
      startPage: query.params.startPage || 1,
      takePages: 1,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    const entry: LogEntry = {
      query_number: query.id,
      phase: query.phase,
      question_being_tested: query.question,
      hypothesis: query.hypothesis,
      params: query.params,
      total_elements: 0,
      results_returned: 0,
      valid: 0,
      invalid: 0,
      precision: 0,
      sample_profiles: [],
      invalid_breakdown: [],
      observations: [`ERROR: ${err instanceof Error ? err.message : String(err)}`],
      confirmed: 'ERROR',
      new_questions: [],
      confidence_tier: 'ERROR',
      tags: query.tags,
      cost_usd: cost,
      duration_ms: elapsed,
      budget_remaining: BUDGET - totalSpent,
    };
    return entry;
  }

  const elapsed = Date.now() - start;
  const profiles = result.profiles;

  // Analyze validity
  const { valid, invalid, invalidBreakdown } = analyzeResults(profiles, query);
  const precision = profiles.length > 0 ? valid / profiles.length : 0;

  const sampleProfiles = profiles.slice(0, 25).map(p => ({
    name: p.fullName,
    title: p.role || '(no title)',
    company: p.company || '(no company)',
    location: p.location || '(no location)',
  }));

  const entry: LogEntry = {
    query_number: query.id,
    phase: query.phase,
    question_being_tested: query.question,
    hypothesis: query.hypothesis,
    params: query.params,
    total_elements: result.pagination.totalElements,
    results_returned: profiles.length,
    valid,
    invalid,
    precision,
    sample_profiles: sampleProfiles,
    invalid_breakdown: invalidBreakdown,
    observations: [], // Will be filled by analysis
    confirmed: '',
    new_questions: [],
    confidence_tier: precision >= 0.9 ? 'HIGH' : precision >= 0.7 ? 'MEDIUM' : 'LOW',
    tags: query.tags,
    cost_usd: cost,
    duration_ms: elapsed,
    budget_remaining: BUDGET - totalSpent,
  };

  return entry;
}

async function generatePhaseFindings(entries: LogEntry[]): Promise<void> {
  const lines: string[] = [];
  lines.push('# LinkedIn Search Research — Findings');
  lines.push(`\nLast updated: ${new Date().toISOString()}`);
  lines.push(`Queries run: ${entries.length}`);
  lines.push(`Budget spent: $${totalSpent.toFixed(2)} / $${BUDGET.toFixed(2)}`);
  lines.push(`Budget remaining: $${(BUDGET - totalSpent).toFixed(2)}`);

  // Group by phase
  const phases = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const existing = phases.get(e.phase) || [];
    existing.push(e);
    phases.set(e.phase, existing);
  }

  for (const [phase, phaseEntries] of phases) {
    lines.push(`\n## ${phase}`);
    for (const e of phaseEntries) {
      lines.push(`\n### Q${e.query_number}: ${e.question_being_tested}`);
      lines.push(`- **Hypothesis**: ${e.hypothesis}`);
      lines.push(`- **Total elements**: ${e.total_elements.toLocaleString()}`);
      lines.push(`- **Results returned**: ${e.results_returned}`);
      lines.push(`- **Precision**: ${Math.round(e.precision * 100)}% (${e.valid} valid / ${e.invalid} invalid)`);
      lines.push(`- **Confidence**: ${e.confidence_tier}`);

      if (e.sample_profiles.length > 0) {
        lines.push('- **Sample results**:');
        for (const p of e.sample_profiles.slice(0, 8)) {
          lines.push(`  - ${p.name} — ${p.title} at ${p.company} — ${p.location}`);
        }
      }

      if (e.invalid_breakdown.length > 0) {
        lines.push('- **Invalid results**:');
        for (const inv of e.invalid_breakdown.slice(0, 5)) {
          lines.push(`  - #${inv.index}: ${inv.name} — ${inv.title} at ${inv.company} — ${inv.reason}`);
        }
      }

      if (e.observations.length > 0) {
        lines.push('- **Observations**: ' + e.observations.join('; '));
      }
    }
  }

  // Summary table
  lines.push('\n## Parameter Confidence Summary');
  lines.push('| Parameter | Confidence | Evidence |');
  lines.push('|-----------|-----------|----------|');

  // Aggregate by tag
  const tagPrecision = new Map<string, number[]>();
  for (const e of entries) {
    for (const tag of e.tags) {
      const existing = tagPrecision.get(tag) || [];
      existing.push(e.precision);
      tagPrecision.set(tag, existing);
    }
  }

  for (const [tag, precisions] of tagPrecision) {
    const avg = precisions.reduce((s, p) => s + p, 0) / precisions.length;
    const confidence = avg >= 0.9 ? 'HIGH' : avg >= 0.7 ? 'MEDIUM' : 'LOW';
    lines.push(`| ${tag} | ${confidence} (${Math.round(avg * 100)}%) | ${precisions.length} queries |`);
  }

  await writeFile(FINDINGS_FILE, lines.join('\n'), 'utf-8');
}

async function main() {
  await mkdir(RESEARCH_DIR, { recursive: true });

  // Determine which queries to run
  let queriesToRun: ResearchQuery[];
  if (onlyIds) {
    queriesToRun = QUERIES.filter(q => onlyIds.includes(q.id));
  } else {
    queriesToRun = QUERIES.filter(q => q.id >= startFrom);
  }

  console.log(`\n🔬 LinkedIn Search Research`);
  console.log(`   Queries planned: ${queriesToRun.length}`);
  console.log(`   Budget: $${BUDGET.toFixed(2)}`);
  console.log(`   Estimated cost: $${(queriesToRun.length * 0.10).toFixed(2)}\n`);

  const allEntries: LogEntry[] = [];

  // Load existing entries if resuming
  if (existsSync(LOG_FILE) && startFrom > 0) {
    const existing = (await readFile(LOG_FILE, 'utf-8')).trim().split('\n').filter(Boolean);
    for (const line of existing) {
      try {
        allEntries.push(JSON.parse(line));
        totalSpent += 0.10;
      } catch {}
    }
    console.log(`   Loaded ${allEntries.length} existing entries\n`);
  }

  for (const query of queriesToRun) {
    if (totalSpent + 0.10 > BUDGET) {
      console.log(`\n⚠️  Budget exhausted ($${totalSpent.toFixed(2)} spent). Stopping.`);
      break;
    }

    process.stdout.write(`  Q${query.id} [${query.phase}] ${query.question.slice(0, 60)}...`);

    const entry = await runQuery(query);
    allEntries.push(entry);
    await logResult(entry);

    const precStr = `${Math.round(entry.precision * 100)}%`;
    const sampleStr = entry.sample_profiles.slice(0, 2).map(p => `${p.name}(${p.title})`).join(', ');
    console.log(` → ${entry.total_elements.toLocaleString()} total, ${entry.results_returned} returned, precision=${precStr} [$${(BUDGET - totalSpent).toFixed(2)} left]`);
    if (sampleStr) {
      console.log(`      Sample: ${sampleStr}`);
    }
    if (entry.invalid_breakdown.length > 0) {
      console.log(`      Invalid: ${entry.invalid_breakdown.slice(0, 2).map(i => `${i.name}: ${i.reason.slice(0, 60)}`).join('; ')}`);
    }

    // Phase gate: every 15 queries, update findings
    if (allEntries.length % 15 === 0) {
      console.log(`\n📊 Phase gate at ${allEntries.length} queries — updating findings.md...\n`);
      await generatePhaseFindings(allEntries);
    }
  }

  // Final findings update
  await generatePhaseFindings(allEntries);
  console.log(`\n✅ Research complete!`);
  console.log(`   Queries run: ${allEntries.length}`);
  console.log(`   Total cost: $${totalSpent.toFixed(2)}`);
  console.log(`   Log: ${LOG_FILE}`);
  console.log(`   Findings: ${FINDINGS_FILE}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
