import { ApifyClient } from 'apify-client';
import { PrismaClient } from '@prisma/client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = 'LpVuK3Zozwuipa5bp';
const prisma = new PrismaClient();

interface BenchmarkResult {
  config: string;
  batchSize: number;
  numBatches: number;
  totalTime: number;
  avgPerProfile: number;
}

async function runBatch(client: ApifyClient, urls: string[]): Promise<number> {
  const start = Date.now();

  const run = await client.actor(ACTOR_ID).call({
    profileScraperMode: 'Profile details no email ($4 per 1k)',
    queries: urls,
  });

  // Wait for results to ensure completion
  await client.dataset(run.defaultDatasetId).listItems();

  return Date.now() - start;
}

async function benchmark(
  client: ApifyClient,
  urls: string[],
  batchSize: number,
  maxConcurrent: number
): Promise<BenchmarkResult> {
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  const config = `${batchSize} URLs/batch × ${batches.length} batches (${maxConcurrent} concurrent)`;
  console.log(`\nTesting: ${config}`);

  const start = Date.now();

  // Process batches with controlled concurrency
  for (let i = 0; i < batches.length; i += maxConcurrent) {
    const concurrentBatches = batches.slice(i, i + maxConcurrent);
    await Promise.all(concurrentBatches.map(batch => runBatch(client, batch)));
  }

  const totalTime = (Date.now() - start) / 1000;
  const avgPerProfile = totalTime / urls.length;

  console.log(`  Total: ${totalTime.toFixed(2)}s | Per profile: ${avgPerProfile.toFixed(2)}s`);

  return {
    config,
    batchSize,
    numBatches: batches.length,
    totalTime,
    avgPerProfile,
  };
}

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
  console.log(`Benchmarking with ${urls.length} URLs\n`);

  const client = new ApifyClient({ token: APIFY_API_KEY });

  const results: BenchmarkResult[] = [];

  // Test configurations: [batchSize, maxConcurrent]
  const configs: [number, number][] = [
    [20, 1],  // 1 batch of 20
    [10, 2],  // 2 batches of 10, 2 concurrent
    [10, 1],  // 2 batches of 10, sequential
    [5, 4],   // 4 batches of 5, 4 concurrent
  ];

  for (const [batchSize, maxConcurrent] of configs) {
    const result = await benchmark(client, urls, batchSize, maxConcurrent);
    results.push(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK RESULTS (20 profiles)');
  console.log('='.repeat(80));
  console.log('| Config                                          | Total Time | Per Profile |');
  console.log('|' + '-'.repeat(78) + '|');

  // Sort by total time
  results.sort((a, b) => a.totalTime - b.totalTime);

  for (const r of results) {
    const config = r.config.padEnd(47);
    const total = `${r.totalTime.toFixed(2)}s`.padStart(10);
    const avg = `${r.avgPerProfile.toFixed(2)}s`.padStart(11);
    console.log(`| ${config} | ${total} | ${avg} |`);
  }

  console.log('='.repeat(80));
  console.log(`\n🏆 FASTEST: ${results[0].config}`);
  console.log(`   ${results[0].totalTime.toFixed(2)}s total (${results[0].avgPerProfile.toFixed(2)}s per profile)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
