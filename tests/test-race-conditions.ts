/**
 * Test: Race condition fixes for concurrent scrapes
 *
 * Test 1: Atomic prescrape lock — only one concurrent UPDATE should succeed
 * Test 2: Person duplicate safety net — concurrent creates should not produce duplicates
 *
 * Usage: npx tsx tests/test-race-conditions.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { saveScrapedProfile } from '../src/lib/db/person-service';

const prisma = new PrismaClient();

async function testAtomicPrescrapeLock() {
  console.log('--- Test 1: Atomic prescrape lock ---');

  // Create a test Search record
  const search = await prisma.search.create({
    data: {
      name: null,
      company: '__race_test__',
      role: null,
      university: null,
      location: null,
      queryHash: '__race_test_hash__',
      lastCsePageScraped: 0,
      cseExhausted: false,
      prescrapeStatus: null,
    },
  });

  console.log(`Created test Search id=${search.id}`);

  // Fire 10 concurrent atomic UPDATE attempts
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      prisma.$executeRaw`
        UPDATE "Search"
        SET "prescrapeStatus" = 'RUNNING', "updatedAt" = NOW()
        WHERE id = ${search.id}
          AND ("prescrapeStatus" IS NULL OR "prescrapeStatus" != 'RUNNING')
      `
    )
  );

  const winners = results.filter(r => r === 1).length;
  const losers = results.filter(r => r === 0).length;

  console.log(`Results: ${winners} winner(s), ${losers} loser(s)`);

  // Cleanup
  await prisma.search.delete({ where: { id: search.id } });

  if (winners === 1 && losers === 9) {
    console.log('PASS: Exactly 1 concurrent update succeeded\n');
  } else {
    console.error(`FAIL: Expected 1 winner and 9 losers, got ${winners} and ${losers}\n`);
    process.exit(1);
  }
}

async function testPersonDuplicateSafetyNet() {
  console.log('--- Test 2: Person duplicate safety net ---');

  const testName = '__Race Test Person__';
  const testCompany = '__Race Test Corp__';

  // Cleanup from prior runs
  await prisma.sourceLink.deleteMany({
    where: { person: { fullName: testName, company: testCompany } },
  });
  await prisma.person.deleteMany({
    where: { fullName: testName, company: testCompany },
  });

  const profile = {
    fullName: testName,
    firstName: '__Race',
    lastName: 'Test Person__',
    company: testCompany,
    role: 'Test Engineer',
    linkedinUrl: 'https://linkedin.com/in/__race-test__',
    email: null,
    city: null,
    state: null,
    country: null,
    schools: [] as string[],
    experienceHistory: [] as any[],
    educationHistory: [] as any[],
  };

  // Fire 5 concurrent saveScrapedProfile calls
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      saveScrapedProfile(
        profile,
        `https://example.com/test-${i}`,
        `Test Source ${i}`,
        null,
        'example.com',
        testCompany
      )
    )
  );

  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected');

  console.log(`Results: ${fulfilled} fulfilled, ${rejected.length} rejected`);
  if (rejected.length > 0) {
    rejected.forEach(r => console.error('  Rejected:', (r as PromiseRejectedResult).reason?.message));
  }

  // Check how many Person records exist
  const count = await prisma.person.count({
    where: { fullName: testName, company: testCompany },
  });

  console.log(`Person records in DB: ${count}`);

  // Cleanup
  await prisma.sourceLink.deleteMany({
    where: { person: { fullName: testName, company: testCompany } },
  });
  await prisma.person.deleteMany({
    where: { fullName: testName, company: testCompany },
  });

  if (count === 1) {
    console.log('PASS: Exactly 1 Person record created despite 5 concurrent attempts\n');
  } else {
    console.error(`FAIL: Expected 1 Person record, found ${count}\n`);
    process.exit(1);
  }
}

async function main() {
  try {
    await testAtomicPrescrapeLock();
    await testPersonDuplicateSafetyNet();
    console.log('All race condition tests passed!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
