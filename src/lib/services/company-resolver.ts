/**
 * Company Name → LinkedIn Company URL Resolver
 *
 * Uses Sonnet 4.6 to resolve company names to LinkedIn company page URLs.
 * Results are cached in the CompanyUrl DB table to avoid repeat lookups.
 *
 * Flow: DB cache (free, instant) → Sonnet 4.6 (~$0.0002, ~1s) → cache result.
 * If Sonnet can't find it, the caller falls back to using the company name string.
 */

import Anthropic from '@anthropic-ai/sdk';
import prisma from '@/lib/prisma';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export interface CompanyResolveResult {
  url: string | null;
  cost: {
    llmCalls: number;
    costCents: number;
  };
}

const COST_PER_SONNET_CALL_CENTS = 0.02; // ~$0.0002

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Ask Sonnet 4.6 for the LinkedIn company page URL.
 * Returns the URL or null if not found. ~1s latency, ~$0.0002/call.
 */
async function findCompanyLinkedInUrlViaSonnet(companyName: string): Promise<string | null> {
  const client = getAnthropicClient();
  const start = Date.now();

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 80,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `LinkedIn company page URL for "${companyName}". Return ONLY: {"url":"https://www.linkedin.com/company/SLUG"} or {"url":null}`,
      }],
    });

    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    const match = text.match(/https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
    const url = match?.[0] || null;

    console.log(`[CompanyResolver] Sonnet resolved "${companyName}" → ${url || 'null'} (${Date.now() - start}ms)`);
    return url;
  } catch (err) {
    console.warn(`[CompanyResolver] Sonnet failed for "${companyName}" (${Date.now() - start}ms):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Resolve a company name to its LinkedIn company page URL.
 *
 * 1. Check DB cache first (free)
 * 2. If not cached, ask Sonnet 4.6 (~$0.0002)
 * 3. Cache the result for future lookups
 */
export async function resolveCompanyUrl(
  companyName: string,
  context?: string
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
      return { url: cached.url, cost: { llmCalls: 0, costCents: 0 } };
    }
  } catch (err) {
    console.warn(`[CompanyResolver] Cache lookup failed for "${companyName}": ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // 2. Ask Sonnet 4.6
  const url = await findCompanyLinkedInUrlViaSonnet(companyName);

  if (url) {
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
    console.warn(`[CompanyResolver] No LinkedIn URL found for "${companyName}"`);
  }

  return {
    url,
    cost: {
      llmCalls: 1,
      costCents: COST_PER_SONNET_CALL_CENTS,
    },
  };
}

/**
 * Batch resolve multiple company names.
 * Checks cache first, then resolves uncached names via Sonnet.
 */
export async function resolveCompanyLinkedInUrls(
  companyNames: string[]
): Promise<{ urls: Map<string, string | null>; cost: { llmCalls: number; costCents: number } }> {
  console.log(`[CompanyResolver] Batch resolving ${companyNames.length} companies: ${companyNames.join(', ')}`);
  const urls = new Map<string, string | null>();
  let totalLlmCalls = 0;

  for (const name of companyNames) {
    const result = await resolveCompanyUrl(name);
    urls.set(name, result.url);
    totalLlmCalls += result.cost.llmCalls;
  }

  const resolved = Array.from(urls.entries()).filter(([, v]) => v !== null).length;
  console.log(`[CompanyResolver] Batch complete — ${resolved}/${companyNames.length} resolved, ${totalLlmCalls} Sonnet calls`);

  return {
    urls,
    cost: {
      llmCalls: totalLlmCalls,
      costCents: totalLlmCalls * COST_PER_SONNET_CALL_CENTS,
    },
  };
}
