import prisma from '@/lib/prisma';
import { SearchResult } from '@/lib/services/discovery';
import { EmailResult, EducationInfo, EmploymentInfo } from '@/lib/services/enrichment';
import { EmailStatus } from '@prisma/client';
import { ScrapedProfile } from '@/lib/services/linkedin-scraper';

// Personal email domains - emails from these are UNVERIFIED
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'ymail.com',
  'live.com', 'msn.com', 'me.com', 'mac.com', 'inbox.com'
]);

/**
 * Check if email is from a work domain (not personal)
 * Work emails are considered VERIFIED, personal emails are UNVERIFIED
 */
export function getEmailStatus(email: string | null): 'VERIFIED' | 'UNVERIFIED' | 'MISSING' {
  if (!email) return 'MISSING';
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return 'UNVERIFIED';
  return PERSONAL_DOMAINS.has(domain) ? 'UNVERIFIED' : 'VERIFIED';
}

export interface PersonData {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  linkedinUrl?: string | null;
  // Location fields
  city?: string | null;
  state?: string | null;
  country?: string | null;
  // Education fields
  education?: EducationInfo | null;
  // Apollo enrichment timestamp
  apolloEnrichedAt?: Date | null;
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
  attachResume?: boolean;
  resumeId?: string | null;
}

/**
 * Creates or updates a Person record (shared across all users)
 */
