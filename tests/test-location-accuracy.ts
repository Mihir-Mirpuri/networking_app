/**
 * Location Accuracy Test: Which query variation gets the best location hit rate?
 *
 * All queries target: McKinsey + Stanford + New York
 * We scrape all unique profiles across all variations, then check location match.
 *
 * Usage: npx tsx tests/test-location-accuracy.ts
 */

import 'dotenv/config';
import { scrapeLinkedInProfiles, normalizeSchool } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── Query Variations ────────────────────────────────────────────────────────

const QUERIES = [
  {
    id: 'A',
    name: 'Your original query',
    query: 'site:linkedin.com/in "at McKinsey" "New York" "Stanford"',
  },
  {
    id: 'B',
    name: '"New York" before company',
    query: 'site:linkedin.com/in "New York" "McKinsey" "Stanford"',
  },
  {
    id: 'C',
    name: 'Location as "New York, New York"',
    query: 'site:linkedin.com/in "McKinsey" "Stanford" "New York, New York"',
  },
  {
    id: 'D',
    name: '"Greater New York"',
    query: 'site:linkedin.com/in "McKinsey" "Stanford" "Greater New York"',
  },
  {
    id: 'E',
    name: '"Location: New York"',
    query: 'site:linkedin.com/in "McKinsey" "Stanford" "Location: New York"',
  },
  {
    id: 'F',
    name: 'NYC instead of New York',
    query: 'site:linkedin.com/in "McKinsey" "Stanford" "NYC"',
  },
  {
    id: 'G',
    name: '"New York" + "Experience" pattern',
    query: 'site:linkedin.com/in "Experience" "McKinsey" "Stanford" "New York"',
  },
  {
    id: 'H',
    name: '"New York, New York, United States"',
    query: 'site:linkedin.com/in "McKinsey" "Stanford" "New York, New York, United States"',
  },
];

// ── Serper ───────────────────────────────────────────────────────────────────

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
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
  if (!res.ok) return [];
  const data = await res.json();
  return (data.organic || []);
}

function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SERPER_API_KEY) { console.error('SERPER_API_KEY not set'); process.exit(1); }

  console.log('=== Location Accuracy: Query Variation Test ===');
  console.log('Target: McKinsey + Stanford + New York\n');

  // Step 1: Run all queries, collect URLs per strategy
  const strategyResults = new Map<string, { name: string; slugs: Set<string>; urls: Map<string, string> }>();
  const allUrls = new Map<string, string>(); // slug → full URL
  const slugToStrategies = new Map<string, string[]>(); // slug → which strategies found it

  for (const q of QUERIES) {
    console.log(`  ${q.id}: ${q.name}`);
    console.log(`     ${q.query}`);

    const results = await callSerper(q.query);
    const slugs = new Set<string>();
    const urls = new Map<string, string>();

    for (const r of results) {
      const slug = extractSlug(r.link);
      if (!slug) continue;
      slugs.add(slug);
      const fullUrl = `https://www.linkedin.com/in/${r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1]}`;
      urls.set(slug, fullUrl);
      allUrls.set(slug, fullUrl);

      const existing = slugToStrategies.get(slug) || [];
      existing.push(q.id);
      slugToStrategies.set(slug, existing);
    }

    console.log(`     LinkedIn profiles: ${slugs.size}\n`);
    strategyResults.set(q.id, { name: q.name, slugs, urls });
    await delay(400);
  }

  console.log(`\nTotal unique profiles across all queries: ${allUrls.size}`);

  // Step 2: Scrape all unique profiles
  console.log('\nScraping all profiles via Apify...\n');
  const urlList = [...allUrls.values()];
  const profiles = await scrapeLinkedInProfiles(urlList);
  console.log(`\nScraped: ${profiles.length}/${urlList.length}\n`);

  // Build slug → profile map
  const profileMap = new Map<string, typeof profiles[0]>();
  for (const p of profiles) {
    const slug = extractSlug(p.linkedinUrl);
    if (slug) profileMap.set(slug, p);
  }

  // Step 3: Score each strategy
  console.log('═'.repeat(80));
  console.log('  RESULTS BY STRATEGY');
  console.log('═'.repeat(80));

  for (const q of QUERIES) {
    const entry = strategyResults.get(q.id)!;
    let total = 0, matchCompany = 0, matchUni = 0, matchLoc = 0, matchAll = 0;

    for (const slug of entry.slugs) {
      const p = profileMap.get(slug);
      if (!p) continue;
      total++;

      const hasCompany = p.company?.toLowerCase().includes('mckinsey') ||
        p.experienceHistory.some(e => e.companyName?.toLowerCase().includes('mckinsey'));
      const hasUni = p.schools.some(s => {
        const norm = normalizeSchool(s).toLowerCase();
        return norm.includes('stanford');
      });
      const hasLoc = [p.city, p.state].some(l =>
        l?.toLowerCase().includes('new york')
      );

      if (hasCompany) matchCompany++;
      if (hasUni) matchUni++;
      if (hasLoc) matchLoc++;
      if (hasCompany && hasUni && hasLoc) matchAll++;
    }

    console.log(`\n  ${q.id}: ${q.name}`);
    console.log(`     Profiles: ${total}  Company: ${matchCompany}  Uni: ${matchUni}  Location: ${matchLoc}  ALL 3: ${matchAll}`);
    console.log(`     Location hit rate: ${total > 0 ? Math.round((matchLoc / total) * 100) : 0}%  |  Full match rate: ${total > 0 ? Math.round((matchAll / total) * 100) : 0}%`);
  }

  // Step 4: Show per-person detail for best and worst
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  ALL SCRAPED PROFILES');
  console.log('─'.repeat(80));
  console.log(`  ${'Name'.padEnd(28)} ${'Company'.padEnd(18)} ${'Location'.padEnd(22)} ${'Found by'.padEnd(12)} Match`);
  console.log('  ' + '─'.repeat(85));

  for (const [slug, profile] of profileMap) {
    const hasC = profile.company?.toLowerCase().includes('mckinsey') ||
      profile.experienceHistory.some(e => e.companyName?.toLowerCase().includes('mckinsey'));
    const hasU = profile.schools.some(s => normalizeSchool(s).toLowerCase().includes('stanford'));
    const hasL = [profile.city, profile.state].some(l => l?.toLowerCase().includes('new york'));
    const allMatch = hasC && hasU && hasL;
    const flags = `${hasC ? 'C' : ' '}${hasU ? 'U' : ' '}${hasL ? 'L' : ' '}`;
    const loc = [profile.city, profile.state].filter(Boolean).join(', ') || '(none)';
    const foundBy = (slugToStrategies.get(slug) || []).join(',');

    console.log(
      `  ${allMatch ? '✓' : '✗'} ${profile.fullName.padEnd(26)} ${(profile.company || '?').substring(0, 17).padEnd(18)} ${loc.substring(0, 21).padEnd(22)} ${foundBy.padEnd(12)} [${flags}]`
    );
  }

  console.log(`\n  Serper calls: ${totalApiCalls} | Apify profiles: ${profiles.length}`);
  console.log('=== Done ===');
}

main().catch(console.error);
