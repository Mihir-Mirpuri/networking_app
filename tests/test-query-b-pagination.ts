/**
 * Query B pagination test: pages 2, 3, 4
 * Query: site:linkedin.com/in "New York" "McKinsey" "Stanford"
 *
 * Usage: npx tsx tests/test-query-b-pagination.ts
 */

import 'dotenv/config';
import { scrapeLinkedInProfiles, normalizeSchool } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const QUERY = 'site:linkedin.com/in "New York" "McKinsey" "Stanford"';

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

  console.log('=== Query B Pagination: Pages 2, 3, 4 ===');
  console.log(`Query: ${QUERY}\n`);

  // Fetch pages 2, 3, 4
  const pageResults: Map<number, SerperResult[]> = new Map();
  const allSlugs = new Set<string>();
  const allUrls: string[] = [];

  for (const page of [2, 3, 4]) {
    const results = await callSerper(QUERY, page);
    pageResults.set(page, results);
    const liCount = results.filter(r => r.link.includes('linkedin.com/in/')).length;
    console.log(`  Page ${page}: ${results.length} results, ${liCount} LinkedIn profiles`);

    for (const r of results) {
      const slug = extractSlug(r.link);
      if (slug && !allSlugs.has(slug)) {
        allSlugs.add(slug);
        const id = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1];
        if (id) allUrls.push(`https://www.linkedin.com/in/${id}`);
      }
    }
    await delay(400);
  }

  console.log(`\n  Unique profiles to scrape: ${allUrls.length}\n`);

  // Scrape all
  console.log('Scraping via Apify...\n');
  const profiles = await scrapeLinkedInProfiles(allUrls);

  // Build lookup
  const profileMap = new Map<string, typeof profiles[0]>();
  for (const p of profiles) {
    const slug = extractSlug(p.linkedinUrl);
    if (slug) profileMap.set(slug, p);
  }

  // Score each page
  for (const page of [2, 3, 4]) {
    const results = pageResults.get(page)!;
    let total = 0, matchC = 0, matchU = 0, matchL = 0, matchAll = 0;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  PAGE ${page}`);
    console.log('─'.repeat(70));
    console.log(`  ${'Name'.padEnd(28)} ${'Company'.padEnd(18)} ${'Location'.padEnd(22)} Match`);
    console.log('  ' + '─'.repeat(75));

    for (const r of results) {
      const slug = extractSlug(r.link);
      if (!slug) continue;
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

      const loc = [p.city, p.state].filter(Boolean).join(', ') || '(none)';
      const flags = `${hasC ? 'C' : ' '}${hasU ? 'U' : ' '}${hasL ? 'L' : ' '}`;
      const mark = (hasC && hasU && hasL) ? '✓' : '✗';

      console.log(
        `  ${mark} ${p.fullName.padEnd(26)} ${(p.company || '?').substring(0, 17).padEnd(18)} ${loc.substring(0, 21).padEnd(22)} [${flags}]`
      );
    }

    console.log(`\n  Page ${page} summary: ${total} profiles | Company: ${matchC} | Uni: ${matchU} | Location: ${matchL} (${total > 0 ? Math.round(matchL/total*100) : 0}%) | ALL: ${matchAll} (${total > 0 ? Math.round(matchAll/total*100) : 0}%)`);
  }

  console.log(`\n  Serper calls: ${totalApiCalls} | Apify profiles: ${profiles.length}`);
  console.log('=== Done ===');
}

main().catch(console.error);
