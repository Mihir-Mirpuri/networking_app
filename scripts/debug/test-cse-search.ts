/**
 * Test script: runs Google Custom Search Engine with multiple query variations.
 * Compares results to find the best approach for matching browser results.
 *
 * Run: npx tsx scripts/test-cse-search.ts
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import path from 'path';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

// Multiple query variations to test
const QUERIES: Record<string, string> = {
  'A: Site filter + quoted terms':
    'site:linkedin.com/in/ "Goldman Sachs" "Investment Banking" "University of Texas at Austin" Houston',

  'B: Site filter + "current"':
    'site:linkedin.com/in/ current "Goldman Sachs" "Investment Banking Analyst" "University of Texas at Austin" Houston',

  'C: Site filter + comma-separated (browser style)':
    'site:linkedin.com/in/ Houston, Goldman Sachs, Investment Banking Analyst, University of Texas at Austin',

  'D: Site filter + Houston first + quoted':
    'site:linkedin.com/in/ Houston "Goldman Sachs" "Investment Banking Analyst" "University of Texas at Austin"',

  'E: Site filter + company first':
    'site:linkedin.com/in/ "Goldman Sachs" Houston "Investment Banking Analyst" "University of Texas at Austin"',
};

// Browser results for comparison (from user's screenshot)
const BROWSER_RESULTS = [
  'Devan Patel',
  'Yuki Ebashi',
  'Merritt Cozby',
  'Carter Kardesch',
  'Helena Putman',
  'Cameron Sando',
  'Michael Ma',
  'George Clark',
  'Emory Roberts',
  'Estefania Torralba',
];

const RESULTS_FILE = path.join(__dirname, 'cse-test-results.txt');

interface CSEResult {
  title: string;
  link: string;
  snippet?: string;
  displayLink?: string;
}

interface CSEResponse {
  items?: CSEResult[];
  searchInformation?: { totalResults?: string };
  error?: { code: number; message: string };
}

async function fetchPage(query: string): Promise<CSEResult[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY!);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('safe', 'off');
  url.searchParams.set('hl', 'en');

  const response = await fetch(url.toString());
  const data: CSEResponse = await response.json();

  if (data.error) {
    console.error('API error:', data.error.message);
    return [];
  }
  return data.items || [];
}

function extractName(title: string): string {
  // Extract name from LinkedIn title format "Name - Role at Company"
  const match = title.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/);
  return match ? match[1] : title.split(' - ')[0].trim();
}

function countBrowserMatches(results: CSEResult[]): { matches: string[]; count: number } {
  const matches: string[] = [];
  for (const result of results) {
    const name = extractName(result.title);
    for (const browserName of BROWSER_RESULTS) {
      if (name.toLowerCase().includes(browserName.toLowerCase().split(' ')[0]) &&
          name.toLowerCase().includes(browserName.toLowerCase().split(' ').slice(-1)[0])) {
        matches.push(browserName);
        break;
      }
    }
  }
  return { matches, count: matches.length };
}

function isDirectoryPage(result: CSEResult): boolean {
  return result.link.includes('/pub/dir/') ||
         result.title.includes('profiles -') ||
         result.title.includes('profiles |');
}

async function main() {
  if (!CSE_API_KEY) {
    console.error('Missing GOOGLE_CSE_API_KEY in .env');
    process.exit(1);
  }

  const lines: string[] = [
    '='.repeat(80),
    'CSE QUERY COMPARISON TEST',
    '='.repeat(80),
    '',
    'Browser results (target):',
    ...BROWSER_RESULTS.map((name, i) => `  ${i + 1}. ${name}`),
    '',
    'Params: gl=us, cr=countryUS, safe=off, hl=en',
    '',
  ];

  const summary: { query: string; matches: number; names: string[]; directoryPages: number }[] = [];

  for (const [label, query] of Object.entries(QUERIES)) {
    console.log(`Testing: ${label}`);

    // Rate limit between queries
    await new Promise(r => setTimeout(r, 500));

    const results = await fetchPage(query);
    const { matches, count } = countBrowserMatches(results);
    const directoryPages = results.filter(isDirectoryPage).length;

    summary.push({ query: label, matches: count, names: matches, directoryPages });

    lines.push('='.repeat(80));
    lines.push(`QUERY ${label}`);
    lines.push('='.repeat(80));
    lines.push(`Query: ${query}`);
    lines.push(`Results: ${results.length} | Browser matches: ${count}/10 | Directory pages: ${directoryPages}`);
    lines.push(`Matched: ${matches.join(', ') || '(none)'}`);
    lines.push('');

    results.forEach((item, i) => {
      const name = extractName(item.title);
      const isMatch = matches.some(m =>
        name.toLowerCase().includes(m.toLowerCase().split(' ')[0]) &&
        name.toLowerCase().includes(m.toLowerCase().split(' ').slice(-1)[0])
      );
      const isDir = isDirectoryPage(item);
      const marker = isMatch ? '✅' : isDir ? '❌ DIR' : '  ';
      lines.push(`${marker} [${i + 1}] ${item.title}`);
      lines.push(`       ${item.link}`);
    });
    lines.push('');
  }

  // Summary comparison
  lines.push('='.repeat(80));
  lines.push('SUMMARY - RANKED BY BROWSER MATCHES');
  lines.push('='.repeat(80));
  lines.push('');

  summary.sort((a, b) => b.matches - a.matches || a.directoryPages - b.directoryPages);

  for (const s of summary) {
    const score = `${s.matches}/10 matches, ${s.directoryPages} dir pages`;
    lines.push(`${s.query}`);
    lines.push(`  Score: ${score}`);
    lines.push(`  Matched: ${s.names.join(', ') || '(none)'}`);
    lines.push('');
  }

  const output = lines.join('\n');
  writeFileSync(RESULTS_FILE, output, 'utf-8');
  console.log('\nResults written to', RESULTS_FILE);

  // Print summary to console
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  for (const s of summary) {
    console.log(`${s.query}: ${s.matches}/10 matches`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
