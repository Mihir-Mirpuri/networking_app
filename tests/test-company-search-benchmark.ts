/**
 * Benchmark: Serper Query Formats for Company-Based LinkedIn Discovery
 *
 * Tests multiple query strategies across companies of varying sizes
 * to find which format discovers the most LinkedIn profiles.
 *
 * Metrics per query:
 * - LinkedIn profiles found (valid /in/ URLs)
 * - Unique people (deduplicated slugs)
 * - Relevance (does snippet/title mention the target company?)
 *
 * Usage: npx tsx tests/test-company-search-benchmark.ts
 */

import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── Test Companies (varying sizes) ──────────────────────────────────────────

const TEST_COMPANIES = [
  { name: 'Stripe', size: 'large' },
  { name: 'Notion', size: 'mid' },
  { name: 'Anduril', size: 'mid' },
  { name: 'Retool', size: 'small-mid' },
  { name: 'Vanta', size: 'small' },
];

// ── Query Strategies ────────────────────────────────────────────────────────

type QueryBuilder = (company: string) => string;

const QUERY_STRATEGIES: { id: string; name: string; builder: QueryBuilder; pages: number }[] = [
  {
    id: 'A',
    name: '"Company" (current approach)',
    builder: (c) => `site:linkedin.com/in "${c}"`,
    pages: 1,
  },
  {
    id: 'B',
    name: 'Company unquoted',
    builder: (c) => `site:linkedin.com/in ${c}`,
    pages: 1,
  },
  {
    id: 'C',
    name: '"Experience" + "Company"',
    builder: (c) => `site:linkedin.com/in "Experience" "${c}"`,
    pages: 1,
  },
  {
    id: 'D',
    name: '"at Company"',
    builder: (c) => `site:linkedin.com/in "at ${c}"`,
    pages: 1,
  },
  {
    id: 'E',
    name: '"Company · " (LinkedIn snippet pattern)',
    builder: (c) => `site:linkedin.com/in "${c} · "`,
    pages: 1,
  },
  {
    id: 'F',
    name: '"- Company" (LinkedIn title pattern)',
    builder: (c) => `site:linkedin.com/in "- ${c}"`,
    pages: 1,
  },
  {
    id: 'G',
    name: 'intitle:"Company"',
    builder: (c) => `site:linkedin.com/in intitle:"${c}"`,
    pages: 1,
  },
  {
    id: 'H',
    name: '"Company" (2 pages)',
    builder: (c) => `site:linkedin.com/in "${c}"`,
    pages: 2,
  },
  {
    id: 'I',
    name: '"works at Company"',
    builder: (c) => `site:linkedin.com/in "works at ${c}"`,
    pages: 1,
  },
  {
    id: 'J',
    name: 'linkedin.com "Company" (no site restriction to /in)',
    builder: (c) => `site:linkedin.com/in/ "${c}"`,
    pages: 1,
  },
  {
    id: 'K',
    name: '"Company" inurl:linkedin.com/in',
    builder: (c) => `inurl:linkedin.com/in "${c}"`,
    pages: 1,
  },
];

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

function isLinkedInProfile(url: string): boolean {
  return /linkedin\.com\/in\/[a-zA-Z0-9_-]+/.test(url);
}

