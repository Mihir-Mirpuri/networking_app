import prisma from '@/lib/prisma';
import { SearchResult } from '@/lib/services/discovery';
import { EmailResult, EducationInfo, EmploymentInfo } from '@/lib/services/enrichment';
import { EmailStatus } from '@prisma/client';
import { ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { updatePersonRoleEmbedding, getSearchRoleEmbedding } from '@/lib/services/embeddings';
import { Prisma } from '@prisma/client';

// Personal email domains - emails from these are UNVERIFIED
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'ymail.com',
  'live.com', 'msn.com', 'me.com', 'mac.com', 'inbox.com'
]);

/**
 * Check if a person's company matches the search company.
 * Uses bidirectional substring matching with word-boundary awareness for short terms.
 * For known companies, callers should use pre-resolved aliases via companyAliases filter
 * (which does exact matching at the DB level) instead of this function.
 */
export function companiesMatch(normalizedPersonCompany: string, normalizedSearchCompany: string): boolean {
  // For short search terms (<=3 chars), require word boundary match
  if (normalizedSearchCompany.length <= 3) {
    const regex = new RegExp(`(^|\\s|-)${escapeRegex(normalizedSearchCompany)}($|\\s|-)`, 'i');
    return regex.test(normalizedPersonCompany) || normalizedPersonCompany === normalizedSearchCompany;
  }

  // For longer terms, use bidirectional includes
  return normalizedPersonCompany.includes(normalizedSearchCompany) ||
         normalizedSearchCompany.includes(normalizedPersonCompany);
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Normalize company name for consistent storage
 *
 * Handles variations like:
 * - "Boston Consulting Group (BCG)" → "Boston Consulting Group"
 * - "The Boston Consulting Group" → "Boston Consulting Group"
 * - "McKinsey & Company, Inc." → "McKinsey & Company"
 * - "Deloitte LLP" → "Deloitte"
 */
export function normalizeCompanyForStorage(company: string): string {
  if (!company) return company;

  let normalized = company.trim();

  // Remove leading "The " (case insensitive)
  normalized = normalized.replace(/^The\s+/i, '');

  // Remove parenthetical suffixes like "(BCG)", "(US)", "(NYSE: XYZ)"
  normalized = normalized.replace(/\s*\([^)]+\)\s*$/, '');

  // Remove ", Inc." or ", LLC" etc. but keep "& Company"
  normalized = normalized.replace(/,\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation)$/i, '');

  // Remove standalone legal suffixes (not preceded by &)
  normalized = normalized.replace(/\s+(Inc\.?|LLC|LLP|Ltd\.?|Corp\.?|Corporation|Co\.)$/i, '');

  // Clean up extra whitespace and trailing punctuation
  normalized = normalized.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/[,&]\s*$/, '').trim();

  return normalized;
}

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
export async function getExcludedPersonIds(
  userId: string
): Promise<string[]> {
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
      personId: true,
    },
  });

  return userCandidates.map(uc => uc.personId);
}

/**
 * Role alias groups — each group contains equivalent role names (all lowercase).
 * When searching for any term in a group, all terms are used for DB filtering.
 * Follows the same pattern as the CompanyAlias DB table.
 */
