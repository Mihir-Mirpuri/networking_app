/**
 * AI Search Pipeline Integration Test
 *
 * Runs 20 diverse natural language queries through the actual pipeline:
 *   1. LLM filter extraction (Groq)
 *   2. Company alias resolution (DB + LLM)
 *   3. DB query (vector or ILIKE)
 *   4. Background scrape (2 pages/company if unscraped pages exist)
 *   5. Gap analysis summary
 *
 * Usage: npx tsx tests/ai-search-pipeline.ts
 */

import 'dotenv/config';
import { completeJson } from '../src/lib/services/groq';
import { resolveCompanyAliases, resolveMultiCompanyAliases } from '../src/lib/services/company-alias';
import {
  findPeopleByFilters,
  findPeopleByLinkedInUrls,
  saveScrapedProfile,
  isVectorRoleMatchingEnabled,
  getRoleSearchTerms,
  type PersonResult,
} from '../src/lib/db/person-service';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles, type ScrapedProfile } from '../src/lib/services/linkedin-scraper';
import { preFilterUrls } from '../src/lib/services/snippet-filter';
import {
  buildSerperQuery,
  computeQueryHash,
  findOrCreateScrapeProgressWithHash,
  updateScrapeProgress,
  getNextCsePageStart,
  type NormalizedSearchParams,
} from '../src/lib/db/search-cache';
import { getSearchRoleEmbedding } from '../src/lib/services/embeddings';
import prisma from '../src/lib/prisma';

// ── Types ──

interface LLMResponse {
  filters: {
    company: string | null;
    companies: string[] | null;
    role: string | null;
    university: string | null;
    location: string | null;
  };
  message: string;
}

interface ParsedFilters {
  company?: string;
  companies?: string[];
  role?: string;
  university?: string;
  location?: string;
}

type QueryStatus = 'OK' | 'LOW_RESULTS' | 'ZERO_RESULTS' | 'ERROR';

interface ScrapeStats {
  triggered: boolean;
  skippedExhausted: boolean;
  pagesScraped: number;
  serperUrls: number;
  prefiltered: number;
  scraped: number;
  newPeople: number;
  postScrapeCount: number;
}

interface QueryResult {
  index: number;
  query: string;
  filters: ParsedFilters;
  aliasCount: number;
  allAliases: string[];
  dbPath: 'VECTOR' | 'ILIKE' | 'UNKNOWN';
  resultCount: number;
  initialResultCount: number;
  distanceRange?: string;
  topRoles: string[];
  roleCounts: Record<string, number>;
  status: QueryStatus;
  statusNote: string;
  error?: string;
  durationMs: number;
  scrapeStats?: ScrapeStats;
}

// ── System prompt (replicated from ai-search.ts since not exported) ──

const SYSTEM_PROMPT = `You are a search filter extraction assistant. Your job is to extract structured search filters from natural language queries about finding professional contacts.

You must extract up to 5 filters:
- company: A single company/organization name (e.g., "Google", "McKinsey", "Goldman Sachs")
- companies: An array of company names when the user asks about a category/industry (e.g., "top consulting firms" → ["McKinsey", "BCG", "Bain", "Deloitte", "Accenture"]). Max 5 companies.
- role: The job role/title (e.g., "Product Manager", "Software Engineer", "Analyst")
- university: The university/school name (e.g., "UT Austin", "Stanford", "MIT")
- location: The city, state, or region (e.g., "Austin", "New York", "San Francisco")

RULES:
1. Extract filters from the user's message. If a filter was previously set and the user doesn't mention it, KEEP the previous value.
2. If the user says something like "try X instead" or "change to X", replace the relevant filter.
3. If the user says "remove the role filter" or "any role", set that filter to null.
4. If no company or companies is extracted and none was previously set, your message MUST ask the user to specify a company.
5. Be smart about interpreting queries: "PMs" = "Product Manager", "SWEs" = "Software Engineer", "bankers" = role in banking context.
6. "at [X]" almost always means company (e.g., "engineers at Meta" → company: "Meta"). "from [X]" almost always means university (e.g., "from Stanford" → university: "Stanford University").
7. For university abbreviations: "UT" = "UT Austin", "MIT" = "MIT", "Stanford" = "Stanford University".
8. Your message should be a brief, friendly confirmation of what you're searching for, or a clarifying question.
9. Use "companies" (array) when the user mentions an industry or category like "consulting firms", "big tech", "investment banks", "FAANG", etc. Use "company" (single) when they name a specific company. When "companies" is set, "company" should be null.
10. Max 5 companies in the array.
11. IMPORTANT: Always extract a company when one is clearly mentioned. "at Meta", "at Google", "at McKinsey" = company. Never drop a clearly stated company.
12. IMPORTANT: "[Company] [role] in [location]" means company=[Company], role=[role], location=[location]. Examples: "Goldman Sachs analysts in New York" → company="Goldman Sachs", role="Analyst", location="New York". "Deloitte consultants in Chicago" → company="Deloitte", role="consultant", location="Chicago". The company name always comes first if it appears before the role.

Respond with JSON: { "filters": { "company": string|null, "companies": string[]|null, "role": string|null, "university": string|null, "location": string|null }, "message": string }`;

