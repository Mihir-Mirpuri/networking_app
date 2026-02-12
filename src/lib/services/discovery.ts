/**
 * Discovery service for finding LinkedIn profiles via Google Custom Search
 *
 * Simplified approach:
 * - CSE extracts only name + LinkedIn URL
 * - Apollo is the source of truth for ALL data (email, location, education, employment)
 * - Ranking service scores and returns top candidates
 */

import { completeJson } from '@/lib/services/groq';
import { getCompanyKey, getCompanyAliases } from '@/lib/db/person-service';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEMetatag {
  'og:description'?: string;
  'profile:first_name'?: string;
  'profile:last_name'?: string;
  [key: string]: string | undefined;
}

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  pagemap?: {
    metatags?: CSEMetatag[];
  };
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
  pageStart?: number; // CSE start index (1 = first page, 11 = second page)
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
  cseCompany: string | null;   // Extracted from og:description "Experience: [Company]"
  cseFirstName: string | null; // From profile:first_name metatag
  cseLastName: string | null;  // From profile:last_name metatag
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
 * Extract current company from LinkedIn og:description metatag.
 * Format: "... · Experience: [Company] · ..." or "... · Experience: [Company]"
 * Returns null if unparseable.
 */
function parseExperienceCompany(ogDescription: string | undefined): string | null {
  if (!ogDescription) return null;
  const match = ogDescription.match(/Experience:\s*([^·]+)/);
  if (!match) return null;
  return match[1].trim() || null;
}

// ── Company name expansion for CSE queries ──────────────────────────────
// Two-tier: COMPANY_ALIASES (instant) → Groq LLM fallback (~200-400ms)
// Cached in-memory so pagination / repeat searches skip expansion entirely.

const companyExpansionCache = new Map<string, string[]>();

/**
 * Expand a company name into well-known abbreviations / alternate names
 * suitable for CSE OR-queries.
 *
 * Tier 1: Check COMPANY_ALIASES (0 ms, no API call)
 * Tier 2: Ask Groq llama-3.1-8b-instant for abbreviations (~200-400 ms)
 * Returns an array of alternate names (may be empty).
 */
export async function expandCompanyName(company: string): Promise<string[]> {
  const normalized = company.trim().toLowerCase();
  if (!normalized) return [];

  // Check cache first
  const cached = companyExpansionCache.get(normalized);
  if (cached !== undefined) return cached;

  try {
    // Tier 1 – alias map
    const key = getCompanyKey(normalized);
    if (key) {
      const aliases = getCompanyAliases(key);
      // Filter out the original company name (case-insensitive) and take up to 3
      const alternatives = aliases
        .filter(a => a.toLowerCase() !== normalized)
        .slice(0, 3);
      companyExpansionCache.set(normalized, alternatives);
      console.log(`[Discovery] Company expansion (alias): "${company}" → ${JSON.stringify(alternatives)}`);
      return alternatives;
    }

    // Tier 2 – LLM fallback
    interface ExpansionResponse { alternatives: string[] }
    const response = await completeJson<ExpansionResponse>({
      systemPrompt:
        'You are a company name abbreviation expert. Given a company name, return a JSON object with an "alternatives" array containing 1-3 widely-recognized abbreviations or short-form names used on LinkedIn profiles. Only include abbreviations that are well-known and unambiguous (e.g. "GS" for Goldman Sachs, "JPM" for JPMorgan, "BCG" for Boston Consulting Group). Do NOT include divisions, subsidiaries, or parent companies. If the company has no well-known abbreviations, return {"alternatives": []}.',
      userPrompt: company.trim(),
      options: {
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        maxTokens: 150,
      },
    });

    const alternatives = (response.content.alternatives || []).slice(0, 3);
    companyExpansionCache.set(normalized, alternatives);
    console.log(`[Discovery] Company expansion (LLM): "${company}" → ${JSON.stringify(alternatives)}`);
    return alternatives;
  } catch (error) {
    // On any failure, cache empty array so we don't retry
    console.warn(`[Discovery] Company expansion failed for "${company}":`, error);
    companyExpansionCache.set(normalized, []);
    return [];
  }
}

/**
 * Build the company portion of a CSE query.
 * Currently just quotes the company name. LLM expansion (expandCompanyName)
 * is available but disabled — all current UI inputs are constrained dropdowns
 * that already provide canonical names. Re-enable when natural language
 * or freetext company input is added.
 */
