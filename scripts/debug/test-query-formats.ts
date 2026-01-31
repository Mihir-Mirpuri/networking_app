/**
 * Test different CSE query formats to maximize LinkedIn profile yield
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

async function testQuery(name: string, query: string): Promise<{
  name: string;
  query: string;
  totalResults: number;
  linkedInProfiles: number;
  nonProfiles: number;
  profiles: string[];
}> {
  console.log(`\nTesting: ${name}`);
  console.log(`Query: ${query}`);

  const pages = [1, 11, 21]; // Just 3 pages (30 results) for faster testing
  let linkedInProfiles = 0;
  let nonProfiles = 0;
  let totalResults = 0;
  const profiles: string[] = [];

  for (const startIndex of pages) {
    try {
      const response = await searchCSE(query, startIndex);

      if (startIndex === 1 && response.searchInformation) {
        totalResults = parseInt(response.searchInformation.totalResults || '0');
      }

      if (!response.items) continue;

      for (const item of response.items) {
        const isProfile = item.link.includes('linkedin.com/in/');
        if (isProfile) {
          linkedInProfiles++;
          // Extract name from title
          const match = item.title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[-–|]/);
          if (match) {
            profiles.push(`${match[1]} - ${item.link}`);
          }
        } else {
          nonProfiles++;
        }
      }

      await new Promise(r => setTimeout(r, 250));
    } catch (error) {
      console.log(`Error: ${error}`);
      break;
    }
  }

  const yieldPct = ((linkedInProfiles / (linkedInProfiles + nonProfiles)) * 100).toFixed(1);
  console.log(`  Results: ${linkedInProfiles} profiles / ${linkedInProfiles + nonProfiles} total (${yieldPct}% yield)`);

  return { name, query, totalResults, linkedInProfiles, nonProfiles, profiles };
}

async function main() {
  const company = 'McKinsey & Company';
  const role = 'Consulting Associate';
  const university = 'University of Texas at Austin';
  const location = 'New York';

  console.log('='.repeat(80));
  console.log('QUERY FORMAT EXPERIMENT');
  console.log('='.repeat(80));
  console.log(`\nGoal: Maximize LinkedIn profile URLs for McKinsey employees`);
  console.log(`Testing 3 pages (30 results) per query\n`);

  const results: Awaited<ReturnType<typeof testQuery>>[] = [];

  // Test different query formats
  const queries = [
    // Original format
    ['Original (all params quoted/unquoted)', `"${company}" "${university}" ${role} ${location}`],

    // Site restriction
    ['site:linkedin.com/in + company', `site:linkedin.com/in "${company}"`],
    ['site:linkedin.com/in + company + university', `site:linkedin.com/in "${company}" "${university}"`],
    ['site:linkedin.com/in + all params', `site:linkedin.com/in "${company}" "${university}" ${role} ${location}`],

    // Just company variations
    ['Company only (quoted)', `"${company}"`],
    ['Company only (unquoted)', `${company}`],

    // Company + one other param
    ['Company + university', `"${company}" "${university}"`],
    ['Company + role', `"${company}" ${role}`],
    ['Company + location', `"${company}" ${location}`],

    // Simpler queries
    ['McKinsey Associate', `"McKinsey" Associate`],
    ['McKinsey Consultant', `"McKinsey" Consultant`],
    ['McKinsey + UT Austin', `"McKinsey" "UT Austin"`],

    // With LinkedIn keyword
    ['LinkedIn + company', `LinkedIn "${company}"`],
    ['LinkedIn + company + role', `LinkedIn "${company}" ${role}`],

    // intitle operator
    ['intitle:LinkedIn + company', `intitle:LinkedIn "${company}"`],

    // Shorter company name
    ['McKinsey (short)', `"McKinsey"`],
    ['McKinsey + New York', `"McKinsey" "New York"`],

    // Role-focused
    ['Role + company', `"${role}" "${company}"`],
    ['Business Analyst McKinsey', `"Business Analyst" "McKinsey"`],

    // University-focused
    ['University + company', `"${university}" "${company}"`],
  ];

  for (const [name, query] of queries) {
    const result = await testQuery(name, query);
    results.push(result);
    await new Promise(r => setTimeout(r, 500)); // Rate limit between queries
  }

  // Sort by LinkedIn profile count
  results.sort((a, b) => b.linkedInProfiles - a.linkedInProfiles);

  console.log('\n' + '='.repeat(80));
  console.log('RESULTS RANKED BY LINKEDIN PROFILE COUNT');
  console.log('='.repeat(80));
  console.log('\n| Rank | Query | Profiles | Total | Yield % |');
  console.log('|------|-------|----------|-------|---------|');

  results.forEach((r, i) => {
    const total = r.linkedInProfiles + r.nonProfiles;
    const yieldPct = total > 0 ? ((r.linkedInProfiles / total) * 100).toFixed(1) : '0';
    console.log(`| ${i + 1} | ${r.name.substring(0, 40).padEnd(40)} | ${r.linkedInProfiles.toString().padStart(8)} | ${total.toString().padStart(5)} | ${yieldPct.padStart(6)}% |`);
  });

  // Show top 3 with their profiles
  console.log('\n' + '='.repeat(80));
  console.log('TOP 3 QUERIES - PROFILES FOUND');
  console.log('='.repeat(80));

  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i + 1}: ${r.name}`);
    console.log(`Query: ${r.query}`);
    console.log(`Profiles (${r.linkedInProfiles}):`);
    r.profiles.slice(0, 10).forEach(p => console.log(`  - ${p}`));
  }
}

main().catch(console.error);
