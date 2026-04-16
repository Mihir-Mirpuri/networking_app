/**
 * Company URL Resolution Benchmark (v2, 10 resolvers)
 *
 * Companion to company-url-resolver-benchmark.ts (which tested Perplexity vs Serper).
 * This benchmark expands to 10 candidate methods against 25 stratified hard-case
 * companies drawn from companies_missing_linkedin_urls.txt.
 *
 * Ground truth was verified manually via WebSearch. Each test case is tagged with
 * the canonical LinkedIn URL (including path — schools use /school/ not /company/).
 *
 * Usage:
 *   npx tsx tests/company-url-resolution-benchmark.ts
 *   npx tsx tests/company-url-resolution-benchmark.ts --method=sonnet,apify
 *   npx tsx tests/company-url-resolution-benchmark.ts --limit=5
 */

import 'dotenv/config';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ApifyClient } from 'apify-client';
import { PrismaClient } from '@prisma/client';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const limit = (() => {
  const a = args.find(x => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : Infinity;
})();
const methodsFilter = (() => {
  const a = args.find(x => x.startsWith('--method='));
  return a ? new Set(a.split('=')[1].split(',').map(s => s.trim())) : null;
})();

// ─── Ground Truth Sample (25 stratified companies) ───────────────────────────

interface TestCompany {
  name: string;
  tier: string;
  /** Canonical LinkedIn URL (full, including path). Null = no single ground truth. */
  expected: string | null;
  /** Alternate acceptable URLs (e.g. parent company page also valid). */
  acceptable?: string[];
  /** Notes for the research doc about why this is tricky. */
  note?: string;
}

const SAMPLE: TestCompany[] = [
  // ══ Foreign / non-Latin names (2) ══
  { name: '毕马威中国', tier: 'foreign', expected: 'https://cn.linkedin.com/company/kpmg-china',
    note: 'Simplified Chinese; canonical URL is on cn.linkedin.com subdomain' },
  { name: '삼정KPMG', tier: 'foreign', expected: 'https://www.linkedin.com/company/samjong-kpmg',
    note: 'Korean Hangul; slug is transliteration' },

  // ══ Government entities (2) ══
  { name: 'Federal Bureau of Investigation', tier: 'government', expected: 'https://www.linkedin.com/company/fbi',
    note: 'Full name vs acronym — slug uses acronym' },
  { name: 'White House', tier: 'government', expected: 'https://www.linkedin.com/company/the-white-house',
    note: 'Slug prepends "the-"' },

  // ══ Law firms (3) ══
  { name: 'Kirkland & Ellis', tier: 'law', expected: 'https://www.linkedin.com/company/kirkland-&-ellis-llp',
    note: 'Ampersand preserved in slug; LLP suffix added' },
  { name: 'Skadden, Arps, Slate, Meagher & Flom LLP and Affiliates', tier: 'law',
    expected: 'https://www.linkedin.com/company/skadden-arps-slate-meagher-flom-llp-affiliates',
    note: 'Long name, commas and ampersand stripped, "and" preserved' },
  { name: 'Baker McKenzie', tier: 'law', expected: 'https://www.linkedin.com/company/baker-&-mckenzie',
    note: 'No ampersand in input name, but slug has one' },

  // ══ Business / grad schools (3) — use /school/ path, not /company/ ══
  { name: 'Harvard Business School', tier: 'school', expected: 'https://www.linkedin.com/school/harvard-business-school/',
    note: 'Uses /school/ path, not /company/' },
  { name: 'The Wharton School', tier: 'school', expected: 'https://www.linkedin.com/school/the-wharton-school/',
    note: 'Uses /school/ path' },
  { name: 'Columbia Law School', tier: 'school', expected: 'https://www.linkedin.com/school/columbia-law-school/',
    note: 'Uses /school/ path' },

  // ══ Ambiguous abbreviations / sub-brands (3) ══
  { name: 'BCG X', tier: 'sub-brand', expected: 'https://www.linkedin.com/company/bcg-x',
    note: 'BCG sub-brand with its own page (not boston-consulting-group)' },
  { name: 'Microsoft AI', tier: 'sub-brand', expected: 'https://www.linkedin.com/company/microsoft-ai',
    note: 'Microsoft sub-brand with its own page' },
  { name: 'Google DeepMind', tier: 'sub-brand', expected: 'https://www.linkedin.com/company/googledeepmind',
    note: 'Slug is concatenated (no hyphen)' },

  // ══ Name variations (2) ══
  { name: 'JPMorganChase', tier: 'variation', expected: 'https://www.linkedin.com/company/jpmorganchase',
    acceptable: ['https://www.linkedin.com/company/jpmorgan'],
    note: 'Concatenated input; slug may be jpmorgan OR jpmorganchase' },
  { name: 'C.H. Robinson Worldwide', tier: 'variation', expected: 'https://www.linkedin.com/company/c-h-robinson',
    note: 'Canonical strips "Worldwide" and dots' },

  // ══ Popular tech (3) — sanity baseline ══
  { name: 'Facebook', tier: 'popular', expected: 'https://www.linkedin.com/company/meta',
    acceptable: ['https://www.linkedin.com/company/facebook'],
    note: 'Rebranded to Meta; both slugs exist' },
  { name: 'Shopify', tier: 'popular', expected: 'https://www.linkedin.com/company/shopify' },
  { name: 'SpaceX', tier: 'popular', expected: 'https://www.linkedin.com/company/spacex' },

  // ══ Consulting sub-brands (3) ══
  { name: 'Deloitte Consulting', tier: 'consulting', expected: null,
    acceptable: [
      'https://www.linkedin.com/showcase/deloitteconsulting/',
      'https://www.linkedin.com/company/deloitte',
    ],
    note: 'Ambiguous — /showcase/ page vs parent /company/deloitte' },
  { name: 'EY-Parthenon', tier: 'consulting', expected: 'https://www.linkedin.com/company/ey-parthenon' },
  { name: 'QuantumBlack, AI by McKinsey', tier: 'consulting',
    expected: 'https://www.linkedin.com/company/quantumblack',
    note: 'Long branded name; slug is just quantumblack' },

  // ══ Obscure startups (4) ══
  { name: 'Metafora', tier: 'obscure', expected: 'https://www.linkedin.com/company/grow-with-metafora',
    note: 'Unexpected slug — "grow-with-metafora" not "metafora"' },
  { name: 'Vooma', tier: 'obscure', expected: 'https://www.linkedin.com/company/vooma-inc',
    note: 'Slug includes "-inc"' },
  { name: 'Nominal', tier: 'obscure', expected: 'https://www.linkedin.com/company/nominal-inc',
    note: 'Slug includes "-inc"; many companies named Nominal' },
  { name: 'Saronic Technologies', tier: 'obscure', expected: 'https://www.linkedin.com/company/saronic-technologies' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResolveResult {
  url: string | null;
  latencyMs: number;
  costUsd: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

type ResolverFn = (name: string) => Promise<ResolveResult>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractLinkedInUrl(text: string): string | null {
  // Match /company/, /school/, /showcase/ paths
  const match = text.match(/https?:\/\/(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com\/(?:company|school|showcase)\/[^\s"'<>)\]]+/i);
  if (!match) return null;
  // Strip trailing punctuation
  return match[0].replace(/[.,;:!?\)]+$/, '');
}

function normalizeUrlForComparison(url: string | null): string | null {
  if (!url) return null;
  // Normalize: strip www., strip trailing slash, lowercase, strip query/fragment
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\.linkedin\.com/, 'linkedin.com')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function urlsMatch(returned: string | null, expected: string | null, acceptable?: string[]): boolean {
  if (!returned || !expected) return false;
  const rNorm = normalizeUrlForComparison(returned);
  const eNorm = normalizeUrlForComparison(expected);
  if (rNorm === eNorm) return true;
  if (acceptable) {
    for (const alt of acceptable) {
      if (rNorm === normalizeUrlForComparison(alt)) return true;
    }
  }
  return false;
}

// ─── Resolvers ────────────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

// 1. Sonnet 4.6 — current production (LLM recall only)
async function resolveSonnet(name: string): Promise<ResolveResult> {
  const start = Date.now();
  try {
    const res = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 80,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `LinkedIn company/school page URL for "${name}". Return ONLY: {"url":"https://www.linkedin.com/company/SLUG"} or {"url":null}. Note: schools use /school/ path.`,
      }],
    });
    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    const url = extractLinkedInUrl(text);
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    // Sonnet 4.6: $3/Mtok in, $15/Mtok out
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    return { url, latencyMs: Date.now() - start, costUsd };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 2. Haiku 4.5 — cheap LLM recall
async function resolveHaiku(name: string): Promise<ResolveResult> {
  const start = Date.now();
  try {
    const res = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `LinkedIn company/school page URL for "${name}". Return ONLY: {"url":"https://www.linkedin.com/company/SLUG"} or {"url":null}. Note: schools use /school/ path.`,
      }],
    });
    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    const url = extractLinkedInUrl(text);
    // Haiku 4.5: $1/Mtok in, $5/Mtok out
    const costUsd = (res.usage.input_tokens * 1 + res.usage.output_tokens * 5) / 1_000_000;
    return { url, latencyMs: Date.now() - start, costUsd };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 3. Perplexity Sonar — LLM with web search grounding
async function resolvePerplexity(name: string): Promise<ResolveResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, costUsd: 0, error: 'No API key' };
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Return JSON only. No commentary.' },
          { role: 'user', content: `LinkedIn company page URL for "${name}". Return ONLY: {"url":"https://www.linkedin.com/company/..."} or {"url":null}.` },
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const url = extractLinkedInUrl(content);
    // Sonar: ~$1/1k req ≈ $0.001/call (rough estimate)
    return { url, latencyMs: Date.now() - start, costUsd: 0.001 };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 4. Serper — Google SERP `site:linkedin.com/company`
async function resolveSerper(name: string): Promise<ResolveResult> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, costUsd: 0, error: 'No API key' };
  const start = Date.now();
  try {
    // Use broader query to catch /school/ and /showcase/ too
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: `site:linkedin.com "${name}" (company OR school)`,
        num: 5,
        gl: 'us',
        hl: 'en',
      }),
    });
    if (!res.ok) return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    const organic = data.organic || [];
    for (const r of organic) {
      const url = extractLinkedInUrl(r.link || '');
      if (url) return { url, latencyMs: Date.now() - start, costUsd: 0.001 };
    }
    return { url: null, latencyMs: Date.now() - start, costUsd: 0.001 };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 5. DB backfill — mine Person.experienceHistory for companyLinkedinUrl
