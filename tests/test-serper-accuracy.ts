/**
 * Serper Accuracy Test: How many Serper results are actually valid?
 *
 * Takes a Serper query, fetches 3 pages of results, scrapes all LinkedIn
 * profiles via Apify, then checks how many actually match the search criteria.
 *
 * Usage: npx tsx tests/test-serper-accuracy.ts
 */

import 'dotenv/config';
import { scrapeLinkedInProfiles, normalizeSchool } from '../src/lib/services/linkedin-scraper';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ── Search criteria to validate against ─────────────────────────────────────

const SEARCH = {
  query: 'site:linkedin.com/in "McKinsey" "Stanford University"',
  criteria: {
    company: 'McKinsey',
    university: 'Stanford University',
    location: 'New York',
  },
  pages: 3,
};

// ── Serper ───────────────────────────────────────────────────────────────────

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

async function callSerper(query: string, page: number): Promise<SerperResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });

  if (!res.ok) {
    console.error(`[Serper] HTTP ${res.status}`);
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

// ── Validation ──────────────────────────────────────────────────────────────

function matchesCompany(profile: { company: string | null; experienceHistory: Array<{ companyName: string | null }> }, target: string): boolean {
  const t = target.toLowerCase();
  // Check current company
  if (profile.company?.toLowerCase().includes(t)) return true;
  // Check all experience
  return profile.experienceHistory.some(e => e.companyName?.toLowerCase().includes(t));
}

function matchesUniversity(schools: string[], target: string): boolean {
  const normalized = normalizeSchool(target).toLowerCase();
  return schools.some(s => s.toLowerCase().includes(normalized) || normalized.includes(s.toLowerCase()));
}

function matchesLocation(profile: { city: string | null; state: string | null }, target: string): boolean {
  const t = target.toLowerCase();
  if (profile.city?.toLowerCase().includes(t)) return true;
  if (profile.state?.toLowerCase().includes(t)) return true;
  // "New York" could match city or state
  return false;
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

  console.log('=== Serper → Apify Accuracy Test ===');
  console.log(`Query: ${SEARCH.query}`);
  console.log(`Criteria: company="${SEARCH.criteria.company}" uni="${SEARCH.criteria.university}" loc="${SEARCH.criteria.location}"`);
  console.log(`Pages: ${SEARCH.pages}\n`);

  // Step 1: Fetch all Serper results
  console.log('1. Fetching Serper results...');
  const allResults: SerperResult[] = [];
  for (let p = 1; p <= SEARCH.pages; p++) {
    const results = await callSerper(SEARCH.query, p);
    console.log(`   Page ${p}: ${results.length} results`);
    allResults.push(...results);
    if (p < SEARCH.pages) await delay(400);
  }

  // Deduplicate LinkedIn URLs
  const seenSlugs = new Set<string>();
  const linkedinUrls: string[] = [];
  for (const r of allResults) {
    const match = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
    if (!match) continue;
    const slug = match[1].toLowerCase();
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    // Normalize URL
    linkedinUrls.push(`https://www.linkedin.com/in/${match[1]}`);
  }

  console.log(`\n   Total unique LinkedIn profiles: ${linkedinUrls.length}\n`);

  // Step 2: Scrape via Apify
  console.log('2. Scraping profiles via Apify...\n');
  const profiles = await scrapeLinkedInProfiles(linkedinUrls);
  console.log(`\n   Successfully scraped: ${profiles.length}/${linkedinUrls.length}\n`);

  // Step 3: Validate each profile
  console.log('3. Validating against criteria...\n');

  let matchAll = 0;
  let matchCompany = 0;
  let matchUni = 0;
  let matchLoc = 0;
  let matchCompanyAndUni = 0;
  let matchCompanyAndLoc = 0;

  console.log('   ' + '─'.repeat(95));
  console.log(
    `   ${'Name'.padEnd(25)} ${'Company'.padEnd(20)} ${'Schools'.padEnd(25)} ${'Location'.padEnd(20)} Match`
  );
  console.log('   ' + '─'.repeat(95));

  for (const p of profiles) {
    const hasCompany = matchesCompany(p, SEARCH.criteria.company);
    const hasUni = matchesUniversity(p.schools, SEARCH.criteria.university);
    const hasLoc = matchesLocation(p, SEARCH.criteria.location);

    if (hasCompany) matchCompany++;
    if (hasUni) matchUni++;
    if (hasLoc) matchLoc++;
    if (hasCompany && hasUni) matchCompanyAndUni++;
    if (hasCompany && hasLoc) matchCompanyAndLoc++;
    if (hasCompany && hasUni && hasLoc) matchAll++;

    const flags = [
      hasCompany ? 'C' : ' ',
      hasUni ? 'U' : ' ',
      hasLoc ? 'L' : ' ',
    ].join('');

    const allMatch = hasCompany && hasUni && hasLoc;
    const schoolsStr = p.schools.slice(0, 2).join(', ') || '(none)';
    const locStr = [p.city, p.state].filter(Boolean).join(', ') || '(none)';

    console.log(
      `   ${allMatch ? '✓' : '✗'} ${p.fullName.padEnd(23)} ${(p.company || '(none)').padEnd(20)} ${schoolsStr.padEnd(25).substring(0, 25)} ${locStr.padEnd(20).substring(0, 20)} [${flags}]`
    );
  }

  // Step 4: Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  ACCURACY SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  Serper returned:         ${linkedinUrls.length} unique LinkedIn profiles`);
  console.log(`  Successfully scraped:    ${profiles.length}`);
  console.log(`  Match ALL 3 criteria:    ${matchAll}/${profiles.length} (${pct(matchAll, profiles.length)})`);
  console.log(`  Match company:           ${matchCompany}/${profiles.length} (${pct(matchCompany, profiles.length)})`);
  console.log(`  Match university:        ${matchUni}/${profiles.length} (${pct(matchUni, profiles.length)})`);
  console.log(`  Match location:          ${matchLoc}/${profiles.length} (${pct(matchLoc, profiles.length)})`);
  console.log(`  Match company+uni:       ${matchCompanyAndUni}/${profiles.length} (${pct(matchCompanyAndUni, profiles.length)})`);
  console.log(`  Match company+loc:       ${matchCompanyAndLoc}/${profiles.length} (${pct(matchCompanyAndLoc, profiles.length)})`);

  console.log(`\n  Serper API calls: ${SEARCH.pages}`);
  console.log(`  Apify profiles scraped: ${profiles.length}`);
  console.log('\n=== Test Complete ===');
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
}

main().catch(console.error);
