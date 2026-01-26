'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchPeople, SearchResult } from '@/lib/services/discovery';
import { getOrFindEmail, CachedEmailResult } from '@/lib/services/email-cache';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { saveSearchResult, getExcludedPersonKeys } from '@/lib/db/person-service';

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
  emailSource: 'cache' | 'apollo' | 'none'; // Debug field: where email came from
  draftSubject: string;
  draftBody: string;
  sourceUrl: string;
  linkedinUrl: string | null;
  confidence?: number;
  isLowConfidence?: boolean;
  extractionMethod?: 'linkedin' | 'pipe' | 'snippet' | 'role-first' | 'fallback';
  userCandidateId?: string;
  emailDraftId?: string;
  resumeId?: string | null;
  // Location fields from Apollo
  city?: string | null;
  state?: string | null;
  country?: string | null;
  // Education from Apollo
  education?: EducationInfo | null;
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
      // Parse prompt as JSON or use as-is
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
        // If not JSON, treat entire prompt as body
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

    // Request more candidates than user limit to account for unverified and missing emails
    // Strategy: Request limit * 2 or limit + 10, whichever is higher
    const discoveryLimit = Math.max(input.limit + 10, Math.ceil(input.limit * 2));
    console.log(`[Search] Requesting ${discoveryLimit} candidates to ensure ${input.limit} results with emails (accounting for MISSING emails being filtered).`);

    // Search for people, excluding only sent/hidden people
    const people = await searchPeople({
      name: input.name,
      university: input.university,
      company: input.company,
      role: input.role,
      location: input.location,
      limit: discoveryLimit,
      excludePersonKeys: excludedKeys,
    });

    // Log if we got fewer results than requested for discovery
    if (people.length < discoveryLimit) {
      console.log(
        `[Search] Found ${people.length} new people (requested ${discoveryLimit} for discovery). User may have already discovered many people for this search.`
      );
    }

    // Enrich with emails, generate drafts, and save to database
    const EMAIL_LOOKUP_CONCURRENCY = 3;
    const DB_SAVE_CONCURRENCY = 3;

    // Step 1: Process email lookups with controlled concurrency
    interface EmailLookupResult {
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
      fromCache: false,
      apolloCalled: false,
    };

    const emailLookupResults = await processWithConcurrency(
      people,
      EMAIL_LOOKUP_CONCURRENCY,
      async (person): Promise<EmailLookupResult> => {
        // Smart email lookup with caching
        let emailResult: CachedEmailResult = emptyEmailResult;
        let emailSource: 'cache' | 'apollo' | 'none' = 'none';

        if (person.firstName && person.lastName) {
          // Extract LinkedIn URL if the source is from LinkedIn
          const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

          emailResult = await getOrFindEmail({
            fullName: person.fullName,
            firstName: person.firstName,
            lastName: person.lastName,
            company: person.company,
            linkedinUrl,
          });
          
          // Determine email source for debugging
          if (emailResult.fromCache) {
            emailSource = 'cache';
            console.log(`[Search] ✅ ${person.fullName} at ${person.company}: Email from CACHE (${emailResult.email || 'none'}, ${emailResult.status})`);
          } else if (emailResult.apolloCalled) {
            emailSource = 'apollo';
            console.log(`[Search] 📞 ${person.fullName} at ${person.company}: Email from APOLLO API (${emailResult.email || 'none'}, ${emailResult.status})`);
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

    // Determine resume to attach based on template settings
    let resumeIdToAttach: string | null = null;
    let shouldAttachResume = false;

    if (template.attachResume) {
      shouldAttachResume = true;
      // Use template's resumeId if specified, otherwise find user's active resume
      if (template.resumeId) {
        resumeIdToAttach = template.resumeId;
      } else {
        // Find user's active resume
        const activeResume = await prisma.userResume.findFirst({
          where: {
            userId: session.user.id,
            isActive: true,
          },
          select: { id: true },
        });
        if (activeResume) {
          resumeIdToAttach = activeResume.id;
        } else {
          console.warn(`[Search] Template has attachResume=true but no resumeId specified and no active resume found for user ${session.user.id}`);
        }
      }
    }

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
              attachResume: shouldAttachResume,
              resumeId: resumeIdToAttach,
            }
          );

          // Extract LinkedIn URL from search result or use saved one
          const linkedinUrl = saved.linkedinUrl || (person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null);

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
            linkedinUrl: linkedinUrl || extractLinkedInUrl(person),
            confidence: person.confidence,
            isLowConfidence: person.isLowConfidence,
            extractionMethod: person.extractionMethod,
            userCandidateId: saved.userCandidateId,
            emailDraftId: saved.emailDraftId,
            resumeId: shouldAttachResume ? resumeIdToAttach : null,
            // Location and education from Apollo
            city: emailResult.city,
            state: emailResult.state,
            country: emailResult.country,
            education: emailResult.education,
          };
        } catch (error) {
          console.error('Error saving search result to database:', error);
          // Still return result even if save fails
          // Extract LinkedIn URL from search result
          const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

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
            resumeId: shouldAttachResume ? resumeIdToAttach : null,
            sourceUrl: person.sourceUrl,
            linkedinUrl: linkedinUrl || extractLinkedInUrl(person),
            confidence: person.confidence,
            isLowConfidence: person.isLowConfidence,
            extractionMethod: person.extractionMethod,
            // Location and education from Apollo
            city: emailResult.city,
            state: emailResult.state,
            country: emailResult.country,
            education: emailResult.education,
          };
        }
      }
    );

    // Filter out results with MISSING email status (only show results with emails)
    const resultsWithEmails = results.filter(
      (result) => result.emailStatus !== 'MISSING'
    );

    // Sort results by verification status: VERIFIED → UNVERIFIED
    const statusPriority: Record<'VERIFIED' | 'UNVERIFIED' | 'MISSING', number> = {
      VERIFIED: 1,
      UNVERIFIED: 2,
      MISSING: 999,
    };

    const sortedResults = resultsWithEmails.sort((a, b) => {
      const aPriority = statusPriority[a.emailStatus] || 999;
      const bPriority = statusPriority[b.emailStatus] || 999;
      return aPriority - bPriority;
    });

    // Apply limit after sorting
    const finalResults = sortedResults.slice(0, input.limit);

    // Count results by status for logging
    const verifiedCount = finalResults.filter((r) => r.emailStatus === 'VERIFIED').length;
    const unverifiedCount = finalResults.filter((r) => r.emailStatus === 'UNVERIFIED').length;

    // Log results breakdown
    if (finalResults.length < input.limit) {
      console.log(
        `[Search] Found ${finalResults.length} results (requested ${input.limit}): ${verifiedCount} verified, ${unverifiedCount} unverified. Not enough results with emails available.`
      );
    } else {
      console.log(
        `[Search] Successfully found ${finalResults.length} results: ${verifiedCount} verified, ${unverifiedCount} unverified.`
      );
    }

    return { success: true, results: finalResults };
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
