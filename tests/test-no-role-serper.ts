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

interface ParsedProfile {
  name: string;
  roleInfo: string;
  link: string;
  snippet: string;
}

function parseResult(r: any): ParsedProfile | null {
  if (!r.link.includes('linkedin.com/in/')) return null;
  const titleMatch = r.title.match(/^(.+?)\s*[-–]\s*(.+?)(?:\s*[|]\s*LinkedIn)?$/);
  return {
    name: titleMatch ? titleMatch[1].trim() : r.title,
    roleInfo: titleMatch ? titleMatch[2].trim() : '',
    link: r.link,
    snippet: r.snippet || '',
  };
}

async function testQueryStrategy(label: string, query: string, pages: number = 3) {
  console.log(`\n--- ${label} ---`);
  console.log(`Query: ${query}\n`);

  const allProfiles: ParsedProfile[] = [];
  const seenUrls = new Set<string>();

  for (let page = 1; page <= pages; page++) {
    const results = await fetchPage(query, page);
    const profiles = results.map(parseResult).filter(Boolean) as ParsedProfile[];
    const newProfiles = profiles.filter(p => !seenUrls.has(p.link));
    newProfiles.forEach(p => seenUrls.add(p.link));
    allProfiles.push(...newProfiles);

    console.log(`  Page ${page}: ${results.length} results, ${profiles.length} LinkedIn profiles (${newProfiles.length} new)`);
    for (const p of newProfiles) {
      console.log(`    ${p.name} | ${p.roleInfo} | ${p.link}`);
    }
  }

  console.log(`\n  TOTAL: ${allProfiles.length} unique LinkedIn profiles across ${pages} pages`);
  return allProfiles;
}

async function main() {
  if (!SERPER_API_KEY) {
    console.error('SERPER_API_KEY not set');
    process.exit(1);
  }

  console.log('==========================================================');
  console.log('TEST: Finding people at a company WITHOUT specifying a role');
  console.log('==========================================================');

  // ── Company: Google ──────────────────────────────────────────────────

  console.log('\n\n========== COMPANY: Google ==========');

  // Strategy 1: Just company name
  const g1 = await testQueryStrategy(
    'Strategy 1: Company only',
    'site:linkedin.com/in "Google"'
  );

  // Strategy 2: Company + "works at"
  const g2 = await testQueryStrategy(
    'Strategy 2: "works at" prefix',
    'site:linkedin.com/in "works at Google"'
  );

  // Strategy 3: Company + employee keyword
  const g3 = await testQueryStrategy(
    'Strategy 3: Company + "employee"',
    'site:linkedin.com/in Google employee'
  );

  // Strategy 4: Company with "current" context
  const g4 = await testQueryStrategy(
    'Strategy 4: "currently at" prefix',
    'site:linkedin.com/in "currently" "Google"'
  );

  // Strategy 5: Company in Experience context
  const g5 = await testQueryStrategy(
    'Strategy 5: "Experience" context',
    'site:linkedin.com/in "Experience" "Google"'
  );

  // ── Compare overlap ──────────────────────────────────────────────────

  console.log('\n\n========== OVERLAP ANALYSIS: Google ==========');
  const strategies = [
    { label: 'Company only', profiles: g1 },
    { label: '"works at"', profiles: g2 },
    { label: 'employee', profiles: g3 },
    { label: '"currently"', profiles: g4 },
    { label: '"Experience"', profiles: g5 },
  ];

  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const urlsA = new Set(strategies[i].profiles.map(p => p.link));
      const overlap = strategies[j].profiles.filter(p => urlsA.has(p.link)).length;
      console.log(
        `  ${strategies[i].label} ∩ ${strategies[j].label}: ${overlap} shared (of ${strategies[i].profiles.length} and ${strategies[j].profiles.length})`
      );
    }
  }

  // ── Company: Stripe (smaller) ────────────────────────────────────────

  console.log('\n\n========== COMPANY: Stripe ==========');

  const s1 = await testQueryStrategy(
    'Strategy 1: Company only',
    'site:linkedin.com/in "Stripe"'
  );

  const s2 = await testQueryStrategy(
    'Strategy 2: "works at" prefix',
    'site:linkedin.com/in "works at Stripe"'
  );

  const s3 = await testQueryStrategy(
    'Strategy 5: "Experience" context',
    'site:linkedin.com/in "Experience" "Stripe"'
  );

  console.log('\n\n========== OVERLAP ANALYSIS: Stripe ==========');
  const stripeStrats = [
    { label: 'Company only', profiles: s1 },
    { label: '"works at"', profiles: s2 },
    { label: '"Experience"', profiles: s3 },
  ];
  for (let i = 0; i < stripeStrats.length; i++) {
    for (let j = i + 1; j < stripeStrats.length; j++) {
      const urlsA = new Set(stripeStrats[i].profiles.map(p => p.link));
      const overlap = stripeStrats[j].profiles.filter(p => urlsA.has(p.link)).length;
      console.log(
        `  ${stripeStrats[i].label} ∩ ${stripeStrats[j].label}: ${overlap} shared (of ${stripeStrats[i].profiles.length} and ${stripeStrats[j].profiles.length})`
      );
    }
  }

  // ── Comparison: with role vs without role ─────────────────────────────

  console.log('\n\n========== WITH ROLE vs WITHOUT ROLE ==========');

  await testQueryStrategy(
    'Google + Software Engineer (with role)',
    'site:linkedin.com/in "Google" Software Engineer'
  );

  await testQueryStrategy(
    'Google (no role) — already ran above',
    'site:linkedin.com/in "Google"'
  );
}

main().catch(console.error);
