/**
 * Test: lookupByName via Serper
 *
 * Verifies that the Serper-powered person lookup returns results
 * for a name query with and without a company.
 */

import { lookupByName } from '../src/lib/services/discovery';

async function main() {
  console.log('=== Test: lookupByName via Serper ===\n');

  // Test 1: Name + Company
  console.log('--- Test 1: Name + Company ---');
  const results1 = await lookupByName({ name: 'Sundar Pichai', company: 'Google' });
  console.log(`Results: ${results1.length}`);
  for (const r of results1) {
    console.log(`  - ${r.fullName} | ${r.linkedinUrl} | Company: ${r.cseCompany || '(snippet)'}`);
    console.log(`    Title: ${r.sourceTitle}`);
  }
  console.assert(results1.length > 0, 'FAIL: Expected at least 1 result for "Sundar Pichai at Google"');
  console.log('');

  // Test 2: Name only (no company)
  console.log('--- Test 2: Name only ---');
  const results2 = await lookupByName({ name: 'Elon Musk' });
  console.log(`Results: ${results2.length}`);
  for (const r of results2) {
    console.log(`  - ${r.fullName} | ${r.linkedinUrl} | Company: ${r.cseCompany || '(snippet)'}`);
    console.log(`    Title: ${r.sourceTitle}`);
  }
  console.assert(results2.length > 0, 'FAIL: Expected at least 1 result for "Elon Musk"');
  console.log('');

  // Test 3: Less well-known name + company
  console.log('--- Test 3: Less common name + company ---');
  const results3 = await lookupByName({ name: 'John Smith', company: 'Goldman Sachs' });
  console.log(`Results: ${results3.length}`);
  for (const r of results3) {
    console.log(`  - ${r.fullName} | ${r.linkedinUrl} | Company: ${r.cseCompany || '(snippet)'}`);
  }
  console.assert(results3.length > 0, 'FAIL: Expected at least 1 result for "John Smith at Goldman Sachs"');

  console.log('\n=== All tests passed! ===');
}

main().catch(console.error);
