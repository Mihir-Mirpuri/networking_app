/**
 * Analyze Serper results for relevance to search criteria.
 * Parses title + snippet to check if each result actually matches company + role.
 *
 * Usage: npx tsx tests/serper-relevance.ts
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
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY not set');

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' }),
  });
  const data = await response.json();
  return data.organic || [];
}

function isLinkedInProfile(url: string): boolean {
  return url.includes('linkedin.com/in/');
}

function parseTitle(title: string): { name: string | null; roleCompany: string | null } {
  const m = title.match(/^(.+?)\s*[-–]\s*(.+?)\s*[|]\s*LinkedIn/i);
  if (m) return { name: m[1].trim(), roleCompany: m[2].trim() };
  const m2 = title.match(/^(.+?)\s*[|]\s*LinkedIn/i);
  if (m2) return { name: m2[1].trim(), roleCompany: null };
  return { name: null, roleCompany: null };
}

async function main() {
  const queries = [
    { company: 'Goldman Sachs', role: 'investment banking analyst' },
    { company: 'McKinsey', role: 'business analyst' },
    { company: 'JPMorgan', role: 'analyst' },
  ];

  for (const { company, role } of queries) {
    const query = `site:linkedin.com/in "${company}" ${role}`;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Query: ${query}`);
    console.log(`${'='.repeat(80)}`);

    const results = await searchSerper(query);
    const profiles = results.filter(r => isLinkedInProfile(r.link));

    let matchCount = 0;
    let companyOnlyCount = 0;
    let roleOnlyCount = 0;
    let noMatchCount = 0;

    for (const r of profiles) {
      const { name } = parseTitle(r.title);

      const titleLower = r.title.toLowerCase();
      const snippetLower = (r.snippet || '').toLowerCase();
      const companyLower = company.toLowerCase();

      // Check company match
      const companyMatch = titleLower.includes(companyLower) || snippetLower.includes(companyLower);

      // Check role match — each word in the role must appear in title or snippet
      const roleWords = role.toLowerCase().split(' ');
      const roleInTitle = roleWords.every(w => titleLower.includes(w));
      const roleInSnippet = roleWords.every(w => snippetLower.includes(w));
      const roleMatch = roleInTitle || roleInSnippet;

      const fullMatch = companyMatch && roleMatch;

      if (fullMatch) matchCount++;
      else if (companyMatch) companyOnlyCount++;
      else if (roleMatch) roleOnlyCount++;
      else noMatchCount++;

      const status = fullMatch ? 'MATCH' : companyMatch ? 'COMPANY ONLY' : roleMatch ? 'ROLE ONLY' : 'NO MATCH';

      console.log(`\n  [${status}] ${name || '(no name)'}`);
      console.log(`    Title:   ${r.title}`);
      console.log(`    Snippet: ${(r.snippet || '').substring(0, 150)}`);
      console.log(`    URL:     ${r.link}`);
    }

    console.log(`\n  ${'─'.repeat(60)}`);
    console.log(`  MATCH (company + role): ${matchCount}/${profiles.length}`);
    console.log(`  Company only:           ${companyOnlyCount}/${profiles.length}`);
    console.log(`  Role only:              ${roleOnlyCount}/${profiles.length}`);
    console.log(`  No match:               ${noMatchCount}/${profiles.length}`);
  }
}

main().catch(console.error);
