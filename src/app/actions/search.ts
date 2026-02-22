'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { discoverLinkedInProfiles, lookupByName } from '@/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '@/lib/services/linkedin-scraper';
import { rankCandidates, SearchCriteria, CandidateData, ScoreBreakdown } from '@/lib/services/ranking';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import {
  getExcludedPersonIds,
  findPeopleByFilters,
  findPeopleByLinkedInUrls,
  findPeopleByName,
  saveScrapedProfile,
  getEmailStatus,
  PersonFilters,
  PersonResult,
  buildPersonWhereClause,
  applyPostQueryFilters,
  normalizeCompanyForMatch,
  companiesMatch,
  isVectorRoleMatchingEnabled,
} from '@/lib/db/person-service';
import {
  normalizeSearchParams,
  findOrCreateScrapeProgress,
  updateScrapeProgress,
  getNextCsePageStart,
  ApiUsageStats,
} from '@/lib/db/search-cache';
import {
  getCompanyPattern,
  generateEmailFromPattern,
} from '@/lib/services/email-pattern';
import { resolveCompanyAliases } from '@/lib/services/company-alias';
import { generateEmailWithLLM, getUserResumeSummary, getRecentSentEmails, refineEmailWithLLM } from '@/lib/services/personalization';

export interface RecentSearch {
  company: string | null;
  role: string | null;
  university: string | null;
  location: string | null;
  searchedAt: Date;
  resultsCount: number;
}

export interface SearchInput {
  name?: string;
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  limit: number;
  templateId?: string;
  excludePersonIds?: string[]; // IDs of people already displayed (prevents duplicates on Load More)
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
  llmDraftGenerated?: boolean;
}

export interface SearchMeta {
  hasMore: boolean;
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
}

export type SearchActionResult = {
  success: true;
  results: SearchResultWithDraft[];
  searchMeta: SearchMeta;
  remainingDaily: number;
  hiddenCount: number;
} | {
  success: false;
  error: string;
};

export interface HiddenPerson {
  userCandidateId: string;
  personId: string;
  fullName: string;
  company: string;
  role: string | null;
}

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

/** Resolved template shape used by generateEmailDraft */
interface ResolvedTemplate {
  id: string;
  subject: string;
  body: string;
  attachResume: boolean;
  resumeId: string | null;
}

/**
 * Resolve which email template to use for a user.
 * Priority: explicit templateId → user's default DB template → hardcoded fallback.
 */
async function resolveTemplateForUser(
  userId: string,
  templateId?: string
): Promise<ResolvedTemplate> {
  // 1. If templateId matches a hardcoded template, use it
  if (templateId) {
    const hardcoded = EMAIL_TEMPLATES.find((t) => t.id === templateId);
    if (hardcoded) {
      return { id: hardcoded.id, subject: hardcoded.subject, body: hardcoded.body, attachResume: false, resumeId: null };
    }

    // 2. If templateId provided, try DB lookup
    const dbTemplate = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, prompt: true, attachResume: true, resumeId: true },
    });
    if (dbTemplate) {
      let resolvedResumeId = dbTemplate.resumeId;
      if (dbTemplate.attachResume && !resolvedResumeId) {
        const activeResume = await prisma.userResume.findFirst({
          where: { userId, isActive: true },
          select: { id: true },
        });
        if (activeResume) {
          resolvedResumeId = activeResume.id;
          console.log(`[Template] resumeId was null, falling back to active resume: ${activeResume.id}`);
        }
      }
      return { id: dbTemplate.id, ...parseTemplatePrompt(dbTemplate.prompt), attachResume: dbTemplate.attachResume, resumeId: resolvedResumeId };
    }
  }

  // 3. No templateId or not found — fetch user's default template
  const defaultTemplate = await prisma.emailTemplate.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, prompt: true, attachResume: true, resumeId: true },
  });
  if (defaultTemplate) {
    let resolvedResumeId = defaultTemplate.resumeId;

    // Fallback: if attachResume is true but resumeId is missing, use the user's active resume
    if (defaultTemplate.attachResume && !resolvedResumeId) {
      const activeResume = await prisma.userResume.findFirst({
        where: { userId, isActive: true },
        select: { id: true },
      });
      if (activeResume) {
        resolvedResumeId = activeResume.id;
        console.log(`[Template] resumeId was null, falling back to active resume: ${activeResume.id}`);
      }
    }

    console.log(`[Template] Using default template: id=${defaultTemplate.id}, attachResume=${defaultTemplate.attachResume}, resumeId=${resolvedResumeId || '(none)'}`);
    return { id: defaultTemplate.id, ...parseTemplatePrompt(defaultTemplate.prompt), attachResume: defaultTemplate.attachResume, resumeId: resolvedResumeId };
  }

  // 4. Final fallback — hardcoded default
  console.log('[Template] No default template found, using hardcoded fallback (no resume)');
  const fallback = EMAIL_TEMPLATES[0];
  return { id: fallback.id, subject: fallback.subject, body: fallback.body, attachResume: false, resumeId: null };
}

/** Parse the EmailTemplate.prompt field (JSON with subject/body, or plain text as body) */
function parseTemplatePrompt(prompt: string): { subject: string; body: string } {
  try {
    const parsed = JSON.parse(prompt);
    return { subject: parsed.subject || '', body: parsed.body || prompt };
  } catch {
    return { subject: '', body: prompt };
  }
}

