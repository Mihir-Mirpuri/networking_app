/**
 * Test script for thread-based meeting extraction
 *
 * Tests the full pipeline:
 * 1. Thread context fetching
 * 2. LLM analysis for confirmed meetings
 * 3. Various conversation scenarios
 */

import 'dotenv/config';
import { parseCalendarFromThread, ThreadMessage } from '../src/lib/services/calendarParser';

// Test scenarios
const testCases: {
  name: string;
  thread: ThreadMessage[];
  expectedConfirmed: boolean;
}[] = [
  {
    name: 'Confirmed meeting - simple yes',
    thread: [
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Coffee chat?',
        bodyText: 'Hi! Would you be free for a quick coffee chat next Tuesday at 2pm?',
        receivedAt: new Date('2026-01-27T10:00:00Z'),
      },
      {
        direction: 'RECEIVED',
        sender: 'contact@example.com',
        subject: 'Re: Coffee chat?',
        bodyText: 'Yes, that works for me! See you Tuesday at 2pm.',
        receivedAt: new Date('2026-01-27T14:00:00Z'),
      },
    ],
    expectedConfirmed: true,
  },
  {
    name: 'Not confirmed - proposal only',
    thread: [
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Meeting request',
        bodyText: 'Hi! Would you be available for a call this Friday at 3pm to discuss the project?',
        receivedAt: new Date('2026-01-27T10:00:00Z'),
      },
    ],
    expectedConfirmed: false,
  },
  {
    name: 'Not confirmed - ambiguous response',
    thread: [
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Quick sync?',
        bodyText: 'Hey! Can we meet tomorrow at 10am?',
        receivedAt: new Date('2026-01-27T10:00:00Z'),
      },
      {
        direction: 'RECEIVED',
        sender: 'contact@example.com',
        subject: 'Re: Quick sync?',
        bodyText: 'Let me check my calendar and get back to you.',
        receivedAt: new Date('2026-01-27T11:00:00Z'),
      },
    ],
    expectedConfirmed: false,
  },
  {
    name: 'Confirmed meeting - time change agreed',
    thread: [
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Catch up',
        bodyText: 'Would you like to grab lunch on Wednesday at noon?',
        receivedAt: new Date('2026-01-27T09:00:00Z'),
      },
      {
        direction: 'RECEIVED',
        sender: 'contact@example.com',
        subject: 'Re: Catch up',
        bodyText: "I can't do noon, how about 1pm instead?",
        receivedAt: new Date('2026-01-27T10:00:00Z'),
      },
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Re: Catch up',
        bodyText: '1pm works perfectly. See you then!',
        receivedAt: new Date('2026-01-27T10:30:00Z'),
      },
    ],
    expectedConfirmed: true,
  },
  {
    name: 'Not confirmed - declined',
    thread: [
      {
        direction: 'SENT',
        sender: 'user@example.com',
        subject: 'Phone call',
        bodyText: 'Hi! Can we hop on a quick call Thursday at 4pm?',
        receivedAt: new Date('2026-01-27T10:00:00Z'),
      },
      {
        direction: 'RECEIVED',
        sender: 'contact@example.com',
        subject: 'Re: Phone call',
        bodyText: "Sorry, I'm fully booked this week. Maybe next week?",
        receivedAt: new Date('2026-01-27T12:00:00Z'),
      },
    ],
    expectedConfirmed: false,
  },
];

async function runTests() {
  console.log('='.repeat(60));
  console.log('Thread-Based Meeting Extraction Tests');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`Test: ${testCase.name}`);
    console.log(`  Messages: ${testCase.thread.length}`);
    console.log(`  Expected: ${testCase.expectedConfirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}`);

    try {
      const result = await parseCalendarFromThread({
        messageId: 'test-msg-id',
        threadId: 'test-thread-id',
        thread: testCase.thread,
        userEmail: 'user@example.com',
      });

      const actualConfirmed = result.isConfirmed;
      const match = actualConfirmed === testCase.expectedConfirmed;

      console.log(`  Result: ${actualConfirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
      console.log(`  Reasoning: ${result.reasoning || 'N/A'}`);

      if (match) {
        console.log(`  ✅ PASSED`);
        passed++;
      } else {
        console.log(`  ❌ FAILED - Expected ${testCase.expectedConfirmed}, got ${actualConfirmed}`);
        failed++;
      }

      if (result.result) {
        console.log(`  Meeting Details:`);
        console.log(`    Title: ${result.result.title}`);
        console.log(`    Time: ${result.result.rawStartTime}`);
        console.log(`    Location: ${result.result.location || 'N/A'}`);
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }

    console.log();
  }

  console.log('='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
