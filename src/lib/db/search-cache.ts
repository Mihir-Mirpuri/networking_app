import prisma from '@/lib/prisma';

const CACHE_TTL_HOURS = 168; // 7 days
const PERSON_CACHE_TTL_DAYS = 60; // 60 days - then check for staleness (email bounce)

export interface NormalizedSearchParams {
  name: string | null;
  company: string | null;
  role: string | null;
  university: string | null;
  location: string | null;
}

export interface ApiUsageStats {
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
  linkedinScraperCalls: number;
}

/**
 * Normalizes search parameters for consistent caching.
 * - Converts to lowercase
 * - Trims whitespace
 * - Converts empty strings to null
 */
export function normalizeSearchParams(params: {
  name?: string;
  company?: string;
  role?: string;
  university?: string;
  location?: string;
}): NormalizedSearchParams {
  const normalize = (value: string | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' ? null : trimmed;
  };

  return {
    name: normalize(params.name),
    company: normalize(params.company),
    role: normalize(params.role),
    university: normalize(params.university),
    location: normalize(params.location),
  };
}

/**
 * Finds a cached search with matching parameters that was created within the TTL window.
 * Returns the search record if found, null otherwise.
 */
export async function findCachedSearch(
  params: NormalizedSearchParams
): Promise<{ id: string; createdAt: Date } | null> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - CACHE_TTL_HOURS);

  // Use raw SQL to handle NULL comparisons correctly with COALESCE
  const results = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
    SELECT "id", "createdAt"
    FROM "Search"
    WHERE COALESCE("name", '') = COALESCE(${params.name}, '')
      AND COALESCE("company", '') = COALESCE(${params.company}, '')
      AND COALESCE("role", '') = COALESCE(${params.role}, '')
      AND COALESCE("university", '') = COALESCE(${params.university}, '')
      AND COALESCE("location", '') = COALESCE(${params.location}, '')
      AND "createdAt" >= ${cutoff}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  return results.length > 0 ? results[0] : null;
}

/**
 * Finds a stale cached search (> 7 days old) with matching parameters.
 * Used for update-in-place strategy.
 */
export async function findStaleSearch(
  params: NormalizedSearchParams
): Promise<{ id: string; createdAt: Date } | null> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - CACHE_TTL_HOURS);

  const results = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
    SELECT "id", "createdAt"
    FROM "Search"
    WHERE COALESCE("name", '') = COALESCE(${params.name}, '')
      AND COALESCE("company", '') = COALESCE(${params.company}, '')
      AND COALESCE("role", '') = COALESCE(${params.role}, '')
      AND COALESCE("university", '') = COALESCE(${params.university}, '')
      AND COALESCE("location", '') = COALESCE(${params.location}, '')
      AND "createdAt" < ${cutoff}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  return results.length > 0 ? results[0] : null;
}

/**
 * Finds any existing search with matching parameters (regardless of age).
 * Used when we want to update an existing search rather than create a new one.
 */
export async function findExistingSearch(
  params: NormalizedSearchParams
): Promise<{ id: string; createdAt: Date } | null> {
  const results = await prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
    SELECT "id", "createdAt"
    FROM "Search"
    WHERE COALESCE("name", '') = COALESCE(${params.name}, '')
      AND COALESCE("company", '') = COALESCE(${params.company}, '')
      AND COALESCE("role", '') = COALESCE(${params.role}, '')
      AND COALESCE("university", '') = COALESCE(${params.university}, '')
      AND COALESCE("location", '') = COALESCE(${params.location}, '')
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  return results.length > 0 ? results[0] : null;
}

/**
 * Gets all Person IDs linked to a search.
 */
export async function getCachedPersonIds(searchId: string): Promise<string[]> {
  const searchPeople = await prisma.searchPerson.findMany({
    where: { searchId },
    select: { personId: true },
  });

  return searchPeople.map((sp) => sp.personId);
}

/**
 * Creates a new Search record and links it to the given Person IDs.
 */
