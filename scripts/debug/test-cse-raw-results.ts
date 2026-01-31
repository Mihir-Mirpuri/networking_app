/**
 * Test script to see raw CSE API results for a query
 */

import 'dotenv/config';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface CSEResponse {
  items?: CSEResult[];
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  queries?: {
    request?: Array<{ searchTerms: string }>;
  };
}

async function searchCSE(query: string, start: number = 1): Promise<CSEResponse> {
  if (!CSE_API_KEY) {
    throw new Error('CSE API key not configured');
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_API_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('cr', 'countryUS');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('start', start.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CSE API error: ${response.status} - ${text}`);
  }
  return response.json();
}

async function main() {
  // Build query for the user's parameters
  const company = 'McKinsey & Company';
  const role = 'Consulting Associate';
  const university = 'University of Texas at Austin';
  const location = 'New York';

  // Query format: quoted company and university, unquoted role and location
  const query = `"${company}" "${university}" ${role} ${location}`;

  console.log('='.repeat(80));
  console.log('CSE RAW RESULTS TEST');
  console.log('='.repeat(80));
  console.log(`\nQuery: ${query}\n`);

  const pages = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91]; // 10 pages
  let totalLinkedInProfiles = 0;
  let totalResults = 0;

  for (const startIndex of pages) {
    const pageNum = Math.floor((startIndex - 1) / 10) + 1;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`PAGE ${pageNum} (start=${startIndex})`);
    console.log('='.repeat(80));

    try {
      const response = await searchCSE(query, startIndex);

      if (pageNum === 1 && response.searchInformation) {
        console.log(`\nTotal results: ${response.searchInformation.totalResults}`);
        console.log(`Search time: ${response.searchInformation.searchTime}s`);
      }

      if (!response.items || response.items.length === 0) {
        console.log('\n[No results on this page]');
        continue;
      }

      console.log(`\nResults: ${response.items.length}`);

      for (let i = 0; i < response.items.length; i++) {
        const item = response.items[i];
        const resultNum = startIndex + i;
        const isLinkedIn = item.link.includes('linkedin.com/in/');

        if (isLinkedIn) totalLinkedInProfiles++;
        totalResults++;

        console.log(`\n--- Result ${resultNum} ${isLinkedIn ? '✓ LinkedIn' : '✗ Not LinkedIn'} ---`);
        console.log(`Title: ${item.title}`);
        console.log(`URL: ${item.link}`);
        console.log(`Domain: ${item.displayLink}`);
        console.log(`Snippet: ${item.snippet?.substring(0, 200)}${item.snippet?.length > 200 ? '...' : ''}`);
      }

      // Rate limit between pages
      await new Promise(r => setTimeout(r, 250));

    } catch (error) {
      console.log(`\n[Error fetching page ${pageNum}]: ${error}`);
      break;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total results fetched: ${totalResults}`);
  console.log(`LinkedIn profiles: ${totalLinkedInProfiles}`);
  console.log(`Non-LinkedIn results: ${totalResults - totalLinkedInProfiles}`);
}

main().catch(console.error);
