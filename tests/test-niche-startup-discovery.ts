import { searchSerper } from '@/lib/services/serper';

// Actually niche/small startups where "at X" is likely to fail
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

async function testCompany(name: string) {
  // Step 1: Find company LinkedIn page
  const companyResults = await searchSerper(`site:linkedin.com/company "${name}"`);
  const companyPage = companyResults.find(r => r.link.includes('linkedin.com/company/'));

  if (!companyPage) {
    console.log(`${name.padEnd(14)} | NO COMPANY PAGE FOUND`);
    return;
  }

  const snippet = companyPage.snippet;
  const slug = companyPage.link.match(/company\/([^/?]+)/)?.[1] || '?';

  // Look for YC batch, or other identifiers
  const ycMatch = snippet.match(/YC [SWFX]\d{2}/i) || companyPage.title.match(/YC [SWFX]\d{2}/i);
  // Also try to find other disambiguators from snippet
  const backedMatch = snippet.match(/backed by ([^.]+)/i);

  // Query A: current approach "at X"
  const resultsA = await searchSerper(`site:linkedin.com/in "at ${name}" Software Engineer`);
  // Count how many are actually linkedin.com/in profiles
  const profilesA = resultsA.filter(r => r.link.includes('linkedin.com/in/'));

  // Query B: just quoted company name (no "at")
  const resultsB = await searchSerper(`site:linkedin.com/in "${name}" Software Engineer`);
  const profilesB = resultsB.filter(r => r.link.includes('linkedin.com/in/'));

  // Query C: with disambig term if available
  let profilesC: typeof profilesA = [];
  let disambigTerm = '';
  if (ycMatch) {
    disambigTerm = ycMatch[0];
    const resultsC = await searchSerper(`site:linkedin.com/in "${name}" "${disambigTerm}"`);
    profilesC = resultsC.filter(r => r.link.includes('linkedin.com/in/'));
  }

  // Check signal quality: how many results in A actually mention the company in their snippet?
  const relevantA = profilesA.filter(r => {
    const s = r.snippet.toLowerCase();
    const t = r.title.toLowerCase();
    return s.includes(name.toLowerCase()) || t.includes(name.toLowerCase());
  });

  const relevantB = profilesB.filter(r => {
    const s = r.snippet.toLowerCase();
    const t = r.title.toLowerCase();
    return s.includes(name.toLowerCase()) || t.includes(name.toLowerCase());
  });

  console.log(
    `${name.padEnd(14)} | "at X": ${String(profilesA.length).padStart(2)} (${relevantA.length} relevant)` +
    ` | "X": ${String(profilesB.length).padStart(2)} (${relevantB.length} relevant)` +
    (disambigTerm ? ` | "${disambigTerm}": ${String(profilesC.length).padStart(2)}` : ` | no YC`) +
    ` | slug: ${slug}`
  );

  // Show what the false positives look like for small companies
  if (relevantA.length < profilesA.length && profilesA.length <= 5) {
    const irrelevant = profilesA.filter(r => {
      const s = r.snippet.toLowerCase();
      const t = r.title.toLowerCase();
      return !(s.includes(name.toLowerCase()) || t.includes(name.toLowerCase()));
    });
    for (const r of irrelevant.slice(0, 2)) {
      console.log(`  FALSE POS: ${r.title.substring(0, 60)} | ${r.snippet.substring(0, 80)}`);
    }
  }
}

async function main() {
  console.log('Testing niche startups: "at X" vs "X" vs disambig\n');
  console.log('Company        | "at X" (relevant) | "X" (relevant) | disambig     | slug');
  console.log('-'.repeat(100));

  for (const name of startups) {
    await testCompany(name);
  }
}

main().catch(console.error);
