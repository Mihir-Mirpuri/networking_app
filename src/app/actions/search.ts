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
  findStaleSearch,
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
} from '@/lib/services/email-pattern';

export interface SearchInput {
  name?: string;
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  limit: number;
  templateId: string;
}

export interface EducationInfo {
  schoolName: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  graduationYear: string | null;
}

export interface SearchResultWithDraft {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  university: string;
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  emailConfidence: number;
  emailSource: 'cache' | 'apollo' | 'none';
  draftSubject: string;
  draftBody: string;
  sourceUrl: string;
  linkedinUrl: string | null;
  userCandidateId?: string;
  emailDraftId?: string;
  resumeId?: string | null;
  personId?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  education?: EducationInfo | null;
  rankingScore?: number;
  rankingBreakdown?: ScoreBreakdown;
}

interface UserProfileData {
  name: string | null;
  classification: string | null;
  major: string | null;
  university: string | null;
  career: string | null;
}

function generateDraft(
  template: { subject: string; body: string },
  person: { firstName: string | null; company: string },
  searchUniversity: string,
  role: string,
  userProfile: UserProfileData
): { subject: string; body: string } {
  const firstName = person.firstName || 'there';
  const userName = userProfile.name || 'Your Name';
  const classification = userProfile.classification || 'student';
  const major = userProfile.major || 'degree';
  const university = userProfile.university || searchUniversity;
  const career = userProfile.career || role;

  const replacePlaceholders = (text: string) =>
    text
      .replace(/{first_name}/g, firstName)
      .replace(/{user_name}/g, userName)
      .replace(/{company}/g, person.company)
      .replace(/{university}/g, university)
      .replace(/{classification}/g, classification)
      .replace(/{major}/g, major)
      .replace(/{career}/g, career)
      .replace(/{role}/g, role);

  return {
    subject: replacePlaceholders(template.subject),
    body: replacePlaceholders(template.body),
  };
}

// Helper function for controlled concurrency
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Re-scrape stale people with fresh LinkedIn data
 * Called when cached people have data older than 20 days
 * (Email bounce detection to be implemented later by user)
 */
async function reScrapeStalePeople(personIds: string[]): Promise<void> {
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, linkedinUrl: true },
  });

  // Only re-scrape people with LinkedIn URLs
  const urlsToScrape = people
    .filter(p => p.linkedinUrl)
    .map(p => p.linkedinUrl as string);

  if (urlsToScrape.length === 0) return;

  console.log(`[Search] Re-scraping ${urlsToScrape.length} stale profiles`);
  const scrapedProfiles = await scrapeLinkedInProfiles(urlsToScrape);

  // Create a map for quick lookup
  const profileMap = new Map<string, ScrapedProfile>();
  for (const profile of scrapedProfiles) {
    profileMap.set(profile.linkedinUrl, profile);
  }

  // Update each person with fresh data
  for (const person of people) {
    if (!person.linkedinUrl) continue;
    const profile = profileMap.get(person.linkedinUrl);
    if (!profile) continue;

    await prisma.person.update({
      where: { id: person.id },
      data: {
        fullName: profile.fullName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        company: profile.company || undefined,
        role: profile.role,
        email: profile.email,
        emailStatus: getEmailStatus(profile.email),
        emailConfidence: profile.email ? 50 : 0,
        city: profile.city,
        state: profile.state,
        country: profile.country,
        schools: profile.schools.length > 0 ? profile.schools : undefined,
        educationSchool: profile.educationSchool,
        scrapedAt: new Date(),
      },
    });
  }
}

/**
 * Search response with metadata about search state
 */
export interface SearchResponse {
  success: true;
  results: SearchResultWithDraft[];
  searchMeta: {
    isComplete: boolean;      // true if search is complete (cached or no more to find)
    isCached: boolean;        // true if results came from cache
    totalInDb: number;        // total matching people in DB before limit
    needsRefresh: boolean;    // true if frontend should call refreshSearchAction
  };
}

/**
 * Main search action - Instant DB-First Approach
 *
 * Flow:
 * 1. Check cache → if hit, return cached results instantly
 * 2. If miss, query DB for any existing matches → return instantly
 * 3. Set needsRefresh=true so frontend can trigger background scraping
 *
 * This provides instant feedback to users while allowing background population.
 */
