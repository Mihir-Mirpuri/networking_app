'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discoverLinkedInProfiles, lookupByName } from '@/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import {
  getExcludedPersonIds,
  findPeopleByFilters,
  findPeopleByLinkedInUrls,
  findPeopleByName,
  saveScrapedProfile,
  getEmailStatus,
  PersonFilters,
  PersonResult,
  buildPersonWhereClause,
  applyPostQueryFilters,
  getCompanyKey,
  normalizeCompanyForMatch,
  companiesMatch,
} from '@/lib/db/person-service';
import {
  normalizeSearchParams,
  findOrCreateScrapeProgress,
  updateScrapeProgress,
  getNextCsePageStart,
  ApiUsageStats,
} from '@/lib/db/search-cache';
import {
  getCompanyPattern,
  generateEmailFromPattern,
} from '@/lib/services/email-pattern';
import { findEmail } from '@/lib/services/enrichment';

export interface SearchInput {
  name?: string;
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  limit: number;
  templateId: string;
  excludePersonIds?: string[]; // IDs of people already displayed (prevents duplicates on Load More)
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
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
}

export interface SearchMeta {
  hasMore: boolean;
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
}

export type SearchActionResult = {
  success: true;
  results: SearchResultWithDraft[];
  searchMeta: SearchMeta;
  remainingDaily: number;
} | {
  success: false;
  error: string;
};

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
  sourceLinks: Array<{
    url: string;
    title: string;
    snippet: string | null;
    domain: string | null;
  }>;
}

/**
 * Generate email draft using template replacement
 */
function generateEmailDraft(
  templateId: string,
  person: { firstName: string | null; company: string; role: string | null },
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null }
): { subject: string; body: string } {
  const template = EMAIL_TEMPLATES.find((t) => t.id === templateId) || EMAIL_TEMPLATES[0];

  // Replace placeholders
  let subject: string = template.subject;
  let body: string = template.body;

  const replacements: Record<string, string> = {
    '{first_name}': person.firstName || 'there',
    '{company}': person.company,
    '{role}': person.role || 'your role',
    '{user_name}': user.name || 'A student',
    '{university}': user.university || 'my university',
    '{classification}': user.classification || 'student',
    '{major}': user.major || 'my major',
    '{career}': user.career || 'your industry',
    '{industry}': user.career || 'your industry',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replaceAll(placeholder, value);
    body = body.replaceAll(placeholder, value);
  }

  return { subject, body };
}

/**
 * Get template by ID
 */
function getTemplate(templateId: string) {
  return EMAIL_TEMPLATES.find((t) => t.id === templateId) || EMAIL_TEMPLATES[0];
}


/**
 * On-demand enrichment: find people matching filters who lack emails,
 * then apply existing patterns or call Apollo directly (no pattern learning).
 */
