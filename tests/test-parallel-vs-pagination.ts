/**
 * Benchmark: 3 Pages of Same Query vs 1 Page of 3 Different Queries
 *
 * For 10 realistic user searches, compare:
 *   Method 1: Current query (A) paginated 3 pages deep — 3 API calls
 *   Method 2: 3 different query formats, 1 page each — 3 API calls
 *
 * Same cost (3 calls), which finds more unique people?
 *
 * Usage: npx tsx tests/test-parallel-vs-pagination.ts
 */

import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── 10 Realistic User Searches ──────────────────────────────────────────────

interface UserSearch {
  label: string;
  company: string;
  role?: string;
  university?: string;
  location?: string;
}

const USER_SEARCHES: UserSearch[] = [
  // Company-only searches (most common)
  { label: 'Stripe (large tech)', company: 'Stripe' },
  { label: 'Goldman Sachs (large finance)', company: 'Goldman Sachs' },
  { label: 'Anduril (mid defense-tech)', company: 'Anduril' },
  { label: 'Retool (small-mid dev tools)', company: 'Retool' },
  { label: 'Vanta (small security)', company: 'Vanta' },

  // Company + role
  { label: 'Google + SWE', company: 'Google', role: 'Software Engineer' },
  { label: 'McKinsey + Consultant', company: 'McKinsey', role: 'Consultant' },
  { label: 'JPMorgan + Analyst', company: 'JPMorgan', role: 'Analyst' },

  // Company + location
  { label: 'Meta + NYC', company: 'Meta', location: 'New York' },

  // Company + university
  { label: 'Deloitte + UT Austin', company: 'Deloitte', university: 'University of Texas at Austin' },
];

// ── Query Builders ──────────────────────────────────────────────────────────

function buildQueryA(s: UserSearch): string {
  const parts = [`site:linkedin.com/in`, `"${s.company}"`];
  if (s.role) parts.push(s.role);
  if (s.university) parts.push(`"${s.university}"`);
  if (s.location) parts.push(`"${s.location}"`);
  return parts.join(' ');
}

function buildQueryC(s: UserSearch): string {
  const parts = [`site:linkedin.com/in`, `"Experience"`, `"${s.company}"`];
  if (s.role) parts.push(s.role);
  if (s.university) parts.push(`"${s.university}"`);
  if (s.location) parts.push(`"${s.location}"`);
  return parts.join(' ');
}

function buildQueryD(s: UserSearch): string {
  const parts = [`site:linkedin.com/in`, `"at ${s.company}"`];
  if (s.role) parts.push(s.role);
  if (s.university) parts.push(`"${s.university}"`);
  if (s.location) parts.push(`"${s.location}"`);
  return parts.join(' ');
}

// ── Serper API ──────────────────────────────────────────────────────────────

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

let totalApiCalls = 0;

