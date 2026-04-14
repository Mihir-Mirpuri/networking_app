/**
 * LinkedIn Short Profile Search — Quality Harness
 *
 * Tests the FULL pipeline: Haiku extraction → company URL resolution → Apify Short search
 * Evaluates whether the filters Haiku generates actually return relevant people.
 *
 * Cost: ~$0.10 per query (Apify) + ~$0.005 per query (Haiku) = ~$1.60 for 15 queries
 *
 * Usage:
 *   npx tsx tests/linkedin-short-quality.ts
 *   npx tsx tests/linkedin-short-quality.ts --extract-only   # Skip Apify, just show filters
 *   npx tsx tests/linkedin-short-quality.ts --limit=5        # Run first N queries only
 */

import 'dotenv/config';
process.env.DISCOVERY_LOGGER_ENABLED = '1';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';
import { completeJsonAnthropic } from '../src/lib/services/anthropic';
import { sanitizeLinkedInFilters } from '../src/lib/services/linkedin-filter-validator';
import { resolveCompanyUrl } from '../src/lib/services/company-resolver';
import { searchLinkedInShort, type LinkedInSearchResult, type ShortProfileResult } from '../src/lib/services/linkedin-search';
import type { LinkedInFilters } from '../src/lib/types/linkedin-filters';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const extractOnly = args.includes('--extract-only');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

// ─── Test Queries ─────────────────────────────────────────────────────────────
// Curated for a networking app: "who would a real user search for?"

interface TestQuery {
  id: string;
  query: string;
  /** What a relevant result looks like — used for scoring */
  expectCompany: string;
  expectRoleKeywords?: string[];  // Any of these in the role = relevant
  expectLocation?: string;        // City substring match
}

const QUERIES: TestQuery[] = [
  // ── Simple: company + role (the 80% use case) ──
  {
    id: 'stripe-pm',
    query: 'product managers at Stripe',
    expectCompany: 'Stripe',
    expectRoleKeywords: ['product manager', 'pm', 'product'],
  },
  {
    id: 'google-swe',
    query: 'software engineers at Google',
    expectCompany: 'Google',
    expectRoleKeywords: ['software engineer', 'engineer', 'developer', 'swe'],
  },
  {
    id: 'anthropic-ml',
    query: 'ML engineers at Anthropic',
    expectCompany: 'Anthropic',
    expectRoleKeywords: ['machine learning', 'ml', 'research', 'engineer'],
  },
  {
    id: 'mckinsey-consultant',
    query: 'consultants at McKinsey',
    expectCompany: 'McKinsey',
    expectRoleKeywords: ['consultant', 'associate', 'engagement manager', 'partner'],
  },
  {
    id: 'goldman-analyst',
    query: 'analysts at Goldman Sachs',
    expectCompany: 'Goldman Sachs',
    expectRoleKeywords: ['analyst', 'associate', 'vice president'],
  },

  // ── Company + role + location ──
  {
    id: 'meta-pm-nyc',
    query: 'PMs at Meta in New York',
    expectCompany: 'Meta',
    expectRoleKeywords: ['product manager', 'pm', 'product'],
    expectLocation: 'New York',
  },
  {
    id: 'apple-swe-sf',
    query: 'software engineers at Apple in San Francisco',
    expectCompany: 'Apple',
    expectRoleKeywords: ['software engineer', 'engineer', 'developer'],
    expectLocation: 'San Francisco',
  },

  // ── Generic role (function_ids path) ──
  {
    id: 'figma-designers',
    query: 'designers at Figma',
    expectCompany: 'Figma',
    expectRoleKeywords: ['design', 'designer', 'ux', 'ui', 'product design'],
  },
  {
    id: 'salesforce-sales',
    query: 'salespeople at Salesforce',
    expectCompany: 'Salesforce',
    expectRoleKeywords: ['sales', 'account executive', 'business development', 'ae'],
  },

  // ── Seniority filter ──
  {
    id: 'uber-senior-eng',
    query: 'senior engineers at Uber',
    expectCompany: 'Uber',
    expectRoleKeywords: ['senior', 'staff', 'principal', 'engineer', 'lead'],
  },

  // ── University filter ──
  {
    id: 'openai-stanford',
    query: 'Stanford alumni at OpenAI',
    expectCompany: 'OpenAI',
  },

  // ── Past company ──
  {
    id: 'anthropic-ex-google',
    query: 'ex-Google engineers now at Anthropic',
    expectCompany: 'Anthropic',
    expectRoleKeywords: ['engineer', 'research', 'developer'],
  },

  // ── Company only (no role — networking use case) ──
  {
    id: 'notion-people',
    query: 'people at Notion',
    expectCompany: 'Notion',
  },

  // ── Recently changed jobs ──
  {
    id: 'stripe-recent',
    query: 'people who recently joined Stripe',
    expectCompany: 'Stripe',
  },

  // ── Niche role ──
  {
    id: 'citadel-quant',
    query: 'quantitative researchers at Citadel',
    expectCompany: 'Citadel',
    expectRoleKeywords: ['quantitative', 'quant', 'researcher', 'analyst'],
  },
];

