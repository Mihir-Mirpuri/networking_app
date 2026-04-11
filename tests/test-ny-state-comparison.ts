/**
 * Compare "New York" vs "New York, New York" in Query B, pages 1-4
 *
 * Usage: npx tsx tests/test-ny-state-comparison.ts
 */

import 'dotenv/config';
import { scrapeLinkedInProfiles, normalizeSchool } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

const QUERIES = [
  { id: 'B1', name: '"New York" (city only)', query: 'site:linkedin.com/in "New York" "McKinsey" "Stanford"' },
  { id: 'B2', name: '"New York, New York" (city+state)', query: 'site:linkedin.com/in "New York, New York" "McKinsey" "Stanford"' },
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

async function main() {
  if (!SERPER_API_KEY) { console.error('SERPER_API_KEY not set'); process.exit(1); }

  console.log('=== "New York" vs "New York, New York" — Pages 1-4 ===\n');

  // Collect all URLs across both queries
  const allSlugs = new Set<string>();
  const allUrls = new Map<string, string>(); // slug → url

  // Per-query, per-page tracking
  type PageData = { page: number; slugs: Set<string> };
  const queryData = new Map<string, { pages: PageData[]; allSlugs: Set<string> }>();

  for (const q of QUERIES) {
    console.log(`${q.id}: ${q.name}`);
    console.log(`  ${q.query}`);

    const pages: PageData[] = [];
    const qSlugs = new Set<string>();

    for (let p = 1; p <= 4; p++) {
      const results = await callSerper(q.query, p);
      const pageSlugs = new Set<string>();

      for (const r of results) {
        const slug = extractSlug(r.link);
        if (!slug) continue;
        pageSlugs.add(slug);
        qSlugs.add(slug);
        if (!allSlugs.has(slug)) {
          allSlugs.add(slug);
          const id = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1];
          if (id) allUrls.set(slug, `https://www.linkedin.com/in/${id}`);
        }
      }

      const liCount = results.filter(r => r.link.includes('linkedin.com/in/')).length;
      const newCount = [...pageSlugs].filter(s => ![...pages.flatMap(pg => [...pg.slugs])].includes(s)).length;
      console.log(`  Page ${p}: ${liCount} LI profiles, ${pageSlugs.size} unique on page, ${newCount} new`);
      pages.push({ page: p, slugs: pageSlugs });
      await delay(400);
    }

    console.log(`  Total unique across 4 pages: ${qSlugs.size}\n`);
    queryData.set(q.id, { pages, allSlugs: qSlugs });
  }

  // Scrape all unique profiles
  console.log(`Total unique profiles across both queries: ${allUrls.size}`);
  console.log('\nScraping via Apify...\n');
  const profiles = await scrapeLinkedInProfiles([...allUrls.values()]);

  const profileMap = new Map<string, typeof profiles[0]>();
  for (const p of profiles) {
    const slug = extractSlug(p.linkedinUrl);
    if (slug) profileMap.set(slug, p);
  }

  // Score each query
  for (const q of QUERIES) {
    const data = queryData.get(q.id)!;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${q.id}: ${q.name}`);
    console.log('═'.repeat(70));

    // Per-page stats
    for (const pg of data.pages) {
      let total = 0, matchL = 0, matchAll = 0;
      for (const slug of pg.slugs) {
        const p = profileMap.get(slug);
        if (!p) continue;
        total++;
        const hasC = p.company?.toLowerCase().includes('mckinsey') ||
          p.experienceHistory.some(e => e.companyName?.toLowerCase().includes('mckinsey'));
        const hasU = p.schools.some(s => normalizeSchool(s).toLowerCase().includes('stanford'));
        const hasL = [p.city, p.state].some(l => l?.toLowerCase().includes('new york'));
        if (hasL) matchL++;
        if (hasC && hasU && hasL) matchAll++;
      }
      console.log(`  Page ${pg.page}: ${total} scraped | Location: ${matchL}/${total} (${total > 0 ? Math.round(matchL/total*100) : 0}%) | All 3: ${matchAll}/${total} (${total > 0 ? Math.round(matchAll/total*100) : 0}%)`);
    }

    // Overall stats
    let total = 0, matchC = 0, matchU = 0, matchL = 0, matchAll = 0;
    console.log(`\n  ${'Name'.padEnd(28)} ${'Company'.padEnd(18)} ${'Location'.padEnd(22)} Match`);
    console.log('  ' + '─'.repeat(75));

    for (const slug of data.allSlugs) {
      const p = profileMap.get(slug);
      if (!p) continue;
      total++;
      const hasC = p.company?.toLowerCase().includes('mckinsey') ||
        p.experienceHistory.some(e => e.companyName?.toLowerCase().includes('mckinsey'));
      const hasU = p.schools.some(s => normalizeSchool(s).toLowerCase().includes('stanford'));
      const hasL = [p.city, p.state].some(l => l?.toLowerCase().includes('new york'));
      if (hasC) matchC++;
      if (hasU) matchU++;
      if (hasL) matchL++;
      if (hasC && hasU && hasL) matchAll++;

      const mark = (hasC && hasU && hasL) ? '✓' : '✗';
      const loc = [p.city, p.state].filter(Boolean).join(', ') || '(none)';
      const flags = `${hasC ? 'C' : ' '}${hasU ? 'U' : ' '}${hasL ? 'L' : ' '}`;
      console.log(`  ${mark} ${p.fullName.padEnd(26)} ${(p.company || '?').substring(0, 17).padEnd(18)} ${loc.substring(0, 21).padEnd(22)} [${flags}]`);
    }

    console.log(`\n  TOTAL: ${total} unique | Company: ${matchC} | Uni: ${matchU} | Location: ${matchL} (${total > 0 ? Math.round(matchL/total*100) : 0}%) | All 3: ${matchAll} (${total > 0 ? Math.round(matchAll/total*100) : 0}%)`);
  }

  // Overlap between queries
  const b1Slugs = queryData.get('B1')!.allSlugs;
  const b2Slugs = queryData.get('B2')!.allSlugs;
  const overlap = [...b1Slugs].filter(s => b2Slugs.has(s)).length;
  const onlyB1 = [...b1Slugs].filter(s => !b2Slugs.has(s)).length;
  const onlyB2 = [...b2Slugs].filter(s => !b1Slugs.has(s)).length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  OVERLAP: ${overlap} shared | ${onlyB1} only in B1 | ${onlyB2} only in B2`);

  console.log(`\n  Serper calls: ${totalApiCalls} | Apify profiles: ${profiles.length}`);
  console.log('=== Done ===');
}

main().catch(console.error);