const ROLE_ALIAS_GROUPS: string[][] = [
  // Finance — seniority levels
  ['vice president', 'vp'],
  ['senior vice president', 'svp', 'senior vp', 'sr vice president', 'sr. vice president'],
  ['executive vice president', 'evp', 'executive vp'],
  ['assistant vice president', 'avp', 'assistant vp'],
  ['managing director', 'md'],
  ['managing director & partner', 'md & partner', 'managing director and partner'],

  // Finance — divisions
  ['investment banking', 'ib', 'ibd', 'investment banking division'],
  ['private equity', 'pe'],
  ['asset management', 'am', 'asset mgmt'],
  ['sales & trading', 'sales and trading', 's&t'],
  ['wealth management', 'wm', 'private wealth management', 'pwm'],
  ['research analyst', 'research associate'],

  // Consulting — firm-specific titles
  ['business analyst', 'ba'],
  ['senior business analyst', 'sba', 'sr business analyst', 'sr. business analyst'],
  ['engagement manager', 'em'],
  ['case team leader', 'ctl'],
  ['project leader', 'pl'],
  ['associate principal', 'ap'],
  ['associate consultant', 'assoc consultant', 'assoc. consultant'],
  ['consultant', 'consulting'],

  // Consulting — seniority variations (sr/senior/jr/junior)
  ['junior consultant', 'jr consultant', 'jr. consultant'],
  ['senior consultant', 'sr consultant', 'sr. consultant'],
  ['senior manager', 'sr manager', 'sr. manager'],
  ['senior director', 'sr director', 'sr. director'],
  ['senior analyst', 'sr analyst', 'sr. analyst'],
  ['senior associate', 'sr associate', 'sr. associate'],
  ['associate partner', 'assoc partner', 'assoc. partner'],

  // Product/Tech
  ['product manager', 'pm', 'product mgr'],
  ['associate product manager', 'apm', 'assoc product manager', 'assoc. product manager'],
  ['senior product manager', 'sr product manager', 'sr. product manager', 'senior pm', 'sr pm', 'sr. pm'],
  ['product manager technical', 'technical product manager', 'tpm', 'technical pm'],
  ['program manager', 'pgm', 'program mgr'],
  ['rotational product manager', 'rpm', 'rotational pm'],
  ['project manager', 'project mgr'],

  // Recruiting/Talent Acquisition — single group so "Recruiter" dropdown matches all variations
  ['recruiter', 'recruiting', 'talent acquisition', 'talent acquisition specialist',
   'campus recruiter', 'university recruiter', 'campus recruiting', 'university recruiting',
   'university relations', 'early careers recruiter', 'senior recruiter', 'sr recruiter',
   'sr. recruiter', 'lead recruiter', 'recruiting manager', 'talent acquisition manager',
   'recruiting lead', 'head of recruiting', 'head of talent acquisition',
   'recruiting coordinator', 'talent acquisition coordinator',
   'technical recruiter', 'tech recruiter', 'executive recruiter', 'executive search'],
];

// Build reverse lookup: normalized term → all terms in its group
const _roleAliasLookup = new Map<string, string[]>();
for (const group of ROLE_ALIAS_GROUPS) {
  for (const term of group) {
    _roleAliasLookup.set(term, group);
  }
}

/**
 * Get all equivalent role terms for DB filtering.
 * Returns the alias group if the role matches one, otherwise just the original term.
 */
export function getRoleSearchTerms(role: string): string[] {
  const normalized = role.trim().toLowerCase();
  return _roleAliasLookup.get(normalized) || [normalized];
}

/**
 * Check if two normalized role strings are aliases of each other.
 */
export function areRolesAliased(role1: string, role2: string): boolean {
  const group = _roleAliasLookup.get(role1);
  if (!group) return false;
  return group.includes(role2);
}

/**
 * Filter criteria for querying Person table
 */
export interface PersonFilters {
  company: string;           // Required - ILIKE match (primary company or first for multi)
  companies?: string[];      // All searched companies (for multi-company post-filter)
  companyAliases?: string[]; // Pre-resolved aliases (exact match, skips post-query filter)
  location?: string;         // Optional - city ILIKE match
  role?: string;             // Optional - role ILIKE match
  university?: string;       // Optional - educationSchool ILIKE match
  requireEmail?: boolean;    // Default true - only return people with emails
  excludePersonIds?: string[]; // Person IDs to exclude (already displayed + sent/hidden)
  limit: number;
}

// Normalize company name for matching (remove dots, extra spaces)
// "L.E.K. Consulting" → "LEK Consulting", "LEK Consulting" → "LEK Consulting"
export const normalizeCompanyForMatch = (name: string) =>
  name.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Build Prisma where clause from PersonFilters.
 * Shared between findPeopleByFilters and countPeopleByFilters.
 */