function buildUserPrompt(message: string): string {
  return `New user message: ${message}`;
}

// ── Test queries ──

const TEST_QUERIES = [
  // Single company + role (basic)
  'software engineers at Google',
  'product managers at Meta',
  'analysts at Goldman Sachs',

  // Role abbreviations / slang
  'PMs at Amazon',
  'SWEs at Apple',
  'bankers at JP Morgan',

  // Industry / category terms (the "consulting" bug class)
  'people that work in consulting at BCG',
  'someone in banking at Citi',
  'people in tech at Microsoft',

  // Multi-company / category queries
  'partners at top consulting firms',
  'software engineers at FAANG companies',
  'analysts at bulge bracket banks',

  // University filter
  'McKinsey consultants from UT Austin',
  'Google engineers from Stanford',

  // Location filter
  'Goldman Sachs analysts in New York',
  'consultants at Deloitte in Austin',

  // Compound filters
  'product managers at Google from MIT in San Francisco',

  // Vague / edge cases
  'people at McKinsey',
  'recruiters at Amazon',
  'managing directors at Morgan Stanley',
];

// ── Helpers ──

function countRoles(results: PersonResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    const role = r.role || '(null)';
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

function topRolesSummary(roleCounts: Record<string, number>, max = 5): string {
  return Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([role, count]) => `${role} (x${count})`)
    .join(', ');
}

function assessStatus(
  results: PersonResult[],
  filters: ParsedFilters,
  dbPath: string,
): { status: QueryStatus; note: string } {
  if (results.length === 0) {
    return { status: 'ZERO_RESULTS', note: 'No results found' };
  }

  const notes: string[] = [];

  // Check for low results
  if (results.length <= 2) {
    notes.push(`Only ${results.length} result(s) found, expected more`);
  }

  // Check if role filter was applied but top roles don't seem relevant
  if (filters.role) {
    const roleTerms = getRoleSearchTerms(filters.role);
    const roleLower = filters.role.toLowerCase();
    // Also check the root word (strip trailing s/ing/ers/er for fuzzy matching)
    const rootWord = roleLower.replace(/(ers?|ing|s)$/i, '');
    const matchingResults = results.filter(r => {
      if (!r.role) return false;
      const rl = r.role.toLowerCase();
      // Check: alias terms, exact filter term, or root word substring
      return roleTerms.some(term => rl.includes(term))
        || rl.includes(roleLower)
        || (rootWord.length >= 3 && rl.includes(rootWord));
    });
    const matchRate = matchingResults.length / results.length;
    if (matchRate < 0.5 && results.length > 2) {
      notes.push(
        `Role mismatch: only ${Math.round(matchRate * 100)}% of results match role="${filters.role}" (terms: ${roleTerms.join(', ')})`
      );
    }
  }

  // Check for ILIKE fallback when vector was expected
  if (dbPath === 'ILIKE' && filters.role && isVectorRoleMatchingEnabled()) {
    notes.push('ILIKE fallback — embedding generation may have failed');
  }

  if (notes.length > 0) {
    return {
      status: results.length <= 2 ? 'LOW_RESULTS' : 'OK',
      note: notes.join('; '),
    };
  }

  return { status: 'OK', note: '' };
}

