'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { lookupByName } from '@/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { checkEmailCredits } from '@/lib/services/credits';
import {
  getExcludedPersonIds,
  findPeopleByFiltersV3,
  findPeopleByLinkedInUrls,
  findPeopleByName,
  saveScrapedProfile,
  PersonFiltersV2,
  PersonResult,
  MatchTier,
  isVectorRoleMatchingEnabled,
  saveShortProfilesBatch,
  tagPeopleToSearch,
  getTaggedPeopleForSearch,
  getMaxSearchPersonPosition,
  clearSearchPersonTags,
  getSearchPersonCount,
  SEARCH_TAG_TTL_DAYS,
} from '@/lib/db/person-service';
import {
  getCompanyPattern,
  generateEmailFromPattern,
} from '@/lib/services/email-pattern';
import { resolveCompanyAliases } from '@/lib/services/company-alias';
import { resolveCompanyUrl } from '@/lib/services/company-resolver';
import { generateEmailWithLLM, getUserResumeSummary, getRecentSentEmails, refineEmailWithLLM } from '@/lib/services/personalization';
import { searchLinkedInShort } from '@/lib/services/linkedin-search';
import { computeNextApifyPage, hasMoreApifyPages } from '@/lib/services/apify-pagination';
import { createHash } from 'crypto';
import { isUserBlocked } from '@/lib/services/credits';
import {
  log,
  createLoggerForQuery,
  withLogger,
  APIFY_SHORT_COST_PER_PAGE,
} from '@/lib/services/discovery-logger';


export interface RecentSearch {
  company: string | null;
  role: string | null;
  university: string | null;
  location: string | null;
  searchedAt: Date;
  resultsCount: number;
}

export interface SearchResultWithDraft {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  linkedinUrl: string | null;
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  emailConfidence: number | null;
  emailDeliverable: boolean | null;
  emailVerifiedAt: Date | null;
  emailVerificationReason: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  educationDegree: string | null;
  educationField: string | null;
  educationYear: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  sourceDomain: string | null;
  draftSubject: string;
  draftBody: string;
  userCandidateId: string | null;
  resumeId: string | null;
  scrapeDepth: string;
  savedForLater: boolean;
  matchTier?: 'exact' | 'near_exact' | 'similar';
  matchScore?: number;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  llmDraftGenerated?: boolean;
}

export interface HiddenPerson {
  userCandidateId: string;
  personId: string;
  fullName: string;
  company: string;
  role: string | null;
}

// Helper type for ranking
interface PersonWithSource {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  linkedinUrl: string | null;
  email: string | null;
  emailStatus: string | null;
  emailConfidence: number | null;
  emailDeliverable: boolean | null;
  emailVerifiedAt: Date | null;
  emailVerificationReason: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  educationDegree: string | null;
  educationField: string | null;
  educationYear: string | null;
  scrapeDepth?: string;
  matchTier?: MatchTier;
  matchScore?: number;
  sourceLinks: Array<{
    url: string;
    title: string;
    snippet: string | null;
    domain: string | null;
  }>;
}

/** Resolved template shape used by generateEmailDraft */
interface ResolvedTemplate {
  id: string;
  subject: string;
  body: string;
  attachResume: boolean;
  resumeId: string | null;
}

/**
 * Resolve which email template to use for a user.
 * Priority: explicit templateId → user's default DB template → hardcoded fallback.
 */
async function resolveTemplateForUser(
  userId: string,
  templateId?: string
): Promise<ResolvedTemplate> {
  // 1. If templateId matches a hardcoded template, use it
  if (templateId) {
    const hardcoded = EMAIL_TEMPLATES.find((t) => t.id === templateId);
    if (hardcoded) {
      return { id: hardcoded.id, subject: hardcoded.subject, body: hardcoded.body, attachResume: false, resumeId: null };
    }

    // 2. If templateId provided, try DB lookup
    const dbTemplate = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, prompt: true, attachResume: true, resumeId: true },
    });
    if (dbTemplate) {
      let resolvedResumeId = dbTemplate.resumeId;
      if (dbTemplate.attachResume && !resolvedResumeId) {
        const activeResume = await prisma.userResume.findFirst({
          where: { userId, isActive: true },
          select: { id: true },
        });
        if (activeResume) {
          resolvedResumeId = activeResume.id;
          console.log(`[Template] resumeId was null, falling back to active resume: ${activeResume.id}`);
        }
      }
      return { id: dbTemplate.id, ...parseTemplatePrompt(dbTemplate.prompt), attachResume: dbTemplate.attachResume, resumeId: resolvedResumeId };
    }
  }

  // 3. No templateId or not found — fetch user's default template
  const defaultTemplate = await prisma.emailTemplate.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, prompt: true, attachResume: true, resumeId: true },
  });
  if (defaultTemplate) {
    let resolvedResumeId = defaultTemplate.resumeId;

    // Fallback: if attachResume is true but resumeId is missing, use the user's active resume
    if (defaultTemplate.attachResume && !resolvedResumeId) {
      const activeResume = await prisma.userResume.findFirst({
        where: { userId, isActive: true },
        select: { id: true },
      });
      if (activeResume) {
        resolvedResumeId = activeResume.id;
        console.log(`[Template] resumeId was null, falling back to active resume: ${activeResume.id}`);
      }
    }

    console.log(`[Template] Using default template: id=${defaultTemplate.id}, attachResume=${defaultTemplate.attachResume}, resumeId=${resolvedResumeId || '(none)'}`);
    return { id: defaultTemplate.id, ...parseTemplatePrompt(defaultTemplate.prompt), attachResume: defaultTemplate.attachResume, resumeId: resolvedResumeId };
  }

  // 4. Final fallback — hardcoded default
  console.log('[Template] No default template found, using hardcoded fallback (no resume)');
  const fallback = EMAIL_TEMPLATES[0];
  return { id: fallback.id, subject: fallback.subject, body: fallback.body, attachResume: false, resumeId: null };
}

/** Parse the EmailTemplate.prompt field (JSON with subject/body, or plain text as body) */
function parseTemplatePrompt(prompt: string): { subject: string; body: string } {
  try {
    const parsed = JSON.parse(prompt);
    return { subject: parsed.subject || '', body: parsed.body || prompt };
  } catch {
    return { subject: '', body: prompt };
  }
}

/**
 * Generate email draft using template replacement
 */
function generateEmailDraft(
  template: { subject: string; body: string },
  person: { firstName: string | null; company: string; role: string | null },
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null } | null
): { subject: string; body: string } {
  // Replace placeholders
  let subject: string = template.subject;
  let body: string = template.body;

  const replacements: Record<string, string> = {
    '{first_name}': person.firstName || 'there',
    '{company}': person.company,
    '{role}': person.role || 'your role',
    '{user_name}': user?.name || 'A student',
    '{university}': user?.university || 'my university',
    '{classification}': user?.classification || 'student',
    '{major}': user?.major || 'my major',
    '{career}': user?.career || 'your industry',
    '{industry}': user?.career || 'your industry',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replaceAll(placeholder, value);
    body = body.replaceAll(placeholder, value);
  }

  return { subject, body };
}


/**
 * Shared helper: build SearchResultWithDraft[] from ranked candidates.
 * Upserts UserCandidate, generates email drafts, and maps to result objects.
 */