export function buildPersonWhereClause(filters: Omit<PersonFilters, 'limit'>, schoolMatchIds?: string[]): Record<string, unknown> {
  const { company, location, role, university, requireEmail = true, excludePersonIds } = filters;

  const where: Record<string, unknown> = {};

  // Exclude already-displayed people (prevents duplicates when prescrape shifts offset positions)
  if (excludePersonIds && excludePersonIds.length > 0) {
    where.id = { notIn: excludePersonIds };
  }

  // Company filter — use pre-resolved aliases (exact match) or fall back to alias mapping
  if (filters.companyAliases && filters.companyAliases.length > 0) {
    // Exact-match OR query for each resolved alias — zero false positives
    const aliasFilters = filters.companyAliases.map(alias => ({
      company: { equals: alias, mode: 'insensitive' as const }
    }));
    if (aliasFilters.length === 1) {
      where.company = aliasFilters[0].company;
    } else {
      where.OR = aliasFilters;
    }
  } else if (company && company.trim()) {
    // Simple contains fallback — all real search paths use companyAliases
    where.company = { contains: company.trim(), mode: 'insensitive' as const };
  }

  // Location filter
  if (location && location.trim()) {
    where.city = { contains: location.trim(), mode: 'insensitive' };
  }

  // Role filter — expand with aliases (e.g., "Vice President" also matches "VP")
  if (role && role.trim()) {
    const roleTerms = getRoleSearchTerms(role);
    if (roleTerms.length === 1) {
      where.role = { contains: roleTerms[0], mode: 'insensitive' };
    } else {
      if (!where.AND) where.AND = [];
      (where.AND as unknown[]).push({
        OR: roleTerms.map(term => ({
          role: { contains: term, mode: 'insensitive' as const }
        }))
      });
    }
  }

  // University filter — check all schools, not just the primary one.
  // educationSchool uses Prisma ILIKE (case-insensitive). For the schools JSON
  // array, callers pre-query matching IDs via raw SQL and pass them in.
  if (university && university.trim()) {
    const uniConditions: Record<string, unknown>[] = [
      { educationSchool: { contains: university.trim(), mode: 'insensitive' as const } },
    ];
    if (schoolMatchIds && schoolMatchIds.length > 0) {
      uniConditions.push({ id: { in: schoolMatchIds } });
    }
    if (!where.AND) where.AND = [];
    (where.AND as unknown[]).push({ OR: uniConditions });
  }

  // Never show people without a role (they display as "Professional" in the UI)
  if (!where.AND) where.AND = [];
  (where.AND as unknown[]).push({ role: { not: null } });

  // Exclude people whose role indicates they haven't started yet (e.g., "Incoming Analyst")
  (where.AND as unknown[]).push({
    NOT: { role: { startsWith: 'incoming ', mode: 'insensitive' as const } }
  });
  (where.AND as unknown[]).push({
    NOT: { role: { startsWith: 'future ', mode: 'insensitive' as const } }
  });

  // Email filter - must have email AND not be marked as undeliverable
  if (requireEmail) {
    where.email = { not: null };
    if (!where.AND) where.AND = [];
    (where.AND as unknown[]).push({
      OR: [{ emailDeliverable: true }, { emailDeliverable: null }]
    });
  } else {
    // Even without requireEmail, exclude people Apollo already tried and couldn't find
    // an email for — showing them would just lead to a failed send.
    if (!where.AND) where.AND = [];
    (where.AND as unknown[]).push({
      NOT: { email: null, apolloEnrichedAt: { not: null } }
    });
    // Also exclude bounced/undeliverable people
    (where.AND as unknown[]).push({
      OR: [{ emailDeliverable: true }, { emailDeliverable: null }]
    });
  }

  return where;
}

/**
 * Pre-query person IDs whose `schools` JSON array matches a university term
 * (case-insensitive). Used to supplement the Prisma path which can't do ILIKE on JSON.
 */
async function getSchoolMatchIds(university: string): Promise<string[]> {
  const uniTerm = '%' + university.trim() + '%';
  const matches = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Person" WHERE schools::text ILIKE ${uniTerm}`
  );
  return matches.map(r => r.id);
}

/**
 * Apply post-query filtering: company fuzzy match.
 * Person exclusions (sent/hidden) are handled at the DB level via excludePersonIds.
 */
export function applyPostQueryFilters<T extends { company: string }>(
  people: T[],
  searchCompany: string | string[] | undefined
): T[] {
  if (!searchCompany) return people;
  const companies = Array.isArray(searchCompany) ? searchCompany : [searchCompany];
  const normalized = companies.map(c => normalizeCompanyForMatch(c)).filter(Boolean);
  if (normalized.length === 0) return people;

  return people.filter((person) => {
    const np = normalizeCompanyForMatch(person.company);
    return normalized.some(nsc => companiesMatch(np, nsc));
  });
}

/**
 * Find people in the database matching the given filters.
 * Supports offset-based pagination with stable sorting for consistent results.
 */
export type PersonResult = {
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
  roleDistance?: number;
  sourceLinks: Array<{
    url: string;
    title: string;
    snippet: string | null;
    domain: string | null;
  }>;
};

