import { searchSerper } from '@/lib/services/serper';

const startups = [
  'Anara',
  'Pylon',
  'Basepilot',
  'Tinybird',
  'Browserbase',
  'Outerbase',
  'Hightouch',
  'Whalesync',
  'Fern',
  'Lightdash',
];

/**
 * Check if a person actually WORKS at the company (not just named after it).
 * Looks for patterns like "at Company", "Experience: Company", "Company Graphic" (LinkedIn format),
 * or "Founder @ Company" in title/snippet.
 */
function worksAtCompany(title: string, snippet: string, companyName: string): boolean {
  const lower = companyName.toLowerCase();
  const t = title.toLowerCase();
  const s = snippet.toLowerCase();

  // Title patterns: "Name - Role at Company", "Name - Company"
  // Split title by " - " and check if company appears AFTER the person's name
  const titleParts = t.split(' - ');
  if (titleParts.length >= 2) {
    // Check non-name parts for company mention
    const afterName = titleParts.slice(1).join(' ');
    if (afterName.includes(lower)) return true;
  }

  // Snippet patterns that indicate employment
  const workPatterns = [
    `at ${lower}`,
    `experience: ${lower}`,
    `experience. ${lower}`,
    `${lower} graphic`,  // LinkedIn's "Company Graphic" pattern
    `founder @ ${lower}`,
    `founder @${lower}`,
    `co-founder @ ${lower}`,
    `co-founder @${lower}`,
    `ceo at ${lower}`,
    `cto at ${lower}`,
    `working at ${lower}`,
    `: ${lower} ·`,  // "Role: Company · Location" pattern
  ];

  for (const pattern of workPatterns) {
    if (s.includes(pattern)) return true;
  }

  // Negative: if the person's first name IS the company name, it's likely a false positive
  // e.g., "Anara Askhatsson" when searching for company "Anara"
  const firstName = (titleParts[0] || '').trim().split(' ')[0].toLowerCase();
  if (firstName === lower) return false;

  return false;
}

async function testCompany(name: string) {
  // Step 1: Find company LinkedIn page for context
  const companyResults = await searchSerper(`site:linkedin.com/company "${name}"`);
  const companyPage = companyResults.find(r => r.link.includes('linkedin.com/company/'));

  if (!companyPage) {
    console.log(`\n${name}: NO COMPANY PAGE FOUND`);
    return;
  }

  const snippet = companyPage.snippet;
  const slug = companyPage.link.match(/company\/([^/?]+)/)?.[1] || '?';

  // Look for YC batch
  const ycMatch = snippet.match(/YC [SWFX]\d{2}/i) || companyPage.title.match(/YC [SWFX]\d{2}/i);

  // Query A: "at X" (current approach)
  const resultsA = await searchSerper(`site:linkedin.com/in "at ${name}" Software Engineer`);

  // Query B: "X" (no "at")
  const resultsB = await searchSerper(`site:linkedin.com/in "${name}" Software Engineer`);

  // Query C: YC disambig (if available)
  let resultsC: Awaited<ReturnType<typeof searchSerper>> = [];
  let disambigTerm = '';
  if (ycMatch) {
    disambigTerm = ycMatch[0];
    resultsC = await searchSerper(`site:linkedin.com/in "${name}" "${disambigTerm}"`);
  }

  // Check actual relevance
  const relevantA = resultsA.filter(r => worksAtCompany(r.title, r.snippet, name));
  const relevantB = resultsB.filter(r => worksAtCompany(r.title, r.snippet, name));
  const relevantC = resultsC.filter(r => worksAtCompany(r.title, r.snippet, name));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${name} (slug: ${slug})`);
  console.log(`Company page: ${snippet.substring(0, 100)}...`);
  console.log(`${'='.repeat(80)}`);

  console.log(`\n  "at ${name}": ${resultsA.length} total, ${relevantA.length} actually work there`);
  for (const r of resultsA) {
    const works = worksAtCompany(r.title, r.snippet, name);
    console.log(`    ${works ? 'OK' : 'XX'} ${r.title.substring(0, 65)}`);
  }

  console.log(`\n  "${name}" (no at): ${resultsB.length} total, ${relevantB.length} actually work there`);
  for (const r of resultsB) {
    const works = worksAtCompany(r.title, r.snippet, name);
    console.log(`    ${works ? 'OK' : 'XX'} ${r.title.substring(0, 65)}`);
  }

  if (disambigTerm) {
    console.log(`\n  "${name}" + "${disambigTerm}": ${resultsC.length} total, ${relevantC.length} actually work there`);
    for (const r of resultsC) {
      const works = worksAtCompany(r.title, r.snippet, name);
      console.log(`    ${works ? 'OK' : 'XX'} ${r.title.substring(0, 65)}`);
    }
  }

  return {
    name,
    atX: relevantA.length,
    quotedX: relevantB.length,
    disambig: disambigTerm ? relevantC.length : null,
    disambigTerm,
  };
}

async function main() {
  const results = [];

  for (const name of startups) {
    const r = await testCompany(name);
    if (r) results.push(r);
  }

  // Summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY: People who actually work at the company');
  console.log(`${'='.repeat(80)}`);
  console.log(`${'Company'.padEnd(14)} | ${'\"at X\"'.padEnd(8)} | ${'\"X\"'.padEnd(8)} | Disambig`);
  console.log('-'.repeat(60));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(14)} | ${String(r.atX).padStart(5).padEnd(8)} | ${String(r.quotedX).padStart(5).padEnd(8)} | ` +
      (r.disambig !== null ? `${r.disambig} ("${r.disambigTerm}")` : 'n/a')
    );
  }
}

main().catch(console.error);
