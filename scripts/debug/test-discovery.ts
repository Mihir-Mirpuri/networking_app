/**
 * Test script: tests the updated discovery.ts searchPeople function
 * Verifies the new query format works correctly
 *
 * Run: npx tsx scripts/test-discovery.ts
 */

import 'dotenv/config';
import { searchPeople } from '../src/lib/services/discovery';

// Browser results for comparison
const BROWSER_RESULTS = [
  'Devan Patel',
  'Yuki Ebashi',
  'Merritt Cozby',
  'Carter Kardesch',
  'Helena Putman',
  'Cameron Sando',
  'Michael Ma',
  'George Clark',
  'Emory Roberts',
  'Estefania Torralba',
];

async function main() {
  console.log('Testing discovery.ts with new query format...\n');

  const results = await searchPeople({
    company: 'Goldman Sachs',
    role: 'Investment Banking Analyst',
    university: 'University of Texas at Austin',
    location: 'Houston',
    limit: 15, // Get a few extra to see variety
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Found ${results.length} candidates\n`);

  // Check for browser matches
  const matches: string[] = [];

  results.forEach((result, i) => {
    const isMatch = BROWSER_RESULTS.some(browserName => {
      const firstName = browserName.split(' ')[0].toLowerCase();
      const lastName = browserName.split(' ').slice(-1)[0].toLowerCase();
      return result.fullName.toLowerCase().includes(firstName) &&
             result.fullName.toLowerCase().includes(lastName);
    });

    if (isMatch) {
      const matchedName = BROWSER_RESULTS.find(browserName => {
        const firstName = browserName.split(' ')[0].toLowerCase();
        const lastName = browserName.split(' ').slice(-1)[0].toLowerCase();
        return result.fullName.toLowerCase().includes(firstName) &&
               result.fullName.toLowerCase().includes(lastName);
      });
      matches.push(matchedName!);
    }

    const marker = isMatch ? '✅' : '  ';
    const confidence = result.confidence ? ` (${(result.confidence * 100).toFixed(0)}%)` : '';
    console.log(`${marker} [${i + 1}] ${result.fullName}${confidence}`);
    console.log(`       Role: ${result.role || '(none)'}`);
    console.log(`       Source: ${result.sourceDomain}`);
    console.log(`       Method: ${result.extractionMethod}`);
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total results: ${results.length}`);
  console.log(`Browser matches: ${matches.length}/10`);
  console.log(`Matched: ${matches.join(', ') || '(none)'}`);

  // Check for directory pages (should be 0)
  const directoryPages = results.filter(r =>
    r.sourceUrl.includes('/pub/dir/') ||
    r.sourceTitle.includes('profiles -')
  );
  console.log(`Directory pages: ${directoryPages.length} (should be 0)`);

  // Success criteria
  const success = matches.length >= 3 && directoryPages.length === 0;
  console.log(`\nTest ${success ? 'PASSED ✅' : 'FAILED ❌'}`);

  process.exit(success ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
