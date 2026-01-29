/**
 * Test suite for Meeting Extractor Service
 *
 * Run with: npx tsx src/lib/services/meetingExtractor.test.ts
 *
 * Note: This test requires:
 * - GROQ_API_KEY in .env
 * - Database connection (will create test data)
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import {
  extractMeetingFromEmail,
  extractMeetingsFromEmails,
  EmailForExtraction,
  hasMeetingSuggestion,
  getPendingSuggestionsCount,
} from './meetingExtractor';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Test user ID - will be cleaned up after tests
const TEST_USER_ID = 'test-meeting-extractor-user';
const TEST_MESSAGE_PREFIX = 'test-meeting-msg-';

interface TestCase {
  name: string;
  email: Omit<EmailForExtraction, 'userId'>;
  expectExtracted: boolean;
  expectSkippedReason?: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Clear meeting with date and time',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}1`,
      subject: 'Coffee next Tuesday',
      bodyText: `Hi!

Would love to grab coffee next Tuesday at 2pm at Starbucks on 5th Ave.

Let me know if that works!

Best,
Alex`,
      sender: 'alex@example.com',
      receivedAt: new Date(),
    },
    expectExtracted: true,
  },

  {
    name: 'Zoom meeting invitation',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}2`,
      subject: 'Product sync tomorrow',
      bodyText: `Hey team,

Let's do a quick 30-min sync tomorrow at 10am to discuss the product roadmap.

Zoom link: https://zoom.us/j/987654321

Thanks!`,
      sender: 'pm@company.com',
      receivedAt: new Date(),
    },
    expectExtracted: true,
  },

  {
    name: 'Newsletter - should skip',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}3`,
      subject: 'Weekly Tech Digest',
      bodyText: `This week in tech:

1. AI breakthroughs
2. Market updates
3. New gadgets

Click here to unsubscribe from this newsletter.`,
      sender: 'newsletter@techsite.com',
      receivedAt: new Date(),
    },
    expectExtracted: false,
    expectSkippedReason: 'no_meeting_signals',
  },

  {
    name: 'Past meeting reference - should skip',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}4`,
      subject: 'Thanks for meeting yesterday',
      bodyText: `Hi,

Thanks for meeting with me yesterday. It was great catching up!

I'll send over those documents we discussed.

Best,
Sarah`,
      sender: 'sarah@company.com',
      receivedAt: new Date(),
    },
    expectExtracted: false,
    expectSkippedReason: 'no_meeting_signals',
  },

  {
    name: 'Interview invitation',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}5`,
      subject: 'Interview Invitation - Senior Developer',
      bodyText: `Dear Candidate,

We are pleased to invite you for an interview on February 15th at 2:00 PM EST.

The interview will be conducted via Google Meet. Link: https://meet.google.com/abc-xyz-123

Please confirm your availability.

Best regards,
HR Team`,
      sender: 'hr@company.com',
      receivedAt: new Date(),
    },
    expectExtracted: true,
  },

  {
    name: 'Empty email - should skip',
    email: {
      messageId: `${TEST_MESSAGE_PREFIX}6`,
      subject: null,
      bodyText: null,
      sender: 'unknown@example.com',
      receivedAt: new Date(),
    },
    expectExtracted: false,
    expectSkippedReason: 'no_meeting_signals',
  },
];

async function setupTestEnvironment(): Promise<void> {
  console.log(`${YELLOW}Setting up test environment...${RESET}`);

  // Create test user if not exists
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      email: 'test-extractor@example.com',
      name: 'Test User',
    },
    update: {},
  });

  // Create test conversation for messages
  await prisma.conversations.upsert({
    where: { threadId: 'test-thread-extractor' },
    create: {
      threadId: 'test-thread-extractor',
      userId: TEST_USER_ID,
      subject: 'Test Thread',
      lastMessageAt: new Date(),
      messageCount: 0,
    },
    update: {},
  });

  // Create test messages in database (required for foreign key)
  for (const testCase of TEST_CASES) {
    await prisma.messages.upsert({
      where: { messageId: testCase.email.messageId },
      create: {
        messageId: testCase.email.messageId,
        threadId: 'test-thread-extractor',
        userId: TEST_USER_ID,
        direction: 'RECEIVED',
        sender: testCase.email.sender,
        recipient_list: ['test@example.com'],
        subject: testCase.email.subject,
        body_text: testCase.email.bodyText,
        body_html: null,
        received_at: testCase.email.receivedAt,
      },
      update: {},
    });
  }

  console.log(`${GREEN}✓ Test environment ready${RESET}`);
}

async function cleanupTestEnvironment(): Promise<void> {
  console.log(`\n${YELLOW}Cleaning up test data...${RESET}`);

  // Delete suggestions first (foreign key constraint)
  await prisma.extractedMeetingSuggestion.deleteMany({
    where: { userId: TEST_USER_ID },
  });

  // Delete test messages
  await prisma.messages.deleteMany({
    where: { messageId: { startsWith: TEST_MESSAGE_PREFIX } },
  });

  // Delete test conversation
  await prisma.conversations.deleteMany({
    where: { threadId: 'test-thread-extractor' },
  });

  // Delete test user
  await prisma.user.deleteMany({
    where: { id: TEST_USER_ID },
  });

  console.log(`${GREEN}✓ Cleanup complete${RESET}`);
}

async function runTest(testCase: TestCase, index: number): Promise<boolean> {
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Test ${index + 1}: ${testCase.name}${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const email: EmailForExtraction = {
    ...testCase.email,
    userId: TEST_USER_ID,
  };

  const result = await extractMeetingFromEmail(email, {
    userTimezone: 'America/New_York',
    skipIfExists: false, // Allow re-running tests
  });

  console.log(`\n${YELLOW}Result:${RESET}`);
  console.log(`  extracted: ${result.extracted}`);
  if (result.suggestionId) console.log(`  suggestionId: ${result.suggestionId}`);
  if (result.confidence) console.log(`  confidence: ${result.confidence.toFixed(2)}`);
  if (result.skippedReason) console.log(`  skippedReason: ${result.skippedReason}`);
  if (result.error) console.log(`  error: ${result.error}`);

  // Validate expectations
  let passed = true;
  const failures: string[] = [];

  if (result.extracted !== testCase.expectExtracted) {
    failures.push(`extracted: expected ${testCase.expectExtracted}, got ${result.extracted}`);
    passed = false;
  }

  if (testCase.expectSkippedReason && result.skippedReason !== testCase.expectSkippedReason) {
    failures.push(`skippedReason: expected ${testCase.expectSkippedReason}, got ${result.skippedReason}`);
    passed = false;
  }

  if (testCase.expectExtracted && result.extracted) {
    // Verify suggestion was stored in database
    const dbSuggestion = await prisma.extractedMeetingSuggestion.findUnique({
      where: { messageId: testCase.email.messageId },
    });

    if (!dbSuggestion) {
      failures.push('Suggestion was not found in database');
      passed = false;
    } else {
      console.log(`\n${YELLOW}Database record:${RESET}`);
      console.log(`  id: ${dbSuggestion.id}`);
      console.log(`  status: ${dbSuggestion.status}`);
      console.log(`  confidence: ${dbSuggestion.confidence.toFixed(2)}`);

      const data = dbSuggestion.extractedData as Record<string, unknown>;
      if (data.title) console.log(`  title: ${data.title}`);
      if (data.startTime) console.log(`  startTime: ${data.startTime}`);
    }
  }

  if (passed) {
    console.log(`\n${GREEN}✓ Test passed${RESET}`);
  } else {
    console.log(`\n${RED}✗ Test failed:${RESET}`);
    failures.forEach(f => console.log(`  ${RED}- ${f}${RESET}`));
  }

  return passed;
}

async function testIdempotency(): Promise<boolean> {
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Idempotency Test${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const email: EmailForExtraction = {
    messageId: `${TEST_MESSAGE_PREFIX}1`, // Same as first test case
    userId: TEST_USER_ID,
    subject: 'Coffee next Tuesday',
    bodyText: 'Would love to grab coffee next Tuesday at 2pm.',
    sender: 'alex@example.com',
    receivedAt: new Date(),
  };

  // First, ensure a suggestion exists (from previous test)
  const exists = await hasMeetingSuggestion(email.messageId);
  if (!exists) {
    console.log(`${YELLOW}No existing suggestion, creating one first...${RESET}`);
    await extractMeetingFromEmail(email, { skipIfExists: false });
  }

  // Now try to extract again with skipIfExists: true (default behavior)
  const result = await extractMeetingFromEmail(email, { skipIfExists: true });

  console.log(`\n${YELLOW}Result:${RESET}`);
  console.log(`  extracted: ${result.extracted}`);
  console.log(`  skippedReason: ${result.skippedReason}`);

  if (!result.extracted && result.skippedReason === 'already_exists') {
    console.log(`\n${GREEN}✓ Idempotency test passed - duplicate correctly skipped${RESET}`);
    return true;
  } else {
    console.log(`\n${RED}✗ Idempotency test failed - should have skipped existing${RESET}`);
    return false;
  }
}

async function testBatchProcessing(): Promise<boolean> {
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Batch Processing Test${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  // Create additional test messages for batch
  const batchMessages = [
    {
      messageId: `${TEST_MESSAGE_PREFIX}batch-1`,
      subject: 'Team standup Friday',
      bodyText: 'Daily standup at 9am Friday via Zoom',
      sender: 'team@company.com',
    },
    {
      messageId: `${TEST_MESSAGE_PREFIX}batch-2`,
      subject: 'Project update',
      bodyText: 'Just wanted to share the latest project status. No action needed.',
      sender: 'updates@company.com',
    },
  ];

  // Create messages in DB
  for (const msg of batchMessages) {
    await prisma.messages.upsert({
      where: { messageId: msg.messageId },
      create: {
        messageId: msg.messageId,
        threadId: 'test-thread-extractor',
        userId: TEST_USER_ID,
        direction: 'RECEIVED',
        sender: msg.sender,
        recipient_list: ['test@example.com'],
        subject: msg.subject,
        body_text: msg.bodyText,
        body_html: null,
        received_at: new Date(),
      },
      update: {},
    });
  }

  const emails: EmailForExtraction[] = batchMessages.map(msg => ({
    messageId: msg.messageId,
    userId: TEST_USER_ID,
    subject: msg.subject,
    bodyText: msg.bodyText,
    sender: msg.sender,
    receivedAt: new Date(),
  }));

  let progressUpdates = 0;
  const summary = await extractMeetingsFromEmails(emails, {
    userTimezone: 'America/New_York',
    concurrency: 2,
    onProgress: (processed, total) => {
      progressUpdates++;
      console.log(`  Progress: ${processed}/${total}`);
    },
  });

  console.log(`\n${YELLOW}Batch Summary:${RESET}`);
  console.log(`  total: ${summary.total}`);
  console.log(`  extracted: ${summary.extracted}`);
  console.log(`  skipped: ${summary.skipped}`);
  console.log(`  failed: ${summary.failed}`);
  console.log(`  progressUpdates: ${progressUpdates}`);

  // Cleanup batch messages
  await prisma.extractedMeetingSuggestion.deleteMany({
    where: { messageId: { startsWith: `${TEST_MESSAGE_PREFIX}batch-` } },
  });
  await prisma.messages.deleteMany({
    where: { messageId: { startsWith: `${TEST_MESSAGE_PREFIX}batch-` } },
  });

  if (summary.total === 2 && progressUpdates > 0) {
    console.log(`\n${GREEN}✓ Batch processing test passed${RESET}`);
    return true;
  } else {
    console.log(`\n${RED}✗ Batch processing test failed${RESET}`);
    return false;
  }
}

async function testUtilityFunctions(): Promise<boolean> {
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Utility Functions Test${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  let passed = true;

  // Test hasMeetingSuggestion
  const hasExisting = await hasMeetingSuggestion(`${TEST_MESSAGE_PREFIX}1`);
  console.log(`  hasMeetingSuggestion("${TEST_MESSAGE_PREFIX}1"): ${hasExisting}`);
  if (!hasExisting) {
    console.log(`${RED}  Expected true${RESET}`);
    passed = false;
  }

  const hasNonExisting = await hasMeetingSuggestion('non-existent-message');
  console.log(`  hasMeetingSuggestion("non-existent-message"): ${hasNonExisting}`);
  if (hasNonExisting) {
    console.log(`${RED}  Expected false${RESET}`);
    passed = false;
  }

  // Test getPendingSuggestionsCount
  const pendingCount = await getPendingSuggestionsCount(TEST_USER_ID);
  console.log(`  getPendingSuggestionsCount("${TEST_USER_ID}"): ${pendingCount}`);
  if (pendingCount < 1) {
    console.log(`${RED}  Expected at least 1${RESET}`);
    passed = false;
  }

  if (passed) {
    console.log(`\n${GREEN}✓ Utility functions test passed${RESET}`);
  } else {
    console.log(`\n${RED}✗ Utility functions test failed${RESET}`);
  }

  return passed;
}

async function main() {
  console.log(`${BOLD}${BLUE}`);
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║      Meeting Extractor Service - Test Suite           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`${RESET}`);

  // Check for API key
  if (!process.env.GROQ_API_KEY) {
    console.log(`${RED}Error: GROQ_API_KEY environment variable is not set${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓ GROQ_API_KEY is set${RESET}`);

  // Check database connection
  try {
    await prisma.$connect();
    console.log(`${GREEN}✓ Database connected${RESET}`);
  } catch (error) {
    console.log(`${RED}Error: Could not connect to database${RESET}`);
    console.log(error);
    process.exit(1);
  }

  let allPassed = true;

  try {
    // Setup
    await setupTestEnvironment();

    // Run individual tests
    console.log(`\nRunning ${TEST_CASES.length} extraction tests...`);

    for (let i = 0; i < TEST_CASES.length; i++) {
      const passed = await runTest(TEST_CASES[i], i);
      if (!passed) allPassed = false;

      // Small delay to avoid rate limiting
      if (i < TEST_CASES.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Run additional tests
    const idempotencyPassed = await testIdempotency();
    if (!idempotencyPassed) allPassed = false;

    const batchPassed = await testBatchProcessing();
    if (!batchPassed) allPassed = false;

    const utilityPassed = await testUtilityFunctions();
    if (!utilityPassed) allPassed = false;

  } finally {
    // Cleanup
    await cleanupTestEnvironment();
    await prisma.$disconnect();
  }

  // Summary
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  if (allPassed) {
    console.log(`\n${GREEN}${BOLD}All tests passed! ✓${RESET}`);
    process.exit(0);
  } else {
    console.log(`\n${RED}${BOLD}Some tests failed.${RESET}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`${RED}Unexpected error:${RESET}`, error);
  prisma.$disconnect();
  process.exit(1);
});
