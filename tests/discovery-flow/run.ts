/**
 * Discovery-flow end-to-end test harness.
 *
 * Purpose: feed each query from `tests/discovery-flow/queries.ts` through a
 * replicated version of the discovery pipeline that bypasses next-auth, then
 * validate the resulting DiscoveryLogger entries against the expected
 * behavior for each query. Emits a consolidated markdown report with
 * failures surfaced at the top.
 *
 * The replicated pipeline exercises the SAME underlying services used by
 * `extractSearchFiltersAction` and `searchPeopleV2Action`:
 *   - SEARCH_EXTRACTION_SYSTEM_PROMPT (shared module — single source of truth)
 *   - completeJsonAnthropic (Claude Haiku)
 *   - sanitizeLinkedInFilters (LinkedIn ID allowlist)
 *   - resolveCompanyUrl (DB cache → Perplexity)
 *   - resolveCompanyAliases (DB cache → LLM)
 *   - findPeopleByFilters / findPeopleByLinkedInUrls / saveShortProfilesBatch
 *   - searchLinkedInShort (Apify)
 *   - fetchCompaniesForCategory (Perplexity)
 *
 * Only the orchestration (auth checks, UserCandidate upserts, email draft
 * generation, SearchLog writes) is skipped because those are not part of the
 * discovery flow under test.
 *
 * Usage:
 *   npx tsx tests/discovery-flow/run.ts [--extract-only] [--dry-run]
 *                                       [--filter=category] [--limit=N]
 *
 * Flags:
 *   --extract-only   Skip the LinkedIn/DB search step. Useful for cheap
 *                    iteration (~$0.50 vs ~$6.50 for full pipeline).
 *   --dry-run        Print the run plan (# queries, categories) and exit.
 *   --filter=<cat>   Only run queries matching the given category label.
 *   --limit=<N>      Run only the first N queries (post-filter).
 */

import 'dotenv/config';
// Enable the discovery logger BEFORE any `createLoggerForQuery` call fires.
process.env.DISCOVERY_LOGGER_ENABLED = '1';

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../../src/lib/prompts/search-extraction-prompt';
import { completeJsonAnthropic } from '../../src/lib/services/anthropic';
import { sanitizeLinkedInFilters } from '../../src/lib/services/linkedin-filter-validator';
import { resolveCompanyUrl } from '../../src/lib/services/company-resolver';
import { resolveCompanyAliases } from '../../src/lib/services/company-alias';
import { fetchCompaniesForCategory } from '../../src/lib/services/perplexity';
import {
  findPeopleByFilters,
  findPeopleByLinkedInUrls,
  saveShortProfilesBatch,
  isVectorRoleMatchingEnabled,
  type PersonFilters,
} from '../../src/lib/db/person-service';
import { searchLinkedInShort } from '../../src/lib/services/linkedin-search';
import {
  createLoggerForQuery,
  withLogger,
  log,
  APIFY_SHORT_COST_PER_PAGE,
  type DiscoveryLogger,
  type LogEntry,
} from '../../src/lib/services/discovery-logger';
import type {
  LinkedInFilters,
  DBFilters,
} from '../../src/lib/types/linkedin-filters';

import { QUERIES, type DiscoveryTestCase, type ExpectedExtraction } from './queries';

// ─── CLI args ────────────────────────────────────────────────────────────────

interface CliOptions {
  extractOnly: boolean;
  dryRun: boolean;
  filter: string | null;
  limit: number | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    extractOnly: false,
    dryRun: false,
    filter: null,
    limit: null,
  };
  for (const arg of args) {
    if (arg === '--extract-only') opts.extractOnly = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length);
    else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.slice('--limit='.length), 10);
  }
  return opts;
}

// ─── LLM response schema (mirror of ai-search.ts LLMResponse) ────────────────

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
    // Known forbidden key — sanitizer drops this. Included only so the
    // validator can see if it ever leaks through.
    industryIds?: string[];
  };
  company_name_ambiguous?: boolean;
  person_name?: string;
  person_company?: string;
  selectables?: Array<{ label: string; filter_key: 'company' | 'role'; filter_value: string }>;
  suggested_searches?: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}

// ─── Replicated extraction logic (minus auth) ────────────────────────────────