async function enrichPeopleOnDemand(
  filters: PersonFilters,
  searchCompany: string,
  maxApolloCalls: number = 10
): Promise<{ apolloCallsMade: number; emailsGenerated: number }> {
  // Build where clause for people WITHOUT emails who haven't been tried with Apollo
  const baseWhere = buildPersonWhereClause({ ...filters, requireEmail: false });
  const where = {
    ...baseWhere,
    email: null,
    apolloEnrichedAt: null,
    firstName: { not: null },
    lastName: { not: null },
  };

  const candidates = await prisma.person.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
    },
    orderBy: { createdAt: 'asc' },
    take: maxApolloCalls * 3, // Overfetch to compensate for post-query company filtering
  });

  // Apply company fuzzy matching (same filter as findPeopleByFilters)
  const matched = applyPostQueryFilters(candidates, searchCompany);

  let apolloCallsMade = 0;
  let emailsGenerated = 0;

  for (const person of matched) {
    // Try existing pattern first (free — no Apollo call)
    const normalizedCompany = normalizeCompanyForMatch(person.company);
    const companyKey = getCompanyKey(normalizedCompany);

    // Try pattern lookup: canonical key first, then exact normalized name
    let pattern = companyKey
      ? await getCompanyPattern(companyKey)
      : null;
    if (!pattern) {
      pattern = await getCompanyPattern(person.company);
    }

    if (pattern) {
      const generatedEmail = generateEmailFromPattern(
        person.firstName!,
        person.lastName!,
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
      emailsGenerated++;
      console.log(`[Enrich] Pattern → ${person.firstName} ${person.lastName} → ${generatedEmail}`);
      continue;
    }

    // No pattern — call Apollo directly (counts toward cap)
    if (apolloCallsMade >= maxApolloCalls) {
      break;
    }

    const result = await findEmail({
      firstName: person.firstName!,
      lastName: person.lastName!,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
    });
    apolloCallsMade++;

    if (result.email) {
      await prisma.person.update({
        where: { id: person.id },
        data: {
          email: result.email,
          emailStatus: result.status,
          emailConfidence: result.confidence,
          emailDeliverable: result.emailDeliverable,
          apolloEnrichedAt: new Date(),
          apolloStatus: result.apolloStatus === 'SUCCESS' || result.apolloStatus === 'NOT_FOUND'
            ? result.apolloStatus : 'API_ERROR',
          ...(result.city && { city: result.city }),
          ...(result.state && { state: result.state }),
          ...(result.country && { country: result.country }),
        },
      });
      emailsGenerated++;
      console.log(`[Enrich] Apollo → ${person.firstName} ${person.lastName} → ${result.email}`);
    } else {
      // Mark as attempted so we don't retry
      await prisma.person.update({
        where: { id: person.id },
        data: {
          apolloEnrichedAt: new Date(),
          apolloStatus: result.apolloStatus === 'SUCCESS' || result.apolloStatus === 'NOT_FOUND'
            ? result.apolloStatus : 'API_ERROR',
          ...(result.city && { city: result.city }),
          ...(result.state && { state: result.state }),
          ...(result.country && { country: result.country }),
        },
      });
      console.log(`[Enrich] Apollo → ${person.firstName} ${person.lastName} → no email (${result.apolloStatus})`);
    }

    // Rate limit between Apollo calls
    if (apolloCallsMade < maxApolloCalls) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`[Enrich] Done: ${emailsGenerated} emails generated, ${apolloCallsMade} Apollo calls`);
  return { apolloCallsMade, emailsGenerated };
}

/**
 * Shared helper: build SearchResultWithDraft[] from ranked candidates.
 * Upserts UserCandidate, generates email drafts, and maps to result objects.
 */
async function buildResultsWithDrafts(
  rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>,
  userId: string,
  templateId: string,
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null }
): Promise<SearchResultWithDraft[]> {
  return Promise.all(
    rankedPeople.map(async ({ candidate: person, score, breakdown }) => {
      const userCandidate = await prisma.userCandidate.upsert({
        where: {
          userId_personId: { userId, personId: person.id },
        },
        create: {
          userId,
          personId: person.id,
          email: person.email,
          emailStatus: (person.emailStatus as any) || 'MISSING',
          emailConfidence: person.emailConfidence,
        },
        update: {},
        select: { id: true },
      });

      const draft = generateEmailDraft(
        templateId,
        { firstName: person.firstName, company: person.company, role: person.role },
        user
      );

      const isHardcodedTemplate = EMAIL_TEMPLATES.some(t => t.id === templateId);
      const emailDraft = await prisma.emailDraft.upsert({
        where: { userCandidateId: userCandidate.id },
        create: {
          userCandidateId: userCandidate.id,
          templateId: isHardcodedTemplate ? null : templateId,
          subject: draft.subject,
          body: draft.body,
          status: 'APPROVED',
        },
        update: {},
      });

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
        draftSubject: emailDraft.subject,
        draftBody: emailDraft.body,
        userCandidateId: userCandidate.id,
        resumeId: null,
        score,
        scoreBreakdown: breakdown,
      };
    })
  );
}