let prismaClient: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaClient) prismaClient = new PrismaClient();
  return prismaClient;
}

async function resolveDbBackfill(name: string): Promise<ResolveResult> {
  const start = Date.now();
  try {
    // Extract (companyName, companyLinkedinUrl) pairs from experienceHistory JSONB array,
    // fuzzy-match by name (case-insensitive), rank by frequency.
    const rows = await getPrisma().$queryRaw<Array<{ company_name: string; url: string; occurrences: number }>>`
      SELECT
        exp->>'companyName' AS company_name,
        exp->>'companyLinkedinUrl' AS url,
        COUNT(*)::int AS occurrences
      FROM "Person",
           jsonb_array_elements("experienceHistory") AS exp
      WHERE "experienceHistory" IS NOT NULL
        AND (exp->>'companyLinkedinUrl') IS NOT NULL
        AND (exp->>'companyName') ILIKE ${name}
      GROUP BY company_name, url
      ORDER BY occurrences DESC
      LIMIT 5
    `;
    const top = rows[0];
    return {
      url: top?.url || null,
      latencyMs: Date.now() - start,
      costUsd: 0,
      metadata: { matches: rows.length, occurrences: top?.occurrences },
    };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 6. Apify harvestapi/linkedin-company-employees — name as input, Full mode, maxItems=1
async function resolveApify(name: string): Promise<ResolveResult> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, costUsd: 0, error: 'No API key' };
  const start = Date.now();
  try {
    const client = new ApifyClient({ token: apiKey });
    const run = await client.actor('harvestapi/linkedin-company-employees').call(
      {
        companies: [name],
        profileScraperMode: 'Full ($8 per 1k)',
        maxItems: 1,
      },
      { memory: 256, timeout: 120 }
    );
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const profile = items[0] as any;
    // Extract companyLinkedinUrl from first experience entry that matches
    // current company. We just take experience[0] since we asked for the company's own employee.
    const exp = profile?.experience?.[0];
    const url = exp?.companyLinkedinUrl ? `https://www.linkedin.com/company/${exp.companyUniversalName || ''}` || exp.companyLinkedinUrl : null;
    // Prefer companyLinkedinUrl directly if present
    const directUrl = exp?.companyLinkedinUrl || null;
    return {
      url: directUrl || url,
      latencyMs: Date.now() - start,
      costUsd: 0.008, // Full mode, 1 profile
      metadata: {
        profileCount: items.length,
        companyName: exp?.companyName,
        companyUniversalName: exp?.companyUniversalName,
      },
    };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 7. Apollo /v1/organizations/search — Apollo returns linkedin_url on org match
async function resolveApollo(name: string): Promise<ResolveResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return { url: null, latencyMs: 0, costUsd: 0, error: 'No API key' };
  const start = Date.now();
  try {
    // Apollo's org search endpoint
    const res = await fetch(`https://api.apollo.io/v1/mixed_companies/search`, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q_organization_name: name,
        page: 1,
        per_page: 3,
      }),
    });
    if (!res.ok) return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    const orgs = data.organizations || data.accounts || [];
    const first = orgs[0];
    const linkedinUrl: string | null = first?.linkedin_url || null;
    return {
      url: linkedinUrl,
      latencyMs: Date.now() - start,
      costUsd: 0, // Apollo billing is plan-based, not per-call
      metadata: { orgCount: orgs.length, matchedName: first?.name },
    };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 8. Wikidata SPARQL — P6119 = LinkedIn company ID
