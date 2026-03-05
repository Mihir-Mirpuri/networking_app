/**
 * Snippet Pre-filter
 *
 * Filters out profiles that don't match search criteria using Serper snippet
 * metadata BEFORE paying for Apify scraping. Conservative: if snippet data
 * is missing for a field, PASS (don't reject unknowns).
 */

import { companiesMatch, normalizeCompanyForMatch } from '@/lib/db/person-service';
import { normalizeSchool } from '@/lib/services/linkedin-scraper';
import { parseSnippetMetadata } from '@/lib/services/snippet-parser';
import { resolveCompanyAliases } from '@/lib/services/company-alias';

export type PreFilterResult =
  | 'PASS'
  | 'FAIL_COMPANY'
  | 'FAIL_SCHOOL'
  | 'FAIL_LOCATION'
  | 'PASS_UNKNOWN';

interface SnippetData {
  company: string | null;
  school: string | null;
  location: string | null;
}

interface FilterCriteria {
  company?: string;
  university?: string;
  location?: string;
}

/**
 * Pre-filter a profile by its Serper snippet metadata.
 *
 * @param snippetData - Parsed snippet metadata (company, school, location)
 * @param criteria - Search criteria to match against
 * @param resolvedCompanyAliases - Pre-resolved company aliases (normalized) for richer matching
 * @returns Filter result indicating pass/fail and reason
 */
export function preFilterBySnippet(
  snippetData: SnippetData,
  criteria: FilterCriteria,
  resolvedCompanyAliases?: string[]
): PreFilterResult {
  let hasAnyData = false;

  // Company check
  if (criteria.company && snippetData.company) {
    hasAnyData = true;
    const normalizedSnippetCompany = normalizeCompanyForMatch(snippetData.company);
    const normalizedSearchCompany = normalizeCompanyForMatch(criteria.company);

    // Check resolved aliases first
    if (resolvedCompanyAliases && resolvedCompanyAliases.length > 0) {
      const aliasMatch = resolvedCompanyAliases.some(alias =>
        normalizedSnippetCompany === alias ||
        normalizedSnippetCompany.startsWith(alias + ' ') ||
        normalizedSnippetCompany.startsWith(alias + '-') ||
        alias.startsWith(normalizedSnippetCompany + ' ') ||
        alias.startsWith(normalizedSnippetCompany + '-')
      );
      if (!aliasMatch && !companiesMatch(normalizedSnippetCompany, normalizedSearchCompany)) {
        return 'FAIL_COMPANY';
      }
    } else {
      if (!companiesMatch(normalizedSnippetCompany, normalizedSearchCompany)) {
        return 'FAIL_COMPANY';
      }
    }
  }

  // School check
  if (criteria.university && criteria.university.toLowerCase() !== 'any' && snippetData.school) {
    hasAnyData = true;
    const normalizedSnippetSchool = normalizeSchool(snippetData.school).toLowerCase();
    const normalizedSearchSchool = normalizeSchool(criteria.university).toLowerCase();

    // Check if either contains the other (handles partial matches)
    if (!normalizedSnippetSchool.includes(normalizedSearchSchool) &&
        !normalizedSearchSchool.includes(normalizedSnippetSchool)) {
      return 'FAIL_SCHOOL';
    }
  }

  // Location check — soft signal, only reject on clear mismatch
  // Location is too unreliable in snippets to hard-reject, so we skip it
  // (Apify will provide accurate location data)

  return hasAnyData ? 'PASS' : 'PASS_UNKNOWN';
}

/**
 * Pre-filter a batch of URLs using Serper snippet data.
 * Returns only the URLs that pass the filter.
 *
 * @param urlsToFilter - LinkedIn URLs to check
 * @param snippetMap - Map of URL → snippet string from Serper results
 * @param criteria - Search criteria
 * @returns Object with filtered URLs and count of prefiltered profiles
 */
export async function preFilterUrls(
  urlsToFilter: string[],
  snippetMap: Map<string, { snippet: string; company: string | null }>,
  criteria: FilterCriteria
): Promise<{ filteredUrls: string[]; prefilteredCount: number }> {
  if (urlsToFilter.length === 0) {
    return { filteredUrls: [], prefilteredCount: 0 };
  }

  // Resolve company aliases once for the batch
  let resolvedAliases: string[] | undefined;
  if (criteria.company) {
    const resolved = await resolveCompanyAliases(criteria.company);
    resolvedAliases = resolved.aliases.map(a => normalizeCompanyForMatch(a));
  }

  let prefilteredCount = 0;
  const filteredUrls = urlsToFilter.filter(url => {
    const data = snippetMap.get(url);
    if (!data) return true; // No snippet data — keep (conservative)

    const snippetMeta = parseSnippetMetadata(data.snippet);
    // Merge explicit cseCompany with snippet-parsed company
    const snippetData: SnippetData = {
      company: data.company || snippetMeta.company,
      school: snippetMeta.school,
      location: snippetMeta.location,
    };

    const result = preFilterBySnippet(snippetData, criteria, resolvedAliases);
    if (result.startsWith('FAIL')) {
      prefilteredCount++;
      return false;
    }
    return true;
  });

  return { filteredUrls, prefilteredCount };
}