/**
 * Main search action — always queries DB directly with offset pagination.
 *
 * Two-path UX:
 *   0 results + not scraped:  Block, scrape synchronously, return results
 *   1+ results or already scraped: Return immediately (prescrape populates DB in background)
 *
 * hasMore = got a full page from DB OR CSE has more pages to scrape.
 */
export async function searchPeopleAction(
  input: SearchInput
): Promise<SearchActionResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const userId = session.user.id;

    // Get user info for template
    const user = await prisma.user.findUnique({
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

    // Calculate remaining daily sends
    const today = new Date().toDateString();
    const lastSendDay = user.lastSendDate?.toDateString();
    const dailyLimit = 30;
    const remainingDaily =
      lastSendDay === today ? Math.max(0, dailyLimit - user.dailySendCount) : dailyLimit;

    // Get excluded people (already sent or hidden)
    const excludedIds = await getExcludedPersonIds(userId);
    console.log(`[Search] User has ${excludedIds.length} excluded people (sent/hidden).`);

    // Merge sent/hidden IDs with already-displayed IDs for a single DB-level NOT IN
    const allExcludedIds = input.excludePersonIds
      ? [...excludedIds, ...input.excludePersonIds]
      : excludedIds;

    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    // ===== STEP 1: On-demand enrichment + Query DB =====
    const filters: PersonFilters = {
      company: input.company,
      location: input.location,
      role: input.role,
      university: input.university,
      requireEmail: true,
      excludePersonIds: allExcludedIds,
      limit: input.limit,
    };

    // Enrich people without emails before querying (patterns + Apollo)
    const enrichResult = await enrichPeopleOnDemand(filters, input.company);

    let people = await findPeopleByFilters(filters);
    console.log(`[Search] Found ${people.length} people in DB`);

    let apolloCallsMade = enrichResult.apolloCallsMade;
    let apolloCacheHits = 0;
    let cseCallsMade = 0;
    let cseHasMorePages = false;

    // ===== STEP 2: Check CSE state + sync scrape if 0 results =====
    const progress = await findOrCreateScrapeProgress(normalizedParams);
    const nextPage = getNextCsePageStart(progress.lastCsePageScraped, progress.cseExhausted);

    if (nextPage !== null) {
      cseHasMorePages = true;

      if (people.length === 0) {
        // 0 results → scrape synchronously (user expects to wait)
        console.log(`[Search] 0 results, scraping CSE page ${nextPage} synchronously`);
        const batch = await processRefreshBatch(input, nextPage, 'SyncScrape');
        cseCallsMade = 1;

        await updateScrapeProgress(progress.id, nextPage, batch.urlsFromCse, {
          cseCallsMade: 1,
          linkedinScraperCalls: batch.urlsScraped,
          apolloCallsMade: 0,
          profilesAdded: batch.newPeopleCount,
          profilesMatchedSearch: batch.matchedCount,
        });

        // Enrich newly scraped people before re-querying
        const enrichResult2 = await enrichPeopleOnDemand(filters, input.company);
        apolloCallsMade += enrichResult2.apolloCallsMade;

        // Re-query DB after scraping + enrichment added new people
        people = await findPeopleByFilters(filters);
        console.log(`[Search] After scrape+enrich: ${people.length} results`);
      }
      // 1+ results: return as-is, prescrape will populate DB in background
    }

    // ===== STEP 3: Rank candidates =====
    const searchCriteria: SearchCriteria = {
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    };

    const rankedPeople = rankCandidates(
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
    console.log(`[Search] Ranked top ${rankedPeople.length} candidates`);

    // ===== STEP 4: Build results with drafts =====
    const results = await buildResultsWithDrafts(rankedPeople, userId, input.templateId, user);

    // ===== STEP 5: Compute hasMore =====
    // Full page from DB means probably more rows; CSE having more pages
    // means prescrape will populate DB for future Load More clicks.
    const hasMore = people.length >= input.limit || cseHasMorePages;

    console.log(
      `[Search] Returning ${results.length} results (hasMore=${hasMore}, cseHasMore=${cseHasMorePages})`
    );

    // Log the search for analytics
    await prisma.searchLog.create({
      data: {
        userId,
        company: input.company || null,
        role: input.role || null,
        university: input.university || null,
        location: input.location || null,
        resultsCount: results.length,
        fromCache: false, // No longer using cache — kept for schema compatibility
      },
    });

    return {
      success: true,
      results,
      searchMeta: {
        hasMore,
        apolloCallsMade,
        apolloCacheHits,
        cseCallsMade,
      },
      remainingDaily,
    };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
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
    console.error('Error hiding person:', error);
    return { success: false, error: 'Failed to hide person' };
  }
}

// ===== LOAD MORE (pure DB read + enrichment, no scraping) =====

export interface LoadMoreInput {
  company: string;
  role?: string;
  university?: string;
  location?: string;
  name?: string;
  limit: number;
  templateId: string;
  excludePersonIds: string[];
}

export interface LoadMoreMeta {
  hasMore: boolean;
  prescrapeRunning: boolean;
}

export type LoadMoreActionResult = {
  success: true;
  results: SearchResultWithDraft[];
  loadMoreMeta: LoadMoreMeta;
} | {
  success: false;
  error: string;
};

/**
 * Load More action — pure DB read + on-demand enrichment.
 * No scraping, no Path A/B logic, no SearchLog creation.
 */
export async function loadMorePeopleAction(
  input: LoadMoreInput
): Promise<LoadMoreActionResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, university: true, classification: true, major: true, career: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Merge sent/hidden IDs with already-displayed IDs
    const excludedIds = await getExcludedPersonIds(userId);
    const allExcludedIds = [...excludedIds, ...input.excludePersonIds];

    const filters: PersonFilters = {
      company: input.company,
      location: input.location,
      role: input.role,
      university: input.university,
      requireEmail: true,
      excludePersonIds: allExcludedIds,
      limit: input.limit,
    };

    // Enrich people without emails before querying (patterns + Apollo)
    await enrichPeopleOnDemand(filters, input.company);

    // Pure DB read
    const people = await findPeopleByFilters(filters);
    console.log(`[LoadMore] Found ${people.length} people in DB`);

    // Rank candidates
    const searchCriteria: SearchCriteria = {
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    };

    const rankedPeople = rankCandidates(
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

    // Build results with drafts
    const results = await buildResultsWithDrafts(rankedPeople, userId, input.templateId, user);

    // Check prescrape status
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });
    const progress = await findOrCreateScrapeProgress(normalizedParams);
    const prescrapeRunning = progress.prescrapeStatus === 'RUNNING';

    // hasMore = got a full page (probably more in DB) OR prescrape still running (more may appear)
    const hasMore = people.length >= input.limit || prescrapeRunning;

    console.log(
      `[LoadMore] Returning ${results.length} results (hasMore=${hasMore}, prescrapeRunning=${prescrapeRunning})`
    );

    return {
      success: true,
      results,
      loadMoreMeta: { hasMore, prescrapeRunning },
    };
  } catch (error) {
    console.error('LoadMore error:', error);
    return { success: false, error: 'Failed to load more profiles.' };
  }
}

