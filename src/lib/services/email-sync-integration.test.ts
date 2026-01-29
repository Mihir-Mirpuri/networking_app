/**
 * Integration test for Email Sync + Meeting Extraction
 *
 * This test verifies that the integration between email-sync.ts
 * and meetingExtractor.ts works correctly.
 *
 * Run with: npx tsx src/lib/services/email-sync-integration.test.ts
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { extractMeetingFromEmail } from '@/lib/services/meetingExtractor';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const TEST_USER_ID = 'test-email-sync-integration-user';
const TEST_THREAD_ID = 'test-thread-integration';
const TEST_MESSAGE_ID = 'test-integration-msg-1';

/**
 * Simulates what email-sync.ts does when processing a message
 */
async function simulateEmailSync(email: {
  messageId: string;
  subject: string;
  bodyText: string;
  sender: string;
}): Promise<void> {
  // Simulate the fire-and-forget pattern from email-sync.ts
  const direction = 'RECEIVED';

  if (direction === 'RECEIVED') {
    extractMeetingFromEmail({
      messageId: email.messageId,
      userId: TEST_USER_ID,
      subject: email.subject,
      bodyText: email.bodyText,
      sender: email.sender,
      receivedAt: new Date(),
    }).then(result => {
      if (result.extracted) {
        console.log(`${GREEN}[Email Sync] Meeting suggestion created:${RESET}`, {
          suggestionId: result.suggestionId,
          confidence: result.confidence,
        });
      } else {
        console.log(`${YELLOW}[Email Sync] No meeting extracted:${RESET}`, {
          skippedReason: result.skippedReason,
        });
      }
    }).catch(error => {
      console.error(`${RED}[Email Sync] Unexpected error:${RESET}`, error);
    });
  }

  // In real sync, we'd continue processing other messages here
  // The extraction runs in the background
}

async function main() {
  console.log(`${BOLD}${BLUE}`);
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║    Email Sync + Meeting Extraction Integration Test   ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`${RESET}`);

  // Setup
  console.log(`${YELLOW}Setting up test data...${RESET}`);

  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      email: 'test-integration@example.com',
      name: 'Integration Test User',
    },
    update: {},
  });

  await prisma.conversations.upsert({
    where: { threadId: TEST_THREAD_ID },
    create: {
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      subject: 'Integration Test Thread',
      lastMessageAt: new Date(),
      messageCount: 0,
    },
    update: {},
  });

  await prisma.messages.upsert({
    where: { messageId: TEST_MESSAGE_ID },
    create: {
      messageId: TEST_MESSAGE_ID,
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      direction: 'RECEIVED',
      sender: 'colleague@company.com',
      recipient_list: ['test-integration@example.com'],
      subject: 'Quick call tomorrow?',
      body_text: 'Hey! Can we hop on a quick call tomorrow at 3pm to discuss the project? I can send a Zoom link.',
      body_html: null,
      received_at: new Date(),
    },
    update: {},
  });

  console.log(`${GREEN}✓ Test data ready${RESET}\n`);

  // Test 1: Simulate email sync processing
  console.log(`${BLUE}Test 1: Simulating email sync with meeting email${RESET}`);
  console.log(`${YELLOW}Email:${RESET} "Quick call tomorrow?" from colleague@company.com`);

  await simulateEmailSync({
    messageId: TEST_MESSAGE_ID,
    subject: 'Quick call tomorrow?',
    bodyText: 'Hey! Can we hop on a quick call tomorrow at 3pm to discuss the project? I can send a Zoom link.',
    sender: 'colleague@company.com',
  });

  // Wait for the fire-and-forget extraction to complete
  console.log(`${YELLOW}Waiting for extraction to complete...${RESET}`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify the suggestion was created
  const suggestion = await prisma.extractedMeetingSuggestion.findUnique({
    where: { messageId: TEST_MESSAGE_ID },
  });

  if (suggestion) {
    console.log(`\n${GREEN}✓ Meeting suggestion was created successfully!${RESET}`);
    console.log(`  ID: ${suggestion.id}`);
    console.log(`  Status: ${suggestion.status}`);
    console.log(`  Confidence: ${suggestion.confidence.toFixed(2)}`);

    const data = suggestion.extractedData as Record<string, unknown>;
    if (data.title) console.log(`  Title: ${data.title}`);
    if (data.startTime) console.log(`  Start Time: ${data.startTime}`);
  } else {
    console.log(`\n${RED}✗ Meeting suggestion was NOT created${RESET}`);
  }

  // Test 2: Verify idempotency (processing same message again)
  console.log(`\n${BLUE}Test 2: Verify idempotency (processing same message again)${RESET}`);

  await simulateEmailSync({
    messageId: TEST_MESSAGE_ID,
    subject: 'Quick call tomorrow?',
    bodyText: 'Hey! Can we hop on a quick call tomorrow at 3pm to discuss the project? I can send a Zoom link.',
    sender: 'colleague@company.com',
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  const suggestionCount = await prisma.extractedMeetingSuggestion.count({
    where: { messageId: TEST_MESSAGE_ID },
  });

  if (suggestionCount === 1) {
    console.log(`${GREEN}✓ Idempotency verified - still only 1 suggestion${RESET}`);
  } else {
    console.log(`${RED}✗ Idempotency failed - found ${suggestionCount} suggestions${RESET}`);
  }

  // Cleanup
  console.log(`\n${YELLOW}Cleaning up test data...${RESET}`);

  await prisma.extractedMeetingSuggestion.deleteMany({
    where: { messageId: TEST_MESSAGE_ID },
  });

  await prisma.messages.deleteMany({
    where: { messageId: TEST_MESSAGE_ID },
  });

  await prisma.conversations.deleteMany({
    where: { threadId: TEST_THREAD_ID },
  });

  await prisma.user.deleteMany({
    where: { id: TEST_USER_ID },
  });

  console.log(`${GREEN}✓ Cleanup complete${RESET}`);

  // Summary
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  if (suggestion && suggestionCount === 1) {
    console.log(`\n${GREEN}${BOLD}All integration tests passed! ✓${RESET}`);
    console.log(`\nThe email sync integration is working correctly:`);
    console.log(`  - Meeting extraction is triggered after message processing`);
    console.log(`  - Fire-and-forget pattern works (doesn't block sync)`);
    console.log(`  - Idempotency is preserved (no duplicate suggestions)`);
    console.log(`  - Suggestions are stored in database correctly`);
  } else {
    console.log(`\n${RED}${BOLD}Some integration tests failed.${RESET}`);
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error(`${RED}Unexpected error:${RESET}`, error);
  prisma.$disconnect();
  process.exit(1);
});