/**
 * Generate email draft using template replacement
 */
function generateEmailDraft(
  template: { subject: string; body: string },
  person: { firstName: string | null; company: string; role: string | null },
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null }
): { subject: string; body: string } {
  // Replace placeholders
  let subject: string = template.subject;
  let body: string = template.body;

  const replacements: Record<string, string> = {
    '{first_name}': person.firstName || 'there',
    '{company}': person.company,
    '{role}': person.role || 'your role',
    '{user_name}': user.name || 'A student',
    '{university}': user.university || 'my university',
    '{classification}': user.classification || 'student',
    '{major}': user.major || 'my major',
    '{career}': user.career || 'your industry',
    '{industry}': user.career || 'your industry',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    subject = subject.replaceAll(placeholder, value);
    body = body.replaceAll(placeholder, value);
  }

  return { subject, body };
}


/**
 * Pattern-only enrichment: find people matching filters who lack emails,
 * then apply existing email patterns (free — no Apollo calls).
 * Apollo enrichment now happens at send time via enrichPersonBeforeSend() in send.ts.
 */
async function enrichPeopleWithPatterns(
  filters: PersonFilters,
  searchCompany: string
): Promise<{ emailsGenerated: number }> {
  // Build where clause for people WITHOUT emails
  const baseWhere = buildPersonWhereClause({ ...filters, requireEmail: false });
  const where = {
    ...baseWhere,
    email: null,
    firstName: { not: null },
    lastName: { not: null },
  };

  const candidates = await prisma.person.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 30,
  });

  // If pre-resolved aliases were used, exact-match DB query is sufficient — skip post-filter
  const matched = (filters.companyAliases && filters.companyAliases.length > 0)
    ? candidates
    : applyPostQueryFilters(candidates, searchCompany);

  let emailsGenerated = 0;

  for (const person of matched) {
    // Try existing pattern (free — no Apollo call)
    const pattern = await getCompanyPattern(person.company);

    if (pattern) {
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
      console.log(`[Enrich] Pattern → ${person.firstName} ${person.lastName} → ${generatedEmail}`);
    }
  }

  console.log(`[Enrich] Done: ${emailsGenerated} emails generated (pattern-only)`);
  return { emailsGenerated };
}

/**
 * Shared helper: build SearchResultWithDraft[] from ranked candidates.
 * Upserts UserCandidate, generates email drafts, and maps to result objects.
 */
