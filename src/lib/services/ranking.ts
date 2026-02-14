/**
 * Ranking service for discovery results
 * Scores candidates by similarity to search criteria and returns top N
 */

import { areRolesAliased } from '@/lib/db/person-service';

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
// Note: company, location, university are hard-filtered in DB query,
// so they don't differentiate candidates. Role is the primary ranking factor.
const WEIGHTS = {
  company: 0.00,
  role: 0.90,
  location: 0.00,
  university: 0.00,
  email: 0.10,
};

// When vector role matching is active, the DB already handled role similarity
// via pgvector cosine distance ordering, so role weight drops to 0.
const VECTOR_WEIGHTS = {
  company: 0.00,
  role: 0.00,
  location: 0.00,
  university: 0.00,
  email: 1.00,
};

export interface RankingOptions {
  vectorRoleMatching?: boolean;
}

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
 * Abbreviation → expanded form for role token matching.
 * Used to normalize abbreviations before Jaccard comparison so that
 * "VP of Operations" and "Vice President of Operations" share tokens.
 */
const ROLE_WORD_EXPANSIONS: Record<string, string> = {
  // Finance seniority
  'vp': 'vice president',
  'svp': 'senior vice president',
  'evp': 'executive vice president',
  'avp': 'assistant vice president',
  'md': 'managing director',
  // Finance divisions
  'ib': 'investment banking',
  'ibd': 'investment banking division',
  'pe': 'private equity',
  'am': 'asset management',
  'wm': 'wealth management',
  'pwm': 'private wealth management',
  's&t': 'sales and trading',
  // Consulting
  'ba': 'business analyst',
  'sba': 'senior business analyst',
  'em': 'engagement manager',
  'ctl': 'case team leader',
  'pl': 'project leader',
  'ap': 'associate principal',
  // Product/Tech
  'pm': 'product manager',
  'apm': 'associate product manager',
  'tpm': 'technical product manager',
  'rpm': 'rotational product manager',
  'pgm': 'program manager',
  // Prefix/suffix abbreviations
  'sr': 'senior',
  'sr.': 'senior',
  'jr': 'junior',
  'jr.': 'junior',
  'mgr': 'manager',
  'dir': 'director',
  'mgmt': 'management',
  'assoc': 'associate',
  'assoc.': 'associate',
};

/**
 * Expand abbreviations in a role string for better token matching.
 * First checks if the entire string is an abbreviation, then word-by-word.
 * e.g. "VP" → "vice president", "sr. pm" → "senior product manager"
 */
function expandRoleForMatching(normalized: string): string {
  // Check if the entire string is an abbreviation
  if (ROLE_WORD_EXPANSIONS[normalized]) {
    return ROLE_WORD_EXPANSIONS[normalized];
  }
  // Word-by-word expansion
  return normalized.split(/\s+/).map(word => ROLE_WORD_EXPANSIONS[word] || word).join(' ');
}

/**
 * Score role match using alias groups, abbreviation expansion, and token overlap
 *
 * Matching priority:
 * 1. Exact match (after normalization): 1.0
 * 2. Alias group match (e.g., "vice president" ↔ "vp"): 1.0
 * 3. Expanded exact match (e.g., "sr consultant" → "senior consultant"): 1.0
 * 4. Token overlap >= 50% (on expanded forms): 0.8
 * 5. Partial token overlap: proportional
 * 6. No overlap: 0
 */
export function scoreRoleMatch(search: string | undefined, apollo: string | null): number {
  if (!search || !search.trim()) return 0; // No search criteria
  if (!apollo) return 0; // No Apollo data

  const searchNorm = normalize(search);
  const apolloNorm = normalize(apollo);

  // Exact match
  if (searchNorm === apolloNorm) return 1.0;

  // Alias group match (e.g., "vice president" ↔ "vp")
  if (areRolesAliased(searchNorm, apolloNorm)) return 1.0;

  // Extract core role (before comma/dash qualifiers like "VP, IBD" → "VP")
  // LinkedIn titles often have "Role, Department" or "Role - Division" format
  const apolloCore = apolloNorm.split(/[,\-–—]/, 1)[0].trim();

  // Check alias on core role (e.g., "VP, IBD" → core "vp" aliases "vice president")
  if (apolloCore && apolloCore !== apolloNorm && areRolesAliased(searchNorm, apolloCore)) return 1.0;

  // Expand abbreviations for better token comparison
  const searchExpanded = expandRoleForMatching(searchNorm);
  const apolloExpanded = expandRoleForMatching(apolloNorm);

  // Expanded exact match (e.g., "sr consultant" expands to match "senior consultant")
  if (searchExpanded === apolloExpanded) return 1.0;

  // Also expand just the core role for comparison
  const apolloCoreExpanded = expandRoleForMatching(apolloCore || apolloNorm);

  // Token-based matching — try both full role and core role, take the better score
  const toTokens = (s: string) => new Set(s.split(' ').filter(w => w.length > 0));
  const searchTokens = toTokens(searchExpanded);
  if (searchTokens.size === 0) return 0;

  const fullTokens = toTokens(apolloExpanded);
  const coreTokens = toTokens(apolloCoreExpanded);

  const fullSimilarity = fullTokens.size > 0 ? jaccardSimilarity(searchTokens, fullTokens) : 0;
  const coreSimilarity = coreTokens.size > 0 ? jaccardSimilarity(searchTokens, coreTokens) : 0;
  const similarity = Math.max(fullSimilarity, coreSimilarity);

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
 * - Missing: 0.3 (can still be contacted via send-time enrichment)
 */
export function scoreEmailQuality(email: string | null, status: 'VERIFIED' | 'UNVERIFIED' | 'MISSING'): number {
  if (status === 'VERIFIED' && email) return 1.0;
  if (status === 'UNVERIFIED' && email) return 0.5;
  return 0.3;
}

/**
 * Score a single candidate against search criteria
 */
export function scoreCandidate(
  criteria: SearchCriteria,
  candidate: CandidateData,
  options?: RankingOptions
): { score: number; breakdown: ScoreBreakdown } {
  const weights = options?.vectorRoleMatching ? VECTOR_WEIGHTS : WEIGHTS;

  const breakdown: ScoreBreakdown = {
    company: scoreCompanyMatch(criteria.company, candidate.company),
    role: scoreRoleMatch(criteria.role, candidate.role),
    location: scoreLocationMatch(criteria.location, candidate.city, candidate.state, candidate.country),
    university: scoreUniversityMatch(criteria.university, candidate.educationSchool),
    email: scoreEmailQuality(candidate.email, candidate.emailStatus),
  };

  // Calculate weighted score
  const score =
    breakdown.company * weights.company +
    breakdown.role * weights.role +
    breakdown.location * weights.location +
    breakdown.university * weights.university +
    breakdown.email * weights.email;

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
 * @param options - Optional ranking options (e.g., vectorRoleMatching)
 */
export function rankCandidates<T>(
  criteria: SearchCriteria,
  candidates: T[],
  getData: (candidate: T) => CandidateData,
  limit: number,
  options?: RankingOptions
): RankedCandidate<T>[] {
  // Score all candidates
  const scored = candidates.map(candidate => {
    const data = getData(candidate);
    const { score, breakdown } = scoreCandidate(criteria, data, options);
    return { candidate, score, breakdown };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top N
  return scored.slice(0, limit);
}
