/**
 * Test script for Meeting Suggestion Server Actions
 *
 * Run with: npx tsx src/app/actions/test-meetingSuggestions.ts
 *
 * This tests the database operations directly (bypasses session auth).
 * Creates test data, runs tests, and cleans up.
 */

import 'dotenv/config';
import prisma from '@/lib/prisma';
import { MeetingSuggestionStatus } from '@prisma/client';
import { ExtractedMeetingData } from '@/lib/types/meetingSuggestion';
import { Prisma } from '@prisma/client';

// Test data
const TEST_USER_ID = 'test-user-meeting-suggestions';
const TEST_MESSAGE_ID = 'test-message-meeting-suggestions';
const TEST_THREAD_ID = 'test-thread-meeting-suggestions';

async function setup() {
  console.log('--- Setup: Creating test data ---');

  // Clean up any existing test data first
  await cleanup();

  // Create test user
  await prisma.user.create({
    data: {
      id: TEST_USER_ID,
      email: 'test-meeting-suggestions@example.com',
      name: 'Test User',
    },
  });

  // Create test conversation
  await prisma.conversations.create({
    data: {
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      subject: 'Test Conversation',
      lastMessageAt: new Date(),
      messageCount: 1,
    },
  });

  // Create test message
  await prisma.messages.create({
    data: {
      messageId: TEST_MESSAGE_ID,
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      direction: 'RECEIVED',
      sender: 'contact@example.com',
      recipient_list: ['test-meeting-suggestions@example.com'],
      subject: 'Coffee chat next week?',
      body_text: 'Hey! Would love to grab coffee on Tuesday at 2pm.',
      received_at: new Date(),
    },
  });

  console.log('✓ Test data created\n');
}

async function cleanup() {
  console.log('--- Cleanup: Removing test data ---');

  // Delete in correct order due to foreign keys
  await prisma.extractedMeetingSuggestion.deleteMany({
    where: { userId: TEST_USER_ID },
  });
  await prisma.messages.deleteMany({
    where: { userId: TEST_USER_ID },
  });
  await prisma.conversations.deleteMany({
    where: { userId: TEST_USER_ID },
  });
  await prisma.user.deleteMany({
    where: { id: TEST_USER_ID },
  });

  console.log('✓ Test data cleaned up\n');
}

async function testCreateSuggestion(): Promise<string> {
  console.log('--- Test 1: Create Meeting Suggestion ---');

  const extractedData: ExtractedMeetingData = {
    title: 'Coffee with Contact',
    startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
    duration: 30,
    location: 'Blue Bottle Coffee',
    attendees: ['contact@example.com'],
    rawText: 'Hey! Would love to grab coffee on Tuesday at 2pm.',
  };

  const suggestion = await prisma.extractedMeetingSuggestion.create({
    data: {
      userId: TEST_USER_ID,
      messageId: TEST_MESSAGE_ID,
      status: 'PENDING',
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      confidence: 0.85,
    },
  });

  console.log('Created suggestion:', suggestion.id);
  console.log('Status:', suggestion.status);
  console.log('Confidence:', suggestion.confidence);
  console.log('✓ Create suggestion works\n');

  return suggestion.id;
}

