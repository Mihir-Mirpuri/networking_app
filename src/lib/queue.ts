import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

// Create Redis connection
let redisConnection: Redis | null = null;

function getRedisConnection(): Redis {
  if (!redisConnection) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.error('[Queue] ERROR: REDIS_URL environment variable is not set');
      throw new Error('REDIS_URL environment variable is not set');
    }

    console.log('[Queue] Creating Redis connection...');
    try {
      redisConnection = new Redis(redisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false, // Disable ready check for Upstash compatibility
      });
      console.log('[Queue] Redis connection created successfully');
    } catch (error) {
      console.error('[Queue] Failed to create Redis connection:', error);
      throw error;
    }
  }

  return redisConnection;
}

// Create email generation queue
export const emailGenerationQueue = new Queue('email-generation', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2 seconds, then 4s, 8s
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep max 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Create queue events for monitoring
export const queueEvents = new QueueEvents('email-generation', {
  connection: getRedisConnection(),
});

// Handle connection errors
try {
  const conn = getRedisConnection();
  conn.on('error', (error) => {
    console.error('[Queue] Redis connection error:', error);
  });

  conn.on('connect', () => {
    console.log('[Queue] Redis connected successfully');
  });

  conn.on('ready', () => {
    console.log('[Queue] Redis ready to accept commands');
  });

  conn.on('close', () => {
    console.log('[Queue] Redis connection closed');
  });
} catch (error) {
  console.error('[Queue] Failed to set up Redis event listeners:', error);
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGTERM', async () => {
    await emailGenerationQueue.close();
    await queueEvents.close();
    await redisConnection?.quit();
  });

  process.on('SIGINT', async () => {
    await emailGenerationQueue.close();
    await queueEvents.close();
    await redisConnection?.quit();
  });
}