/**
 * Core refresh logic - processes a single batch of CSE results
 * Used by refreshSearchAction for both batch 1 (immediate) and batch 2 (background)
 */
async function processRefreshBatch(
  input: Omit<SearchInput, 'templateId' | 'limit'> & { limit?: number },
  pageStart: number,
  batchLabel: string
): Promise<{
  newPeopleCount: number;
  matchedCount: number;
  emailsGenerated: number;
  apolloCallsMade: number;
  savedPersonIds: string[];
  urlsScraped: number;
  urlsFromCse: number;  // How many URLs CSE returned (10 = likely more pages)
  csePrefiltered: number; // How many profiles skipped by CSE company pre-filter
}> {
  let newPeopleCount = 0;
  let matchedCount = 0;
  const savedPersonIds: string[] = [];

  // ===== STEP 1: CSE DISCOVERY =====
  console.log(`[Refresh ${batchLabel}] CSE Discovery for "${input.company}" (page ${pageStart})`);

  const cseResults = await discoverLinkedInProfiles({
    company: input.company,
    university: input.university,
    role: input.role,
    location: input.location,
    name: input.name,
    limit: 10,
    pageStart,
  });
  console.log(`[Refresh ${batchLabel}] CSE found ${cseResults.length} LinkedIn profiles`);

  if (cseResults.length === 0) {
    return { newPeopleCount: 0, matchedCount: 0, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds: [], urlsScraped: 0, urlsFromCse: 0, csePrefiltered: 0 };
  }

  // ===== STEP 2: CHECK DATABASE FOR EXISTING PEOPLE =====
  const linkedinUrls = cseResults.map((r) => r.linkedinUrl);
  const existingPeopleMap = await findPeopleByLinkedInUrls(linkedinUrls);
  console.log(`[Refresh ${batchLabel}] Found ${existingPeopleMap.size} existing people in database`);

  let urlsToScrape = linkedinUrls.filter((url) => !existingPeopleMap.has(url));

  // Double-check right before scraping to avoid duplicates from concurrent batch 2
  if (urlsToScrape.length > 0) {
    const recentlyAdded = await findPeopleByLinkedInUrls(urlsToScrape);
    if (recentlyAdded.size > 0) {
      console.log(`[Refresh ${batchLabel}] Filtered out ${recentlyAdded.size} recently added profiles`);
      urlsToScrape = urlsToScrape.filter((url) => !recentlyAdded.has(url));
    }
  }

  const cseResultMap = new Map(cseResults.map((r) => [r.linkedinUrl, r]));

  // ===== STEP 2.5: PRE-FILTER BY CSE COMPANY METATAG =====
  let csePrefiltered = 0;
  if (input.company) {
    const normalizedSearchCompany = normalizeCompanyForMatch(input.company);
    const beforeCount = urlsToScrape.length;
    urlsToScrape = urlsToScrape.filter((url) => {
      const cseResult = cseResultMap.get(url);
      if (!cseResult?.cseCompany) return true; // Keep if no metatag (conservative)
      const normalizedCseCompany = normalizeCompanyForMatch(cseResult.cseCompany);
      const matches = companiesMatch(normalizedCseCompany, normalizedSearchCompany);
      if (!matches) {
        console.log(`[Refresh ${batchLabel}] Pre-filtered: "${cseResult.cseFirstName} ${cseResult.cseLastName}" — CSE company "${cseResult.cseCompany}" doesn't match "${input.company}"`);
      }
      return matches;
    });
    csePrefiltered = beforeCount - urlsToScrape.length;
    if (csePrefiltered > 0) {
      console.log(`[Refresh ${batchLabel}] Pre-filtered ${csePrefiltered}/${beforeCount} profiles by CSE company mismatch`);
    }
  }

  console.log(`[Refresh ${batchLabel}] Need to scrape ${urlsToScrape.length} new profiles`);

  // ===== STEP 3: SCRAPE NEW LINKEDIN PROFILES =====
  if (urlsToScrape.length > 0) {
    const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
      console.log(`[Refresh ${batchLabel}] Processing scrape batch ${batchIndex + 1}/${totalBatches} (${profiles.length} profiles)`);

      for (const profile of profiles) {
        const cseResult = cseResultMap.get(profile.linkedinUrl);
        if (!cseResult) continue;

        const { personId, isNew } = await saveScrapedProfile(
          profile,
          cseResult.linkedinUrl,
          cseResult.sourceTitle,
          cseResult.sourceSnippet,
          cseResult.sourceDomain,
          input.company!,
          input.university
        );

        savedPersonIds.push(personId);
        if (isNew) {
          newPeopleCount++;
          // Check if this profile matches the user's full search criteria
          const companyMatch = !input.company || companiesMatch(
            normalizeCompanyForMatch(profile.company || ''),
            normalizeCompanyForMatch(input.company)
          );
          const roleMatch = !input.role || (profile.role || '').toLowerCase().includes(input.role.toLowerCase());
          const uniMatch = !input.university || (profile.schools || []).some(
            (s) => s.toLowerCase().includes(input.university!.toLowerCase())
          );
          const locMatch = !input.location || [profile.city, profile.state, profile.country]
            .filter(Boolean).some((v) => v!.toLowerCase().includes(input.location!.toLowerCase()));
          if (companyMatch && roleMatch && uniMatch && locMatch) matchedCount++;
        }
      }

      console.log(`[Refresh ${batchLabel}] Saved ${profiles.length} profiles`);
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });
  }

  // Email enrichment is now handled on-demand in searchPeopleAction via enrichPeopleOnDemand()
  return { newPeopleCount, matchedCount, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds, urlsScraped: urlsToScrape.length, urlsFromCse: cseResults.length, csePrefiltered };
}