// ─── LLM Response Schema ─────────────────────────────────────────────────────

interface LLMResponse {
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup';
  confidence?: 'high' | 'low';
  role_specificity?: 'narrow' | 'standard' | 'broad';
  filters: {
    company: string | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  linkedin_filters?: {
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
  company_name_ambiguous?: boolean;
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function convertLinkedInFilters(raw: LLMResponse['linkedin_filters'] | undefined): LinkedInFilters {
  if (!raw) return {};
  const result: LinkedInFilters = {};
  if (raw.search_query) result.searchQuery = raw.search_query;
  if (raw.locations?.length) result.locations = raw.locations;
  if (raw.current_companies?.length) result.currentCompanies = raw.current_companies;
  if (raw.past_companies?.length) result.pastCompanies = raw.past_companies;
  if (raw.schools?.length) result.schools = raw.schools;
  if (raw.current_job_titles?.length) result.currentJobTitles = raw.current_job_titles;
  if (raw.past_job_titles?.length) result.pastJobTitles = raw.past_job_titles;
  if (raw.seniority_level_ids?.length) result.seniorityLevelIds = raw.seniority_level_ids;
  if (raw.function_ids?.length) result.functionIds = raw.function_ids;
  if (raw.company_headcount?.length) result.companyHeadcount = raw.company_headcount;
  if (raw.years_of_experience_ids?.length) result.yearsOfExperienceIds = raw.years_of_experience_ids;
  if (raw.years_at_current_company_ids?.length) result.yearsAtCurrentCompanyIds = raw.years_at_current_company_ids;
  if (raw.recently_changed_jobs) result.recentlyChangedJobs = raw.recently_changed_jobs;
  if (raw.exclude_locations?.length) result.excludeLocations = raw.exclude_locations;
  if (raw.exclude_current_companies?.length) result.excludeCurrentCompanies = raw.exclude_current_companies;
  if (raw.exclude_seniority_level_ids?.length) result.excludeSeniorityLevelIds = raw.exclude_seniority_level_ids;
  if (raw.exclude_function_ids?.length) result.excludeFunctionIds = raw.exclude_function_ids;
  return sanitizeLinkedInFilters(result);
}

/** Score how relevant a profile is to the query intent */
function scoreProfile(profile: ShortProfileResult, test: TestQuery): {
  companyMatch: boolean;
  roleMatch: boolean | null;  // null = no role expected
  locationMatch: boolean | null;
} {
  const company = (profile.company || '').toLowerCase();
  const companyMatch = company.includes(test.expectCompany.toLowerCase()) ||
    test.expectCompany.toLowerCase().includes(company);

  let roleMatch: boolean | null = null;
  if (test.expectRoleKeywords) {
    const role = (profile.role || '').toLowerCase();
    roleMatch = test.expectRoleKeywords.some(kw => role.includes(kw.toLowerCase()));
  }

  let locationMatch: boolean | null = null;
  if (test.expectLocation) {
    const loc = (profile.location || '').toLowerCase();
    locationMatch = loc.includes(test.expectLocation.toLowerCase());
  }

  return { companyMatch, roleMatch, locationMatch };
}

// ─── Result types ─────────────────────────────────────────────────────────────

interface QueryResult {
  test: TestQuery;
  extractionMs: number;
  status: string;
  filters: LLMResponse['filters'];
  linkedInFilters: LinkedInFilters;
  companyUrl: string | null;
  // Apify results (null if extract-only)
  searchMs: number | null;
  totalElements: number | null;
  profileCount: number | null;
  profiles: ShortProfileResult[] | null;
  // Scoring
  companyMatchRate: number | null;
  roleMatchRate: number | null;
  locationMatchRate: number | null;
  error: string | null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runQuery(test: TestQuery): Promise<QueryResult> {
  const result: QueryResult = {
    test,
    extractionMs: 0,
    status: '',
    filters: { company: null, role: null, university: null, location: null },
    linkedInFilters: {},
    companyUrl: null,
    searchMs: null,
    totalElements: null,
    profileCount: null,
    profiles: null,
    companyMatchRate: null,
    roleMatchRate: null,
    locationMatchRate: null,
    error: null,
  };

  try {
    // Step 1: Haiku extraction
    const extractStart = Date.now();
    const response = await completeJsonAnthropic<LLMResponse>({
      systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: `New user message: ${test.query}`,
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxTokens: 512,
    });
    result.extractionMs = Date.now() - extractStart;
    result.status = response.content.status;
    result.filters = response.content.filters;

    if (response.content.status !== 'ready') {
      result.error = `Status was "${response.content.status}", not "ready"`;
      return result;
    }

    // Step 2: Convert + sanitize LinkedIn filters
    result.linkedInFilters = convertLinkedInFilters(response.content.linkedin_filters);

    // Step 3: Resolve company URL
    const company = response.content.filters.company;
    if (company) {
      try {
        const resolved = await resolveCompanyUrl(company, response.content.filters.role || undefined);
        if (resolved.url) {
          result.companyUrl = resolved.url;
          result.linkedInFilters.currentCompanies = [resolved.url];
        } else {
          result.linkedInFilters.currentCompanies = [company];
        }
        // Strip company from searchQuery
        if (result.linkedInFilters.searchQuery) {
          result.linkedInFilters.searchQuery = result.linkedInFilters.searchQuery
            .replace(new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
            .replace(/\s{2,}/g, ' ')
            .trim();
          if (!result.linkedInFilters.searchQuery) {
            delete result.linkedInFilters.searchQuery;
          }
        }
      } catch {
        result.linkedInFilters.currentCompanies = [company];
      }
    }

    if (extractOnly) return result;

    // Step 4: Hit Apify
    const searchStart = Date.now();
    const searchResult = await searchLinkedInShort({
      ...result.linkedInFilters,
      startPage: 1,
      takePages: 1,
    });
    result.searchMs = Date.now() - searchStart;
    result.totalElements = searchResult.pagination.totalElements;
    result.profileCount = searchResult.profiles.length;
    result.profiles = searchResult.profiles;

    // Step 5: Score relevance
    if (searchResult.profiles.length > 0) {
      const scores = searchResult.profiles.map(p => scoreProfile(p, test));
      result.companyMatchRate = scores.filter(s => s.companyMatch).length / scores.length;
      result.roleMatchRate = test.expectRoleKeywords
        ? scores.filter(s => s.roleMatch).length / scores.length
        : null;
      result.locationMatchRate = test.expectLocation
        ? scores.filter(s => s.locationMatch).length / scores.length
        : null;
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

function formatPercent(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function generateReport(results: QueryResult[]): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push('# LinkedIn Short Search — Quality Report');
  lines.push(`\nGenerated: ${timestamp}`);
  lines.push(`Mode: ${extractOnly ? 'extract-only' : 'full pipeline'}`);
  lines.push(`Queries: ${results.length}`);

  if (!extractOnly) {
    const totalApifyCost = results.filter(r => r.profileCount !== null).length * 0.10;
    lines.push(`Apify cost: ~$${totalApifyCost.toFixed(2)}`);

    // Summary scores
    const scored = results.filter(r => r.companyMatchRate !== null);
    if (scored.length > 0) {
      const avgCompany = scored.reduce((s, r) => s + r.companyMatchRate!, 0) / scored.length;
      const roleScored = scored.filter(r => r.roleMatchRate !== null);
      const avgRole = roleScored.length > 0
        ? roleScored.reduce((s, r) => s + r.roleMatchRate!, 0) / roleScored.length
        : null;

      lines.push('\n## Aggregate Relevance');
      lines.push(`- **Company match**: ${formatPercent(avgCompany)} avg across ${scored.length} queries`);
      if (avgRole !== null) {
        lines.push(`- **Role match**: ${formatPercent(avgRole)} avg across ${roleScored.length} queries`);
      }
    }

    // Summary table
    lines.push('\n## Results Summary');
    lines.push('| Query | Total Matches | Returned | Company % | Role % | Location % | Search ms |');
    lines.push('|-------|-------------:|----------:|----------:|-------:|-----------:|----------:|');
    for (const r of results) {
      if (r.error && r.profileCount === null) {
        lines.push(`| ${r.test.id} | ERROR | — | — | — | — | — |`);
        continue;
      }
      lines.push(`| ${r.test.id} | ${r.totalElements?.toLocaleString() ?? '—'} | ${r.profileCount ?? '—'} | ${formatPercent(r.companyMatchRate)} | ${formatPercent(r.roleMatchRate)} | ${formatPercent(r.locationMatchRate)} | ${r.searchMs ?? '—'} |`);
    }
  }

  // Detailed results
  lines.push('\n## Query Details\n');

  for (const r of results) {
    lines.push(`### ${r.test.id}: \`${r.test.query}\``);
    lines.push(`- **Status**: ${r.status} (${r.extractionMs}ms)`);
    lines.push(`- **Extracted filters**: company=${r.filters.company}, role=${r.filters.role}, location=${r.filters.location}, university=${r.filters.university}`);

    // Show the actual LinkedIn filters sent
    const activeFilters = Object.entries(r.linkedInFilters)
      .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    lines.push(`- **LinkedIn filters**: ${activeFilters || 'none'}`);
    lines.push(`- **Company URL**: ${r.companyUrl || 'not resolved'}`);

    if (r.error) {
      lines.push(`- **Error**: ${r.error}`);
    }

    if (r.profiles && r.profiles.length > 0) {
      lines.push(`- **Total LinkedIn matches**: ${r.totalElements?.toLocaleString()}`);
      lines.push(`- **Returned**: ${r.profileCount} profiles`);
      lines.push(`- **Relevance**: company=${formatPercent(r.companyMatchRate)}, role=${formatPercent(r.roleMatchRate)}, location=${formatPercent(r.locationMatchRate)}`);

      // Sample profiles
      lines.push('- **Sample profiles**:');
      for (const p of r.profiles.slice(0, 5)) {
        const score = scoreProfile(p, r.test);
        const flags = [
          score.companyMatch ? '✓co' : '✗co',
          score.roleMatch !== null ? (score.roleMatch ? '✓role' : '✗role') : '',
          score.locationMatch !== null ? (score.locationMatch ? '✓loc' : '✗loc') : '',
        ].filter(Boolean).join(' ');
        lines.push(`  - ${p.fullName} — ${p.role || '(no role)'} at ${p.company || '(no company)'} — ${p.location || '(no location)'} [${flags}]`);
      }
    } else if (!extractOnly && r.profileCount === 0) {
      lines.push('- **⚠ ZERO RESULTS** — filters may be too restrictive');
    }

    lines.push('');
  }

  // Analysis section
  if (!extractOnly) {
    lines.push('## Analysis\n');

    // Zero-result queries
    const zeros = results.filter(r => r.profileCount === 0);
    if (zeros.length > 0) {
      lines.push('### Zero-Result Queries (filters too restrictive?)');
      for (const r of zeros) {
        const activeFilters = Object.entries(r.linkedInFilters)
          .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        lines.push(`- **${r.test.id}**: \`${r.test.query}\` → filters: ${activeFilters}`);
      }
      lines.push('');
    }

    // Low company match (< 80%)
    const lowCompany = results.filter(r => r.companyMatchRate !== null && r.companyMatchRate < 0.8);
    if (lowCompany.length > 0) {
      lines.push('### Low Company Match (<80%)');
      for (const r of lowCompany) {
        lines.push(`- **${r.test.id}**: ${formatPercent(r.companyMatchRate)} — company URL: ${r.companyUrl || 'MISSING'}`);
      }
      lines.push('');
    }

    // Low role match (< 50%)
    const lowRole = results.filter(r => r.roleMatchRate !== null && r.roleMatchRate < 0.5);
    if (lowRole.length > 0) {
      lines.push('### Low Role Match (<50%)');
      for (const r of lowRole) {
        lines.push(`- **${r.test.id}**: ${formatPercent(r.roleMatchRate)} — LinkedIn filters: currentJobTitles=${JSON.stringify(r.linkedInFilters.currentJobTitles)}, functionIds=${JSON.stringify(r.linkedInFilters.functionIds)}, searchQuery=${JSON.stringify(r.linkedInFilters.searchQuery)}`);
      }
      lines.push('');
    }

    // Unresolved company URLs
    const noUrl = results.filter(r => r.status === 'ready' && !r.companyUrl);
    if (noUrl.length > 0) {
      lines.push('### Unresolved Company URLs');
      for (const r of noUrl) {
        lines.push(`- **${r.test.id}**: "${r.filters.company}" — fell back to name string`);
      }
      lines.push('');
    }

    // Good results
    const good = results.filter(r => r.companyMatchRate !== null && r.companyMatchRate >= 0.8 && (r.roleMatchRate === null || r.roleMatchRate >= 0.5));
    lines.push(`### Healthy Queries: ${good.length}/${results.filter(r => r.profileCount !== null && r.profileCount > 0).length}`);
  }

  return lines.join('\n');
}

async function main() {
  const queries = QUERIES.slice(0, limit);
  console.log(`\n🔍 Running ${queries.length} queries (${extractOnly ? 'extract-only' : 'full pipeline'})...\n`);

  const results: QueryResult[] = [];

  for (const test of queries) {
    process.stdout.write(`  ${test.id}...`);
    const result = await runQuery(test);
    results.push(result);

    if (result.error && result.profileCount === null) {
      console.log(` ✗ ${result.error}`);
    } else if (extractOnly) {
      const active = Object.entries(result.linkedInFilters)
        .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      console.log(` ✓ ${result.status} (${result.extractionMs}ms) → ${active}`);
    } else {
      const companyPct = result.companyMatchRate !== null ? `co:${formatPercent(result.companyMatchRate)}` : '';
      const rolePct = result.roleMatchRate !== null ? ` role:${formatPercent(result.roleMatchRate)}` : '';
      console.log(` ✓ ${result.totalElements?.toLocaleString()} matches, ${result.profileCount} returned [${companyPct}${rolePct}] (${result.searchMs}ms)`);
    }
  }

  // Write report
  const reportDir = join(__dirname, 'linkedin-short-quality-reports');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `report-${new Date().toISOString().replace(/:/g, '-')}.md`);
  const report = generateReport(results);
  await writeFile(reportPath, report, 'utf-8');

  console.log(`\n📊 Report written to: ${reportPath}\n`);

  // Quick summary
  if (!extractOnly) {
    const scored = results.filter(r => r.companyMatchRate !== null);
    const avgCompany = scored.length > 0
      ? scored.reduce((s, r) => s + r.companyMatchRate!, 0) / scored.length
      : 0;
    const zeros = results.filter(r => r.profileCount === 0).length;
    console.log(`  Company match avg: ${formatPercent(avgCompany)}`);
    console.log(`  Zero-result queries: ${zeros}/${results.length}`);
    console.log(`  Apify cost: ~$${(results.filter(r => r.profileCount !== null).length * 0.10).toFixed(2)}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
