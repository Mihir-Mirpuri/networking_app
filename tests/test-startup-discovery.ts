import { searchSerper } from '@/lib/services/serper';

const startups = [
  'Cursor',
  'Ramp',
  'Verkada',
  'Vanta',
  'Retool',
  'Baseten',
  'Figma',
  'Brex',
  'Abridge',
  'Glean',
];

async function testCompany(name: string) {
  // Step 1: Find company LinkedIn page
  const companyResults = await searchSerper(`site:linkedin.com/company "${name}"`);
  const companyPage = companyResults.find(r => r.link.includes('linkedin.com/company/'));

  if (!companyPage) {
    console.log(`${name.padEnd(12)} | NO COMPANY PAGE FOUND`);
    return;
  }

  const snippet = companyPage.snippet;
  const slug = companyPage.link.match(/company\/([^/?]+)/)?.[1] || '?';

  // Look for YC batch in snippet or title
  const ycMatch = snippet.match(/YC [SWFX]\d{2}/i) || companyPage.title.match(/YC [SWFX]\d{2}/i);

  // Query A: current approach "at X"
  const resultsA = await searchSerper(`site:linkedin.com/in "at ${name}" Software Engineer`);

  // Query B: just quoted company name
  const resultsB = await searchSerper(`site:linkedin.com/in "${name}" Software Engineer`);

  // Query C: with disambig term if available
  let resultsC: { length: number }[] = [];
  let disambigTerm = '';
  if (ycMatch) {
    disambigTerm = ycMatch[0];
    resultsC = await searchSerper(`site:linkedin.com/in "${name}" "${disambigTerm}" Software Engineer`);
  }

  console.log(
    `${name.padEnd(12)} | "at X": ${String(resultsA.length).padStart(2)} | "X": ${String(resultsB.length).padStart(2)}` +
    (disambigTerm ? ` | "${disambigTerm}": ${String(resultsC.length).padStart(2)}` : ` | no YC batch`) +
    ` | slug: ${slug}` +
    ` | ${snippet.substring(0, 70)}...`
  );
}

async function main() {
  console.log('Testing 10 startups: "at X" vs "X" vs disambig queries\n');

  for (const name of startups) {
    await testCompany(name);
  }
}

main().catch(console.error);
