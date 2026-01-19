import dotenv from 'dotenv';
import path from 'path';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import prisma from '@/lib/prisma';
import { generateEmailWithGroq, GroqRateLimitError, PersonData, TemplatePrompt } from '@/lib/services/groq-email';

// Load .env BEFORE importing other modules
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

console.log('AlumniReach Worker');
console.log('==================');
console.log('');

// Create Redis connection
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('ERROR: REDIS_URL environment variable is not set');
  process.exit(1);
}

console.log(`[Worker] Connecting to Redis: ${redisUrl.substring(0, 20)}...`);

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Add Redis connection event listeners
let redisConnected = false;
let redisReady = false;

connection.on('connect', () => {
  console.log('[Worker] ✓ Redis connection established');
  redisConnected = true;
});

connection.on('ready', () => {
  console.log('[Worker] ✓ Redis is ready');
  redisReady = true;
});

connection.on('error', (error) => {
  console.error('[Worker] ✗ Redis connection error:', error.message);
  redisConnected = false;
  redisReady = false;
});

connection.on('close', () => {
  console.log('[Worker] Redis connection closed');
  redisConnected = false;
  redisReady = false;
});

connection.on('reconnecting', () => {
  console.log('[Worker] Redis reconnecting...');
});

// Initialize worker (async function to handle Redis connection)
async function initializeWorker() {
  // Wait for Redis to be ready before creating worker
  console.log('[Worker] Waiting for Redis to be ready...');
  try {
    // Test connection with a ping
    await connection.ping();
    console.log('[Worker] ✓ Redis ping successful');
    redisReady = true;
  } catch (error) {
    console.error('[Worker] ✗ Redis ping failed:', error);
    // Wait for ready event
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout - worker cannot start without Redis'));
      }, 10000);

      connection.once('ready', () => {
        clearTimeout(timeout);
        console.log('[Worker] ✓ Redis ready event received');
        redisReady = true;
        resolve();
      });

      connection.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Create worker
  const worker = new Worker(
  'email-generation',
  async (job) => {
    const { userCandidateId, templatePrompt, personData } = job.data as {
      userCandidateId: string;
      templatePrompt: TemplatePrompt;
      personData: PersonData;
    };

    console.log(`[Worker] [Job ${job.id}] Processing email generation for userCandidateId: ${userCandidateId}`);
    console.log(`[Worker] [Job ${job.id}] Job data:`, {
      userCandidateId,
      hasTemplatePrompt: !!templatePrompt,
      hasPersonData: !!personData,
      personName: personData?.fullName,
    });

    try {
      // Generate email with Groq
      console.log(`[Worker] [Job ${job.id}] Calling generateEmailWithGroq...`);
      const generated = await generateEmailWithGroq(templatePrompt, personData);
      console.log(`[Worker] [Job ${job.id}] Email generated successfully`);

      // Update EmailDraft with AI-generated content
      console.log(`[Worker] [Job ${job.id}] Updating EmailDraft in database...`);
      await prisma.emailDraft.update({
        where: { userCandidateId },
        data: {
          subject: generated.subject,
          body: generated.body,
          status: 'APPROVED', // Mark as approved (ready for user review)
        },
      });

      console.log(`[Worker] [Job ${job.id}] Successfully generated and saved email for userCandidateId: ${userCandidateId}`);
      return { success: true, userCandidateId };
    } catch (error) {
      console.error(`[Worker] [Job ${job.id}] Error caught in worker:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });

      // Check if it's a rate limit error - should retry
      if (error instanceof GroqRateLimitError) {
        console.warn(`[Worker] [Job ${job.id}] Rate limit error, will retry: ${error.message}`);
        throw error; // Re-throw to trigger retry
      }

      // For other errors, log but don't fail the job
      // User still has a placeholder draft they can use
      console.error(`[Worker] [Job ${job.id}] Error generating email (non-rate-limit):`, error);
      
      // Update draft status to indicate generation failed
      // But keep the placeholder content
      try {
        await prisma.emailDraft.update({
          where: { userCandidateId },
          data: {
            status: 'PENDING', // Keep as pending (placeholder still available)
          },
        });
      } catch (updateError) {
        console.error(`[Job ${job.id}] Failed to update draft status:`, updateError);
      }

      // Don't throw - job completes but with placeholder
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 jobs simultaneously
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  }
  );

  // Event listeners
  worker.on('ready', () => {
    console.log('[Worker] ✓ Worker is ready and listening for jobs');
  });

  worker.on('active', (job) => {
    console.log(`[Worker] → Job ${job.id} is now active (processing)`);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] ✓ Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] ✗ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] ✗ Worker error:', err);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[Worker] ⚠ Job ${jobId} stalled (taking too long)`);
  });

  worker.on('closing', () => {
    console.log('[Worker] Worker is closing...');
  });

  worker.on('closed', () => {
    console.log('[Worker] Worker closed');
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
  });

  console.log('');
  console.log('[Worker] ========================================');
  console.log('[Worker] Worker initialization complete');
  console.log('[Worker] Redis status:', redisReady ? '✓ Ready' : '✗ Not ready');
  console.log('[Worker] Waiting for jobs...');
  console.log('[Worker] ========================================');
  console.log('');
  console.log('Press Ctrl+C to stop');
}

// Start the worker
initializeWorker().catch((error) => {
  console.error('[Worker] Failed to initialize worker:', error);
  process.exit(1);
});
