/**
 * Ranking service for discovery results
 * Scores candidates by similarity to search criteria and returns top N
 */

export interface SearchCriteria {
  company?: string;
  role?: string;
  location?: string;
  university?: string;
}

export interface CandidateData {
  company: string | null;
  role: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  educationSchool: string | null;
  email: string | null;
  emailStatus: 'VERIFIED' | 'UNVERIFIED' | 'MISSING';
}

export interface ScoreBreakdown {
  company: number;
  role: number;
  location: number;
  university: number;
  email: number;
}

export interface RankedCandidate<T> {
  candidate: T;
  score: number;
  breakdown: ScoreBreakdown;
}

// Weights for each criterion
const WEIGHTS = {
  company: 0.30,
  role: 0.25,
  location: 0.20,
  university: 0.15,
  email: 0.10,
};

/**
 * Normalize string for comparison: lowercase, trim, remove extra whitespace
 */
function normalize(str: string | null | undefined): string {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Tokenize a string into words for comparison
 */
function tokenize(str: string): Set<string> {
  const normalized = normalize(str);
  if (!normalized) return new Set();
  return new Set(normalized.split(' ').filter(word => word.length > 0));
}

/**
 * Calculate Jaccard similarity between two token sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 0;
  if (set1.size === 0 || set2.size === 0) return 0;

  const arr1 = Array.from(set1);
  const arr2 = Array.from(set2);
  const intersection = new Set(arr1.filter(x => set2.has(x)));
  const union = new Set(arr1.concat(arr2));

  return intersection.size / union.size;
}

/**
 * Score company match
 * - Exact match: 1.0
 * - Contains (either direction): 0.7
 * - No match: 0
 */
export function scoreCompanyMatch(search: string | undefined, apollo: string | null): number {
  if (!search || !search.trim()) return 0; // No search criteria
  if (!apollo) return 0; // No Apollo data

  const searchNorm = normalize(search);
  const apolloNorm = normalize(apollo);

  // Exact match
  if (searchNorm === apolloNorm) return 1.0;

  // Contains match (handles "Bain" vs "Bain & Company")
  if (apolloNorm.includes(searchNorm) || searchNorm.includes(apolloNorm)) {
    return 0.7;
  }

  return 0;
}

/**
 * Score role match using token overlap
 * Handles variations like "associate consultant" ↔ "consulting associate"
 * - Exact match: 1.0
 * - Token overlap >= 50%: 0.8
 * - Partial overlap: proportional
 * - No overlap: 0
 */
export function scoreRoleMatch(search: string | undefined, apollo: string | null): number {
  if (!search || !search.trim()) return 0; // No search criteria
  if (!apollo) return 0; // No Apollo data

  const searchNorm = normalize(search);
  const apolloNorm = normalize(apollo);

  // Exact match
  if (searchNorm === apolloNorm) return 1.0;

  // Token-based matching
  const searchTokens = tokenize(search);
  const apolloTokens = tokenize(apollo);

  if (searchTokens.size === 0 || apolloTokens.size === 0) return 0;

  const similarity = jaccardSimilarity(searchTokens, apolloTokens);

  // High overlap (>= 50%)
  if (similarity >= 0.5) return 0.8;

  // Partial overlap - proportional score
  return similarity;
}

/**
 * Score location match
 * - City match: 1.0
 * - State match: 0.6
 * - Country match: 0.3
 * - No match: 0
 */
export function scoreLocationMatch(
  search: string | undefined,
  city: string | null,
  state: string | null,
  country: string | null
): number {
  if (!search || !search.trim()) return 0; // No search criteria

  const searchNorm = normalize(search);
  const cityNorm = normalize(city);
  const stateNorm = normalize(state);
  const countryNorm = normalize(country);

  // City match (highest priority)
  if (cityNorm && (cityNorm.includes(searchNorm) || searchNorm.includes(cityNorm))) {
    return 1.0;
  }

  // State match
  if (stateNorm && (stateNorm.includes(searchNorm) || searchNorm.includes(stateNorm))) {
    return 0.6;
  }

  // Country match
  if (countryNorm && (countryNorm.includes(searchNorm) || searchNorm.includes(countryNorm))) {
    return 0.3;
  }

  return 0;
}

/**
 * Score university match
 * - Exact match: 1.0
 * - Contains (either direction): 0.8
 * - No match: 0
 */
export function scoreUniversityMatch(search: string | undefined, school: string | null): number {
  if (!search || !search.trim()) return 0; // No search criteria
  if (!school) return 0; // No Apollo data

  const searchNorm = normalize(search);
  const schoolNorm = normalize(school);

  // Exact match
  if (searchNorm === schoolNorm) return 1.0;

  // Contains match (handles "Stanford" vs "Stanford University")
  if (schoolNorm.includes(searchNorm) || searchNorm.includes(schoolNorm)) {
    return 0.8;
  }

  return 0;
}

/**
 * Score email quality
 * - Verified: 1.0
 * - Unverified: 0.5
 * - Missing: 0
 */
export function scoreEmailQuality(email: string | null, status: 'VERIFIED' | 'UNVERIFIED' | 'MISSING'): number {
  if (!email || status === 'MISSING') return 0;
  if (status === 'VERIFIED') return 1.0;
  if (status === 'UNVERIFIED') return 0.5;
  return 0;
}

/**
 * Score a single candidate against search criteria
 */
export function scoreCandidate(
  criteria: SearchCriteria,
  candidate: CandidateData
): { score: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    company: scoreCompanyMatch(criteria.company, candidate.company),
    role: scoreRoleMatch(criteria.role, candidate.role),
    location: scoreLocationMatch(criteria.location, candidate.city, candidate.state, candidate.country),
    university: scoreUniversityMatch(criteria.university, candidate.educationSchool),
    email: scoreEmailQuality(candidate.email, candidate.emailStatus),
  };

  // Calculate weighted score
  const score =
    breakdown.company * WEIGHTS.company +
    breakdown.role * WEIGHTS.role +
    breakdown.location * WEIGHTS.location +
    breakdown.university * WEIGHTS.university +
    breakdown.email * WEIGHTS.email;

  return { score, breakdown };
}

/**
 * Rank candidates by similarity to search criteria
 * Returns top N candidates sorted by score descending
 *
 * @param criteria - The search criteria to match against
 * @param candidates - Array of candidates with their data
 * @param getData - Function to extract CandidateData from each candidate
 * @param limit - Maximum number of results to return
 */
export function rankCandidates<T>(
  criteria: SearchCriteria,
  candidates: T[],
  getData: (candidate: T) => CandidateData,
  limit: number
): RankedCandidate<T>[] {
  // Score all candidates
  const scored = candidates.map(candidate => {
    const data = getData(candidate);
    const { score, breakdown } = scoreCandidate(criteria, data);
    return { candidate, score, breakdown };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top N
  return scored.slice(0, limit);
}