async function buildResultsWithDrafts(
  rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>,
  userId: string | null,
  template: ResolvedTemplate,
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null } | null
): Promise<SearchResultWithDraft[]> {
  // Batch upsert UserCandidates in 2 queries instead of 25 individual upserts.
  // With connection_limit=1, sequential upserts take ~10s; this takes ~800ms.
  const userCandidateMap = new Map<string, { id: string; savedForLater: boolean }>();
  if (userId && rankedPeople.length > 0) {
    const personIds = rankedPeople.map(({ candidate }) => candidate.id);

    // 1. Bulk insert new UserCandidates (skip existing via ON CONFLICT DO NOTHING)
    const values = rankedPeople.map(({ candidate: person }) => {
      const email = person.email || null;
      const status = person.emailStatus || 'MISSING';
      const confidence = person.emailConfidence ?? null;
      return `(gen_random_uuid(), '${userId}', '${person.id}', ${email ? `'${email.replace(/'/g, "''")}'` : 'NULL'}, '${status}'::"EmailStatus", ${confidence !== null ? confidence : 'NULL'}, NOW(), NOW())`;
    }).join(',\n');

    await prisma.$executeRawUnsafe(`
      INSERT INTO "UserCandidate" ("id", "userId", "personId", "email", "emailStatus", "emailConfidence", "createdAt", "updatedAt")
      VALUES ${values}
      ON CONFLICT ("userId", "personId") DO NOTHING
    `);

    // 2. Fetch all UserCandidates for these person IDs in one query
    const existing = await prisma.userCandidate.findMany({
      where: { userId, personId: { in: personIds } },
      select: { id: true, personId: true, savedForLater: true },
    });
    for (const uc of existing) {
      userCandidateMap.set(uc.personId, { id: uc.id, savedForLater: uc.savedForLater });
    }
  }

  return rankedPeople.map(({ candidate: person, score, breakdown }) => {
      let userCandidateId: string | null = null;
      let draftSubject = '';
      let draftBody = '';

      let savedForLater = false;
      if (userId) {
        const uc = userCandidateMap.get(person.id);
        savedForLater = uc?.savedForLater ?? false;
        userCandidateId = uc?.id ?? null;

        const draft = generateEmailDraft(
          template,
          { firstName: person.firstName, company: person.company, role: person.role },
          user
        );

        draftSubject = draft.subject;
        draftBody = draft.body;
      } else {
        const draft = generateEmailDraft(
          template,
          { firstName: person.firstName, company: person.company, role: person.role },
          null
        );
        draftSubject = draft.subject;
        draftBody = draft.body;
      }

      const sourceLink = person.sourceLinks[0];

      return {
        id: person.id,
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        role: person.role,
        linkedinUrl: person.linkedinUrl,
        email: person.email,
        emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
        emailConfidence: person.emailConfidence,
        emailDeliverable: person.emailDeliverable,
        emailVerifiedAt: person.emailVerifiedAt,
        emailVerificationReason: person.emailVerificationReason,
        city: person.city,
        state: person.state,
        country: person.country,
        educationSchool: person.educationSchool,
        educationDegree: person.educationDegree,
        educationField: person.educationField,
        educationYear: person.educationYear,
        sourceUrl: sourceLink?.url || null,
        sourceTitle: sourceLink?.title || null,
        sourceSnippet: sourceLink?.snippet || null,
        sourceDomain: sourceLink?.domain || null,
        scrapeDepth: person.scrapeDepth || 'full',
        draftSubject,
        draftBody,
        userCandidateId,
        resumeId: template.attachResume ? template.resumeId : null,
        savedForLater,
        matchTier: person.matchTier,
        matchScore: person.matchScore,
        score,
        scoreBreakdown: breakdown,
      };
    });
}


// ═══════════════════════════════════════════════════════════════════════════════
// V2 Search: Natural Language → Haiku Parse → DB-First → Short Mode Fallback
// ═══════════════════════════════════════════════════════════════════════════════

export interface SearchInputV2 {
  query: string;          // Natural language query (e.g., "senior PMs at Ramp in NYC")
  linkedInFilters: import('@/lib/types/linkedin-filters').LinkedInFilters;
  dbFilters: import('@/lib/types/linkedin-filters').DBFilters;
  limit: number;          // Max results to return
  templateId?: string;
  excludePersonIds?: string[];
}

export interface SearchMetaV2 {
  hasMore: boolean;
  isAdvancedQuery: boolean;       // Client uses this to decide pagination mode
  haikuCalls: number;
  serperCalls: number;
  shortModePages: number;
  totalCostCents: number;
  dbResultCount: number;      // How many came from DB before API
  apiResultCount: number;     // How many came from Short mode API
  totalMatchesOnLinkedIn: number; // totalElements from LinkedIn pagination
  linkedInPage?: number;          // Current page fetched (for next-page requests)
  totalLinkedInPages?: number;    // Total pages available on LinkedIn
  fromCache?: boolean;            // True when results served from SearchPerson tag cache
}

export type SearchActionV2Result = {
  success: true;
  results: SearchResultWithDraft[];
  searchMeta: SearchMetaV2;
  remainingDaily: number;
  hiddenCount: number;
} | {
  success: false;
  error: string;
};

const DB_FIRST_THRESHOLD = 6; // If DB returns this many or more, skip API

/**
 * V2 Search Action — Natural language search with pre-parsed filters.
 *
 * Two paths:
 * - Simple query (no advanced LinkedIn filters): DB-first, LinkedIn Short if < 6 results
 * - Advanced query (seniority, industry, headcount, etc.): Skip DB, call LinkedIn Short directly,
 *   return all profiles in LinkedIn's order for client-side pagination
 */