export async function searchPeopleAction(
  input: SearchInput
): Promise<SearchResponse | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate required input
  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  // Get template
  let template: { subject: string; body: string; id: string; attachResume: boolean; resumeId: string | null } | null = null;
  let templateId: string | null = null;

  try {
    const dbTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: session.user.id,
        OR: [
          { id: input.templateId },
          { isDefault: true },
        ],
      },
      select: {
        id: true,
        prompt: true,
        attachResume: true,
        resumeId: true,
      },
    });

    if (dbTemplate) {
      try {
        const parsed = JSON.parse(dbTemplate.prompt);
        template = {
          id: dbTemplate.id,
          subject: parsed.subject || '',
          body: parsed.body || dbTemplate.prompt,
          attachResume: dbTemplate.attachResume,
          resumeId: dbTemplate.resumeId,
        };
        templateId = dbTemplate.id;
      } catch {
        template = {
          id: dbTemplate.id,
          subject: `Reaching out from ${input.university}`,
          body: dbTemplate.prompt,
          attachResume: dbTemplate.attachResume,
          resumeId: dbTemplate.resumeId,
        };
        templateId = dbTemplate.id;
      }
    }
  } catch (error) {
    console.error('Error fetching template from database:', error);
  }

  // Fallback to constants if no database template found
  if (!template) {
    const constTemplate = EMAIL_TEMPLATES.find((t) => t.id === input.templateId);
    if (!constTemplate) {
      return { success: false, error: 'Invalid template' };
    }
    template = {
      id: constTemplate.id,
      subject: constTemplate.subject,
      body: constTemplate.body,
      attachResume: false,
      resumeId: null,
    };
    templateId = null;
  }

  try {
    // Fetch user profile and excluded keys in parallel
    const [userProfile, excludedKeys] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          name: true,
          classification: true,
          major: true,
          university: true,
          career: true,
        },
      }),
      getExcludedPersonKeys(session.user.id),
    ]);
    console.log(`[Search] User has ${excludedKeys.size} excluded people (sent/hidden).`);

    // Determine resume to attach
    let resumeIdToAttach: string | null = null;
    let shouldAttachResume = false;

    if (template.attachResume) {
      shouldAttachResume = true;
      if (template.resumeId) {
        resumeIdToAttach = template.resumeId;
      } else {
        const activeResume = await prisma.userResume.findFirst({
          where: { userId: session.user.id, isActive: true },
          select: { id: true },
        });
        if (activeResume) {
          resumeIdToAttach = activeResume.id;
        }
      }
    }

    // ===== CACHE CHECK =====
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    const cachedSearch = await findCachedSearch(normalizedParams);
    let matchingPeople: Awaited<ReturnType<typeof findPeopleByFilters>> | Awaited<ReturnType<typeof getPersonsByIds>>;

    if (cachedSearch) {
      // ===== CACHE HIT =====
      console.log(`[Search] CACHE HIT - search ${cachedSearch.id} from ${cachedSearch.createdAt}`);

      // Get cached person IDs
      const cachedPersonIds = await getCachedPersonIds(cachedSearch.id);
      console.log(`[Search] Found ${cachedPersonIds.length} cached people`);

      // Check for stale data (>20 days old)
      // Note: Email bounce detection to be implemented by user later
      const stalePersonIds = await getStalePersonIds(cachedPersonIds);

      if (stalePersonIds.length > 0) {
        console.log(`[Search] Re-scraping ${stalePersonIds.length} stale people`);
        await reScrapeStalePeople(stalePersonIds);
      }

      // Fetch fresh person data
      matchingPeople = await getPersonsByIds(cachedPersonIds);
      console.log(`[Search] Retrieved ${matchingPeople.length} people from cache`);
    } else {
      // ===== CACHE MISS - Query DB for existing matches, return immediately =====
      console.log('[Search] CACHE MISS - querying DB for existing matches');

      const filters: PersonFilters = {
        company: input.company,
        location: input.location,
        university: input.university,
        requireEmail: false,
        excludePersonKeys: excludedKeys,
        limit: input.limit * 3,
      };

      matchingPeople = await findPeopleByFilters(filters);
      console.log(`[Search] DB query returned ${matchingPeople.length} existing matches`);

    }

    // Track whether we need a refresh (cache miss means we should search for more)
    const needsRefresh = !cachedSearch;
    const isCached = !!cachedSearch;

    // ===== FILTER AND RANK RESULTS =====
    const filteredPeople = matchingPeople.filter(person => {
      const personKey = `${person.fullName}_${person.company}`.toLowerCase();
      return !excludedKeys.has(personKey);
    });

    const totalInDb = filteredPeople.length;

    if (filteredPeople.length === 0) {
      console.log('[Search] No matching people in DB');
      return {
        success: true,
        results: [],
        searchMeta: {
          isComplete: isCached,
          isCached,
          totalInDb: 0,
          needsRefresh,
        },
      };
    }

    console.log(`[Search] ${filteredPeople.length} people after filtering`);

    const searchCriteria: SearchCriteria = {
      company: input.company,
      role: input.role,
      location: input.location,
      university: input.university,
    };

    const rankedPeople = rankCandidates(
      searchCriteria,
      filteredPeople,
      (person): CandidateData => ({
        company: person.company,
        role: person.role,
        city: person.city,
        state: person.state,
        country: person.country,
        educationSchool: person.educationSchool,
        email: person.email,
        emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
      }),
      input.limit
    );

    console.log(`[Search] Ranked top ${rankedPeople.length} candidates`);

    // ===== STEP 5: CREATE USER CANDIDATES & DRAFTS =====
    // Process all in parallel - these are simple upserts
    const results = await Promise.all(
      rankedPeople.map(
      async ({ candidate: person, score, breakdown }): Promise<SearchResultWithDraft> => {
        const placeholderDraft = generateDraft(
          template,
          { firstName: person.firstName, company: person.company },
          input.university || '',
          input.role || '',
          userProfile || { name: null, classification: null, major: null, university: null, career: null }
        );

        // Create or update UserCandidate
        const userCandidate = await prisma.userCandidate.upsert({
          where: {
            userId_personId: {
              userId: session.user.id,
              personId: person.id,
            },
          },
          create: {
            userId: session.user.id,
            personId: person.id,
            email: person.email,
            emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
            emailConfidence: person.emailConfidence,
            university: input.university || null,
          },
          update: {
            email: person.email || undefined,
            emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || undefined,
            emailConfidence: person.emailConfidence || undefined,
            university: input.university || undefined,
          },
        });

        // Create or update EmailDraft
        const emailDraft = await prisma.emailDraft.upsert({
          where: { userCandidateId: userCandidate.id },
          create: {
            userCandidateId: userCandidate.id,
            templateId: templateId,
            subject: placeholderDraft.subject,
            body: placeholderDraft.body,
            attachResume: shouldAttachResume,
            resumeId: resumeIdToAttach,
            status: 'APPROVED',
          },
          update: {
            subject: placeholderDraft.subject,
            body: placeholderDraft.body,
            templateId: templateId || undefined,
            attachResume: shouldAttachResume,
            resumeId: resumeIdToAttach,
            status: 'APPROVED',
          },
        });

        const sourceLink = person.sourceLinks[0];
        const sourceUrl = sourceLink?.url || '';

        return {
          id: userCandidate.id,
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          company: person.company,
          role: person.role,
          university: input.university || '',
          email: person.email,
          emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
          emailConfidence: person.emailConfidence || 0,
          emailSource: 'cache',
          draftSubject: placeholderDraft.subject,
          draftBody: placeholderDraft.body,
          sourceUrl,
          linkedinUrl: person.linkedinUrl,
          userCandidateId: userCandidate.id,
          emailDraftId: emailDraft.id,
          resumeId: shouldAttachResume ? resumeIdToAttach : null,
          personId: person.id,
          city: person.city,
          state: person.state,
          country: person.country,
          education: person.educationSchool ? {
            schoolName: person.educationSchool,
            degree: person.educationDegree,
            fieldOfStudy: person.educationField,
            graduationYear: person.educationYear,
          } : null,
          rankingScore: score,
          rankingBreakdown: breakdown,
        };
      })
    );

    // Log final results
    const verifiedCount = results.filter((r) => r.emailStatus === 'VERIFIED').length;
    const unverifiedCount = results.filter((r) => r.emailStatus === 'UNVERIFIED').length;

    console.log(
      `[Search] Returning ${results.length} results: ${verifiedCount} verified, ${unverifiedCount} unverified (needsRefresh: ${needsRefresh})`
    );

    return {
      success: true,
      results,
      searchMeta: {
        isComplete: !needsRefresh,
        isCached,
        totalInDb,
        needsRefresh,
      },
    };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
  }
}

