/**
 * Test: Load More DB-first probe
 *
 * Validates the Option B fix: loadMoreV2Action drains remaining DB rows
 * (via findPeopleByFilters with excludePersonIds) before falling through
 * to Apify.
 *
 * Seeds 7 fake IBM "Software Engineer" profiles in DB, then exercises the
 * same findPeopleByFilters code path that loadMoreV2Action's new Tier 1
 * probe uses. Verifies:
 *   1. Initial query (no excludes) returns all 7
 *   2. Probe with first 3 excluded returns the remaining 4
 *   3. Probe with all 7 excluded returns 0 (→ would fall through to Apify)
 *
 * Run: npx tsx tests/test-loadmore-dbfirst.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { findPeopleByFilters, type PersonFilters } from '../src/lib/db/person-service';
import { stampPersonRoleEmbedding } from '../src/lib/services/embeddings';
import { resolveCompanyAliases } from '../src/lib/services/company-alias';

const prisma = new PrismaClient();

const PREFIX = `__TEST_LOADMORE_DBFIRST_${Date.now()}__`;
// Use a fake distinctive name that won't collide with any real-world company
// the alias resolver knows about (avoid "IBM", "google", etc.).
const TEST_COMPANY = `${PREFIX}_FAKECORP_XYZQ`;

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

async function main() {
  console.log('=== Load More DB-first Probe Tests ===\n');

  // ── Seed: create 7 Person rows for our fake "IBM" company ──
  console.log('── Seed ──');
  const seeded: Array<{ id: string; fullName: string }> = [];
  for (let i = 1; i <= 7; i++) {
    const person = await prisma.person.create({
      data: {
        fullName: `${PREFIX} SWE ${i}`,
        firstName: `Swe${i}`,
        lastName: PREFIX,
        company: TEST_COMPANY,
        role: 'Software Engineer',
        linkedinUrl: `https://linkedin.com/in/${PREFIX}-${i}`,
      },
    });
    // Stamp role embedding so the vector path returns it
    await stampPersonRoleEmbedding(person.id, 'Software Engineer');
    seeded.push({ id: person.id, fullName: person.fullName });
  }
  console.log(`  Seeded ${seeded.length} Person rows with company=${TEST_COMPANY}, role="Software Engineer"`);

  // ── Resolve company aliases (same as loadMoreV2Action does) ──
  const resolved = await resolveCompanyAliases(TEST_COMPANY);
  const companyAliases = resolved.aliases;
  console.log(`  Company aliases: [${companyAliases.join(', ')}]\n`);

  // Helper to build filter input matching loadMoreV2Action's Tier 1 shape
  const buildFilters = (excludePersonIds: string[]): PersonFilters => ({
    company: TEST_COMPANY,
    companyAliases: companyAliases.length > 0 ? companyAliases : undefined,
    role: 'Software Engineer',
    requireEmail: false,
    excludePersonIds,
    limit: 25,
  });

  // ── Test 1: initial query returns all 7 ──
  console.log('── Test 1: Initial query (no excludes) ──');
  const initialResults = await findPeopleByFilters(buildFilters([]));
  assert(initialResults.length === 7, `returned ${initialResults.length} results (expected 7)`);
  assert(
    initialResults.every(p => p.company === TEST_COMPANY),
    'all results have correct company'
  );
  assert(
    initialResults.every(p => p.role === 'Software Engineer'),
    'all results have role "Software Engineer"'
  );
  console.log('');

  // ── Test 2: probe with first 3 excluded returns remaining 4 ──
  console.log('── Test 2: Probe with first 3 excluded ──');
  const firstThreeIds = initialResults.slice(0, 3).map(p => p.id);
  const remainingResults = await findPeopleByFilters(buildFilters(firstThreeIds));
  assert(
    remainingResults.length === 4,
    `returned ${remainingResults.length} results (expected 4 = 7 - 3)`
  );
  assert(
    remainingResults.every(p => !firstThreeIds.includes(p.id)),
    'none of the returned results are in the excluded set'
  );
  console.log('');

  // ── Test 3: probe with all 7 excluded returns empty (would fall through to Apify) ──
  console.log('── Test 3: Probe with all 7 excluded (DB drained) ──');
  const allIds = initialResults.map(p => p.id);
  const drainedResults = await findPeopleByFilters(buildFilters(allIds));
  assert(
    drainedResults.length === 0,
    `returned ${drainedResults.length} results (expected 0 — DB is drained, loadMoreV2Action would fall through to Apify)`
  );
  console.log('');

  // ── Test 4: simulate pagination across multiple Load More clicks ──
  console.log('── Test 4: Multi-click pagination simulation ──');
  let excluded: string[] = [];
  let totalShown = 0;
  let clicks = 0;
  const maxClicks = 10; // safety cap

  // Initial "search" returns 25 (but we only seeded 7 so gets all 7)
  const initial = await findPeopleByFilters(buildFilters(excluded));
  excluded = [...excluded, ...initial.map(p => p.id)];
  totalShown += initial.length;
  console.log(`  Initial search: returned ${initial.length}, total shown=${totalShown}`);

  // Load More clicks — each drains next chunk from DB
  while (clicks < maxClicks) {
    clicks++;
    const probe = await findPeopleByFilters(buildFilters(excluded));
    if (probe.length === 0) {
      console.log(`  Click ${clicks}: DB drained → loadMoreV2Action would call Apify`);
      break;
    }
    excluded = [...excluded, ...probe.map(p => p.id)];
    totalShown += probe.length;
    console.log(`  Click ${clicks}: returned ${probe.length}, total shown=${totalShown}`);
  }
  assert(totalShown === 7, `total shown across clicks = ${totalShown} (expected 7)`);
  assert(clicks === 1, `number of clicks before DB drained = ${clicks} (expected 1, since all 7 fit in one page)`);
  console.log('');

  // ── Cleanup ──
  console.log('── Cleanup ──');
  const deleted = await prisma.person.deleteMany({
    where: { company: TEST_COMPANY },
  });
  console.log(`  Deleted ${deleted.count} test Person rows`);
  console.log('');

  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Test crashed:', err);
  // Best-effort cleanup
  try {
    await prisma.person.deleteMany({ where: { company: TEST_COMPANY } });
  } catch {}
  await prisma.$disconnect();
  process.exit(1);
});