export async function searchPeopleV2Action(
  input: SearchInputV2
): Promise<SearchActionV2Result> {
  const searchStart = Date.now();
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id || null;

  if (!input.query?.trim()) {
    return { success: false, error: 'Search query is required' };
  }

  // Check if user is blocked (hit free limit and not subscribed)
  if (userId) {
    const blocked = await isUserBlocked(userId);
    if (blocked) {
      return { success: false, error: 'SUBSCRIPTION_BLOCKED' };
    }
  }

  const logger = createLoggerForQuery(`search:${input.query}`);
  const run = async (): Promise<SearchActionV2Result> => {
    log.info('search-v2', 'Received search request', {
      query: input.query,
      dbFilters: input.dbFilters,
      linkedInFilterKeys: Object.keys(input.linkedInFilters),
      limit: input.limit,
      excludeCount: input.excludePersonIds?.length || 0,
    });
  try {
    // ===== AUTH & USER SETUP =====
    let user = null;
    let remainingDaily = 0;
    let hiddenCount = 0;
    let excludedIds: string[] = [];

    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          university: true,
          classification: true,
          major: true,
          career: true,
          dailySendCount: true,
          lastSendDate: true,
        },
      });

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const today = new Date().toDateString();
      const lastSendDay = user.lastSendDate?.toDateString();
      const dailyLimit = 30;
      remainingDaily =
        lastSendDay === today ? Math.max(0, dailyLimit - user.dailySendCount) : dailyLimit;

      hiddenCount = await prisma.userCandidate.count({
        where: { userId, doNotShow: true },
      });

      excludedIds = await getExcludedPersonIds(userId);
    }

    const allExcludedIds = input.excludePersonIds
      ? [...excludedIds, ...input.excludePersonIds]
      : excludedIds;

    // ===== STEP 1: Use pre-parsed filters =====
    const dbFilters = input.dbFilters;
    const linkedInFilters = { ...input.linkedInFilters };
    const parseCost = { haikuCalls: 0, serperCalls: 0, costCents: 0 };
    console.log(`[SearchV2] ── New search ──────────────────────────────────`);
    console.log(`[SearchV2] Filters — db=${JSON.stringify(dbFilters)}, linkedin=${JSON.stringify(linkedInFilters)}`);

    // Resolve LinkedIn company URL if not already provided. Required for
    // accurate Apify filtering — without it, the scraper falls back to
    // text-matching the company name in profile bios.
    if (dbFilters.company && (!linkedInFilters.currentCompanies || linkedInFilters.currentCompanies.length === 0)) {
      try {
        const resolved = await resolveCompanyUrl(dbFilters.company, dbFilters.role || undefined);
        if (resolved.url) {
          linkedInFilters.currentCompanies = [resolved.url];
          log.info('search-v2', 'Company URL resolved', {
            company: dbFilters.company,
            url: resolved.url,
          });
        } else {
          linkedInFilters.currentCompanies = [dbFilters.company];
          log.warn('search-v2', 'Company URL not found, using name', {
            company: dbFilters.company,
          });
        }
      } catch (err) {
        log.error('search-v2', 'Company URL resolution threw', {
          company: dbFilters.company,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ===== STEP 2: Determine if advanced query =====
    const hasAdvancedFilters = !!(
      linkedInFilters.seniorityLevelIds?.length ||
      linkedInFilters.companyHeadcount?.length ||
      linkedInFilters.functionIds?.length ||
      linkedInFilters.yearsOfExperienceIds?.length ||
      linkedInFilters.pastCompanies?.length ||
      linkedInFilters.pastJobTitles?.length ||
      linkedInFilters.recentlyChangedJobs
    );

    console.log(`[SearchV2] Query: "${input.query}" | advanced=${hasAdvancedFilters} | limit=${input.limit} | excluded=${allExcludedIds.length}`);

    // Look up existing scrape cursor for this search (keyed off the
    // composite unique index). Used to resume Load More from wherever the
    // last fetch left off, rather than always starting at Apify page 1.
    // Also returns id/updatedAt/queryHash for the SearchPerson cache check.
    const existingRow = await prisma.$queryRaw<
      Array<{ id: string; lastCsePageScraped: number; totalLinkedInMatches: number | null; updatedAt: Date; queryHash: string | null }>
    >`
      SELECT "id", "lastCsePageScraped", "totalLinkedInMatches", "updatedAt", "queryHash"
      FROM "Search"
      WHERE COALESCE(company, '') = ${dbFilters.company || ''}
        AND COALESCE(role, '') = ${dbFilters.role || ''}
        AND COALESCE(university, '') = ${dbFilters.university || ''}
        AND COALESCE(location, '') = ${dbFilters.location || ''}
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `;
    const existingCursor = existingRow[0]?.lastCsePageScraped ?? 0;
    const existingTotalMatches = existingRow[0]?.totalLinkedInMatches ?? null;

    let shortModePages = 0;
    let apiResultCount = 0;
    let totalMatchesOnLinkedIn = 0;
    let totalLinkedInPages = 0;
    let linkedInPage = 0;
    let dbResultCount = 0;
    let results: SearchResultWithDraft[];
    // Cursor to write back to Search row. Initialized to existing; only
    // advanced if we actually fetch an Apify page in this request.
    let newCursor = existingCursor;

    // Compute queryHash early so we can use it for the cache check
    const queryHash = createHash('sha256')
      .update(JSON.stringify(linkedInFilters))
      .digest('hex');

    if (hasAdvancedFilters) {
      // ===== ADVANCED PATH: Skip DB, call LinkedIn Short directly =====
      console.log(`[SearchV2] PATH: Advanced (LinkedIn-first) — skipping DB`);
      log.decision('search-v2', 'Advanced path taken', {
        hasAdvancedFilters: true,
        advancedFilterKeys: Object.entries(linkedInFilters)
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

      // ── Cache-hit check: serve tagged people if available + fresh ──
      // Only for advanced queries — simple queries always use DB-first flow.
      if (existingRow[0]) {
        const searchRowForCache = existingRow[0];
        const ageMs = Date.now() - new Date(searchRowForCache.updatedAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const hashMatches = searchRowForCache.queryHash === queryHash;

        if (!hashMatches && searchRowForCache.queryHash) {
          // Same basic filters but different advanced filters — clear old tags
          console.log(`[SearchV2] queryHash mismatch — clearing old SearchPerson tags`);
          log.info('search-v2', 'Cache hash mismatch — clearing tags', {
            oldHash: searchRowForCache.queryHash?.slice(0, 8),
            newHash: queryHash.slice(0, 8),
          });
          await clearSearchPersonTags(searchRowForCache.id);
        } else if (hashMatches && ageDays <= SEARCH_TAG_TTL_DAYS) {
          const tagCount = await getSearchPersonCount(searchRowForCache.id);
          if (tagCount >= 5) {
            console.log(`[SearchV2] CACHE HIT: ${tagCount} tagged people, age=${ageDays.toFixed(1)}d`);
            log.decision('search-v2', 'Serving from SearchPerson cache', {
              searchId: searchRowForCache.id,
              tagCount,
              ageDays: Math.round(ageDays),
            });

            const cachedPeople = await getTaggedPeopleForSearch(
              searchRowForCache.id,
              allExcludedIds,
              input.limit
            );

            let template: ResolvedTemplate;
            if (userId) {
              template = await resolveTemplateForUser(userId, input.templateId);
            } else {
              const defaultTemplate = EMAIL_TEMPLATES[0];
              template = { id: defaultTemplate.id, subject: defaultTemplate.subject, body: defaultTemplate.body, attachResume: false, resumeId: null };
            }

            const orderedPeople = cachedPeople.map(person => ({
              candidate: { ...person, emailDeliverable: person.emailDeliverable ?? null, emailVerifiedAt: person.emailVerifiedAt ?? null, emailVerificationReason: person.emailVerificationReason ?? null } as PersonWithSource,
              score: 0,
              breakdown: {} as ScoreBreakdown,
            }));

            results = await buildResultsWithDrafts(orderedPeople, userId, template, user);

            const elapsed = Date.now() - searchStart;
            console.log(`[SearchV2] CACHE: Done in ${elapsed}ms — ${results.length} results from cache`);
            log.info('search-v2', 'Returning cached results', {
              resultCount: results.length,
              elapsedMs: elapsed,
            });

            return {
              success: true,
              results,
              searchMeta: {
                hasMore: tagCount > cachedPeople.length + allExcludedIds.length,
                isAdvancedQuery: true,
                haikuCalls: 0,
                serperCalls: 0,
                shortModePages: 0,
                totalCostCents: 0,
                dbResultCount: results.length,
                apiResultCount: 0,
                totalMatchesOnLinkedIn: searchRowForCache.totalLinkedInMatches ?? 0,
                fromCache: true,
              },
              remainingDaily,
              hiddenCount,
            };
          }
        }
      }

      const apiStart = Date.now();

      // Initial search always starts fresh at page 1 so the user sees the
      // top LinkedIn relevance order. Load More picks up from `newCursor`
      // afterward via loadMoreV2Action.
      const apiResult = await searchLinkedInShort({
        ...linkedInFilters,
        startPage: 1,
        takePages: 1,
      });
      shortModePages = 1;
      linkedInPage = 1;
      newCursor = 1;
      totalMatchesOnLinkedIn = apiResult.pagination.totalElements;
      totalLinkedInPages = apiResult.pagination.totalPages;
      apiResultCount = apiResult.profiles.length;

      console.log(`[SearchV2] LinkedIn API returned ${apiResultCount} profiles (${totalMatchesOnLinkedIn.toLocaleString()} total on LinkedIn, ${totalLinkedInPages} pages) in ${Date.now() - apiStart}ms`);
      log.info('search-v2', 'LinkedIn Short returned (advanced)', {
        profileCount: apiResultCount,
        totalMatchesOnLinkedIn,
        totalLinkedInPages,
        durationMs: Date.now() - apiStart,
        costUsd: APIFY_SHORT_COST_PER_PAGE,
      });

      // Save profiles to DB + build results in LinkedIn's order
      const schoolTag = linkedInFilters.schools?.[0] || null;
      let template: ResolvedTemplate;
      if (userId) {
        template = await resolveTemplateForUser(userId, input.templateId);
      } else {
        const defaultTemplate = EMAIL_TEMPLATES[0];
        template = { id: defaultTemplate.id, subject: defaultTemplate.subject, body: defaultTemplate.body, attachResume: false, resumeId: null };
      }

      // Save all profiles in batch, then look them up by LinkedIn URL to get full PersonWithSource shape
      const saveStart = Date.now();
      const saveResults = await saveShortProfilesBatch(apiResult.profiles, schoolTag);
      const savedPersonIds: string[] = [];
      let saveNewCount = 0;
      for (const r of saveResults) {
        savedPersonIds.push(r.personId);
        if (r.isNew) saveNewCount++;
      }
      const saveFailCount = saveResults.filter(r => !r.personId).length;
      console.log(`[SearchV2] Saved ${apiResultCount} profiles (${saveNewCount} new, ${apiResultCount - saveNewCount - saveFailCount} existing, ${saveFailCount} failed) in ${Date.now() - saveStart}ms`);
      log.info('search-v2', 'Profiles saved (advanced)', {
        total: apiResultCount,
        new: saveNewCount,
        failed: saveFailCount,
        durationMs: Date.now() - saveStart,
      });

      // Look up saved profiles by LinkedIn URL to get full PersonWithSource data
      const linkedinUrls = apiResult.profiles
        .map(p => p.linkedinUrl)
        .filter((url): url is string => !!url);
      const personMap = await findPeopleByLinkedInUrls(linkedinUrls);

      // Build results in LinkedIn's order (preserving relevance ranking)
      const orderedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }> = [];
      for (const profile of apiResult.profiles) {
        const person = profile.linkedinUrl ? personMap.get(profile.linkedinUrl) : null;
        if (!person) continue;
        if (allExcludedIds.includes(person.id)) continue;
        orderedPeople.push({
          candidate: { ...person, emailDeliverable: null, emailVerifiedAt: null, emailVerificationReason: null } as PersonWithSource,
          score: 0,
          breakdown: {} as ScoreBreakdown,
        });
      }

      log.info('search-v2', 'Advanced path ordering complete', {
        apiProfiles: apiResult.profiles.length,
        orderedAfterExclusion: orderedPeople.length,
        excluded: apiResult.profiles.length - orderedPeople.length,
      });
      const draftsStart = Date.now();
      results = await buildResultsWithDrafts(orderedPeople, userId, template, user);
      console.log(`[SearchV2] Built ${results.length} results with drafts in ${Date.now() - draftsStart}ms`);
    } else {
      // ===== SIMPLE PATH: DB-first, LinkedIn Short fallback =====
      console.log(`[SearchV2] PATH: Simple (DB-first)`);
      log.decision('search-v2', 'Simple path taken', {});
      let companyAliases: string[] = [];
      if (dbFilters.company) {
        const resolved = await resolveCompanyAliases(dbFilters.company);
        companyAliases = resolved.aliases;
        if (companyAliases.length > 0) {
          console.log(`[SearchV2] Company "${dbFilters.company}" → aliases: [${companyAliases.join(', ')}]`);
        }
        log.info('search-v2', 'Company aliases resolved', {
          company: dbFilters.company,
          aliases: companyAliases,
        });
      }

      const filters: PersonFiltersV2 = {
        company: dbFilters.company || '',
        companyAliases: companyAliases.length > 0 ? companyAliases : undefined,
        location: dbFilters.location || undefined,
        role: dbFilters.role || undefined,
        university: dbFilters.university || undefined,
        roleSpecificity: dbFilters.roleSpecificity,
        requireEmail: false,
        excludePersonIds: allExcludedIds,
        limit: input.limit,
      };

      const dbStart = Date.now();
      let people = await findPeopleByFiltersV3(filters);
      dbResultCount = people.length;
      console.log(`[SearchV2] DB returned ${dbResultCount} results in ${Date.now() - dbStart}ms`);
      log.info('search-v2', 'DB query complete', {
        resultCount: dbResultCount,
        durationMs: Date.now() - dbStart,
        aliasesUsed: companyAliases.length,
      });

      let template: ResolvedTemplate;
      if (userId) {
        template = await resolveTemplateForUser(userId, input.templateId);
      } else {
        const defaultTemplate = EMAIL_TEMPLATES[0];
        template = { id: defaultTemplate.id, subject: defaultTemplate.subject, body: defaultTemplate.body, attachResume: false, resumeId: null };
      }

      if (dbResultCount < DB_FIRST_THRESHOLD) {
        // ── LinkedIn fallback: show LinkedIn results directly (like advanced path) ──
        console.log(`[SearchV2] DB has ${dbResultCount} results (< ${DB_FIRST_THRESHOLD}) — calling Short mode API`);
        log.decision('search-v2', 'DB insufficient — calling LinkedIn Short', {
          dbResultCount,
          threshold: DB_FIRST_THRESHOLD,
        });
        const apiStart = Date.now();

        // Simple path LinkedIn fallback: always start at page 1 on initial
        // search. Load More will resume from cursor+1 via loadMoreV2Action.
        const apiResult = await searchLinkedInShort({
          ...linkedInFilters,
          startPage: 1,
          takePages: 1,
        });
        shortModePages = 1;
        linkedInPage = 1;
        newCursor = 1;
        totalMatchesOnLinkedIn = apiResult.pagination.totalElements;
        totalLinkedInPages = apiResult.pagination.totalPages;

        console.log(`[SearchV2] Short mode returned ${apiResult.profiles.length} profiles (${totalMatchesOnLinkedIn} total on LinkedIn) in ${Date.now() - apiStart}ms`);
        log.info('search-v2', 'LinkedIn Short returned (simple)', {
          profileCount: apiResult.profiles.length,
          totalMatchesOnLinkedIn,
          durationMs: Date.now() - apiStart,
          costUsd: APIFY_SHORT_COST_PER_PAGE,
        });

        const schoolTag = linkedInFilters.schools?.[0] || null;
        const saveStart2 = Date.now();
        const saveResults2 = await saveShortProfilesBatch(apiResult.profiles, schoolTag);
        let newCount = 0;
        for (const r of saveResults2) {
          if (r.isNew) newCount++;
        }
        const failCount = saveResults2.filter(r => !r.personId).length;
        apiResultCount = apiResult.profiles.length;
        console.log(`[SearchV2] Saved ${apiResultCount} profiles (${newCount} new, ${apiResultCount - newCount - failCount} existing, ${failCount} failed) in ${Date.now() - saveStart2}ms`);
        log.info('search-v2', 'Profiles saved (simple)', {
          total: apiResultCount,
          new: newCount,
          failed: failCount,
          durationMs: Date.now() - saveStart2,
        });

        // Build results from LinkedIn profiles directly (not re-querying DB)
        // This avoids losing profiles that lack role embeddings for vector search
        const linkedinUrls = apiResult.profiles
          .map(p => p.linkedinUrl)
          .filter((url): url is string => !!url);
        const personMap = await findPeopleByLinkedInUrls(linkedinUrls);

        // Also include any DB-only results that weren't in the LinkedIn batch
        const linkedInPersonIds = new Set(Array.from(personMap.values()).map(p => p.id));
        const dbOnlyPeople = people.filter(p => !linkedInPersonIds.has(p.id));

        // LinkedIn results first (preserving LinkedIn relevance order), then DB-only results
        const orderedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }> = [];
        for (const profile of apiResult.profiles) {
          const person = profile.linkedinUrl ? personMap.get(profile.linkedinUrl) : null;
          if (!person) continue;
          if (allExcludedIds.includes(person.id)) continue;
          orderedPeople.push({
            candidate: { ...person, emailDeliverable: null, emailVerifiedAt: null, emailVerificationReason: null } as PersonWithSource,
            score: 0,
            breakdown: {} as ScoreBreakdown,
          });
        }
        // Append DB-only results at the end
        for (const person of dbOnlyPeople) {
          if (allExcludedIds.includes(person.id)) continue;
          orderedPeople.push({
            candidate: person as PersonWithSource,
            score: person.roleDistance != null ? Math.round((1 - person.roleDistance) * 100) : 0,
            breakdown: {} as ScoreBreakdown,
          });
        }

        console.log(`[SearchV2] Merged ${orderedPeople.length} results (${orderedPeople.length - dbOnlyPeople.length} from LinkedIn, ${dbOnlyPeople.length} DB-only)`);
        log.info('search-v2', 'Merge complete (simple path)', {
          linkedInResults: orderedPeople.length - dbOnlyPeople.length,
          dbOnlyResults: dbOnlyPeople.length,
          totalMerged: orderedPeople.length,
          excludedByIds: apiResult.profiles.length - (orderedPeople.length - dbOnlyPeople.length),
        });

        const draftsStart2 = Date.now();
        results = await buildResultsWithDrafts(orderedPeople.slice(0, input.limit), userId, template, user);
        console.log(`[SearchV2] Built ${results.length} results with drafts in ${Date.now() - draftsStart2}ms`);
      } else {
        // ── DB has enough results: use them directly, skip LinkedIn API ──
        console.log(`[SearchV2] DB has ${dbResultCount} results (>= ${DB_FIRST_THRESHOLD}) — skipping API ($0 cost)`);
        log.decision('search-v2', 'DB sufficient — skipping API', {
          dbResultCount,
          threshold: DB_FIRST_THRESHOLD,
          vectorActive: isVectorRoleMatchingEnabled() && !!dbFilters.role,
        });

        // Rank candidates
        const vectorActive = isVectorRoleMatchingEnabled() && !!dbFilters.role;
        let rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>;

        if (vectorActive) {
          rankedPeople = people.map((person) => ({
            candidate: person as PersonWithSource,
            score: person.roleDistance != null ? Math.round((1 - person.roleDistance) * 100) : 0,
            breakdown: {} as ScoreBreakdown,
          }));
        } else {
          const searchCriteria: SearchCriteria = {
            company: dbFilters.company || undefined,
            role: dbFilters.role || undefined,
            university: dbFilters.university || undefined,
            location: dbFilters.location || undefined,
          };
          rankedPeople = rankCandidates(
            searchCriteria,
            people,
            (person): CandidateData => ({
              company: person.company,
              role: person.role,
              email: person.email,
              emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
              city: person.city,
              state: person.state,
              country: person.country,
              educationSchool: person.educationSchool,
            }),
            input.limit
          );
        }

        rankedPeople = rankedPeople.slice(0, input.limit);
        log.info('search-v2', 'DB-only ranking complete', {
          rankingMethod: vectorActive ? 'vector' : 'heuristic',
          candidatesBeforeSlice: people.length,
          returning: rankedPeople.length,
          topScores: rankedPeople.slice(0, 3).map(r => ({ score: r.score, company: r.candidate.company, role: r.candidate.role })),
        });

        const draftsStart2 = Date.now();
        results = await buildResultsWithDrafts(rankedPeople, userId, template, user);
        console.log(`[SearchV2] Built ${results.length} results with drafts in ${Date.now() - draftsStart2}ms`);
      }
    }

    // ===== Compute cost + save Search record =====
    const totalCostCents =
      parseCost.costCents + (shortModePages * 10);

    // queryHash was computed earlier (before the advanced/simple branch)

    // Resolved `totalLinkedInMatches` — prefer the live value from this
    // request, fall back to the previously-stored value so Path C (DB-only,
    // no Apify call) doesn't wipe out existing knowledge.
    const resolvedTotalMatches =
      totalMatchesOnLinkedIn > 0 ? totalMatchesOnLinkedIn : existingTotalMatches;

    // Save Search record. The DB has a COALESCE-based unique constraint on
    // (company, role, university, location) that Prisma doesn't know about.
    // On duplicate, update the existing row instead.
    const searchCreateData = {
      queryHash,
      rawQuery: input.query,
      parsedFilters: JSON.parse(JSON.stringify({ dbFilters, linkedInFilters })),
      company: dbFilters.company || null,
      role: dbFilters.role || null,
      university: dbFilters.university || null,
      location: dbFilters.location || null,
      haikuCalls: parseCost.haikuCalls,
      shortModePages,
      totalCostCents,
      costBreakdown: {
        haiku: parseCost.costCents,
        shortMode: shortModePages * 10,
        serper: parseCost.serperCalls * 0.1,
        fullScrape: 0,
      },
      totalLinkedInMatches: resolvedTotalMatches,
      lastCsePageScraped: newCursor,
      completedAt: new Date(),
    };

    // Try UPDATE first (RETURNING id); if no row matched, INSERT.
    // This avoids triggering Prisma's P2002 error log on the COALESCE-based
    // unique constraint (which Prisma doesn't know about).
    const updatedSearchRows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Search"
      SET "queryHash" = ${searchCreateData.queryHash},
          "rawQuery" = ${searchCreateData.rawQuery},
          "parsedFilters" = ${JSON.stringify(searchCreateData.parsedFilters)}::jsonb,
          "haikuCalls" = ${searchCreateData.haikuCalls},
          "shortModePages" = ${searchCreateData.shortModePages},
          "totalCostCents" = ${searchCreateData.totalCostCents},
          "costBreakdown" = ${JSON.stringify(searchCreateData.costBreakdown)}::jsonb,
          "totalLinkedInMatches" = ${searchCreateData.totalLinkedInMatches},
          "lastCsePageScraped" = ${searchCreateData.lastCsePageScraped},
          "completedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE COALESCE(company, '') = ${dbFilters.company || ''}
        AND COALESCE(role, '') = ${dbFilters.role || ''}
        AND COALESCE(university, '') = ${dbFilters.university || ''}
        AND COALESCE(location, '') = ${dbFilters.location || ''}
      RETURNING "id"
    `;

    let searchRowId: string;
    if (updatedSearchRows.length > 0) {
      searchRowId = updatedSearchRows[0].id;
    } else {
      const created = await prisma.search.create({ data: searchCreateData });
      searchRowId = created.id;
    }

    // ===== Tag results to this Search row (preserves relevance order) =====
    // Only tag advanced queries — simple queries reconstruct from DB columns.
    if (hasAdvancedFilters) {
      const resultPersonIds = results.map(r => r.id);
      await tagPeopleToSearch(searchRowId, resultPersonIds, 0, 0);
    }

    if (userId) {
      await prisma.searchLog.create({
        data: {
          userId,
          company: dbFilters.company || null,
          role: dbFilters.role || null,
          university: dbFilters.university || null,
          location: dbFilters.location || null,
          resultsCount: results.length,
        },
      });
    }

    // hasMore: if LinkedIn was called (either path), use LinkedIn pagination;
    // otherwise DB-only path — stay optimistic so Load More is clickable. The
    // server (loadMoreV2Action) drains remaining DB rows first and then falls
    // through to Apify, so hasMore=false is computed there when truly exhausted.
    const calledLinkedIn = shortModePages > 0;
    const hasMore = calledLinkedIn
      ? totalMatchesOnLinkedIn > apiResultCount
      : dbResultCount > 0;

    const elapsed = Date.now() - searchStart;
    console.log(
      `[SearchV2] ✓ Done in ${elapsed}ms — ${results.length} results, hasMore=${hasMore}, path=${hasAdvancedFilters ? 'advanced' : calledLinkedIn ? 'simple+linkedin' : 'simple(db-only)'}, dbHits=${dbResultCount}, apiHits=${apiResultCount}, cost=$${(totalCostCents / 100).toFixed(2)}`
    );
    console.log(`[SearchV2] ────────────────────────────────────────────────`);
    log.info('search-v2', 'Returning results', {
      resultCount: results.length,
      hasMore,
      path: hasAdvancedFilters ? 'advanced' : calledLinkedIn ? 'simple+linkedin' : 'simple(db-only)',
      dbHits: dbResultCount,
      apiHits: apiResultCount,
      totalMatchesOnLinkedIn,
      totalCostCents,
      elapsedMs: elapsed,
    });

    return {
      success: true,
      results,
      searchMeta: {
        hasMore,
        isAdvancedQuery: hasAdvancedFilters,
        haikuCalls: parseCost.haikuCalls,
        serperCalls: parseCost.serperCalls,
        shortModePages,
        totalCostCents,
        dbResultCount,
        apiResultCount,
        totalMatchesOnLinkedIn,
        linkedInPage: calledLinkedIn ? (linkedInPage || 1) : undefined,
        totalLinkedInPages: calledLinkedIn ? totalLinkedInPages : undefined,
      },
      remainingDaily,
      hiddenCount,
    };
  } catch (error) {
    const elapsed = Date.now() - searchStart;
    console.error(`[SearchV2] ✗ FAILED after ${elapsed}ms — query="${input.query}", filters=${JSON.stringify(input.dbFilters)}`, error);
    console.log(`[SearchV2] ────────────────────────────────────────────────`);
    log.error('search-v2', 'Search threw', {
      error: String(error),
      elapsedMs: elapsed,
    });
    return { success: false, error: 'Search failed. Please try again.' };
  }
  };

  if (logger) {
    try {
      const result = await withLogger(logger, run);
      await logger.finalize(result.success ? 'success' : 'error', result.success ? undefined : result.error);
      return result;
    } catch (err) {
      await logger.finalize('error', String(err));
      throw err;
    }
  }
  return run();
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 Load More: Fetch next page of LinkedIn results
//
// Page state is persisted on the `Search` row (keyed off the same composite
// used by the upsert in searchPeopleV2Action). The server is the single
// source of truth — the client just says "give me more for this filter set"
// and the server decides which Apify page to fetch based on the stored
// cursor and `totalLinkedInMatches`.
// ═══════════════════════════════════════════════════════════════════════════════

export interface LoadMoreV2Input {
  linkedInFilters: import('@/lib/types/linkedin-filters').LinkedInFilters;
  dbFilters: import('@/lib/types/linkedin-filters').DBFilters;
  excludePersonIds: string[];
  templateId?: string;
}

export type LoadMoreV2Result = {
  success: true;
  results: SearchResultWithDraft[];
  hasMore: boolean;
} | {
  success: false;
  error: string;
};

export async function loadMoreV2Action(
  input: LoadMoreV2Input
): Promise<LoadMoreV2Result> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id || null;

  // Gate free users who have exhausted lifetime sends
  if (userId) {
    const creditStatus = await checkEmailCredits(userId);
    if (!creditStatus.canSend && !creditStatus.isSubscribed) {
      return { success: false, error: 'LIMIT_REACHED' };
    }
  }

  // Build a human-readable slug for the discovery log filename.
  const slugParts = [
    input.dbFilters.company || 'anycompany',
    input.dbFilters.role || 'anyrole',
    input.dbFilters.university,
    input.dbFilters.location,
  ].filter(Boolean) as string[];
  const logger = createLoggerForQuery(`loadmore:${slugParts.join(' ')}`);

  const run = async (): Promise<LoadMoreV2Result> => {
    const loadStart = Date.now();
    const { dbFilters, linkedInFilters, excludePersonIds } = input;

    log.info('loadmore-v2', 'Received load-more request', {
      dbFilters,
      linkedInFilterKeys: Object.keys(linkedInFilters),
      excludeCount: excludePersonIds.length,
    });

    try {
      // Look up the Search row early so both Tier 1 (DB) and Tier 2 (Apify)
      // can tag results to it via SearchPerson.
      const searchRow = await prisma.$queryRaw<
        Array<{ id: string; lastCsePageScraped: number; totalLinkedInMatches: number | null }>
      >`
        SELECT "id", "lastCsePageScraped", "totalLinkedInMatches"
        FROM "Search"
        WHERE COALESCE(company, '') = ${dbFilters.company || ''}
          AND COALESCE(role, '') = ${dbFilters.role || ''}
          AND COALESCE(university, '') = ${dbFilters.university || ''}
          AND COALESCE(location, '') = ${dbFilters.location || ''}
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `;
      const searchRowId = searchRow[0]?.id ?? null;

      // ── Tier 1: drain remaining DB rows before hitting Apify ──
      // Covers: (a) initial search took DB-only path, client cache exhausted;
      // (b) popular searches where DB had >limit rows and the first batch
      // didn't fetch them all. We probe DB with excludePersonIds so we only
      // return rows the client hasn't seen yet.
      if (dbFilters.company) {
        log.decision('loadmore-v2', 'DB-first probe taken', {});

        const resolved = await resolveCompanyAliases(dbFilters.company);
        const companyAliases = resolved.aliases;
        log.info('loadmore-v2', 'Company aliases resolved', {
          company: dbFilters.company,
          aliases: companyAliases,
        });

        const dbFilterInput: PersonFiltersV2 = {
          company: dbFilters.company,
          companyAliases: companyAliases.length > 0 ? companyAliases : undefined,
          location: dbFilters.location || undefined,
          role: dbFilters.role || undefined,
          university: dbFilters.university || undefined,
          roleSpecificity: dbFilters.roleSpecificity,
          requireEmail: false,
          excludePersonIds,
          limit: 25,
        };

        const dbStart = Date.now();
        const dbPeople = await findPeopleByFiltersV3(dbFilterInput);
        const dbProbeMs = Date.now() - dbStart;
        console.log(`[LoadMoreV2] DB-first probe returned ${dbPeople.length} results in ${dbProbeMs}ms`);
        log.info('loadmore-v2', 'DB-first probe complete', {
          resultCount: dbPeople.length,
          durationMs: dbProbeMs,
          aliasesUsed: companyAliases.length,
          excludeCount: excludePersonIds.length,
        });

        if (dbPeople.length > 0) {
          log.decision('loadmore-v2', 'DB hit — returning without Apify', {
            resultCount: dbPeople.length,
          });

          // Build user + template for draft generation (same as Apify branch below)
          let user = null;
          if (userId) {
            user = await prisma.user.findUnique({
              where: { id: userId },
              select: { name: true, university: true, classification: true, major: true, career: true, dailySendCount: true, lastSendDate: true },
            });
          }

          let template: ResolvedTemplate;
          if (userId) {
            template = await resolveTemplateForUser(userId, input.templateId);
          } else {
            const defaultTemplate = EMAIL_TEMPLATES[0];
            template = { id: defaultTemplate.id, subject: defaultTemplate.subject, body: defaultTemplate.body, attachResume: false, resumeId: null };
          }

          const rankedPeople = dbPeople.map((person) => ({
            candidate: person as PersonWithSource,
            score: person.roleDistance != null ? Math.round((1 - person.roleDistance) * 100) : 0,
            breakdown: {} as ScoreBreakdown,
          }));

          const results = await buildResultsWithDrafts(rankedPeople, userId, template, user);

          // hasMore=true: stay optimistic. Next Load More click will either
          // return more DB rows or drop through to Apify.
          const elapsed = Date.now() - loadStart;
          console.log(`[LoadMoreV2] ✓ Done in ${elapsed}ms — ${results.length} DB results, hasMore=true (db-first)`);
          log.info('loadmore-v2', 'Returning results', {
            path: 'db-first',
            resultCount: results.length,
            hasMore: true,
            elapsedMs: elapsed,
            totalCostCents: 0,
          });
          return { success: true, results, hasMore: true };
        }

        console.log(`[LoadMoreV2] DB drained — falling through to Apify`);
        log.decision('loadmore-v2', 'DB drained — falling through to Apify', {});
      }

      // ── Tier 2: Apify Short mode ──
      // Reuse the searchRow queried above (before Tier 1).
      const currentCursor = searchRow[0]?.lastCsePageScraped ?? 0;
      const totalMatches = searchRow[0]?.totalLinkedInMatches ?? null;

      const { shouldFetch, nextPage } = computeNextApifyPage(currentCursor, totalMatches);

      log.info('loadmore-v2', 'Cursor lookup complete', {
        currentCursor,
        totalMatches,
        nextPage,
        shouldFetch,
      });

      if (!shouldFetch) {
        console.log(`[LoadMoreV2] Exhausted — cursor=${currentCursor}, totalMatches=${totalMatches}. No more to fetch.`);
        log.decision('loadmore-v2', 'Apify cursor exhausted — no more pages', {
          cursor: currentCursor,
          totalMatches,
        });
        const elapsed = Date.now() - loadStart;
        log.info('loadmore-v2', 'Returning results', {
          path: 'exhausted',
          resultCount: 0,
          hasMore: false,
          elapsedMs: elapsed,
          totalCostCents: 0,
        });
        return { success: true, results: [], hasMore: false };
      }

      console.log(`[LoadMoreV2] ── Fetching page ${nextPage} (cursor was ${currentCursor}, totalMatches=${totalMatches ?? 'unknown'}) ──`);

      const apifyStart = Date.now();
      const apiResult = await searchLinkedInShort({
        ...linkedInFilters,
        startPage: nextPage,
        takePages: 1,
      });
      const apifyMs = Date.now() - apifyStart;

      const freshTotalMatches = apiResult.pagination.totalElements;
      const effectiveTotalMatches = freshTotalMatches > 0 ? freshTotalMatches : totalMatches;

      console.log(`[LoadMoreV2] Got ${apiResult.profiles.length} profiles (page ${nextPage}, totalMatches=${effectiveTotalMatches ?? 'unknown'})`);
      log.info('loadmore-v2', 'Apify page fetched', {
        page: nextPage,
        profileCount: apiResult.profiles.length,
        totalMatchesOnLinkedIn: effectiveTotalMatches,
        durationMs: apifyMs,
        costUsd: APIFY_SHORT_COST_PER_PAGE,
      });

      // Save profiles to DB in batch
      const schoolTag = linkedInFilters.schools?.[0] || null;
      const saveStart = Date.now();
      await saveShortProfilesBatch(apiResult.profiles, schoolTag);
      log.info('loadmore-v2', 'Profiles saved', {
        total: apiResult.profiles.length,
        durationMs: Date.now() - saveStart,
      });

      // Persist the advanced cursor + fresh totalMatches immediately, so
      // concurrent Load More clicks don't double-fetch the same page.
      if (searchRow[0]) {
        await prisma.search.update({
          where: { id: searchRow[0].id },
          data: {
            lastCsePageScraped: nextPage,
            totalLinkedInMatches: effectiveTotalMatches,
            updatedAt: new Date(),
          },
        });
      }

      // Look up saved profiles by LinkedIn URL
      const linkedinUrls = apiResult.profiles
        .map(p => p.linkedinUrl)
        .filter((url): url is string => !!url);
      const personMap = await findPeopleByLinkedInUrls(linkedinUrls);

      // Build results in LinkedIn's order
      const excludeSet = new Set(input.excludePersonIds);
      const orderedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }> = [];
      let loadMoreNotInDb = 0;
      let loadMoreExcluded = 0;
      for (const profile of apiResult.profiles) {
        const person = profile.linkedinUrl ? personMap.get(profile.linkedinUrl) : null;
        if (!person) { loadMoreNotInDb++; continue; }
        if (excludeSet.has(person.id)) { loadMoreExcluded++; continue; }
        orderedPeople.push({
          candidate: { ...person, emailDeliverable: null, emailVerifiedAt: null, emailVerificationReason: null } as PersonWithSource,
          score: 0,
          breakdown: {} as ScoreBreakdown,
        });
      }
      log.info('loadmore-v2', 'Load-more dedup complete', {
        apiProfiles: apiResult.profiles.length,
        notInDb: loadMoreNotInDb,
        excluded: loadMoreExcluded,
        returning: orderedPeople.length,
      });

      // Get user info for draft generation
      let user = null;
      if (userId) {
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, university: true, classification: true, major: true, career: true, dailySendCount: true, lastSendDate: true },
        });
      }

      let template: ResolvedTemplate;
      if (userId) {
        template = await resolveTemplateForUser(userId, input.templateId);
      } else {
        const defaultTemplate = EMAIL_TEMPLATES[0];
        template = { id: defaultTemplate.id, subject: defaultTemplate.subject, body: defaultTemplate.body, attachResume: false, resumeId: null };
      }

      const results = await buildResultsWithDrafts(orderedPeople, userId, template, user);
      const hasMore = hasMoreApifyPages(nextPage, effectiveTotalMatches);

      // Tag Apify results to the Search row for cache
      if (searchRowId) {
        const maxPos = await getMaxSearchPersonPosition(searchRowId);
        const personIds = results.map(r => r.id);
        await tagPeopleToSearch(searchRowId, personIds, maxPos + 1, nextPage);
      }

      const elapsed = Date.now() - loadStart;
      console.log(`[LoadMoreV2] ✓ Done in ${elapsed}ms — ${results.length} results from page ${nextPage}, hasMore=${hasMore}`);
      log.info('loadmore-v2', 'Returning results', {
        path: 'apify',
        resultCount: results.length,
        hasMore,
        nextPage,
        elapsedMs: elapsed,
        totalCostCents: Math.round(APIFY_SHORT_COST_PER_PAGE * 100),
      });

      return { success: true, results, hasMore };
    } catch (error) {
      const elapsed = Date.now() - loadStart;
      console.error(`[LoadMoreV2] ✗ FAILED:`, error);
      log.error('loadmore-v2', 'Load more threw', {
        error: String(error),
        elapsedMs: elapsed,
      });
      return { success: false, error: 'Failed to load more profiles. Please try again.' };
    }
  };

  if (logger) {
    try {
      const result = await withLogger(logger, run);
      await logger.finalize(
        result.success ? 'success' : 'error',
        result.success ? undefined : result.error
      );
      return result;
    } catch (err) {
      await logger.finalize('error', String(err));
      throw err;
    }
  }
  return run();
}

/**
 * Get recent unique searches for the current user.
 * Deduplicates by (company, role, university, location) key, returns top 8.
 */
export async function getRecentSearchesAction(): Promise<RecentSearch[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return [];

  try {
    const logs = await prisma.searchLog.findMany({
      where: { userId: session.user.id },
      orderBy: { searchedAt: 'desc' },
      take: 50,
      select: {
        company: true,
        role: true,
        university: true,
        location: true,
        searchedAt: true,
        resultsCount: true,
      },
    });

    // Deduplicate by combo key, keeping first (most recent) occurrence
    const seen = new Set<string>();
    const unique: RecentSearch[] = [];

    for (const log of logs) {
      const key = [log.company, log.role, log.university, log.location]
        .map((v) => (v || '').toLowerCase().trim())
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(log);
      if (unique.length >= 8) break;
    }

    return unique;
  } catch (error) {
    console.error('[Search] Error fetching recent searches:', error);
    return [];
  }
}

/**
 * Hide a person from future searches
 */
export async function hidePersonAction(
  userCandidateId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    await prisma.userCandidate.update({
      where: { id: userCandidateId, userId: session.user.id },
      data: { doNotShow: true },
    });

    console.log(`[Hide] User ${session.user.id} marked userCandidate ${userCandidateId} as doNotShow`);
    return { success: true };
  } catch (error) {
    console.error('[Hide] Error:', error);
    return { success: false, error: 'Failed to hide person' };
  }
}

/**
 * Toggle saved for later status for a person
 */
export async function toggleSavedForLaterAction(
  userCandidateId: string
): Promise<{ success: true; savedForLater: boolean } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const current = await prisma.userCandidate.findUnique({
      where: { id: userCandidateId, userId: session.user.id },
      select: { savedForLater: true },
    });

    if (!current) {
      return { success: false, error: 'Person not found' };
    }

    const newValue = !current.savedForLater;
    await prisma.userCandidate.update({
      where: { id: userCandidateId, userId: session.user.id },
      data: { savedForLater: newValue },
    });

    console.log(`[SaveForLater] User ${session.user.id} set savedForLater=${newValue} for userCandidate ${userCandidateId}`);
    return { success: true, savedForLater: newValue };
  } catch (error) {
    console.error('[SaveForLater] Error:', error);
    return { success: false, error: 'Failed to update saved status' };
  }
}

/**
 * Fetch hidden people for the current user (for the "N people hidden" bar)
 */
export async function getHiddenPeopleAction(): Promise<
  { success: true; people: HiddenPerson[] } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const hidden = await prisma.userCandidate.findMany({
      where: { userId: session.user.id, doNotShow: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        personId: true,
        person: {
          select: { fullName: true, company: true, role: true },
        },
      },
    });

    return {
      success: true,
      people: hidden.map((uc) => ({
        userCandidateId: uc.id,
        personId: uc.personId,
        fullName: uc.person.fullName,
        company: uc.person.company,
        role: uc.person.role,
      })),
    };
  } catch (error) {
    console.error('[Hide] Error fetching hidden people:', error);
    return { success: false, error: 'Failed to fetch hidden people' };
  }
}

/**
 * Unhide a person (reverse of hidePersonAction).
 * Returns the full SearchResultWithDraft so the UI can re-insert them into results.
 */
export async function unhidePersonAction(
  userCandidateId: string
): Promise<{ success: true; person: SearchResultWithDraft } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    // Unhide
    await prisma.userCandidate.update({
      where: { id: userCandidateId, userId },
      data: { doNotShow: false },
    });

    // Fetch person + draft data to return to the UI
    const uc = await prisma.userCandidate.findUnique({
      where: { id: userCandidateId },
      select: {
        id: true,
        personId: true,
        savedForLater: true,
        person: {
          select: {
            id: true,
            fullName: true,
            firstName: true,
            lastName: true,
            company: true,
            role: true,
            linkedinUrl: true,
            email: true,
            emailStatus: true,
            emailConfidence: true,
            emailDeliverable: true,
            emailVerifiedAt: true,
            emailVerificationReason: true,
            city: true,
            state: true,
            country: true,
            educationSchool: true,
            educationDegree: true,
            educationField: true,
            educationYear: true,
            scrapeDepth: true,
            sourceLinks: {
              where: { kind: 'DISCOVERY' },
              orderBy: { createdAt: 'asc' as const },
              take: 1,
              select: { url: true, title: true, snippet: true, domain: true },
            },
          },
        },
        emailDraft: {
          select: { subject: true, body: true, template: { select: { id: true, attachResume: true, resumeId: true } } },
        },
      },
    });

    if (!uc) {
      return { success: false, error: 'Candidate not found' };
    }

    const p = uc.person;
    const sourceLink = p.sourceLinks[0];
    const draft = uc.emailDraft;

    const person: SearchResultWithDraft = {
      id: p.id,
      fullName: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.company,
      role: p.role,
      linkedinUrl: p.linkedinUrl,
      email: p.email,
      emailStatus: (p.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
      emailConfidence: p.emailConfidence,
      emailDeliverable: p.emailDeliverable,
      emailVerifiedAt: p.emailVerifiedAt,
      emailVerificationReason: p.emailVerificationReason,
      city: p.city,
      state: p.state,
      country: p.country,
      educationSchool: p.educationSchool,
      educationDegree: p.educationDegree,
      educationField: p.educationField,
      educationYear: p.educationYear,
      sourceUrl: sourceLink?.url || null,
      sourceTitle: sourceLink?.title || null,
      sourceSnippet: sourceLink?.snippet || null,
      sourceDomain: sourceLink?.domain || null,
      scrapeDepth: p.scrapeDepth || 'full',
      draftSubject: draft?.subject || '',
      draftBody: draft?.body || '',
      userCandidateId: uc.id,
      resumeId: draft?.template?.attachResume ? draft.template.resumeId : null,
      savedForLater: uc.savedForLater,
    };

    console.log(`[Unhide] User ${userId} unmarked userCandidate ${userCandidateId}`);
    return { success: true, person };
  } catch (error) {
    console.error('[Unhide] Error:', error);
    return { success: false, error: 'Failed to unhide person' };
  }
}




// ===== PERSON LOOKUP (by name) =====

export interface LookupInput {
  name: string;
  company?: string;
  templateId?: string;
}

export type LookupActionResult = {
  success: true;
  results: SearchResultWithDraft[];
} | {
  success: false;
  error: string;
};

/**
 * Look up a specific person by name.
 *
 * Flow:
 * 1. Check DB for existing people matching the name
 * 2. If few DB results, also query CSE (two-pass: name+company, then name-only)
 * 3. Save new CSE profiles → enrich with patterns/Apollo → generate drafts
 * 4. Merge + deduplicate, return top 5 as SearchResultWithDraft[]
 */
export async function lookupPersonAction(
  input: LookupInput
): Promise<LookupActionResult> {
  const lookupStart = Date.now();
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.name || input.name.trim().length < 2) {
    return { success: false, error: 'Name must be at least 2 characters' };
  }

  const logger = createLoggerForQuery(
    `lookup:${input.name}${input.company ? `@${input.company}` : ''}`
  );
  const run = async (): Promise<LookupActionResult> => {
    log.info('lookup', 'Received person lookup', {
      name: input.name,
      company: input.company,
    });
    return runLookup();
  };

  if (logger) {
    try {
      const result = await withLogger(logger, run);
      await logger.finalize(
        result.success ? 'success' : 'error',
        result.success ? undefined : result.error
      );
      return result;
    } catch (err) {
      await logger.finalize('error', String(err));
      throw err;
    }
  }
  return runLookup();

  async function runLookup(): Promise<LookupActionResult> {
    try {
      const userId = session!.user!.id;

      const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        university: true,
        classification: true,
        major: true,
        career: true,
      },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const cleanName = input.name.replace(/,.*$/, '').trim();

    // ===== STEP 1: Check DB first =====
    const dbPeople = await findPeopleByName({
      name: cleanName,
      company: input.company,
      limit: 5,
    });
    console.log(`[Lookup] DB found ${dbPeople.length} people for "${cleanName}"`);

    // Track which LinkedIn URLs we already have from DB
    const dbLinkedInUrls = new Set(
      dbPeople.filter((p) => p.linkedinUrl).map((p) => p.linkedinUrl!)
    );

    // ===== STEP 2: CSE lookup (unless DB already has plenty) =====
    // Gate on person count, not email count — the goal of a lookup is finding
    // the person. Emails are filled in later via pattern gen / Apollo at send time.
    let csePeople: PersonResult[] = [];
    const dbHasEnough = dbPeople.length >= 3;

    if (!dbHasEnough) {
      console.log('[Lookup] DB results insufficient, querying CSE');
      const cseResults = await lookupByName({
        name: cleanName,
        company: input.company,
      });

      if (cseResults.length > 0) {
        // Check which CSE results already exist in DB
        const cseUrls = cseResults.map((r) => r.linkedinUrl);
        const existingMap = await findPeopleByLinkedInUrls(cseUrls);

        // Separate existing vs new CSE results
        const newCseResults: typeof cseResults = [];
        for (const cseResult of cseResults) {
          if (dbLinkedInUrls.has(cseResult.linkedinUrl)) continue;

          const existing = existingMap.get(cseResult.linkedinUrl);
          if (existing) {
            csePeople.push({
              ...existing,
              emailDeliverable: null,
              emailVerifiedAt: null,
              emailVerificationReason: null,
            });
            dbLinkedInUrls.add(cseResult.linkedinUrl);
          } else {
            newCseResults.push(cseResult);
          }
        }

        // Scrape new profiles via Apify to get full data (role, location, education)
        if (newCseResults.length > 0) {
          const urlsToScrape = newCseResults.map(r => r.linkedinUrl);
          let scrapedMap = new Map<string, ScrapedProfile>();

          try {
            const scraped = await scrapeLinkedInProfiles(urlsToScrape, { includeEmail: false });
            for (const profile of scraped) {
              scrapedMap.set(profile.linkedinUrl, profile);
            }
            console.log(`[Lookup] Scraped ${scraped.length}/${urlsToScrape.length} new profiles`);
          } catch (err) {
            console.error('[Lookup] Scraper failed, falling back to CSE-only data:', err);
          }

          for (const cseResult of newCseResults) {
            const scraped = scrapedMap.get(cseResult.linkedinUrl);
            const profile = scraped || {
              linkedinUrl: cseResult.linkedinUrl,
              fullName: cseResult.fullName || '',
              firstName: cseResult.firstName || '',
              lastName: cseResult.lastName || '',
              company: cseResult.cseCompany || input.company || null,
              role: null,
              email: null,
              city: null,
              state: null,
              country: null,
              schools: [] as string[],
              educationSchool: null,
              experienceHistory: [],
              educationHistory: [],
            };

            const { personId } = await saveScrapedProfile(
              profile,
              cseResult.linkedinUrl,
              cseResult.sourceTitle,
              cseResult.sourceSnippet,
              cseResult.sourceDomain,
              input.company || cseResult.cseCompany || '',
              undefined
            );

            const saved = await prisma.person.findUnique({
              where: { id: personId },
              select: {
                id: true,
                fullName: true,
                firstName: true,
                lastName: true,
                company: true,
                role: true,
                linkedinUrl: true,
                email: true,
                emailStatus: true,
                emailConfidence: true,
                emailDeliverable: true,
                emailVerifiedAt: true,
                emailVerificationReason: true,
                city: true,
                state: true,
                country: true,
                educationSchool: true,
                educationDegree: true,
                educationField: true,
                educationYear: true,
                sourceLinks: {
                  where: { kind: 'DISCOVERY' },
                  orderBy: { createdAt: 'asc' as const },
                  take: 1,
                  select: { url: true, title: true, snippet: true, domain: true },
                },
              },
            });
            if (saved) {
              csePeople.push(saved);
              dbLinkedInUrls.add(cseResult.linkedinUrl);
            }
          }
        }
        console.log(`[Lookup] CSE added ${csePeople.length} new people`);
      }
    }

    // ===== STEP 3: Merge + deduplicate =====
    const allPeople = [...dbPeople, ...csePeople];

    // Deduplicate by person ID
    const seen = new Set<string>();
    const uniquePeople = allPeople.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // Sort: has email first, then VERIFIED > UNVERIFIED > MISSING
    uniquePeople.sort((a, b) => {
      const aHasEmail = a.email ? 0 : 1;
      const bHasEmail = b.email ? 0 : 1;
      if (aHasEmail !== bHasEmail) return aHasEmail - bHasEmail;

      const statusOrder: Record<string, number> = { VERIFIED: 0, UNVERIFIED: 1, MISSING: 2 };
      const aStatus = statusOrder[a.emailStatus || 'MISSING'] ?? 2;
      const bStatus = statusOrder[b.emailStatus || 'MISSING'] ?? 2;
      return aStatus - bStatus;
    });

    const top = uniquePeople.slice(0, 5);

    if (top.length === 0) {
      return { success: true, results: [] };
    }

    // ===== STEP 4: Enrich people without emails (pattern-only, free) =====
    // Apollo enrichment now happens at send time.
    for (const person of top) {
      if (person.email || !person.firstName || !person.lastName) continue;

      const pattern = await getCompanyPattern(person.company);

      if (pattern) {
        const generatedEmail = generateEmailFromPattern(
          person.firstName,
          person.lastName,
          pattern.pattern as any,
          pattern.domain
        );
        await prisma.person.update({
          where: { id: person.id },
          data: {
            email: generatedEmail,
            emailStatus: 'UNVERIFIED',
            emailConfidence: Math.round(pattern.confidence * 100),
          },
        });
        person.email = generatedEmail;
        person.emailStatus = 'UNVERIFIED';
        person.emailConfidence = Math.round(pattern.confidence * 100);
      }
    }

    // ===== STEP 5: Build results with drafts =====
    // Wrap in the format buildResultsWithDrafts expects
    const ranked = top.map((person) => ({
      candidate: person as PersonWithSource,
      score: 100,
      breakdown: {} as ScoreBreakdown,
    }));

    const template = await resolveTemplateForUser(userId, input.templateId);
    const results = await buildResultsWithDrafts(ranked, userId, template, user);

    console.log(`[Lookup] Returning ${results.length} results for "${cleanName}" ${Date.now() - lookupStart}ms`);
    return { success: true, results };
    } catch (error) {
      console.error('[Lookup] Error:', error);
      return { success: false, error: 'Lookup failed. Please try again.' };
    }
  }
}

// ===== REGENERATE DRAFT (template change in review modal) =====

export async function regenerateDraftAction(input: {
  userCandidateId: string;
  templateId: string;
  useLLM?: boolean; // If true, regenerate with LLM (slow). Default false for fast template switching.
}): Promise<
  { success: true; subject: string; body: string; resumeId: string | null } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    // Fetch UserCandidate + Person (expanded fields for LLM)
    const uc = await prisma.userCandidate.findUnique({
      where: { id: input.userCandidateId, userId },
      select: {
        id: true,
        person: {
          select: {
            firstName: true,
            lastName: true,
            company: true,
            role: true,
            city: true,
            state: true,
            country: true,
            educationSchool: true,
            educationDegree: true,
            educationField: true,
          },
        },
      },
    });

    if (!uc) {
      return { success: false, error: 'Candidate not found' };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, university: true, classification: true, major: true, career: true, emailInstructions: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const template = await resolveTemplateForUser(userId, input.templateId);
    const placeholderDraft = generateEmailDraft(
      template,
      { firstName: uc.person.firstName, company: uc.person.company, role: uc.person.role },
      user
    );
    const resumeId = template.attachResume ? template.resumeId : null;

    // Use placeholder draft by default for fast template switching
    // Only call LLM if explicitly requested
    let draft = placeholderDraft;
    if (input.useLLM) {
      try {
        const resumeSummary = await getUserResumeSummary(userId);
        const sentEmailExamples = await getRecentSentEmails(userId);
        draft = await generateEmailWithLLM({
          person: uc.person,
          user,
          resumeSummary,
          referenceTemplate: placeholderDraft,
          sentEmailExamples,
          customInstructions: user.emailInstructions || undefined,
          userId,
        });
      } catch (err) {
        console.warn('[RegenerateDraft] LLM generation failed, using placeholder:', err);
      }
    }

    const isHardcodedTemplate = EMAIL_TEMPLATES.some(t => t.id === template.id);
    await prisma.emailDraft.upsert({
      where: { userCandidateId: uc.id },
      create: {
        userCandidateId: uc.id,
        templateId: isHardcodedTemplate ? null : template.id,
        subject: draft.subject,
        body: draft.body,
        status: 'APPROVED',
      },
      update: {
        templateId: isHardcodedTemplate ? null : template.id,
        subject: draft.subject,
        body: draft.body,
      },
    });

    return { success: true, subject: draft.subject, body: draft.body, resumeId };
  } catch (error) {
    console.error('[RegenerateDraft] Error:', error);
    return { success: false, error: 'Failed to regenerate draft' };
  }
}

// ===== GENERATE LLM DRAFT (on-demand when user opens a profile) =====

export async function generateLLMDraftAction(input: {
  personId: string;
  userCandidateId: string;
}): Promise<
  { success: true; subject: string; body: string } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    const [person, user, resumeSummary, sentEmailExamples] = await Promise.all([
      prisma.person.findUnique({
        where: { id: input.personId },
        select: {
          firstName: true,
          lastName: true,
          company: true,
          role: true,
          city: true,
          state: true,
          country: true,
          educationSchool: true,
          educationDegree: true,
          educationField: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, university: true, classification: true, major: true, career: true, emailInstructions: true },
      }),
      getUserResumeSummary(userId),
      getRecentSentEmails(userId),
    ]);

    if (!person || !user) {
      return { success: false, error: 'Person or user not found' };
    }

    const template = await resolveTemplateForUser(userId);
    const placeholderDraft = generateEmailDraft(
      template,
      { firstName: person.firstName, company: person.company, role: person.role },
      user
    );

    const draft = await generateEmailWithLLM({
      person,
      user,
      resumeSummary,
      referenceTemplate: placeholderDraft,
      sentEmailExamples,
      customInstructions: user.emailInstructions || undefined,
      userId,
    });

    // Save to DB so subsequent visits show the LLM draft (creates draft if first time)
    await prisma.emailDraft.upsert({
      where: { userCandidateId: input.userCandidateId },
      create: {
        userCandidateId: input.userCandidateId,
        subject: draft.subject,
        body: draft.body,
        status: 'APPROVED',
      },
      update: { subject: draft.subject, body: draft.body },
    });

    return { success: true, subject: draft.subject, body: draft.body };
  } catch (error) {
    console.error('[GenerateLLMDraft] Error:', error);
    return { success: false, error: 'Failed to generate draft' };
  }
}

// ===== REFINE DRAFT (chat-based refinement) =====

export async function refineDraftAction(input: {
  subject: string;
  body: string;
  instruction: string;
  personId: string;
}): Promise<
  { success: true; subject: string; body: string } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.instruction?.trim()) {
    return { success: false, error: 'Instruction is required' };
  }

  try {
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { firstName: true, company: true, role: true },
    });

    if (!person) {
      return { success: false, error: 'Person not found' };
    }

    const result = await refineEmailWithLLM({
      subject: input.subject,
      body: input.body,
      instruction: input.instruction,
      person: {
        firstName: person.firstName,
        company: person.company,
        role: person.role,
      },
      userId: session.user.id,
    });

    return { success: true, subject: result.subject, body: result.body };
  } catch (error) {
    console.error('[RefineDraft] Error:', error);
    return { success: false, error: 'Failed to refine email' };
  }
}