const MAX_PRESCRAPE_PAGES = 4;

/**
 * Background prescrape: scrape all remaining CSE pages (up to 4 total) for a search.
 * Fire-and-forget from the frontend — populates the Person table so future
 * Load More clicks are instant DB reads.
 */
export async function prescrapeAction(
  input: {
    company: string;
    role?: string;
    university?: string;
    location?: string;
    name?: string;
  }
): Promise<{ success: true; pagesScraped: number } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    let pagesScraped = 0;

    // Bail out if a prescrape is already running for these params
    const initialProgress = await findOrCreateScrapeProgress(normalizedParams);
    if (initialProgress.prescrapeStatus === 'RUNNING') {
      console.log(`[Prescrape] Already running for "${input.company}", skipping`);
      return { success: true, pagesScraped: 0 };
    }

    await prisma.search.update({
      where: { id: initialProgress.id },
      data: { prescrapeStatus: 'RUNNING' },
    });

    while (pagesScraped < MAX_PRESCRAPE_PAGES) {
      // Re-fetch progress each iteration (updated by previous iteration)
      const progress = await findOrCreateScrapeProgress(normalizedParams);
      const nextPage = getNextCsePageStart(progress.lastCsePageScraped, progress.cseExhausted);

      if (nextPage === null) {
        console.log(`[Prescrape] CSE exhausted after ${pagesScraped} pages for "${input.company}"`);
        break;
      }

      console.log(`[Prescrape] Scraping CSE page ${nextPage} for "${input.company}" (${pagesScraped + 1}/${MAX_PRESCRAPE_PAGES})`);
      const batch = await processRefreshBatch(input, nextPage, `Prescrape-${pagesScraped + 1}`);

      await updateScrapeProgress(progress.id, nextPage, batch.urlsFromCse, {
        cseCallsMade: 1,
        linkedinScraperCalls: batch.urlsScraped,
        apolloCallsMade: batch.apolloCallsMade,
        profilesAdded: batch.newPeopleCount,
        profilesMatchedSearch: batch.matchedCount,
      });

      pagesScraped++;

      // CSE returned fewer than threshold — no more pages
      if (batch.urlsFromCse < 5) {
        console.log(`[Prescrape] CSE exhausted (${batch.urlsFromCse} URLs) after ${pagesScraped} pages`);
        break;
      }
    }

    // Mark prescrape as done
    await prisma.search.update({
      where: { id: initialProgress.id },
      data: { prescrapeStatus: 'DONE' },
    });

    console.log(`[Prescrape] Done: scraped ${pagesScraped} pages for "${input.company}"`);
    return { success: true, pagesScraped };
  } catch (error) {
    console.error('Prescrape error:', error);
    // Mark as DONE even on error to prevent permanently stuck RUNNING state
    try {
      const progress = await findOrCreateScrapeProgress(normalizeSearchParams({
        name: input.name,
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      }));
      await prisma.search.update({
        where: { id: progress.id },
        data: { prescrapeStatus: 'DONE' },
      });
    } catch (e) {
      console.error('Failed to mark prescrape as DONE after error:', e);
    }
    return { success: false, error: 'Prescraping failed.' };
  }
}

