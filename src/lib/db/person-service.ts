import prisma from '@/lib/prisma';
import { SearchResult } from '@/lib/services/discovery';
import { EmailResult } from '@/lib/services/enrichment';
import { EmailStatus } from '@prisma/client';

export interface PersonData {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  linkedinUrl?: string | null;
}

export interface UserCandidateData {
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
  emailConfidence: number | null;
  university?: string | null;
}

export interface SourceLinkData {
  url: string;
  title: string;
  snippet: string | null;
  domain: string | null;
  kind: 'DISCOVERY' | 'RESEARCH';
}

export interface EmailDraftData {
  subject: string;
  body: string;
  templateId: string | null;
}

/**
 * Creates or updates a Person record (shared across all users)
 */
export async function createOrUpdatePerson(
  personData: PersonData
): Promise<{ id: string }> {
  const person = await prisma.person.upsert({
    where: {
      fullName_company: {
        fullName: personData.fullName,
        company: personData.company,
      },
    },
    create: {
      fullName: personData.fullName,
      firstName: personData.firstName,
      lastName: personData.lastName,
      company: personData.company,
      role: personData.role,
      linkedinUrl: personData.linkedinUrl || null,
    },
    update: {
      // Update role if we have new info
      role: personData.role || undefined,
      // Update LinkedIn URL if we found one and don't have one
      linkedinUrl: personData.linkedinUrl || undefined,
    },
  });

  return { id: person.id };
}

/**
 * Creates or updates a UserCandidate record (user-specific relationship)
 */
export async function createOrUpdateUserCandidate(
  userId: string,
  personId: string,
  candidateData: UserCandidateData
): Promise<{ id: string }> {
  const userCandidate = await prisma.userCandidate.upsert({
    where: {
      userId_personId: {
        userId,
        personId,
      },
    },
    create: {
      userId,
      personId,
      email: candidateData.email,
      emailStatus: candidateData.emailStatus,
      emailConfidence: candidateData.emailConfidence,
      university: candidateData.university || null,
    },
    update: {
      // Update email if we found a better one
      email: candidateData.email || undefined,
      emailStatus: candidateData.emailStatus,
      emailConfidence: candidateData.emailConfidence,
      university: candidateData.university || undefined,
    },
  });

  return { id: userCandidate.id };
}

/**
 * Creates a SourceLink record if it doesn't already exist
 */
export async function createSourceLink(
  personId: string,
  sourceData: SourceLinkData
): Promise<{ id: string } | null> {
  try {
    const sourceLink = await prisma.sourceLink.upsert({
      where: {
        personId_url: {
          personId,
          url: sourceData.url,
        },
      },
      create: {
        personId,
        kind: sourceData.kind,
        url: sourceData.url,
        title: sourceData.title,
        snippet: sourceData.snippet || null,
        domain: sourceData.domain || null,
      },
      update: {
        // Don't update if exists - keep first discovery
      },
    });

    return { id: sourceLink.id };
  } catch (error) {
    // If unique constraint violation, link already exists
    console.error('Error creating source link:', error);
    return null;
  }
}

/**
 * Creates or updates an EmailDraft record
 */
export async function createOrUpdateEmailDraft(
  userCandidateId: string,
  draftData: EmailDraftData
): Promise<{ id: string }> {
  const emailDraft = await prisma.emailDraft.upsert({
    where: {
      userCandidateId,
    },
    create: {
      userCandidateId,
      templateId: draftData.templateId,
      subject: draftData.subject,
      body: draftData.body,
      status: 'PENDING',
    },
    update: {
      // Update draft if regenerated
      subject: draftData.subject,
      body: draftData.body,
      templateId: draftData.templateId || undefined,
      status: 'PENDING', // Reset to pending if regenerated
    },
  });

  return { id: emailDraft.id };
}

/**
 * Updates Person email if new email is better than existing
 * Only updates if:
 * - Current email is null, OR
 * - New email is VERIFIED and current is not, OR
 * - New email has higher confidence than current
 */
export async function updatePersonEmailIfBetter(
  personId: string,
  newEmail: string | null,
  newStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING',
  newConfidence: number
): Promise<void> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      email: true,
      emailStatus: true,
      emailConfidence: true,
    },
  });

  if (!person) return;

  // If no current email, always update
  if (!person.email && newEmail) {
    await prisma.person.update({
      where: { id: personId },
      data: {
        email: newEmail,
        emailStatus: newStatus as EmailStatus,
        emailConfidence: newConfidence,
        emailLastUpdated: new Date(),
      },
    });
    return;
  }

  // If current email exists, only update if new is better
  if (person.email && newEmail) {
    const shouldUpdate =
      // New is VERIFIED and current is not
      (newStatus === 'VERIFIED' && person.emailStatus !== 'VERIFIED') ||
      // New has higher confidence
      (newConfidence > (person.emailConfidence || 0)) ||
      // Both VERIFIED but new has higher confidence
      (newStatus === 'VERIFIED' &&
        person.emailStatus === 'VERIFIED' &&
        newConfidence > (person.emailConfidence || 0));

    if (shouldUpdate) {
      await prisma.person.update({
        where: { id: personId },
        data: {
          email: newEmail,
          emailStatus: newStatus as EmailStatus,
          emailConfidence: newConfidence,
          emailLastUpdated: new Date(),
        },
      });
    }
  }
}