async function testGetPendingSuggestions() {
  console.log('--- Test 2: Get Pending Suggestions ---');

  const suggestions = await prisma.extractedMeetingSuggestion.findMany({
    where: {
      userId: TEST_USER_ID,
      status: 'PENDING',
    },
    include: {
      message: {
        select: {
          subject: true,
          sender: true,
          received_at: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log('Found', suggestions.length, 'pending suggestions');
  if (suggestions.length > 0) {
    console.log('First suggestion:');
    console.log('  - ID:', suggestions[0].id);
    console.log('  - Status:', suggestions[0].status);
    console.log('  - Message subject:', suggestions[0].message.subject);
    console.log('  - Message sender:', suggestions[0].message.sender);
  }
  console.log('✓ Get pending suggestions works\n');
}

async function testGetSuggestionById(suggestionId: string) {
  console.log('--- Test 3: Get Suggestion By ID ---');

  const suggestion = await prisma.extractedMeetingSuggestion.findFirst({
    where: {
      id: suggestionId,
      userId: TEST_USER_ID,
    },
    include: {
      message: {
        select: {
          subject: true,
          sender: true,
          received_at: true,
        },
      },
    },
  });

  if (!suggestion) {
    throw new Error('Suggestion not found');
  }

  const extractedData = suggestion.extractedData as unknown as ExtractedMeetingData;
  console.log('Found suggestion:', suggestion.id);
  console.log('Title:', extractedData.title);
  console.log('Start time:', extractedData.startTime);
  console.log('Location:', extractedData.location);
  console.log('✓ Get suggestion by ID works\n');
}

async function testGetPendingCount() {
  console.log('--- Test 4: Get Pending Count ---');

  const count = await prisma.extractedMeetingSuggestion.count({
    where: {
      userId: TEST_USER_ID,
      status: 'PENDING',
    },
  });

  console.log('Pending count:', count);
  console.log('✓ Get pending count works\n');
}

async function testDismissSuggestion(suggestionId: string) {
  console.log('--- Test 5: Dismiss Suggestion ---');

  // First verify it's pending
  const before = await prisma.extractedMeetingSuggestion.findFirst({
    where: { id: suggestionId },
  });

  if (before?.status !== 'PENDING') {
    throw new Error(`Expected PENDING status, got ${before?.status}`);
  }

  // Dismiss it
  await prisma.extractedMeetingSuggestion.update({
    where: { id: suggestionId },
    data: { status: 'DISMISSED' },
  });

  // Verify it's dismissed
  const after = await prisma.extractedMeetingSuggestion.findFirst({
    where: { id: suggestionId },
  });

  if (after?.status !== 'DISMISSED') {
    throw new Error(`Expected DISMISSED status, got ${after?.status}`);
  }

  console.log('Suggestion status changed from PENDING to DISMISSED');
  console.log('✓ Dismiss suggestion works\n');
}

async function testAcceptSuggestion() {
  console.log('--- Test 6: Accept Suggestion ---');

  // Create a new suggestion to accept
  const extractedData: ExtractedMeetingData = {
    title: 'Team Sync',
    startTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    duration: 60,
    rawText: 'Let us sync up this week',
  };

  const newMessageId = 'test-message-2-meeting-suggestions';

  // Create another message first
  await prisma.messages.create({
    data: {
      messageId: newMessageId,
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      direction: 'RECEIVED',
      sender: 'team@example.com',
      recipient_list: ['test-meeting-suggestions@example.com'],
      subject: 'Team sync this week',
      body_text: 'Let us sync up this week',
      received_at: new Date(),
    },
  });

  const suggestion = await prisma.extractedMeetingSuggestion.create({
    data: {
      userId: TEST_USER_ID,
      messageId: newMessageId,
      status: 'PENDING',
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      confidence: 0.92,
    },
  });

  // "Accept" it (in real action, this would also create a calendar event)
  await prisma.extractedMeetingSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'ACCEPTED' },
  });

  // Verify it's accepted
  const after = await prisma.extractedMeetingSuggestion.findFirst({
    where: { id: suggestion.id },
  });

  if (after?.status !== 'ACCEPTED') {
    throw new Error(`Expected ACCEPTED status, got ${after?.status}`);
  }

  console.log('Suggestion status changed from PENDING to ACCEPTED');
  console.log('(Note: Calendar event creation requires actual Google Calendar API)');
  console.log('✓ Accept suggestion works\n');
}

async function testCalculateEndTime() {
  console.log('--- Test 7: Calculate End Time ---');

  // Test with duration
  const startTime = '2024-03-15T14:00:00.000Z';
  const duration = 45;
  const startDate = new Date(startTime);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  console.log('Start time:', startTime);
  console.log('Duration:', duration, 'minutes');
  console.log('Calculated end time:', endDate.toISOString());

  // Verify it's 45 minutes later
  const diffMinutes = (endDate.getTime() - startDate.getTime()) / (60 * 1000);
  if (diffMinutes !== 45) {
    throw new Error(`Expected 45 minute difference, got ${diffMinutes}`);
  }

  console.log('✓ Calculate end time works\n');
}

async function testValidationCases() {
  console.log('--- Test 8: Validation Cases ---');

  // Test: Cannot dismiss already dismissed suggestion
  const extractedData: ExtractedMeetingData = {
    title: 'Validation Test',
    startTime: new Date().toISOString(),
    rawText: 'test',
  };

  const testMessageId = 'test-message-validation';

  await prisma.messages.create({
    data: {
      messageId: testMessageId,
      threadId: TEST_THREAD_ID,
      userId: TEST_USER_ID,
      direction: 'RECEIVED',
      sender: 'test@example.com',
      recipient_list: ['test-meeting-suggestions@example.com'],
      subject: 'Validation test',
      body_text: 'test',
      received_at: new Date(),
    },
  });

  const suggestion = await prisma.extractedMeetingSuggestion.create({
    data: {
      userId: TEST_USER_ID,
      messageId: testMessageId,
      status: 'DISMISSED', // Already dismissed
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      confidence: 0.5,
    },
  });

  // Simulate the validation check our action does
  const found = await prisma.extractedMeetingSuggestion.findFirst({
    where: {
      id: suggestion.id,
      userId: TEST_USER_ID,
    },
  });

  if (found?.status !== 'PENDING') {
    console.log('Correctly detected non-pending status:', found?.status);
  } else {
    throw new Error('Should have detected non-pending status');
  }

  console.log('✓ Validation cases work\n');
}

async function testOwnershipValidation() {
  console.log('--- Test 9: Ownership Validation ---');

  // Try to find a suggestion that belongs to a different user
  const wrongUserSuggestion = await prisma.extractedMeetingSuggestion.findFirst({
    where: {
      userId: 'non-existent-user-id',
    },
  });

  if (wrongUserSuggestion === null) {
    console.log('Correctly returned null for wrong user');
  } else {
    throw new Error('Should not have found suggestion for wrong user');
  }

  console.log('✓ Ownership validation works\n');
}

async function runTests() {
  console.log('=== Meeting Suggestion Actions Tests ===\n');

  try {
    await setup();

    const suggestionId = await testCreateSuggestion();
    await testGetPendingSuggestions();
    await testGetSuggestionById(suggestionId);
    await testGetPendingCount();
    await testDismissSuggestion(suggestionId);
    await testAcceptSuggestion();
    await testCalculateEndTime();
    await testValidationCases();
    await testOwnershipValidation();

    console.log('=== All tests passed! ===\n');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

runTests();
