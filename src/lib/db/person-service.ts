import prisma from '@/lib/prisma';
import { SearchResult } from '@/lib/services/discovery';
import { EmailResult, EducationInfo, EmploymentInfo } from '@/lib/services/enrichment';
import { EmailStatus } from '@prisma/client';
import { ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { getSearchRoleEmbedding, stampPersonRoleEmbedding } from '@/lib/services/embeddings';
import { Prisma } from '@prisma/client';

/**
 * Common university abbreviation → keyword expansions.
 * Each entry maps a recognized abbreviation to the keywords that should ALL appear
 * in the DB value for a match. Order doesn't matter — they're ANDed via ILIKE.
 */
const UNIVERSITY_ALIASES: Record<string, string[]> = {
  'ut austin':    ['texas', 'austin'],
  'ut':           ['texas', 'austin'],
  'ut dallas':    ['texas', 'dallas'],
  'utd':          ['texas', 'dallas'],
  'ut arlington': ['texas', 'arlington'],
  'uta':          ['texas', 'arlington'],
  'tamu':         ['texas', 'a&m'],
  'texas a&m':    ['texas', 'a&m'],
  'nyu':          ['nyu'],
  'new york university': ['nyu'],
  'mit':          ['mit'],
  'massachusetts institute of technology': ['mit'],
  'usc':          ['usc'],
  'university of southern california': ['usc'],
  'ucla':         ['ucla'],
  'university of california los angeles': ['ucla'],
  'ucb':          ['uc', 'berkeley'],
  'uc berkeley':  ['uc', 'berkeley'],
  'cal':          ['uc', 'berkeley'],
  'berkeley':     ['berkeley'],
  'smu':          ['smu'],
  'southern methodist university': ['smu'],
  'southern methodist': ['smu'],
  'gatech':       ['georgia', 'tech'],
  'georgia tech': ['georgia', 'tech'],
  'gt':           ['georgia', 'tech'],
  'uiuc':         ['illinois', 'urbana'],
  'upenn':        ['pennsylvania'],
  'penn':         ['pennsylvania'],
  'penn state':   ['penn', 'state'],
  'umich':        ['michigan'],
  'cmu':          ['carnegie', 'mellon'],
  'carnegie mellon': ['carnegie', 'mellon'],
  'cal poly':     ['california', 'polytechnic'],
  'caltech':      ['california', 'technology'],
  'osu':          ['ohio', 'state'],
  'unc':          ['north', 'carolina', 'chapel'],
  'uva':          ['virginia'],
  'bu':           ['boston', 'university'],
  'bc':           ['boston', 'college'],
  'neu':          ['northeastern'],
  'wustl':        ['washington', 'louis'],
  'wash u':       ['washington', 'louis'],
};

/**
 * Split a university search term into keywords for AND-matching.
 * First checks the alias map, then falls back to splitting on whitespace.
 * Filters out very short noise words (<=2 chars) unless the whole input is short.
 */
function getUniversityKeywords(university: string): string[] {
  const trimmed = university.trim();
  const lower = trimmed.toLowerCase();

  // Check alias map first
  if (UNIVERSITY_ALIASES[lower]) {
    return UNIVERSITY_ALIASES[lower];
  }

  // Fall back to splitting on spaces — each word becomes a keyword
  const words = trimmed.split(/\s+/).filter(Boolean);

  // If only one word, use it as-is
  if (words.length <= 1) return [trimmed];

  // Filter out noise words (of, at, the, and) but keep everything else
  const noise = new Set(['of', 'at', 'the', 'and', 'in', 'for']);
  const meaningful = words.filter(w => !noise.has(w.toLowerCase()));

  return meaningful.length > 0 ? meaningful : [trimmed];
}

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

  return {
    personId: person.id,
    userCandidateId: userCandidate.id,
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
  roleSpecificity?: 'narrow' | 'standard' | 'broad'; // Controls vector similarity threshold
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

  // Company filter — use pre-resolved aliases or fall back to alias mapping
  if (filters.companyAliases && filters.companyAliases.length > 0) {
    // Short aliases (<=3 chars like "gs") use exact match to avoid false positives.
    // Longer aliases use substring match so "anara" matches "Anara Health".
    const aliasFilters = filters.companyAliases.map(alias => ({
      company: alias.length <= 3
        ? { equals: alias, mode: 'insensitive' as const }
        : { contains: alias, mode: 'insensitive' as const }
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

  // Location filter — split "City, State" and match city OR state
  if (location && location.trim()) {
    const parts = location.split(',').map(p => p.trim()).filter(Boolean);
    const locConditions = parts.flatMap(part => [
      { city: { contains: part, mode: 'insensitive' as const } },
      { state: { contains: part, mode: 'insensitive' as const } },
    ]);
    if (!where.AND) where.AND = [];
    (where.AND as unknown[]).push({ OR: locConditions });
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

  // University filter — keyword-split matching to handle abbreviations
  // e.g., "UT Austin" → keywords ["texas", "austin"] → matches "University of Texas at Austin"
  if (university && university.trim()) {
    const keywords = getUniversityKeywords(university);
    // Each keyword must appear in educationSchool OR the person's ID is in schoolMatchIds
    const educationSchoolConditions = keywords.map(kw => ({
      educationSchool: { contains: kw, mode: 'insensitive' as const }
    }));
    const uniConditions: Record<string, unknown>[] = [
      // All keywords must match educationSchool
      { AND: educationSchoolConditions },
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
 * Pre-query person IDs whose `schools` JSON array matches university keywords
 * (case-insensitive). Used to supplement the Prisma path which can't do ILIKE on JSON.
 */
async function getSchoolMatchIds(university: string): Promise<string[]> {
  const keywords = getUniversityKeywords(university);
  // Build AND chain: schools::text must ILIKE each keyword
  const conditions = keywords.map(kw => Prisma.sql`schools::text ILIKE ${'%' + kw + '%'}`);
  const whereClause = Prisma.join(conditions, ' AND ');
  const matches = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Person" WHERE ${whereClause}`
  );
  return matches.map(r => r.id);
}

/**
 * Apply post-query filtering: company fuzzy match.
 * Person exclusions (sent/hidden) are handled at the DB level via excludePersonIds.
 */
function applyPostQueryFilters<T extends { company: string }>(
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
  scrapeDepth?: string;
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

/**
 * Find people matching filters. Delegates to V2 hybrid vector + pg_trgm implementation.
 * V1 backup: src/lib/db/person-service-v1-backup.ts
 */
export async function findPeopleByFilters(filters: PersonFilters): Promise<PersonResult[]> {
  // Map PersonFilters → PersonFiltersV2 and delegate
  return findPeopleByFiltersV2({
    company: filters.company,
    limit: filters.limit,
    companyAliases: filters.companyAliases,
    role: filters.role,
    roleSpecificity: filters.roleSpecificity,
    location: filters.location,
    university: filters.university,
    requireEmail: filters.requireEmail,
    excludePersonIds: filters.excludePersonIds,
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
      scrapeDepth: true,
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
): Promise<{ personId: string; isNew: boolean; role: string | null }> {
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

    return { personId: existing.id, isNew: false, role: apolloData.role };
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

  return { personId: person.id, isNew: true, role: apolloData.role };
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
): Promise<{ personId: string; isNew: boolean; role: string | null }> {
  // Drop profiles missing linkedinUrl — should never happen, but guard against silent merge
  if (!profile.linkedinUrl) {
    console.warn(`[saveScrapedProfile] Skipping "${profile.fullName}" at "${searchCompany}" — missing linkedinUrl`);
    return { personId: '', isNew: false, role: profile.role };
  }

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

    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(existingByUrl.id, profile.role).catch(() => {});
    return { personId: existingByUrl.id, isNew: false, role: profile.role };
  }

  // Check if person exists by fullName + company (legacy records without LinkedIn URL)
  const existingByName = await prisma.person.findUnique({
    where: {
      fullName_company: {
        fullName: profile.fullName,
        company,
      },
    },
    select: { id: true, linkedinUrl: true },
  });

  if (existingByName) {
    // Only backfill when existing row has no linkedinUrl (legacy Apollo/Serper rows).
    // If it has a different URL, we're looking at two distinct humans with the same
    // name+company — skip rather than silently merging them.
    if (existingByName.linkedinUrl !== null) {
      console.warn(
        `[saveScrapedProfile] Name collision: skipping save. existingPersonId=${existingByName.id} existingLinkedinUrl=${existingByName.linkedinUrl} incomingLinkedinUrl=${profile.linkedinUrl} fullName="${profile.fullName}" company="${company}"`
      );
      return { personId: '', isNew: false, role: profile.role };
    }

    // Backfill legacy null-URL row with LinkedIn URL and fresh data
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

    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(existingByName.id, profile.role).catch(() => {});
    return { personId: existingByName.id, isNew: false, role: profile.role };
  }

  // Create new person — wrapped in try/catch to handle race condition where
  // a concurrent scrape creates the same person between our check and create
  try {
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

    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(person.id, profile.role).catch(() => {});
    return { personId: person.id, isNew: true, role: profile.role };
  } catch (error: any) {
    // P2002 = Prisma unique constraint violation (concurrent scrape created this person)
    if (error.code === 'P2002') {
      console.log(`[saveScrapedProfile] Duplicate detected for "${profile.fullName}" at "${company}", falling back to update`);
      const existing = await prisma.person.findUnique({
        where: { fullName_company: { fullName: profile.fullName, company } },
        select: { id: true, linkedinUrl: true },
      });
      if (existing) {
        // Only update if the existing row is safe to merge into: either has no
        // URL yet (backfill) or already has the same URL (idempotent update).
        if (existing.linkedinUrl !== null && existing.linkedinUrl !== profile.linkedinUrl) {
          console.warn(
            `[saveScrapedProfile] P2002 collision: skipping update. existingPersonId=${existing.id} existingLinkedinUrl=${existing.linkedinUrl} incomingLinkedinUrl=${profile.linkedinUrl} fullName="${profile.fullName}" company="${company}"`
          );
          return { personId: '', isNew: false, role: profile.role };
        }
        await prisma.person.update({
          where: { id: existing.id },
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
        // Fire-and-forget: stamp role embedding from cache
        if (profile.role) stampPersonRoleEmbedding(existing.id, profile.role).catch(() => {});
        return { personId: existing.id, isNew: false, role: profile.role };
      }
    }
    throw error;
  }
}

// ─── Full Profile Upgrade (Phase 3 Step 2) ─────────────────────────────────

/**
 * Upgrade a short profile to full by applying scraped LinkedIn data.
 *
 * - Only overwrites fields where scraped value is non-null (preserves pictureUrl, tenureMonths)
 * - Does NOT update company (short profile already has correct company)
 * - Sets scrapeDepth = "full" and scrapedAt = now
 */
export async function upgradeToFullProfile(
  personId: string,
  profile: ScrapedProfile
): Promise<void> {
  const data: Record<string, unknown> = {
    scrapeDepth: 'full',
    scrapedAt: new Date(),
  };

  if (profile.role) data.role = profile.role;
  if (profile.email) {
    data.email = profile.email;
    data.emailStatus = getEmailStatus(profile.email);
    data.emailConfidence = 50;
  }
  if (profile.city) data.city = profile.city;
  if (profile.state) data.state = profile.state;
  if (profile.country) data.country = profile.country;
  if (profile.schools.length > 0) data.schools = profile.schools;
  if (profile.educationSchool) data.educationSchool = profile.educationSchool;
  if (profile.experienceHistory?.length) data.experienceHistory = profile.experienceHistory;
  if (profile.educationHistory?.length) data.educationHistory = profile.educationHistory;
  if (profile.linkedinUrl) data.linkedinUrl = profile.linkedinUrl;

  await prisma.person.update({
    where: { id: personId },
    data,
  });

  // Fire-and-forget: stamp role embedding from cache
  if (profile.role) stampPersonRoleEmbedding(personId, profile.role).catch(() => {});
}

// ─── Short Profile Save (Phase 3: LinkedIn Short Profile Discovery) ────────

import type { ShortProfileResult } from '@/lib/services/linkedin-search';

/**
 * Save a short profile from LinkedIn Short mode search to the Person table.
 *
 * - Deduplicates on linkedinUrl first, then fullName+company
 * - Does NOT overwrite full profiles with short data (preserves richer data)
 * - Optionally tags with school when search used schools filter
 * - Sets scrapeDepth = "short" for new profiles
 *
 * @returns personId and whether a new Person was created
 */
export async function saveShortProfile(
  profile: ShortProfileResult,
  schoolTag?: string | null
): Promise<{ personId: string; isNew: boolean }> {
  const company = normalizeCompanyForStorage(profile.company || 'Unknown');
  const fullName = profile.fullName || `${profile.firstName} ${profile.lastName}`.trim();

  if (!fullName) {
    console.warn(`[saveShortProfile] Skipping profile with no name`);
    throw new Error('Cannot save profile without a name');
  }

  // Drop profiles missing linkedinUrl — LinkedIn Short API always returns one;
  // falling through the name+company branch would risk silently merging humans.
  if (!profile.linkedinUrl) {
    console.warn(`[saveShortProfile] Skipping "${fullName}" at "${company}" — missing linkedinUrl`);
    return { personId: '', isNew: false };
  }

  // 1. Check by linkedinUrl first (most reliable dedup)
  const existingByUrl = await prisma.person.findFirst({
    where: { linkedinUrl: profile.linkedinUrl },
    select: { id: true, scrapeDepth: true },
  });

  if (existingByUrl) {
    // Don't overwrite full profiles with short data
    if (existingByUrl.scrapeDepth === 'full') {
      // Still tag with school if missing
      if (schoolTag) {
        await prisma.person.update({
          where: { id: existingByUrl.id },
          data: {
            educationSchool: schoolTag,
            schools: [schoolTag],
          },
        });
      }
      return { personId: existingByUrl.id, isNew: false };
    }

    // Update existing short profile with fresh data
    await prisma.person.update({
      where: { id: existingByUrl.id },
      data: {
        fullName,
        firstName: profile.firstName || undefined,
        lastName: profile.lastName || undefined,
        company,
        role: profile.role || undefined,
        city: profile.city || undefined,
        state: profile.state || undefined,
        country: profile.country || undefined,
        pictureUrl: profile.pictureUrl || undefined,
        tenureMonths: profile.tenureMonths ?? undefined,
        openProfile: profile.openProfile,
        premium: profile.premium,
        ...(schoolTag && {
          educationSchool: schoolTag,
          schools: [schoolTag],
        }),
      },
    });
    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(existingByUrl.id, profile.role).catch(() => {});
    return { personId: existingByUrl.id, isNew: false };
  }

  // 2. Check by fullName + company (legacy backfill only)
  const existingByName = await prisma.person.findUnique({
    where: { fullName_company: { fullName, company } },
    select: { id: true, linkedinUrl: true, scrapeDepth: true },
  });

  if (existingByName) {
    // Collision: same name+company but a DIFFERENT non-null URL = different human.
    // Skip rather than silently merging.
    if (existingByName.linkedinUrl !== null && existingByName.linkedinUrl !== profile.linkedinUrl) {
      console.warn(
        `[saveShortProfile] Name collision: skipping save. existingPersonId=${existingByName.id} existingLinkedinUrl=${existingByName.linkedinUrl} incomingLinkedinUrl=${profile.linkedinUrl} fullName="${fullName}" company="${company}"`
      );
      return { personId: '', isNew: false };
    }

    // If existing row is full-depth, only backfill URL + school tag — preserve richer data
    if (existingByName.scrapeDepth === 'full') {
      await prisma.person.update({
        where: { id: existingByName.id },
        data: {
          linkedinUrl: profile.linkedinUrl,
          ...(schoolTag && {
            educationSchool: schoolTag,
            schools: [schoolTag],
          }),
        },
      });
      return { personId: existingByName.id, isNew: false };
    }

    // Short-depth row with null URL — full update + URL backfill
    await prisma.person.update({
      where: { id: existingByName.id },
      data: {
        linkedinUrl: profile.linkedinUrl,
        role: profile.role || undefined,
        city: profile.city || undefined,
        state: profile.state || undefined,
        country: profile.country || undefined,
        pictureUrl: profile.pictureUrl || undefined,
        tenureMonths: profile.tenureMonths ?? undefined,
        openProfile: profile.openProfile,
        premium: profile.premium,
        ...(schoolTag && {
          educationSchool: schoolTag,
          schools: [schoolTag],
        }),
      },
    });
    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(existingByName.id, profile.role).catch(() => {});
    return { personId: existingByName.id, isNew: false };
  }

  // 3. Create new short profile
  try {
    const person = await prisma.person.create({
      data: {
        fullName,
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
        company,
        role: profile.role || null,
        linkedinUrl: profile.linkedinUrl || null,
        city: profile.city || null,
        state: profile.state || null,
        country: profile.country || null,
        pictureUrl: profile.pictureUrl || null,
        tenureMonths: profile.tenureMonths ?? null,
        openProfile: profile.openProfile,
        premium: profile.premium,
        scrapeDepth: 'short',
        ...(schoolTag && {
          educationSchool: schoolTag,
          schools: [schoolTag],
        }),
      },
    });

    console.log(`[saveShortProfile] Created short profile: "${fullName}" at "${company}" (${person.id})`);
    // Fire-and-forget: stamp role embedding from cache
    if (profile.role) stampPersonRoleEmbedding(person.id, profile.role).catch(() => {});
    return { personId: person.id, isNew: true };
  } catch (error: any) {
    // Handle race condition (concurrent save)
    if (error.code === 'P2002') {
      console.log(`[saveShortProfile] Duplicate for "${fullName}" at "${company}" — fetching existing`);
      const existing = await prisma.person.findUnique({
        where: { fullName_company: { fullName, company } },
        select: { id: true, linkedinUrl: true },
      });
      if (existing) {
        if (existing.linkedinUrl !== null && existing.linkedinUrl !== profile.linkedinUrl) {
          console.warn(
            `[saveShortProfile] P2002 collision: skipping update. existingPersonId=${existing.id} existingLinkedinUrl=${existing.linkedinUrl} incomingLinkedinUrl=${profile.linkedinUrl} fullName="${fullName}" company="${company}"`
          );
          return { personId: '', isNew: false };
        }
        return { personId: existing.id, isNew: false };
      }
    }
    throw error;
  }
}

/**
 * Batch version of saveShortProfile — saves multiple profiles with far fewer DB round-trips.
 * Instead of 2-3 queries per profile, uses batch lookups and createMany.
 */
export async function saveShortProfilesBatch(
  profiles: ShortProfileResult[],
  schoolTag?: string | null
): Promise<{ personId: string; isNew: boolean }[]> {
  if (profiles.length === 0) return [];

  const startTime = Date.now();

  // ── 1. Normalize + filter ──
  type NormalizedProfile = ShortProfileResult & { _fullName: string; _company: string; _index: number };
  const normalized: NormalizedProfile[] = [];
  const results: { personId: string; isNew: boolean }[] = profiles.map(() => ({ personId: '', isNew: false }));

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const company = normalizeCompanyForStorage(p.company || 'Unknown');
    const fullName = p.fullName || `${p.firstName} ${p.lastName}`.trim();
    if (!fullName) {
      console.warn(`[saveShortProfilesBatch] Skipping profile at index ${i} with no name`);
      continue;
    }
    // Drop profiles missing linkedinUrl — LinkedIn Short API always returns one;
    // falling through the name+company branch would risk silently merging humans.
    if (!p.linkedinUrl) {
      console.warn(`[saveShortProfilesBatch] Skipping "${fullName}" at "${company}" at index ${i} — missing linkedinUrl`);
      continue;
    }
    normalized.push({ ...p, _fullName: fullName, _company: company, _index: i });
  }

  if (normalized.length === 0) return results;

  // ── 2. Batch lookup by LinkedIn URL ──
  const urlsToLookup = normalized
    .filter(p => !!p.linkedinUrl)
    .map(p => p.linkedinUrl);
  const uniqueUrls = Array.from(new Set(urlsToLookup));

  const existingByUrl = uniqueUrls.length > 0
    ? await prisma.person.findMany({
        where: { linkedinUrl: { in: uniqueUrls } },
        select: { id: true, linkedinUrl: true, scrapeDepth: true },
      })
    : [];

  const urlToExisting = new Map(existingByUrl.map(p => [p.linkedinUrl!, p]));

  // ── 3. Batch lookup by name+company (for profiles not matched by URL) ──
  const unmatchedByUrl: NormalizedProfile[] = [];
  const matchedByUrl: { profile: NormalizedProfile; existing: { id: string; scrapeDepth: string | null } }[] = [];

  for (const p of normalized) {
    const existing = p.linkedinUrl ? urlToExisting.get(p.linkedinUrl) : undefined;
    if (existing) {
      matchedByUrl.push({ profile: p, existing });
    } else {
      unmatchedByUrl.push(p);
    }
  }

  // Deduplicate name+company pairs for the OR query
  const nameCompanyPairs = unmatchedByUrl.map(p => ({ fullName: p._fullName, company: p._company }));
  const uniquePairsMap = new Map<string, { fullName: string; company: string }>();
  for (const pair of nameCompanyPairs) {
    const key = `${pair.fullName}|||${pair.company}`;
    if (!uniquePairsMap.has(key)) uniquePairsMap.set(key, pair);
  }
  const uniquePairs = Array.from(uniquePairsMap.values());

  const existingByName = uniquePairs.length > 0
    ? await prisma.person.findMany({
        where: {
          OR: uniquePairs.map(pair => ({
            fullName: pair.fullName,
            company: pair.company,
          })),
        },
        select: { id: true, fullName: true, company: true, linkedinUrl: true, scrapeDepth: true },
      })
    : [];

  const nameToExisting = new Map(
    existingByName.map(p => [`${p.fullName}|||${p.company}`, p])
  );

  // ── 4. Categorize all profiles ──
  type CategorizedProfile = NormalizedProfile & {
    _existingId?: string;
    _category: 'full' | 'update-url' | 'backfill-name' | 'collision' | 'new';
  };
  const categorized: CategorizedProfile[] = [];

  for (const { profile, existing } of matchedByUrl) {
    if (existing.scrapeDepth === 'full') {
      categorized.push({ ...profile, _existingId: existing.id, _category: 'full' });
    } else {
      categorized.push({ ...profile, _existingId: existing.id, _category: 'update-url' });
    }
  }

  for (const p of unmatchedByUrl) {
    const key = `${p._fullName}|||${p._company}`;
    const existing = nameToExisting.get(key);
    if (existing) {
      // Only backfill when the existing row has no URL. A different non-null URL
      // means this is a different human with the same name+company — skip.
      if (existing.linkedinUrl === null) {
        if (existing.scrapeDepth === 'full') {
          // Preserve richer data; the backfill-name loop below only touches URL + school
          categorized.push({ ...p, _existingId: existing.id, _category: 'full' });
        } else {
          categorized.push({ ...p, _existingId: existing.id, _category: 'backfill-name' });
        }
      } else if (existing.linkedinUrl === p.linkedinUrl) {
        // Defensive: primary URL match should have caught this, but if the batch URL
        // lookup missed (e.g., casing), treat as a normal URL update.
        if (existing.scrapeDepth === 'full') {
          categorized.push({ ...p, _existingId: existing.id, _category: 'full' });
        } else {
          categorized.push({ ...p, _existingId: existing.id, _category: 'update-url' });
        }
      } else {
        categorized.push({ ...p, _existingId: existing.id, _category: 'collision' });
      }
    } else {
      categorized.push({ ...p, _category: 'new' });
    }
  }

  // ── 4b. Log collisions and leave results empty ──
  for (const p of categorized.filter(c => c._category === 'collision')) {
    const existing = nameToExisting.get(`${p._fullName}|||${p._company}`);
    console.warn(
      `[saveShortProfilesBatch] Name collision: skipping save. existingPersonId=${p._existingId} existingLinkedinUrl=${existing?.linkedinUrl} incomingLinkedinUrl=${p.linkedinUrl} fullName="${p._fullName}" company="${p._company}"`
    );
    // results[p._index] already set to default empty entry
  }

  // ── 5. School-tag full-depth profiles ──
  const fullDepthIds = categorized
    .filter(p => p._category === 'full')
    .map(p => p._existingId!)
    .filter(Boolean);

  if (fullDepthIds.length > 0 && schoolTag) {
    await prisma.person.updateMany({
      where: { id: { in: fullDepthIds } },
      data: {
        educationSchool: schoolTag,
        schools: [schoolTag],
      },
    });
  }

  // Write results for full-depth profiles
  for (const p of categorized.filter(c => c._category === 'full')) {
    results[p._index] = { personId: p._existingId!, isNew: false };
  }

  // ── 6. Update existing short profiles (matched by URL) ──
  for (const p of categorized.filter(c => c._category === 'update-url')) {
    await prisma.person.update({
      where: { id: p._existingId! },
      data: {
        fullName: p._fullName,
        firstName: p.firstName || undefined,
        lastName: p.lastName || undefined,
        company: p._company,
        role: p.role || undefined,
        city: p.city || undefined,
        state: p.state || undefined,
        country: p.country || undefined,
        pictureUrl: p.pictureUrl || undefined,
        tenureMonths: p.tenureMonths ?? undefined,
        openProfile: p.openProfile,
        premium: p.premium,
        ...(schoolTag && { educationSchool: schoolTag, schools: [schoolTag] }),
      },
    });
    results[p._index] = { personId: p._existingId!, isNew: false };
    if (p.role) stampPersonRoleEmbedding(p._existingId!, p.role).catch(() => {});
  }

  // ── 7. Backfill legacy null-URL rows (matched by name+company) ──
  for (const p of categorized.filter(c => c._category === 'backfill-name')) {
    await prisma.person.update({
      where: { id: p._existingId! },
      data: {
        linkedinUrl: p.linkedinUrl,
        role: p.role || undefined,
        city: p.city || undefined,
        state: p.state || undefined,
        country: p.country || undefined,
        pictureUrl: p.pictureUrl || undefined,
        tenureMonths: p.tenureMonths ?? undefined,
        openProfile: p.openProfile,
        premium: p.premium,
        ...(schoolTag && { educationSchool: schoolTag, schools: [schoolTag] }),
      },
    });
    results[p._index] = { personId: p._existingId!, isNew: false };
    if (p.role) stampPersonRoleEmbedding(p._existingId!, p.role).catch(() => {});
  }

  // ── 8. Create new profiles ──
  const newProfiles = categorized.filter(c => c._category === 'new');

  if (newProfiles.length > 0) {
    // Intra-batch dedup by name+company. If two profiles share name+company but
    // have DIFFERENT URLs, they're different humans — keep the first and treat
    // the rest as collisions (leave results empty). Same URL = exact duplicate,
    // safely merged (preserves test 9 behavior).
    const firstByKey = new Map<string, CategorizedProfile>();
    const deduplicatedNew: CategorizedProfile[] = [];
    const intraBatchCollisions: CategorizedProfile[] = [];
    for (const p of newProfiles) {
      const key = `${p._fullName}|||${p._company}`;
      const first = firstByKey.get(key);
      if (!first) {
        firstByKey.set(key, p);
        deduplicatedNew.push(p);
      } else if (first.linkedinUrl === p.linkedinUrl) {
        // Exact duplicate in batch — safe to merge; resolved via createdMap below
      } else {
        intraBatchCollisions.push(p);
      }
    }

    for (const p of intraBatchCollisions) {
      const first = firstByKey.get(`${p._fullName}|||${p._company}`);
      console.warn(
        `[saveShortProfilesBatch] Intra-batch collision: skipping save. firstLinkedinUrl=${first?.linkedinUrl} incomingLinkedinUrl=${p.linkedinUrl} fullName="${p._fullName}" company="${p._company}"`
      );
      // results[p._index] stays as default empty entry
    }

    await prisma.person.createMany({
      data: deduplicatedNew.map(p => ({
        fullName: p._fullName,
        firstName: p.firstName || null,
        lastName: p.lastName || null,
        company: p._company,
        role: p.role || null,
        linkedinUrl: p.linkedinUrl || null,
        city: p.city || null,
        state: p.state || null,
        country: p.country || null,
        pictureUrl: p.pictureUrl || null,
        tenureMonths: p.tenureMonths ?? null,
        openProfile: p.openProfile,
        premium: p.premium,
        scrapeDepth: 'short',
        ...(schoolTag && { educationSchool: schoolTag, schools: [schoolTag] }),
      })),
      skipDuplicates: true,
    });

    // Fetch back IDs for the newly created profiles. Include linkedinUrl so we
    // can defend against a late race where another writer already claimed the
    // (name, company) slot with a different URL.
    const newNameCompanyPairs = deduplicatedNew.map(p => ({ fullName: p._fullName, company: p._company }));
    const createdPersons = await prisma.person.findMany({
      where: {
        OR: newNameCompanyPairs.map(pair => ({
          fullName: pair.fullName,
          company: pair.company,
        })),
      },
      select: { id: true, fullName: true, company: true, linkedinUrl: true },
    });

    const createdMap = new Map(
      createdPersons.map(p => [`${p.fullName}|||${p.company}`, p])
    );

    // Only resolve the deduplicated "first wins" entries AND any exact-duplicate
    // siblings (same URL). Intra-batch collisions stay empty.
    const collisionIndices = new Set(intraBatchCollisions.map(p => p._index));
    for (const p of newProfiles) {
      if (collisionIndices.has(p._index)) continue;
      const key = `${p._fullName}|||${p._company}`;
      const created = createdMap.get(key);
      if (!created) continue;
      // Defend against late race: only claim this row if the URL still matches
      // (or was null at create time — shouldn't happen for new profiles, but safe).
      if (created.linkedinUrl !== null && created.linkedinUrl !== p.linkedinUrl) {
        console.warn(
          `[saveShortProfilesBatch] Late race: skipping save. existingPersonId=${created.id} existingLinkedinUrl=${created.linkedinUrl} incomingLinkedinUrl=${p.linkedinUrl} fullName="${p._fullName}" company="${p._company}"`
        );
        continue;
      }
      results[p._index] = { personId: created.id, isNew: true };
      if (p.role) stampPersonRoleEmbedding(created.id, p.role).catch(() => {});
    }
  }

  const newCount = results.filter(r => r.isNew).length;
  const existingCount = results.filter(r => r.personId && !r.isNew).length;
  console.log(`[saveShortProfilesBatch] Saved ${profiles.length} profiles (${newCount} new, ${existingCount} existing) in ${Date.now() - startTime}ms`);

  return results;
}


// ============================================================================
// V2 Retrieval: Hybrid Vector + pg_trgm
// ============================================================================

/**
 * Filter criteria for the V2 retrieval path.
 * Uses pg_trgm for fuzzy company matching and pgvector for semantic role matching.
 * Ranking is handled entirely in SQL ORDER BY (no post-query rankCandidates).
 */
export interface PersonFiltersV2 {
  /** Primary company name to search for. */
  company: string;
  /** Maximum number of results to return. */
  limit: number;
  /** Pre-resolved company aliases (from company-alias service). */
  companyAliases?: string[];
  /** Role/title to match via vector cosine distance. */
  role?: string;
  /** Controls vector similarity threshold: narrow=0.28, standard=0.38, broad=0.48. */
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
  /** City, state, or "City, State" for location filtering. */
  location?: string;
  /** School name or abbreviation for university filtering. */
  university?: string;
  /** If true (default), only return people with email addresses. */
  requireEmail?: boolean;
  /** Person IDs to exclude (already displayed, sent, hidden). */
  excludePersonIds?: string[];
  /** Company match mode: 'exact' for case-insensitive equality, 'fuzzy' for trgm similarity. Default 'fuzzy'. */
  companyMatchMode?: 'exact' | 'fuzzy';
  /** pg_trgm similarity threshold for company matching. Default 0.3. */
  companySimThreshold?: number;
}

/**
 * V2 retrieval function using hybrid vector + pg_trgm matching.
 *
 * Company filter: pg_trgm similarity (fuzzy) or exact match for short aliases (<=3 chars).
 * Role filter: pgvector cosine distance with specificity-based thresholds.
 * Location/university/email: same ILIKE approach as V1.
 * Ranking: SQL ORDER BY (role_distance, company_similarity, email quality) -- no post-query re-ranking.
 *
 * Falls back to ILIKE role matching if OpenAI embedding fails.
 */
export async function findPeopleByFiltersV2(
  filters: PersonFiltersV2
): Promise<PersonResult[]> {
  const {
    company,
    role,
    location,
    university,
    requireEmail = true,
    excludePersonIds,
    limit,
    companyMatchMode = 'fuzzy',
    companySimThreshold = 0.3,
  } = filters;

  // ── Resolve role embedding (if role provided) ──
  let searchEmbedding: number[] | null = null;
  let useVectorPath = false;

  if (role && role.trim() && isVectorRoleMatchingEnabled()) {
    searchEmbedding = await getSearchRoleEmbedding(role);
    if (searchEmbedding) {
      useVectorPath = true;
    } else {
      console.warn(`[PersonServiceV2] Embedding FAILED for role="${role}" -- falling back to ILIKE role matching`);
    }
  }

  const vectorString = searchEmbedding ? `[${searchEmbedding.join(',')}]` : null;

  // ── Role threshold (only used when vector path is active) ──
  const SPECIFICITY_THRESHOLDS = { narrow: 0.28, standard: 0.38, broad: 0.48 } as const;
  const roleThreshold = SPECIFICITY_THRESHOLDS[filters.roleSpecificity || 'standard'];

  // ── Build WHERE conditions ──
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

  // ── Company filter ──
  if (company && company.trim()) {
    const companyConditions: Prisma.Sql[] = [];

    // Collect all names to check: primary company + aliases
    const allNames: string[] = [company.trim()];
    if (filters.companyAliases && filters.companyAliases.length > 0) {
      for (const alias of filters.companyAliases) {
        if (alias.trim() && !allNames.some(n => n.toLowerCase() === alias.trim().toLowerCase())) {
          allNames.push(alias.trim());
        }
      }
    }

    // Short aliases (<=3 chars): exact case-insensitive match.
    // When companyAliases are provided, the alias ILIKE patterns below handle
    // substring matches (e.g., "Boston Consulting Group (BCG)"). Without aliases,
    // we add a word-boundary regex fallback so short names like "BCG" still match
    // "BCG X" or "Boston Consulting Group (BCG)" but NOT mid-word hits like
    // "Bags" for "GS" or "DraftKings" for "GS".
    const hasAliases = filters.companyAliases && filters.companyAliases.length > 0;
    const shortAliases = allNames.filter(n => n.length <= 3);
    for (const alias of shortAliases) {
      if (hasAliases) {
        // Aliases will provide ILIKE coverage; exact match is sufficient here
        companyConditions.push(Prisma.sql`lower(p.company) = lower(${alias})`);
      } else {
        // No aliases: combine exact match with word-boundary regex fallback.
        // Escape regex-special characters in the alias (e.g., "S&T" -> "S\\&T")
        // then wrap with boundary anchors that match start/end of string or
        // common delimiters (space, hyphen, paren, comma).
        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundaryPattern = `(^|[\\s\\-\\(\\,])${escapedAlias}($|[\\s\\-\\)\\,])`;
        companyConditions.push(
          Prisma.sql`(lower(p.company) = lower(${alias}) OR p.company ~* ${boundaryPattern})`
        );
      }
    }

    // Longer names: pg_trgm similarity or exact ILIKE depending on mode
    const longNames = allNames.filter(n => n.length > 3);
    if (longNames.length > 0) {
      if (companyMatchMode === 'fuzzy') {
        // Set trgm threshold for the % operator within this query
        // We use a subquery approach: similarity() >= threshold in WHERE
        for (const name of longNames) {
          companyConditions.push(
            Prisma.sql`similarity(lower(p.company), lower(${name})) >= ${companySimThreshold}`
          );
        }
      } else {
        // Exact mode: case-insensitive contains (same as V1)
        for (const name of longNames) {
          companyConditions.push(Prisma.sql`p.company ILIKE ${'%' + name + '%'}`);
        }
      }
    }

    // Also check pre-resolved aliases via ILIKE as fallback
    // (backward compatible with company-alias service output)
    if (filters.companyAliases && filters.companyAliases.length > 0) {
      for (const alias of filters.companyAliases) {
        if (alias.length > 3) {
          companyConditions.push(Prisma.sql`p.company ILIKE ${'%' + alias + '%'}`);
        }
      }
    }

    if (companyConditions.length > 0) {
      conditions.push(Prisma.sql`(${Prisma.join(companyConditions, ' OR ')})`);
    }
  }

  // ── Role filter ──
  if (role && role.trim()) {
    if (useVectorPath && vectorString) {
      // Vector path: include rows WITH embedding that pass threshold,
      // plus rows WITHOUT embedding (ranked last via role_distance = 1.0)
      conditions.push(Prisma.sql`(
        p.role_embedding IS NULL
        OR (p.role_embedding <=> ${vectorString}::vector) <= ${roleThreshold}
      )`);
    } else {
      // ILIKE fallback: use role alias expansion (same as V1)
      const roleTerms = getRoleSearchTerms(role);
      const roleConditions = roleTerms.map(term =>
        Prisma.sql`p.role ILIKE ${'%' + term + '%'}`
      );
      conditions.push(Prisma.sql`(${Prisma.join(roleConditions, ' OR ')})`);
    }
  }

  // ── Location filter ── (unchanged from V1)
  if (location && location.trim()) {
    const locationParts = location.split(',').map(p => p.trim()).filter(Boolean);
    const locConditions = locationParts.map(part => {
      const term = '%' + part + '%';
      return Prisma.sql`(p.city ILIKE ${term} OR p.state ILIKE ${term})`;
    });
    conditions.push(Prisma.sql`(${Prisma.join(locConditions, ' OR ')})`);
  }

  // ── University filter ── (unchanged from V1)
  if (university && university.trim()) {
    const keywords = getUniversityKeywords(university);
    const kwConditions = keywords.map(kw => {
      const term = '%' + kw + '%';
      return Prisma.sql`(p."educationSchool" ILIKE ${term} OR p.schools::text ILIKE ${term})`;
    });
    conditions.push(Prisma.sql`(${Prisma.join(kwConditions, ' AND ')})`);
  }

  // ── Email filter ── (unchanged from V1)
  if (requireEmail) {
    conditions.push(Prisma.sql`p.email IS NOT NULL`);
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  } else {
    conditions.push(Prisma.sql`NOT (p.email IS NULL AND p."apolloEnrichedAt" IS NOT NULL)`);
    conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
  }

  // ── Exclude filter ──
  if (excludePersonIds && excludePersonIds.length > 0) {
    conditions.push(Prisma.sql`p.id NOT IN (${Prisma.join(excludePersonIds)})`);
  }

  // ── Must have role, not incoming/future ──
  conditions.push(Prisma.sql`p.role IS NOT NULL`);
  conditions.push(Prisma.sql`p.role !~* '^(incoming|future)\\s+'`);

  // ── Assemble query ──
  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const fetchLimit = limit * 2; // Overfetch pattern (safety margin)

  // Build SELECT columns for scoring
  // role_distance: vector cosine distance (lower = better), 1.0 penalty for missing embeddings
  // company_similarity: pg_trgm similarity score (higher = better)
  const roleDistanceExpr = (useVectorPath && vectorString)
    ? Prisma.sql`CASE
        WHEN p.role_embedding IS NOT NULL
        THEN (p.role_embedding <=> ${vectorString}::vector)
        ELSE 1.0
      END`
    : Prisma.sql`0.0`;

  // Build company similarity: GREATEST across primary name + all aliases
  const allCompanyNames: string[] = [];
  if (company && company.trim()) allCompanyNames.push(company.trim());
  if (filters.companyAliases) {
    for (const alias of filters.companyAliases) {
      if (alias.trim() && alias.length > 3) allCompanyNames.push(alias.trim());
    }
  }

  let companySimilarityExpr: Prisma.Sql;
  if (allCompanyNames.length > 0) {
    const simExprs = allCompanyNames.map(name =>
      Prisma.sql`similarity(lower(p.company), lower(${name}))`
    );
    companySimilarityExpr = simExprs.length === 1
      ? simExprs[0]
      : Prisma.sql`GREATEST(${Prisma.join(simExprs, ', ')})`;
  } else {
    companySimilarityExpr = Prisma.sql`0.0`;
  }

  // Build ORDER BY based on whether role was provided
  let orderByClause: Prisma.Sql;
  if (role && role.trim() && useVectorPath) {
    // Role specified + vector active: sort by role distance first
    orderByClause = Prisma.sql`ORDER BY
      role_distance ASC,
      company_similarity DESC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST`;
  } else if (company && company.trim()) {
    // No role (or ILIKE fallback): sort by company similarity first
    orderByClause = Prisma.sql`ORDER BY
      company_similarity DESC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST`;
  } else {
    // Neither role nor company: email quality only
    orderByClause = Prisma.sql`ORDER BY
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST`;
  }

  console.log(`[PersonServiceV2] Filters: company="${company}", aliases=${filters.companyAliases?.length ?? 0}, role="${role}", roleSpecificity=${filters.roleSpecificity || 'standard'}, location="${location}", university="${university}", requireEmail=${requireEmail}, excludeIds=${excludePersonIds?.length ?? 0}, companyMatchMode=${companyMatchMode}, companySimThreshold=${companySimThreshold}, vectorPath=${useVectorPath}, fetchLimit=${fetchLimit}`);

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
    scrapeDepth: string;
    role_distance: number;
    company_similarity: number;
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
      p."scrapeDepth",
      ${roleDistanceExpr} as role_distance,
      ${companySimilarityExpr} as company_similarity
    FROM "Person" p
    ${whereClause}
    ${orderByClause}
    LIMIT ${fetchLimit}
  `);

  console.log(`[PersonServiceV2] Raw rows returned: ${rows.length}${rows.length > 0
    ? ` | role_distance range: ${Number(rows[0].role_distance).toFixed(4)} -> ${Number(rows[rows.length - 1].role_distance).toFixed(4)} | company_similarity range: ${Number(rows[0].company_similarity).toFixed(4)} -> ${Number(rows[rows.length - 1].company_similarity).toFixed(4)}`
    : ''}`);
  if (rows.length > 0) {
    console.log(`[PersonServiceV2] Top 3: ${rows.slice(0, 3).map(r =>
      `${r.role}@${r.company}(rd=${Number(r.role_distance).toFixed(3)},cs=${Number(r.company_similarity).toFixed(3)})`
    ).join(', ')}`);
  }

  // Trim to requested limit (no post-query company filter needed -- trgm handles it in SQL)
  const limited = rows.slice(0, limit);

  if (limited.length === 0) return [];

  // ── Fetch source links (second query, same pattern as V1) ──
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


// ============================================================================
// V3 Retrieval: Two-Pass Hybrid with Match Tiers
// ============================================================================

/** Classification of how closely a result matched the search role. */
export type MatchTier = 'exact' | 'near_exact' | 'similar';

/** V3 result extends PersonResult with tier and score metadata. */
export interface PersonResultV3 extends PersonResult {
  matchTier: MatchTier;
  matchScore: number; // 0.0 (worst) to 1.0 (best)
}

/** Tier sort order for deterministic ranking: exact first, similar last. */
const TIER_ORDER: Record<MatchTier, number> = { exact: 0, near_exact: 1, similar: 2 };

/**
 * V3 retrieval: two-pass hybrid with match tiers.
 *
 * Architecture:
 *   Query A — ILIKE text match on p.role (catches exact + near_exact matches).
 *   Query B — pgvector cosine search (catches semantic/synonym matches).
 * Both queries run in parallel. Results are merged, deduplicated (A wins),
 * scored, sorted by tier then score, and sliced to the requested limit.
 *
 * When no role is provided, falls through to a single V2-style query with all
 * results assigned matchTier='exact' and matchScore=1.0.
 */
export async function findPeopleByFiltersV3(
  filters: PersonFiltersV2
): Promise<PersonResultV3[]> {
  const {
    company,
    role,
    location,
    university,
    requireEmail = true,
    excludePersonIds,
    limit,
    companyMatchMode = 'fuzzy',
    companySimThreshold = 0.3,
  } = filters;

  // ── No role provided: delegate to single-pass and tag as exact ──
  if (!role || !role.trim()) {
    const v2Results = await findPeopleByFiltersV2(filters);
    return v2Results.map(r => ({ ...r, matchTier: 'exact' as MatchTier, matchScore: 1.0 }));
  }

  // ── Resolve role embedding ──
  let searchEmbedding: number[] | null = null;
  let vectorPathAvailable = false;

  if (isVectorRoleMatchingEnabled()) {
    searchEmbedding = await getSearchRoleEmbedding(role);
    if (searchEmbedding) {
      vectorPathAvailable = true;
    } else {
      console.warn(`[PersonServiceV3] Embedding FAILED for role="${role}" -- Query B (vector) will be skipped`);
    }
  }

  const vectorString = searchEmbedding ? `[${searchEmbedding.join(',')}]` : null;

  const SPECIFICITY_THRESHOLDS = { narrow: 0.28, standard: 0.38, broad: 0.48 } as const;
  const roleThreshold = SPECIFICITY_THRESHOLDS[filters.roleSpecificity || 'standard'];
  const fetchLimit = limit * 2;

  // ── Build shared WHERE conditions (company, location, university, email, excludes) ──
  // These are identical between Query A and Query B, factored into a helper.
  function buildSharedConditions(): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    // ── Company filter ──
    if (company && company.trim()) {
      const companyConditions: Prisma.Sql[] = [];
      const allNames: string[] = [company.trim()];
      if (filters.companyAliases && filters.companyAliases.length > 0) {
        for (const alias of filters.companyAliases) {
          if (alias.trim() && !allNames.some(n => n.toLowerCase() === alias.trim().toLowerCase())) {
            allNames.push(alias.trim());
          }
        }
      }

      const hasAliases = filters.companyAliases && filters.companyAliases.length > 0;
      const shortAliases = allNames.filter(n => n.length <= 3);
      for (const alias of shortAliases) {
        if (hasAliases) {
          companyConditions.push(Prisma.sql`lower(p.company) = lower(${alias})`);
        } else {
          const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const boundaryPattern = `(^|[\\s\\-\\(\\,])${escapedAlias}($|[\\s\\-\\)\\,])`;
          companyConditions.push(
            Prisma.sql`(lower(p.company) = lower(${alias}) OR p.company ~* ${boundaryPattern})`
          );
        }
      }

      const longNames = allNames.filter(n => n.length > 3);
      if (longNames.length > 0) {
        if (companyMatchMode === 'fuzzy') {
          for (const name of longNames) {
            companyConditions.push(
              Prisma.sql`similarity(lower(p.company), lower(${name})) >= ${companySimThreshold}`
            );
          }
        } else {
          for (const name of longNames) {
            companyConditions.push(Prisma.sql`p.company ILIKE ${'%' + name + '%'}`);
          }
        }
      }

      if (filters.companyAliases && filters.companyAliases.length > 0) {
        for (const alias of filters.companyAliases) {
          if (alias.length > 3) {
            companyConditions.push(Prisma.sql`p.company ILIKE ${'%' + alias + '%'}`);
          }
        }
      }

      if (companyConditions.length > 0) {
        conditions.push(Prisma.sql`(${Prisma.join(companyConditions, ' OR ')})`);
      }
    }

    // ── Location filter ──
    if (location && location.trim()) {
      const locationParts = location.split(',').map(p => p.trim()).filter(Boolean);
      const locConditions = locationParts.map(part => {
        const term = '%' + part + '%';
        return Prisma.sql`(p.city ILIKE ${term} OR p.state ILIKE ${term})`;
      });
      conditions.push(Prisma.sql`(${Prisma.join(locConditions, ' OR ')})`);
    }

    // ── University filter ──
    if (university && university.trim()) {
      const keywords = getUniversityKeywords(university);
      const kwConditions = keywords.map(kw => {
        const term = '%' + kw + '%';
        return Prisma.sql`(p."educationSchool" ILIKE ${term} OR p.schools::text ILIKE ${term})`;
      });
      conditions.push(Prisma.sql`(${Prisma.join(kwConditions, ' AND ')})`);
    }

    // ── Email filter ──
    if (requireEmail) {
      conditions.push(Prisma.sql`p.email IS NOT NULL`);
      conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
    } else {
      conditions.push(Prisma.sql`NOT (p.email IS NULL AND p."apolloEnrichedAt" IS NOT NULL)`);
      conditions.push(Prisma.sql`(p."emailDeliverable" = true OR p."emailDeliverable" IS NULL)`);
    }

    // ── Exclude filter ──
    if (excludePersonIds && excludePersonIds.length > 0) {
      conditions.push(Prisma.sql`p.id NOT IN (${Prisma.join(excludePersonIds)})`);
    }

    // ── Must have role, not incoming/future ──
    conditions.push(Prisma.sql`p.role IS NOT NULL`);
    conditions.push(Prisma.sql`p.role !~* '^(incoming|future)\\s+'`);

    return conditions;
  }

  // ── Company similarity expression (reused by both queries) ──
  const allCompanyNames: string[] = [];
  if (company && company.trim()) allCompanyNames.push(company.trim());
  if (filters.companyAliases) {
    for (const alias of filters.companyAliases) {
      if (alias.trim() && alias.length > 3) allCompanyNames.push(alias.trim());
    }
  }

  let companySimilarityExpr: Prisma.Sql;
  if (allCompanyNames.length > 0) {
    const simExprs = allCompanyNames.map(name =>
      Prisma.sql`similarity(lower(p.company), lower(${name}))`
    );
    companySimilarityExpr = simExprs.length === 1
      ? simExprs[0]
      : Prisma.sql`GREATEST(${Prisma.join(simExprs, ', ')})`;
  } else {
    companySimilarityExpr = Prisma.sql`0.0`;
  }

  // ── Row type returned by both raw queries ──
  type RawRow = {
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
    scrapeDepth: string;
    role_distance: number;
    company_similarity: number;
    match_tier: string;
  };

  const selectColumns = (roleDistExpr: Prisma.Sql, matchTierExpr: Prisma.Sql) => Prisma.sql`
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
      p."scrapeDepth",
      ${roleDistExpr} as role_distance,
      ${companySimilarityExpr} as company_similarity,
      ${matchTierExpr} as match_tier
    FROM "Person" p
  `;

  // ── Query A: ILIKE text match (exact + near_exact) ──
  function buildQueryA(): Promise<RawRow[]> {
    const conditions = buildSharedConditions();

    // Role ILIKE filter
    conditions.push(Prisma.sql`p.role ILIKE ${'%' + role!.trim() + '%'}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // Exact match classification: if trimmed lowercase role equals search role, it's 'exact'; else 'near_exact'
    const matchTierExpr = Prisma.sql`CASE
      WHEN lower(trim(p.role)) = lower(trim(${role!.trim()})) THEN 'exact'
      ELSE 'near_exact'
    END`;

    // role_distance: use vector distance if available (for scoring), else null/0
    const roleDistExpr = (vectorPathAvailable && vectorString)
      ? Prisma.sql`CASE
          WHEN p.role_embedding IS NOT NULL
          THEN (p.role_embedding <=> ${vectorString}::vector)
          ELSE NULL
        END`
      : Prisma.sql`NULL`;

    const orderByClause = Prisma.sql`ORDER BY
      CASE WHEN lower(trim(p.role)) = lower(trim(${role!.trim()})) THEN 0 ELSE 1 END ASC,
      role_distance ASC NULLS LAST,
      company_similarity DESC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST`;

    return prisma.$queryRaw<RawRow[]>(Prisma.sql`
      ${selectColumns(roleDistExpr, matchTierExpr)}
      ${whereClause}
      ${orderByClause}
      LIMIT ${fetchLimit}
    `);
  }

  // ── Query B: Vector semantic search (similar tier, excludes ILIKE matches) ──
  function buildQueryB(): Promise<RawRow[]> {
    if (!vectorPathAvailable || !vectorString) {
      return Promise.resolve([]);
    }

    const conditions = buildSharedConditions();

    // Vector distance threshold
    conditions.push(Prisma.sql`p.role_embedding IS NOT NULL`);
    conditions.push(Prisma.sql`(p.role_embedding <=> ${vectorString}::vector) <= ${roleThreshold}`);

    // Exclude ILIKE matches (already handled by Query A)
    conditions.push(Prisma.sql`p.role NOT ILIKE ${'%' + role!.trim() + '%'}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const matchTierExpr = Prisma.sql`'similar'`;
    const roleDistExpr = Prisma.sql`(p.role_embedding <=> ${vectorString}::vector)`;

    const orderByClause = Prisma.sql`ORDER BY
      role_distance ASC,
      company_similarity DESC,
      CASE p."emailStatus"::text
        WHEN 'VERIFIED' THEN 0
        WHEN 'MANUAL'   THEN 1
        WHEN 'UNVERIFIED' THEN 2
        ELSE 3
      END ASC,
      p."emailConfidence" DESC NULLS LAST`;

    return prisma.$queryRaw<RawRow[]>(Prisma.sql`
      ${selectColumns(roleDistExpr, matchTierExpr)}
      ${whereClause}
      ${orderByClause}
      LIMIT ${fetchLimit}
    `);
  }

  // ── Issue 3 fix: skip ILIKE for short role codes (<=3 chars) ──
  // Short terms like "PM", "DS", "QA" produce excessive ILIKE noise via %PM%
  // matching substrings in unrelated roles. Vector search handles these better.
  const skipIlike = role!.trim().length <= 3;

  console.log(`[PersonServiceV3] Filters: company="${company}", aliases=${filters.companyAliases?.length ?? 0}, role="${role}", roleSpecificity=${filters.roleSpecificity || 'standard'}, location="${location}", university="${university}", requireEmail=${requireEmail}, excludeIds=${excludePersonIds?.length ?? 0}, companyMatchMode=${companyMatchMode}, vectorPath=${vectorPathAvailable}, fetchLimit=${fetchLimit}, skipIlike=${skipIlike}`);

  // ── Issue 1 fix: conditional Query B execution ──
  // Run Query A first (unless skipped for short codes). Only run Query B if
  // Query A did not return enough exact matches to fill the requested page.
  // This turns the common case (ILIKE saturates with exact matches) into a
  // single-query path, cutting latency roughly in half.
  const queryARows: RawRow[] = skipIlike ? [] : await buildQueryA();
  const exactCount = queryARows.filter(r => r.match_tier === 'exact').length;

  let queryBRows: RawRow[] = [];
  if (exactCount < limit) {
    queryBRows = await buildQueryB();
  }

  console.log(`[PersonServiceV3] Query A (ILIKE) returned ${queryARows.length} rows (${exactCount} exact) | Query B (vector) returned ${queryBRows.length} rows | skipIlike=${skipIlike}`);

  // ── Merge and deduplicate (Query A wins) ──
  const seenIds = new Set<string>();
  const merged: (RawRow & { computedTier: MatchTier; computedScore: number })[] = [];

  // Process Query A results first (they take priority)
  for (const row of queryARows) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);

    const tier = row.match_tier === 'exact' ? 'exact' as MatchTier : 'near_exact' as MatchTier;
    let score: number;

    if (tier === 'exact') {
      score = 1.0;
    } else {
      // near_exact: score based on role distance if available
      const rd = row.role_distance != null ? Number(row.role_distance) : null;
      if (rd != null) {
        score = Math.max(0.7, Math.min(0.99, 1.0 - rd * 1.5));
      } else {
        score = 0.85; // No embedding available, default score
      }
    }

    merged.push({ ...row, computedTier: tier, computedScore: score });
  }

  // Process Query B results (deduplicated against A)
  for (const row of queryBRows) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);

    const rd = Number(row.role_distance);
    const score = Math.max(0.0, Math.min(0.69, 1.0 - rd * 2.0));

    merged.push({ ...row, computedTier: 'similar', computedScore: score });
  }

  // ── Sort: tier order ASC, then matchScore DESC within tier ──
  merged.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.computedTier] - TIER_ORDER[b.computedTier];
    if (tierDiff !== 0) return tierDiff;
    return b.computedScore - a.computedScore; // higher score first
  });

  // ── Issue 2 fix: reserve minimum slots for 'similar' tier results ──
  // When Query B ran and returned semantic neighbors, ensure at least 20% of
  // the final result set comes from the 'similar' tier. This prevents ILIKE
  // matches from crowding out legitimate semantic neighbors (e.g., "Software
  // Engineer" results for a "Data Engineer" search at Stripe).
  const exactAndNear = merged.filter(r => r.computedTier !== 'similar');
  const similar = merged.filter(r => r.computedTier === 'similar');

  let limited: typeof merged;
  if (similar.length > 0) {
    const minSimilarSlots = Math.min(Math.floor(limit * 0.2), similar.length);
    const exactNearSlots = limit - minSimilarSlots;

    const pickedExactNear = exactAndNear.slice(0, exactNearSlots);
    const pickedSimilar = similar.slice(0, minSimilarSlots);

    // If exactAndNear didn't fill their slots, give overflow to similar
    const extraSlots = exactNearSlots - pickedExactNear.length;
    const overflowSimilar = extraSlots > 0
      ? similar.slice(minSimilarSlots, minSimilarSlots + extraSlots)
      : [];

    limited = [...pickedExactNear, ...pickedSimilar, ...overflowSimilar];
  } else {
    // No similar results (Query B was skipped or returned nothing) — just slice
    limited = merged.slice(0, limit);
  }

  if (limited.length === 0) return [];

  console.log(`[PersonServiceV3] After merge+dedup: ${merged.length} total, returning ${limited.length} | Tier breakdown: exact=${limited.filter(r => r.computedTier === 'exact').length}, near_exact=${limited.filter(r => r.computedTier === 'near_exact').length}, similar=${limited.filter(r => r.computedTier === 'similar').length}`);

  // ── Fetch source links (same pattern as V2) ──
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

  const sourceLinkMap = new Map<string, (typeof sourceLinks)[0]>();
  for (const sl of sourceLinks) {
    if (!sourceLinkMap.has(sl.personId)) {
      sourceLinkMap.set(sl.personId, sl);
    }
  }

  return limited.map(row => {
    const sl = sourceLinkMap.get(row.id);
    return {
      id: row.id,
      fullName: row.fullName,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      role: row.role,
      linkedinUrl: row.linkedinUrl,
      email: row.email,
      emailStatus: row.emailStatus,
      emailConfidence: row.emailConfidence,
      emailDeliverable: row.emailDeliverable,
      emailVerifiedAt: row.emailVerifiedAt,
      emailVerificationReason: row.emailVerificationReason,
      city: row.city,
      state: row.state,
      country: row.country,
      educationSchool: row.educationSchool,
      educationDegree: row.educationDegree,
      educationField: row.educationField,
      educationYear: row.educationYear,
      scrapeDepth: row.scrapeDepth,
      roleDistance: row.role_distance != null ? Number(row.role_distance) : undefined,
      matchTier: row.computedTier,
      matchScore: row.computedScore,
      sourceLinks: sl
        ? [{ url: sl.url, title: sl.title, snippet: sl.snippet, domain: sl.domain }]
        : [],
    };
  });
}
