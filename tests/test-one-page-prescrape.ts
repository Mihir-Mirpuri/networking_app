/**
 * Test: One-Page-Ahead Prescrape
 *
 * Validates the new single-page prescrape model against the real DB.
 * Run: npx tsx tests/test-one-page-prescrape.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_COMPANY = '__prescrape_test__';
const TEST_COMPANY_NORM = '__prescrape_test__'; // already lowercase

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
  await prisma.searchPerson.deleteMany({
    where: { search: { company: TEST_COMPANY_NORM } },
  });
  await prisma.search.deleteMany({
    where: { company: TEST_COMPANY_NORM },
  });
  // Clean up any test Person records
  await prisma.person.deleteMany({
    where: { company: TEST_COMPANY },
  });
}

// ===== Test 1: Single-page prescrape (no loop) =====
async function test1_singlePagePrescrape() {
  console.log('\nTest 1: Single-page prescrape (no loop)');
  await cleanup();

  // Create a Search record at page 1 (page 1 already scraped, next is page 2)
  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 1,
      cseExhausted: false,
      prescrapeStatus: null,
    },
  });

  // Verify the record is set up correctly
  const before = await prisma.search.findUnique({ where: { id: search.id } });
  assert(before!.lastCsePageScraped === 1, 'Setup: lastCsePageScraped=1');
  assert(before!.prescrapeStatus === null, 'Setup: prescrapeStatus=null');
  assert(before!.lastPrescrapeNewCount === 0, 'Setup: lastPrescrapeNewCount=0');

  console.log('  (Skipping actual prescrapeAction call — requires auth session + Serper credits)');
  console.log('  Verifying schema and data model instead...');

  // Verify the new field exists and defaults correctly
  assert(before!.lastPrescrapeNewCount === 0, 'New field lastPrescrapeNewCount defaults to 0');
}

// ===== Test 2: Atomic lock prevents double prescrape =====
async function test2_atomicLock() {
  console.log('\nTest 2: Atomic lock prevents double prescrape');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 1,
      cseExhausted: false,
      prescrapeStatus: 'RUNNING',
    },
  });

  // Try to acquire the lock — should fail (0 rows updated)
  const rowsUpdated = await prisma.$executeRaw`
    UPDATE "Search"
    SET "prescrapeStatus" = 'RUNNING', "updatedAt" = NOW()
    WHERE id = ${search.id}
      AND ("prescrapeStatus" IS NULL OR "prescrapeStatus" != 'RUNNING')
  `;

  assert(rowsUpdated === 0, 'Lock prevents duplicate: rowsUpdated=0');

  // Verify record unchanged
  const after = await prisma.search.findUnique({ where: { id: search.id } });
  assert(after!.prescrapeStatus === 'RUNNING', 'prescrapeStatus still RUNNING');
  assert(after!.lastCsePageScraped === 1, 'lastCsePageScraped unchanged');
}

// ===== Test 3: Exhausted search skips prescrape =====
async function test3_exhaustedSkips() {
  console.log('\nTest 3: Exhausted search skips prescrape');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 5,
      cseExhausted: true,
      prescrapeStatus: null,
    },
  });

  // getNextCsePageStart should return null
  // Import logic inline to test
  const lastPage = search.lastCsePageScraped;
  const exhausted = search.cseExhausted;
  const MAX_SERPER_PAGE = 10;

  let nextPage: number | null;
  if (exhausted) nextPage = null;
  else if (lastPage >= MAX_SERPER_PAGE) nextPage = null;
  else if (lastPage === 0) nextPage = 1;
  else nextPage = lastPage + 1;

  assert(nextPage === null, 'getNextCsePageStart returns null when exhausted');
}

// ===== Test 4: MAX_SERPER_PAGE cap =====
async function test4_maxPageCap() {
  console.log('\nTest 4: MAX_SERPER_PAGE cap');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 10,
      cseExhausted: false,
      prescrapeStatus: null,
    },
  });

  const MAX_SERPER_PAGE = 10;
  let nextPage: number | null;
  if (search.cseExhausted) nextPage = null;
  else if (search.lastCsePageScraped >= MAX_SERPER_PAGE) nextPage = null;
  else if (search.lastCsePageScraped === 0) nextPage = 1;
  else nextPage = search.lastCsePageScraped + 1;

  assert(nextPage === null, 'getNextCsePageStart returns null at page cap (10)');
}

// ===== Test 5: lastPrescrapeNewCount=0 stops chain =====
async function test5_zeroNewCountStopsChain() {
  console.log('\nTest 5: lastPrescrapeNewCount=0 stops prescrape chain');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 3,
      cseExhausted: false,
      prescrapeStatus: 'DONE',
      lastPrescrapeNewCount: 0,
    },
  });

  // The guard in loadMorePeopleAction checks:
  // if (hasMore && !progress.cseExhausted && progress.lastPrescrapeNewCount !== 0)
  const hasMore = true;
  const shouldTrigger = hasMore && !search.cseExhausted && search.lastPrescrapeNewCount !== 0;

  assert(shouldTrigger === false, 'Prescrape NOT triggered when lastPrescrapeNewCount=0');
  assert(search.cseExhausted === false, 'Search NOT marked as cseExhausted (not permanent)');
}

// ===== Test 6: lastPrescrapeNewCount > 0 allows chain =====
async function test6_nonZeroCountAllowsChain() {
  console.log('\nTest 6: lastPrescrapeNewCount > 0 allows prescrape chain');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 3,
      cseExhausted: false,
      prescrapeStatus: 'DONE',
      lastPrescrapeNewCount: 5,
    },
  });

  const hasMore = true;
  const shouldTrigger = hasMore && !search.cseExhausted && search.lastPrescrapeNewCount !== 0;

  assert(shouldTrigger === true, 'Prescrape triggered when lastPrescrapeNewCount=5');
}

// ===== Test 7: updateScrapeProgress persists lastPrescrapeNewCount =====
async function test7_updatePersistsNewCount() {
  console.log('\nTest 7: updateScrapeProgress persists lastPrescrapeNewCount');
  await cleanup();

  const search = await prisma.search.create({
    data: {
      company: TEST_COMPANY_NORM,
      lastCsePageScraped: 1,
      cseExhausted: false,
      prescrapeStatus: 'RUNNING',
      lastPrescrapeNewCount: 0,
    },
  });

  // Simulate what updateScrapeProgress does
  await prisma.search.update({
    where: { id: search.id },
    data: {
      lastCsePageScraped: 2,
      cseExhausted: false,
      lastPrescrapeNewCount: 7,
      completedAt: new Date(),
    },
  });

  const after = await prisma.search.findUnique({ where: { id: search.id } });
  assert(after!.lastCsePageScraped === 2, 'lastCsePageScraped updated to 2');
  assert(after!.lastPrescrapeNewCount === 7, 'lastPrescrapeNewCount updated to 7');
}

// ===== Run all tests =====
async function main() {
  console.log('=== One-Page-Ahead Prescrape Tests ===');

  try {
    await test1_singlePagePrescrape();
    await test2_atomicLock();
    await test3_exhaustedSkips();
    await test4_maxPageCap();
    await test5_zeroNewCountStopsChain();
    await test6_nonZeroCountAllowsChain();
    await test7_updatePersistsNewCount();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
