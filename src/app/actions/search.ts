'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople } from '@/lib/services/discovery';
import { getOrFindEmail } from '@/lib/services/email-cache';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import {
  getExcludedPersonKeys,
  findPeopleByFilters,
  saveDiscoveredPerson,
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

// Concurrency limits
const APOLLO_CONCURRENCY = 3;

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
 * Re-enrich stale people with fresh Apollo data
 */
async function reEnrichStalePeople(personIds: string[]): Promise<void> {
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, fullName: true, firstName: true, lastName: true, company: true, linkedinUrl: true },
  });

  await processWithConcurrency(people, APOLLO_CONCURRENCY, async (person) => {
    const emailResult = await getOrFindEmail({
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
    });

    await prisma.person.update({
      where: { id: person.id },
      data: {
        email: emailResult.email,
        emailStatus: emailResult.status,
        emailConfidence: emailResult.confidence,
        role: emailResult.employment?.title,
        city: emailResult.city,
        state: emailResult.state,
        country: emailResult.country,
        apolloEnrichedAt: new Date(),
      },
    });
  });
}

/**
 * Main search action - Database-First Approach
 *
 * Flow:
 * 1. CSE Discovery: Broad search (company + university only)
 * 2. Apollo Enrichment: Enrich ALL discovered people
 * 3. Save to DB: Store ALL people with Apollo data
 * 4. Query DB: Filter by user's criteria (company, location, role, email)
 * 5. Return: Ranked results matching user's filters
 */
export async function searchPeopleAction(
  input: SearchInput
): Promise<{ success: true; results: SearchResultWithDraft[] } | { success: false; error: string }> {
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

      // Check for stale Apollo data
      const stalePersonIds = await getStalePersonIds(cachedPersonIds);

      if (stalePersonIds.length > 0) {
        console.log(`[Search] Re-enriching ${stalePersonIds.length} stale people`);
        await reEnrichStalePeople(stalePersonIds);
      }

      // Fetch fresh person data
      matchingPeople = await getPersonsByIds(cachedPersonIds);
      console.log(`[Search] Retrieved ${matchingPeople.length} people from cache`);
    } else {
      // ===== CACHE MISS - do full CSE + Apollo =====
      console.log('[Search] CACHE MISS - running full discovery');

      // ===== STEP 1: CSE DISCOVERY =====
      const CSE_LIMIT = 100;
      console.log(`[Search] Step 1: CSE Discovery for "${input.company}" + "${input.university || 'any university'}" + "${input.role || 'any role'}" + "${input.location || 'any location'}"`);

      const cseResults = await searchPeople({
        company: input.company,
        university: input.university,
        role: input.role,
        location: input.location,
        name: input.name,
        limit: CSE_LIMIT,
      });
      console.log(`[Search] CSE found ${cseResults.length} LinkedIn profiles`);

      // ===== STEP 2: APOLLO ENRICHMENT =====
      console.log(`[Search] Step 2: Apollo enrichment for ${cseResults.length} people`);

      let newPeopleCount = 0;
      let existingPeopleCount = 0;

      await processWithConcurrency(cseResults, APOLLO_CONCURRENCY, async (person) => {
        if (!person.firstName || !person.lastName) {
          return;
        }

        const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;
        const emailResult = await getOrFindEmail({
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          company: person.company,
          linkedinUrl,
        });

        const apolloCompany = emailResult.employment?.company || person.company;
        const education = emailResult.education || (input.university ? {
          schoolName: input.university,
          degree: null,
          fieldOfStudy: null,
          graduationYear: null,
        } : null);

        const { isNew } = await saveDiscoveredPerson(
          person.fullName,
          person.firstName,
          person.lastName,
          linkedinUrl,
          person.sourceUrl,
          person.sourceTitle,
          person.sourceSnippet,
          person.sourceDomain,
          {
            company: apolloCompany,
            role: emailResult.employment?.title || null,
            email: emailResult.email,
            emailStatus: emailResult.status,
            emailConfidence: emailResult.confidence,
            city: emailResult.city,
            state: emailResult.state,
            country: emailResult.country,
            education,
          }
        );

        if (isNew) {
          newPeopleCount++;
        } else {
          existingPeopleCount++;
        }
      });

      console.log(`[Search] Saved to DB: ${newPeopleCount} new, ${existingPeopleCount} updated`);

      // ===== STEP 3: QUERY DATABASE WITH FILTERS =====
      console.log(`[Search] Step 3: Query DB with filters - company="${input.company}", location="${input.location || 'any'}", role="${input.role || 'any'}"`);

      const filters: PersonFilters = {
        company: input.company,
        location: input.location,
        requireEmail: true,
        excludePersonKeys: excludedKeys,
        limit: input.limit * 3,
      };

      matchingPeople = await findPeopleByFilters(filters);
      console.log(`[Search] DB query returned ${matchingPeople.length} matching people`);

      // ===== SAVE TO CACHE =====
      if (matchingPeople.length > 0) {
        const personIds = matchingPeople.map(p => p.id);
        const staleSearch = await findStaleSearch(normalizedParams);
        if (staleSearch) {
          await updateSearchWithPeople(staleSearch.id, personIds);
          console.log(`[Search] Updated stale search ${staleSearch.id} with ${personIds.length} people`);
        } else {
          const { searchId } = await createSearchWithPeople(normalizedParams, personIds);
          console.log(`[Search] Created new search cache ${searchId} with ${personIds.length} people`);
        }
      }
    }

    if (matchingPeople.length === 0) {
      console.log('[Search] No matching people found');
      return { success: true, results: [] };
    }

    // ===== STEP 4: FILTER AND RANK RESULTS =====
    // For cache hits, we need to filter out excluded people
    // For cache misses, this was already done in findPeopleByFilters
    const filteredPeople = matchingPeople.filter(person => {
      // Filter out excluded people (sent/hidden)
      const personKey = `${person.fullName}_${person.company}`.toLowerCase();
      if (excludedKeys.has(personKey)) {
        return false;
      }
      // Only include people with email
      if (!person.email) {
        return false;
      }
      return true;
    });

    if (filteredPeople.length === 0) {
      console.log('[Search] No matching people after filtering');
      return { success: true, results: [] };
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
    const DB_SAVE_CONCURRENCY = 3;
    const results = await processWithConcurrency(
      rankedPeople,
      DB_SAVE_CONCURRENCY,
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
      }
    );

    // Log final results
    const verifiedCount = results.filter((r) => r.emailStatus === 'VERIFIED').length;
    const unverifiedCount = results.filter((r) => r.emailStatus === 'UNVERIFIED').length;

    console.log(
      `[Search] Returning ${results.length} results: ${verifiedCount} verified, ${unverifiedCount} unverified`
    );

    return { success: true, results };
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