async function buildResultsWithDrafts(
  rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>,
  userId: string,
  template: ResolvedTemplate,
  user: { name: string | null; university: string | null; classification: string | null; major: string | null; career: string | null }
): Promise<SearchResultWithDraft[]> {
  return Promise.all(
    rankedPeople.map(async ({ candidate: person, score, breakdown }) => {
      const userCandidate = await prisma.userCandidate.upsert({
        where: {
          userId_personId: { userId, personId: person.id },
        },
        create: {
          userId,
          personId: person.id,
          email: person.email,
          emailStatus: (person.emailStatus as any) || 'MISSING',
          emailConfidence: person.emailConfidence,
        },
        update: {},
        select: { id: true },
      });

      // Generate placeholder-filled template (LLM generation happens on-demand when user opens profile)
      const draft = generateEmailDraft(
        template,
        { firstName: person.firstName, company: person.company, role: person.role },
        user
      );

      const isHardcodedTemplate = EMAIL_TEMPLATES.some(t => t.id === template.id);
      const emailDraft = await prisma.emailDraft.upsert({
        where: { userCandidateId: userCandidate.id },
        create: {
          userCandidateId: userCandidate.id,
          templateId: isHardcodedTemplate ? null : template.id,
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
        resumeId: template.attachResume ? template.resumeId : null,
        score,
        scoreBreakdown: breakdown,
      };
    })
  );
}

/**
 * Main search action — always queries DB directly with offset pagination.
 *
 * Two-path UX:
 *   0 results + not scraped:  Block, scrape synchronously, return results
 *   1+ results or already scraped: Return immediately (prescrape populates DB in background)
 *
 * hasMore = got a full page from DB OR CSE has more pages to scrape.
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
        classification: true,
        major: true,
        career: true,
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

    // Count hidden people for the UI bar
    const hiddenCount = await prisma.userCandidate.count({
      where: { userId, doNotShow: true },
    });

    // Get excluded people (already sent or hidden)
    const excludedIds = await getExcludedPersonIds(userId);
    console.log(`[Search] User has ${excludedIds.length} excluded people (sent/hidden).`);

    // Merge sent/hidden IDs with already-displayed IDs for a single DB-level NOT IN
    const allExcludedIds = input.excludePersonIds
      ? [...excludedIds, ...input.excludePersonIds]
      : excludedIds;

    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    // Resolve company aliases (hardcoded → DB → LLM) for richer matching
    const resolved = await resolveCompanyAliases(input.company);
    console.log(`[Search] Resolved company "${input.company}" → ${resolved.aliases.length} aliases`);

    // ===== STEP 1: Query DB, enrich only if needed =====
    const filters: PersonFilters = {
      company: input.company,
      companyAliases: resolved.aliases,
      location: input.location,
      role: input.role,
      university: input.university,
      requireEmail: false,
      excludePersonIds: allExcludedIds,
      limit: input.limit,
    };

    // Query DB first — try free pattern enrichment if we don't have enough results
    let people = await findPeopleByFilters(filters);
    console.log(`[Search] Found ${people.length} people in DB (need ${input.limit})`);

    if (people.length < input.limit) {
      // Not enough results — try free pattern enrichment, then re-query
      console.log(`[Search] Under limit, enriching with patterns`);
      await enrichPeopleWithPatterns(filters, input.company);
      people = await findPeopleByFilters(filters);
      console.log(`[Search] After enrichment: ${people.length} people`);
    }
    const apolloCallsMade = 0;
    let apolloCacheHits = 0;
    let cseCallsMade = 0;
    let cseHasMorePages = false;

    // ===== STEP 2: Check CSE state + sync scrape if 0 results =====
    const progress = await findOrCreateScrapeProgress(normalizedParams);
    const nextPage = getNextCsePageStart(progress.lastCsePageScraped, progress.cseExhausted);

    if (nextPage !== null) {
      cseHasMorePages = true;

      if (people.length === 0) {
        // 0 results → scrape synchronously (user expects to wait)
        console.log(`[Search] 0 results, scraping CSE page ${nextPage} synchronously`);
        const batch = await processRefreshBatch(input, nextPage, 'SyncScrape');
        cseCallsMade = 1;

        await updateScrapeProgress(progress.id, nextPage, batch.urlsFromCse, {
          cseCallsMade: 1,
          linkedinScraperCalls: batch.urlsScraped,
          apolloCallsMade: 0,
          profilesAdded: batch.newPeopleCount,
          profilesMatchedSearch: batch.matchedCount,
        });

        // Enrich newly scraped people with patterns before re-querying
        await enrichPeopleWithPatterns(filters, input.company);

        // Re-query DB after scraping + enrichment added new people
        people = await findPeopleByFilters(filters);
        console.log(`[Search] After scrape+enrich: ${people.length} results`);
      }
      // 1+ results: return as-is, prescrape will populate DB in background
    }

    // ===== STEP 3: Rank candidates =====
    const vectorActive = isVectorRoleMatchingEnabled() && !!input.role;

    let rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>;

    if (vectorActive) {
      // Vector mode: DB already returned results ordered by cosine distance + email tiebreaker.
      // Skip rankCandidates to preserve that semantic ordering.
      rankedPeople = people.map((person) => ({
        candidate: person as PersonWithSource,
        score: person.roleDistance != null ? Math.round((1 - person.roleDistance) * 100) : 0,
        breakdown: {} as ScoreBreakdown,
      }));
      console.log(`[Search] Vector mode: using DB ordering for ${rankedPeople.length} candidates`);
      if (rankedPeople.length > 0) {
        const first = people[0];
        const last = people[people.length - 1];
        console.log(`[Search] Distance range: ${first.roleDistance?.toFixed(4)} (${first.role}) → ${last.roleDistance?.toFixed(4)} (${last.role})`);
      }
    } else {
      // Fallback: keyword-based ranking
      const searchCriteria: SearchCriteria = {
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      };

      rankedPeople = rankCandidates(
        searchCriteria,
        people,
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
      console.log(`[Search] Fallback mode: ranked top ${rankedPeople.length} candidates`);
    }

    // ===== STEP 4: Build results with drafts =====
    const template = await resolveTemplateForUser(userId, input.templateId);
    console.log(`[Search] Resolved template: id=${template.id}, attachResume=${template.attachResume}, resumeId=${template.resumeId || '(none)'}`);
    const results = await buildResultsWithDrafts(rankedPeople, userId, template, user);

    // ===== STEP 5: Compute hasMore =====
    // Full page from DB means probably more rows; CSE having more pages
    // means prescrape will populate DB for future Load More clicks.
    const hasMore = people.length >= input.limit || cseHasMorePages;

    console.log(
      `[Search] Returning ${results.length} results (hasMore=${hasMore}, cseHasMore=${cseHasMorePages})`
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
        fromCache: false, // No longer using cache — kept for schema compatibility
      },
    });

    return {
      success: true,
      results,
      searchMeta: {
        hasMore,
        apolloCallsMade,
        apolloCacheHits,
        cseCallsMade,
      },
      remainingDaily,
      hiddenCount,
    };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: 'Search failed. Please try again.' };
  }
}

/**
 * Get recent unique searches for the current user.
 * Deduplicates by (company, role, university, location) key, returns top 8.
 */
export async function getRecentSearchesAction(): Promise<RecentSearch[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return [];

  try {
    const logs = await prisma.searchLog.findMany({
      where: { userId: session.user.id },
      orderBy: { searchedAt: 'desc' },
      take: 50,
      select: {
        company: true,
        role: true,
        university: true,
        location: true,
        searchedAt: true,
        resultsCount: true,
      },
    });

    // Deduplicate by combo key, keeping first (most recent) occurrence
    const seen = new Set<string>();
    const unique: RecentSearch[] = [];

    for (const log of logs) {
      const key = [log.company, log.role, log.university, log.location]
        .map((v) => (v || '').toLowerCase().trim())
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(log);
      if (unique.length >= 8) break;
    }

    return unique;
  } catch (error) {
    console.error('Error fetching recent searches:', error);
    return [];
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
      where: { id: userCandidateId, userId: session.user.id },
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
 * Fetch hidden people for the current user (for the "N people hidden" bar)
 */
export async function getHiddenPeopleAction(): Promise<
  { success: true; people: HiddenPerson[] } | { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const hidden = await prisma.userCandidate.findMany({
      where: { userId: session.user.id, doNotShow: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        personId: true,
        person: {
          select: { fullName: true, company: true, role: true },
        },
      },
    });

    return {
      success: true,
      people: hidden.map((uc) => ({
        userCandidateId: uc.id,
        personId: uc.personId,
        fullName: uc.person.fullName,
        company: uc.person.company,
        role: uc.person.role,
      })),
    };
  } catch (error) {
    console.error('Error fetching hidden people:', error);
    return { success: false, error: 'Failed to fetch hidden people' };
  }
}

/**
 * Unhide a person (reverse of hidePersonAction).
 * Returns the full SearchResultWithDraft so the UI can re-insert them into results.
 */
export async function unhidePersonAction(
  userCandidateId: string
): Promise<{ success: true; person: SearchResultWithDraft } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    // Unhide
    await prisma.userCandidate.update({
      where: { id: userCandidateId, userId },
      data: { doNotShow: false },
    });

    // Fetch person + draft data to return to the UI
    const uc = await prisma.userCandidate.findUnique({
      where: { id: userCandidateId },
      select: {
        id: true,
        personId: true,
        person: {
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
              select: { url: true, title: true, snippet: true, domain: true },
            },
          },
        },
        emailDraft: {
          select: { subject: true, body: true, template: { select: { id: true, attachResume: true, resumeId: true } } },
        },
      },
    });

    if (!uc) {
      return { success: false, error: 'Candidate not found' };
    }

    const p = uc.person;
    const sourceLink = p.sourceLinks[0];
    const draft = uc.emailDraft;

    const person: SearchResultWithDraft = {
      id: p.id,
      fullName: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.company,
      role: p.role,
      linkedinUrl: p.linkedinUrl,
      email: p.email,
      emailStatus: (p.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
      emailConfidence: p.emailConfidence,
      emailDeliverable: p.emailDeliverable,
      emailVerifiedAt: p.emailVerifiedAt,
      emailVerificationReason: p.emailVerificationReason,
      city: p.city,
      state: p.state,
      country: p.country,
      educationSchool: p.educationSchool,
      educationDegree: p.educationDegree,
      educationField: p.educationField,
      educationYear: p.educationYear,
      sourceUrl: sourceLink?.url || null,
      sourceTitle: sourceLink?.title || null,
      sourceSnippet: sourceLink?.snippet || null,
      sourceDomain: sourceLink?.domain || null,
      draftSubject: draft?.subject || '',
      draftBody: draft?.body || '',
      userCandidateId: uc.id,
      resumeId: draft?.template?.attachResume ? draft.template.resumeId : null,
    };

    console.log(`[Unhide] User ${userId} unmarked userCandidate ${userCandidateId}`);
    return { success: true, person };
  } catch (error) {
    console.error('Error unhiding person:', error);
    return { success: false, error: 'Failed to unhide person' };
  }
}

