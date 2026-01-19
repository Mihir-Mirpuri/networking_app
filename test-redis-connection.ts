import dotenv from 'dotenv';
import path from 'path';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testRedisConnection() {
  console.log('Redis Connection Test');
  console.log('=====================\n');

  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ ERROR: REDIS_URL environment variable is not set');
    console.log('\nPlease set REDIS_URL in your .env file');
    process.exit(1);
  }

  console.log(`✓ REDIS_URL found: ${redisUrl.substring(0, 20)}...`);
  console.log('');

  // Test 1: Basic Redis Connection
  console.log('Test 1: Basic Redis Connection');
  console.log('--------------------------------');
  try {
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await new Promise<void>((resolve, reject) => {
      redis.on('connect', () => {
        console.log('✓ Redis connection established');
      });

      redis.on('ready', () => {
        console.log('✓ Redis is ready');
        resolve();
      });

      redis.on('error', (error) => {
        console.error('❌ Redis connection error:', error.message);
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Connection timeout after 5 seconds'));
      }, 5000);
    });

    // Test basic operations
    await redis.set('test:key', 'test:value');
    const value = await redis.get('test:key');
    if (value === 'test:value') {
      console.log('✓ Redis read/write test passed');
    } else {
      console.error('❌ Redis read/write test failed');
    }
    await redis.del('test:key');

    await redis.quit();
    console.log('✓ Redis connection closed successfully\n');
  } catch (error) {
    console.error('❌ Basic Redis connection test failed:', error instanceof Error ? error.message : String(error));
    console.log('\nPlease check:');
    console.log('1. Redis server is running');
    console.log('2. REDIS_URL is correct');
    console.log('3. Network connectivity to Redis');
    process.exit(1);
  }

  // Test 2: BullMQ Queue Connection
  console.log('Test 2: BullMQ Queue Connection');
  console.log('--------------------------------');
  try {
    const queueConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await new Promise<void>((resolve, reject) => {
      queueConnection.on('ready', () => {
        resolve();
      });

      queueConnection.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Queue connection timeout'));
      }, 5000);
    });

    const testQueue = new Queue('test-queue', {
      connection: queueConnection,
    });

    console.log('✓ BullMQ Queue created');

    // Test adding a job
    const testJob = await testQueue.add('test-job', { test: 'data' });
    console.log(`✓ Test job added with ID: ${testJob.id}`);

    // Check job state
    const jobState = await testJob.getState();
    console.log(`✓ Job state: ${jobState}`);

    // Clean up
    await testJob.remove();
    await testQueue.close();
    await queueConnection.quit();
    console.log('✓ Queue connection closed successfully\n');
  } catch (error) {
    console.error('❌ BullMQ Queue test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Test 3: Email Generation Queue
  console.log('Test 3: Email Generation Queue');
  console.log('--------------------------------');
  try {
    const emailQueueConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await new Promise<void>((resolve, reject) => {
      emailQueueConnection.on('ready', () => {
        resolve();
      });

      emailQueueConnection.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Email queue connection timeout'));
      }, 5000);
    });

    const emailQueue = new Queue('email-generation', {
      connection: emailQueueConnection,
    });

    console.log('✓ Email generation queue created');

    // Check existing jobs
    const waiting = await emailQueue.getWaiting();
    const active = await emailQueue.getActive();
    const completed = await emailQueue.getCompleted();
    const failed = await emailQueue.getFailed();

    console.log(`  - Waiting jobs: ${waiting.length}`);
    console.log(`  - Active jobs: ${active.length}`);
    console.log(`  - Completed jobs: ${completed.length}`);
    console.log(`  - Failed jobs: ${failed.length}`);

    if (waiting.length > 0 || active.length > 0) {
      console.log('\n⚠️  WARNING: There are jobs in the queue that haven\'t been processed!');
      console.log('   This suggests the worker might not be running or connected.');
    }

    // Test adding a job
    const testEmailJob = await emailQueue.add(
      'generate-email',
      {
        userCandidateId: 'test-id',
        templatePrompt: { subject: 'Test', body: 'Test body' },
        personData: {
          fullName: 'Test Person',
          firstName: 'Test',
          lastName: 'Person',
          company: 'Test Company',
          role: 'Test Role',
          university: 'Test University',
        },
      },
      {
        jobId: 'test-email-job',
      }
    );

    console.log(`✓ Test email job added with ID: ${testEmailJob.id}`);

    // Wait a moment and check if it's still waiting (worker should pick it up)
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const jobState = await testEmailJob.getState();
    console.log(`✓ Job state after 2 seconds: ${jobState}`);

    if (jobState === 'waiting') {
      console.log('\n⚠️  WARNING: Job is still waiting after 2 seconds.');
      console.log('   This means the worker is not processing jobs.');
      console.log('   Check if the worker is running: npm run worker');
    }

    // Clean up test job
    await testEmailJob.remove();
    await emailQueue.close();
    await emailQueueConnection.quit();
    console.log('✓ Email queue connection closed successfully\n');
  } catch (error) {
    console.error('❌ Email generation queue test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log('✅ All Redis tests passed!');
  console.log('\nYour Redis connection is working correctly.');
  console.log('If jobs are still not processing, check:');
  console.log('1. Worker is running: npm run worker');
  console.log('2. Worker terminal shows Redis connection logs');
  console.log('3. GROQ_API_KEY is set in .env');
}

testRedisConnection().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
