import { ApifyClient } from 'apify-client';
import { PrismaClient } from '@prisma/client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = 'LpVuK3Zozwuipa5bp';
const prisma = new PrismaClient();

async function main() {
  if (!APIFY_API_KEY) {
    console.error('APIFY_API_KEY not set');
    process.exit(1);
  }

  // Get 20 URLs from DB
  const people = await prisma.person.findMany({
    where: { linkedinUrl: { not: null } },
    select: { linkedinUrl: true },
    take: 20,
  });

  const urls = people.map(p => p.linkedinUrl!);
  console.log(`Testing: 5 URLs/batch × 4 batches (sequential)\n`);

  const client = new ApifyClient({ token: APIFY_API_KEY });

  // Split into batches of 5
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += 5) {
    batches.push(urls.slice(i, i + 5));
  }

  const totalStart = Date.now();
  const batchTimes: number[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batchStart = Date.now();
    console.log(`Batch ${i + 1}/4 starting...`);

    const run = await client.actor(ACTOR_ID).call({
      profileScraperMode: 'Profile details no email ($4 per 1k)',
      queries: batches[i],
    });

    await client.dataset(run.defaultDatasetId).listItems();

    const batchTime = (Date.now() - batchStart) / 1000;
    batchTimes.push(batchTime);

    const cumulative = (Date.now() - totalStart) / 1000;
    const profilesSoFar = (i + 1) * 5;

    console.log(`  Batch ${i + 1} done: ${batchTime.toFixed(2)}s | Cumulative: ${cumulative.toFixed(2)}s (${profilesSoFar} profiles)\n`);
  }

  const totalTime = (Date.now() - totalStart) / 1000;

  console.log('='.repeat(60));
  console.log('RESULTS: 5 URLs/batch × 4 batches (sequential)');
  console.log('='.repeat(60));
  console.log(`Batch 1 (first 5 profiles):  ${batchTimes[0].toFixed(2)}s`);
  console.log(`Batch 2 (first 10 profiles): ${(batchTimes[0] + batchTimes[1]).toFixed(2)}s cumulative`);
  console.log(`Batch 3 (first 15 profiles): ${(batchTimes[0] + batchTimes[1] + batchTimes[2]).toFixed(2)}s cumulative`);
  console.log(`Batch 4 (all 20 profiles):   ${totalTime.toFixed(2)}s cumulative`);
  console.log('');
  console.log(`Total time: ${totalTime.toFixed(2)}s`);
  console.log(`Per profile: ${(totalTime / 20).toFixed(2)}s`);
  console.log(`Avg batch time: ${(batchTimes.reduce((a, b) => a + b, 0) / 4).toFixed(2)}s`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
