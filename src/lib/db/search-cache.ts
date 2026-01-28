import prisma from '@/lib/prisma';

const CACHE_TTL_HOURS = 24;

export interface NormalizedSearchParams {
  name: string | null;
  company: string | null;
  role: string | null;
  university: string | null;
  location: string | null;
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
 * Finds a stale cached search (> 24 hours old) with matching parameters.
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
  personIds: string[]
): Promise<{ searchId: string }> {
  const search = await prisma.search.create({
    data: {
      name: params.name,
      company: params.company,
      role: params.role,
      university: params.university,
      location: params.location,
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
 */
export async function updateSearchWithPeople(
  searchId: string,
  personIds: string[]
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
    // Update timestamp
    prisma.search.update({
      where: { id: searchId },
      data: { createdAt: new Date() },
    }),
  ]);
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
