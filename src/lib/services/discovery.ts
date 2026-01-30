/**
 * Discovery service for finding LinkedIn profiles via Google Custom Search
 *
 * Simplified approach:
 * - CSE extracts only name + LinkedIn URL
 * - Apollo is the source of truth for ALL data (email, location, education, employment)
 * - Ranking service scores and returns top candidates
 */

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CSEResponse {
  items?: CSEResult[];
}

export interface SearchParams {
  name?: string;
  university?: string;
  company?: string;
  role?: string;
  location?: string;
  limit: number;
  excludePersonKeys?: Set<string>; // Set of "fullName_company" keys (lowercase) to exclude
}

/**
 * Simplified discovery result - only contains data from CSE
 * Apollo will provide all additional data (email, location, education, employment)
 */
export interface CSEDiscoveryResult {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  linkedinUrl: string;
  sourceTitle: string;
  sourceSnippet: string;
  sourceDomain: string;
}

/**
 * Legacy SearchResult interface for backward compatibility with existing code
 * The 'company' field is populated from search params since CSE doesn't provide it reliably
 */
export interface SearchResult {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  role: string | null;
  sourceUrl: string;
  sourceTitle: string;
  sourceSnippet: string;
  sourceDomain: string;
}

/**
 * Call Google Custom Search API
 */
async function searchCSE(query: string, start?: number): Promise<CSEResult[]> {
  if (!CSE_API_KEY) {
    console.log('CSE API key not configured, skipping search');
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  // Geolocation params to align with browser behavior
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');
  if (start) {
    url.searchParams.set('start', start.toString());
  }

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error('CSE API error:', response.status, await response.text());
      return [];
    }
    const data: CSEResponse = await response.json();
    return data.items || [];
  } catch (error) {
    console.error('CSE fetch error:', error);
    return [];
  }
}

/**
 * Parse name components from a full name string
 */
function parseNameComponents(nameStr: string): { firstName: string; lastName: string; fullName: string } {
  // Remove common titles
  const cleaned = nameStr.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Professor)\s+/i, '').trim();
  const parts = cleaned.split(/\s+/);

  if (parts.length === 0) {
    return { firstName: '', lastName: '', fullName: '' };
  }

  // First name is first part
  const firstName = parts[0];

  // Last name is everything else (handles middle names, hyphenated last names)
  const lastName = parts.slice(1).join(' ');

  return {
    firstName,
    lastName,
    fullName: cleaned,
  };
}

/**
 * Extract name from LinkedIn title
 *
 * LinkedIn titles follow patterns like:
 * - "Name - Role at Company | LinkedIn"
 * - "Name | LinkedIn"
 * - "Name - Role | LinkedIn"
 *
 * We extract just the name portion before the first separator.
 */
function extractNameFromTitle(title: string): { fullName: string; firstName: string | null; lastName: string | null } | null {
  // Pattern 1: "Name - ..." or "Name | ..." (standard LinkedIn format)
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
  if (match) {
    const nameParts = parseNameComponents(match[1]);
    if (nameParts.firstName && nameParts.lastName) {
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
      };
    }
  }

  // Pattern 2: Try to find capitalized name at start of title
  const fallback = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (fallback) {
    const nameParts = parseNameComponents(fallback[1]);
    if (nameParts.firstName && nameParts.lastName) {
      return {
        fullName: nameParts.fullName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
      };
    }
  }

  return null;
}

/**
 * Check if a URL is a LinkedIn profile URL
 */
