/**
 * Test: Dedup collision guards in saveShortProfile + saveScrapedProfile
 *
 * Covers the single-profile variants of the conditional name+company match
 * logic (test-batch-save.ts only covers saveShortProfilesBatch).
 *
 * Usage: npx tsx tests/test-dedup-collision.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { saveShortProfile, saveScrapedProfile } from '../src/lib/db/person-service';
import type { ShortProfileResult } from '../src/lib/services/linkedin-search';
import type { ScrapedProfile } from '../src/lib/services/linkedin-scraper';

const prisma = new PrismaClient();

const PREFIX = `__TEST_DEDUP_${Date.now()}__`;
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

function makeShort(index: number, overrides: Partial<ShortProfileResult> = {}): ShortProfileResult {
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

function makeScraped(index: number, overrides: Partial<ScrapedProfile> = {}): ScrapedProfile {
  return {
    linkedinUrl: `https://linkedin.com/in/${PREFIX}-scraped-${index}`,
    fullName: `${PREFIX} Scraped ${index}`,
    firstName: `First${index}`,
    lastName: `Last${index}`,
    email: null,
    company: `${PREFIX} ScrapedCorp ${index}`,
    role: `Engineer ${index}`,
    city: null,
    state: null,
    country: null,
    schools: [],
    educationSchool: null,
    experienceHistory: [],
    educationHistory: [],
    ...overrides,
  };
}

async function cleanup() {
  await prisma.person.deleteMany({
    where: { fullName: { contains: PREFIX } },
  });
}

// ─── saveShortProfile ──────────────────────────────────────────────────────

async function test1_shortCollisionSkipped() {
  console.log('\n--- Test 1: saveShortProfile — name collision returns empty, does not mutate existing ---');
  const personA = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Person 10`,
      company: `${PREFIX} Corp 10`,
      role: 'Original Role A',
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-10-A`,
      scrapeDepth: 'short',
    },
  });

  const result = await saveShortProfile(
    makeShort(10, {
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-10-B`,
      role: 'Attempted Override',
    })
  );

  assert(result.personId === '', `Colliding profile returns empty personId (got "${result.personId}")`);
  assert(result.isNew === false, 'isNew is false');

  const dbA = await prisma.person.findUnique({ where: { id: personA.id } });
  assert(
    dbA?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-10-A`,
    `Person A's URL unchanged (got "${dbA?.linkedinUrl}")`
  );
  assert(dbA?.role === 'Original Role A', `Person A's role unchanged (got "${dbA?.role}")`);

  const collidingRow = await prisma.person.findFirst({
    where: { linkedinUrl: `https://linkedin.com/in/${PREFIX}-10-B` },
  });
  assert(collidingRow === null, 'No new row created for colliding URL');
}

async function test2_shortMissingUrlDropped() {
  console.log('\n--- Test 2: saveShortProfile — missing linkedinUrl returns empty ---');
  const result = await saveShortProfile(makeShort(20, { linkedinUrl: '' }));
  assert(result.personId === '', `Returns empty personId (got "${result.personId}")`);
  assert(result.isNew === false, 'isNew is false');

  const row = await prisma.person.findFirst({
    where: { fullName: `${PREFIX} Person 20` },
  });
  assert(row === null, 'No row created for missing-URL profile');
}

async function test3_shortBackfillsLegacyNullUrl() {
  console.log('\n--- Test 3: saveShortProfile — legacy null-URL row is backfilled (happy path) ---');
  const legacy = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Person 30`,
      company: `${PREFIX} Corp 30`,
      role: 'Legacy Role',
      linkedinUrl: null,
      scrapeDepth: 'short',
    },
  });

  const result = await saveShortProfile(makeShort(30, { role: 'Updated Role' }));

  assert(result.personId === legacy.id, `Returns existing personId (got "${result.personId}")`);
  assert(result.isNew === false, 'isNew is false');

  const updated = await prisma.person.findUnique({ where: { id: legacy.id } });
  assert(
    updated?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-30`,
    `URL backfilled (got "${updated?.linkedinUrl}")`
  );
  assert(updated?.role === 'Updated Role', `Role updated (got "${updated?.role}")`);
}

async function test4_shortFullDepthNullUrlPreservesRichData() {
  console.log('\n--- Test 4: saveShortProfile — full-depth null-URL row: only URL+school tagged ---');
  const full = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Person 40`,
      company: `${PREFIX} Corp 40`,
      role: 'Rich Original Role',
      city: 'San Francisco',
      linkedinUrl: null,
      scrapeDepth: 'full',
    },
  });

  const result = await saveShortProfile(
    makeShort(40, { role: 'Should NOT overwrite', city: 'New York' }),
    'Stanford'
  );

  assert(result.personId === full.id, `Returns existing personId`);

  const updated = await prisma.person.findUnique({ where: { id: full.id } });
  assert(
    updated?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-40`,
    `URL backfilled (got "${updated?.linkedinUrl}")`
  );
  assert(updated?.role === 'Rich Original Role', `Rich role preserved (got "${updated?.role}")`);
  assert(updated?.city === 'San Francisco', `Rich city preserved (got "${updated?.city}")`);
  assert(updated?.educationSchool === 'Stanford', `School tag applied (got "${updated?.educationSchool}")`);
}

// ─── saveScrapedProfile ────────────────────────────────────────────────────

async function test5_scrapedCollisionSkipped() {
  console.log('\n--- Test 5: saveScrapedProfile — name collision returns empty, does not mutate existing ---');
  const personA = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Scraped 50`,
      company: `${PREFIX} ScrapedCorp 50`,
      role: 'Original Scraped Role',
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-scraped-50-A`,
      scrapeDepth: 'full',
    },
  });

  const result = await saveScrapedProfile(
    makeScraped(50, {
      linkedinUrl: `https://linkedin.com/in/${PREFIX}-scraped-50-B`,
      role: 'Should Not Override',
    }),
    'https://example.com/source',
    'Source Title',
    null,
    null,
    `${PREFIX} ScrapedCorp 50`
  );

  assert(result.personId === '', `Colliding profile returns empty personId (got "${result.personId}")`);
  assert(result.isNew === false, 'isNew is false');

  const dbA = await prisma.person.findUnique({ where: { id: personA.id } });
  assert(
    dbA?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-scraped-50-A`,
    `Person A's URL unchanged (got "${dbA?.linkedinUrl}")`
  );
  assert(dbA?.role === 'Original Scraped Role', `Person A's role unchanged (got "${dbA?.role}")`);
}

async function test6_scrapedMissingUrlDropped() {
  console.log('\n--- Test 6: saveScrapedProfile — missing linkedinUrl returns empty ---');
  const result = await saveScrapedProfile(
    makeScraped(60, { linkedinUrl: '' }),
    'https://example.com/source',
    'Source Title',
    null,
    null,
    `${PREFIX} ScrapedCorp 60`
  );
  assert(result.personId === '', `Returns empty personId (got "${result.personId}")`);
  assert(result.isNew === false, 'isNew is false');

  const row = await prisma.person.findFirst({
    where: { fullName: `${PREFIX} Scraped 60` },
  });
  assert(row === null, 'No row created for missing-URL profile');
}

async function test7_scrapedBackfillsLegacyNullUrl() {
  console.log('\n--- Test 7: saveScrapedProfile — legacy null-URL row is backfilled (happy path) ---');
  const legacy = await prisma.person.create({
    data: {
      fullName: `${PREFIX} Scraped 70`,
      company: `${PREFIX} ScrapedCorp 70`,
      role: 'Legacy Role',
      linkedinUrl: null,
      scrapeDepth: 'short',
    },
  });

  const result = await saveScrapedProfile(
    makeScraped(70, { role: 'Scraped New Role' }),
    'https://example.com/source',
    'Source Title',
    null,
    null,
    `${PREFIX} ScrapedCorp 70`
  );

  assert(result.personId === legacy.id, `Returns existing personId`);
  assert(result.isNew === false, 'isNew is false');

  const updated = await prisma.person.findUnique({ where: { id: legacy.id } });
  assert(
    updated?.linkedinUrl === `https://linkedin.com/in/${PREFIX}-scraped-70`,
    `URL backfilled (got "${updated?.linkedinUrl}")`
  );
  assert(updated?.role === 'Scraped New Role', `Role updated (got "${updated?.role}")`);
}

async function main() {
  console.log(`Test prefix: ${PREFIX}`);
  try {
    await test1_shortCollisionSkipped();
    await test2_shortMissingUrlDropped();
    await test3_shortBackfillsLegacyNullUrl();
    await test4_shortFullDepthNullUrlPreservesRichData();
    await test5_scrapedCollisionSkipped();
    await test6_scrapedMissingUrlDropped();
    await test7_scrapedBackfillsLegacyNullUrl();
  } finally {
    console.log('\n--- Cleanup ---');
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
