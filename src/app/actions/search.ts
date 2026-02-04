'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discoverLinkedInProfiles } from '@/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import {
  getExcludedPersonKeys,
  findPeopleByFilters,
  findPeopleByLinkedInUrls,
  saveScrapedProfile,
  getEmailStatus,
  PersonFilters
} from '@/lib/db/person-service';
import {
  normalizeSearchParams,
  findCachedSearch,
  findExistingSearch,
  getCachedPersonIds,
  createSearchWithPeople,
  updateSearchWithPeople,
  getStalePersonIds,
  getPersonsByIds,
  ApiUsageStats,
} from '@/lib/db/search-cache';
import {
  getOrLearnPattern,
  generateEmailFromPattern,
  normalizeCompanyName,
  bootstrapCompanyPattern,
} from '@/lib/services/email-pattern';
import { verifyEmailsBatch } from '@/lib/services/email-verification';

export interface SearchInput {
  name?: string;
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  limit: number;
  templateId: string;
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
  fromCache: boolean;
  needsRefresh: boolean;
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
  user: { name: string | null; university: string | null }
): { subject: string; body: string } {
  const template = EMAIL_TEMPLATES.find((t) => t.id === templateId) || EMAIL_TEMPLATES[0];

  // Replace placeholders
  let subject: string = template.subject;
  let body: string = template.body;

  const replacements: Record<string, string> = {
    '{{firstName}}': person.firstName || 'there',
    '{{company}}': person.company,
    '{{role}}': person.role || 'your role',
    '{{yourName}}': user.name || 'A student',
    '{{university}}': user.university || 'my university',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replace(new RegExp(placeholder, 'g'), value);
    body = body.replace(new RegExp(placeholder, 'g'), value);
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
 * Main search action - returns instant results from cache/DB
 * If cache miss, returns what we have and signals frontend to call refreshSearchAction
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
    const excludedKeys = await getExcludedPersonKeys(userId);
    console.log(`[Search] User has ${excludedKeys.size} excluded people (sent/hidden).`);

    // Check cache first
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    const cachedSearch = await findCachedSearch(normalizedParams);

    let people: PersonWithSource[] = [];
    let needsRefresh = false;
    let apolloCallsMade = 0;
    let apolloCacheHits = 0;
    let cseCallsMade = 0;

    if (cachedSearch) {
      // Cache hit - get people from cache
      console.log(`[Search] CACHE HIT - search ${cachedSearch.id} from ${cachedSearch.createdAt}`);

      const cachedPersonIds = await getCachedPersonIds(cachedSearch.id);
      console.log(`[Search] Found ${cachedPersonIds.length} cached people`);

      if (cachedPersonIds.length > 0) {
        people = await getPersonsByIds(cachedPersonIds);
        console.log(`[Search] Retrieved ${people.length} people from cache`);
      }

      // Check for stale person data that needs refresh
      const staleIds = await getStalePersonIds(cachedPersonIds);
      if (staleIds.length > 0) {
        console.log(`[Search] ${staleIds.length} people have stale data (>20 days old)`);
        needsRefresh = true;
      }
    } else {
      // Cache miss - query DB for matching people
      console.log(`[Search] CACHE MISS - querying database`);

      const filters: PersonFilters = {
        company: input.company,
        location: input.location,
        role: input.role,
        university: input.university,
        requireEmail: true,
        excludePersonKeys: excludedKeys,
        limit: input.limit,
      };

      people = await findPeopleByFilters(filters);
      console.log(`[Search] Found ${people.length} people in database`);

      // Only need refresh if we don't have enough results
      if (people.length < input.limit) {
        needsRefresh = true;
        console.log(`[Search] Need refresh - only ${people.length}/${input.limit} results`);
      }

      cseCallsMade = 0; // No CSE calls in instant search
    }

    // Filter out excluded people and those without emails
    const filteredPeople = people.filter((person) => {
      const key = `${person.fullName}_${person.company}`.toLowerCase();
      // Must have email and not be excluded
      return person.email && !excludedKeys.has(key);
    });

    console.log(`[Search] ${filteredPeople.length} people after filtering (with emails)`);

    // Rank candidates
    const searchCriteria: SearchCriteria = {
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    };

    // Pass filteredPeople directly to rankCandidates with a getData function
    const rankedPeople = rankCandidates(
      searchCriteria,
      filteredPeople,
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

    // Build results with drafts
    const results = await Promise.all(
      rankedPeople.map(async ({ candidate: person, score, breakdown }) => {

        // Get or create UserCandidate
        const userCandidate = await prisma.userCandidate.upsert({
          where: {
            userId_personId: {
              userId,
              personId: person.id,
            },
          },
          create: {
            userId,
            personId: person.id,
            email: person.email,
            emailStatus: (person.emailStatus as any) || 'MISSING',
            emailConfidence: person.emailConfidence,
          },
          update: {},
          select: {
            id: true,
          },
        });

        // Generate draft
        const draft = generateEmailDraft(
          input.templateId,
          {
            firstName: person.firstName,
            company: person.company,
            role: person.role,
          },
          { name: user.name, university: user.university }
        );

        // Get or create EmailDraft
        // Only set templateId FK for user-created templates, not hardcoded ones
        const isHardcodedTemplate = EMAIL_TEMPLATES.some(t => t.id === input.templateId);
        const emailDraft = await prisma.emailDraft.upsert({
          where: {
            userCandidateId: userCandidate.id,
          },
          create: {
            userCandidateId: userCandidate.id,
            templateId: isHardcodedTemplate ? null : input.templateId,
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

    // Count verified vs unverified
    const verifiedCount = results.filter(
      (r) => r.emailStatus === 'VERIFIED' || r.emailDeliverable === true
    ).length;
    const unverifiedCount = results.filter(
      (r) => r.emailStatus === 'UNVERIFIED' && r.emailDeliverable !== true
    ).length;

    console.log(
      `[Search] Returning ${results.length} results: ${verifiedCount} verified, ${unverifiedCount} unverified (needsRefresh: ${needsRefresh})`
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
        fromCache: !!cachedSearch,
      },
    });

    return {
      success: true,
      results,
      searchMeta: {
        fromCache: !!cachedSearch,
        needsRefresh,
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
      where: { id: userCandidateId },
      data: { doNotShow: true },
    });

    console.log(`[Hide] User ${session.user.id} marked userCandidate ${userCandidateId} as doNotShow`);
    return { success: true };
  } catch (error) {
    console.error('Error hiding person:', error);
    return { success: false, error: 'Failed to hide person' };
  }
}

/**
 * Core refresh logic - processes a single batch of CSE results
 * Used by refreshSearchAction for both batch 1 (immediate) and batch 2 (background)
 */
async function processRefreshBatch(
  input: Omit<SearchInput, 'templateId' | 'limit'> & { limit?: number },
  excludedKeys: Set<string>,
  pageStart: number,
  batchLabel: string
): Promise<{
  newPeopleCount: number;
  emailsGenerated: number;
  apolloCallsMade: number;
  savedPersonIds: string[];
  urlsScraped: number;
  urlsFromCse: number;  // How many URLs CSE returned (10 = likely more pages)
}> {
  let newPeopleCount = 0;
  let emailsGenerated = 0;
  let apolloCallsMade = 0;
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
    return { newPeopleCount: 0, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds: [], urlsScraped: 0, urlsFromCse: 0 };
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
        if (isNew) newPeopleCount++;
      }

      console.log(`[Refresh ${batchLabel}] Saved ${profiles.length} profiles`);
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });
  }

  // ===== STEP 4: GENERATE EMAILS (Pattern + Apollo Bootstrap) =====
  console.log(`[Refresh ${batchLabel}] Generating emails for ${savedPersonIds.length} people`);

  // Get all people without emails
  const peopleWithoutEmails = await prisma.person.findMany({
    where: {
      id: { in: savedPersonIds },
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, company: true, linkedinUrl: true },
  });

  // Group by company
  const byCompany = new Map<string, typeof peopleWithoutEmails>();
  for (const person of peopleWithoutEmails) {
    const normalized = normalizeCompanyName(person.company);
    if (!byCompany.has(normalized)) {
      byCompany.set(normalized, []);
    }
    byCompany.get(normalized)!.push(person);
  }

  console.log(`[Refresh ${batchLabel}] ${peopleWithoutEmails.length} people without emails across ${byCompany.size} companies`);

  // Process each company
  for (const [, people] of Array.from(byCompany)) {
    const company = people[0].company;

    // Check if pattern exists
    let pattern = await getOrLearnPattern(company);

    // If no pattern, try to bootstrap with Apollo
    if (!pattern) {
      console.log(`[Refresh ${batchLabel}] No pattern for "${company}" - bootstrapping with Apollo`);
      const bootstrapResult = await bootstrapCompanyPattern(company, people);

      apolloCallsMade += bootstrapResult.apolloCallsMade;
      emailsGenerated += bootstrapResult.emailsFound;

      if (bootstrapResult.success && bootstrapResult.pattern && bootstrapResult.domain) {
        pattern = {
          pattern: bootstrapResult.pattern,
          domain: bootstrapResult.domain,
          confidence: bootstrapResult.confidence,
        };

        console.log(
          `[Refresh ${batchLabel}] Bootstrapped pattern for "${company}": ${pattern.pattern}@${pattern.domain} ` +
            `(${bootstrapResult.apolloCallsMade} Apollo calls, ${bootstrapResult.emailsFound} emails)`
        );
      } else {
        console.log(
          `[Refresh ${batchLabel}] Could not bootstrap pattern for "${company}" (${bootstrapResult.apolloCallsMade} Apollo calls, ${bootstrapResult.emailsFound} emails found)`
        );
        continue;
      }
    }

    // Generate emails for remaining people
    const remainingPeople = await prisma.person.findMany({
      where: {
        id: { in: people.map((p) => p.id) },
        email: null,
        firstName: { not: null },
        lastName: { not: null },
      },
      select: { id: true, firstName: true, lastName: true },
    });

    // Generate all emails first
    const emailsToVerify: Array<{ personId: string; email: string }> = [];
    for (const person of remainingPeople) {
      const generatedEmail = generateEmailFromPattern(
        person.firstName!,
        person.lastName!,
        pattern.pattern as any,
        pattern.domain
      );
      emailsToVerify.push({ personId: person.id, email: generatedEmail });
    }

    // Verify emails with Emailable
    if (emailsToVerify.length > 0) {
      const verificationResults = await verifyEmailsBatch(emailsToVerify.map((e) => e.email));

      let verifiedCount = 0;
      let undeliverableCount = 0;
      for (let i = 0; i < emailsToVerify.length; i++) {
        const { personId, email } = emailsToVerify[i];
        const verification = verificationResults[i];

        if (verification.deliverable) {
          await prisma.person.update({
            where: { id: personId },
            data: {
              email,
              emailStatus: 'UNVERIFIED',
              emailConfidence: Math.round(pattern.confidence * 100),
              emailDeliverable: true,
              emailVerifiedAt: new Date(),
              emailVerificationReason: verification.reason,
            },
          });
          emailsGenerated++;
          verifiedCount++;
        } else {
          undeliverableCount++;
        }
      }

      console.log(`[Refresh ${batchLabel}] Pattern emails for "${company}": ${verifiedCount} verified, ${undeliverableCount} undeliverable`);
    }
  }

  return { newPeopleCount, emailsGenerated, apolloCallsMade, savedPersonIds, urlsScraped: urlsToScrape.length, urlsFromCse: cseResults.length };
}

/**
 * Refresh search action - runs CSE + LinkedIn scraping for a single page
 *
 * Called on initial search (page 1) and on-demand via "Load More" (page 2, 3, etc.)
 */
export async function refreshSearchAction(
  input: Omit<SearchInput, 'templateId' | 'limit'> & {
    limit?: number;
    pageStart?: number;  // Defaults to 1. For page 2, pass 11; page 3, pass 21, etc.
  }
): Promise<{
  success: true;
  newPeopleCount: number;
  emailsGenerated: number;
  apolloCallsMade: number;
  matchingCount: number;
  hasMore: boolean;  // true if CSE returned 10 results (more pages likely available)
} | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const excludedKeys = await getExcludedPersonKeys(session.user.id);
    const pageStart = input.pageStart ?? 1;

    // ===== PROCESS SINGLE PAGE =====
    console.log(`[Refresh] Processing page starting at ${pageStart}`);
    const batch = await processRefreshBatch(input, excludedKeys, pageStart, `Page${pageStart}`);
    console.log(`[Refresh] Complete: ${batch.newPeopleCount} new, ${batch.emailsGenerated} emails`);

    // ===== COUNT MATCHING PEOPLE =====
    const filters: PersonFilters = {
      company: input.company,
      location: input.location,
      university: input.university,
      requireEmail: false,
      excludePersonKeys: excludedKeys,
      limit: 100,
    };

    const matchingPeople = await findPeopleByFilters(filters);

    // ===== UPDATE CACHE =====
    if (matchingPeople.length > 0) {
      const normalizedParams = normalizeSearchParams({
        name: input.name,
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      });

      const personIds = matchingPeople.map((p) => p.id);
      const apiStats: ApiUsageStats = {
        apolloCallsMade: batch.apolloCallsMade,
        apolloCacheHits: 0,
        cseCallsMade: 1,
        linkedinScraperCalls: batch.urlsScraped,
      };

      const existingSearch = await findExistingSearch(normalizedParams);
      if (existingSearch) {
        await updateSearchWithPeople(existingSearch.id, personIds, apiStats);
      } else {
        await createSearchWithPeople(normalizedParams, personIds, apiStats);
      }
    }

    // CSE returns 10 results per page; if we got 10, there are likely more pages
    const hasMore = batch.urlsFromCse === 10;

    return {
      success: true,
      newPeopleCount: batch.newPeopleCount,
      emailsGenerated: batch.emailsGenerated,
      apolloCallsMade: batch.apolloCallsMade,
      matchingCount: matchingPeople.length,
      hasMore,
    };
  } catch (error) {
    console.error('Refresh search error:', error);
    return { success: false, error: 'Refresh failed. Please try again.' };
  }
}
