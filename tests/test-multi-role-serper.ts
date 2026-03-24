import 'dotenv/config';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function fetchPage(query: string, page: number) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10, page, gl: 'us', hl: 'en' }),
  });
  const data = await response.json();
  return data.organic || [];
}

function parseResult(r: any) {
  const titleMatch = r.title.match(/^(.+?)\s*[-–]\s*(.+?)(?:\s*[|]\s*LinkedIn)?$/);
  const titleInfo = titleMatch ? titleMatch[2].trim() : r.title;
  return { title: titleInfo, link: r.link, snippet: r.snippet || '' };
}

async function testQueries() {
  // Test 1: Single role queries vs OR combined query
  const company = 'Google';
  const role1 = 'Product Manager';
  const role2 = 'Software Engineer';

  const singleQuery1 = `site:linkedin.com/in "${company}" ${role1}`;
  const singleQuery2 = `site:linkedin.com/in "${company}" ${role2}`;
  const orQuery = `site:linkedin.com/in "${company}" (${role1} OR ${role2})`;

  console.log('=== TEST 1: Google - Product Manager OR Software Engineer ===\n');

  // Fetch single-role results
  console.log(`Query A: ${singleQuery1}`);
  const resultsA = await fetchPage(singleQuery1, 1);
  const profilesA = resultsA.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${profilesA.length} LinkedIn profiles`);
  for (const p of profilesA) {
    console.log(`    ${p.title} | ${p.link}`);
  }

  console.log(`\nQuery B: ${singleQuery2}`);
  const resultsB = await fetchPage(singleQuery2, 1);
  const profilesB = resultsB.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${profilesB.length} LinkedIn profiles`);
  for (const p of profilesB) {
    console.log(`    ${p.title} | ${p.link}`);
  }

  console.log(`\nQuery C (OR): ${orQuery}`);
  const resultsC = await fetchPage(orQuery, 1);
  const profilesC = resultsC.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${profilesC.length} LinkedIn profiles`);
  for (const p of profilesC) {
    console.log(`    ${p.title} | ${p.link}`);
  }

  // Check overlap
  const urlsA = new Set(profilesA.map((p: any) => p.link));
  const urlsB = new Set(profilesB.map((p: any) => p.link));
  const urlsC = new Set(profilesC.map((p: any) => p.link));

  const orFromA = profilesC.filter((p: any) => urlsA.has(p.link)).length;
  const orFromB = profilesC.filter((p: any) => urlsB.has(p.link)).length;
  const orUnique = profilesC.filter((p: any) => !urlsA.has(p.link) && !urlsB.has(p.link)).length;

  console.log(`\n--- Overlap Analysis ---`);
  console.log(`OR results from role1 query: ${orFromA}/${profilesC.length}`);
  console.log(`OR results from role2 query: ${orFromB}/${profilesC.length}`);
  console.log(`OR results unique (not in either single query): ${orUnique}/${profilesC.length}`);

  // Test 2: Different company, 3 roles
  console.log('\n\n=== TEST 2: McKinsey - Consultant OR Analyst OR Associate ===\n');
  const company2 = 'McKinsey';
  const roles = ['Consultant', 'Analyst', 'Associate'];
  const orQuery2 = `site:linkedin.com/in "${company2}" (${roles.join(' OR ')})`;
  const singleQueries2 = roles.map(r => `site:linkedin.com/in "${company2}" ${r}`);

  const allSingleUrls = new Set<string>();
  for (const sq of singleQueries2) {
    console.log(`Query: ${sq}`);
    const results = await fetchPage(sq, 1);
    const profiles = results.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
    console.log(`  → ${profiles.length} LinkedIn profiles`);
    for (const p of profiles) {
      console.log(`    ${p.title} | ${p.link}`);
      allSingleUrls.add(p.link);
    }
    console.log();
  }

  console.log(`Query (OR): ${orQuery2}`);
  const resultsOR2 = await fetchPage(orQuery2, 1);
  const profilesOR2 = resultsOR2.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${profilesOR2.length} LinkedIn profiles`);
  for (const p of profilesOR2) {
    const fromSingle = allSingleUrls.has(p.link) ? '✓' : '✗';
    console.log(`    [${fromSingle}] ${p.title} | ${p.link}`);
  }

  const or2FromSingle = profilesOR2.filter((p: any) => allSingleUrls.has(p.link)).length;
  console.log(`\n--- Overlap: ${or2FromSingle}/${profilesOR2.length} OR results also in single queries ---`);

  // Test 3: Parentheses vs no parentheses
  console.log('\n\n=== TEST 3: Parentheses vs no parens ===\n');
  const withParens = `site:linkedin.com/in "Goldman Sachs" (Analyst OR Vice President)`;
  const withoutParens = `site:linkedin.com/in "Goldman Sachs" Analyst OR Vice President`;

  console.log(`With parens: ${withParens}`);
  const rparen = await fetchPage(withParens, 1);
  const pparen = rparen.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${pparen.length} LinkedIn profiles`);
  for (const p of pparen) console.log(`    ${p.title}`);

  console.log(`\nWithout parens: ${withoutParens}`);
  const rnoparen = await fetchPage(withoutParens, 1);
  const pnoparen = rnoparen.filter((r: any) => r.link.includes('linkedin.com/in/')).map(parseResult);
  console.log(`  → ${pnoparen.length} LinkedIn profiles`);
  for (const p of pnoparen) console.log(`    ${p.title}`);
}

testQueries().catch(console.error);