function isLinkedInProfileUrl(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

/**
 * Normalize a key for deduplication
 */
function normalizeKey(name: string, url: string): string {
  return `${name.toLowerCase().replace(/\s+/g, '_')}_${url}`;
}

/**
 * Discover LinkedIn profiles via Google Custom Search
 *
 * This simplified version:
 * 1. Builds a search query from the parameters
 * 2. Calls CSE to get LinkedIn profile URLs
 * 3. Extracts name from title (CSE snippet)
 * 4. Returns basic profile info - Apollo will enrich with all other data
 */
export async function discoverLinkedInProfiles(params: SearchParams): Promise<CSEDiscoveryResult[]> {
  const { name, university, company, role, location, limit, excludePersonKeys = new Set() } = params;

  // Build query for LinkedIn profile search
  // Include company, university, role, and location for targeted results
  const queryParts: string[] = [];
  if (company && company.trim()) queryParts.push(`"${company.trim()}"`);
  if (university && university.trim()) queryParts.push(`"${university.trim()}"`);
  if (role && role.trim()) queryParts.push(role.trim()); // Unquoted for flexibility
  if (location && location.trim()) queryParts.push(location.trim()); // Unquoted for flexibility
  if (name && name.trim()) queryParts.push(name.trim());

  const query = `site:linkedin.com/in ${queryParts.join(' ')}`;

  if (!query) {
    console.log('[Discovery] No search parameters provided, returning empty results');
    return [];
  }

  console.log(`[Discovery] Search query: ${query}`);
  const pages = [1, 11, 21, 31, 41, 51, 61, 71, 81]; // 9 pages = 90 results max

  const seenKeys = new Set<string>();
  const candidates: CSEDiscoveryResult[] = [];

  // Split pages into batches of 3 for controlled concurrency
  const BATCH_SIZE = 3;
  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    batches.push(pages.slice(i, i + BATCH_SIZE));
  }

  // Process batches sequentially, pages within batch in parallel
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (candidates.length >= limit) break;

    const batch = batches[batchIndex];

    // Execute all pages in batch concurrently
    const batchResults = await Promise.all(
      batch.map(pageOffset => searchCSE(query, pageOffset))
    );

    // Process results from all pages in the batch
    for (const results of batchResults) {
      if (candidates.length >= limit) break;

      for (const result of results) {
        if (candidates.length >= limit) break;

        // Only process LinkedIn profile URLs
        if (!isLinkedInProfileUrl(result.link)) {
          continue;
        }

        // Extract name from title
        const parsed = extractNameFromTitle(result.title);
        if (!parsed) {
          console.log(`[Discovery] Could not extract name from title: ${result.title}`);
          continue;
        }

        // Basic validation: must have first and last name
        if (!parsed.firstName || !parsed.lastName) {
          continue;
        }

        // Check for duplicate URLs
        const key = normalizeKey(parsed.fullName, result.link);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // Check if this person should be excluded (already sent/hidden)
        // Use company from search params since CSE doesn't provide reliable company
        const personKey = `${parsed.fullName}_${company || ''}`.toLowerCase();
        if (excludePersonKeys.has(personKey)) {
          console.log(`[Discovery] Skipping excluded person: ${parsed.fullName}`);
          continue;
        }

        candidates.push({
          fullName: parsed.fullName,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          linkedinUrl: result.link,
          sourceTitle: result.title,
          sourceSnippet: result.snippet,
          sourceDomain: result.displayLink,
        });
      }
    }

    // Rate limiting between batches
    if (candidates.length < limit && batchIndex < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`[Discovery] Found ${candidates.length} LinkedIn profiles`);
  return candidates;
}

/**
 * Legacy function for backward compatibility
 * Wraps discoverLinkedInProfiles and adds company from search params
 */
export async function searchPeople(params: SearchParams): Promise<SearchResult[]> {
  const profiles = await discoverLinkedInProfiles(params);

  // Convert to legacy SearchResult format
  return profiles.map(profile => ({
    fullName: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    company: params.company || '', // Use search company - Apollo will verify/update
    role: null, // Apollo will provide this
    sourceUrl: profile.linkedinUrl,
    sourceTitle: profile.sourceTitle,
    sourceSnippet: profile.sourceSnippet,
    sourceDomain: profile.sourceDomain,
  }));
}
