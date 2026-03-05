/**
 * Discovery service for finding LinkedIn profiles via Serper (Google Search API)
 *
 * Simplified approach:
 * - Serper extracts name + LinkedIn URL + snippet metadata (company, school, location)
 * - Apify scraper provides full profile data (exact role, all schools, name split, full location)
 * - Ranking service scores and returns top candidates
 */

import { resolveCompanyAliases } from '@/lib/services/company-alias';
import { searchSerper, SerperResult } from '@/lib/services/serper';
import { parseSerperTitle, parseSnippetMetadata } from '@/lib/services/snippet-parser';

export interface SearchParams {
  name?: string;
  university?: string;
  company?: string;
  role?: string;
  location?: string;
  limit: number;
  excludePersonKeys?: Set<string>; // Set of "fullName_company" keys (lowercase) to exclude
  pageStart?: number; // Serper page number (1-based: 1, 2, 3, ...)
}

/**
 * Discovery result from Serper search.
 * Interface kept as CSEDiscoveryResult for backward compatibility with consumers.
 */
export interface CSEDiscoveryResult {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  linkedinUrl: string;
  sourceTitle: string;
  sourceSnippet: string;
  sourceDomain: string;
  cseCompany: string | null;   // Extracted from snippet "Experience: [Company]"
  cseFirstName: string | null; // From title parsing (was metatag in CSE)
  cseLastName: string | null;  // From title parsing (was metatag in CSE)
}

/**
 * Legacy SearchResult interface for backward compatibility with existing code
 * The 'company' field is populated from search params since search doesn't provide it reliably
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
 * Check if a URL is a LinkedIn profile URL
 */
function isLinkedInProfileUrl(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

// ── Company name expansion for queries ──────────────────────────────
// Uses resolveCompanyAliases (DB → LLM), cached in-memory so
// pagination / repeat searches skip expansion entirely.

const companyExpansionCache = new Map<string, string[]>();

/**
 * Expand a company name into well-known abbreviations / alternate names
 * suitable for OR-queries.
 *
 * Uses resolveCompanyAliases (DB → LLM fallback).
 * Returns an array of alternate names (may be empty).
 */
export async function expandCompanyName(company: string): Promise<string[]> {
  const normalized = company.trim().toLowerCase();
  if (!normalized) return [];

  // Check cache first
  const cached = companyExpansionCache.get(normalized);
  if (cached !== undefined) return cached;

  try {
    // Use resolveCompanyAliases (DB → LLM) to get all known names
    const resolved = await resolveCompanyAliases(company);
    const alternatives = resolved.aliases
      .filter(a => a.toLowerCase() !== normalized)
      .slice(0, 3);
    companyExpansionCache.set(normalized, alternatives);
    console.log(`[Discovery] Company expansion: "${company}" → ${JSON.stringify(alternatives)}`);
    return alternatives;
  } catch (error) {
    // On any failure, cache empty array so we don't retry
    console.warn(`[Discovery] Company expansion failed for "${company}":`, error);
    companyExpansionCache.set(normalized, []);
    return [];
  }
}

/**
 * Build the company portion of a search query.
 * Currently just quotes the company name.
 */
export async function buildCompanyQueryPart(company: string): Promise<string> {
  const trimmed = company.trim();
  if (!trimmed) return '';

  return `"${trimmed}"`;
}

/**
 * Process Serper results into CSEDiscoveryResult format.
 * Extracts name from title + company/school/location from snippet.
 */
function processSerperResults(
  results: SerperResult[],
  limit: number,
  seenUrls: Set<string>,
  excludePersonKeys: Set<string>,
  company?: string
): CSEDiscoveryResult[] {
  const candidates: CSEDiscoveryResult[] = [];

  for (const result of results) {
    if (candidates.length >= limit) break;

    // Only process LinkedIn profile URLs
    if (!isLinkedInProfileUrl(result.link)) continue;

    // Check for duplicate URLs
    if (seenUrls.has(result.link)) continue;
    seenUrls.add(result.link);

    // Parse name from title
    const titleParsed = parseSerperTitle(result.title);
    const fullName = titleParsed?.fullName || '';
    const firstName = titleParsed?.firstName || null;
    const lastName = titleParsed?.lastName || null;

    // Parse metadata from snippet
    const snippetMeta = parseSnippetMetadata(result.snippet);

    // Check if this person should be excluded (already sent/hidden)
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
      sourceDomain: 'linkedin.com',
      cseCompany: snippetMeta.company,
      cseFirstName: firstName,
      cseLastName: lastName,
    });
  }

  return candidates;
}

/**
 * Discover LinkedIn profiles via Serper Google Search
 *
 * 1. Builds a search query from the parameters
 * 2. Calls Serper to get LinkedIn profile URLs
 * 3. Extracts name from title + metadata from snippet
 * 4. Returns basic profile info - Apify scraper will provide full data
 */
export async function discoverLinkedInProfiles(params: SearchParams): Promise<CSEDiscoveryResult[]> {
  const { name, university, company, role, location, limit, excludePersonKeys = new Set(), pageStart = 1 } = params;

  // Build query for LinkedIn profile search
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

  console.log(`[Discovery] Search query: ${query} (page: ${pageStart})`);

  // Serper uses page numbers (1, 2, 3) instead of CSE start offsets (1, 11, 21)
  const results = await searchSerper(query, pageStart);

  const seenUrls = new Set<string>();
  const candidates = processSerperResults(results, limit, seenUrls, excludePersonKeys, company);

  console.log(`[Discovery] Found ${candidates.length} LinkedIn profiles`);
  return candidates;
}

/**
 * Look up a specific person by name via Serper.
 *
 * Two-pass strategy:
 *   1. If company provided: "name" + company → usually #1 hit
 *   2. Fallback to "name" only → broader search
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
  const seenUrls = new Set<string>();

  // Pass 1: name + company (if company provided)
  if (company && company.trim()) {
    const companyPart = await buildCompanyQueryPart(company);
    const query = `site:linkedin.com/in "${cleanName}" ${companyPart}`;
    console.log(`[Lookup] Pass 1 query: ${query}`);
    const results = await searchSerper(query);
    const candidates = processSerperResults(results, LIMIT, seenUrls, new Set(), company);

    if (candidates.length > 0) {
      console.log(`[Lookup] Pass 1 found ${candidates.length} results`);
      return candidates;
    }
    console.log('[Lookup] Pass 1 returned 0 results, falling back to name-only');
  }

  // Pass 2: name only (fallback or no company provided)
  const query = `site:linkedin.com/in "${cleanName}"`;
  console.log(`[Lookup] Pass 2 query: ${query}`);
  const results = await searchSerper(query);
  const candidates = processSerperResults(results, LIMIT, seenUrls, new Set());
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
    company: params.company || '', // Use search company - scraper will verify/update
    role: null, // Scraper will provide this
    sourceUrl: profile.linkedinUrl,
    sourceTitle: profile.sourceTitle,
    sourceSnippet: profile.sourceSnippet,
    sourceDomain: profile.sourceDomain,
  }));
}
