/**
 * Test Serper query variations: abbreviated vs full university names
 * and the impact of including university in the query at all.
 *
 * Usage: npx tsx tests/test-serper-queries.ts
 */

import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

async function searchSerper(query: string): Promise<SerperResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10, page: 1, gl: 'us', hl: 'en' }),
  });

  if (!response.ok) {
    console.error(`  API error: ${response.status}`);
    return [];
  }

  const data = await response.json();
  return (data.organic || []).map((r: SerperResult) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    position: r.position,
  }));
}

async function testQuery(label: string, query: string) {
  const results = await searchSerper(query);
  const linkedInProfiles = results.filter(r => r.link.includes('linkedin.com/in/'));
  console.log(`\n[${label}]`);
  console.log(`  Query: ${query}`);
  console.log(`  Total: ${results.length} | LinkedIn profiles: ${linkedInProfiles.length}`);
  for (const r of linkedInProfiles.slice(0, 5)) {
    const titleShort = r.title.replace(/\s*\|\s*LinkedIn.*$/, '').substring(0, 70);
    const snippetShort = r.snippet.substring(0, 100);
    console.log(`    - ${titleShort}`);
    console.log(`      ${snippetShort}`);
  }
  return linkedInProfiles.length;
}

async function main() {
  if (!SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set');
    process.exit(1);
  }

  console.log('=== University Abbreviation vs Full Name in Serper Queries ===\n');

  const results: { label: string; count: number }[] = [];

  // --- Bank of America + MIT ---
  console.log('\n--- BANK OF AMERICA + MIT ---');

  results.push({ label: 'BofA + "MIT" + Banker', count: await testQuery(
    'BofA + MIT abbreviated',
    'site:linkedin.com/in "at Bank of America" "MIT" Banker'
  )});

  results.push({ label: 'BofA + "Massachusetts Institute of Technology" + Banker', count: await testQuery(
    'BofA + MIT full name',
    'site:linkedin.com/in "at Bank of America" "Massachusetts Institute of Technology" Banker'
  )});

  results.push({ label: 'BofA + Banker (no university)', count: await testQuery(
    'BofA + Banker only',
    'site:linkedin.com/in "at Bank of America" Banker'
  )});

  results.push({ label: 'BofA + "MIT" (no role)', count: await testQuery(
    'BofA + MIT, no role',
    'site:linkedin.com/in "at Bank of America" "MIT"'
  )});

  results.push({ label: 'BofA + "Massachusetts Institute of Technology" (no role)', count: await testQuery(
    'BofA + MIT full, no role',
    'site:linkedin.com/in "at Bank of America" "Massachusetts Institute of Technology"'
  )});

  // --- Goldman Sachs + UT Austin ---
  console.log('\n\n--- GOLDMAN SACHS + UT AUSTIN ---');

  results.push({ label: 'GS + "UT Austin" + Analyst', count: await testQuery(
    'GS + UT Austin abbreviated',
    'site:linkedin.com/in "at Goldman Sachs" "UT Austin" Analyst'
  )});

  results.push({ label: 'GS + "University of Texas at Austin" + Analyst', count: await testQuery(
    'GS + UT Austin full name',
    'site:linkedin.com/in "at Goldman Sachs" "University of Texas at Austin" Analyst'
  )});

  results.push({ label: 'GS + Analyst (no university)', count: await testQuery(
    'GS + Analyst only',
    'site:linkedin.com/in "at Goldman Sachs" Analyst'
  )});

  // --- Google + Stanford ---
  console.log('\n\n--- GOOGLE + STANFORD ---');

  results.push({ label: 'Google + "Stanford" + SWE', count: await testQuery(
    'Google + Stanford',
    'site:linkedin.com/in "at Google" "Stanford" Software Engineer'
  )});

  results.push({ label: 'Google + "Stanford University" + SWE', count: await testQuery(
    'Google + Stanford University',
    'site:linkedin.com/in "at Google" "Stanford University" Software Engineer'
  )});

  results.push({ label: 'Google + SWE (no university)', count: await testQuery(
    'Google + SWE only',
    'site:linkedin.com/in "at Google" Software Engineer'
  )});

  // Summary
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`${'Query'.padEnd(55)} | Profiles`);
  console.log(`${'-'.repeat(55)}-+-${'-'.repeat(8)}`);
  for (const r of results) {
    console.log(`${r.label.padEnd(55)} | ${r.count}`);
  }
}

main().catch(console.error);