// ── Scrape helper (replicates processRefreshBatch logic) ──

const BACKGROUND_SCRAPE_PAGES = 2; // Scrape up to 2 pages per company per search

/**
 * Scrape a single page for a company. Returns stats for that page.
 */
async function scrapeOnePage(
  company: string,
  filters: ParsedFilters,
  searchId: string,
  pageStart: number,
): Promise<{ serperUrls: number; prefiltered: number; scraped: number; newPeople: number }> {
  // Discover LinkedIn profiles via Serper
  const cseResults = await discoverLinkedInProfiles({
    company,
    role: filters.role,
    university: filters.university,
    location: filters.location,
    limit: 10,
    pageStart,
  });

  if (cseResults.length === 0) {
    await updateScrapeProgress(searchId, pageStart, 0, { cseCallsMade: 1 });
    return { serperUrls: 0, prefiltered: 0, scraped: 0, newPeople: 0 };
  }

  // Filter out known URLs
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existingPeopleMap = await findPeopleByLinkedInUrls(linkedinUrls);
  let urlsToScrape = linkedinUrls.filter(url => !existingPeopleMap.has(url));

  // Pre-filter by snippet metadata
  const snippetMap = new Map(
    cseResults.map(r => [r.linkedinUrl, { snippet: r.sourceSnippet, company: r.cseCompany }])
  );
  const { filteredUrls, prefilteredCount } = await preFilterUrls(
    urlsToScrape,
    snippetMap,
    { company, university: filters.university, location: filters.location }
  );
  urlsToScrape = filteredUrls;

  let newPeople = 0;

  // Scrape via Apify
  if (urlsToScrape.length > 0) {
    const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: async (profiles: ScrapedProfile[]) => {
        for (const profile of profiles) {
          const cseResult = cseResultMap.get(profile.linkedinUrl);
          if (!cseResult) continue;

          const { isNew } = await saveScrapedProfile(
            profile,
            cseResult.linkedinUrl,
            cseResult.sourceTitle,
            cseResult.sourceSnippet,
            cseResult.sourceDomain,
            company,
            filters.university
          );
          if (isNew) newPeople++;
        }
      },
    });
  }

  // Update scrape progress
  await updateScrapeProgress(searchId, pageStart, cseResults.length, {
    cseCallsMade: 1,
    newProfileCount: newPeople,
  });

  return {
    serperUrls: cseResults.length,
    prefiltered: prefilteredCount,
    scraped: urlsToScrape.length,
    newPeople,
  };
}

/**
 * Scrape up to maxPages for a single company.
 * Checks scrape progress to pick up where previous searches left off.
 * Stops early if exhausted.
 */
