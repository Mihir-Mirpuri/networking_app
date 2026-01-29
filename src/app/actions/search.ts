'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople, SearchResult } from '@/lib/services/discovery';
import { getOrFindEmail, CachedEmailResult } from '@/lib/services/email-cache';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { saveSearchResult, getExcludedPersonKeys } from '@/lib/db/person-service';
import {
  normalizeSearchParams,
  findCachedSearch,
  findStaleSearch,
  getCachedPersonIds,
  getPersonsByIds,
  getStalePersonIds,
  createSearchWithPeople,
  updateSearchWithPeople,
} from '@/lib/db/search-cache';

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
  // Ranking score and breakdown
  rankingScore?: number;
  rankingBreakdown?: ScoreBreakdown;
}

function extractLinkedInUrl(person: SearchResult): string | null {
  if (person.sourceDomain?.includes('linkedin.com') || person.sourceUrl?.includes('linkedin.com')) {
    return person.sourceUrl;
  }
  return null;
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
 * Refresh stale Person records by calling Apollo
 */
async function refreshStalePeople(
  stalePersons: Array<{ id: string; fullName: string; firstName: string | null; lastName: string | null; company: string; linkedinUrl: string | null }>
): Promise<void> {
  console.log(`[Search] Refreshing ${stalePersons.length} stale person records via Apollo`);

  await processWithConcurrency(stalePersons, 3, async (person) => {
    if (!person.firstName || !person.lastName) {
      console.log(`[Search] Skipping refresh for ${person.fullName} - missing name parts`);
      return;
    }

    try {
      await getOrFindEmail({
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        linkedinUrl: person.linkedinUrl,
      });
      console.log(`[Search] Refreshed Apollo data for ${person.fullName}`);
    } catch (error) {
      console.error(`[Search] Failed to refresh ${person.fullName}:`, error);
    }
  });
}

export async function searchPeopleAction(
  input: SearchInput
): Promise<{ success: true; results: SearchResultWithDraft[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Try to get template from database first, fallback to constants
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

    // Build search criteria for ranking
    const searchCriteria: SearchCriteria = {
      company: input.company,
      role: input.role,
      location: input.location,
      university: input.university,
    };

    // Normalize search params for caching
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    // Check for cached search (< 24 hours old)
    const cachedSearch = await findCachedSearch(normalizedParams);

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

    let results: SearchResultWithDraft[];
    let staleSearch: Awaited<ReturnType<typeof findStaleSearch>> = null;

    if (cachedSearch) {
      // ===== CACHED SEARCH PATH =====
      console.log(`[Search] Cache HIT! Using cached search from ${cachedSearch.createdAt.toISOString()}`);

      // Get cached Person IDs
      const cachedPersonIds = await getCachedPersonIds(cachedSearch.id);
      console.log(`[Search] Found ${cachedPersonIds.length} cached people`);

      // Check for stale persons that need Apollo refresh
      const staleIds = await getStalePersonIds(cachedPersonIds);
      if (staleIds.length > 0) {
        console.log(`[Search] ${staleIds.length} cached people have stale Apollo data`);
      }

      // Fetch Person records with their data
      let cachedPersons = await getPersonsByIds(cachedPersonIds);

      // Refresh stale persons via Apollo
      if (staleIds.length > 0) {
        const stalePersonsToRefresh = cachedPersons
          .filter(p => staleIds.includes(p.id))
          .map(p => ({
            id: p.id,
            fullName: p.fullName,
            firstName: p.firstName,
            lastName: p.lastName,
            company: p.company,
            linkedinUrl: p.linkedinUrl,
          }));

        await refreshStalePeople(stalePersonsToRefresh);

        // Re-fetch to get updated data
        cachedPersons = await getPersonsByIds(cachedPersonIds);
      }

      // Filter out excluded people
      const filteredPersons = cachedPersons.filter((person) => {
        const key = `${person.fullName}_${person.company}`.toLowerCase();
        return !excludedKeys.has(key);
      });
      console.log(`[Search] After excluding sent/hidden: ${filteredPersons.length} people`);

      // Apply ranking to cached persons
      const rankedCached = rankCandidates(
        searchCriteria,
        filteredPersons,
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

      console.log(`[Search] Ranked ${rankedCached.length} cached candidates`);

      // Process ranked cached persons
      const DB_SAVE_CONCURRENCY = 3;
      results = await processWithConcurrency(
        rankedCached,
        DB_SAVE_CONCURRENCY,
        async ({ candidate: person, score, breakdown }): Promise<SearchResultWithDraft> => {
          const placeholderDraft = generateDraft(
            template,
            person,
            input.university || '',
            input.role || '',
            userProfile || { name: null, classification: null, major: null, university: null, career: null }
          );

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
        }
      );
    } else {
      // ===== FRESH SEARCH PATH =====
      staleSearch = await findStaleSearch(normalizedParams);
      if (staleSearch) {
        console.log(`[Search] Found stale cache from ${staleSearch.createdAt.toISOString()}, will update in place`);
      } else {
        console.log(`[Search] Cache MISS - performing fresh CSE search`);
      }

      // Request more candidates for ranking (we'll rank and take top N)
      const discoveryLimit = Math.max(input.limit * 3, 30);
      console.log(`[Search] Requesting ${discoveryLimit} candidates for ranking`);

      // Search for people via CSE
      const people = await searchPeople({
        name: input.name,
        university: input.university,
        company: input.company,
        role: input.role,
        location: input.location,
        limit: discoveryLimit,
        excludePersonKeys: excludedKeys,
      });

      console.log(`[Search] Found ${people.length} LinkedIn profiles from CSE`);

      // Enrich ALL profiles via Apollo
      const EMAIL_LOOKUP_CONCURRENCY = 3;
      const DB_SAVE_CONCURRENCY = 3;

      interface EnrichedPerson {
        person: SearchResult;
        emailResult: CachedEmailResult;
        emailSource: 'cache' | 'apollo' | 'none';
      }

      const emptyEmailResult: CachedEmailResult = {
        email: null,
        status: 'MISSING',
        confidence: 0,
        city: null,
        state: null,
        country: null,
        education: null,
        employment: null,
        fromCache: false,
        apolloCalled: false,
      };

      // Enrich with Apollo data
      const enrichedPeople = await processWithConcurrency(
        people,
        EMAIL_LOOKUP_CONCURRENCY,
        async (person): Promise<EnrichedPerson> => {
          let emailResult: CachedEmailResult = emptyEmailResult;
          let emailSource: 'cache' | 'apollo' | 'none' = 'none';

          if (person.firstName && person.lastName) {
            const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

            emailResult = await getOrFindEmail({
              fullName: person.fullName,
              firstName: person.firstName,
              lastName: person.lastName,
              company: person.company,
              linkedinUrl,
            });

            if (emailResult.fromCache) {
              emailSource = 'cache';
            } else if (emailResult.apolloCalled) {
              emailSource = 'apollo';
            }
          }

          return { person, emailResult, emailSource };
        }
      );

      // Apply ranking to enriched candidates
      const rankedEnriched = rankCandidates(
        searchCriteria,
        enrichedPeople,
        ({ emailResult }): CandidateData => ({
          company: emailResult.employment?.company || null,
          role: emailResult.employment?.title || null,
          city: emailResult.city,
          state: emailResult.state,
          country: emailResult.country,
          educationSchool: emailResult.education?.schoolName || null,
          email: emailResult.email,
          emailStatus: emailResult.status,
        }),
        input.limit
      );

      console.log(`[Search] Ranked top ${rankedEnriched.length} candidates`);

      // Save ranked results to database
      results = await processWithConcurrency(
        rankedEnriched,
        DB_SAVE_CONCURRENCY,
        async ({ candidate: { person, emailResult, emailSource }, score, breakdown }): Promise<SearchResultWithDraft> => {
          const apolloCompany = emailResult.employment?.company || person.company;
          const apolloRole = emailResult.employment?.title || person.role;

          const placeholderDraft = generateDraft(
            template,
            { firstName: person.firstName, company: apolloCompany },
            input.university || '',
            input.role || '',
            userProfile || { name: null, classification: null, major: null, university: null, career: null }
          );

          try {
            const saved = await saveSearchResult(
              session.user.id,
              person,
              emailResult,
              input.university || '',
              {
                subject: placeholderDraft.subject,
                body: placeholderDraft.body,
                templateId: templateId,
                attachResume: shouldAttachResume,
                resumeId: resumeIdToAttach,
              }
            );

            const linkedinUrl = saved.linkedinUrl || (person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null);

            return {
              id: saved.userCandidateId,
              fullName: person.fullName,
              firstName: person.firstName,
              lastName: person.lastName,
              company: apolloCompany,
              role: apolloRole,
              university: input.university || '',
              email: emailResult.email,
              emailStatus: emailResult.status,
              emailConfidence: emailResult.confidence,
              emailSource,
              draftSubject: placeholderDraft.subject,
              draftBody: placeholderDraft.body,
              sourceUrl: person.sourceUrl,
              linkedinUrl: linkedinUrl || extractLinkedInUrl(person),
              userCandidateId: saved.userCandidateId,
              emailDraftId: saved.emailDraftId,
              resumeId: shouldAttachResume ? resumeIdToAttach : null,
              personId: saved.personId,
              city: emailResult.city,
              state: emailResult.state,
              country: emailResult.country,
              education: emailResult.education,
              rankingScore: score,
              rankingBreakdown: breakdown,
            };
          } catch (error) {
            console.error('Error saving search result:', error);
            const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

            return {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              fullName: person.fullName,
              firstName: person.firstName,
              lastName: person.lastName,
              company: apolloCompany,
              role: apolloRole,
              university: input.university || '',
              email: emailResult.email,
              emailStatus: emailResult.status,
              emailConfidence: emailResult.confidence,
              emailSource,
              draftSubject: placeholderDraft.subject,
              draftBody: placeholderDraft.body,
              sourceUrl: person.sourceUrl,
              linkedinUrl: linkedinUrl || extractLinkedInUrl(person),
              resumeId: shouldAttachResume ? resumeIdToAttach : null,
              city: emailResult.city,
              state: emailResult.state,
              country: emailResult.country,
              education: emailResult.education,
              rankingScore: score,
              rankingBreakdown: breakdown,
            };
          }
        }
      );
    }

    // Filter out results that failed to save
    const savedResults = results.filter((result) => result.userCandidateId !== undefined);

    // Results are already ranked - just apply final limit
    const finalResults = savedResults.slice(0, input.limit);

    // Save to cache for fresh searches
    if (!cachedSearch) {
      const personIdsForCache = finalResults
        .filter((r) => r.personId)
        .map((r) => r.personId!);

      if (personIdsForCache.length > 0) {
        try {
          if (staleSearch) {
            await updateSearchWithPeople(staleSearch.id, personIdsForCache);
            console.log(`[Search] Updated stale cache with ${personIdsForCache.length} ranked people`);
          } else {
            const { searchId } = await createSearchWithPeople(normalizedParams, personIdsForCache);
            console.log(`[Search] Created new cache entry ${searchId} with ${personIdsForCache.length} ranked people`);
          }
        } catch (cacheError) {
          console.error('[Search] Failed to save search cache:', cacheError);
        }
      }
    }

    // Log results
    const verifiedCount = finalResults.filter((r) => r.emailStatus === 'VERIFIED').length;
    const unverifiedCount = finalResults.filter((r) => r.emailStatus === 'UNVERIFIED').length;
    const avgScore = finalResults.length > 0
      ? (finalResults.reduce((sum, r) => sum + (r.rankingScore || 0), 0) / finalResults.length).toFixed(2)
      : '0';

    console.log(
      `[Search] Returning ${finalResults.length} results: ${verifiedCount} verified, ${unverifiedCount} unverified, avg score: ${avgScore}`
    );

    return { success: true, results: finalResults };
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