/**
 * Server action to mark a person as "do not show again"
 */
export async function hidePersonAction(
  userCandidateId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userCandidate = await prisma.userCandidate.findUnique({
      where: { id: userCandidateId },
      select: { userId: true },
    });

    if (!userCandidate) {
      return { success: false, error: 'Person not found' };
    }

    if (userCandidate.userId !== session.user.id) {
      return { success: false, error: 'Unauthorized' };
    }

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
 * Refresh search action - runs CSE + LinkedIn scraping
 *
 * Call this after searchPeopleAction returns needsRefresh: true
 * to populate more results via CSE discovery and LinkedIn scraping.
 *
 * Returns new results found (can be combined with initial results)
 */
export async function refreshSearchAction(
  input: Omit<SearchInput, 'templateId' | 'limit'> & { limit?: number }
): Promise<{
  success: true;
  newPeopleCount: number;
  emailsGenerated: number;
  matchingCount: number;
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

    // ===== STEP 1: CSE DISCOVERY =====
    const CSE_LIMIT = input.limit || 20;
    console.log(`[Refresh] CSE Discovery for "${input.company}" + "${input.university || 'any'}"`);

    const cseResults = await discoverLinkedInProfiles({
      company: input.company,
      university: input.university,
      role: input.role,
      location: input.location,
      name: input.name,
      limit: CSE_LIMIT,
    });
    console.log(`[Refresh] CSE found ${cseResults.length} LinkedIn profiles`);

    if (cseResults.length === 0) {
      return { success: true, newPeopleCount: 0, emailsGenerated: 0, matchingCount: 0 };
    }

    // ===== STEP 2: CHECK DATABASE FOR EXISTING PEOPLE =====
    const linkedinUrls = cseResults.map(r => r.linkedinUrl);
    const existingPeopleMap = await findPeopleByLinkedInUrls(linkedinUrls);
    console.log(`[Refresh] Found ${existingPeopleMap.size} existing people in database`);

    const urlsToScrape = linkedinUrls.filter(url => !existingPeopleMap.has(url));
    const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

    console.log(`[Refresh] Need to scrape ${urlsToScrape.length} new profiles`);

    // ===== STEP 3: SCRAPE NEW LINKEDIN PROFILES =====
    let newPeopleCount = 0;
    let emailsGenerated = 0;
    const savedPersonIds: string[] = [];

    if (urlsToScrape.length > 0) {
      const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
        console.log(`[Refresh] Processing batch ${batchIndex + 1}/${totalBatches} (${profiles.length} profiles)`);

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

        // Generate emails from patterns
        const peopleWithoutEmails = await prisma.person.findMany({
          where: {
            id: { in: savedPersonIds },
            email: null,
            firstName: { not: null },
            lastName: { not: null },
          },
          select: { id: true, firstName: true, lastName: true, company: true },
        });

        for (const person of peopleWithoutEmails) {
          const pattern = await getOrLearnPattern(person.company);
          if (pattern && pattern.confidence >= 0.8) {
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
          }
        }

        console.log(`[Refresh] Batch ${batchIndex + 1}: saved ${savedPersonIds.length}, emails ${emailsGenerated}`);
      };

      await scrapeLinkedInProfiles(urlsToScrape, {
        includeEmail: false,
        onBatchComplete: processBatch,
      });
    }

    // ===== STEP 4: COUNT MATCHING PEOPLE =====
    const filters: PersonFilters = {
      company: input.company,
      location: input.location,
      university: input.university,
      requireEmail: false,
      excludePersonKeys: excludedKeys,
      limit: 100,
    };

    const matchingPeople = await findPeopleByFilters(filters);

    // ===== STEP 5: UPDATE CACHE =====
    if (matchingPeople.length > 0) {
      const normalizedParams = normalizeSearchParams({
        name: input.name,
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      });

      const personIds = matchingPeople.map(p => p.id);
      const apiStats: ApiUsageStats = {
        apolloCallsMade: 0,
        apolloCacheHits: 0,
        cseCallsMade: 1,
        linkedinScraperCalls: urlsToScrape.length,
      };

      const staleSearch = await findStaleSearch(normalizedParams);
      if (staleSearch) {
        await updateSearchWithPeople(staleSearch.id, personIds, apiStats);
      } else {
        await createSearchWithPeople(normalizedParams, personIds, apiStats);
      }
    }

    console.log(`[Refresh] Complete: ${newPeopleCount} new people, ${emailsGenerated} emails, ${matchingPeople.length} matching`);

    return {
      success: true,
      newPeopleCount,
      emailsGenerated,
      matchingCount: matchingPeople.length,
    };
  } catch (error) {
    console.error('Refresh search error:', error);
    return { success: false, error: 'Refresh failed. Please try again.' };
  }
}
