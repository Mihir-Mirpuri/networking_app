/**
 * Pure helpers for Apify Short mode pagination decisions.
 *
 * Apify returns 25 profiles per page. We persist `lastCsePageScraped` (the
 * last page number successfully fetched) and `totalLinkedInMatches` on the
 * `Search` row, then use these to decide whether Load More should hit Apify.
 */

export const APIFY_PAGE_SIZE = 25;

/**
 * Decide what to do on the next Apify fetch given the current cursor state.
 *
 * - If we've never fetched a page (cursor = 0), `nextPage = 1`.
 * - If total matches are known and `cursor * 25 >= total`, we're exhausted.
 * - Otherwise, `nextPage = cursor + 1`.
 */
export function computeNextApifyPage(
  lastPageScraped: number,
  totalMatches: number | null
): { shouldFetch: boolean; nextPage: number } {
  if (
    totalMatches !== null &&
    totalMatches > 0 &&
    lastPageScraped * APIFY_PAGE_SIZE >= totalMatches
  ) {
    return { shouldFetch: false, nextPage: lastPageScraped };
  }
  return { shouldFetch: true, nextPage: lastPageScraped + 1 };
}

/**
 * After an Apify fetch, decide whether more pages exist server-side.
 *
 * Uses the new cursor (page just fetched) and total matches to project whether
 * another fetch would yield results.
 */
export function hasMoreApifyPages(
  newCursor: number,
  totalMatches: number | null
): boolean {
  if (totalMatches === null || totalMatches <= 0) return false;
  return newCursor * APIFY_PAGE_SIZE < totalMatches;
}