/**
 * Check if vector-based role matching is enabled.
 * Requires OPENAI_API_KEY to be set and USE_VECTOR_ROLE_MATCHING !== 'false'.
 */
export function isVectorRoleMatchingEnabled(): boolean {
  return process.env.USE_VECTOR_ROLE_MATCHING !== 'false' && !!process.env.OPENAI_API_KEY;
}

export async function findPeopleByFilters(filters: PersonFilters): Promise<PersonResult[]> {
  const { company, role, limit } = filters;

  // Dispatch to vector path if role provided and vector matching is enabled
  if (role && role.trim() && isVectorRoleMatchingEnabled()) {
    const searchEmbedding = await getSearchRoleEmbedding(role);
    if (searchEmbedding) {
      console.log(`[PersonService] Using VECTOR path for role="${role}" | company="${company}" | aliases=${filters.companyAliases?.length ?? 0} | limit=${limit}`);
      return findPeopleByFiltersVector(filters, searchEmbedding);
    }
    console.warn(`[PersonService] Embedding FAILED for role="${role}" — falling back to ILIKE path`);
  } else if (role && role.trim()) {
    console.log(`[PersonService] Vector matching disabled (OPENAI_API_KEY=${!!process.env.OPENAI_API_KEY}, USE_VECTOR_ROLE_MATCHING=${process.env.USE_VECTOR_ROLE_MATCHING}) — using ILIKE path`);
  } else {
    console.log(`[PersonService] No role filter — using ILIKE path`);
  }

  // Fallback: existing Prisma path
  const roleTerms = role ? getRoleSearchTerms(role) : [];
  console.log(`[PersonService] ILIKE path: role="${role}" → terms=${JSON.stringify(roleTerms)} | company="${company}" | aliases=${filters.companyAliases?.length ?? 0} | limit=${limit}`);

  const schoolMatchIds = filters.university?.trim() ? await getSchoolMatchIds(filters.university) : undefined;
  const where = buildPersonWhereClause(filters, schoolMatchIds);

  // excludePersonIds (NOT IN) handles pagination at the DB level,
  // so no OFFSET needed — always fetch the top-ranked unseen people.
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
      { emailStatus: 'asc' },       // VERIFIED first
      { emailConfidence: 'desc' },
      { createdAt: 'asc' },          // Stable sort — new people go to end
    ],
    take: limit * 2, // Overfetch to compensate for post-query filtering
  });

  console.log(`[ILIKEQuery] Raw rows returned: ${people.length}${people.length > 0 ? ` | top roles: ${people.slice(0, 3).map(p => p.role).join(', ')}` : ''}`);

  // If pre-resolved aliases were used, exact-match DB query is sufficient — skip post-filter
  if (filters.companyAliases && filters.companyAliases.length > 0) {
    return people.slice(0, limit);
  }
  const filtered = applyPostQueryFilters(people, filters.companies || company);
  return filtered.slice(0, limit);
}

/**
 * Vector-based role matching: uses pgvector cosine distance for semantic role similarity.
 * Hard filters (company, location, university, email, excludes) remain as SQL WHERE clauses.
 * Role matching is done via ORDER BY embedding distance + threshold filter.
 * Records with null embeddings are included with a penalty distance of 1.0 (appear at end).
 */
