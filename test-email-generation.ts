import dotenv from 'dotenv';
import path from 'path';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import prisma from './src/lib/prisma';
import type { TemplatePrompt, PersonData } from './src/lib/services/groq-email';
import { EMAIL_TEMPLATES } from './src/lib/constants';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testEmailGeneration() {
  console.log('Email Generation Test');
  console.log('====================\n');

  // Check required environment variables
  if (!process.env.REDIS_URL) {
    console.error('❌ ERROR: REDIS_URL environment variable is not set');
    process.exit(1);
  }

  if (!process.env.GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY environment variable is not set');
    process.exit(1);
  }

  console.log('✓ Environment variables found');
  console.log('');

  const redisUrl = process.env.REDIS_URL;

  // Step 1: Create test data
  console.log('Step 1: Creating test data');
  console.log('----------------------------');
  
  let testUserId: string;
  let testUserCandidateId: string;
  let testEmailDraftId: string;

  try {
    // Find or create a test user
    let testUser = await prisma.user.findFirst({
      where: { email: 'test@example.com' },
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: 'test@example.com',
          name: 'Test User',
          emailVerified: new Date(),
        },
      });
      console.log(`✓ Created test user: ${testUser.id}`);
    } else {
      console.log(`✓ Using existing test user: ${testUser.id}`);
    }
    testUserId = testUser.id;

    // Create or find a test person
    let testPerson = await prisma.person.findFirst({
      where: {
        fullName: 'John Doe',
        company: 'Test Company',
      },
    });

    if (!testPerson) {
      testPerson = await prisma.person.create({
        data: {
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          company: 'Test Company',
          role: 'Software Engineer',
        },
      });
      console.log(`✓ Created test person: ${testPerson.id}`);
    } else {
      console.log(`✓ Using existing test person: ${testPerson.id}`);
    }

    // Create or update UserCandidate
    const userCandidate = await prisma.userCandidate.upsert({
      where: {
        userId_personId: {
          userId: testUserId,
          personId: testPerson.id,
        },
      },
      create: {
        userId: testUserId,
        personId: testPerson.id,
        email: 'john.doe@testcompany.com',
        emailStatus: 'VERIFIED',
        emailConfidence: 0.95,
        university: 'Test University',
      },
      update: {
        email: 'john.doe@testcompany.com',
        emailStatus: 'VERIFIED',
        emailConfidence: 0.95,
        university: 'Test University',
      },
    });
    testUserCandidateId = userCandidate.id;
    console.log(`✓ Created/updated UserCandidate: ${testUserCandidateId}`);

    // Create or update EmailDraft with placeholder
    const placeholderDraft = EMAIL_TEMPLATES[0];
    const draft = await prisma.emailDraft.upsert({
      where: {
        userCandidateId: testUserCandidateId,
      },
      create: {
        userCandidateId: testUserCandidateId,
        subject: placeholderDraft.subject.replace(/{first_name}/g, 'John'),
        body: placeholderDraft.body.replace(/{first_name}/g, 'John'),
        status: 'PENDING',
      },
      update: {
        subject: placeholderDraft.subject.replace(/{first_name}/g, 'John'),
        body: placeholderDraft.body.replace(/{first_name}/g, 'John'),
        status: 'PENDING',
      },
    });
    testEmailDraftId = draft.id;
    console.log(`✓ Created/updated EmailDraft: ${testEmailDraftId}`);
    console.log(`  Status: ${draft.status}`);
    console.log('');

    // Step 2: Create default template if it doesn't exist
    console.log('Step 2: Setting up email template');
    console.log('----------------------------------');
    
    let defaultTemplate = await prisma.emailTemplate.findFirst({
      where: {
        userId: testUserId,
        isDefault: true,
      },
    });

    if (!defaultTemplate) {
      const templatePrompt: TemplatePrompt = {
        subject: EMAIL_TEMPLATES[0].subject,
        body: EMAIL_TEMPLATES[0].body,
      };
      
      defaultTemplate = await prisma.emailTemplate.create({
        data: {
          userId: testUserId,
          name: 'Default Template',
          prompt: JSON.stringify(templatePrompt),
          isDefault: true,
        },
      });
      console.log(`✓ Created default template: ${defaultTemplate.id}`);
    } else {
      console.log(`✓ Using existing default template: ${defaultTemplate.id}`);
    }
    console.log('');

    // Step 3: Connect to Redis and queue
    console.log('Step 3: Connecting to Redis and queueing job');
    console.log('----------------------------------------------');
    
    const connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    await new Promise<void>((resolve, reject) => {
      connection.on('ready', () => {
        resolve();
      });
      connection.on('error', (err) => {
        reject(err);
      });
      setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);
    });

    console.log('✓ Redis connected');

    const queue = new Queue('email-generation', {
      connection,
    });

    console.log('✓ Queue created');

    // Prepare job data (same as generateEmailForCandidateAction)
    const templatePrompt: TemplatePrompt = JSON.parse(defaultTemplate.prompt);
    const personData: PersonData = {
      fullName: testPerson.fullName,
      firstName: testPerson.firstName,
      lastName: testPerson.lastName,
      company: testPerson.company,
      role: testPerson.role,
      university: userCandidate.university || 'Test University',
    };

    console.log('Job data:');
    console.log(`  userCandidateId: ${testUserCandidateId}`);
    console.log(`  Person: ${personData.fullName} at ${personData.company}`);
    console.log(`  Template subject: ${templatePrompt.subject.substring(0, 50)}...`);
    console.log('');

    // Queue the job
    const job = await queue.add(
      'generate-email',
      {
        userCandidateId: testUserCandidateId,
        templatePrompt,
        personData,
      },
      {
        jobId: `email-${testUserCandidateId}`,
      }
    );

    console.log(`✓ Job queued with ID: ${job.id}`);
    console.log(`  Job ID in queue: email-${testUserCandidateId}`);
    console.log('');

    // Step 4: Monitor job processing
    console.log('Step 4: Monitoring job processing');
    console.log('----------------------------------');
    console.log('Waiting for worker to process job...');
    console.log('(Make sure the worker is running: npm run worker)');
    console.log('');

    const startTime = Date.now();
    const timeout = 120000; // 2 minutes
    const pollInterval = 2500; // 2.5 seconds (same as frontend)

    let jobCompleted = false;
    let draftApproved = false;

    while (!jobCompleted && !draftApproved && Date.now() - startTime < timeout) {
      // Check job status in BullMQ
      const jobState = await job.getState();
      console.log(`[${new Date().toISOString()}] Job state: ${jobState}`);

      // Check draft status in database
      const draft = await prisma.emailDraft.findUnique({
        where: { userCandidateId: testUserCandidateId },
        select: {
          status: true,
          subject: true,
          body: true,
        },
      });

      if (draft) {
        console.log(`  Draft status: ${draft.status}`);
        if (draft.status === 'APPROVED') {
          console.log('  ✓ Draft approved!');
          console.log(`  Subject: ${draft.subject?.substring(0, 60)}...`);
          console.log(`  Body length: ${draft.body?.length || 0} characters`);
          draftApproved = true;
          break;
        } else if (draft.status === 'REJECTED') {
          console.log('  ✗ Draft rejected');
          jobCompleted = true;
          break;
        }
      } else {
        console.log('  Draft not found');
      }

      // Check if job failed
      if (jobState === 'failed') {
        const failedReason = await job.getFailedReason();
        console.log(`  ✗ Job failed: ${failedReason}`);
        jobCompleted = true;
        break;
      }

      // Check if job completed
      if (jobState === 'completed') {
        console.log('  ✓ Job completed in BullMQ');
        jobCompleted = true;
        // Still check draft status
        continue;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.log('');

    // Step 5: Final status check
    console.log('Step 5: Final status check');
    console.log('--------------------------');

    const finalDraft = await prisma.emailDraft.findUnique({
      where: { userCandidateId: testUserCandidateId },
    });

    const finalJobState = await job.getState();

    console.log(`Job state: ${finalJobState}`);
    if (finalDraft) {
      console.log(`Draft status: ${finalDraft.status}`);
      console.log(`Draft subject: ${finalDraft.subject?.substring(0, 80) || 'N/A'}...`);
      console.log(`Draft body length: ${finalDraft.body?.length || 0} characters`);
    } else {
      console.log('Draft not found');
    }

    if (Date.now() - startTime >= timeout) {
      console.log('\n⚠️  TIMEOUT: Job did not complete within 2 minutes');
      console.log('Possible issues:');
      console.log('  1. Worker is not running (check: npm run worker)');
      console.log('  2. Worker is not connected to Redis');
      console.log('  3. Groq API is taking too long or failing');
      console.log('  4. Check worker logs for errors');
    } else if (draftApproved) {
      console.log('\n✅ SUCCESS: Email generation completed!');
    } else if (finalDraft?.status === 'REJECTED') {
      console.log('\n❌ FAILED: Email generation was rejected');
      console.log('Check worker logs for error details');
    } else {
      console.log('\n⚠️  INCOMPLETE: Job status unclear');
      console.log('Check worker logs and database for details');
    }

    // Cleanup
    console.log('\nCleaning up...');
    await queue.close();
    await connection.quit();
    console.log('✓ Connections closed');

    // Option to clean up test data
    console.log('\nNote: Test data still exists in database:');
    console.log(`  User: ${testUserId}`);
    console.log(`  UserCandidate: ${testUserCandidateId}`);
    console.log(`  EmailDraft: ${testEmailDraftId}`);
    console.log('You can delete these manually if needed.');

    await prisma.$disconnect();
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack:', error.stack);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Run the test
testEmailGeneration()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  });
