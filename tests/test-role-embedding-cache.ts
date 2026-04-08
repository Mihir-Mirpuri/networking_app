/**
 * Test suite for RoleEmbedding persistent cache.
 *
 * Tests:
 * 1. Cache write + read roundtrip
 * 2. Normalization (whitespace, case)
 * 3. getSearchRoleEmbedding 3-tier fallback
 * 4. stampPersonRoleEmbedding stamps from cache
 * 5. stampPersonRoleEmbedding no-ops for uncached role
 * 6. stampPersonRoleEmbedding doesn't overwrite existing
 * 7. saveShortProfile integration
 * 8. ON CONFLICT safety (double insert)
 *
 * Usage: npx tsx tests/test-role-embedding-cache.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_ROLE_PREFIX = '__test_';
const TEST_COMPANY = '__role_embedding_cache_test__';

// Fake 1536-dim embedding for testing
function fakEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.01);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function arraysClose(a: number[], b: number[], tolerance = 1e-6): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < tolerance);
}

async function cleanup() {
  // Delete test Person rows
  await prisma.person.deleteMany({ where: { company: TEST_COMPANY } });
  // Delete test RoleEmbedding rows
  await prisma.$executeRaw`DELETE FROM "RoleEmbedding" WHERE role LIKE ${TEST_ROLE_PREFIX + '%'}`;
}

async function test1_roundtrip() {
  console.log('Test 1: Cache write + read roundtrip');
  const { cacheRoleEmbedding, lookupCachedEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}test_engineer`;
  const embedding = fakEmbedding(1);

  await cacheRoleEmbedding(role, embedding);
  const result = await lookupCachedEmbedding(role);

  assert(result !== null, 'lookupCachedEmbedding should return non-null');
  assert(arraysClose(result!, embedding), 'Returned embedding should match input');

  // Verify row in DB
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT role FROM "RoleEmbedding" WHERE role = ${role.trim().toLowerCase()}
  `;
  assert(rows.length === 1, 'Should have exactly one row in RoleEmbedding');

  console.log('  PASSED\n');
}

async function test2_normalization() {
  console.log('Test 2: Normalization (whitespace + case)');
  const { cacheRoleEmbedding, lookupCachedEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}software_engineer`;
  const embedding = fakEmbedding(2);

  await cacheRoleEmbedding(role, embedding);

  // Whitespace lookup
  const r1 = await lookupCachedEmbedding(`  ${role}  `);
  assert(r1 !== null, 'Whitespace-padded lookup should hit cache');
  assert(arraysClose(r1!, embedding), 'Whitespace lookup should return correct embedding');

  // Case lookup
  const r2 = await lookupCachedEmbedding(role.toUpperCase());
  assert(r2 !== null, 'Uppercase lookup should hit cache');
  assert(arraysClose(r2!, embedding), 'Case lookup should return correct embedding');

  console.log('  PASSED\n');
}

async function test3_three_tier_fallback() {
  console.log('Test 3: getSearchRoleEmbedding 3-tier fallback (DB cache hit, no OpenAI)');
  const { getSearchRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}data_scientist`;
  const embedding = fakEmbedding(3);

  // Pre-insert into RoleEmbedding
  await cacheRoleEmbedding(role, embedding);

  // Clear in-memory cache by looking up via the module's internal cache
  // We can't directly clear it, but since we used a unique role name, it should
  // hit the DB tier if not in memory. If it IS in memory (from cacheRoleEmbedding warming it),
  // that's also fine — the point is no OpenAI call.

  const start = Date.now();
  const result = await getSearchRoleEmbedding(role);
  const elapsed = Date.now() - start;

  assert(result !== null, 'getSearchRoleEmbedding should return non-null');
  assert(arraysClose(result!, embedding), 'Should return the cached embedding');
  assert(elapsed < 2000, `Should be fast (was ${elapsed}ms) — no OpenAI call`);

  console.log(`  Completed in ${elapsed}ms`);
  console.log('  PASSED\n');
}

async function test4_stamp_from_cache() {
  console.log('Test 4: stampPersonRoleEmbedding stamps from cache');
  const { stampPersonRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}product_manager`;
  const embedding = fakEmbedding(4);

  // Pre-cache the role
  await cacheRoleEmbedding(role, embedding);

  // Create a Person with no embedding
  const person = await prisma.person.create({
    data: {
      fullName: 'Test Person 4',
      company: TEST_COMPANY,
      role: role,
    },
  });

  await stampPersonRoleEmbedding(person.id, role);

  // Verify Person now has embedding
  const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
    SELECT role_embedding IS NOT NULL as has_emb FROM "Person" WHERE id = ${person.id}
  `;
  assert(rows[0].has_emb === true, 'Person should now have role_embedding');

  console.log('  PASSED\n');
}

async function test5_stamp_noop_uncached() {
  console.log('Test 5: stampPersonRoleEmbedding no-ops for uncached role');
  const { stampPersonRoleEmbedding } = await import('../src/lib/services/embeddings');

  const novelRole = `${TEST_ROLE_PREFIX}quantum_basket_weaver_${Date.now()}`;

  // Create a Person with no embedding
  const person = await prisma.person.create({
    data: {
      fullName: 'Test Person 5',
      company: TEST_COMPANY,
      role: novelRole,
    },
  });

  await stampPersonRoleEmbedding(person.id, novelRole);

  // Verify Person still has no embedding (no OpenAI call made)
  const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
    SELECT role_embedding IS NOT NULL as has_emb FROM "Person" WHERE id = ${person.id}
  `;
  assert(rows[0].has_emb === false, 'Person should still have NULL role_embedding');

  console.log('  PASSED\n');
}

async function test6_stamp_no_overwrite() {
  console.log('Test 6: stampPersonRoleEmbedding does not overwrite existing');
  const { stampPersonRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}designer`;
  const originalEmbedding = fakEmbedding(60);
  const cachedEmbedding = fakEmbedding(61);

  // Create a Person and manually set a role_embedding
  const person = await prisma.person.create({
    data: {
      fullName: 'Test Person 6',
      company: TEST_COMPANY,
      role: role,
    },
  });
  const originalVector = `[${originalEmbedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "Person" SET role_embedding = ${originalVector}::vector WHERE id = ${person.id}
  `;

  // Cache a different embedding for the same role
  await cacheRoleEmbedding(role, cachedEmbedding);

  // Stamp — should NOT overwrite (IS NULL guard)
  await stampPersonRoleEmbedding(person.id, role);

  // Verify embedding is unchanged
  const rows = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT role_embedding::text as embedding FROM "Person" WHERE id = ${person.id}
  `;
  const current = JSON.parse(rows[0].embedding) as number[];
  assert(arraysClose(current, originalEmbedding), 'Embedding should not have been overwritten');
  assert(!arraysClose(current, cachedEmbedding), 'Should not match the cached (different) embedding');

  console.log('  PASSED\n');
}

async function test7_save_short_profile_integration() {
  console.log('Test 7: saveShortProfile stamps embedding from cache');
  const { cacheRoleEmbedding } = await import('../src/lib/services/embeddings');
  const { saveShortProfile } = await import('../src/lib/db/person-service');

  const role = `${TEST_ROLE_PREFIX}analyst`;
  const embedding = fakEmbedding(7);

  // Pre-cache the role
  await cacheRoleEmbedding(role, embedding);

  // Save a short profile with that role
  const result = await saveShortProfile({
    fullName: `Test ShortProfile ${Date.now()}`,
    firstName: 'Test',
    lastName: 'Short',
    company: TEST_COMPANY,
    role: role,
    linkedinUrl: null,
    city: null,
    state: null,
    country: null,
    pictureUrl: null,
    tenureMonths: null,
    openProfile: false,
    premium: false,
  });

  // Wait for fire-and-forget (remote DB needs more time)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify Person has embedding
  const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
    SELECT role_embedding IS NOT NULL as has_emb FROM "Person" WHERE id = ${result.personId}
  `;
  assert(rows[0].has_emb === true, 'Saved short profile should have role_embedding');

  console.log('  PASSED\n');
}

async function test8_on_conflict_safety() {
  console.log('Test 8: ON CONFLICT safety (double insert)');
  const { cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}double_insert`;
  const embedding = fakEmbedding(8);

  // Insert twice — should not throw
  await cacheRoleEmbedding(role, embedding);
  await cacheRoleEmbedding(role, embedding);

  // Verify only one row
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM "RoleEmbedding" WHERE role = ${role.trim().toLowerCase()}
  `;
  assert(Number(rows[0].count) === 1, 'Should have exactly one row after double insert');

  console.log('  PASSED\n');
}

async function main() {
  console.log('=== RoleEmbedding Cache Test Suite ===\n');

  try {
    await cleanup();

    await test1_roundtrip();
    await test2_normalization();
    await test3_three_tier_fallback();
    await test4_stamp_from_cache();
    await test5_stamp_noop_uncached();
    await test6_stamp_no_overwrite();
    await test7_save_short_profile_integration();
    await test8_on_conflict_safety();

    console.log('=== ALL 8 TESTS PASSED ===');
  } catch (error) {
    console.error('\n=== TEST FAILED ===');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main();
