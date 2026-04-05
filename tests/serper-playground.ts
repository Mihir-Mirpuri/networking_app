/**
 * Serper Playground — interactive CLI to test LinkedIn search queries
 *
 * Usage: npx tsx tests/serper-playground.ts
 *
 * Type any query and see results. The tool auto-prepends "site:linkedin.com/in"
 * unless your query already contains "linkedin".
 *
 * Examples:
 *   "Stripe" Software Engineer
 *   "Goldman Sachs" Analyst "New York"
 *   "McKinsey" "Stanford University"
 *   site:linkedin.com/in "at Retool"       (custom query, no auto-prefix)
 *
 * Commands:
 *   !raw <query>   — show full raw JSON response
 *   !page2          — fetch page 2 of last query
 *   !page3          — fetch page 3 of last query
 *   exit            — quit
 */

import 'dotenv/config';
import * as readline from 'readline';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
let totalCalls = 0;
let lastQuery = '';

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

async function callSerper(query: string, page: number = 1): Promise<{ organic: SerperResult[]; raw: Record<string, unknown> }> {
  totalCalls++;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });

  if (!res.ok) {
    console.error(`  API error: ${res.status} ${await res.text()}`);
    return { organic: [], raw: {} };
  }

  const data = await res.json();
  const organic = (data.organic || []).map((r: SerperResult) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    position: r.position,
  }));

  return { organic, raw: data };
}

function displayResults(results: SerperResult[], query: string) {
  const linkedinResults = results.filter(r => r.link.includes('linkedin.com/in/'));
  const otherResults = results.filter(r => !r.link.includes('linkedin.com/in/'));

  console.log(`\n  Query: ${query}`);
  console.log(`  Results: ${results.length} total | ${linkedinResults.length} LinkedIn profiles | ${otherResults.length} other\n`);

  if (linkedinResults.length > 0) {
    console.log('  LinkedIn Profiles:');
    console.log('  ' + '─'.repeat(75));
    for (const r of linkedinResults) {
      const name = r.title.split(/\s*[-–—|]\s*/)[0].trim();
      const titlePart = r.title.split(/\s*[-–—]\s*/).slice(1, -1).join(' - ').trim();
      const slug = r.link.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/)?.[1] || '';

      console.log(`  ${String(r.position).padStart(2)}. ${name}`);
      if (titlePart) console.log(`      ${titlePart}`);
      console.log(`      linkedin.com/in/${slug}`);

      // Show relevant snippet info
      const snippetShort = (r.snippet || '').replace(/\n/g, ' ').substring(0, 120);
      if (snippetShort) console.log(`      "${snippetShort}"`);
      console.log('');
    }
  }

  if (otherResults.length > 0) {
    console.log('  Other (non-profile) results:');
    console.log('  ' + '─'.repeat(75));
    for (const r of otherResults) {
      console.log(`  ${String(r.position).padStart(2)}. ${r.title.substring(0, 70)}`);
      console.log(`      ${r.link}`);
      console.log('');
    }
  }
}

async function main() {
  if (!SERPER_API_KEY) {
    console.error('ERROR: SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Serper Playground — Test LinkedIn Search Queries           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Type a query. "site:linkedin.com/in" is auto-added.       ║');
  console.log('║                                                            ║');
  console.log('║  Examples:                                                 ║');
  console.log('║    "Stripe" Software Engineer                              ║');
  console.log('║    "Goldman Sachs" "New York" Analyst                      ║');
  console.log('║    "McKinsey" "Stanford University"                        ║');
  console.log('║                                                            ║');
  console.log('║  Commands:                                                 ║');
  console.log('║    !raw <query>  — show full raw JSON                      ║');
  console.log('║    !page2        — page 2 of last query                    ║');
  console.log('║    !page3        — page 3 of last query                    ║');
  console.log('║    exit          — quit                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(`[${totalCalls} calls] > `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) { prompt(); return; }
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log(`\nTotal Serper calls: ${totalCalls} (~$${(totalCalls * 0.001).toFixed(3)})`);
        rl.close();
        return;
      }

      // Page commands
      if (trimmed === '!page2' || trimmed === '!page3') {
        if (!lastQuery) {
          console.log('  No previous query. Run a search first.');
          prompt(); return;
        }
        const page = trimmed === '!page2' ? 2 : 3;
        const { organic } = await callSerper(lastQuery, page);
        displayResults(organic, `${lastQuery} (page ${page})`);
        prompt(); return;
      }

      // Raw mode
      if (trimmed.startsWith('!raw ')) {
        const q = trimmed.slice(5).trim();
        const fullQuery = q.toLowerCase().includes('linkedin') ? q : `site:linkedin.com/in ${q}`;
        lastQuery = fullQuery;
        const { raw } = await callSerper(fullQuery);
        console.log(JSON.stringify(raw, null, 2));
        prompt(); return;
      }

      // Normal search
      const query = trimmed.toLowerCase().includes('linkedin') ? trimmed : `site:linkedin.com/in ${trimmed}`;
      lastQuery = query;
      const { organic } = await callSerper(query);
      displayResults(organic, query);
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
