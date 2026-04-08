/**
 * Company Name → LinkedIn Company URL Resolver
 *
 * Uses Perplexity to find LinkedIn company page URLs.
 * Results are cached in the CompanyUrl DB table to avoid repeat lookups.
 * Cost: $0.001 per Perplexity call (cached lookups are free).
 */

import { findCompanyLinkedInUrl } from './perplexity';
import prisma from '@/lib/prisma';

const COST_PER_PERPLEXITY_CALL_CENTS = 0.1; // $0.001 = 0.1 cents

export interface CompanyResolveResult {
  url: string | null;
  cost: {
    perplexityCalls: number;
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
 * Resolve a company name to its LinkedIn company page URL.
 *
 * 1. Check DB cache first (free)
 * 2. If not cached, ask Perplexity ($0.001)
 * 3. Cache the result for future lookups
 *
 * @param companyName - The company name to resolve
 * @param context - Optional context to help disambiguate (e.g., role)
 * @returns The LinkedIn company URL (or null if not found) + cost metrics
 */
export async function resolveCompanyUrl(
  companyName: string,
  context?: string
): Promise<CompanyResolveResult> {
  const normalized = normalizeCompanyName(companyName);

  if (!normalized) {
    return { url: null, cost: { perplexityCalls: 0, costCents: 0 } };
  }

  // 1. Check DB cache
  try {
    const cached = await prisma.companyUrl.findUnique({
      where: { name: normalized },
    });

    if (cached) {
      console.log(`[CompanyResolver] "${companyName}" → ${cached.url} (cached)`);
      return { url: cached.url, cost: { perplexityCalls: 0, costCents: 0 } };
    }
  } catch (err) {
    console.warn(`[CompanyResolver] Cache lookup failed for "${companyName}": ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // 2. Ask Perplexity for the LinkedIn company URL
  console.log(`[CompanyResolver] Resolving "${companyName}" via Perplexity`);
  const url = await findCompanyLinkedInUrl(companyName, context);

  if (url) {
    console.log(`[CompanyResolver] "${companyName}" → ${url} (resolved via Perplexity)`);

    // 3. Cache the result
    try {
      await prisma.companyUrl.upsert({
        where: { name: normalized },
        create: { name: normalized, url },
        update: { url },
      });
    } catch (err) {
      console.warn(`[CompanyResolver] Failed to cache "${companyName}": ${err instanceof Error ? err.message : 'unknown'}`);
    }
  } else {
    console.warn(`[CompanyResolver] No LinkedIn URL found for "${companyName}" via Perplexity`);
  }

  return {
    url,
    cost: {
      perplexityCalls: 1,
      costCents: COST_PER_PERPLEXITY_CALL_CENTS,
    },
  };
}

/**
 * Batch resolve multiple company names.
 * Checks cache first, then resolves uncached names via Perplexity.
 */
export async function resolveCompanyLinkedInUrls(
  companyNames: string[]
): Promise<{ urls: Map<string, string | null>; cost: { perplexityCalls: number; costCents: number } }> {
  console.log(`[CompanyResolver] Batch resolving ${companyNames.length} companies: ${companyNames.join(', ')}`);
  const urls = new Map<string, string | null>();
  let totalPerplexityCalls = 0;

  for (const name of companyNames) {
    const result = await resolveCompanyUrl(name);
    urls.set(name, result.url);
    totalPerplexityCalls += result.cost.perplexityCalls;
  }

  const resolved = Array.from(urls.entries()).filter(([, v]) => v !== null).length;
  console.log(`[CompanyResolver] Batch complete — ${resolved}/${companyNames.length} resolved, ${totalPerplexityCalls} Perplexity calls`);

  return {
    urls,
    cost: {
      perplexityCalls: totalPerplexityCalls,
      costCents: totalPerplexityCalls * COST_PER_PERPLEXITY_CALL_CENTS,
    },
  };
}