async function findPeopleByFiltersVector(
  filters: PersonFilters,
  searchEmbedding: number[]
): Promise<PersonResult[]> {
  const { company, location, university, requireEmail = true, excludePersonIds, limit } = filters;
  const vectorString = `[${searchEmbedding.join(',')}]`;

  // Build WHERE conditions as Prisma.sql fragments
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

  // Company filter — use pre-resolved aliases (exact match) or fall back to alias mapping
  if (filters.companyAliases && filters.companyAliases.length > 0) {
    const companyConditions = filters.companyAliases.map(alias =>
      Prisma.sql`p.company ILIKE ${alias}`
    );
    conditions.push(Prisma.sql`(${Prisma.join(companyConditions, ' OR ')})`);
  } else if (company && company.trim()) {
    // Simple contains fallback — all real search paths use companyAliases
    conditions.push(Prisma.sql`p.company ILIKE ${'%' + company.trim() + '%'}`);
  }

  // Location filter
  if (location && location.trim()) {
    conditions.push(Prisma.sql`p.city ILIKE ${'%' + location.trim() + '%'}`);
  }

  // University filter — check all schools, not just the primary one
  if (university && university.trim()) {
    const uniTerm = '%' + university.trim() + '%';
    conditions.push(Prisma.sql`(p."educationSchool" ILIKE ${uniTerm} OR p.schools::text ILIKE ${uniTerm})`);
  }

  // Email filter
  if (requireEmail) {
    conditions.push(Prisma.sql`p.email IS NOT NULL`);
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  } else {
    // Exclude people Apollo already tried and couldn't find an email for
    conditions.push(Prisma.sql`NOT (p.email IS NULL AND p."apolloEnrichedAt" IS NOT NULL)`);
    // Also exclude bounced/undeliverable people
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  }

  // Exclude filter
  if (excludePersonIds && excludePersonIds.length > 0) {
    conditions.push(Prisma.sql`p.id NOT IN (${Prisma.join(excludePersonIds)})`);
  }

  // Never show people without a role
  conditions.push(Prisma.sql`p.role IS NOT NULL`);

  // Exclude people whose role indicates they haven't started yet (e.g., "Incoming Analyst")
  conditions.push(Prisma.sql`p.role !~* '^(incoming|future)\s+'`);

  // Vector similarity threshold: include null embeddings (penalty), exclude far embeddings
  conditions.push(Prisma.sql`(
    p.role_embedding IS NULL
    OR (p.role_embedding <=> ${vectorString}::vector) <= 0.50
  )`);

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const fetchLimit = limit * 2; // Overfetch for post-query company filtering

  console.log(`[VectorQuery] Filters: company=${company}, aliases=${filters.companyAliases?.length ?? 0}, location=${location}, university=${university}, requireEmail=${requireEmail}, excludeIds=${excludePersonIds?.length ?? 0}, threshold=0.50, fetchLimit=${fetchLimit}`);

  const rows = await prisma.$queryRaw<Array<{
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
    role_distance: number;
  }>>(Prisma.sql`
    SELECT
      p.id,
      p."fullName",
      p."firstName",
      p."lastName",
      p.company,
      p.role,
      p."linkedinUrl",
      p.email,
      p."emailStatus"::text,
      p."emailConfidence",
      p."emailDeliverable",
      p."emailVerifiedAt",
      p."emailVerificationReason",
      p.city,
      p.state,
      p.country,
      p."educationSchool",
      p."educationDegree",
      p."educationField",
      p."educationYear",
      CASE
        WHEN p.role_embedding IS NOT NULL
        THEN (p.role_embedding <=> ${vectorString}::vector)
        ELSE 1.0
      END as role_distance
    FROM "Person" p
    ${whereClause}
    ORDER BY
      role_distance ASC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST
    LIMIT ${fetchLimit}
  `);

  console.log(`[VectorQuery] Raw rows returned: ${rows.length}${rows.length > 0 ? ` | distance range: ${Number(rows[0].role_distance).toFixed(4)} → ${Number(rows[rows.length - 1].role_distance).toFixed(4)}` : ''}`);
  if (rows.length > 0 && rows.length <= 5) {
    console.log(`[VectorQuery] All results: ${rows.map(r => `${r.role}@${r.company}(d=${Number(r.role_distance).toFixed(3)})`).join(', ')}`);
  } else if (rows.length > 5) {
    console.log(`[VectorQuery] Top 3: ${rows.slice(0, 3).map(r => `${r.role}@${r.company}(d=${Number(r.role_distance).toFixed(3)})`).join(', ')}`);
  }

  // If pre-resolved aliases were used, exact-match DB query is sufficient — skip post-filter
  const filtered = (filters.companyAliases && filters.companyAliases.length > 0)
    ? rows
    : applyPostQueryFilters(rows, filters.companies || company);
  const limited = filtered.slice(0, limit);

  if (limited.length === 0) return [];

  // Fetch source links (raw SQL can't do nested selects)
  const personIds = limited.map(p => p.id);
  const sourceLinks = await prisma.sourceLink.findMany({
    where: {
      personId: { in: personIds },
      kind: 'DISCOVERY',
    },
    orderBy: { createdAt: 'asc' },
    select: {
      personId: true,
      url: true,
      title: true,
      snippet: true,
      domain: true,
    },
  });

  // Group by personId (first link per person)
  const sourceLinkMap = new Map<string, (typeof sourceLinks)[0]>();
  for (const sl of sourceLinks) {
    if (!sourceLinkMap.has(sl.personId)) {
      sourceLinkMap.set(sl.personId, sl);
    }
  }

  return limited.map(row => {
    const sl = sourceLinkMap.get(row.id);
    return {
      ...row,
      roleDistance: row.role_distance,
      sourceLinks: sl
        ? [{ url: sl.url, title: sl.title, snippet: sl.snippet, domain: sl.domain }]
        : [],
    };
  });
}

