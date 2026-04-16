/**
 * Company Name → LinkedIn Company URL Resolver
 *
 * Uses Apollo's /v1/mixed_companies/search endpoint to resolve company-name →
 * LinkedIn-company-URL on cache miss. Results are cached in the CompanyUrl DB
 * table to avoid repeat lookups.
 *
 * Flow: DB cache (free, instant) → Apollo (~$0.024, ~200ms) → cache result.
 * If Apollo can't find it, the caller falls back to using the company name string.
 *
 * Swapped from Sonnet 4.6 on 2026-04-16 (see
 * docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md).
 * Apollo scored 84% in benchmark vs Sonnet's 72% with 3–5× lower latency.
 */

import prisma from '@/lib/prisma';
import { log } from '@/lib/services/discovery-logger';
import { APOLLO_COST_PER_LOOKUP } from '@/lib/services/cost-logger';

export interface CompanyResolveResult {
  url: string | null;
  cost: {
    llmCalls: number;
    costCents: number;
  };
}

const COST_PER_APOLLO_CALL_CENTS = APOLLO_COST_PER_LOOKUP * 100; // 2.4¢

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Ask Apollo for the LinkedIn company page URL.
 * Returns {url, billed}. `billed` is true iff Apollo returned HTTP 200
 * (so a credit was consumed, regardless of whether the search matched).
 */
async function findCompanyLinkedInUrlViaApollo(
  companyName: string
): Promise<{ url: string | null; billed: boolean }> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY not configured');
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q_organization_name: companyName,
        page: 1,
        per_page: 1,
      }),
    });

    if (!res.ok) {
      await res.text().catch(() => {}); // drain body to release connection
      const elapsed = Date.now() - start;
      console.warn(`[CompanyResolver] Apollo HTTP ${res.status} for "${companyName}" (${elapsed}ms)`);
      log.error('company-resolver', `Apollo HTTP ${res.status}`, { companyName, durationMs: elapsed });
      return { url: null, billed: false };
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      const elapsed = Date.now() - start;
      console.warn(`[CompanyResolver] Apollo returned malformed JSON for "${companyName}" (${elapsed}ms)`);
      log.error('company-resolver', 'Apollo malformed JSON', { companyName, durationMs: elapsed });
      return { url: null, billed: true }; // Apollo billed us (HTTP 200)
    }

    const elapsed = Date.now() - start;
    const first = (data.organizations || [])[0];
    const raw: string | undefined = first?.linkedin_url;

    if (!raw) {
      console.log(`[CompanyResolver] Apollo no match for "${companyName}" (${elapsed}ms)`);
      log.api('company-resolver', {
        service: 'apollo',
        endpoint: 'mixed_companies/search',
        request: { companyName },
        response: { url: null },
        durationMs: elapsed,
        costUsd: APOLLO_COST_PER_LOOKUP,
      });
      return { url: null, billed: true };
    }

    // Apollo returns http://www.linkedin.com/... — normalize to https://
    const url = raw.replace(/^http:\/\//, 'https://');
    console.log(`[CompanyResolver] Apollo resolved "${companyName}" → ${url} (${elapsed}ms)`);
    log.api('company-resolver', {
      service: 'apollo',
      endpoint: 'mixed_companies/search',
      request: { companyName },
      response: { url, matchedName: first?.name },
      durationMs: elapsed,
      costUsd: APOLLO_COST_PER_LOOKUP,
    });
    return { url, billed: true };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[CompanyResolver] Apollo failed for "${companyName}" (${elapsed}ms): ${msg}`);
    log.error('company-resolver', `Apollo failed for "${companyName}"`, {
      durationMs: elapsed,
      error: msg,
    });
    return { url: null, billed: false };
  }
}

// Test-only export for shadow script. Prefix `_` signals do-not-import from app code.
export const _findCompanyLinkedInUrlViaApollo = findCompanyLinkedInUrlViaApollo;

/**
 * Resolve a company name to its LinkedIn company page URL.
 *
 * 1. Check DB cache first (free)
 * 2. If not cached, ask Apollo (~$0.024)
 * 3. Cache the result for future lookups
 */
export async function resolveCompanyUrl(
  companyName: string,
  _context?: string
): Promise<CompanyResolveResult> {
  const normalized = normalizeCompanyName(companyName);

  if (!normalized) {
    return { url: null, cost: { llmCalls: 0, costCents: 0 } };
  }

  // 1. Check DB cache
  try {
    const cached = await prisma.companyUrl.findUnique({
      where: { name: normalized },
    });

    if (cached) {
      console.log(`[CompanyResolver] "${companyName}" → ${cached.url} (cached)`);
      log.info('company-resolver', 'Cache hit', { companyName, url: cached.url });
      return { url: cached.url, cost: { llmCalls: 0, costCents: 0 } };
    }
  } catch (err) {
    console.warn(
      `[CompanyResolver] Cache lookup failed for "${companyName}": ${
        err instanceof Error ? err.message : 'unknown'
      }`
    );
  }

  // 2. Ask Apollo
  const { url, billed } = await findCompanyLinkedInUrlViaApollo(companyName);

  if (url) {
    // 3. Cache the result
    try {
      await prisma.companyUrl.upsert({
        where: { name: normalized },
        create: { name: normalized, url },
        update: { url },
      });
    } catch (err) {
      console.warn(
        `[CompanyResolver] Failed to cache "${companyName}": ${
          err instanceof Error ? err.message : 'unknown'
        }`
      );
    }
  } else {
    console.warn(`[CompanyResolver] No LinkedIn URL found for "${companyName}"`);
    log.warn('company-resolver', `No LinkedIn URL found for "${companyName}"`);
  }

  return {
    url,
    cost: {
      llmCalls: billed ? 1 : 0,
      costCents: billed ? COST_PER_APOLLO_CALL_CENTS : 0,
    },
  };
}

/**
 * Batch resolve multiple company names.
 * Checks cache first, then resolves uncached names via Apollo.
 */
export async function resolveCompanyLinkedInUrls(
  companyNames: string[]
): Promise<{
  urls: Map<string, string | null>;
  cost: { llmCalls: number; costCents: number };
}> {
  console.log(
    `[CompanyResolver] Batch resolving ${companyNames.length} companies: ${companyNames.join(', ')}`
  );
  const urls = new Map<string, string | null>();
  let totalApiCalls = 0;

  for (const name of companyNames) {
    const result = await resolveCompanyUrl(name);
    urls.set(name, result.url);
    totalApiCalls += result.cost.llmCalls;
  }

  const resolved = Array.from(urls.entries()).filter(([, v]) => v !== null).length;
  console.log(
    `[CompanyResolver] Batch complete — ${resolved}/${companyNames.length} resolved, ${totalApiCalls} Apollo calls`
  );

  return {
    urls,
    cost: {
      llmCalls: totalApiCalls,
      costCents: totalApiCalls * COST_PER_APOLLO_CALL_CENTS,
    },
  };
}
