/**
 * Smoke test: does harvestapi/linkedin-profile-search accept industryIds
 * and return relevant profiles?
 *
 * Cost: 2 Apify Short pages = $0.20. Run rarely.
 *
 * Usage: npx tsx tests/apify-industry-id-smoke.ts
 */

import 'dotenv/config';
import { searchLinkedInShort } from '../src/lib/services/linkedin-search';

async function main() {
  let failures = 0;

  console.log('Case 1: industryIds=["14"] (Hospitals & Health Care) in New York');
  try {
    const r1 = await searchLinkedInShort({
      industryIds: ['14'],
      locations: ['New York'],
      maxItems: 5,
      takePages: 1,
    });
    if (r1.profiles.length === 0) {
      failures++;
      console.log(`  [FAIL ] 0 profiles returned`);
    } else {
      console.log(`  [PASS ] ${r1.profiles.length} profiles returned`);
      for (const p of r1.profiles.slice(0, 3)) {
        console.log(`          - ${p.fullName} — ${p.role} @ ${p.company} (${p.city ?? '?'})`);
      }
    }
  } catch (err) {
    failures++;
    console.log(`  [FAIL ] threw: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\nCase 2: industryIds=["4"] (Software Development) in San Francisco');
  try {
    const r2 = await searchLinkedInShort({
      industryIds: ['4'],
      locations: ['San Francisco'],
      maxItems: 5,
      takePages: 1,
    });
    if (r2.profiles.length === 0) {
      failures++;
      console.log(`  [FAIL ] 0 profiles returned`);
    } else {
      console.log(`  [PASS ] ${r2.profiles.length} profiles returned`);
      for (const p of r2.profiles.slice(0, 3)) {
        console.log(`          - ${p.fullName} — ${p.role} @ ${p.company} (${p.city ?? '?'})`);
      }
    }
  } catch (err) {
    failures++;
    console.log(`  [FAIL ] threw: ${err instanceof Error ? err.message : err}`);
  }

  if (failures > 0) process.exit(1);
  console.log('\nAll smoke cases passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