export async function createSearchWithPeople(
  params: NormalizedSearchParams,
  personIds: string[],
  apiStats?: ApiUsageStats
): Promise<{ searchId: string }> {
  const search = await prisma.search.create({
    data: {
      name: params.name,
      company: params.company,
      role: params.role,
      university: params.university,
      location: params.location,
      apolloCallsMade: apiStats?.apolloCallsMade ?? 0,
      apolloCacheHits: apiStats?.apolloCacheHits ?? 0,
      cseCallsMade: apiStats?.cseCallsMade ?? 0,
      linkedinScraperCalls: apiStats?.linkedinScraperCalls ?? 0,
      completedAt: new Date(),
    },
  });

  if (personIds.length > 0) {
    await prisma.searchPerson.createMany({
      data: personIds.map((personId) => ({
        searchId: search.id,
        personId,
      })),
      skipDuplicates: true,
    });
  }

  return { searchId: search.id };
}

/**
 * Updates an existing (stale) Search record with fresh results.
 * - Deletes old SearchPerson links
 * - Creates new SearchPerson links
 * - Updates createdAt to now
 * - Updates API usage stats
 */
export async function updateSearchWithPeople(
  searchId: string,
  personIds: string[],
  apiStats?: ApiUsageStats
): Promise<void> {
  await prisma.$transaction([
    // Delete old links
    prisma.searchPerson.deleteMany({
      where: { searchId },
    }),
    // Create new links
    prisma.searchPerson.createMany({
      data: personIds.map((personId) => ({
        searchId,
        personId,
      })),
      skipDuplicates: true,
    }),
    // Update timestamp and stats
    prisma.search.update({
      where: { id: searchId },
      data: {
        createdAt: new Date(),
        completedAt: new Date(),
        ...(apiStats && {
          apolloCallsMade: apiStats.apolloCallsMade,
          apolloCacheHits: apiStats.apolloCacheHits,
          cseCallsMade: apiStats.cseCallsMade,
          linkedinScraperCalls: apiStats.linkedinScraperCalls,
        }),
      },
    }),
  ]);
}

/**
 * Checks if a person's data is stale (older than 60 days)
 * Checks scrapedAt first, falls back to apolloEnrichedAt for legacy data
 */
export function isPersonStale(scrapedAt: Date | null, apolloEnrichedAt?: Date | null): boolean {
  const lastUpdated = scrapedAt || apolloEnrichedAt;
  if (!lastUpdated) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERSON_CACHE_TTL_DAYS);
  return lastUpdated < cutoff;
}

/**
 * Gets Person IDs that have stale data (null or older than 60 days)
 * Checks scrapedAt first, then apolloEnrichedAt for legacy data
 *
 * Note: Email bounce detection to be implemented by user later.
 * When implemented, check email bounce for stale people to detect job changes
 * instead of immediately re-scraping.
 */
export async function getStalePersonIds(personIds: string[]): Promise<string[]> {
  if (personIds.length === 0) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PERSON_CACHE_TTL_DAYS);

  // Find people where BOTH scrapedAt AND apolloEnrichedAt are stale or null
  // If either is recent, the person is not stale
  const stalePersons = await prisma.person.findMany({
    where: {
      id: { in: personIds },
      // People are stale if they have no recent scrapedAt AND no recent apolloEnrichedAt
      AND: [
        {
          OR: [
            { scrapedAt: null },
            { scrapedAt: { lt: cutoff } },
          ],
        },
        {
          OR: [
            { apolloEnrichedAt: null },
            { apolloEnrichedAt: { lt: cutoff } },
          ],
        },
      ],
    },
    select: { id: true },
  });

  return stalePersons.map(p => p.id);
}

/**
 * Fetches Person records by IDs with their associated data.
 * Returns in the same order as input IDs.
 */
export async function getPersonsByIds(personIds: string[]): Promise<
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
    emailDeliverable: boolean | null;
    emailVerifiedAt: Date | null;
    emailVerificationReason: string | null;
    scrapedAt: Date | null;
    apolloEnrichedAt: Date | null;
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
      kind: string;
    }>;
  }>
> {
  if (personIds.length === 0) return [];

  const persons = await prisma.person.findMany({
    where: {
      id: { in: personIds },
    },
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
      scrapedAt: true,
      apolloEnrichedAt: true,
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
          kind: true,
        },
      },
    },
  });

  // Return in order of input IDs
  const personMap = new Map(persons.map((p) => [p.id, p]));
  return personIds.map((id) => personMap.get(id)!).filter(Boolean);
}
