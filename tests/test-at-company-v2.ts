/**
 * Test: "McKinsey" vs "at McKinsey" (quoted) vs at McKinsey (unquoted)
 * Pages 1-4, DB-first lookup
 *
 * Usage: npx tsx tests/test-at-company-v2.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { scrapeLinkedInProfiles, normalizeSchool } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const prisma = new PrismaClient();

const QUERIES = [
  { id: 'A', name: '"McKinsey" (current)', query: 'site:linkedin.com/in "New York, New York" "McKinsey" "Stanford"' },
  { id: 'B', name: '"at McKinsey" (quoted)', query: 'site:linkedin.com/in "New York, New York" "at McKinsey" "Stanford"' },
  { id: 'C', name: 'at "McKinsey" (unquoted at)', query: 'site:linkedin.com/in "New York, New York" at "McKinsey" "Stanford"' },
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

  console.log('=== 3-Way Comparison: "McKinsey" vs "at McKinsey" vs at "McKinsey" ===\n');

  const slugMap = new Map<string, { url: string; queries: string[] }>();
  const queryPages = new Map<string, { pages: { page: number; slugs: Set<string> }[]; allSlugs: Set<string> }>();

  for (const q of QUERIES) {
    console.log(`${q.id}: ${q.name}`);
    console.log(`  ${q.query}`);
    const pages: { page: number; slugs: Set<string> }[] = [];
    const qSlugs = new Set<string>();

    for (let p = 1; p <= 4; p++) {
      const results = await callSerper(q.query, p);
      const pageSlugs = new Set<string>();
      for (const r of results) {
        const slug = extractSlug(r.link);
        if (!slug) continue;
        pageSlugs.add(slug);
        qSlugs.add(slug);
        const existing = slugMap.get(slug);
        if (existing) { if (!existing.queries.includes(q.id)) existing.queries.push(q.id); }
        else {
          const id = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1] || slug;
          slugMap.set(slug, { url: `https://www.linkedin.com/in/${id}`, queries: [q.id] });
        }
      }
      console.log(`  Page ${p}: ${pageSlugs.size} profiles`);
      pages.push({ page: p, slugs: pageSlugs });
      await delay(400);
    }
    console.log(`  Total unique: ${qSlugs.size}\n`);
    queryPages.set(q.id, { pages, allSlugs: qSlugs });
  }

  console.log(`Total unique across all 3: ${slugMap.size}`);

  // DB lookup
  console.log('\nChecking database...');
  const profileData = new Map<string, ProfileData>();
  const needsScraping: string[] = [];
  let dbHits = 0;

  for (const [slug, info] of slugMap) {
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

  console.log(`  DB hits: ${dbHits}/${slugMap.size} | Need scraping: ${needsScraping.length}`);

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

  // Score each
  const summaries: { id: string; name: string; total: number; matchAll: number; matchC: number; matchL: number }[] = [];

  for (const q of QUERIES) {
    const data = queryPages.get(q.id)!;
    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  ${q.id}: ${q.name}`);
    console.log('═'.repeat(75));

    for (const pg of data.pages) {
      let total = 0, matchAll = 0;
      for (const slug of pg.slugs) {
        const p = profileData.get(slug);
        if (!p) continue;
        total++;
        const hasC = p.company?.toLowerCase().includes('mckinsey') || p.experienceCompanies.some(c => c.toLowerCase().includes('mckinsey'));
        const hasU = p.schools.some(s => normalizeSchool(s).toLowerCase().includes('stanford'));
        const hasL = [p.city, p.state].some(l => l?.toLowerCase().includes('new york'));
        if (hasC && hasU && hasL) matchAll++;
      }
      console.log(`  Page ${pg.page}: ${total} profiles | All 3: ${matchAll}/${total} (${total > 0 ? Math.round(matchAll/total*100) : 0}%)`);
    }

    let total = 0, matchC = 0, matchU = 0, matchL = 0, matchAll = 0;
    console.log(`\n  ${'Name'.padEnd(28)} ${'Company'.padEnd(18)} ${'Location'.padEnd(22)} ${'Src'.padEnd(5)} Match`);
    console.log('  ' + '─'.repeat(80));

    for (const slug of data.allSlugs) {
      const p = profileData.get(slug);
      if (!p) continue;
      total++;
      const hasC = p.company?.toLowerCase().includes('mckinsey') || p.experienceCompanies.some(c => c.toLowerCase().includes('mckinsey'));
      const hasU = p.schools.some(s => normalizeSchool(s).toLowerCase().includes('stanford'));
      const hasL = [p.city, p.state].some(l => l?.toLowerCase().includes('new york'));
      if (hasC) matchC++;
      if (hasU) matchU++;
      if (hasL) matchL++;
      if (hasC && hasU && hasL) matchAll++;

      const mark = (hasC && hasU && hasL) ? '✓' : '✗';
      const loc = [p.city, p.state].filter(Boolean).join(', ') || '(none)';
      const flags = `${hasC ? 'C' : ' '}${hasU ? 'U' : ' '}${hasL ? 'L' : ' '}`;
      console.log(`  ${mark} ${p.fullName.padEnd(26)} ${(p.company || '?').substring(0, 17).padEnd(18)} ${loc.substring(0, 21).padEnd(22)} ${p.source.padEnd(5)} [${flags}]`);
    }

    console.log(`\n  TOTAL: ${total} | C: ${matchC} | U: ${matchU} | L: ${matchL} (${total > 0 ? Math.round(matchL/total*100) : 0}%) | All 3: ${matchAll} (${total > 0 ? Math.round(matchAll/total*100) : 0}%)`);
    summaries.push({ id: q.id, name: q.name, total, matchAll, matchC, matchL });
  }

  // Final comparison
  console.log(`\n${'═'.repeat(75)}`);
  console.log('  FINAL COMPARISON');
  console.log('═'.repeat(75));
  console.log(`  ${'Strategy'.padEnd(35)} Unique  All-3-Match  Rate`);
  console.log('  ' + '─'.repeat(60));
  for (const s of summaries) {
    console.log(`  ${(s.id + ': ' + s.name).padEnd(35)} ${String(s.total).padStart(4)}   ${String(s.matchAll).padStart(4)}         ${s.total > 0 ? Math.round(s.matchAll/s.total*100) : 0}%`);
  }

  console.log(`\n  Serper: ${totalApiCalls} | DB: ${dbHits} | Apify: ${needsScraping.length}`);
  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); });
