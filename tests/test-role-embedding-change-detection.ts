/**
 * Tests for stampPersonRoleEmbedding change-detection behavior.
 *
 * Previously, stampPersonRoleEmbedding used `WHERE role_embedding IS NULL` so it
 * only filled empty embeddings and never refreshed existing ones. That meant
 * when a role's canonical embedding changed (e.g., after the role normalization
 * fix landed), existing Person rows kept their stale embeddings forever.
 *
 * New behavior: stamp whenever the cached embedding differs from the stored one
 * (`IS DISTINCT FROM`). Same-embedding calls are a no-op so we don't generate
 * pointless UPDATE traffic.
 *
 * Requires real DB. Usage: npx tsx tests/test-role-embedding-change-detection.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_COMPANY = '__change_detection_test__';
const TEST_ROLE_PREFIX = '__cd_test_';

function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.01);
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function arraysClose(a: number[], b: number[], tolerance = 1e-6): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < tolerance);
}

async function cleanup() {
  await prisma.person.deleteMany({ where: { company: TEST_COMPANY } });
  await prisma.$executeRaw`DELETE FROM "RoleEmbedding" WHERE role LIKE ${TEST_ROLE_PREFIX + '%'}`;
}

async function test1_overwrites_when_cached_differs() {
  console.log('Test 1: stampPersonRoleEmbedding overwrites when cached embedding differs');
  const { stampPersonRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}overwrite_test`;
  const staleEmbedding = fakeEmbedding(100);
  const freshEmbedding = fakeEmbedding(200);

  // Create Person with a "stale" embedding already stamped
  const person = await prisma.person.create({
    data: { fullName: 'Change Detect 1', company: TEST_COMPANY, role },
  });
  const staleVector = `[${staleEmbedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "Person" SET role_embedding = ${staleVector}::vector WHERE id = ${person.id}
  `;

  // Cache a DIFFERENT embedding for the same role
  await cacheRoleEmbedding(role, freshEmbedding);

  // Stamp — should OVERWRITE the stale embedding with the fresh one
  await stampPersonRoleEmbedding(person.id, role);

  const rows = await prisma.$queryRaw<Array<{ embedding: string }>>`
    SELECT role_embedding::text as embedding FROM "Person" WHERE id = ${person.id}
  `;
  const current = JSON.parse(rows[0].embedding) as number[];

  assert(arraysClose(current, freshEmbedding), 'Expected Person.role_embedding to be the fresh cached embedding');
  assert(!arraysClose(current, staleEmbedding), 'Expected the stale embedding to have been replaced');

  console.log('  PASSED\n');
}

async function test2_fills_when_null() {
  console.log('Test 2: stampPersonRoleEmbedding still fills NULL embeddings');
  const { stampPersonRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}null_fill_test`;
  const embedding = fakeEmbedding(300);

  await cacheRoleEmbedding(role, embedding);

  const person = await prisma.person.create({
    data: { fullName: 'Change Detect 2', company: TEST_COMPANY, role },
  });
  // role_embedding is NULL at this point

  await stampPersonRoleEmbedding(person.id, role);

  const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
    SELECT role_embedding IS NOT NULL as has_emb FROM "Person" WHERE id = ${person.id}
  `;
  assert(rows[0].has_emb === true, 'NULL embedding should have been filled');

  console.log('  PASSED\n');
}

async function test3_noop_when_same() {
  console.log('Test 3: stampPersonRoleEmbedding is a no-op when cached embedding matches stored');
  const { stampPersonRoleEmbedding, cacheRoleEmbedding } = await import('../src/lib/services/embeddings');

  const role = `${TEST_ROLE_PREFIX}noop_test`;
  const embedding = fakeEmbedding(400);

  await cacheRoleEmbedding(role, embedding);

  const person = await prisma.person.create({
    data: { fullName: 'Change Detect 3', company: TEST_COMPANY, role },
  });

  // First stamp — fills the embedding
  await stampPersonRoleEmbedding(person.id, role);

  // Capture updatedAt baseline
  const before = await prisma.person.findUnique({
    where: { id: person.id },
    select: { updatedAt: true },
  });

  // Wait a moment so any real UPDATE would bump updatedAt
  await new Promise(r => setTimeout(r, 1100));

  // Second stamp with SAME cached embedding — should not trigger an UPDATE
  await stampPersonRoleEmbedding(person.id, role);

  const after = await prisma.person.findUnique({
    where: { id: person.id },
    select: { updatedAt: true },
  });

  assert(
    before!.updatedAt.getTime() === after!.updatedAt.getTime(),
    `Expected updatedAt to be unchanged (no-op). Before=${before!.updatedAt.toISOString()}, After=${after!.updatedAt.toISOString()}`
  );

  console.log('  PASSED\n');
}

async function main() {
  console.log('=== stampPersonRoleEmbedding change-detection tests ===\n');
  try {
    await cleanup();
    await test1_overwrites_when_cached_differs();
    await test2_fills_when_null();
    await test3_noop_when_same();
    console.log('=== ALL 3 TESTS PASSED ===');
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