async function resolveWikidata(name: string): Promise<ResolveResult> {
  const start = Date.now();
  try {
    // Step 1: search for entity by label
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&type=item&limit=3`,
      { headers: { 'User-Agent': 'networking-app-research/1.0' } }
    );
    if (!searchRes.ok) return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: `search HTTP ${searchRes.status}` };
    const searchData = await searchRes.json();
    const entities = searchData.search || [];
    if (entities.length === 0) return { url: null, latencyMs: Date.now() - start, costUsd: 0, metadata: { entityCount: 0 } };

    // Step 2: for each candidate entity, query its P6119 (LinkedIn ID)
    const qids = entities.slice(0, 3).map((e: any) => e.id);
    const sparql = `
      SELECT ?item ?linkedin WHERE {
        VALUES ?item { ${qids.map((q: string) => `wd:${q}`).join(' ')} }
        ?item wdt:P6119 ?linkedin .
      } LIMIT 3
    `;
    const sparqlRes = await fetch(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
      { headers: { 'User-Agent': 'networking-app-research/1.0', Accept: 'application/sparql-results+json' } }
    );
    if (!sparqlRes.ok) return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: `sparql HTTP ${sparqlRes.status}` };
    const sparqlData = await sparqlRes.json();
    const bindings = sparqlData.results?.bindings || [];
    const linkedinId = bindings[0]?.linkedin?.value;
    const url = linkedinId ? `https://www.linkedin.com/company/${linkedinId}` : null;
    return {
      url,
      latencyMs: Date.now() - start,
      costUsd: 0,
      metadata: { entityCount: entities.length, bindings: bindings.length, qids },
    };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 9. Claude with web_search tool
async function resolveClaudeWebSearch(name: string): Promise<ResolveResult> {
  const start = Date.now();
  try {
    const res = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 } as any],
      messages: [{
        role: 'user',
        content: `Find the LinkedIn company/school page URL for "${name}". Search the web if needed. Return ONLY: {"url":"https://www.linkedin.com/company/..."} or {"url":null}. Note: schools use /school/ path.`,
      }],
    });
    // Collect text from all content blocks (text + tool_use results)
    let fullText = '';
    for (const block of res.content) {
      if (block.type === 'text') fullText += block.text + '\n';
    }
    const url = extractLinkedInUrl(fullText);
    // Cost: input + output tokens + web search tool use ($10 per 1k searches = $0.01/search)
    const searchCount = res.content.filter(b => b.type === 'server_tool_use').length;
    const costUsd = (res.usage.input_tokens * 3 + res.usage.output_tokens * 15) / 1_000_000 + searchCount * 0.01;
    return { url, latencyMs: Date.now() - start, costUsd, metadata: { searches: searchCount } };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: 0, error: err.message?.slice(0, 120) };
  }
}