/**
 * Helper to extract LinkedIn URL from search result
 */
export function extractLinkedInUrl(sourceUrl: string, sourceDomain: string): string | null {
  if (sourceDomain === 'linkedin.com' || sourceUrl.includes('linkedin.com')) {
    return sourceUrl;
  }
  return null;
}

/**
 * Complete flow: Save search result to database
 * Creates Person, UserCandidate, SourceLink, and EmailDraft
 */
export async function saveSearchResult(
  userId: string,
  searchResult: SearchResult,
  emailResult: EmailResult,
  university: string,
  draftData: EmailDraftData
): Promise<{
  personId: string;
  userCandidateId: string;
  emailDraftId: string;
}> {
  // Extract LinkedIn URL
  const linkedinUrl = extractLinkedInUrl(searchResult.sourceUrl, searchResult.sourceDomain);

  // 1. Create/update Person
  const person = await createOrUpdatePerson({
    fullName: searchResult.fullName,
    firstName: searchResult.firstName,
    lastName: searchResult.lastName,
    company: searchResult.company,
    role: searchResult.role,
    linkedinUrl,
  });

  // 2. Update Person email if we have one (smart update logic)
  // Check if email was already updated by getOrFindEmail to avoid duplicate work
  if (emailResult.email) {
    const currentPerson = await prisma.person.findUnique({
      where: { id: person.id },
      select: {
        email: true,
        emailStatus: true,
        emailConfidence: true,
        emailLastUpdated: true,
      },
    });

    // Only update if email wasn't already set by getOrFindEmail
    // Check if current email matches what we're trying to save, or if it's missing/null
    const emailAlreadyUpdated = 
      currentPerson?.email === emailResult.email &&
      currentPerson?.emailStatus === emailResult.status &&
      currentPerson?.emailConfidence === emailResult.confidence;

    if (!emailAlreadyUpdated) {
      await updatePersonEmailIfBetter(
        person.id,
        emailResult.email,
        emailResult.status,
        emailResult.confidence
      );
    }
  }

  // 3. Create SourceLink
  await createSourceLink(person.id, {
    url: searchResult.sourceUrl,
    title: searchResult.sourceTitle,
    snippet: searchResult.sourceSnippet,
    domain: searchResult.sourceDomain,
    kind: 'DISCOVERY',
  });

  // 4. Create/update UserCandidate
  const userCandidate = await createOrUpdateUserCandidate(userId, person.id, {
    email: emailResult.email,
    emailStatus: emailResult.status,
    emailConfidence: emailResult.confidence,
    university,
  });

  // 5. Create/update EmailDraft
  const emailDraft = await createOrUpdateEmailDraft(userCandidate.id, draftData);

  return {
    personId: person.id,
    userCandidateId: userCandidate.id,
    emailDraftId: emailDraft.id,
  };
}

/**
 * Gets all Person keys that a user has already discovered
 * Returns a Set of keys in format: "fullName_company" (lowercase) for fast lookup
 * Used to filter out already-discovered people from search results
 */
export async function getDiscoveredPersonKeys(
  userId: string
): Promise<Set<string>> {
  const userCandidates = await prisma.userCandidate.findMany({
    where: { userId },
    select: {
      person: {
        select: {
          fullName: true,
          company: true,
        },
      },
    },
  });

  const keys = new Set<string>();
  for (const uc of userCandidates) {
    const key = `${uc.person.fullName}_${uc.person.company}`.toLowerCase();
    keys.add(key);
  }

  return keys;
}

/**
 * Gets Person keys that should be excluded from search results
 * Excludes people who:
 * - Have been successfully emailed (SendLog with status = SUCCESS)
 * - Have been marked as "do not show again" (doNotShow = true)
 * 
 * Note: People discovered in prior searches but NOT sent emails and NOT marked
 * "do not show again" will still appear in new searches.
 * 
 * Returns a Set of keys in format: "fullName_company" (lowercase) for fast lookup
 */
export async function getExcludedPersonKeys(
  userId: string
): Promise<Set<string>> {
  const userCandidates = await prisma.userCandidate.findMany({
    where: {
      userId,
      OR: [
        { doNotShow: true },
        {
          sendLogs: {
            some: {
              status: 'SUCCESS',
            },
          },
        },
      ],
    },
    select: {
      person: {
        select: {
          fullName: true,
          company: true,
        },
      },
    },
  });

  const keys = new Set<string>();
  for (const uc of userCandidates) {
    const key = `${uc.person.fullName}_${uc.person.company}`.toLowerCase();
    keys.add(key);
  }

  return keys;
}
