import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const discoveryQueue = new Queue('discovery', { connection });
export const enrichmentQueue = new Queue('enrichment', { connection });
export const researchQueue = new Queue('research', { connection });

export async function addDiscoveryJob(campaignId: string) {
  await discoveryQueue.add('discover', { campaignId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

export async function addEnrichmentJob(campaignId: string) {
  await enrichmentQueue.add('enrich', { campaignId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

export async function addResearchJob(candidateId: string) {
  await researchQueue.add('research', { candidateId }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
  });
}