// ===== LOAD MORE (pure DB read + enrichment, no scraping) =====

export interface LoadMoreInput {
  company: string;
  role?: string;
  university?: string;
  location?: string;
  name?: string;
  limit: number;
  templateId?: string;
  excludePersonIds: string[];
}

export interface LoadMoreMeta {
  hasMore: boolean;
  prescrapeRunning: boolean;
}

export type LoadMoreActionResult = {
  success: true;
  results: SearchResultWithDraft[];
  loadMoreMeta: LoadMoreMeta;
} | {
  success: false;
  error: string;
};

/**
 * Load More action — pure DB read + on-demand enrichment.
 * No scraping, no Path A/B logic, no SearchLog creation.
 */
export async function loadMorePeopleAction(
  input: LoadMoreInput
): Promise<LoadMoreActionResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, university: true, classification: true, major: true, career: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Merge sent/hidden IDs with already-displayed IDs
    const excludedIds = await getExcludedPersonIds(userId);
    const allExcludedIds = [...excludedIds, ...input.excludePersonIds];

    // Resolve company aliases (hardcoded → DB → LLM) for richer matching
    const resolved = await resolveCompanyAliases(input.company);

    const filters: PersonFilters = {
      company: input.company,
      companyAliases: resolved.aliases,
      location: input.location,
      role: input.role,
      university: input.university,
      requireEmail: false,
      excludePersonIds: allExcludedIds,
      limit: input.limit,
    };

    // Query DB first — try free pattern enrichment if not enough results
    let people = await findPeopleByFilters(filters);
    console.log(`[LoadMore] Found ${people.length} people in DB (need ${input.limit})`);

    if (people.length < input.limit) {
      // Not enough results — try free pattern enrichment, then re-query
      console.log(`[LoadMore] Under limit, enriching with patterns`);
      await enrichPeopleWithPatterns(filters, input.company);
      people = await findPeopleByFilters(filters);
      console.log(`[LoadMore] After enrichment: ${people.length} people`);
    }

    // Rank candidates
    const vectorActive = isVectorRoleMatchingEnabled() && !!input.role;

    let rankedPeople: Array<{ candidate: PersonWithSource; score: number; breakdown: ScoreBreakdown }>;

    if (vectorActive) {
      // Vector mode: DB already returned results ordered by cosine distance.
      rankedPeople = people.map((person) => ({
        candidate: person as PersonWithSource,
        score: person.roleDistance != null ? Math.round((1 - person.roleDistance) * 100) : 0,
        breakdown: {} as ScoreBreakdown,
      }));
      console.log(`[LoadMore] Vector mode: using DB ordering for ${rankedPeople.length} candidates`);
    } else {
      // Fallback: keyword-based ranking
      const searchCriteria: SearchCriteria = {
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      };

      rankedPeople = rankCandidates(
        searchCriteria,
        people,
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
      console.log(`[LoadMore] Fallback mode: ranked top ${rankedPeople.length} candidates`);
    }

    // Build results with drafts
    const template = await resolveTemplateForUser(userId, input.templateId);
    const results = await buildResultsWithDrafts(rankedPeople, userId, template, user);

    // Check prescrape status
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });
    const progress = await findOrCreateScrapeProgress(normalizedParams);
    const prescrapeRunning = progress.prescrapeStatus === 'RUNNING';

    // hasMore = got a full page (probably more in DB) OR prescrape still running (more may appear)
    const hasMore = people.length >= input.limit || prescrapeRunning;

    console.log(
      `[LoadMore] Returning ${results.length} results (hasMore=${hasMore}, prescrapeRunning=${prescrapeRunning})`
    );

    return {
      success: true,
      results,
      loadMoreMeta: { hasMore, prescrapeRunning },
    };
  } catch (error) {
    console.error('LoadMore error:', error);
    return { success: false, error: 'Failed to load more profiles.' };
  }
}