/**
 * Look up people by name (ILIKE) with optional company filter.
 * Used by the Person Lookup feature — different from findPeopleByFilters
 * which requires company as the primary filter.
 */
export async function findPeopleByName(params: {
  name: string;
  company?: string;
  limit?: number;
}): Promise<PersonResult[]> {
  const { name, company, limit = 5 } = params;

  const where: any = {
    fullName: { contains: name, mode: 'insensitive' },
  };

  // If company provided, add a loose ILIKE filter — post-query fuzzy match refines it
  if (company && company.trim()) {
    where.company = { contains: company.trim(), mode: 'insensitive' };
  }

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
        select: {
          url: true,
          title: true,
          snippet: true,
          domain: true,
        },
      },
    },
    orderBy: [
      { emailStatus: 'asc' },       // VERIFIED first
      { emailConfidence: 'desc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });

  return people;
}

/**
 * Count people matching filters (approximate — pre-app-layer filtering).
 * Used for hasMore calculation in pagination.
 *
 * Note: This count is approximate because company fuzzy matching and
 * exclusion filtering happen in the application layer. The DB count may
 * be slightly higher than the actual filtered count. This is acceptable
 * for hasMore calculation (worst case: user clicks Load More and gets
 * fewer results than expected, but never misses data).
 */
export async function countPeopleByFilters(
  filters: Omit<PersonFilters, 'limit'>
): Promise<number> {
  const schoolMatchIds = filters.university?.trim() ? await getSchoolMatchIds(filters.university) : undefined;
  const where = buildPersonWhereClause(filters, schoolMatchIds);
  return prisma.person.count({ where });
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
  // Use Apollo's company if available, otherwise fall back to search company, then normalize
  const rawCompany = apolloData.apolloCompany || apolloData.company;
  const resolvedCompany = normalizeCompanyForStorage(rawCompany);

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
  const normalizedSearchCompany = normalizeCompanyForStorage(apolloData.company);
  if (!existing && apolloData.apolloCompany && resolvedCompany !== normalizedSearchCompany) {
    existing = await prisma.person.findUnique({
      where: {
        fullName_company: {
          fullName,
          company: normalizedSearchCompany,
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

    // Fire-and-forget: generate role embedding
    if (apolloData.role) {
      updatePersonRoleEmbedding(existing.id, apolloData.role)
        .catch(err => console.error('[Embedding] Error:', err));
    }

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

  // Fire-and-forget: generate role embedding
  if (apolloData.role) {
    updatePersonRoleEmbedding(person.id, apolloData.role)
      .catch(err => console.error('[Embedding] Error:', err));
  }

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
  // Use scraped company or fall back to search company, then normalize
  const rawCompany = profile.company || searchCompany;
  const company = normalizeCompanyForStorage(rawCompany);

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
        experienceHistory: profile.experienceHistory?.length ? profile.experienceHistory : undefined,
        educationHistory: profile.educationHistory?.length ? profile.educationHistory : undefined,
        scrapedAt: new Date(),
      },
    });

    // Fire-and-forget: generate role embedding
    if (profile.role) {
      updatePersonRoleEmbedding(existingByUrl.id, profile.role)
        .catch(err => console.error('[Embedding] Error:', err));
    }

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
        experienceHistory: profile.experienceHistory?.length ? profile.experienceHistory : undefined,
        educationHistory: profile.educationHistory?.length ? profile.educationHistory : undefined,
        scrapedAt: new Date(),
      },
    });

    // Fire-and-forget: generate role embedding
    if (profile.role) {
      updatePersonRoleEmbedding(existingByName.id, profile.role)
        .catch(err => console.error('[Embedding] Error:', err));
    }

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
      experienceHistory: profile.experienceHistory?.length ? profile.experienceHistory : undefined,
      educationHistory: profile.educationHistory?.length ? profile.educationHistory : undefined,
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

  // Fire-and-forget: generate role embedding
  if (profile.role) {
    updatePersonRoleEmbedding(person.id, profile.role)
      .catch(err => console.error('[Embedding] Error:', err));
  }

  return { personId: person.id, isNew: true };
}