function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function mentionsCompany(text: string, company: string): boolean {
  return text.toLowerCase().includes(company.toLowerCase());
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Types ───────────────────────────────────────────────────────────────────

interface StrategyResult {
  strategyId: string;
  strategyName: string;
  company: string;
  linkedinCount: number;
  uniqueSlugs: Set<string>;
  relevantCount: number; // snippet or title mentions company
  apiCalls: number;
  samplePeople: string[]; // first 3 names from titles
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SERPER_API_KEY) {
    console.error('ERROR: SERPER_API_KEY not set');
    process.exit(1);
  }

  console.log('=== Company Search Query Benchmark ===');
  console.log(`${QUERY_STRATEGIES.length} strategies × ${TEST_COMPANIES.length} companies\n`);

  const allResults: StrategyResult[] = [];

  for (const company of TEST_COMPANIES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${company.name} (${company.size})`);
    console.log('─'.repeat(70));

    for (const strategy of QUERY_STRATEGIES) {
      const query = strategy.builder(company.name);
      const callsBefore = totalApiCalls;

      // Fetch results (1 or 2 pages)
      let results: SerperResult[] = [];
      for (let p = 1; p <= strategy.pages; p++) {
        const pageResults = await callSerper(query, p);
        results.push(...pageResults);
        if (p < strategy.pages) await delay(300);
      }

      // Analyze
      const uniqueSlugs = new Set<string>();
      let linkedinCount = 0;
      let relevantCount = 0;
      const samplePeople: string[] = [];

      for (const r of results) {
        if (!isLinkedInProfile(r.link)) continue;

        linkedinCount++;
        const slug = extractSlug(r.link);
        if (slug) uniqueSlugs.add(slug);

        const isRelevant = mentionsCompany(r.snippet || '', company.name) ||
          mentionsCompany(r.title || '', company.name);
        if (isRelevant) relevantCount++;

        // Extract name from LinkedIn title: "FirstName LastName - Title - Company | LinkedIn"
        if (samplePeople.length < 3) {
          const name = r.title.split(/\s*[-–—|]\s*/)[0].trim();
          if (name) samplePeople.push(name);
        }
      }

      const result: StrategyResult = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        company: company.name,
        linkedinCount,
        uniqueSlugs,
        relevantCount,
        apiCalls: totalApiCalls - callsBefore,
        samplePeople,
      };
      allResults.push(result);

      const relevancePct = linkedinCount > 0
        ? Math.round((relevantCount / linkedinCount) * 100)
        : 0;

      console.log(
        `  ${strategy.id}: ${strategy.name.padEnd(45)} ` +
        `LI: ${String(linkedinCount).padStart(2)}  ` +
        `Uniq: ${String(uniqueSlugs.size).padStart(2)}  ` +
        `Rel: ${String(relevancePct).padStart(3)}%  ` +
        `[${samplePeople.slice(0, 2).join(', ')}]`
      );

      await delay(400);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AGGREGATE
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log('  AGGREGATE RANKINGS');
  console.log('═'.repeat(70));

  // Group by strategy
  const agg = new Map<string, {
    id: string;
    name: string;
    totalLinkedin: number;
    totalUnique: number;
    totalRelevant: number;
    totalCalls: number;
    perCompany: Map<string, number>;
  }>();

  for (const r of allResults) {
    const key = r.strategyId;
    const existing = agg.get(key) ?? {
      id: r.strategyId,
      name: r.strategyName,
      totalLinkedin: 0,
      totalUnique: 0,
      totalRelevant: 0,
      totalCalls: 0,
      perCompany: new Map(),
    };

    existing.totalLinkedin += r.linkedinCount;
    existing.totalUnique += r.uniqueSlugs.size;
    existing.totalRelevant += r.relevantCount;
    existing.totalCalls += r.apiCalls;
    existing.perCompany.set(r.company, r.uniqueSlugs.size);

    agg.set(key, existing);
  }

  // Rank by unique profiles
  const ranked = [...agg.values()].sort((a, b) => b.totalUnique - a.totalUnique);

  console.log('\n  Ranked by total unique LinkedIn profiles:\n');
  console.log(
    '  Rank  Strategy'.padEnd(58) +
    'Unique  LI Tot  Rel%    Calls   Per-company breakdown'
  );
  console.log('  ' + '─'.repeat(110));

  for (let i = 0; i < ranked.length; i++) {
    const s = ranked[i];
    const relPct = s.totalLinkedin > 0
      ? Math.round((s.totalRelevant / s.totalLinkedin) * 100)
      : 0;

    const perCompany = TEST_COMPANIES
      .map(c => `${c.name.slice(0, 3)}:${s.perCompany.get(c.name) ?? 0}`)
      .join('  ');

    console.log(
      `  #${String(i + 1).padStart(2)}   ${(s.id + ': ' + s.name).padEnd(48)} ` +
      `${String(s.totalUnique).padStart(4)}    ` +
      `${String(s.totalLinkedin).padStart(4)}    ` +
      `${String(relPct).padStart(3)}%    ` +
      `${String(s.totalCalls).padStart(3)}     ` +
      perCompany
    );
  }

  // ── Overlap Analysis ────────────────────────────────────────────────────
  // For each company, how many unique profiles does the BEST strategy find
  // that the current approach (A) misses?

  console.log(`\n${'─'.repeat(70)}`);
  console.log('  OVERLAP: Unique profiles found by other strategies but NOT by A (current)');
  console.log('─'.repeat(70));

  for (const company of TEST_COMPANIES) {
    const strategyA = allResults.find(r => r.strategyId === 'A' && r.company === company.name);
    if (!strategyA) continue;

    const aSlugs = strategyA.uniqueSlugs;

    for (const r of allResults.filter(x => x.company === company.name && x.strategyId !== 'A')) {
      const newSlugs = [...r.uniqueSlugs].filter(s => !aSlugs.has(s));
      if (newSlugs.length > 0) {
        console.log(`  ${company.name} | ${r.strategyId}: +${newSlugs.length} new profiles not in A`);
      }
    }
  }

  // ── Best per company ──────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(70)}`);
  console.log('  BEST STRATEGY PER COMPANY');
  console.log('─'.repeat(70));

  for (const company of TEST_COMPANIES) {
    const companyResults = allResults
      .filter(r => r.company === company.name)
      .sort((a, b) => b.uniqueSlugs.size - a.uniqueSlugs.size);

    const best = companyResults[0];
    const current = companyResults.find(r => r.strategyId === 'A');
    if (best && current) {
      const diff = best.uniqueSlugs.size - current.uniqueSlugs.size;
      console.log(
        `  ${company.name.padEnd(12)} (${company.size.padEnd(10)})  ` +
        `Best: ${best.strategyId} (${best.uniqueSlugs.size} uniq)  ` +
        `Current A: ${current.uniqueSlugs.size} uniq  ` +
        `${diff > 0 ? `+${diff} improvement` : 'A is best'}`
      );
    }
  }

  console.log(`\n  Total Serper API calls: ${totalApiCalls}`);
  console.log(`  Estimated cost: ~$${(totalApiCalls * 0.001).toFixed(3)}`);
  console.log('\n=== Benchmark Complete ===');
}

main().catch(console.error);
