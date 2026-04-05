/**
 * Test: Batch role embedding pipeline
 * Tests bulkUpdatePersonRoleEmbeddings and verifies saveScrapedProfile
 * no longer fires individual embedding calls.
 *
 * Usage: npx tsx tests/test-batch-embeddings.ts
 */

import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { bulkUpdatePersonRoleEmbeddings } from '../src/lib/services/embeddings';

const TEST_COMPANY = '__embedding_batch_test__';

async function cleanup() {
  await prisma.sourceLink.deleteMany({
    where: { person: { company: TEST_COMPANY } },
  });
  await prisma.person.deleteMany({
    where: { company: TEST_COMPANY },
  });
}

async function hasEmbedding(personId: string): Promise<boolean> {
  const result = await prisma.$queryRaw<{ has: boolean }[]>`
    SELECT role_embedding IS NOT NULL as has FROM "Person" WHERE id = ${personId}
  `;
  return result[0]?.has ?? false;
}

async function main() {
  let passed = 0;
  let failed = 0;

  try {
    await cleanup();

    // ===== Test 1: bulkUpdatePersonRoleEmbeddings stores embeddings correctly =====
    console.log('Test 1: Bulk embed 3 distinct roles...');
    const p1 = await prisma.person.create({ data: { fullName: 'Test One', company: TEST_COMPANY, role: 'Software Engineer' } });
    const p2 = await prisma.person.create({ data: { fullName: 'Test Two', company: TEST_COMPANY, role: 'Product Manager' } });
    const p3 = await prisma.person.create({ data: { fullName: 'Test Three', company: TEST_COMPANY, role: 'Data Scientist' } });

    const roles1 = new Map<string, string>([
      [p1.id, 'Software Engineer'],
      [p2.id, 'Product Manager'],
      [p3.id, 'Data Scientist'],
    ]);

    const count1 = await bulkUpdatePersonRoleEmbeddings(roles1);
    if (count1 === 3) {
      console.log('  PASS: returned 3');
      passed++;
    } else {
      console.log(`  FAIL: expected 3, got ${count1}`);
      failed++;
    }

    const [e1, e2, e3] = await Promise.all([hasEmbedding(p1.id), hasEmbedding(p2.id), hasEmbedding(p3.id)]);
    if (e1 && e2 && e3) {
      console.log('  PASS: all 3 have non-null role_embedding');
      passed++;
    } else {
      console.log(`  FAIL: embeddings present: ${e1}, ${e2}, ${e3}`);
      failed++;
    }

    // ===== Test 2: Duplicate roles are deduplicated =====
    console.log('\nTest 2: Duplicate roles deduplication...');
    const p4 = await prisma.person.create({ data: { fullName: 'Test Four', company: TEST_COMPANY, role: 'Software Engineer' } });
    const p5 = await prisma.person.create({ data: { fullName: 'Test Five', company: TEST_COMPANY, role: 'Software Engineer' } });
    const p6 = await prisma.person.create({ data: { fullName: 'Test Six', company: TEST_COMPANY, role: 'Marketing Manager' } });

    const roles2 = new Map<string, string>([
      [p4.id, 'Software Engineer'],
      [p5.id, 'Software Engineer'],
      [p6.id, 'Marketing Manager'],
    ]);

    const count2 = await bulkUpdatePersonRoleEmbeddings(roles2);
    if (count2 === 3) {
      console.log('  PASS: returned 3 (dedup handled internally)');
      passed++;
    } else {
      console.log(`  FAIL: expected 3, got ${count2}`);
      failed++;
    }

    const [e4, e5, e6] = await Promise.all([hasEmbedding(p4.id), hasEmbedding(p5.id), hasEmbedding(p6.id)]);
    if (e4 && e5 && e6) {
      console.log('  PASS: all 3 have embeddings');
      passed++;
    } else {
      console.log(`  FAIL: embeddings present: ${e4}, ${e5}, ${e6}`);
      failed++;
    }

    // ===== Test 3: Empty/null roles are skipped =====
    console.log('\nTest 3: Empty roles skipped...');
    const p7 = await prisma.person.create({ data: { fullName: 'Test Seven', company: TEST_COMPANY, role: 'Designer' } });
    const p8 = await prisma.person.create({ data: { fullName: 'Test Eight', company: TEST_COMPANY, role: null } });

    const roles3 = new Map<string, string>([
      [p7.id, 'Designer'],
      [p8.id, ''],  // empty role — should be skipped
    ]);

    const count3 = await bulkUpdatePersonRoleEmbeddings(roles3);
    if (count3 === 1) {
      console.log('  PASS: returned 1 (empty role skipped)');
      passed++;
    } else {
      console.log(`  FAIL: expected 1, got ${count3}`);
      failed++;
    }

    const [e7, e8] = await Promise.all([hasEmbedding(p7.id), hasEmbedding(p8.id)]);
    if (e7 && !e8) {
      console.log('  PASS: only the person with a role got an embedding');
      passed++;
    } else {
      console.log(`  FAIL: embeddings present: p7=${e7}, p8=${e8}`);
      failed++;
    }

    // ===== Test 4: saveScrapedProfile no longer fires individual embedding =====
    console.log('\nTest 4: saveScrapedProfile does not fire embedding...');
    // Import dynamically to avoid circular issues at module load
    const { saveScrapedProfile } = await import('../src/lib/db/person-service');

    const { personId, role } = await saveScrapedProfile(
      {
        linkedinUrl: 'https://linkedin.com/in/__batch-test-user__',
        fullName: 'Batch Test User',
        firstName: 'Batch',
        lastName: 'Test User',
        company: TEST_COMPANY,
        role: 'VP of Engineering',
        email: null,
        city: null,
        state: null,
        country: null,
        schools: [],
        experienceHistory: [],
        educationHistory: [],
      },
      'https://example.com/source',
      'Test Source',
      null,
      'example.com',
      TEST_COMPANY,
    );

    // Immediately check — should have no embedding (no fire-and-forget)
    const hasEmbBefore = await hasEmbedding(personId);
    if (!hasEmbBefore) {
      console.log('  PASS: no embedding immediately after save');
      passed++;
    } else {
      console.log('  FAIL: embedding exists right after save (fire-and-forget still running?)');
      failed++;
    }

    // Now batch-embed it
    if (role) {
      const batchMap = new Map([[personId, role]]);
      const batchCount = await bulkUpdatePersonRoleEmbeddings(batchMap);
      const hasEmbAfter = await hasEmbedding(personId);
      if (batchCount === 1 && hasEmbAfter) {
        console.log('  PASS: embedding present after batch call');
        passed++;
      } else {
        console.log(`  FAIL: batchCount=${batchCount}, hasEmb=${hasEmbAfter}`);
        failed++;
      }
    } else {
      console.log('  SKIP: no role returned from saveScrapedProfile');
    }

    // ===== Summary =====
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