function convertLinkedInFilters(
  raw: LLMResponse['linkedin_filters'] | undefined
): LinkedInFilters {
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

const ESCALATION_KEYWORDS = [
  'startup', 'startups', 'yc', 'y combinator', 'accelerator',
  'seed', 'series a', 'series b', 'emerging', 'niche', 'new companies',
  'recently founded', 'unicorn', 'unicorns',
];

function shouldEscalateToPerplexity(
  message: string,
  confidence: string | undefined,
  selectables: Array<{ filter_key: string }>
): boolean {
  if (selectables.length > 0 && !selectables.some(s => s.filter_key === 'company')) return false;
  if (confidence === 'low') return true;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

interface ExtractionOutcome {
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup';
  dbFilters: DBFilters;
  linkedInFilters: LinkedInFilters;
  selectables: Array<{ label: string; filterKey: 'company' | 'role'; filterValue: string }>;
  personName?: string;
  personCompany?: string;
  companyNameAmbiguous?: boolean;
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
  rawResponse: LLMResponse;
  escalatedToPerplexity: boolean;
}

async function runExtraction(query: string): Promise<ExtractionOutcome> {
  log.info('ai-search', 'Received query', {
    message: query,
    currentFilters: {},
    historyLength: 0,
  });

  const response = await completeJsonAnthropic<LLMResponse>({
    systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    userPrompt: `New user message: ${query}`,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.1,
    maxTokens: 512,
  });

  const parsed = response.content;
  const { status, confidence, filters, selectables = [], message } = parsed;

  const dbFilters: DBFilters = {};
  if (filters.company) dbFilters.company = filters.company;
  if (filters.role) dbFilters.role = filters.role;
  if (filters.university) dbFilters.university = filters.university;
  if (filters.location) dbFilters.location = filters.location;
  dbFilters.roleSpecificity = parsed.role_specificity || 'standard';

  log.info('ai-search', 'LLM response parsed', {
    status,
    confidence,
    parsedFilters: dbFilters,
    personName: parsed.person_name,
    selectablesCount: selectables.length,
  });

  if (status === 'off_topic') {
    log.decision('ai-search', 'off_topic branch', { message });
    return {
      status,
      dbFilters,
      linkedInFilters: {},
      selectables: [],
      rawResponse: parsed,
      escalatedToPerplexity: false,
    };
  }

  if (status === 'person_lookup') {
    const personName = parsed.person_name?.trim() || '';
    log.decision('ai-search', 'person_lookup branch', {
      personName,
      personCompany: parsed.person_company,
    });
    return {
      status,
      dbFilters,
      linkedInFilters: {},
      selectables: [],
      personName,
      personCompany: parsed.person_company?.trim() || undefined,
      rawResponse: parsed,
      escalatedToPerplexity: false,
    };
  }

  if (status === 'needs_selection') {
    const parsedSelectables = selectables.map(s => ({
      label: s.label,
      filterKey: s.filter_key,
      filterValue: s.filter_value,
    }));
    log.decision('ai-search', 'needs_selection branch', {
      selectablesCount: parsedSelectables.length,
      confidence,
      companyNameAmbiguous: parsed.company_name_ambiguous,
    });

    let escalated = false;
    let finalSelectables = parsedSelectables;
    if (shouldEscalateToPerplexity(query, confidence, selectables)) {
      log.decision('ai-search', 'Escalating to Perplexity', {
        confidence,
        userMessage: query,
        role: filters.role,
      });
      try {
        const perplexityCompanies = await fetchCompaniesForCategory(query, filters.role, 12);
        if (perplexityCompanies.length > 0) {
          escalated = true;
          const perplexitySelectables = perplexityCompanies.map(c => ({
            label: c.name,
            filterKey: 'company' as const,
            filterValue: c.name,
          }));
          const perplexityNames = new Set(perplexityCompanies.map(c => c.name.toLowerCase()));
          const uniqueLLM = parsedSelectables.filter(
            s => !perplexityNames.has(s.filterValue.toLowerCase())
          );
          finalSelectables = [...perplexitySelectables, ...uniqueLLM].slice(0, 5);
          log.info('ai-search', 'Perplexity escalation result', {
            perplexityCount: perplexityCompanies.length,
            combinedCount: finalSelectables.length,
            shown: finalSelectables.length,
          });
        }
      } catch (err) {
        log.error('ai-search', 'Perplexity escalation failed', { error: String(err) });
      }
    }

    return {
      status,
      dbFilters,
      linkedInFilters: {},
      selectables: finalSelectables,
      companyNameAmbiguous: parsed.company_name_ambiguous,
      rawResponse: parsed,
      escalatedToPerplexity: escalated,
    };
  }

  // status === 'ready'
  const linkedInFilters = convertLinkedInFilters(parsed.linkedin_filters);
  log.info('ai-search', 'LinkedIn filters built', { linkedInFilters });

  if (dbFilters.company) {
    try {
      const resolved = await resolveCompanyUrl(dbFilters.company, dbFilters.role || undefined);
      if (resolved.url) {
        linkedInFilters.currentCompanies = [resolved.url];
        log.info('ai-search', 'Company URL resolved', {
          company: dbFilters.company,
          url: resolved.url,
          method: 'resolveCompanyUrl',
        });
      } else {
        linkedInFilters.currentCompanies = [dbFilters.company];
        log.warn('ai-search', 'Company URL not found, using name', { company: dbFilters.company });
      }
    } catch (err) {
      log.error('ai-search', 'Company URL resolution threw', {
        company: dbFilters.company,
        error: String(err),
      });
      linkedInFilters.currentCompanies = [dbFilters.company];
    }
  }

  log.info('ai-search', 'Returning ready', {
    filters: dbFilters,
    linkedInFilters,
    suggestionsCount: (parsed.suggested_searches || []).length,
  });

  return {
    status,
    dbFilters,
    linkedInFilters,
    selectables: [],
    companyNameAmbiguous: parsed.company_name_ambiguous,
    roleSpecificity: parsed.role_specificity || 'standard',
    rawResponse: parsed,
    escalatedToPerplexity: false,
  };
}

// ─── Replicated search logic (minus auth/drafts/UserCandidate) ──────────────

const DB_FIRST_THRESHOLD = 6;

interface SearchOutcome {
  path: 'advanced' | 'simple+linkedin' | 'simple(db-only)';
  dbResultCount: number;
  apiResultCount: number;
  totalResults: number;
  totalMatchesOnLinkedIn: number;
  shortModePages: number;
}

async function runSearch(
  query: string,
  dbFilters: DBFilters,
  linkedInFilters: LinkedInFilters
): Promise<SearchOutcome> {
  log.info('search-v2', 'Received search request', {
    query,
    dbFilters,
    linkedInFilterKeys: Object.keys(linkedInFilters),
    limit: 25,
    excludeCount: 0,
  });

  // Ensure currentCompanies is set for simple path if missing
  const lf: LinkedInFilters = { ...linkedInFilters };
  if (dbFilters.company && (!lf.currentCompanies || lf.currentCompanies.length === 0)) {
    try {
      const resolved = await resolveCompanyUrl(dbFilters.company, dbFilters.role || undefined);
      if (resolved.url) {
        lf.currentCompanies = [resolved.url];
        log.info('search-v2', 'Company URL resolved', {
          company: dbFilters.company,
          url: resolved.url,
        });
      } else {
        lf.currentCompanies = [dbFilters.company];
        log.warn('search-v2', 'Company URL not found, using name', { company: dbFilters.company });
      }
    } catch (err) {
      log.error('search-v2', 'Company URL resolution threw', {
        company: dbFilters.company,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasAdvancedFilters = !!(
    lf.seniorityLevelIds?.length ||
    lf.companyHeadcount?.length ||
    lf.functionIds?.length ||
    lf.yearsOfExperienceIds?.length ||
    lf.pastCompanies?.length ||
    lf.pastJobTitles?.length ||
    lf.recentlyChangedJobs
  );

  if (hasAdvancedFilters) {
    log.decision('search-v2', 'Advanced path taken', {
      hasAdvancedFilters: true,
      advancedFilterKeys: Object.entries(lf)
        .filter(
          ([k, v]) =>
            [
              'seniorityLevelIds',
              'companyHeadcount',
              'functionIds',
              'yearsOfExperienceIds',
              'pastCompanies',
              'pastJobTitles',
              'recentlyChangedJobs',
            ].includes(k) && v
        )
        .map(([k]) => k),
    });

    const apiStart = Date.now();
    const apiResult = await searchLinkedInShort({ ...lf, startPage: 1, takePages: 1 });
    const durationMs = Date.now() - apiStart;

    log.info('search-v2', 'LinkedIn Short returned (advanced)', {
      profileCount: apiResult.profiles.length,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
      totalLinkedInPages: apiResult.pagination.totalPages,
      durationMs,
      costUsd: APIFY_SHORT_COST_PER_PAGE,
    });

    const schoolTag = lf.schools?.[0] || null;
    const saveResults = await saveShortProfilesBatch(apiResult.profiles, schoolTag);
    const newCount = saveResults.filter(r => r.isNew).length;
    log.info('search-v2', 'Profiles saved (advanced)', {
      total: apiResult.profiles.length,
      new: newCount,
      failed: saveResults.filter(r => !r.personId).length,
    });

    const linkedinUrls = apiResult.profiles
      .map(p => p.linkedinUrl)
      .filter((url): url is string => !!url);
    const personMap = await findPeopleByLinkedInUrls(linkedinUrls);

    log.info('search-v2', 'Returning results', {
      resultCount: personMap.size,
      hasMore: apiResult.pagination.totalElements > apiResult.profiles.length,
      path: 'advanced',
      dbHits: 0,
      apiHits: apiResult.profiles.length,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
    });

    return {
      path: 'advanced',
      dbResultCount: 0,
      apiResultCount: apiResult.profiles.length,
      totalResults: personMap.size,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
      shortModePages: 1,
    };
  }

  // Simple path
  log.decision('search-v2', 'Simple path taken', {});

  let companyAliases: string[] = [];
  if (dbFilters.company) {
    const resolved = await resolveCompanyAliases(dbFilters.company);
    companyAliases = resolved.aliases;
    log.info('search-v2', 'Company aliases resolved', {
      company: dbFilters.company,
      aliases: companyAliases,
    });
  }

  const filters: PersonFilters = {
    company: dbFilters.company || '',
    companyAliases: companyAliases.length > 0 ? companyAliases : undefined,
    location: dbFilters.location || undefined,
    role: dbFilters.role || undefined,
    university: dbFilters.university || undefined,
    roleSpecificity: dbFilters.roleSpecificity,
    requireEmail: false,
    limit: 25,
  };

  const dbStart = Date.now();
  const people = await findPeopleByFilters(filters);
  const dbResultCount = people.length;
  log.info('search-v2', 'DB query complete', {
    resultCount: dbResultCount,
    durationMs: Date.now() - dbStart,
    aliasesUsed: companyAliases.length,
  });

  if (dbResultCount < DB_FIRST_THRESHOLD) {
    log.decision('search-v2', 'DB insufficient — calling LinkedIn Short', {
      dbResultCount,
      threshold: DB_FIRST_THRESHOLD,
    });
    const apiStart = Date.now();
    const apiResult = await searchLinkedInShort({ ...lf, startPage: 1, takePages: 1 });
    log.info('search-v2', 'LinkedIn Short returned (simple)', {
      profileCount: apiResult.profiles.length,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
      durationMs: Date.now() - apiStart,
      costUsd: APIFY_SHORT_COST_PER_PAGE,
    });

    const schoolTag = lf.schools?.[0] || null;
    const saveResults = await saveShortProfilesBatch(apiResult.profiles, schoolTag);
    const newCount = saveResults.filter(r => r.isNew).length;
    log.info('search-v2', 'Profiles saved (simple)', {
      total: apiResult.profiles.length,
      new: newCount,
      failed: saveResults.filter(r => !r.personId).length,
    });

    const linkedinUrls = apiResult.profiles
      .map(p => p.linkedinUrl)
      .filter((url): url is string => !!url);
    const personMap = await findPeopleByLinkedInUrls(linkedinUrls);
    const linkedInPersonIds = new Set(Array.from(personMap.values()).map(p => p.id));
    const dbOnly = people.filter(p => !linkedInPersonIds.has(p.id));
    const totalResults = personMap.size + dbOnly.length;

    log.info('search-v2', 'Returning results', {
      resultCount: totalResults,
      hasMore: apiResult.pagination.totalElements > apiResult.profiles.length,
      path: 'simple+linkedin',
      dbHits: dbResultCount,
      apiHits: apiResult.profiles.length,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
    });

    return {
      path: 'simple+linkedin',
      dbResultCount,
      apiResultCount: apiResult.profiles.length,
      totalResults,
      totalMatchesOnLinkedIn: apiResult.pagination.totalElements,
      shortModePages: 1,
    };
  }

  // DB sufficient — skip API
  log.decision('search-v2', 'DB sufficient — skipping API', {
    dbResultCount,
    threshold: DB_FIRST_THRESHOLD,
    vectorActive: isVectorRoleMatchingEnabled() && !!dbFilters.role,
  });
  log.info('search-v2', 'Returning results', {
    resultCount: dbResultCount,
    hasMore: dbResultCount > 0,
    path: 'simple(db-only)',
    dbHits: dbResultCount,
    apiHits: 0,
    totalMatchesOnLinkedIn: 0,
  });

  return {
    path: 'simple(db-only)',
    dbResultCount,
    apiResultCount: 0,
    totalResults: dbResultCount,
    totalMatchesOnLinkedIn: 0,
    shortModePages: 0,
  };
}

// ─── Validator ───────────────────────────────────────────────────────────────

interface ValidationResult {
  passed: boolean;
  failures: string[];
  observations: string[];
}

function matchArraySubset<T>(actual: T[] | undefined, expected: T[]): boolean {
  if (!expected.length) return true;
  if (!actual) return false;
  return expected.every(v => actual.includes(v));
}

function validateExtraction(
  expected: ExpectedExtraction,
  outcome: ExtractionOutcome,
  entries: readonly LogEntry[]
): ValidationResult {
  const failures: string[] = [];
  const observations: string[] = [];

  // 1. Status check (hard fail)
  if (outcome.status !== expected.status) {
    failures.push(
      `extraction.status mismatch: expected=${expected.status}, actual=${outcome.status}`
    );
    // Still run the rest of the checks for diagnostic value, but flag as failed
  }

  // 2. Filters check (if expected.filters provided)
  if (expected.filters) {
    for (const [k, v] of Object.entries(expected.filters)) {
      const actual = (outcome.dbFilters as Record<string, unknown>)[k];
      if (actual !== v) {
        failures.push(`dbFilters.${k} mismatch: expected="${v}", actual="${actual ?? '(unset)'}"`);
      }
    }
  }

  // 3. LinkedInFilters subset check
  if (expected.linkedInFilters) {
    for (const [k, v] of Object.entries(expected.linkedInFilters)) {
      const actual = (outcome.linkedInFilters as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        if (!matchArraySubset(actual as unknown[], v)) {
          failures.push(
            `linkedInFilters.${k} missing values: expected subset=${JSON.stringify(v)}, actual=${JSON.stringify(actual ?? null)}`
          );
        }
      } else if (typeof v === 'boolean') {
        if (actual !== v) {
          failures.push(`linkedInFilters.${k} mismatch: expected=${v}, actual=${actual ?? '(unset)'}`);
        }
      }
    }
  }

  // 4. Forbidden LinkedIn filter keys
  if (expected.forbiddenLinkedInFilterKeys) {
    for (const k of expected.forbiddenLinkedInFilterKeys) {
      if (k in outcome.linkedInFilters) {
        failures.push(`linkedInFilters.${k} leaked through sanitizer — should have been stripped`);
      }
    }
  }

  // 5. Selectables count / labels (needs_selection only)
  if (expected.status === 'needs_selection' && outcome.status === 'needs_selection') {
    if (expected.minSelectables != null && outcome.selectables.length < expected.minSelectables) {
      failures.push(
        `selectables count too low: expected>=${expected.minSelectables}, actual=${outcome.selectables.length}`
      );
    }
    if (expected.maxSelectables != null && outcome.selectables.length > expected.maxSelectables) {
      failures.push(
        `selectables count too high: expected<=${expected.maxSelectables}, actual=${outcome.selectables.length}`
      );
    }
    if (expected.mustContainSelectables) {
      const actualLabels = outcome.selectables.map(s => s.label.toLowerCase());
      for (const label of expected.mustContainSelectables) {
        if (!actualLabels.some(l => l.includes(label.toLowerCase()))) {
          failures.push(
            `missing expected selectable label: "${label}". Got: [${outcome.selectables.map(s => s.label).join(', ')}]`
          );
        }
      }
    }
  }

  // 6. Perplexity escalation (decision entry presence + outcome flag)
  if (expected.shouldEscalateToPerplexity != null) {
    const escalationEntry = entries.find(
      e => e.kind === 'decision' && e.message === 'Escalating to Perplexity'
    );
    const didEscalate = !!escalationEntry;
    if (expected.shouldEscalateToPerplexity !== didEscalate) {
      failures.push(
        `Perplexity escalation mismatch: expected=${expected.shouldEscalateToPerplexity}, actual=${didEscalate}`
      );
    } else if (didEscalate) {
      observations.push('Perplexity escalation fired as expected');
    }
  }

  // 7. Person lookup fields
  if (expected.status === 'person_lookup' && outcome.status === 'person_lookup') {
    if (expected.personName && outcome.personName?.toLowerCase() !== expected.personName.toLowerCase()) {
      failures.push(
        `personName mismatch: expected="${expected.personName}", actual="${outcome.personName ?? '(unset)'}"`
      );
    }
    if (expected.personCompany && outcome.personCompany?.toLowerCase() !== expected.personCompany.toLowerCase()) {
      failures.push(
        `personCompany mismatch: expected="${expected.personCompany}", actual="${outcome.personCompany ?? '(unset)'}"`
      );
    }
  }

  // 8. Role specificity check
  if (expected.roleSpecificity && outcome.status === 'ready') {
    if (outcome.roleSpecificity !== expected.roleSpecificity) {
      failures.push(
        `roleSpecificity mismatch: expected="${expected.roleSpecificity}", actual="${outcome.roleSpecificity ?? '(unset)'}"`
      );
    }
  }

  return { passed: failures.length === 0, failures, observations };
}

function validateSearch(
  testCase: DiscoveryTestCase,
  outcome: SearchOutcome | null,
  entries: readonly LogEntry[]
): ValidationResult {
  const failures: string[] = [];
  const observations: string[] = [];
  const expected = testCase.expected.search;
  if (!expected) return { passed: true, failures, observations };

  if (expected.shouldRun === false) {
    if (outcome) {
      failures.push('search ran when it should not have (non-ready extraction)');
    }
    return { passed: failures.length === 0, failures, observations };
  }

  if (!outcome) {
    failures.push('search did not run when it was expected to');
    return { passed: false, failures, observations };
  }

  if (expected.advancedPath && outcome.path !== 'advanced') {
    failures.push(`expected advanced path, got "${outcome.path}"`);
  }
  if (expected.simplePath) {
    if (!outcome.path.startsWith('simple')) {
      failures.push(`expected simple path, got "${outcome.path}"`);
    }
  }

  if (expected.minResults != null && outcome.totalResults < expected.minResults) {
    failures.push(
      `too few results: expected>=${expected.minResults}, actual=${outcome.totalResults}`
    );
  }

  observations.push(
    `search path=${outcome.path}, db=${outcome.dbResultCount}, api=${outcome.apiResultCount}, total=${outcome.totalResults}`
  );

  // Check for error entries that might indicate sub-system failure
  const errorEntries = entries.filter(e => e.level === 'error');
  if (errorEntries.length > 0) {
    for (const e of errorEntries) {
      observations.push(`log error: ${e.component} — ${e.message}`);
    }
  }

  return { passed: failures.length === 0, failures, observations };
}

// ─── Per-test runner ─────────────────────────────────────────────────────────

interface TestResult {
  testCase: DiscoveryTestCase;
  durationMs: number;
  extraction: {
    outcome: ExtractionOutcome | null;
    logFilePath: string | null;
    validation: ValidationResult;
    error: string | null;
  };
  search: {
    outcome: SearchOutcome | null;
    logFilePath: string | null;
    validation: ValidationResult;
    error: string | null;
    skipped: boolean;
  };
  overall: 'pass' | 'fail' | 'error';
}

async function runOneTest(
  testCase: DiscoveryTestCase,
  opts: CliOptions
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    testCase,
    durationMs: 0,
    extraction: {
      outcome: null,
      logFilePath: null,
      validation: { passed: false, failures: [], observations: [] },
      error: null,
    },
    search: {
      outcome: null,
      logFilePath: null,
      validation: { passed: true, failures: [], observations: [] },
      error: null,
      skipped: false,
    },
    overall: 'pass',
  };

  // ── Extraction ──
  const extractLogger = createLoggerForQuery(`extract:${testCase.query}`);
  if (!extractLogger) {
    result.extraction.error = 'createLoggerForQuery returned null — DISCOVERY_LOGGER_ENABLED not set';
    result.overall = 'error';
    result.durationMs = Date.now() - start;
    return result;
  }
  result.extraction.logFilePath = extractLogger.filePath;

  try {
    const outcome = await withLogger(extractLogger, () => runExtraction(testCase.query));
    result.extraction.outcome = outcome;
    const entries = extractLogger.getEntries();
    result.extraction.validation = validateExtraction(
      testCase.expected.extraction,
      outcome,
      entries
    );
    await extractLogger.finalize('success');
  } catch (err) {
    result.extraction.error = err instanceof Error ? err.message : String(err);
    await extractLogger.finalize('error', result.extraction.error);
    result.overall = 'error';
    result.durationMs = Date.now() - start;
    return result;
  }

  // ── Search (only when extraction was ready + not skipped) ──
  const shouldRunSearch =
    !opts.extractOnly &&
    result.extraction.outcome?.status === 'ready' &&
    testCase.expected.search?.shouldRun !== false;

  if (!shouldRunSearch) {
    result.search.skipped = true;
    // In extract-only mode, we intentionally don't exercise search, so skip
    // its validator entirely — marking it trivially passing. Otherwise, we
    // validate that search WAS supposed to be skipped (e.g. shouldRun=false).
    if (opts.extractOnly) {
      result.search.validation = { passed: true, failures: [], observations: ['search skipped (extract-only mode)'] };
    } else {
      result.search.validation = validateSearch(testCase, null, []);
    }
  } else {
    const searchLogger = createLoggerForQuery(`search:${testCase.query}`);
    if (!searchLogger) {
      result.search.error = 'createLoggerForQuery returned null for search';
    } else {
      result.search.logFilePath = searchLogger.filePath;
      try {
        const searchOutcome = await withLogger(searchLogger, () =>
          runSearch(
            testCase.query,
            result.extraction.outcome!.dbFilters,
            result.extraction.outcome!.linkedInFilters
          )
        );
        result.search.outcome = searchOutcome;
        const entries = searchLogger.getEntries();
        result.search.validation = validateSearch(testCase, searchOutcome, entries);
        await searchLogger.finalize('success');
      } catch (err) {
        result.search.error = err instanceof Error ? err.message : String(err);
        await searchLogger.finalize('error', result.search.error);
      }
    }
  }

  // ── Roll up overall status ──
  if (result.extraction.error || result.search.error) {
    result.overall = 'error';
  } else if (!result.extraction.validation.passed || !result.search.validation.passed) {
    result.overall = 'fail';
  } else {
    result.overall = 'pass';
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ─── Markdown report ─────────────────────────────────────────────────────────

function renderExpected(expected: ExpectedExtraction): string {
  const parts: string[] = [`status=${expected.status}`];
  if (expected.filters) parts.push(`filters=${JSON.stringify(expected.filters)}`);
  if (expected.linkedInFilters) parts.push(`linkedIn=${JSON.stringify(expected.linkedInFilters)}`);
  if (expected.minSelectables != null) parts.push(`minSelectables=${expected.minSelectables}`);
  if (expected.mustContainSelectables) parts.push(`mustContain=[${expected.mustContainSelectables.join(', ')}]`);
  if (expected.shouldEscalateToPerplexity != null) parts.push(`perplexity=${expected.shouldEscalateToPerplexity}`);
  return parts.join(', ');
}

function renderActual(result: TestResult): string {
  const ext = result.extraction.outcome;
  if (!ext) return result.extraction.error || '(no extraction outcome)';
  const parts: string[] = [`status=${ext.status}`];
  if (Object.keys(ext.dbFilters).length) parts.push(`filters=${JSON.stringify(ext.dbFilters)}`);
  if (Object.keys(ext.linkedInFilters).length) parts.push(`linkedIn=${JSON.stringify(ext.linkedInFilters)}`);
  if (ext.status === 'needs_selection') {
    parts.push(`selectables=[${ext.selectables.map(s => s.label).join(', ')}]`);
    if (ext.escalatedToPerplexity) parts.push('perplexity=true');
  }
  if (ext.status === 'person_lookup') {
    parts.push(`personName="${ext.personName}"`);
    if (ext.personCompany) parts.push(`personCompany="${ext.personCompany}"`);
  }
  if (result.search.outcome) {
    const s = result.search.outcome;
    parts.push(`searchPath=${s.path}`);
    parts.push(`results=${s.totalResults}(db=${s.dbResultCount},api=${s.apiResultCount})`);
  }
  return parts.join(', ');
}

function renderFailureBlock(result: TestResult): string {
  const lines: string[] = [];
  lines.push(`### ${result.testCase.id} — \`${result.testCase.category}\``);
  lines.push('');
  lines.push(`**Query:** \`${result.testCase.query}\``);
  lines.push('');
  lines.push(`**Description:** ${result.testCase.description}`);
  lines.push('');
  lines.push(`**Expected:** ${renderExpected(result.testCase.expected.extraction)}`);
  lines.push('');
  lines.push(`**Actual:** ${renderActual(result)}`);
  lines.push('');
  if (result.extraction.error) {
    lines.push(`**Extraction error:** \`${result.extraction.error}\``);
    lines.push('');
  }
  if (result.search.error) {
    lines.push(`**Search error:** \`${result.search.error}\``);
    lines.push('');
  }
  const allFailures = [
    ...result.extraction.validation.failures.map(f => `[extraction] ${f}`),
    ...result.search.validation.failures.map(f => `[search] ${f}`),
  ];
  if (allFailures.length > 0) {
    lines.push('**Failures:**');
    for (const f of allFailures) lines.push(`- ${f}`);
    lines.push('');
  }
  if (result.extraction.logFilePath) {
    lines.push(`**Log (extract):** \`${result.extraction.logFilePath}\``);
  }
  if (result.search.logFilePath) {
    lines.push(`**Log (search):** \`${result.search.logFilePath}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function buildReport(results: TestResult[], opts: CliOptions): string {
  const total = results.length;
  const passed = results.filter(r => r.overall === 'pass').length;
  const failed = results.filter(r => r.overall === 'fail').length;
  const errored = results.filter(r => r.overall === 'error').length;
  const totalCostEstimate = results.reduce((sum, r) => {
    let c = 0.005; // rough extraction cost
    if (r.search.outcome && r.search.outcome.shortModePages > 0) c += 0.1;
    if (r.extraction.outcome?.escalatedToPerplexity) c += 0.005;
    return sum + c;
  }, 0);

  const lines: string[] = [];
  lines.push(`# Discovery Flow Test Report`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: ${opts.extractOnly ? 'extract-only' : 'full pipeline'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total queries: **${total}**`);
  lines.push(`- Passed: **${passed}** (${((passed / total) * 100).toFixed(1)}%)`);
  lines.push(`- Failed: **${failed}**`);
  lines.push(`- Errored: **${errored}**`);
  lines.push(`- Estimated cost: **$${totalCostEstimate.toFixed(2)}**`);
  lines.push('');

  // ── Category breakdown ──
  lines.push('## By Category');
  lines.push('');
  lines.push('| Category | Total | Pass | Fail | Error |');
  lines.push('|----------|------:|-----:|-----:|------:|');
  const byCategory = new Map<string, { total: number; pass: number; fail: number; error: number }>();
  for (const r of results) {
    const c = r.testCase.category;
    const entry = byCategory.get(c) || { total: 0, pass: 0, fail: 0, error: 0 };
    entry.total++;
    if (r.overall === 'pass') entry.pass++;
    else if (r.overall === 'fail') entry.fail++;
    else entry.error++;
    byCategory.set(c, entry);
  }
  const sortedCategories = [...byCategory.entries()].sort((a, b) => {
    const aFail = a[1].fail + a[1].error;
    const bFail = b[1].fail + b[1].error;
    if (aFail !== bFail) return bFail - aFail;
    return a[0].localeCompare(b[0]);
  });
  for (const [cat, stats] of sortedCategories) {
    lines.push(`| ${cat} | ${stats.total} | ${stats.pass} | ${stats.fail} | ${stats.error} |`);
  }
  lines.push('');

  // ── Failures (surfaced at top) ──
  const failures = results.filter(r => r.overall !== 'pass');
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push(`${failures.length} test(s) failed. Details below:`);
    lines.push('');
    for (const r of failures) {
      lines.push(renderFailureBlock(r));
      lines.push('---');
      lines.push('');
    }
  } else {
    lines.push('## Failures');
    lines.push('');
    lines.push('None. All tests passed.');
    lines.push('');
  }

  // ── Passing tests (one-liner each) ──
  lines.push('## Passing Tests');
  lines.push('');
  const passingByCategory = new Map<string, TestResult[]>();
  for (const r of results.filter(r => r.overall === 'pass')) {
    const list = passingByCategory.get(r.testCase.category) || [];
    list.push(r);
    passingByCategory.set(r.testCase.category, list);
  }
  for (const [cat, list] of [...passingByCategory.entries()].sort()) {
    lines.push(`### ${cat}`);
    lines.push('');
    for (const r of list) {
      const ext = r.extraction.outcome!;
      const summary = ext.status === 'ready'
        ? `${ext.status} — ${JSON.stringify(ext.dbFilters)}`
        : ext.status === 'needs_selection'
          ? `needs_selection (${ext.selectables.length} options)`
          : ext.status;
      const searchSummary = r.search.outcome
        ? ` → ${r.search.outcome.path} (${r.search.outcome.totalResults} results)`
        : r.search.skipped
          ? ''
          : '';
      lines.push(`- **${r.testCase.id}**: \`${r.testCase.query}\` → ${summary}${searchSummary} _(${r.durationMs}ms)_`);
    }
    lines.push('');
  }

  // ── Observations (non-failing notes) ──
  const allObservations = results.flatMap(r => [
    ...r.extraction.validation.observations.map(o => `[${r.testCase.id}/extract] ${o}`),
    ...r.search.validation.observations.map(o => `[${r.testCase.id}/search] ${o}`),
  ]);
  if (allObservations.length > 0) {
    lines.push('## Observations');
    lines.push('');
    for (const o of allObservations) lines.push(`- ${o}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function printLineUpdate(prefix: string, text: string): void {
  // eslint-disable-next-line no-console
  console.log(`${prefix} ${text}`);
}

async function main(): Promise<void> {
  const opts = parseArgs();

  let queries = QUERIES;
  if (opts.filter) {
    queries = queries.filter(q => q.category === opts.filter);
  }
  if (opts.limit != null && opts.limit > 0) {
    queries = queries.slice(0, opts.limit);
  }

  printLineUpdate('▶', `Discovery-flow harness — ${queries.length} queries selected`);
  printLineUpdate('▶', `Mode: ${opts.extractOnly ? 'extract-only' : 'full pipeline (real $)'}`);
  if (opts.filter) printLineUpdate('▶', `Filter: ${opts.filter}`);
  if (opts.limit) printLineUpdate('▶', `Limit: ${opts.limit}`);

  if (opts.dryRun) {
    const byCat = new Map<string, number>();
    for (const q of queries) byCat.set(q.category, (byCat.get(q.category) || 0) + 1);
    printLineUpdate('▶', 'Dry run — categories:');
    for (const [cat, n] of [...byCat.entries()].sort()) {
      printLineUpdate('  ', `${cat}: ${n}`);
    }
    process.exit(0);
  }

  // Sanity check — missing env vars will surface here rather than mid-run
  const required = ['ANTHROPIC_API_KEY', 'APIFY_API_KEY', 'DATABASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    printLineUpdate('✗', `Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const results: TestResult[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const prefix = `[${i + 1}/${queries.length}] ${q.id}`;
    printLineUpdate('▶', `${prefix} — "${q.query}"`);
    try {
      const result = await runOneTest(q, opts);
      results.push(result);
      const icon = result.overall === 'pass' ? '✓' : result.overall === 'fail' ? '✗' : '!';
      const extStatus = result.extraction.outcome?.status ?? 'error';
      const searchStatus = result.search.skipped
        ? 'skipped'
        : result.search.outcome?.path ?? 'error';
      printLineUpdate(icon, `${prefix} ${result.overall.toUpperCase()} (${result.durationMs}ms) ext=${extStatus} search=${searchStatus}`);
      if (result.overall !== 'pass') {
        const allFailures = [
          ...result.extraction.validation.failures,
          ...result.search.validation.failures,
        ];
        for (const f of allFailures) printLineUpdate('   ', `↳ ${f}`);
        if (result.extraction.error) printLineUpdate('   ', `↳ extraction: ${result.extraction.error}`);
        if (result.search.error) printLineUpdate('   ', `↳ search: ${result.search.error}`);
      }
    } catch (err) {
      printLineUpdate('!', `${prefix} uncaught error: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        testCase: q,
        durationMs: 0,
        extraction: {
          outcome: null,
          logFilePath: null,
          validation: { passed: false, failures: [`uncaught error: ${err}`], observations: [] },
          error: err instanceof Error ? err.message : String(err),
        },
        search: {
          outcome: null,
          logFilePath: null,
          validation: { passed: true, failures: [], observations: [] },
          error: null,
          skipped: true,
        },
        overall: 'error',
      });
    }
  }

  // ── Write report ──
  const reportDir = join(process.cwd(), 'tests', 'discovery-flow', 'reports');
  await mkdir(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportDir, `report-${ts}.md`);
  const report = buildReport(results, opts);
  await writeFile(reportPath, report, 'utf8');

  const passed = results.filter(r => r.overall === 'pass').length;
  const failed = results.filter(r => r.overall === 'fail').length;
  const errored = results.filter(r => r.overall === 'error').length;
  printLineUpdate('▶', '─'.repeat(60));
  printLineUpdate('▶', `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Errored: ${errored}`);
  printLineUpdate('▶', `Report: ${reportPath}`);

  // Exit code reflects pass/fail for CI integration
  process.exit(failed + errored > 0 ? 1 : 0);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[harness] Fatal error:', err);
  process.exit(2);
});