export async function buildCompanyQueryPart(company: string): Promise<string> {
  const trimmed = company.trim();
  if (!trimmed) return '';

  return `"${trimmed}"`;
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
  const { name, university, company, role, location, limit, excludePersonKeys = new Set(), pageStart = 1 } = params;

  // Build query for LinkedIn profile search
  // Include company, university, role, and location for targeted results
  const queryParts: string[] = [];
  if (company && company.trim()) queryParts.push(await buildCompanyQueryPart(company));
  // Omit university if "any" is selected (case-insensitive)
  if (university && university.trim() && university.trim().toLowerCase() !== 'any') {
    queryParts.push(`"${university.trim()}"`);
  }
  if (role && role.trim()) queryParts.push(role.trim()); // Unquoted for flexibility
  if (location && location.trim()) queryParts.push(location.trim()); // Unquoted for flexibility
  if (name && name.trim()) queryParts.push(name.trim());

  const query = `site:linkedin.com/in ${queryParts.join(' ')}`;

  if (!query) {
    console.log('[Discovery] No search parameters provided, returning empty results');
    return [];
  }

  console.log(`[Discovery] Search query: ${query} (page start: ${pageStart})`);
  const pages = [pageStart]; // Single page per call, batch 2 called separately

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

        // Check for duplicate URLs
        if (seenKeys.has(result.link)) continue;
        seenKeys.add(result.link);

        // Extract metatag data (more reliable than title parsing)
        const metatags = result.pagemap?.metatags?.[0];
        const cseFirstName = metatags?.['profile:first_name'] || null;
        const cseLastName = metatags?.['profile:last_name'] || null;
        const cseCompany = parseExperienceCompany(metatags?.['og:description']);

        // Use metatag names as primary source, fall back to title parsing
        let fullName = '';
        let firstName: string | null = null;
        let lastName: string | null = null;

        if (cseFirstName && cseLastName) {
          firstName = cseFirstName;
          lastName = cseLastName;
          fullName = `${cseFirstName} ${cseLastName}`;
        } else {
          const parsed = extractNameFromTitle(result.title);
          fullName = parsed?.fullName || '';
          firstName = parsed?.firstName || null;
          lastName = parsed?.lastName || null;
        }

        // Check if this person should be excluded (already sent/hidden)
        // Only check if we could parse a name
        if (fullName && company) {
          const personKey = `${fullName}_${company}`.toLowerCase();
          if (excludePersonKeys.has(personKey)) {
            console.log(`[Discovery] Skipping excluded person: ${fullName}`);
            continue;
          }
        }

        candidates.push({
          fullName,
          firstName,
          lastName,
          linkedinUrl: result.link,
          sourceTitle: result.title,
          sourceSnippet: result.snippet,
          sourceDomain: result.displayLink,
          cseCompany,
          cseFirstName,
          cseLastName,
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
 * Look up a specific person by name via CSE.
 *
 * Two-pass strategy (based on empirical testing of 18 people):
 *   1. If company provided: "name" + company → #1 hit 89% of the time
 *   2. Fallback to "name" only → 100% find rate, avg position 2.6
 *
 * Returns top 5 LinkedIn profiles for the user to pick from.
 */
export async function lookupByName(params: {
  name: string;
  company?: string;
}): Promise<CSEDiscoveryResult[]> {
  const { name, company } = params;
  const cleanName = name.replace(/,.*$/, '').trim(); // Strip suffixes like ", MBA, MHA"

  if (!cleanName) return [];

  const LIMIT = 5;

  const processResults = (results: CSEResult[]): CSEDiscoveryResult[] => {
    const candidates: CSEDiscoveryResult[] = [];
    const seenUrls = new Set<string>();

    for (const result of results) {
      if (candidates.length >= LIMIT) break;
      if (!isLinkedInProfileUrl(result.link)) continue;
      if (seenUrls.has(result.link)) continue;
      seenUrls.add(result.link);

      const metatags = result.pagemap?.metatags?.[0];
      const cseFirstName = metatags?.['profile:first_name'] || null;
      const cseLastName = metatags?.['profile:last_name'] || null;
      const cseCompany = parseExperienceCompany(metatags?.['og:description']);

      let fullName = '';
      let firstName: string | null = null;
      let lastName: string | null = null;

      if (cseFirstName && cseLastName) {
        firstName = cseFirstName;
        lastName = cseLastName;
        fullName = `${cseFirstName} ${cseLastName}`;
      } else {
        const parsed = extractNameFromTitle(result.title);
        fullName = parsed?.fullName || '';
        firstName = parsed?.firstName || null;
        lastName = parsed?.lastName || null;
      }

      candidates.push({
        fullName,
        firstName,
        lastName,
        linkedinUrl: result.link,
        sourceTitle: result.title,
        sourceSnippet: result.snippet,
        sourceDomain: result.displayLink,
        cseCompany,
        cseFirstName,
        cseLastName,
      });
    }

    return candidates;
  };

  // Pass 1: name + company (if company provided)
  if (company && company.trim()) {
    const companyPart = await buildCompanyQueryPart(company);
    const query = `site:linkedin.com/in "${cleanName}" ${companyPart}`;
    console.log(`[Lookup] Pass 1 query: ${query}`);
    const results = await searchCSE(query);
    const candidates = processResults(results);

    if (candidates.length > 0) {
      console.log(`[Lookup] Pass 1 found ${candidates.length} results`);
      return candidates;
    }
    console.log('[Lookup] Pass 1 returned 0 results, falling back to name-only');
  }

  // Pass 2: name only (fallback or no company provided)
  const query = `site:linkedin.com/in "${cleanName}"`;
  console.log(`[Lookup] Pass 2 query: ${query}`);
  const results = await searchCSE(query);
  const candidates = processResults(results);
  console.log(`[Lookup] Pass 2 found ${candidates.length} results`);
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
