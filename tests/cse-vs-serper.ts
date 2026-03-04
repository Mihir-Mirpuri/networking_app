/**
 * Comparison test: Google CSE vs Serper
 *
 * Runs the same LinkedIn search query through both APIs and compares results.
 *
 * Usage:
 *   npx tsx tests/cse-vs-serper.ts
 *   npx tsx tests/cse-vs-serper.ts "Goldman Sachs" "investment banking analyst"
 */

import 'dotenv/config';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── CSE Search ──────────────────────────────────────────────────────────

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  pagemap?: {
    metatags?: Array<{
      'profile:first_name'?: string;
      'profile:last_name'?: string;
      'og:description'?: string;
    }>;
  };
}

async function searchCSE(query: string): Promise<CSEResult[]> {
  if (!CSE_API_KEY) {
    console.log('⚠ GOOGLE_CSE_API_KEY not set, skipping CSE');
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');

  const response = await fetch(url.toString());
  if (!response.ok) {
    console.error('CSE error:', response.status, await response.text());
    return [];
  }
  const data = await response.json();
  return data.items || [];
}

// ── Serper Search ───────────────────────────────────────────────────────

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

async function searchSerper(query: string): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) {
    console.log('⚠ SERPER_API_KEY not set, skipping Serper');
    return [];
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: 10,
      gl: 'us',
      hl: 'en',
    }),
  });

  if (!response.ok) {
    console.error('Serper error:', response.status, await response.text());
    return [];
  }
  const data = await response.json();
  return data.organic || [];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isLinkedInProfile(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

function normalizeLinkedInUrl(url: string): string {
  // Strip trailing slashes and query params for consistent comparison
  return url.split('?')[0].replace(/\/+$/, '').toLowerCase();
}

function extractNameFromTitle(title: string): string | null {
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
  return match ? match[1] : null;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const company = process.argv[2] || 'Goldman Sachs';
  const role = process.argv[3] || 'investment banking analyst';

  const query = `site:linkedin.com/in "${company}" ${role}`;
  console.log(`\nQuery: ${query}\n`);
  console.log('='.repeat(80));

  // Run both in parallel
  const [cseResults, serperResults] = await Promise.all([
    searchCSE(query),
    searchSerper(query),
  ]);

  // Filter to LinkedIn profiles only
  const cseProfiles = cseResults.filter(r => isLinkedInProfile(r.link));
  const serperProfiles = serperResults.filter(r => isLinkedInProfile(r.link));

  // Normalize URLs for comparison
  const cseUrls = new Set(cseProfiles.map(r => normalizeLinkedInUrl(r.link)));
  const serperUrls = new Set(serperProfiles.map(r => normalizeLinkedInUrl(r.link)));

  // ── CSE Results ──
  console.log(`\n📘 CSE Results (${cseProfiles.length} LinkedIn profiles out of ${cseResults.length} total)`);
  console.log('-'.repeat(80));
  for (const r of cseProfiles) {
    const metatags = r.pagemap?.metatags?.[0];
    const name = metatags?.['profile:first_name'] && metatags?.['profile:last_name']
      ? `${metatags['profile:first_name']} ${metatags['profile:last_name']}`
      : extractNameFromTitle(r.title) || '(no name parsed)';
    const company = metatags?.['og:description']?.match(/Experience:\s*([^·]+)/)?.[1]?.trim() || '(no company)';
    const inSerper = serperUrls.has(normalizeLinkedInUrl(r.link));
    console.log(`  ${inSerper ? '✓' : '✗'} ${name} — ${company}`);
    console.log(`    ${r.link}`);
  }

  // ── Serper Results ──
  console.log(`\n📙 Serper Results (${serperProfiles.length} LinkedIn profiles out of ${serperResults.length} total)`);
  console.log('-'.repeat(80));
  for (const r of serperProfiles) {
    const name = extractNameFromTitle(r.title) || '(no name parsed)';
    const inCSE = cseUrls.has(normalizeLinkedInUrl(r.link));
    console.log(`  ${inCSE ? '✓' : '✗'} ${name} — (no metatag company)`);
    console.log(`    ${r.link}`);
  }

  // ── Overlap Analysis ──
  const overlap = [...cseUrls].filter(url => serperUrls.has(url));
  const cseOnly = [...cseUrls].filter(url => !serperUrls.has(url));
  const serperOnly = [...serperUrls].filter(url => !cseUrls.has(url));

  console.log(`\n📊 Comparison Summary`);
  console.log('='.repeat(80));
  console.log(`  CSE LinkedIn profiles:    ${cseUrls.size}`);
  console.log(`  Serper LinkedIn profiles: ${serperUrls.size}`);
  console.log(`  Overlap:                  ${overlap.length}`);
  console.log(`  CSE only:                 ${cseOnly.length}`);
  console.log(`  Serper only:              ${serperOnly.length}`);

  const total = new Set([...cseUrls, ...serperUrls]).size;
  const overlapPct = total > 0 ? Math.round((overlap.length / total) * 100) : 0;
  console.log(`  Overlap %:                ${overlapPct}%`);

  // ── Metatag availability (CSE advantage) ──
  if (cseProfiles.length > 0) {
    const withName = cseProfiles.filter(r => r.pagemap?.metatags?.[0]?.['profile:first_name']).length;
    const withCompany = cseProfiles.filter(r => {
      const desc = r.pagemap?.metatags?.[0]?.['og:description'];
      return desc && /Experience:/.test(desc);
    }).length;
    console.log(`\n📎 CSE Metatag Availability`);
    console.log(`  profile:first_name/last_name: ${withName}/${cseProfiles.length}`);
    console.log(`  og:description (company):     ${withCompany}/${cseProfiles.length}`);
    console.log(`  → Serper has neither of these; names fall back to title parsing`);
  }

  console.log('');
}

main().catch(console.error);