/**
 * Core refresh logic - processes a single batch of CSE results
 * Used by refreshSearchAction for both batch 1 (immediate) and batch 2 (background)
 */
async function processRefreshBatch(
  input: Omit<SearchInput, 'templateId' | 'limit'> & { limit?: number },
  pageStart: number,
  batchLabel: string
): Promise<{
  newPeopleCount: number;
  matchedCount: number;
  emailsGenerated: number;
  apolloCallsMade: number;
  savedPersonIds: string[];
  urlsScraped: number;
  urlsFromCse: number;  // How many URLs CSE returned (10 = likely more pages)
  csePrefiltered: number; // How many profiles skipped by CSE company pre-filter
}> {
  let newPeopleCount = 0;
  let matchedCount = 0;
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
    return { newPeopleCount: 0, matchedCount: 0, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds: [], urlsScraped: 0, urlsFromCse: 0, csePrefiltered: 0 };
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

  // ===== STEP 2.5: PRE-FILTER BY CSE COMPANY METATAG =====
  let csePrefiltered = 0;
  if (input.company) {
    const normalizedSearchCompany = normalizeCompanyForMatch(input.company);
    // Resolve aliases (hardcoded → DB → LLM) for richer matching
    const resolved = await resolveCompanyAliases(input.company);
    const resolvedNormalized = resolved.aliases.map(a => normalizeCompanyForMatch(a));

    const beforeCount = urlsToScrape.length;
    urlsToScrape = urlsToScrape.filter((url) => {
      const cseResult = cseResultMap.get(url);
      if (!cseResult?.cseCompany) return true; // Keep if no metatag (conservative)
      const normalizedCseCompany = normalizeCompanyForMatch(cseResult.cseCompany);

      // Check against resolved aliases first
      const aliasMatch = resolvedNormalized.some(alias =>
        normalizedCseCompany === alias ||
        normalizedCseCompany.startsWith(alias + ' ') ||
        normalizedCseCompany.startsWith(alias + '-') ||
        alias.startsWith(normalizedCseCompany + ' ') ||
        alias.startsWith(normalizedCseCompany + '-')
      );
      if (aliasMatch) return true;

      // Fallback: companiesMatch handles bidirectional substring for cases
      // like "Pfizer" vs "Pfizer Inc." that don't need aliases
      const fallbackMatch = companiesMatch(normalizedCseCompany, normalizedSearchCompany);
      if (!fallbackMatch) {
        console.log(`[Refresh ${batchLabel}] Pre-filtered: "${cseResult.cseFirstName} ${cseResult.cseLastName}" — CSE company "${cseResult.cseCompany}" doesn't match "${input.company}"`);
      }
      return fallbackMatch;
    });
    csePrefiltered = beforeCount - urlsToScrape.length;
    if (csePrefiltered > 0) {
      console.log(`[Refresh ${batchLabel}] Pre-filtered ${csePrefiltered}/${beforeCount} profiles by CSE company mismatch`);
    }
  }

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
        if (isNew) {
          newPeopleCount++;
          // Check if this profile matches the user's full search criteria
          const companyMatch = !input.company || companiesMatch(
            normalizeCompanyForMatch(profile.company || ''),
            normalizeCompanyForMatch(input.company)
          );
          const roleMatch = !input.role || (profile.role || '').toLowerCase().includes(input.role.toLowerCase());
          const uniMatch = !input.university || (profile.schools || []).some(
            (s) => s.toLowerCase().includes(input.university!.toLowerCase())
          );
          const locMatch = !input.location || [profile.city, profile.state, profile.country]
            .filter(Boolean).some((v) => v!.toLowerCase().includes(input.location!.toLowerCase()));
          if (companyMatch && roleMatch && uniMatch && locMatch) matchedCount++;
        }
      }

      console.log(`[Refresh ${batchLabel}] Saved ${profiles.length} profiles`);
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });
  }

  // Email enrichment is now handled on-demand in searchPeopleAction via enrichPeopleOnDemand()
  return { newPeopleCount, matchedCount, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds, urlsScraped: urlsToScrape.length, urlsFromCse: cseResults.length, csePrefiltered };
}

