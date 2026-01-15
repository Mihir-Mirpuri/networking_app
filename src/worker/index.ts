import dotenv from 'dotenv';
import path from 'path';

// Load .env BEFORE importing other modules
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
console.log('Loaded env from:', path.resolve(process.cwd(), '.env'));
console.log('APOLLO_API_KEY in worker:', process.env.APOLLO_API_KEY ? 'Set' : 'Not set');

// Now dynamically import everything else
async function main() {
  const { Worker } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;
  const { runDiscovery } = await import('@/lib/services/discovery');
  const { runEnrichment } = await import('@/lib/services/enrichment');
  const { runResearch } = await import('@/lib/services/research');

  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  console.log('Starting AlumniReach workers...');

  // Discovery worker
  const discoveryWorker = new Worker(
    'discovery',
    async (job) => {
      console.log(`Processing discovery job for campaign: ${job.data.campaignId}`);
      try {
        const count = await runDiscovery(job.data.campaignId);
        console.log(`Discovery complete: found ${count} candidates`);
        return { candidatesFound: count };
      } catch (error) {
        console.error('Discovery job failed:', error);
        throw error;
      }
    },
    { connection, concurrency: 2 }
  );

  // Enrichment worker
  const enrichmentWorker = new Worker(
    'enrichment',
    async (job) => {
      console.log(`Processing enrichment job for campaign: ${job.data.campaignId}`);
      try {
        const count = await runEnrichment(job.data.campaignId);
        console.log(`Enrichment complete: enriched ${count} candidates`);
        return { candidatesEnriched: count };
      } catch (error) {
        console.error('Enrichment job failed:', error);
        throw error;
      }
    },
    { connection, concurrency: 1 }
  );

  // Research worker
  const researchWorker = new Worker(
    'research',
    async (job) => {
      console.log(`Processing research job for candidate: ${job.data.candidateId}`);
      try {
        const count = await runResearch(job.data.candidateId);
        console.log(`Research complete: found ${count} links`);
        return { linksFound: count };
      } catch (error) {
        console.error('Research job failed:', error);
        throw error;
      }
    },
    { connection, concurrency: 3 }
  );

  // Handle worker events
  [discoveryWorker, enrichmentWorker, researchWorker].forEach((worker) => {
    worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message);
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down workers...');
    await Promise.all([
      discoveryWorker.close(),
      enrichmentWorker.close(),
      researchWorker.close(),
    ]);
    process.exit(0);
  });

  console.log('Workers started and waiting for jobs...');
}

main().catch(console.error);