async function callSerper(query: string, page: number = 1): Promise<SerperResult[]> {
  totalApiCalls++;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });

  if (!res.ok) {
    console.error(`  [Serper] HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.organic || []).map((r: SerperResult) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    position: r.position,
  }));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function isLinkedInProfile(url: string): boolean {
  return /linkedin\.com\/in\/[a-zA-Z0-9_-]+/.test(url);
}

function mentionsCompany(text: string, company: string): boolean {
  return text.toLowerCase().includes(company.toLowerCase());
}

function extractUniqueSlugs(results: SerperResult[]): Set<string> {
  const slugs = new Set<string>();
  for (const r of results) {
    if (!isLinkedInProfile(r.link)) continue;
    const slug = extractSlug(r.link);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function countRelevant(results: SerperResult[], company: string): number {
  let count = 0;
  for (const r of results) {
    if (!isLinkedInProfile(r.link)) continue;
    if (mentionsCompany(r.snippet || '', company) || mentionsCompany(r.title || '', company)) {
      count++;
    }
  }
  return count;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SERPER_API_KEY) {
    console.error('ERROR: SERPER_API_KEY not set');
    process.exit(1);
  }

  console.log('=== Pagination vs Parallel Queries (3 calls each) ===\n');

  const summary: {
    label: string;
    paginUnique: number;
    paginRelevant: number;
    parallelUnique: number;
    parallelRelevant: number;
    overlap: number;
    onlyInPagin: number;
    onlyInParallel: number;
  }[] = [];

  for (const search of USER_SEARCHES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${search.label}`);
    console.log(`  Filters: company="${search.company}"${search.role ? ` role="${search.role}"` : ''}${search.university ? ` uni="${search.university}"` : ''}${search.location ? ` loc="${search.location}"` : ''}`);
    console.log('─'.repeat(70));

    // ── Method 1: Same query, 3 pages ──
    const queryA = buildQueryA(search);
    console.log(`\n  PAGINATION (3 pages of query A):`);
    console.log(`    Query: ${queryA}`);

    const paginResults: SerperResult[] = [];
    for (let p = 1; p <= 3; p++) {
      const pageResults = await callSerper(queryA, p);
      paginResults.push(...pageResults);
      console.log(`    Page ${p}: ${pageResults.filter(r => isLinkedInProfile(r.link)).length} LI profiles`);
      await delay(400);
    }
    const paginSlugs = extractUniqueSlugs(paginResults);
    const paginRelevant = countRelevant(paginResults, search.company);

    // ── Method 2: 3 different queries, 1 page each ──
    console.log(`\n  PARALLEL (3 different queries, page 1 each):`);

    const qA = buildQueryA(search);
    const qC = buildQueryC(search);
    const qD = buildQueryD(search);

    console.log(`    A: ${qA}`);
    const resA = await callSerper(qA, 1);
    await delay(400);

    console.log(`    C: ${qC}`);
    const resC = await callSerper(qC, 1);
    await delay(400);

    console.log(`    D: ${qD}`);
    const resD = await callSerper(qD, 1);
    await delay(400);

    const parallelResults = [...resA, ...resC, ...resD];
    const parallelSlugs = extractUniqueSlugs(parallelResults);
    const parallelRelevant = countRelevant(parallelResults, search.company);

    console.log(`    A: ${extractUniqueSlugs(resA).size} uniq | C: ${extractUniqueSlugs(resC).size} uniq | D: ${extractUniqueSlugs(resD).size} uniq`);

    // ── Overlap analysis ──
    const overlap = [...paginSlugs].filter(s => parallelSlugs.has(s)).length;
    const onlyInPagin = [...paginSlugs].filter(s => !parallelSlugs.has(s)).length;
    const onlyInParallel = [...parallelSlugs].filter(s => !paginSlugs.has(s)).length;

    console.log(`\n  RESULTS:`);
    console.log(`    Pagination:  ${paginSlugs.size} unique profiles (${paginRelevant} relevant)`);
    console.log(`    Parallel:    ${parallelSlugs.size} unique profiles (${parallelRelevant} relevant)`);
    console.log(`    Overlap:     ${overlap} in both`);
    console.log(`    Only pagination: ${onlyInPagin} | Only parallel: ${onlyInParallel}`);

    const winner = parallelSlugs.size > paginSlugs.size ? 'PARALLEL' :
      paginSlugs.size > parallelSlugs.size ? 'PAGINATION' : 'TIE';
    console.log(`    Winner: ${winner} (+${Math.abs(parallelSlugs.size - paginSlugs.size)})`);

    summary.push({
      label: search.label,
      paginUnique: paginSlugs.size,
      paginRelevant: paginRelevant,
      parallelUnique: parallelSlugs.size,
      parallelRelevant: parallelRelevant,
      overlap,
      onlyInPagin,
      onlyInParallel,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  FINAL SUMMARY — 3 API calls each');
  console.log('═'.repeat(80));

  console.log(`\n  ${'Search'.padEnd(35)} Pagin  Parall  Winner   Overlap  Only-P  Only-Q`);
  console.log('  ' + '─'.repeat(85));

  let paginWins = 0;
  let parallelWins = 0;
  let ties = 0;
  let totalPaginUnique = 0;
  let totalParallelUnique = 0;

  for (const s of summary) {
    const winner = s.parallelUnique > s.paginUnique ? 'PARALL' :
      s.paginUnique > s.parallelUnique ? 'PAGIN ' : 'TIE   ';

    if (s.parallelUnique > s.paginUnique) parallelWins++;
    else if (s.paginUnique > s.parallelUnique) paginWins++;
    else ties++;

    totalPaginUnique += s.paginUnique;
    totalParallelUnique += s.parallelUnique;

    console.log(
      `  ${s.label.padEnd(35)} ` +
      `${String(s.paginUnique).padStart(4)}   ` +
      `${String(s.parallelUnique).padStart(4)}    ` +
      `${winner}   ` +
      `${String(s.overlap).padStart(4)}     ` +
      `${String(s.onlyInPagin).padStart(4)}    ` +
      `${String(s.onlyInParallel).padStart(4)}`
    );
  }

  console.log('  ' + '─'.repeat(85));
  console.log(
    `  ${'TOTAL'.padEnd(35)} ` +
    `${String(totalPaginUnique).padStart(4)}   ` +
    `${String(totalParallelUnique).padStart(4)}`
  );

  console.log(`\n  Pagination wins: ${paginWins} | Parallel wins: ${parallelWins} | Ties: ${ties}`);
  console.log(`  Total API calls: ${totalApiCalls} (cost ~$${(totalApiCalls * 0.001).toFixed(3)})`);
  console.log('\n=== Benchmark Complete ===');
}

main().catch(console.error);
