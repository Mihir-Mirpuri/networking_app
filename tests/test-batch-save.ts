/**
 * Test: saveShortProfilesBatch — batch DB lookups for short profile saves
 *
 * Usage: npx tsx tests/test-batch-save.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { saveShortProfilesBatch, saveShortProfile } from '../src/lib/db/person-service';
import type { ShortProfileResult } from '../src/lib/services/linkedin-search';

const prisma = new PrismaClient();

const PREFIX = `__TEST_BATCH_${Date.now()}__`;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function makeProfile(index: number, overrides: Partial<ShortProfileResult> = {}): ShortProfileResult {
  return {
    linkedinId: `${PREFIX}_id_${index}`,
    linkedinUrl: `https://linkedin.com/in/${PREFIX}-${index}`,
    firstName: `First${index}`,
    lastName: `Last${index}`,
    fullName: `${PREFIX} Person ${index}`,
    summary: null,
    company: `${PREFIX} Corp ${index}`,
    companyLinkedinUrl: null,
    role: `Engineer ${index}`,
    tenureMonths: 12,
    startedOn: null,
    location: null,
    city: null,
    state: null,
    country: null,
    pictureUrl: null,
    openProfile: false,
    premium: false,
    ...overrides,
  };
}

async function cleanup() {
  await prisma.person.deleteMany({
    where: { fullName: { contains: PREFIX } },
  });
}

async function test1_allNew() {
  console.log('\n--- Test 1: All-new profiles ---');
  const profiles = Array.from({ length: 5 }, (_, i) => makeProfile(100 + i));

  const results = await saveShortProfilesBatch(profiles);

  assert(results.length === 5, `Returns 5 results (got ${results.length})`);
  assert(results.every(r => r.isNew), 'All marked as isNew');
  assert(results.every(r => r.personId !== ''), 'All have non-empty personId');

  const uniqueIds = new Set(results.map(r => r.personId));
  assert(uniqueIds.size === 5, `All personIds unique (got ${uniqueIds.size})`);

  const dbPersons = await prisma.person.findMany({
    where: { id: { in: results.map(r => r.personId) } },
  });
  assert(dbPersons.length === 5, `All 5 exist in DB (found ${dbPersons.length})`);
  assert(dbPersons.every(p => p.scrapeDepth === 'short'), 'All have scrapeDepth: short');
}

async function test2_allExistingByUrl() {
  console.log('\n--- Test 2: All-existing profiles (by URL) ---');
  // Pre-insert 5 profiles
  const preInserted: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await prisma.person.create({
      data: {
        fullName: `${PREFIX} Person ${200 + i}`,
        firstName: `First${200 + i}`,
        lastName: `Last${200 + i}`,
        company: `${PREFIX} Corp ${200 + i}`,
        role: `OldRole ${200 + i}`,
        linkedinUrl: `https://linkedin.com/in/${PREFIX}-${200 + i}`,
        scrapeDepth: 'short',
      },
    });
    preInserted.push(p.id);
  }

  const profiles = Array.from({ length: 5 }, (_, i) =>
    makeProfile(200 + i, { role: `NewRole ${200 + i}` })
  );

  const results = await saveShortProfilesBatch(profiles);

  assert(results.length === 5, `Returns 5 results`);
  assert(results.every(r => !r.isNew), 'All marked as not new');
  assert(
    results.every((r, i) => r.personId === preInserted[i]),
    'PersonIds match pre-inserted IDs'
  );

  // Verify role was updated
  const updated = await prisma.person.findUnique({ where: { id: preInserted[0] } });
  assert(updated?.role === `NewRole 200`, `Role was updated (got "${updated?.role}")`);
}

async function test3_allExistingByNameCompany() {
  console.log('\n--- Test 3: All-existing profiles (by name+company, no URL) ---');
  const preInserted: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await prisma.person.create({
      data: {
        fullName: `${PREFIX} Person ${300 + i}`,
        firstName: `First${300 + i}`,
        lastName: `Last${300 + i}`,
        company: `${PREFIX} Corp ${300 + i}`,
        role: `Role ${300 + i}`,
        linkedinUrl: null,
        scrapeDepth: 'short',
      },
    });
    preInserted.push(p.id);
  }

  // Call batch with matching name+company but with LinkedIn URLs added
  const profiles = Array.from({ length: 5 }, (_, i) =>
    makeProfile(300 + i)
  );

  const results = await saveShortProfilesBatch(profiles);

  assert(results.every(r => !r.isNew), 'All marked as not new');

  // Verify LinkedIn URLs were backfilled
  const updatedPerson = await prisma.person.findUnique({ where: { id: preInserted[0] } });
  assert(
    updatedPerson?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-300`,
    `LinkedIn URL backfilled (got "${updatedPerson?.linkedinUrl}")`
  );
}

async function test4_mixed() {
  console.log('\n--- Test 4: Mixed new + existing ---');
  // Pre-insert 3
  const preInserted: string[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await prisma.person.create({
      data: {
        fullName: `${PREFIX} Person ${400 + i}`,
        company: `${PREFIX} Corp ${400 + i}`,
        linkedinUrl: `https://linkedin.com/in/${PREFIX}-${400 + i}`,
        scrapeDepth: 'short',
      },
    });
    preInserted.push(p.id);
  }

  // 3 existing + 2 new
  const profiles = Array.from({ length: 5 }, (_, i) => makeProfile(400 + i));
  const results = await saveShortProfilesBatch(profiles);

  assert(results.length === 5, 'Returns 5 results');
  const existingResults = results.filter(r => !r.isNew);
  const newResults = results.filter(r => r.isNew);
  assert(existingResults.length === 3, `3 existing (got ${existingResults.length})`);
  assert(newResults.length === 2, `2 new (got ${newResults.length})`);
}

async function test5_fullDepthNotOverwritten() {
  console.log('\n--- Test 5: Full-depth profiles not overwritten ---');
  const fullPerson = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Person 500`,
      company: `${PREFIX} Corp 500`,
      role: 'Original Senior Role',
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-500`,
      scrapeDepth: 'full',
    },
  });

  const profiles = [makeProfile(500, { role: 'Attempted Override Role' })];
  const results = await saveShortProfilesBatch(profiles);

  assert(!results[0].isNew, 'Marked as not new');
  assert(results[0].personId === fullPerson.id, 'Returns correct personId');

  const dbPerson = await prisma.person.findUnique({ where: { id: fullPerson.id } });
  assert(dbPerson?.role === 'Original Senior Role', `Role NOT overwritten (got "${dbPerson?.role}")`);
}

async function test6_schoolTagging() {
  console.log('\n--- Test 6: School tagging ---');
  // Pre-insert a full-depth profile
  const fullPerson = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Person 600`,
      company: `${PREFIX} Corp 600`,
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-600`,
      scrapeDepth: 'full',
    },
  });

  // One full-depth existing + one new
  const profiles = [makeProfile(600), makeProfile(601)];
  const results = await saveShortProfilesBatch(profiles, 'MIT');

  // Check new profile has school
  const newPerson = await prisma.person.findUnique({ where: { id: results[1].personId } });
  assert(newPerson?.educationSchool === 'MIT', `New profile has school tag (got "${newPerson?.educationSchool}")`);

  // Check full-depth profile also got school tagged
  const fullUpdated = await prisma.person.findUnique({ where: { id: fullPerson.id } });
  assert(fullUpdated?.educationSchool === 'MIT', `Full-depth profile got school tagged (got "${fullUpdated?.educationSchool}")`);
}

async function test7_emptyInput() {
  console.log('\n--- Test 7: Empty input ---');
  const results = await saveShortProfilesBatch([]);
  assert(results.length === 0, 'Returns empty array');
}

async function test8_profilesWithoutNames() {
  console.log('\n--- Test 8: Profiles without names ---');
  const profiles = [
    makeProfile(800, { fullName: '', firstName: '', lastName: '' }),
    makeProfile(801),
  ];
  const results = await saveShortProfilesBatch(profiles);
  assert(results.length === 2, 'Returns 2 results');
  assert(results[0].personId === '', 'Nameless profile has empty personId');
  assert(results[1].personId !== '', 'Valid profile has personId');
}

async function test9_duplicatesInBatch() {
  console.log('\n--- Test 9: Duplicate profiles in same batch ---');
  const p1 = makeProfile(900);
  const p2 = makeProfile(900); // Same name+company
  const results = await saveShortProfilesBatch([p1, p2]);
  assert(results.length === 2, 'Returns 2 results');
  assert(results[0].personId !== '', 'First has personId');
  assert(results[1].personId !== '', 'Second has personId');
  assert(results[0].personId === results[1].personId, 'Both point to same person');
}

async function test10_parityWithSingle() {
  console.log('\n--- Test 10: Parity with saveShortProfile ---');
  // Run single-profile saves
  const singleResults: { personId: string; isNew: boolean }[] = [];
  const profiles = Array.from({ length: 5 }, (_, i) => makeProfile(1000 + i));
  for (const profile of profiles) {
    const result = await saveShortProfile(profile);
    singleResults.push(result);
  }

  // Now run batch on the same profiles (they already exist)
  const batchResults = await saveShortProfilesBatch(profiles);

  assert(batchResults.length === singleResults.length, 'Same number of results');
  for (let i = 0; i < singleResults.length; i++) {
    assert(
      batchResults[i].personId === singleResults[i].personId,
      `Profile ${i}: personId matches (${batchResults[i].personId} === ${singleResults[i].personId})`
    );
    assert(!batchResults[i].isNew, `Profile ${i}: batch correctly says not new`);
  }
}

async function main() {
  console.log(`Test prefix: ${PREFIX}`);
  try {
    await test1_allNew();
    await test2_allExistingByUrl();
    await test3_allExistingByNameCompany();
    await test4_mixed();
    await test5_fullDepthNotOverwritten();
    await test6_schoolTagging();
    await test7_emptyInput();
    await test8_profilesWithoutNames();
    await test9_duplicatesInBatch();
    await test10_parityWithSingle();
  } finally {
    console.log('\n--- Cleanup ---');
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
