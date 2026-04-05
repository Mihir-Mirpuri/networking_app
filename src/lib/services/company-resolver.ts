/**
 * Company Name → LinkedIn Company URL Resolver
 *
 * Uses Serper (Google SERP) to find LinkedIn company page URLs.
 * Query: site:linkedin.com/company "company name"
 *
 * Results are cached in the CompanyUrl DB table to avoid repeat lookups.
 * Cost: $0.001 per Serper call (cached lookups are free).
 */

import { searchSerper } from './serper';
import prisma from '@/lib/prisma';

const COST_PER_SERPER_CALL_CENTS = 0.1; // $0.001 = 0.1 cents

export interface CompanyResolveResult {
  url: string | null;
  cost: {
    serperCalls: number;
    costCents: number;
  };
}

/**
 * Normalize company name for cache lookup.
 */
function normalizeCompanyName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Extract LinkedIn company URL from Serper results.
 * Looks for URLs matching linkedin.com/company/...
 */
function extractCompanyUrl(results: { link: string }[]): string | null {
  for (const result of results) {
    const match = result.link.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[^/?#]+/);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Resolve a company name to its LinkedIn company page URL.
 *
 * 1. Check DB cache first (free)
 * 2. If not cached, query Serper ($0.001)
 * 3. Cache the result for future lookups
 *
 * @param companyName - The company name to resolve
 * @returns The LinkedIn company URL (or null if not found) + cost metrics
 */
export async function resolveCompanyLinkedInUrl(
  companyName: string
): Promise<CompanyResolveResult> {
  const normalized = normalizeCompanyName(companyName);

  if (!normalized) {
    console.log(`[CompanyResolver] Empty company name, skipping`);
    return { url: null, cost: { serperCalls: 0, costCents: 0 } };
  }

  // 1. Check DB cache
  try {
    const cached = await prisma.companyUrl.findUnique({
      where: { name: normalized },
    });

    if (cached) {
      console.log(`[CompanyResolver] DB cache hit: "${companyName}" → ${cached.url}`);
      return { url: cached.url, cost: { serperCalls: 0, costCents: 0 } };
    }
    console.log(`[CompanyResolver] DB cache miss for "${companyName}", querying Serper`);
  } catch (err) {
    console.warn(`[CompanyResolver] DB cache lookup failed (${err instanceof Error ? err.message : 'unknown error'}), falling back to Serper`);
  }

  // 2. Query Serper
  const query = `site:linkedin.com/company "${companyName}"`;
  console.log(`[CompanyResolver] Serper query: ${query}`);
  const results = await searchSerper(query);
  console.log(`[CompanyResolver] Serper returned ${results.length} results`);

  const url = extractCompanyUrl(results);

  if (url) {
    console.log(`[CompanyResolver] Resolved "${companyName}" → ${url}`);

    // 3. Cache the result
    try {
      await prisma.companyUrl.upsert({
        where: { name: normalized },
        create: { name: normalized, url },
        update: { url },
      });
      console.log(`[CompanyResolver] Cached "${normalized}" → ${url}`);
    } catch (err) {
      console.warn(`[CompanyResolver] Failed to cache result: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  } else {
    console.log(`[CompanyResolver] No LinkedIn company page found for "${companyName}" (${results.length} Serper results checked)`);
  }

  return {
    url,
    cost: {
      serperCalls: 1,
      costCents: COST_PER_SERPER_CALL_CENTS,
    },
  };
}

/**
 * Batch resolve multiple company names.
 * Checks cache first, then resolves uncached names via Serper.
 */
export async function resolveCompanyLinkedInUrls(
  companyNames: string[]
): Promise<{ urls: Map<string, string | null>; cost: { serperCalls: number; costCents: number } }> {
  console.log(`[CompanyResolver] Batch resolving ${companyNames.length} companies: ${companyNames.join(', ')}`);
  const urls = new Map<string, string | null>();
  let totalSerperCalls = 0;

  for (const name of companyNames) {
    const result = await resolveCompanyLinkedInUrl(name);
    urls.set(name, result.url);
    totalSerperCalls += result.cost.serperCalls;
  }

  const resolved = Array.from(urls.entries()).filter(([, v]) => v !== null).length;
  console.log(`[CompanyResolver] Batch complete — ${resolved}/${companyNames.length} resolved, ${totalSerperCalls} Serper calls`);

  return {
    urls,
    cost: {
      serperCalls: totalSerperCalls,
      costCents: totalSerperCalls * COST_PER_SERPER_CALL_CENTS,
    },
  };
}
