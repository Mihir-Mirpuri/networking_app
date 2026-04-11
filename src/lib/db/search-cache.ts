import prisma from '@/lib/prisma';

const SCRAPE_PROGRESS_TTL_DAYS = 30; // After 30 days, allow re-scraping from page 1
const CSE_EXHAUSTED_THRESHOLD = 5; // Exhausted when fewer than this many valid profiles returned

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


// ===== SCRAPE PROGRESS TRACKING =====
// These functions replace the cache-based result retrieval with a simpler
// scrape progress tracker. Instead of caching which people belong to a search,
// we track which CSE pages have been scraped for a given set of search params.

export interface ScrapeProgress {
  id: string;
  lastCsePageScraped: number;
  cseExhausted: boolean;
  prescrapeStatus: string | null;
  lastPrescrapeNewCount: number;
}

// Hard cap: 10 total Serper pages. Serper uses 1-based page numbers (1, 2, 3, ...).
// DB field is still named lastCsePageScraped for additive-only migration rule,
// but now stores Serper page numbers instead of CSE start offsets.
const MAX_SERPER_PAGE = 10;

/**
 * Compute the next Serper page number based on scrape progress.
 * Returns null if exhausted or the page cap has been reached.
 *
 * Serper pagination: page 1, 2, 3, ... (not CSE's 1, 11, 21)
 * The DB field lastCsePageScraped now stores Serper page numbers.
 */
export function getNextCsePageStart(
  lastCsePageScraped: number,
  cseExhausted: boolean
): number | null {
  if (cseExhausted) return null;
  if (lastCsePageScraped >= MAX_SERPER_PAGE) return null;
  if (lastCsePageScraped === 0) return 1;
  return lastCsePageScraped + 1;
}

/**
 * Determine if CSE is exhausted based on how many valid profiles were returned.
 * Uses a threshold of 5 because CSE can return non-profile URLs (e.g. linkedin.com/company/)
 * that get filtered out, so a raw page of 10 may yield fewer valid profiles.
 */
export function isCsePageExhausted(validProfileCount: number): boolean {
  return validProfileCount < CSE_EXHAUSTED_THRESHOLD;
}

/**
 * Find or create a scrape progress record for the given search params.
 * If the existing record is older than 7 days, resets progress to allow re-scraping.
 */
export async function findOrCreateScrapeProgress(
  params: NormalizedSearchParams
): Promise<ScrapeProgress> {
  // Look for any existing search with matching params (using COALESCE for NULL-safe comparison)
  const existing = await prisma.$queryRaw<
    Array<{
      id: string;
      lastCsePageScraped: number;
      cseExhausted: boolean;
      prescrapeStatus: string | null;
      lastPrescrapeNewCount: number;
      updatedAt: Date;
    }>
  >`
    SELECT "id", "lastCsePageScraped", "cseExhausted", "prescrapeStatus", "lastPrescrapeNewCount", "updatedAt"
    FROM "Search"
    WHERE COALESCE("name", '') = COALESCE(${params.name}, '')
      AND COALESCE("company", '') = COALESCE(${params.company}, '')
      AND COALESCE("role", '') = COALESCE(${params.role}, '')
      AND COALESCE("university", '') = COALESCE(${params.university}, '')
      AND COALESCE("location", '') = COALESCE(${params.location}, '')
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;

  if (existing.length > 0) {
    const record = existing[0];

    // Check if stale (> 7 days) — reset progress to allow fresh scraping
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SCRAPE_PROGRESS_TTL_DAYS);

    if (record.updatedAt < cutoff) {
      await prisma.search.update({
        where: { id: record.id },
        data: { lastCsePageScraped: 0, cseExhausted: false },
      });
      return { id: record.id, lastCsePageScraped: 0, cseExhausted: false, prescrapeStatus: null, lastPrescrapeNewCount: 0 };
    }

    return {
      id: record.id,
      lastCsePageScraped: record.lastCsePageScraped,
      cseExhausted: record.cseExhausted,
      prescrapeStatus: record.prescrapeStatus,
      lastPrescrapeNewCount: record.lastPrescrapeNewCount,
    };
  }

  // No existing record — create new
  const created = await prisma.search.create({
    data: {
      name: params.name,
      company: params.company,
      role: params.role,
      university: params.university,
      location: params.location,
      lastCsePageScraped: 0,
      cseExhausted: false,
    },
  });

  return {
    id: created.id,
    lastCsePageScraped: 0,
    cseExhausted: false,
    prescrapeStatus: null,
    lastPrescrapeNewCount: 0,
  };
}

/**
 * Update scrape progress after a CSE page has been scraped.
 */
export async function updateScrapeProgress(
  searchId: string,
  pageScraped: number,
  cseReturnedCount: number,
  apiStats?: Partial<{
    newProfileCount: number;
    cseCallsMade: number;
    apolloCallsMade: number;
    apolloCacheHits: number;
  }>
): Promise<void> {
  await prisma.search.update({
    where: { id: searchId },
    data: {
      lastCsePageScraped: pageScraped,
      cseExhausted: isCsePageExhausted(cseReturnedCount),
      lastPrescrapeNewCount: apiStats?.newProfileCount ?? 0,
      completedAt: new Date(),
      ...(apiStats?.cseCallsMade !== undefined && {
        cseCallsMade: { increment: apiStats.cseCallsMade },
      }),
      ...(apiStats?.apolloCallsMade !== undefined && {
        apolloCallsMade: { increment: apiStats.apolloCallsMade },
      }),
      ...(apiStats?.apolloCacheHits !== undefined && {
        apolloCacheHits: { increment: apiStats.apolloCacheHits },
      }),
    },
  });
}

