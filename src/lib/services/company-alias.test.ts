/**
 * Test: resolveCompanyAliases()
 *
 * Run: npx tsx src/lib/services/company-alias.test.ts
 */

import { resolveCompanyAliases } from './company-alias';
import prisma from '@/lib/prisma';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

async function cleanup() {
  // Remove any test rows we created
  await prisma.companyAlias.deleteMany({
    where: { canonicalName: { in: ['Procter & Gamble', 'Test Unknown Corp 12345'] } },
  });
}

async function testHardcodedPath() {
  console.log('\n--- Test 1: Hardcoded COMPANY_ALIASES path ---');
  const result = await resolveCompanyAliases('Goldman Sachs');
  assert(result.canonicalName === 'goldmansachs', `canonicalName = "${result.canonicalName}" (expected "goldmansachs")`);
  assert(result.aliases.includes('goldman sachs'), `aliases includes "goldman sachs": ${JSON.stringify(result.aliases)}`);
  assert(result.aliases.includes('goldman'), `aliases includes "goldman": ${JSON.stringify(result.aliases)}`);

  // Verify NO DB row was created (hardcoded should skip DB)
  const dbRow = await prisma.companyAlias.findFirst({
    where: { canonicalName: 'goldmansachs' },
  });
  assert(dbRow === null, 'No DB row created for hardcoded company');
}

async function testHardcodedAbbreviation() {
  console.log('\n--- Test 2: Hardcoded path with abbreviation ---');
  const result = await resolveCompanyAliases('BCG');
  assert(result.canonicalName === 'bcg', `canonicalName = "${result.canonicalName}" (expected "bcg")`);
  assert(result.aliases.includes('boston consulting group'), `aliases includes "boston consulting group": ${JSON.stringify(result.aliases)}`);
}

async function testLLMPath() {
  console.log('\n--- Test 3: LLM path (company not in hardcoded map) ---');
  // P&G is NOT in the hardcoded COMPANY_ALIASES map, so it should hit LLM
  const result = await resolveCompanyAliases('P&G');
  console.log(`  Result: canonicalName="${result.canonicalName}", aliases=${JSON.stringify(result.aliases)}`);

  assert(result.canonicalName.length > 0, `canonicalName is not empty: "${result.canonicalName}"`);
  assert(result.aliases.length >= 2, `aliases has at least 2 entries: ${result.aliases.length}`);
  // The normalized input "p&g" should be in aliases
  assert(result.aliases.some(a => a.includes('p&g') || a.includes('pg')), `aliases includes some form of p&g: ${JSON.stringify(result.aliases)}`);

  // Verify DB row WAS created
  const dbRow = await prisma.companyAlias.findFirst({
    where: { aliases: { has: 'p&g' } },
  });
  assert(dbRow !== null, 'DB row was created for LLM-resolved company');
  if (dbRow) {
    assert(dbRow.source === 'LLM', `source = "${dbRow.source}" (expected "LLM")`);
  }
}

async function testDBCachePath() {
  console.log('\n--- Test 4: DB cache path (second call for same company) ---');
  // This should hit the DB, not LLM (since test 3 persisted it)
  const startTime = Date.now();
  const result = await resolveCompanyAliases('P&G');
  const elapsed = Date.now() - startTime;
  console.log(`  Result: canonicalName="${result.canonicalName}", aliases=${JSON.stringify(result.aliases)} (${elapsed}ms)`);

  assert(result.canonicalName.length > 0, `canonicalName is not empty: "${result.canonicalName}"`);
  assert(result.aliases.length >= 2, `aliases has at least 2 entries`);
  // DB lookup should be fast (< 500ms vs LLM which is 200-400ms)
  // We can't strictly assert timing, but log it for manual inspection
  console.log(`  (DB lookup took ${elapsed}ms — should be fast)`);
}

async function testGracefulDegradation() {
  console.log('\n--- Test 5: Graceful degradation (empty/weird input) ---');
  const result = await resolveCompanyAliases('');
  assert(result.aliases.length >= 1, `empty input returns at least 1 alias: ${JSON.stringify(result.aliases)}`);

  const result2 = await resolveCompanyAliases('   ');
  assert(result2.aliases.length >= 1, `whitespace input returns at least 1 alias: ${JSON.stringify(result2.aliases)}`);
}

async function main() {
  console.log('=== resolveCompanyAliases() Tests ===');

  try {
    await cleanup();

    await testHardcodedPath();
    await testHardcodedAbbreviation();
    await testLLMPath();
    await testDBCachePath();
    await testGracefulDegradation();

    await cleanup();
  } catch (error) {
    console.error('\nUnexpected error:', error);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