const MAX_PRESCRAPE_PAGES = 2;

/**
 * Background prescrape: scrape all remaining CSE pages (up to 4 total) for a search.
 * Fire-and-forget from the frontend — populates the Person table so future
 * Load More clicks are instant DB reads.
 */
export async function prescrapeAction(
  input: {
    company: string;
    role?: string;
    university?: string;
    location?: string;
    name?: string;
  }
): Promise<{ success: true; pagesScraped: number } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.company || !input.company.trim()) {
    return { success: false, error: 'Company is required' };
  }

  try {
    const normalizedParams = normalizeSearchParams({
      name: input.name,
      company: input.company,
      role: input.role,
      university: input.university,
      location: input.location,
    });

    let pagesScraped = 0;

    // Bail out if a prescrape is already running for these params
    const initialProgress = await findOrCreateScrapeProgress(normalizedParams);
    if (initialProgress.prescrapeStatus === 'RUNNING') {
      console.log(`[Prescrape] Already running for "${input.company}", skipping`);
      return { success: true, pagesScraped: 0 };
    }

    await prisma.search.update({
      where: { id: initialProgress.id },
      data: { prescrapeStatus: 'RUNNING' },
    });

    while (pagesScraped < MAX_PRESCRAPE_PAGES) {
      // Re-fetch progress each iteration (updated by previous iteration)
      const progress = await findOrCreateScrapeProgress(normalizedParams);
      const nextPage = getNextCsePageStart(progress.lastCsePageScraped, progress.cseExhausted);

      if (nextPage === null) {
        console.log(`[Prescrape] CSE exhausted after ${pagesScraped} pages for "${input.company}"`);
        break;
      }

      console.log(`[Prescrape] Scraping CSE page ${nextPage} for "${input.company}" (${pagesScraped + 1}/${MAX_PRESCRAPE_PAGES})`);
      const batch = await processRefreshBatch(input, nextPage, `Prescrape-${pagesScraped + 1}`);

      await updateScrapeProgress(progress.id, nextPage, batch.urlsFromCse, {
        cseCallsMade: 1,
        linkedinScraperCalls: batch.urlsScraped,
        apolloCallsMade: batch.apolloCallsMade,
        profilesAdded: batch.newPeopleCount,
        profilesMatchedSearch: batch.matchedCount,
      });

      pagesScraped++;

      // CSE returned fewer than threshold — no more pages
      if (batch.urlsFromCse < 5) {
        console.log(`[Prescrape] CSE exhausted (${batch.urlsFromCse} URLs) after ${pagesScraped} pages`);
        break;
      }
    }

    // Mark prescrape as done
    await prisma.search.update({
      where: { id: initialProgress.id },
      data: { prescrapeStatus: 'DONE' },
    });

    console.log(`[Prescrape] Done: scraped ${pagesScraped} pages for "${input.company}"`);
    return { success: true, pagesScraped };
  } catch (error) {
    console.error('Prescrape error:', error);
    // Mark as DONE even on error to prevent permanently stuck RUNNING state
    try {
      const progress = await findOrCreateScrapeProgress(normalizeSearchParams({
        name: input.name,
        company: input.company,
        role: input.role,
        university: input.university,
        location: input.location,
      }));
      await prisma.search.update({
        where: { id: progress.id },
        data: { prescrapeStatus: 'DONE' },
      });
    } catch (e) {
      console.error('Failed to mark prescrape as DONE after error:', e);
    }
    return { success: false, error: 'Prescraping failed.' };
  }
}

// ===== PERSON LOOKUP (by name) =====

export interface LookupInput {
  name: string;
  company?: string;
  templateId?: string;
}

export type LookupActionResult = {
  success: true;
  results: SearchResultWithDraft[];
} | {
  success: false;
  error: string;
};

/**
 * Look up a specific person by name.
 *
 * Flow:
 * 1. Check DB for existing people matching the name
 * 2. If few DB results, also query CSE (two-pass: name+company, then name-only)
 * 3. Save new CSE profiles → enrich with patterns/Apollo → generate drafts
 * 4. Merge + deduplicate, return top 5 as SearchResultWithDraft[]
 */