async function scrapeForCompany(
  company: string,
  filters: ParsedFilters,
  maxPages: number = BACKGROUND_SCRAPE_PAGES,
): Promise<{ pagesScraped: number; skippedExhausted: boolean; serperUrls: number; prefiltered: number; scraped: number; newPeople: number }> {
  const query = buildSerperQuery({
    company,
    role: filters.role,
    university: filters.university,
    location: filters.location,
  });
  const queryHash = computeQueryHash(query);

  const normalizedParams: NormalizedSearchParams = {
    name: null,
    company: company.trim().toLowerCase() || null,
    role: filters.role?.trim().toLowerCase() || null,
    university: filters.university?.trim().toLowerCase() || null,
    location: filters.location?.trim().toLowerCase() || null,
  };
  const progress = await findOrCreateScrapeProgressWithHash(normalizedParams, queryHash);

  // Check if there's anything to scrape
  const firstPage = getNextCsePageStart(progress.lastCsePageScraped, progress.cseExhausted);
  if (firstPage === null) {
    return { pagesScraped: 0, skippedExhausted: true, serperUrls: 0, prefiltered: 0, scraped: 0, newPeople: 0 };
  }

  const totals = { pagesScraped: 0, skippedExhausted: false, serperUrls: 0, prefiltered: 0, scraped: 0, newPeople: 0 };
  let currentPage = firstPage;

  for (let i = 0; i < BACKGROUND_SCRAPE_PAGES; i++) {
    console.log(`[Scrape] "${company}" page ${currentPage} (${i + 1}/${BACKGROUND_SCRAPE_PAGES})`);
    const pageStats = await scrapeOnePage(company, filters, progress.id, currentPage);

    totals.pagesScraped++;
    totals.serperUrls += pageStats.serperUrls;
    totals.prefiltered += pageStats.prefiltered;
    totals.scraped += pageStats.scraped;
    totals.newPeople += pageStats.newPeople;

    // Re-read progress to check exhaustion (updateScrapeProgress may have set it)
    const updated = await findOrCreateScrapeProgressWithHash(normalizedParams, queryHash);
    const nextPage = getNextCsePageStart(updated.lastCsePageScraped, updated.cseExhausted);
    if (nextPage === null) {
      if (updated.cseExhausted) totals.skippedExhausted = true;
      break;
    }
    currentPage = nextPage;
  }

  return totals;
}

/**
 * Scrape for a query, matching production prescrape behavior:
 * - Single company: always scrape 2 pages
 * - Multi-company with 10+ results: skip (DB already has enough)
 * - Multi-company with <10 results: 1 page per company, max 5 companies
 */
async function scrapeForQuery(
  filters: ParsedFilters,
  currentResultCount: number,
): Promise<ScrapeStats> {
  const stats: ScrapeStats = {
    triggered: true,
    skippedExhausted: false,
    pagesScraped: 0,
    serperUrls: 0,
    prefiltered: 0,
    scraped: 0,
    newPeople: 0,
    postScrapeCount: 0,
  };

  const isMultiCompany = filters.companies && filters.companies.length > 0;

  // Multi-company with 10+ results: DB is well-populated, skip scraping
  if (isMultiCompany && currentResultCount >= 10) {
    stats.triggered = false;
    return stats;
  }

  const companies = isMultiCompany
    ? filters.companies!.slice(0, 5)
    : filters.company ? [filters.company] : [];
  const pagesPerCompany = isMultiCompany ? 1 : BACKGROUND_SCRAPE_PAGES;

  let allExhausted = true;
  for (const company of companies) {
    const companyStats = await scrapeForCompany(company, filters, pagesPerCompany);
    stats.pagesScraped += companyStats.pagesScraped;
    stats.serperUrls += companyStats.serperUrls;
    stats.prefiltered += companyStats.prefiltered;
    stats.scraped += companyStats.scraped;
    stats.newPeople += companyStats.newPeople;
    if (!companyStats.skippedExhausted) allExhausted = false;
  }
  stats.skippedExhausted = allExhausted && stats.pagesScraped === 0;

  return stats;
}

// ── Main pipeline runner ──

