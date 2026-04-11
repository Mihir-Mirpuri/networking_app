/**
 * Test: "Company" vs "at Company" (quoted) vs at "Company" (unquoted)
 * For AMBIGUOUS company names that could be person names
 * Broad search: just engineers at these companies, no uni/location filter
 *
 * Companies: Chase, Ramp, Block, Bolt, Squire
 * Pages: 1-2
 *
 * Usage: npx tsx tests/test-ambiguous-company-at.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const prisma = new PrismaClient();

const COMPANIES = ['Chase', 'Ramp', 'Block', 'Bolt', 'Squire'];
const STRATEGIES = [
  { id: 'A', label: '"Company"',           build: (c: string) => `"${c}"` },
  { id: 'B', label: '"at Company" (quoted)', build: (c: string) => `"at ${c}"` },
  { id: 'C', label: 'at "Company" (unquoted at)', build: (c: string) => `at "${c}"` },
];

interface SerperResult { title: string; link: string; snippet: string; }
let totalApiCalls = 0;

async function callSerper(query: string, page: number): Promise<SerperResult[]> {
  totalApiCalls++;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.organic || []);
}

function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ProfileData {
  fullName: string;
  company: string | null;
  city: string | null;
  state: string | null;
  schools: string[];
  source: 'db' | 'apify';
  experienceCompanies: string[];
}

async function main() {
  if (!SERPER_API_KEY) { console.error('SERPER_API_KEY not set'); process.exit(1); }

  console.log('=== Ambiguous Company Names: "Company" vs "at Company" vs at "Company" ===');
  console.log('Broad search: engineers at company (no uni/location filter) | Pages: 1-2\n');

  // Collect all slugs across everything
  const globalSlugMap = new Map<string, { url: string }>();

  // Per company+strategy results
  type CellResult = { slugs: Set<string> };
  const grid = new Map<string, Map<string, CellResult>>(); // company → strategy → result

  for (const company of COMPANIES) {
    const companyResults = new Map<string, CellResult>();

    for (const strat of STRATEGIES) {
      const companyPart = strat.build(company);
      const query = `site:linkedin.com/in ${companyPart} engineer`;
      const slugs = new Set<string>();

      for (let p = 1; p <= 2; p++) {
        const results = await callSerper(query, p);
        for (const r of results) {
          const slug = extractSlug(r.link);
          if (!slug) continue;
          slugs.add(slug);
          if (!globalSlugMap.has(slug)) {
            const id = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1] || slug;
            globalSlugMap.set(slug, { url: `https://www.linkedin.com/in/${id}` });
          }
        }
        await delay(300);
      }

      console.log(`  ${company} / ${strat.id}: ${slugs.size} unique profiles`);
      companyResults.set(strat.id, { slugs });
    }
    grid.set(company, companyResults);
    console.log();
  }

  console.log(`Total unique profiles across all: ${globalSlugMap.size}`);

  // DB lookup
  console.log('\nChecking database...');
  const profileData = new Map<string, ProfileData>();
  const needsScraping: string[] = [];
  let dbHits = 0;

  for (const [slug, info] of globalSlugMap) {
    const person = await prisma.person.findFirst({
      where: { linkedinUrl: { contains: slug, mode: 'insensitive' } },
      select: { fullName: true, company: true, city: true, state: true, schools: true, experienceHistory: true },
    });

    if (person) {
      dbHits++;
      const exp = person.experienceHistory as Array<{ companyName?: string }> | null;
      profileData.set(slug, {
        fullName: person.fullName, company: person.company, city: person.city, state: person.state,
        schools: (person.schools as string[]) || [], source: 'db',
        experienceCompanies: (exp || []).map(e => e.companyName || '').filter(Boolean),
      });
    } else {
      needsScraping.push(info.url);
    }
  }

  console.log(`  DB hits: ${dbHits}/${globalSlugMap.size} | Need scraping: ${needsScraping.length}`);

  if (needsScraping.length > 0) {
    console.log(`\nScraping ${needsScraping.length} via Apify...`);
    const scraped = await scrapeLinkedInProfiles(needsScraping);
    for (const p of scraped) {
      const slug = extractSlug(p.linkedinUrl);
      if (!slug) continue;
      profileData.set(slug, {
        fullName: p.fullName, company: p.company, city: p.city, state: p.state,
        schools: p.schools, source: 'apify',
        experienceCompanies: p.experienceHistory.map(e => e.companyName || '').filter(Boolean),
      });
    }
  }

  // Score each company × strategy
  console.log(`\n${'═'.repeat(90)}`);
  console.log('  RESULTS');
  console.log('═'.repeat(90));

  const summaryRows: { company: string; stratId: string; stratLabel: string; total: number; matchC: number }[] = [];

  for (const company of COMPANIES) {
    const companyLower = company.toLowerCase();
    console.log(`\n  ── ${company} ──`);

    for (const strat of STRATEGIES) {
      const cell = grid.get(company)!.get(strat.id)!;
      let total = 0, matchC = 0;
      const names: { name: string; co: string; match: boolean }[] = [];

      for (const slug of cell.slugs) {
        const p = profileData.get(slug);
        if (!p) continue;
        total++;
        const hasC = p.company?.toLowerCase().includes(companyLower) ||
          p.experienceCompanies.some(c => c.toLowerCase().includes(companyLower));
        if (hasC) matchC++;
        names.push({ name: p.fullName, co: p.company || '?', match: hasC });
      }

      const cRate = total > 0 ? Math.round(matchC / total * 100) : 0;
      console.log(`    ${strat.id}: ${strat.label.padEnd(28)} ${String(total).padStart(3)} profiles | Company match: ${matchC}/${total} (${cRate}%)`);
      // Show non-matches to see what Google returned instead
      const misses = names.filter(n => !n.match);
      if (misses.length > 0) {
        for (const m of misses) {
          console.log(`       ✗ ${m.name.padEnd(28)} current: ${m.co}`);
        }
      }
      summaryRows.push({ company, stratId: strat.id, stratLabel: strat.label, total, matchC });
    }
  }

  // Final comparison table
  console.log(`\n${'═'.repeat(90)}`);
  console.log('  SUMMARY: Volume & Company Match Rate');
  console.log('═'.repeat(90));
  console.log(`  ${'Company'.padEnd(10)} ${'Strategy'.padEnd(30)} ${'Vol'.padStart(4)}  ${'C-Match'.padStart(7)}  ${'C-Rate'.padStart(6)}`);
  console.log('  ' + '─'.repeat(62));

  for (const r of summaryRows) {
    const cRate = r.total > 0 ? `${Math.round(r.matchC / r.total * 100)}%` : '-';
    console.log(`  ${r.company.padEnd(10)} ${(r.stratId + ': ' + r.stratLabel).padEnd(30)} ${String(r.total).padStart(4)}  ${String(r.matchC).padStart(7)}  ${cRate.padStart(6)}`);
  }

  // Winner per company
  console.log(`\n  WINNER PER COMPANY (by company match rate, tiebreak: volume):`);
  for (const company of COMPANIES) {
    const rows = summaryRows.filter(r => r.company === company && r.total > 0);
    if (rows.length === 0) { console.log(`    ${company}: no results`); continue; }
    rows.sort((a, b) => {
      const rateA = a.matchC / a.total, rateB = b.matchC / b.total;
      if (rateB !== rateA) return rateB - rateA;
      return b.total - a.total;
    });
    const w = rows[0];
    const rate = Math.round(w.matchC / w.total * 100);
    console.log(`    ${company}: ${w.stratId} (${w.stratLabel}) — ${w.total} profiles, ${rate}% company match`);
  }

  // Show overlap: how many profiles are shared vs unique to each strategy
  console.log(`\n  OVERLAP ANALYSIS:`);
  for (const company of COMPANIES) {
    const a = grid.get(company)!.get('A')!.slugs;
    const b = grid.get(company)!.get('B')!.slugs;
    const c = grid.get(company)!.get('C')!.slugs;
    const all = new Set([...a, ...b, ...c]);
    console.log(`    ${company}: A=${a.size} B=${b.size} C=${c.size} | Combined unique: ${all.size}`);
  }

  console.log(`\n  Serper: ${totalApiCalls} calls | DB: ${dbHits} | Apify: ${needsScraping.length}`);
  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); });