// ===== PERSON LOOKUP (by name) =====

export interface LookupInput {
  name: string;
  company?: string;
  templateId: string;
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
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.name || input.name.trim().length < 2) {
    return { success: false, error: 'Name must be at least 2 characters' };
  }

  try {
    const userId = session.user.id;

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
    let csePeople: PersonResult[] = [];
    const dbHasEnough = dbPeople.filter((p) => p.email).length >= 3;

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

        for (const cseResult of cseResults) {
          if (dbLinkedInUrls.has(cseResult.linkedinUrl)) continue; // Already in DB results

          const existing = existingMap.get(cseResult.linkedinUrl);
          if (existing) {
            // Already in DB but wasn't found by name search — add it
            csePeople.push({
              ...existing,
              emailDeliverable: null,
              emailVerifiedAt: null,
              emailVerificationReason: null,
            });
            dbLinkedInUrls.add(cseResult.linkedinUrl);
          } else {
            // New person — save to DB
            const { personId } = await saveScrapedProfile(
              {
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
                schools: [],
                educationSchool: null,
              },
              cseResult.linkedinUrl,
              cseResult.sourceTitle,
              cseResult.sourceSnippet,
              cseResult.sourceDomain,
              input.company || cseResult.cseCompany || '',
              undefined
            );

            // Fetch the saved record to get the full PersonResult shape
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

    // ===== STEP 4: Enrich people without emails =====
    for (const person of top) {
      if (person.email || !person.firstName || !person.lastName) continue;

      // Try pattern first
      const companyKey = getCompanyKey(normalizeCompanyForMatch(person.company));
      let pattern = companyKey ? await getCompanyPattern(companyKey) : null;
      if (!pattern) pattern = await getCompanyPattern(person.company);

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
        console.log(`[Lookup] Pattern → ${person.fullName} → ${generatedEmail}`);
        continue;
      }

      // Apollo fallback
      const result = await findEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        linkedinUrl: person.linkedinUrl,
      });

      await prisma.person.update({
        where: { id: person.id },
        data: {
          email: result.email,
          emailStatus: result.email ? result.status : 'MISSING',
          emailConfidence: result.confidence,
          emailDeliverable: result.emailDeliverable,
          apolloEnrichedAt: new Date(),
          apolloStatus: result.apolloStatus === 'SUCCESS' || result.apolloStatus === 'NOT_FOUND'
            ? result.apolloStatus : 'API_ERROR',
          ...(result.city && { city: result.city }),
          ...(result.state && { state: result.state }),
          ...(result.country && { country: result.country }),
          ...(result.education?.schoolName && { educationSchool: result.education.schoolName }),
          ...(result.employment?.title && { role: result.employment.title }),
        },
      });

      if (result.email) {
        person.email = result.email;
        person.emailStatus = result.status;
        person.emailConfidence = result.confidence;
        person.emailDeliverable = result.emailDeliverable;
      }
      if (result.city) person.city = result.city;
      if (result.state) person.state = result.state;
      if (result.education?.schoolName) person.educationSchool = result.education.schoolName;
      if (result.employment?.title) person.role = result.employment.title;

      console.log(`[Lookup] Apollo → ${person.fullName} → ${result.email || 'no email'}`);
      await new Promise((r) => setTimeout(r, 300)); // Rate limit
    }

    // ===== STEP 5: Build results with drafts =====
    // Wrap in the format buildResultsWithDrafts expects
    const ranked = top.map((person) => ({
      candidate: person as PersonWithSource,
      score: 100,
      breakdown: {} as ScoreBreakdown,
    }));

    const results = await buildResultsWithDrafts(ranked, userId, input.templateId, user);

    console.log(`[Lookup] Returning ${results.length} results for "${cleanName}"`);
    return { success: true, results };
  } catch (error) {
    console.error('Lookup error:', error);
    return { success: false, error: 'Lookup failed. Please try again.' };
  }
}