async function runQuery(query: string, index: number): Promise<QueryResult> {
  const start = Date.now();
  const result: QueryResult = {
    index,
    query,
    filters: {},
    aliasCount: 0,
    allAliases: [],
    dbPath: 'UNKNOWN',
    resultCount: 0,
    initialResultCount: 0,
    topRoles: [],
    roleCounts: {},
    status: 'OK',
    statusNote: '',
    durationMs: 0,
  };

  try {
    // ── Step A: LLM filter extraction ──
    const llmResponse = await completeJson<LLMResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(query),
      options: {
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        maxTokens: 512,
      },
    });

    const { filters } = llmResponse.content;
    const parsedFilters: ParsedFilters = {};
    if (filters.company) parsedFilters.company = filters.company;
    if (filters.companies && Array.isArray(filters.companies) && filters.companies.length > 0) {
      parsedFilters.companies = filters.companies.slice(0, 5);
      delete parsedFilters.company;
    }
    if (filters.role) parsedFilters.role = filters.role;
    if (filters.university) parsedFilters.university = filters.university;
    if (filters.location) parsedFilters.location = filters.location;
    result.filters = parsedFilters;

    // Check: did we get at least a company or companies?
    if (!parsedFilters.company && (!parsedFilters.companies || parsedFilters.companies.length === 0)) {
      result.status = 'ERROR';
      result.statusNote = 'LLM failed to extract any company';
      result.durationMs = Date.now() - start;
      return result;
    }

    // ── Step B: Company alias resolution ──
    let companyAliases: string[] = [];
    if (parsedFilters.companies && parsedFilters.companies.length > 0) {
      const multiResult = await resolveMultiCompanyAliases(parsedFilters.companies);
      companyAliases = multiResult.allAliases;
    } else if (parsedFilters.company) {
      const singleResult = await resolveCompanyAliases(parsedFilters.company);
      companyAliases = singleResult.aliases;
    }
    result.aliasCount = companyAliases.length;
    result.allAliases = companyAliases;

    // ── Step C: Detect which DB path will be used ──
    if (parsedFilters.role && parsedFilters.role.trim() && isVectorRoleMatchingEnabled()) {
      const embedding = await getSearchRoleEmbedding(parsedFilters.role);
      result.dbPath = embedding ? 'VECTOR' : 'ILIKE';
    } else {
      result.dbPath = 'ILIKE';
    }

    // ── Step D: DB query ──
    // For multi-company, run against each company separately (matching production behavior)
    let allResults: PersonResult[] = [];

    if (parsedFilters.companies && parsedFilters.companies.length > 0) {
      // Multi-company: run per-company queries, dedup by person ID
      const seenIds = new Set<string>();
      for (const company of parsedFilters.companies) {
        const singleAliases = (await resolveCompanyAliases(company)).aliases;
        const companyResults = await findPeopleByFilters({
          company,
          companyAliases: singleAliases,
          role: parsedFilters.role,
          university: parsedFilters.university,
          location: parsedFilters.location,
          requireEmail: false,
          limit: 10,
        });
        for (const r of companyResults) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            allResults.push(r);
          }
        }
      }
    } else {
      allResults = await findPeopleByFilters({
        company: parsedFilters.company || '',
        companyAliases,
        role: parsedFilters.role,
        university: parsedFilters.university,
        location: parsedFilters.location,
        requireEmail: false,
        limit: 10,
      });
    }

    const initialResultCount = allResults.length;
    result.resultCount = initialResultCount;
    result.initialResultCount = initialResultCount;

    // ── Step E: Background scrape if unscraped pages exist ──
    // Single company: always 2 pages. Multi-company: skip if 10+ results, else 1 page/company.
    const scrapeStats = await scrapeForQuery(parsedFilters, initialResultCount);

    if (scrapeStats.pagesScraped > 0) {
      result.scrapeStats = scrapeStats;
      console.log(`[Scrape] Q${index}: scraped ${scrapeStats.pagesScraped} pages, ${scrapeStats.newPeople} new people`);

      // Re-query DB to pick up newly scraped people
      let postScrapeResults: PersonResult[] = [];

      if (parsedFilters.companies && parsedFilters.companies.length > 0) {
        const seenIds = new Set<string>();
        for (const company of parsedFilters.companies) {
          const singleAliases = (await resolveCompanyAliases(company)).aliases;
          const companyResults = await findPeopleByFilters({
            company,
            companyAliases: singleAliases,
            role: parsedFilters.role,
            university: parsedFilters.university,
            location: parsedFilters.location,
            requireEmail: false,
            limit: 10,
          });
          for (const r of companyResults) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id);
              postScrapeResults.push(r);
            }
          }
        }
      } else {
        postScrapeResults = await findPeopleByFilters({
          company: parsedFilters.company || '',
          companyAliases,
          role: parsedFilters.role,
          university: parsedFilters.university,
          location: parsedFilters.location,
          requireEmail: false,
          limit: 10,
        });
      }

      scrapeStats.postScrapeCount = postScrapeResults.length;
      allResults = postScrapeResults;
      result.resultCount = postScrapeResults.length;
    } else if (scrapeStats.skippedExhausted || !scrapeStats.triggered) {
      // Exhausted or multi-company with enough results — note it but don't re-query
      result.scrapeStats = scrapeStats;
    }

    result.roleCounts = countRoles(allResults);
    result.topRoles = Object.entries(result.roleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([role]) => role);

    // Distance range for vector results
    if (result.dbPath === 'VECTOR' && allResults.length > 0) {
      const distances = allResults
        .map(r => r.roleDistance)
        .filter((d): d is number => d !== undefined);
      if (distances.length > 0) {
        result.distanceRange = `${Math.min(...distances).toFixed(4)} → ${Math.max(...distances).toFixed(4)}`;
      }
    }

    // ── Step G: Assess status ──
    const assessment = assessStatus(allResults, parsedFilters, result.dbPath);
    result.status = assessment.status;
    result.statusNote = assessment.note;
  } catch (err) {
    result.status = 'ERROR';
    result.error = err instanceof Error ? err.message : String(err);
    result.statusNote = `Exception: ${result.error}`;
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ── Output formatting ──

function printQueryResult(r: QueryResult) {
  const statusIcon =
    r.status === 'OK' ? '✓' :
    r.status === 'LOW_RESULTS' ? '⚠' :
    r.status === 'ZERO_RESULTS' ? '✗' :
    '✗';

  console.log(`\n━━━ Query ${r.index}/${TEST_QUERIES.length}: "${r.query}" ━━━`);

  // Filters
  const f = r.filters;
  const companyStr = f.companies
    ? `companies=[${f.companies.join(', ')}]`
    : `company=${f.company || '-'}`;
  console.log(
    `[Filters] ${companyStr} | role=${f.role || '-'} | university=${f.university || '-'} | location=${f.location || '-'}`
  );

  // Aliases
  if (f.companies && f.companies.length > 0) {
    console.log(`[Aliases] ${f.companies.length} companies → ${r.aliasCount} total aliases`);
  } else if (f.company) {
    console.log(`[Aliases] ${f.company} → ${r.aliasCount} aliases (${r.allAliases.slice(0, 5).join(', ')}${r.aliasCount > 5 ? '...' : ''})`);
  }

  // DB Path
  if (r.dbPath === 'VECTOR') {
    console.log(`[DB Path] VECTOR (role="${f.role}")`);
  } else if (r.dbPath === 'ILIKE') {
    const terms = f.role ? getRoleSearchTerms(f.role) : [];
    const termStr = terms.length > 0 ? ` | terms=${JSON.stringify(terms)}` : '';
    const reason = f.role && isVectorRoleMatchingEnabled() ? ' (embedding failed)' : '';
    console.log(`[DB Path] ILIKE${reason}${termStr}`);
  }

  // Results
  if (r.distanceRange) {
    console.log(`[Results] ${r.resultCount} found (limit=10) | distance: ${r.distanceRange}`);
  } else {
    console.log(`[Results] ${r.resultCount} found (limit=10)`);
  }

  // Scrape stats
  if (r.scrapeStats) {
    const s = r.scrapeStats;
    if (!s.triggered) {
      console.log(`[Scrape]    Skipped — multi-company with ${r.initialResultCount}+ results`);
    } else if (s.skippedExhausted && s.pagesScraped === 0) {
      console.log(`[Scrape]    Skipped — all companies exhausted`);
    } else if (s.pagesScraped > 0) {
      console.log(
        `[Scrape]    ${s.pagesScraped} page(s) scraped | ` +
        `Serper: ${s.serperUrls} URLs → Filter: ${s.serperUrls - s.prefiltered} passed → Scraped: ${s.scraped} → ${s.newPeople} new saved`
      );
      console.log(`[Re-query]  ${s.postScrapeCount} found after scraping (was ${r.initialResultCount})`);
    }
  }

  // Top roles
  if (Object.keys(r.roleCounts).length > 0) {
    console.log(`[Top 5]  ${topRolesSummary(r.roleCounts)}`);
  }

  // Status
  if (r.statusNote) {
    console.log(`[Status] ${statusIcon} ${r.status} — ${r.statusNote}`);
  } else {
    console.log(`[Status] ${statusIcon} ${r.status}`);
  }

  console.log(`[Time]   ${r.durationMs}ms`);
}

function printGapAnalysis(results: QueryResult[]) {
  const ok = results.filter(r => r.status === 'OK').length;
  const low = results.filter(r => r.status === 'LOW_RESULTS').length;
  const zero = results.filter(r => r.status === 'ZERO_RESULTS').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log('\n\n═══ GAP ANALYSIS ═══');
  console.log(
    `Total: ${results.length} queries | ✓ ${ok} OK | ⚠ ${low} Low Results | ✗ ${zero} Zero Results | ✗ ${errors} Errors`
  );

  // Environment info
  console.log(`\nEnvironment:`);
  console.log(`  Vector matching enabled: ${isVectorRoleMatchingEnabled()}`);
  console.log(`  OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`  USE_VECTOR_ROLE_MATCHING: ${process.env.USE_VECTOR_ROLE_MATCHING ?? '(not set)'}`);

  // Path distribution
  const vectorCount = results.filter(r => r.dbPath === 'VECTOR').length;
  const ilikeCount = results.filter(r => r.dbPath === 'ILIKE').length;
  console.log(`  DB paths used: VECTOR=${vectorCount}, ILIKE=${ilikeCount}`);

  // Scrape summary
  const withScrape = results.filter(r => r.scrapeStats && r.scrapeStats.pagesScraped > 0);
  const exhausted = results.filter(r => r.scrapeStats?.skippedExhausted && r.scrapeStats.pagesScraped === 0);
  const skippedMulti = results.filter(r => r.scrapeStats && !r.scrapeStats.triggered);
  const noScrapeNeeded = results.length - withScrape.length - exhausted.length - skippedMulti.length;
  const totalPages = withScrape.reduce((s, r) => s + (r.scrapeStats?.pagesScraped ?? 0), 0);
  const totalSerper = withScrape.reduce((s, r) => s + (r.scrapeStats?.serperUrls ?? 0), 0);
  const totalApify = withScrape.reduce((s, r) => s + (r.scrapeStats?.scraped ?? 0), 0);
  const totalNew = withScrape.reduce((s, r) => s + (r.scrapeStats?.newPeople ?? 0), 0);

  console.log(`\nScraping (single=2pg, multi=1pg/co if <10 results):`);
  console.log(`  Scraped: ${withScrape.length} | Exhausted: ${exhausted.length} | Multi 10+ skipped: ${skippedMulti.length} | No scrape record: ${noScrapeNeeded}`);
  console.log(`  Total pages: ${totalPages} | Serper URLs: ${totalSerper} | Apify profiles: ${totalApify} | New people: ${totalNew}`);
  if (withScrape.length > 0) {
    const gained = withScrape.filter(r => r.resultCount > r.initialResultCount);
    if (gained.length > 0) {
      console.log(`  Gained results: ${gained.map(r => `Q${r.index} (${r.initialResultCount}→${r.resultCount})`).join(', ')}`);
    }
  }

  // Issues
  const issues = results.filter(r => r.status !== 'OK');
  if (issues.length > 0) {
    console.log('\nIssues found:');
    for (const r of issues) {
      console.log(`  Q${r.index}: "${r.query}" → ${r.statusNote}`);
    }
  } else {
    console.log('\nNo issues found — all queries returned reasonable results.');
  }

  // Timing
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
  const avgMs = Math.round(totalMs / results.length);
  console.log(`\nTiming: total=${(totalMs / 1000).toFixed(1)}s | avg=${avgMs}ms per query`);
}

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║    AI Search Pipeline Integration Test                  ║');
  console.log('║    20 queries × (LLM + Aliases + DB + 2pg scrape)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nVector matching enabled: ${isVectorRoleMatchingEnabled()}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const results: QueryResult[] = [];

  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const r = await runQuery(TEST_QUERIES[i], i + 1);
    results.push(r);
    printQueryResult(r);
  }

  printGapAnalysis(results);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\nFatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