export async function lookupPersonAction(
  input: LookupInput
): Promise<LookupActionResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.name || input.name.trim().length < 2) {
    return { success: false, error: 'Name must be at least 2 characters' };
  }

  try {
    const userId = session.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        university: true,
        classification: true,
        major: true,
        career: true,
      },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const cleanName = input.name.replace(/,.*$/, '').trim();

    // ===== STEP 1: Check DB first =====
    const dbPeople = await findPeopleByName({
      name: cleanName,
      company: input.company,
      limit: 5,
    });
    console.log(`[Lookup] DB found ${dbPeople.length} people for "${cleanName}"`);

    // Track which LinkedIn URLs we already have from DB
    const dbLinkedInUrls = new Set(
      dbPeople.filter((p) => p.linkedinUrl).map((p) => p.linkedinUrl!)
    );

    // ===== STEP 2: CSE lookup (unless DB already has plenty) =====
    let csePeople: PersonResult[] = [];
    const dbHasEnough = dbPeople.filter((p) => p.email).length >= 3;

    if (!dbHasEnough) {
      console.log('[Lookup] DB results insufficient, querying CSE');
      const cseResults = await lookupByName({
        name: cleanName,
        company: input.company,
      });

      if (cseResults.length > 0) {
        // Check which CSE results already exist in DB
        const cseUrls = cseResults.map((r) => r.linkedinUrl);
        const existingMap = await findPeopleByLinkedInUrls(cseUrls);

        // Separate existing vs new CSE results
        const newCseResults: typeof cseResults = [];
        for (const cseResult of cseResults) {
          if (dbLinkedInUrls.has(cseResult.linkedinUrl)) continue;

          const existing = existingMap.get(cseResult.linkedinUrl);
          if (existing) {
            csePeople.push({
              ...existing,
              emailDeliverable: null,
              emailVerifiedAt: null,
              emailVerificationReason: null,
            });
            dbLinkedInUrls.add(cseResult.linkedinUrl);
          } else {
            newCseResults.push(cseResult);
          }
        }

        // Scrape new profiles via Apify to get full data (role, location, education)
        if (newCseResults.length > 0) {
          const urlsToScrape = newCseResults.map(r => r.linkedinUrl);
          let scrapedMap = new Map<string, ScrapedProfile>();

          try {
            const scraped = await scrapeLinkedInProfiles(urlsToScrape, { includeEmail: false });
            for (const profile of scraped) {
              scrapedMap.set(profile.linkedinUrl, profile);
            }
            console.log(`[Lookup] Scraped ${scraped.length}/${urlsToScrape.length} new profiles`);
          } catch (err) {
            console.error('[Lookup] Scraper failed, falling back to CSE-only data:', err);
          }

          for (const cseResult of newCseResults) {
            const scraped = scrapedMap.get(cseResult.linkedinUrl);
            const profile = scraped || {
              linkedinUrl: cseResult.linkedinUrl,
              fullName: cseResult.fullName || '',
              firstName: cseResult.firstName || '',
              lastName: cseResult.lastName || '',
              company: cseResult.cseCompany || input.company || null,
              role: null,
              email: null,
              city: null,
              state: null,
              country: null,
              schools: [] as string[],
              educationSchool: null,
            };

            const { personId } = await saveScrapedProfile(
              profile,
              cseResult.linkedinUrl,
              cseResult.sourceTitle,
              cseResult.sourceSnippet,
              cseResult.sourceDomain,
              input.company || cseResult.cseCompany || '',
              undefined
            );

            const saved = await prisma.person.findUnique({
              where: { id: personId },
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
                  select: { url: true, title: true, snippet: true, domain: true },
                },
              },
            });
            if (saved) {
              csePeople.push(saved);
              dbLinkedInUrls.add(cseResult.linkedinUrl);
            }
          }
        }
        console.log(`[Lookup] CSE added ${csePeople.length} new people`);
      }
    }

    // ===== STEP 3: Merge + deduplicate =====
    const allPeople = [...dbPeople, ...csePeople];

    // Deduplicate by person ID
    const seen = new Set<string>();
    const uniquePeople = allPeople.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // Sort: has email first, then VERIFIED > UNVERIFIED > MISSING
    uniquePeople.sort((a, b) => {
      const aHasEmail = a.email ? 0 : 1;
      const bHasEmail = b.email ? 0 : 1;
      if (aHasEmail !== bHasEmail) return aHasEmail - bHasEmail;

      const statusOrder: Record<string, number> = { VERIFIED: 0, UNVERIFIED: 1, MISSING: 2 };
      const aStatus = statusOrder[a.emailStatus || 'MISSING'] ?? 2;
      const bStatus = statusOrder[b.emailStatus || 'MISSING'] ?? 2;
      return aStatus - bStatus;
    });

    const top = uniquePeople.slice(0, 5);

    if (top.length === 0) {
      return { success: true, results: [] };
    }

    // ===== STEP 4: Enrich people without emails (pattern-only, free) =====
    // Apollo enrichment now happens at send time.
    for (const person of top) {
      if (person.email || !person.firstName || !person.lastName) continue;

      const pattern = await getCompanyPattern(person.company);

      if (pattern) {
        const generatedEmail = generateEmailFromPattern(
          person.firstName,
          person.lastName,
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
        person.email = generatedEmail;
        person.emailStatus = 'UNVERIFIED';
        person.emailConfidence = Math.round(pattern.confidence * 100);
        console.log(`[Lookup] Pattern → ${person.fullName} → ${generatedEmail}`);
      }
    }

    // ===== STEP 5: Build results with drafts =====
    // Wrap in the format buildResultsWithDrafts expects
    const ranked = top.map((person) => ({
      candidate: person as PersonWithSource,
      score: 100,
      breakdown: {} as ScoreBreakdown,
    }));

    const template = await resolveTemplateForUser(userId, input.templateId);
    const results = await buildResultsWithDrafts(ranked, userId, template, user);

    console.log(`[Lookup] Returning ${results.length} results for "${cleanName}"`);
    return { success: true, results };
  } catch (error) {
    console.error('Lookup error:', error);
    return { success: false, error: 'Lookup failed. Please try again.' };
  }
}

