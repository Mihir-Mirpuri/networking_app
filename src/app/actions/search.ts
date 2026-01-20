'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople, SearchResult } from '@/lib/services/discovery';
import { getOrFindEmail } from '@/lib/services/email-cache';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { saveSearchResult, getExcludedPersonKeys } from '@/lib/db/person-service';

export interface SearchInput {
  company: string;
  role: string;
  university: string;
  location: string;
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
  university: string;
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  emailConfidence: number;
  emailSource: 'cache' | 'apollo' | 'none'; // Debug field: where email came from
  draftSubject: string;
  draftBody: string;
  sourceUrl: string;
  linkedinUrl: string | null;
  userCandidateId?: string;
  emailDraftId?: string;
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
  person: SearchResult,
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

export async function searchPeopleAction(
  input: SearchInput
): Promise<{ success: true; results: SearchResultWithDraft[] } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Try to get template from database first, fallback to constants
  let template: { subject: string; body: string; id: string } | null = null;
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
    });

    if (dbTemplate) {
      // Parse prompt as JSON or use as-is
      try {
        const parsed = JSON.parse(dbTemplate.prompt);
        template = {
          id: dbTemplate.id,
          subject: parsed.subject || '',
          body: parsed.body || dbTemplate.prompt,
        };
        templateId = dbTemplate.id;
      } catch {
        // If not JSON, treat entire prompt as body
        template = {
          id: dbTemplate.id,
          subject: `Reaching out from ${input.university}`,
          body: dbTemplate.prompt,
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
    };
    templateId = null; // Will be created in seed script later
  }

  try {
    // Fetch user profile for template personalization
    const userProfile = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        classification: true,
        major: true,
        university: true,
        career: true,
      },
    });

    // Get excluded Person keys (sent emails or marked "do not show again")
    // Only these people should be excluded from future searches
    const excludedKeys = await getExcludedPersonKeys(session.user.id);
    console.log(`[Search] User has ${excludedKeys.size} excluded people (sent/hidden).`);

    // Search for people, excluding only sent/hidden people
    const people = await searchPeople({
      university: input.university,
      company: input.company,
      role: input.role,
      location: input.location,
      limit: input.limit,
      excludePersonKeys: excludedKeys,
    });

    // Log if we got fewer results than requested
    if (people.length < input.limit) {
      console.log(
        `[Search] Found ${people.length} new people (requested ${input.limit}). User may have already discovered many people for this search.`
      );
    }

    // Enrich with emails, generate drafts, and save to database
    const EMAIL_LOOKUP_CONCURRENCY = 3;
    const DB_SAVE_CONCURRENCY = 3;

    // Step 1: Process email lookups with controlled concurrency
    interface EmailLookupResult {
      person: SearchResult;
      emailResult: { email: string | null; status: 'VERIFIED' | 'UNVERIFIED' | 'MISSING'; confidence: number; existingPerson?: { id: string; email: string | null; emailStatus: string; emailConfidence: number | null } };
      emailSource: 'cache' | 'apollo' | 'none';
    }

    const emailLookupResults = await processWithConcurrency(
      people,
      EMAIL_LOOKUP_CONCURRENCY,
      async (person): Promise<EmailLookupResult> => {
        // Smart email lookup with caching
        let emailResult = { email: null as string | null, status: 'MISSING' as const, confidence: 0 };
        let emailSource: 'cache' | 'apollo' | 'none' = 'none';

        if (person.firstName && person.lastName) {
          // Extract LinkedIn URL if the source is from LinkedIn
          const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

          const cachedResult = await getOrFindEmail({
            fullName: person.fullName,
            firstName: person.firstName,
            lastName: person.lastName,
            company: person.company,
            linkedinUrl,
          });
          
          emailResult = {
            email: cachedResult.email,
            status: cachedResult.status,
            confidence: cachedResult.confidence,
            existingPerson: cachedResult.existingPerson,
          };
          
          // Determine email source for debugging
          if (cachedResult.fromCache) {
            emailSource = 'cache';
            console.log(`[Search] ✅ ${person.fullName} at ${person.company}: Email from CACHE (${cachedResult.email || 'none'}, ${cachedResult.status})`);
          } else if (cachedResult.apolloCalled) {
            emailSource = 'apollo';
            console.log(`[Search] 📞 ${person.fullName} at ${person.company}: Email from APOLLO API (${cachedResult.email || 'none'}, ${cachedResult.status})`);
          } else {
            emailSource = 'none';
            console.log(`[Search] ⚠️  ${person.fullName} at ${person.company}: No email found (missing firstName/lastName)`);
          }
        } else {
          console.log(`[Search] ⚠️  ${person.fullName} at ${person.company}: Skipping email lookup (missing firstName or lastName)`);
        }

        return { person, emailResult, emailSource };
      }
    );

    // Step 2: Process database saves with controlled concurrency
    const results: SearchResultWithDraft[] = await processWithConcurrency(
      emailLookupResults,
      DB_SAVE_CONCURRENCY,
      async ({ person, emailResult, emailSource }): Promise<SearchResultWithDraft> => {
        // Generate placeholder draft (simple template replacement)
        const placeholderDraft = generateDraft(template, person, input.university, input.role, userProfile || { name: null, classification: null, major: null, university: null, career: null });

        // Save to database with placeholder
        try {
          const saved = await saveSearchResult(
            session.user.id,
            person,
            emailResult,
            input.university,
            {
              subject: placeholderDraft.subject,
              body: placeholderDraft.body,
              templateId: templateId,
            }
          );

          return {
            id: saved.userCandidateId,
            fullName: person.fullName,
            firstName: person.firstName,
            lastName: person.lastName,
            company: person.company,
            role: person.role,
            university: input.university,
            email: emailResult.email,
            emailStatus: emailResult.status,
            emailConfidence: emailResult.confidence,
            emailSource,
            draftSubject: placeholderDraft.subject,
            draftBody: placeholderDraft.body,
            sourceUrl: person.sourceUrl,
            linkedinUrl: extractLinkedInUrl(person),
            userCandidateId: saved.userCandidateId,
            emailDraftId: saved.emailDraftId,
          };
        } catch (error) {
          console.error('Error saving search result to database:', error);
          // Still return result even if save fails
          return {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fullName: person.fullName,
            firstName: person.firstName,
            lastName: person.lastName,
            company: person.company,
            role: person.role,
            university: input.university,
            email: emailResult.email,
            emailStatus: emailResult.status,
            emailConfidence: emailResult.confidence,
            emailSource,
            draftSubject: placeholderDraft.subject,
            draftBody: placeholderDraft.body,
            sourceUrl: person.sourceUrl,
            linkedinUrl: extractLinkedInUrl(person),
          };
        }
      }
    );

    return { success: true, results };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
  }
}

/**
 * Server action to mark a person as "do not show again"
 * Updates UserCandidate.doNotShow = true for the given userCandidateId
 */
export async function hidePersonAction(
  userCandidateId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Verify user owns the UserCandidate
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

    // Update doNotShow flag
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
