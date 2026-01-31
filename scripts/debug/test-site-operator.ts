/**
 * Deep dive on site:linkedin.com/in operator variations
 */

import 'dotenv/config';

const CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const CSE_CX = process.env.GOOGLE_CSE_CX || 'bf53ffdb484f145c5';

interface CSEResult {
  title: string;
  link: string;
  snippet: string;
}

interface CSEResponse {
  items?: CSEResult[];
  searchInformation?: {
    totalResults: string;
  };
}

async function searchCSE(query: string, start: number = 1): Promise<CSEResponse> {
  if (!CSE_API_KEY) throw new Error('CSE API key not configured');

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

interface Profile {
  name: string;
  url: string;
  title: string;
  snippet: string;
}

async function testQuery(name: string, query: string, pages: number = 5): Promise<{
  name: string;
  query: string;
  totalResults: number;
  profiles: Profile[];
  yield: number;
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log(`Query: ${query}`);
  console.log(`Pages: ${pages}`);

  const pageStarts = Array.from({ length: pages }, (_, i) => i * 10 + 1);
  let totalResults = 0;
  const profiles: Profile[] = [];
  let nonProfiles = 0;

  for (const startIndex of pageStarts) {
    try {
      const response = await searchCSE(query, startIndex);

      if (startIndex === 1 && response.searchInformation) {
        totalResults = parseInt(response.searchInformation.totalResults || '0');
        console.log(`Total available: ${totalResults.toLocaleString()}`);
      }

      if (!response.items || response.items.length === 0) {
        console.log(`Page ${Math.floor(startIndex / 10) + 1}: No results`);
        break;
      }

      let pageProfiles = 0;
      for (const item of response.items) {
        const isProfile = item.link.includes('linkedin.com/in/');
        if (isProfile) {
          const match = item.title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
          if (match) {
            profiles.push({
              name: match[1],
              url: item.link,
              title: item.title,
              snippet: item.snippet
            });
            pageProfiles++;
          }
        } else {
          nonProfiles++;
        }
      }
      console.log(`Page ${Math.floor(startIndex / 10) + 1}: ${pageProfiles} profiles`);

      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.log(`Error on page ${Math.floor(startIndex / 10) + 1}: ${error}`);
      break;
    }
  }

  const total = profiles.length + nonProfiles;
  const yieldPct = total > 0 ? (profiles.length / total) * 100 : 0;
  console.log(`\nResult: ${profiles.length} profiles, ${yieldPct.toFixed(1)}% yield`);

  return { name, query, totalResults, profiles, yield: yieldPct };
}

async function main() {
  console.log('='.repeat(80));
  console.log('SITE OPERATOR DEEP DIVE');
  console.log('='.repeat(80));

  const results: Awaited<ReturnType<typeof testQuery>>[] = [];

  // Test 1: Just company with site operator - how many results?
  results.push(await testQuery(
    'site + company only',
    'site:linkedin.com/in "McKinsey & Company"',
    9  // 90 results
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 2: Company + university
  results.push(await testQuery(
    'site + company + university',
    'site:linkedin.com/in "McKinsey & Company" "University of Texas at Austin"',
    9
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 3: Company + location
  results.push(await testQuery(
    'site + company + New York',
    'site:linkedin.com/in "McKinsey & Company" "New York"',
    9
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 4: Company + role variations
  results.push(await testQuery(
    'site + company + Associate',
    'site:linkedin.com/in "McKinsey & Company" Associate',
    9
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 5: Broad - just company, different name format
  results.push(await testQuery(
    'site + McKinsey (short name)',
    'site:linkedin.com/in "McKinsey"',
    9
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 6: Company + city in different format
  results.push(await testQuery(
    'site + company + NYC',
    'site:linkedin.com/in "McKinsey & Company" NYC',
    5
  ));

  await new Promise(r => setTimeout(r, 500));

  // Test 7: Very specific - all params
  results.push(await testQuery(
    'site + all params',
    'site:linkedin.com/in "McKinsey & Company" "University of Texas at Austin" "New York"',
    5
  ));

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\n| Query | Total Avail | Profiles Found | Yield |');
  console.log('|-------|-------------|----------------|-------|');

  for (const r of results) {
    console.log(`| ${r.name.padEnd(30)} | ${r.totalResults.toLocaleString().padStart(11)} | ${r.profiles.length.toString().padStart(14)} | ${r.yield.toFixed(1).padStart(5)}% |`);
  }

  // Show sample profiles from best query
  const best = results.reduce((a, b) => a.profiles.length > b.profiles.length ? a : b);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SAMPLE PROFILES FROM: ${best.name}`);
  console.log('='.repeat(80));

  best.profiles.slice(0, 20).forEach((p, i) => {
    console.log(`\n${i + 1}. ${p.name}`);
    console.log(`   URL: ${p.url}`);
    console.log(`   Title: ${p.title.substring(0, 80)}...`);
    console.log(`   Snippet: ${p.snippet.substring(0, 120)}...`);
  });
}

main().catch(console.error);
