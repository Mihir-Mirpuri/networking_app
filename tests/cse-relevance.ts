/**
 * Analyze CSE results for relevance to search criteria.
 * Uses metatags + title + snippet to check if each result actually matches company + role.
 *
 * Usage: npx tsx tests/cse-relevance.ts
 */

import 'dotenv/config';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  pagemap?: {
    metatags?: Array<{
      'profile:first_name'?: string;
      'profile:last_name'?: string;
      'og:description'?: string;
    }>;
  };
}

async function searchCSE(query: string): Promise<CSEResult[]> {
  if (!CSE_API_KEY) throw new Error('GOOGLE_CSE_API_KEY not set');

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');

  const response = await fetch(url.toString());
  if (!response.ok) {
    console.error('CSE error:', response.status, await response.text());
    return [];
  }
  const data = await response.json();
  return data.items || [];
}

function isLinkedInProfile(url: string): boolean {
  return url.includes('linkedin.com/in/');
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

    const results = await searchCSE(query);
    const profiles = results.filter(r => isLinkedInProfile(r.link));

    let matchCount = 0;
    let companyOnlyCount = 0;
    let roleOnlyCount = 0;
    let noMatchCount = 0;

    for (const r of profiles) {
      const metatags = r.pagemap?.metatags?.[0];
      const name = metatags?.['profile:first_name'] && metatags?.['profile:last_name']
        ? `${metatags['profile:first_name']} ${metatags['profile:last_name']}`
        : null;
      const ogDesc = metatags?.['og:description'] || '';

      const titleLower = r.title.toLowerCase();
      const snippetLower = (r.snippet || '').toLowerCase();
      const ogDescLower = ogDesc.toLowerCase();
      const companyLower = company.toLowerCase();

      // Check company match across title, snippet, and og:description
      const companyMatch = titleLower.includes(companyLower)
        || snippetLower.includes(companyLower)
        || ogDescLower.includes(companyLower);

      // Check role match — each word in the role must appear somewhere
      const roleWords = role.toLowerCase().split(' ');
      const allText = `${titleLower} ${snippetLower} ${ogDescLower}`;
      const roleMatch = roleWords.every(w => allText.includes(w));

      const fullMatch = companyMatch && roleMatch;

      if (fullMatch) matchCount++;
      else if (companyMatch) companyOnlyCount++;
      else if (roleMatch) roleOnlyCount++;
      else noMatchCount++;

      const status = fullMatch ? 'MATCH' : companyMatch ? 'COMPANY ONLY' : roleMatch ? 'ROLE ONLY' : 'NO MATCH';

      console.log(`\n  [${status}] ${name || '(no name from metatags)'}`);
      console.log(`    Title:   ${r.title}`);
      console.log(`    Snippet: ${(r.snippet || '').substring(0, 150)}`);
      console.log(`    og:desc: ${ogDesc.substring(0, 150)}`);
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
