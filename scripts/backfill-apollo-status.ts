/**
 * Backfill apolloStatus for existing Person records
 *
 * Logic:
 * - Has email → SUCCESS (Apollo found the person and returned data)
 * - No email + apolloEnrichedAt set → NOT_FOUND (Apollo was called but found nothing)
 * - No email + no apolloEnrichedAt → leave null (will be retried)
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Backfilling apolloStatus ===\n');

  // Count current state
  const total = await prisma.person.count();
  const withEmail = await prisma.person.count({ where: { email: { not: null } } });
  const withoutEmailButEnriched = await prisma.person.count({
    where: {
      email: null,
      apolloEnrichedAt: { not: null },
    },
  });
  const withoutEmailNoEnriched = await prisma.person.count({
    where: {
      email: null,
      apolloEnrichedAt: null,
    },
  });

  console.log(`Total people: ${total}`);
  console.log(`With email (will be SUCCESS): ${withEmail}`);
  console.log(`Without email + apolloEnrichedAt (will be NOT_FOUND): ${withoutEmailButEnriched}`);
  console.log(`Without email + no apolloEnrichedAt (will remain null): ${withoutEmailNoEnriched}`);
  console.log('');

  // Update people with email → SUCCESS
  const successResult = await prisma.person.updateMany({
    where: {
      email: { not: null },
      apolloStatus: null,
    },
    data: {
      apolloStatus: 'SUCCESS',
    },
  });
  console.log(`✅ Set ${successResult.count} people to SUCCESS`);

  // Update people without email but with apolloEnrichedAt → NOT_FOUND
  const notFoundResult = await prisma.person.updateMany({
    where: {
      email: null,
      apolloEnrichedAt: { not: null },
      apolloStatus: null,
    },
    data: {
      apolloStatus: 'NOT_FOUND',
    },
  });
  console.log(`✅ Set ${notFoundResult.count} people to NOT_FOUND`);

  // Verify final state
  console.log('\n=== Final State ===');
  const successCount = await prisma.person.count({ where: { apolloStatus: 'SUCCESS' } });
  const notFoundCount = await prisma.person.count({ where: { apolloStatus: 'NOT_FOUND' } });
  const apiErrorCount = await prisma.person.count({ where: { apolloStatus: 'API_ERROR' } });
  const skippedCount = await prisma.person.count({ where: { apolloStatus: 'SKIPPED' } });
  const nullCount = await prisma.person.count({ where: { apolloStatus: null } });

  console.log(`SUCCESS: ${successCount}`);
  console.log(`NOT_FOUND: ${notFoundCount}`);
  console.log(`API_ERROR: ${apiErrorCount}`);
  console.log(`SKIPPED: ${skippedCount}`);
  console.log(`null (unprocessed): ${nullCount}`);

  await prisma.$disconnect();
}

main().catch(console.error);
