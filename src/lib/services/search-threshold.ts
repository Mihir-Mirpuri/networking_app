/**
 * Threshold logic for deciding whether to skip the LinkedIn API
 * when the DB already has results.
 *
 * Only "strong" matches (exact or near_exact tier) count toward the
 * threshold. "similar" tier results are semantic neighbors from vector
 * search and may not actually match the user's requested role.
 */

export const DB_FIRST_THRESHOLD = 6;

/**
 * Returns true if the DB results contain enough strong matches to
 * skip the LinkedIn API call.
 */
export function shouldSkipApi(
  results: Array<{ matchTier: 'exact' | 'near_exact' | 'similar' }>
): boolean {
  const strongMatchCount = results.filter(
    r => r.matchTier === 'exact' || r.matchTier === 'near_exact'
  ).length;
  return strongMatchCount >= DB_FIRST_THRESHOLD;
}