// 10. Website → LinkedIn scrape: find domain, fetch homepage, regex for linkedin.com/company
async function resolveWebsiteScrape(name: string): Promise<ResolveResult> {
  const start = Date.now();
  let serperCost = 0;
  try {
    // Step 1: Find the company's website via Serper
    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey) return { url: null, latencyMs: 0, costUsd: 0, error: 'No Serper key' };
    const serp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${name} official website`, num: 3, gl: 'us', hl: 'en' }),
    });
    serperCost = 0.001;
    if (!serp.ok) return { url: null, latencyMs: Date.now() - start, costUsd: serperCost, error: `Serper HTTP ${serp.status}` };
    const serpData = await serp.json();
    const candidates: string[] = (serpData.organic || [])
      .slice(0, 3)
      .map((r: any) => r.link || '')
      .filter((l: string) => l && !/linkedin\.com|wikipedia|bloomberg|crunchbase/.test(l));
    if (candidates.length === 0) return { url: null, latencyMs: Date.now() - start, costUsd: serperCost, metadata: { candidates: 0 } };

    // Step 2: Fetch each candidate homepage, look for linkedin.com/company/...
    for (const site of candidates) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const pageRes = await fetch(site, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot)' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!pageRes.ok) continue;
        const html = await pageRes.text();
        const url = extractLinkedInUrl(html);
        if (url) return { url, latencyMs: Date.now() - start, costUsd: serperCost, metadata: { source: site } };
      } catch {
        /* try next candidate */
      }
    }
    return { url: null, latencyMs: Date.now() - start, costUsd: serperCost, metadata: { candidates: candidates.length } };
  } catch (err: any) {
    return { url: null, latencyMs: Date.now() - start, costUsd: serperCost, error: err.message?.slice(0, 120) };
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

interface BenchmarkRow {
  company: TestCompany;
  results: Map<string, ResolveResult>;
  correctness: Map<string, boolean>;
}

const RESOLVERS: Array<[string, ResolverFn]> = [
  ['sonnet', resolveSonnet],
  ['haiku', resolveHaiku],
  ['perplexity', resolvePerplexity],
  ['serper', resolveSerper],
  ['db', resolveDbBackfill],
  ['apify', resolveApify],
  ['apollo', resolveApollo],
  ['wikidata', resolveWikidata],
  ['claude-web', resolveClaudeWebSearch],
  ['website', resolveWebsiteScrape],
];

async function main() {
  const activeResolvers = RESOLVERS.filter(([name]) => !methodsFilter || methodsFilter.has(name));
  const companies = SAMPLE.slice(0, limit);

  console.log(`\n🔍 Benchmarking ${companies.length} companies × ${activeResolvers.length} resolvers`);
  console.log(`   Resolvers: ${activeResolvers.map(([n]) => n).join(', ')}\n`);

  const rows: BenchmarkRow[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`  [${i + 1}/${companies.length}] ${company.name} (${company.tier})`);

    // Run all resolvers for this company in parallel
    const resultsArr = await Promise.all(
      activeResolvers.map(async ([name, fn]) => [name, await fn(company.name).catch(e => ({ url: null, latencyMs: 0, costUsd: 0, error: `threw: ${e?.message?.slice(0, 80)}` }))] as const)
    );
    const results = new Map<string, ResolveResult>(resultsArr as any);

    const correctness = new Map<string, boolean>();
    for (const [name, result] of results) {
      correctness.set(name, company.expected === null
        ? (result.url !== null && !!company.acceptable?.some(a => normalizeUrlForComparison(a) === normalizeUrlForComparison(result.url)))
        : urlsMatch(result.url, company.expected, company.acceptable));
    }

    rows.push({ company, results, correctness });

    // Print one-line summary per resolver
    const summary = activeResolvers.map(([name]) => {
      const r = results.get(name)!;
      const ok = correctness.get(name) ? '✓' : (r.url ? '≠' : '✗');
      return `${name}:${ok}`;
    }).join(' ');
    console.log(`     ${summary}`);
  }

  // ─── Report generation ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('# Company URL Resolution Benchmark');
  lines.push(`\nGenerated: ${new Date().toISOString()}`);
  lines.push(`Sample size: ${rows.length}`);
  lines.push(`Resolvers tested: ${activeResolvers.map(([n]) => n).join(', ')}`);

  // Aggregate stats
  lines.push('\n## Aggregate Results\n');
  lines.push('| Resolver | Resolved | Correct | Accuracy | Avg latency | Avg cost | Total cost |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [name] of activeResolvers) {
    const res = rows.map(r => r.results.get(name)!);
    const resolved = res.filter(r => r.url !== null).length;
    const correct = rows.filter(r => r.correctness.get(name)).length;
    const avgLatency = res.reduce((a, b) => a + b.latencyMs, 0) / res.length;
    const avgCost = res.reduce((a, b) => a + b.costUsd, 0) / res.length;
    const totalCost = res.reduce((a, b) => a + b.costUsd, 0);
    const accuracy = rows.length > 0 ? Math.round((correct / rows.length) * 100) : 0;
    lines.push(`| ${name} | ${resolved}/${rows.length} | ${correct}/${rows.length} | ${accuracy}% | ${Math.round(avgLatency)}ms | $${avgCost.toFixed(4)} | $${totalCost.toFixed(3)} |`);
  }

  // Accuracy by tier
  const tiers = Array.from(new Set(rows.map(r => r.company.tier)));
  lines.push('\n## Accuracy by Category\n');
  lines.push(`| Resolver | ${tiers.join(' | ')} |`);
  lines.push(`|${'---|'.repeat(tiers.length + 1)}`);
  for (const [name] of activeResolvers) {
    const cells = tiers.map(t => {
      const tierRows = rows.filter(r => r.company.tier === t);
      const correct = tierRows.filter(r => r.correctness.get(name)).length;
      return `${correct}/${tierRows.length}`;
    });
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }

  // Detailed per-company table
  lines.push('\n## Per-Company Details\n');
  for (const row of rows) {
    lines.push(`\n### ${row.company.name} (${row.company.tier})`);
    lines.push(`**Expected:** \`${row.company.expected || '(ambiguous)'}\``);
    if (row.company.acceptable) lines.push(`**Acceptable:** ${row.company.acceptable.map(u => `\`${u}\``).join(', ')}`);
    if (row.company.note) lines.push(`**Note:** ${row.company.note}`);
    lines.push('');
    lines.push('| Resolver | URL returned | Correct? | Latency | Cost |');
    lines.push('|---|---|---|---|---|');
    for (const [name] of activeResolvers) {
      const r = row.results.get(name)!;
      const ok = row.correctness.get(name) ? '✓' : (r.url ? '✗ (wrong)' : '∅');
      const urlStr = r.url ? `\`${r.url}\`` : (r.error ? `_err: ${r.error}_` : '_null_');
      lines.push(`| ${name} | ${urlStr} | ${ok} | ${r.latencyMs}ms | $${r.costUsd.toFixed(4)} |`);
    }
  }

  // Save JSON + MD
  const dir = join(__dirname, 'company-url-benchmark-reports');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mdPath = join(dir, `v2-report-${stamp}.md`);
  const jsonPath = join(dir, `v2-report-${stamp}.json`);
  await writeFile(mdPath, lines.join('\n'), 'utf-8');
  await writeFile(jsonPath, JSON.stringify(rows.map(r => ({
    company: r.company,
    results: Object.fromEntries(r.results),
    correctness: Object.fromEntries(r.correctness),
  })), null, 2), 'utf-8');

  console.log(`\n📊 Report: ${mdPath}`);
  console.log(`📊 Raw JSON: ${jsonPath}\n`);

  // Quick console summary
  for (const [name] of activeResolvers) {
    const correct = rows.filter(r => r.correctness.get(name)).length;
    console.log(`  ${name.padEnd(15)} ${correct}/${rows.length} correct (${Math.round(correct / rows.length * 100)}%)`);
  }

  await getPrisma().$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
