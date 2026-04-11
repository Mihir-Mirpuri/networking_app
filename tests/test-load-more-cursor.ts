/**
 * Test: Load More Cursor Tracking
 *
 * Validates the unified server-side cursor model for Load More:
 *   1. Pure helper functions (computeNextApifyPage, hasMoreApifyPages)
 *   2. DB persistence: Search row cursor/totalMatches survives across calls
 *   3. Exhaustion math: stops fetching once cursor * 25 >= totalLinkedInMatches
 *   4. Path C fix: DB-only initial search leaves cursor at 0, Load More fetches page 1
 *
 * This test does NOT call Apify — it seeds fake Search rows and verifies the
 * lookup/update logic in isolation.
 *
 * Run: npx tsx tests/test-load-more-cursor.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  computeNextApifyPage,
  hasMoreApifyPages,
  APIFY_PAGE_SIZE,
} from '../src/lib/services/apify-pagination';

const prisma = new PrismaClient();

// Use a distinctive test company so we don't collide with real data.
const TEST_COMPANY = '__loadmore_cursor_test__';

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

function assertEq<T>(actual: T, expected: T, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function cleanup() {
  await prisma.search.deleteMany({
    where: { company: TEST_COMPANY },
  });
}

// ─── Tier 1: Pure helper tests ────────────────────────────────────────────────

function testPureHelpers() {
  console.log('\n── Pure pagination helpers ──');

  // Fresh cursor: never scraped
  assertEq(
    computeNextApifyPage(0, null),
    { shouldFetch: true, nextPage: 1 },
    'cursor=0, total=null → fetch page 1',
  );

  // Cursor at 1, total unknown
  assertEq(
    computeNextApifyPage(1, null),
    { shouldFetch: true, nextPage: 2 },
    'cursor=1, total=null → fetch page 2',
  );

  // Cursor at 3, total=100 (3*25=75 < 100) → more to fetch
  assertEq(
    computeNextApifyPage(3, 100),
    { shouldFetch: true, nextPage: 4 },
    'cursor=3, total=100 → fetch page 4 (75<100)',
  );

  // Cursor at 4, total=100 (4*25=100 == 100) → exhausted
  assertEq(
    computeNextApifyPage(4, 100),
    { shouldFetch: false, nextPage: 4 },
    'cursor=4, total=100 → exhausted (100==100)',
  );

  // Cursor at 5, total=100 (5*25=125 > 100) → exhausted
  assertEq(
    computeNextApifyPage(5, 100),
    { shouldFetch: false, nextPage: 5 },
    'cursor=5, total=100 → exhausted (125>100)',
  );

  // Total=0 is treated as unknown (nothing to compare against)
  assertEq(
    computeNextApifyPage(3, 0),
    { shouldFetch: true, nextPage: 4 },
    'cursor=3, total=0 → fetch (treat 0 as unknown)',
  );

  // hasMoreApifyPages
  assert(hasMoreApifyPages(1, 100) === true, 'hasMore: cursor=1, total=100 → true');
  assert(hasMoreApifyPages(4, 100) === false, 'hasMore: cursor=4, total=100 → false (exact)');
  assert(hasMoreApifyPages(5, 100) === false, 'hasMore: cursor=5, total=100 → false (over)');
  assert(hasMoreApifyPages(1, null) === false, 'hasMore: cursor=1, total=null → false');
  assert(hasMoreApifyPages(1, 0) === false, 'hasMore: cursor=1, total=0 → false');

  assert(APIFY_PAGE_SIZE === 25, 'APIFY_PAGE_SIZE is 25');
}

// ─── Tier 2: DB cursor lookup tests ───────────────────────────────────────────

async function testDbCursorLookup() {
  console.log('\n── DB cursor lookup ──');

  // Seed a Search row with cursor=3, totalMatches=100
  const row = await prisma.search.create({
    data: {
      company: TEST_COMPANY,
      role: null,
      university: null,
      location: null,
      queryHash: 'test-hash-1',
      lastCsePageScraped: 3,
      totalLinkedInMatches: 100,
    },
  });

  // Look it up the same way loadMoreV2Action does
  const looked = await prisma.$queryRaw<
    Array<{ id: string; lastCsePageScraped: number; totalLinkedInMatches: number | null }>
  >`
    SELECT "id", "lastCsePageScraped", "totalLinkedInMatches"
    FROM "Search"
    WHERE COALESCE(company, '') = ${TEST_COMPANY}
      AND COALESCE(role, '') = ''
      AND COALESCE(university, '') = ''
      AND COALESCE(location, '') = ''
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;

  assert(looked.length === 1, 'Looked up seeded Search row');
  assertEq(looked[0]?.lastCsePageScraped, 3, 'Cursor = 3');
  assertEq(looked[0]?.totalLinkedInMatches, 100, 'totalMatches = 100');

  // Combine with the helper to simulate Load More decision
  const decision = computeNextApifyPage(
    looked[0]!.lastCsePageScraped,
    looked[0]!.totalLinkedInMatches,
  );
  assertEq(decision, { shouldFetch: true, nextPage: 4 }, 'Load More decision: fetch page 4');

  // Simulate a successful fetch: update cursor to 4
  await prisma.search.update({
    where: { id: row.id },
    data: { lastCsePageScraped: 4 },
  });

  // Next click — should now be exhausted (4 * 25 = 100)
  const afterRow = await prisma.search.findUnique({
    where: { id: row.id },
    select: { lastCsePageScraped: true, totalLinkedInMatches: true },
  });
  const decision2 = computeNextApifyPage(
    afterRow!.lastCsePageScraped,
    afterRow!.totalLinkedInMatches,
  );
  assertEq(
    decision2,
    { shouldFetch: false, nextPage: 4 },
    'After cursor=4, totalMatches=100 → exhausted',
  );
}

// ─── Tier 3: Path C fix — DB-only initial search leaves cursor at 0 ──────────

async function testPathCFix() {
  console.log('\n── Path C fix: DB-only initial search ──');

  // Clean slate — create a Search row as if initial search was DB-only
  // (never called Apify). The upsert in searchPeopleV2Action would write
  // lastCsePageScraped = newCursor = existingCursor = 0 for a fresh row.
  await cleanup();

  const row = await prisma.search.create({
    data: {
      company: TEST_COMPANY,
      role: null,
      university: null,
      location: null,
      queryHash: 'test-hash-pathc',
      lastCsePageScraped: 0, // Path C: never fetched Apify
      totalLinkedInMatches: null, // unknown
    },
  });

  // Look up as Load More would
  const decision = computeNextApifyPage(row.lastCsePageScraped, row.totalLinkedInMatches);
  assertEq(
    decision,
    { shouldFetch: true, nextPage: 1 },
    'Path C Load More fetches Apify page 1 (fix for page-1 skip bug)',
  );

  // Contrast with old buggy behavior (client sent linkedInPage=2)
  console.log('  NOTE: Before this fix, Path C Load More would jump to page 2, skipping page 1.');
}

// ─── Tier 4: Cross-session continuity ─────────────────────────────────────────

async function testCrossSessionContinuity() {
  console.log('\n── Cross-session continuity ──');

  await cleanup();

  // User A: initial search calls Apify page 1 (cursor→1, totalMatches=300)
  const row = await prisma.search.create({
    data: {
      company: TEST_COMPANY,
      role: null,
      university: null,
      location: null,
      queryHash: 'test-hash-session',
      lastCsePageScraped: 1,
      totalLinkedInMatches: 300,
    },
  });

  // User A clicks Load More 3 times → cursor advances to 4
  for (let i = 2; i <= 4; i++) {
    const current = await prisma.search.findUnique({
      where: { id: row.id },
      select: { lastCsePageScraped: true, totalLinkedInMatches: true },
    });
    const decision = computeNextApifyPage(
      current!.lastCsePageScraped,
      current!.totalLinkedInMatches,
    );
    assert(decision.shouldFetch, `Load More click ${i - 1}: shouldFetch=true`);
    assertEq(decision.nextPage, i, `Load More click ${i - 1}: nextPage=${i}`);
    await prisma.search.update({
      where: { id: row.id },
      data: { lastCsePageScraped: i },
    });
  }

  // User B does the same search. Initial search upserts and sets newCursor=1
  // (initial always starts fresh). But the upsert currently resets the cursor
  // to 1. This is expected per design: initial search always fetches page 1.
  //
  // Then User B's Load More picks up from cursor=1 → fetches page 2.
  // NOTE: This is the documented tradeoff. User B won't resume from User A's
  // exact position, but User A already persisted pages 1-4 profiles into the
  // DB so User B sees them via Path C (DB-first).
  const after = await prisma.search.findUnique({
    where: { id: row.id },
    select: { lastCsePageScraped: true, totalLinkedInMatches: true },
  });
  assertEq(after!.lastCsePageScraped, 4, 'After User A session: cursor=4');
  assertEq(after!.totalLinkedInMatches, 300, 'totalMatches preserved across updates');

  // If User A clicks Load More again: fetches page 5 (still not exhausted, 5*25=125 < 300)
  const stillMore = computeNextApifyPage(4, 300);
  assertEq(stillMore, { shouldFetch: true, nextPage: 5 }, 'cursor=4, total=300 → fetch page 5');

  // Simulate fetching all 12 pages until exhausted (12*25=300 == 300)
  await prisma.search.update({
    where: { id: row.id },
    data: { lastCsePageScraped: 12 },
  });
  const done = computeNextApifyPage(12, 300);
  assertEq(done, { shouldFetch: false, nextPage: 12 }, 'cursor=12, total=300 → exhausted');
}

async function main() {
  console.log('=== Load More Cursor Tests ===');

  try {
    await cleanup();

    testPureHelpers();
    await testDbCursorLookup();
    await testPathCFix();
    await testCrossSessionContinuity();

    await cleanup();
  } catch (err) {
    console.error('\nTest runner error:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