// ===== REGENERATE DRAFT (template change in review modal) =====

export async function regenerateDraftAction(input: {
  userCandidateId: string;
  templateId: string;
}): Promise<
  { success: true; subject: string; body: string; resumeId: string | null } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    // Fetch UserCandidate + Person (expanded fields for LLM)
    const uc = await prisma.userCandidate.findUnique({
      where: { id: input.userCandidateId, userId },
      select: {
        id: true,
        person: {
          select: {
            firstName: true,
            lastName: true,
            company: true,
            role: true,
            city: true,
            state: true,
            country: true,
            educationSchool: true,
            educationDegree: true,
            educationField: true,
          },
        },
      },
    });

    if (!uc) {
      return { success: false, error: 'Candidate not found' };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, university: true, classification: true, major: true, career: true, emailInstructions: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const template = await resolveTemplateForUser(userId, input.templateId);
    const placeholderDraft = generateEmailDraft(
      template,
      { firstName: uc.person.firstName, company: uc.person.company, role: uc.person.role },
      user
    );
    const resumeId = template.attachResume ? template.resumeId : null;

    // Try LLM generation, fall back to placeholder draft on failure
    let draft = placeholderDraft;
    try {
      const resumeSummary = await getUserResumeSummary(userId);
      const sentEmailExamples = await getRecentSentEmails(userId);
      draft = await generateEmailWithLLM({
        person: uc.person,
        user,
        resumeSummary,
        referenceTemplate: placeholderDraft,
        sentEmailExamples,
        customInstructions: user.emailInstructions || undefined,
      });
    } catch (err) {
      console.warn('[RegenerateDraft] LLM generation failed, using placeholder:', err);
    }

    const isHardcodedTemplate = EMAIL_TEMPLATES.some(t => t.id === template.id);
    await prisma.emailDraft.upsert({
      where: { userCandidateId: uc.id },
      create: {
        userCandidateId: uc.id,
        templateId: isHardcodedTemplate ? null : template.id,
        subject: draft.subject,
        body: draft.body,
        status: 'APPROVED',
      },
      update: {
        templateId: isHardcodedTemplate ? null : template.id,
        subject: draft.subject,
        body: draft.body,
      },
    });

    return { success: true, subject: draft.subject, body: draft.body, resumeId };
  } catch (error) {
    console.error('RegenerateDraft error:', error);
    return { success: false, error: 'Failed to regenerate draft' };
  }
}

// ===== GENERATE LLM DRAFT (on-demand when user opens a profile) =====

export async function generateLLMDraftAction(input: {
  personId: string;
  userCandidateId: string;
}): Promise<
  { success: true; subject: string; body: string } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const userId = session.user.id;

    const [person, user, resumeSummary, sentEmailExamples] = await Promise.all([
      prisma.person.findUnique({
        where: { id: input.personId },
        select: {
          firstName: true,
          lastName: true,
          company: true,
          role: true,
          city: true,
          state: true,
          country: true,
          educationSchool: true,
          educationDegree: true,
          educationField: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, university: true, classification: true, major: true, career: true, emailInstructions: true },
      }),
      getUserResumeSummary(userId),
      getRecentSentEmails(userId),
    ]);

    if (!person || !user) {
      return { success: false, error: 'Person or user not found' };
    }

    const template = await resolveTemplateForUser(userId);
    const placeholderDraft = generateEmailDraft(
      template,
      { firstName: person.firstName, company: person.company, role: person.role },
      user
    );

    const draft = await generateEmailWithLLM({
      person,
      user,
      resumeSummary,
      referenceTemplate: placeholderDraft,
      sentEmailExamples,
      customInstructions: user.emailInstructions || undefined,
    });

    // Save to DB so subsequent visits show the LLM draft
    await prisma.emailDraft.update({
      where: { userCandidateId: input.userCandidateId },
      data: { subject: draft.subject, body: draft.body },
    });

    return { success: true, subject: draft.subject, body: draft.body };
  } catch (error) {
    console.error('GenerateLLMDraft error:', error);
    return { success: false, error: 'Failed to generate draft' };
  }
}

// ===== REFINE DRAFT (chat-based refinement) =====

export async function refineDraftAction(input: {
  subject: string;
  body: string;
  instruction: string;
  personId: string;
}): Promise<
  { success: true; subject: string; body: string } |
  { success: false; error: string }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!input.instruction?.trim()) {
    return { success: false, error: 'Instruction is required' };
  }

  try {
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { firstName: true, company: true, role: true },
    });

    if (!person) {
      return { success: false, error: 'Person not found' };
    }

    const result = await refineEmailWithLLM({
      subject: input.subject,
      body: input.body,
      instruction: input.instruction,
      person: {
        firstName: person.firstName,
        company: person.company,
        role: person.role,
      },
    });

    return { success: true, subject: result.subject, body: result.body };
  } catch (error) {
    console.error('RefineDraft error:', error);
    return { success: false, error: 'Failed to refine email' };
  }
}