export async function createOrUpdatePerson(
  personData: PersonData
): Promise<{ id: string }> {
  // Build create data with optional fields
  const createData: Record<string, unknown> = {
    fullName: personData.fullName,
    firstName: personData.firstName,
    lastName: personData.lastName,
    company: personData.company,
    role: personData.role,
    linkedinUrl: personData.linkedinUrl || null,
  };

  // Add location if available
  if (personData.city) createData.city = personData.city;
  if (personData.state) createData.state = personData.state;
  if (personData.country) createData.country = personData.country;

  // Add education if available
  if (personData.education) {
    if (personData.education.schoolName) createData.educationSchool = personData.education.schoolName;
    if (personData.education.degree) createData.educationDegree = personData.education.degree;
    if (personData.education.fieldOfStudy) createData.educationField = personData.education.fieldOfStudy;
    if (personData.education.graduationYear) createData.educationYear = personData.education.graduationYear;
  }

  // Set apolloEnrichedAt if provided (indicates Apollo data was fetched)
  if (personData.apolloEnrichedAt) {
    createData.apolloEnrichedAt = personData.apolloEnrichedAt;
  }

  // Build update data - only update if we have new info
  const updateData: Record<string, unknown> = {};
  if (personData.role) updateData.role = personData.role;
  if (personData.linkedinUrl) updateData.linkedinUrl = personData.linkedinUrl;
  if (personData.city) updateData.city = personData.city;
  if (personData.state) updateData.state = personData.state;
  if (personData.country) updateData.country = personData.country;
  if (personData.education?.schoolName) updateData.educationSchool = personData.education.schoolName;
  if (personData.education?.degree) updateData.educationDegree = personData.education.degree;
  if (personData.education?.fieldOfStudy) updateData.educationField = personData.education.fieldOfStudy;
  if (personData.education?.graduationYear) updateData.educationYear = personData.education.graduationYear;
  if (personData.apolloEnrichedAt) updateData.apolloEnrichedAt = personData.apolloEnrichedAt;

  const person = await prisma.person.upsert({
    where: {
      fullName_company: {
        fullName: personData.fullName,
        company: personData.company,
      },
    },
    create: createData as any,
    update: updateData,
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
      attachResume: draftData.attachResume || false,
      resumeId: draftData.resumeId || null,
      status: 'APPROVED', // Template replacement is immediate, no AI processing needed
    },
    update: {
      // Update draft if regenerated
      subject: draftData.subject,
      body: draftData.body,
      templateId: draftData.templateId || undefined,
      attachResume: draftData.attachResume !== undefined ? draftData.attachResume : undefined,
      resumeId: draftData.resumeId !== undefined ? (draftData.resumeId || null) : undefined,
      status: 'APPROVED', // Template replacement is immediate
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
  newConfidence: number,
  existingPersonData?: { email: string | null; emailStatus: string; emailConfidence: number | null }
): Promise<void> {
  // Use provided data if available, otherwise query
  const person = existingPersonData || await prisma.person.findUnique({
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
  emailResult: EmailResult & { existingPerson?: { id: string; email: string | null; emailStatus: string; emailConfidence: number | null } },
  university: string,
  draftData: EmailDraftData
): Promise<{
  personId: string;
  userCandidateId: string;
  emailDraftId: string;
  linkedinUrl: string | null;
}> {
  // Extract LinkedIn URL
  const linkedinUrl = extractLinkedInUrl(searchResult.sourceUrl, searchResult.sourceDomain);

  // Use Apollo's employment data for company and role
  // If Apollo doesn't provide employment data, this should have been filtered out earlier
  const company = emailResult.employment?.company || searchResult.company;
  const role = emailResult.employment?.title || searchResult.role;

  // 1. Create/update Person (including location, education, company and role from Apollo)
  // Set apolloEnrichedAt to now since this data comes from Apollo
  const person = await createOrUpdatePerson({
    fullName: searchResult.fullName,
    firstName: searchResult.firstName,
    lastName: searchResult.lastName,
    company: company,
    role: role,
    linkedinUrl,
    // Pass through location and education data from Apollo
    city: emailResult.city,
    state: emailResult.state,
    country: emailResult.country,
    education: emailResult.education,
    // Track when Apollo data was fetched (for 30-day TTL)
    apolloEnrichedAt: new Date(),
  });

  // Get the person's LinkedIn URL (may have been updated or already existed)
  const personWithLinkedIn = await prisma.person.findUnique({
    where: { id: person.id },
    select: { linkedinUrl: true },
  });
  const finalLinkedInUrl = personWithLinkedIn?.linkedinUrl || null;

  // 2. Update Person email if we have one (smart update logic)
  // Use existingPerson data if available to avoid redundant query
  if (emailResult.email) {
    let emailAlreadyUpdated = false;
    
    if (emailResult.existingPerson) {
      // Use existing person data - no need to query
      emailAlreadyUpdated = 
        emailResult.existingPerson.email === emailResult.email &&
        emailResult.existingPerson.emailStatus === emailResult.status &&
        emailResult.existingPerson.emailConfidence === emailResult.confidence;
      
      if (!emailAlreadyUpdated) {
        // Use existing person ID and data
        await updatePersonEmailIfBetter(
          emailResult.existingPerson.id,
          emailResult.email,
          emailResult.status,
          emailResult.confidence,
          {
            email: emailResult.existingPerson.email,
            emailStatus: emailResult.existingPerson.emailStatus,
            emailConfidence: emailResult.existingPerson.emailConfidence,
          }
        );
      }
    } else {
      // Fallback: query if existingPerson not provided (shouldn't happen in normal flow)
      const currentPerson = await prisma.person.findUnique({
        where: { id: person.id },
        select: {
          email: true,
          emailStatus: true,
          emailConfidence: true,
          emailLastUpdated: true,
        },
      });

      emailAlreadyUpdated = 
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
    linkedinUrl: finalLinkedInUrl,
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

/**
 * Filter criteria for querying Person table
 */
export interface PersonFilters {
  company: string;           // Required - ILIKE match
  location?: string;         // Optional - city ILIKE match
  role?: string;             // Optional - role ILIKE match
  university?: string;       // Optional - educationSchool ILIKE match
  requireEmail?: boolean;    // Default true - only return people with emails
  excludePersonKeys?: Set<string>; // Set of "fullName_company" keys to exclude
  limit: number;
}

/**
 * Find people in the database matching the given filters
 * This is the main query function for the database-first search approach
 */
export async function findPeopleByFilters(filters: PersonFilters): Promise<
  Array<{
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
  }>
> {
  const { company, location, role, university, requireEmail = true, excludePersonKeys, limit } = filters;

  // Normalize company name for matching (remove dots, extra spaces)
  // "L.E.K. Consulting" → "LEK Consulting", "LEK Consulting" → "LEK Consulting"
  const normalizeCompany = (name: string) =>
    name.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Build where clause
  // Note: Company matching is done post-query for fuzzy matching (L.E.K. = LEK)
  const where: Record<string, unknown> = {};
  const normalizedSearchCompany = company ? normalizeCompany(company) : null;

  // Company filter - loose DB filter, then strict post-query filter
  // Use OR query with first word AND longest word to catch both "ZS" and "ZS Associates"
  if (company && company.trim()) {
    const words = company.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(w => w.length >= 2);
    if (words.length > 0) {
      const firstWord = words[0];
      const longestWord = words.reduce((a, b) => (a.length >= b.length ? a : b), '');

      if (firstWord === longestWord) {
        where.company = { contains: firstWord, mode: 'insensitive' };
      } else {
        // Use OR to match either first word or longest word
        where.OR = [
          { company: { contains: firstWord, mode: 'insensitive' } },
          { company: { contains: longestWord, mode: 'insensitive' } },
        ];
      }
    }
  }

  // Location filter - city must contain search term
  if (location && location.trim()) {
    where.city = { contains: location.trim(), mode: 'insensitive' };
  }

  // Role filter - role must contain search term
  if (role && role.trim()) {
    where.role = { contains: role.trim(), mode: 'insensitive' };
  }

  // University filter - educationSchool must contain search term
  if (university && university.trim()) {
    where.educationSchool = { contains: university.trim(), mode: 'insensitive' };
  }

  // Email filter - must have email
  if (requireEmail) {
    where.email = { not: null };
  }

  // Query the database
  const people = await prisma.person.findMany({
    where,
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
      city: true,
      state: true,
      country: true,
      educationSchool: true,
      educationDegree: true,
      educationField: true,
      educationYear: true,
      sourceLinks: {
        where: { kind: 'DISCOVERY' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          url: true,
          title: true,
          snippet: true,
          domain: true,
        },
      },
    },
    orderBy: [
      { emailStatus: 'asc' }, // VERIFIED first
      { emailConfidence: 'desc' },
    ],
    take: limit * 2, // Get extra to allow for exclusions
  });

  // Filter by company (fuzzy match: "LEK" matches "L.E.K.", "ZS" matches "ZS Associates")
  // Bidirectional: either company can contain the other
  let filtered = people;
  if (normalizedSearchCompany) {
    filtered = people.filter((person) => {
      const normalizedPersonCompany = normalizeCompany(person.company);
      return normalizedPersonCompany.includes(normalizedSearchCompany) ||
             normalizedSearchCompany.includes(normalizedPersonCompany);
    });
  }

  // Filter out excluded people
  if (excludePersonKeys && excludePersonKeys.size > 0) {
    filtered = filtered.filter((person) => {
      const key = `${person.fullName}_${person.company}`.toLowerCase();
      return !excludePersonKeys.has(key);
    });
  }

  return filtered.slice(0, limit);
}

/**
 * Save a person discovered via CSE + Apollo enrichment
 * Returns the person ID (existing or newly created)
 */
export async function saveDiscoveredPerson(
  fullName: string,
  firstName: string | null,
  lastName: string | null,
  linkedinUrl: string | null,
  sourceUrl: string,
  sourceTitle: string,
  sourceSnippet: string | null,
  sourceDomain: string | null,
  apolloData: {
    company: string; // Search company (fallback)
    apolloCompany?: string | null; // Apollo's current employer (source of truth)
    role: string | null;
    email: string | null;
    emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
    emailConfidence: number;
    city: string | null;
    state: string | null;
    country: string | null;
    education: {
      schoolName: string | null;
      degree: string | null;
      fieldOfStudy: string | null;
      graduationYear: string | null;
    } | null;
    apolloStatus?: 'SUCCESS' | 'NOT_FOUND' | 'API_ERROR' | 'SKIPPED';
  },
  searchUniversity?: string | null // Fallback university from search params
): Promise<{ personId: string; isNew: boolean }> {
  // Use Apollo's company if available, otherwise fall back to search company
  const resolvedCompany = apolloData.apolloCompany || apolloData.company;

  // Check if person already exists - try resolvedCompany first, then fallback to search company
  // This handles both new records (saved with Apollo company) and legacy records (saved with search company)
  let existing = await prisma.person.findUnique({
    where: {
      fullName_company: {
        fullName,
        company: resolvedCompany,
      },
    },
    select: { id: true },
  });

  // Fallback: check if they exist with the search company (legacy data)
  if (!existing && apolloData.apolloCompany && apolloData.apolloCompany !== apolloData.company) {
    existing = await prisma.person.findUnique({
      where: {
        fullName_company: {
          fullName,
          company: apolloData.company,
        },
      },
      select: { id: true },
    });
  }

  if (existing) {
    // Update with fresh Apollo data
    // Only set apolloEnrichedAt if status is SUCCESS or NOT_FOUND (not for API_ERROR)
    const shouldSetEnrichedAt = apolloData.apolloStatus === 'SUCCESS' || apolloData.apolloStatus === 'NOT_FOUND';

    // Use Apollo education if available, otherwise fallback to search university
    const educationSchool = apolloData.education?.schoolName || searchUniversity || undefined;

    await prisma.person.update({
      where: { id: existing.id },
      data: {
        company: resolvedCompany, // Update company from Apollo if available
        role: apolloData.role || undefined,
        email: apolloData.email || undefined,
        emailStatus: apolloData.email ? apolloData.emailStatus : undefined,
        emailConfidence: apolloData.email ? apolloData.emailConfidence : undefined,
        city: apolloData.city || undefined,
        state: apolloData.state || undefined,
        country: apolloData.country || undefined,
        educationSchool,
        educationDegree: apolloData.education?.degree || undefined,
        educationField: apolloData.education?.fieldOfStudy || undefined,
        educationYear: apolloData.education?.graduationYear || undefined,
        apolloEnrichedAt: shouldSetEnrichedAt ? new Date() : undefined,
        apolloStatus: apolloData.apolloStatus || undefined,
        linkedinUrl: linkedinUrl || undefined,
      },
    });

    return { personId: existing.id, isNew: false };
  }

  // Create new person
  // Only set apolloEnrichedAt if status is SUCCESS or NOT_FOUND (not for API_ERROR)
  const shouldSetEnrichedAt = apolloData.apolloStatus === 'SUCCESS' || apolloData.apolloStatus === 'NOT_FOUND';

  // Use Apollo education if available, otherwise fallback to search university
  const educationSchool = apolloData.education?.schoolName || searchUniversity || null;

  const person = await prisma.person.create({
    data: {
      fullName,
      firstName,
      lastName,
      company: resolvedCompany, // Use Apollo's company if available
      role: apolloData.role,
      linkedinUrl,
      email: apolloData.email,
      emailStatus: apolloData.email ? apolloData.emailStatus : 'MISSING',
      emailConfidence: apolloData.emailConfidence,
      city: apolloData.city,
      state: apolloData.state,
      country: apolloData.country,
      educationSchool,
      educationDegree: apolloData.education?.degree,
      educationField: apolloData.education?.fieldOfStudy,
      educationYear: apolloData.education?.graduationYear,
      apolloEnrichedAt: shouldSetEnrichedAt ? new Date() : null,
      apolloStatus: apolloData.apolloStatus || null,
    },
  });

  // Create source link
  await prisma.sourceLink.create({
    data: {
      personId: person.id,
      kind: 'DISCOVERY',
      url: sourceUrl,
      title: sourceTitle,
      snippet: sourceSnippet,
      domain: sourceDomain,
    },
  });

  return { personId: person.id, isNew: true };
}

/**
 * Find existing people by LinkedIn URLs
 * Returns a Map of linkedinUrl -> person data for fast lookup
 */
export async function findPeopleByLinkedInUrls(
  linkedinUrls: string[]
): Promise<Map<string, {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  email: string | null;
  emailStatus: string | null;
  emailConfidence: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  educationDegree: string | null;
  educationField: string | null;
  educationYear: string | null;
  linkedinUrl: string | null;
  scrapedAt: Date | null;
  sourceLinks: Array<{
    url: string;
    title: string;
    snippet: string | null;
    domain: string | null;
  }>;
}>> {
  if (linkedinUrls.length === 0) {
    return new Map();
  }

  const people = await prisma.person.findMany({
    where: {
      linkedinUrl: { in: linkedinUrls },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      role: true,
      email: true,
      emailStatus: true,
      emailConfidence: true,
      city: true,
      state: true,
      country: true,
      educationSchool: true,
      educationDegree: true,
      educationField: true,
      educationYear: true,
      linkedinUrl: true,
      scrapedAt: true,
      sourceLinks: {
        where: { kind: 'DISCOVERY' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          url: true,
          title: true,
          snippet: true,
          domain: true,
        },
      },
    },
  });

  const map = new Map<string, typeof people[0]>();
  for (const person of people) {
    if (person.linkedinUrl) {
      map.set(person.linkedinUrl, person);
    }
  }

  return map;
}

/**
 * Save a scraped LinkedIn profile to the database
 *
 * Field mapping from LinkedIn Scraper → Person model:
 * ─────────────────────────────────────────────────────
 * linkedinUrl       → linkedinUrl
 * fullName          → fullName
 * firstName         → firstName
 * lastName          → lastName
 * email             → email (emailStatus = UNVERIFIED if present, MISSING if not)
 * company           → company (from currentPosition or experience)
 * role              → role (from experience[0].position)
 * city              → city (from location.parsed or experience location)
 * state             → state (from location.parsed or experience location)
 * country           → country (from location.parsed or experience location)
 * schools           → schools (all schools, normalized and deduplicated)
 * educationSchool   → educationSchool (primary school = schools[0])
 */
export async function saveScrapedProfile(
  profile: ScrapedProfile,
  sourceUrl: string,
  sourceTitle: string,
  sourceSnippet: string | null,
  sourceDomain: string | null,
  searchCompany: string, // Fallback if scraper didn't find company
  searchUniversity?: string | null // Fallback if scraper didn't find school
): Promise<{ personId: string; isNew: boolean }> {
  // Use scraped company or fall back to search company
  const company = profile.company || searchCompany;

  // Use scraped schools array or fall back to search university
  const schools = profile.schools.length > 0
    ? profile.schools
    : (searchUniversity ? [searchUniversity] : []);

  // Primary school is first in array
  const educationSchool = schools[0] || null;

  // Check if person already exists by LinkedIn URL
  const existingByUrl = await prisma.person.findFirst({
    where: { linkedinUrl: profile.linkedinUrl },
    select: { id: true },
  });

  if (existingByUrl) {
    // Update with fresh scraped data
    await prisma.person.update({
      where: { id: existingByUrl.id },
      data: {
        fullName: profile.fullName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        company,
        role: profile.role,
        email: profile.email,
        emailStatus: getEmailStatus(profile.email),
        emailConfidence: profile.email ? 50 : 0, // Lower confidence for scraped emails
        city: profile.city,
        state: profile.state,
        country: profile.country,
        schools: schools.length > 0 ? schools : undefined,
        educationSchool,
        scrapedAt: new Date(),
      },
    });

    return { personId: existingByUrl.id, isNew: false };
  }

  // Check if person exists by fullName + company (legacy records without LinkedIn URL)
  const existingByName = await prisma.person.findUnique({
    where: {
      fullName_company: {
        fullName: profile.fullName,
        company,
      },
    },
    select: { id: true },
  });

  if (existingByName) {
    // Update with LinkedIn URL and fresh data
    await prisma.person.update({
      where: { id: existingByName.id },
      data: {
        linkedinUrl: profile.linkedinUrl,
        role: profile.role,
        email: profile.email || undefined,
        emailStatus: profile.email ? getEmailStatus(profile.email) : undefined,
        emailConfidence: profile.email ? 50 : undefined,
        city: profile.city,
        state: profile.state,
        country: profile.country,
        schools: schools.length > 0 ? schools : undefined,
        educationSchool: educationSchool || undefined,
        scrapedAt: new Date(),
      },
    });

    return { personId: existingByName.id, isNew: false };
  }

  // Create new person
  const person = await prisma.person.create({
    data: {
      fullName: profile.fullName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      company,
      role: profile.role,
      linkedinUrl: profile.linkedinUrl,
      email: profile.email,
      emailStatus: getEmailStatus(profile.email),
      emailConfidence: profile.email ? 50 : 0,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      schools: schools.length > 0 ? schools : undefined,
      educationSchool,
      scrapedAt: new Date(),
    },
  });

  // Create source link
  await prisma.sourceLink.create({
    data: {
      personId: person.id,
      kind: 'DISCOVERY',
      url: sourceUrl,
      title: sourceTitle,
      snippet: sourceSnippet,
      domain: sourceDomain,
    },
  });

  return { personId: person.id, isNew: true };
}
