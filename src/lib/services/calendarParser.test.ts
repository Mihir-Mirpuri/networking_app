/**
 * Test suite for Calendar Parser Service
 *
 * Run with: npx tsx src/lib/services/calendarParser.test.ts
 *
 * Make sure GROQ_API_KEY is set in your .env or .env.local
 */

import 'dotenv/config';
import { parseCalendarFromEmail, CalendarParserInput, toStorableFormat } from './calendarParser';
import { detectMeetingInEmail } from '@/lib/utils/meetingDetector';

// ANSI color codes for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface TestCase {
  name: string;
  input: Omit<CalendarParserInput, 'messageId' | 'receivedAt'>;
  expectations: {
    hasMeeting: boolean;
    minConfidence?: number;
    shouldHaveTitle?: boolean;
    shouldHaveStartTime?: boolean;
    shouldHaveLocation?: boolean;
    shouldHaveMeetingLink?: boolean;
    expectedPlatform?: string;
  };
}

const TEST_CASES: TestCase[] = [
  // Clear meeting requests
  {
    name: 'Clear meeting with date and time',
    input: {
      subject: 'Meeting next Tuesday',
      bodyText: `Hi,

Would love to catch up next Tuesday at 2pm at Blue Bottle Coffee on Market Street.

Let me know if that works!

Best,
Sarah`,
      sender: 'sarah@example.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.7,
      shouldHaveTitle: true,
      shouldHaveStartTime: true,
      shouldHaveLocation: true,
    },
  },

  {
    name: 'Zoom meeting invitation',
    input: {
      subject: 'Quick sync tomorrow',
      bodyText: `Hey!

Can we do a quick 30-minute sync tomorrow at 3pm?

Here's the Zoom link: https://zoom.us/j/123456789

Thanks,
Mike`,
      sender: 'mike@company.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.8,
      shouldHaveStartTime: true,
      shouldHaveMeetingLink: true,
      expectedPlatform: 'zoom',
    },
  },

  {
    name: 'Google Meet link',
    input: {
      subject: 'Product demo',
      bodyText: `Hi team,

I'd like to schedule a product demo for Friday at 11am.

Join here: https://meet.google.com/abc-defg-hij

See you there!`,
      sender: 'product@company.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.8,
      shouldHaveStartTime: true,
      shouldHaveMeetingLink: true,
      expectedPlatform: 'google-meet',
    },
  },

  // Edge cases
  {
    name: 'Vague time reference',
    input: {
      subject: 'Coffee sometime?',
      bodyText: `Hey!

Would love to grab coffee sometime next week. Let me know what works for you.

Cheers`,
      sender: 'friend@email.com',
    },
    expectations: {
      // This is correctly detected as a vague meeting request
      // "coffee" + "next week" triggers pre-filter (low confidence)
      // LLM recognizes this as a meeting proposal without specific time
      hasMeeting: true,
      minConfidence: 0.5, // Lower confidence due to vagueness
      shouldHaveTitle: true,
    },
  },

  {
    name: 'No meeting - just a newsletter',
    input: {
      subject: 'Weekly Tech News',
      bodyText: `This week's top stories:

1. New AI breakthrough
2. Stock market update
3. Product launches

Click here to unsubscribe.`,
      sender: 'newsletter@techsite.com',
    },
    expectations: {
      hasMeeting: false,
    },
  },

  {
    name: 'No meeting - past tense reference',
    input: {
      subject: 'Thanks for meeting!',
      bodyText: `Hi,

Thanks for meeting with me yesterday. It was great catching up.

I'll send over those documents we discussed.

Best,
John`,
      sender: 'john@company.com',
    },
    expectations: {
      hasMeeting: false,
    },
  },

  {
    name: 'Interview scheduling',
    input: {
      subject: 'Interview Invitation - Software Engineer Position',
      bodyText: `Dear Candidate,

We would like to invite you for an interview on January 15th at 10:00 AM PST.

The interview will be conducted via Microsoft Teams. You'll receive a calendar invite shortly.

Please confirm your availability.

Best regards,
HR Team`,
      sender: 'recruiting@company.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.9,
      shouldHaveTitle: true,
      shouldHaveStartTime: true,
      expectedPlatform: 'teams',
    },
  },

  {
    name: 'Lunch meeting',
    input: {
      subject: 'Lunch on Thursday?',
      bodyText: `Hey!

Are you free for lunch Thursday around noon? I was thinking we could try that new Thai place downtown.

Let me know!`,
      sender: 'colleague@work.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.6,
      shouldHaveStartTime: true,
      shouldHaveLocation: true,
    },
  },

  {
    name: 'Multiple time options',
    input: {
      subject: 'Scheduling our call',
      bodyText: `Hi,

I'm available at the following times:
- Monday at 2pm
- Tuesday at 10am
- Wednesday at 4pm

Please let me know which works best for you.

Thanks!`,
      sender: 'partner@business.com',
    },
    expectations: {
      hasMeeting: true,
      minConfidence: 0.5, // Ambiguous due to multiple options
      // Title not required - LLM may not generate one for availability emails
      shouldHaveStartTime: true, // Should pick one of the options
    },
  },
];

async function runTest(testCase: TestCase, index: number): Promise<boolean> {
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Test ${index + 1}: ${testCase.name}${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  // First run pre-filter
  const preFilterResult = detectMeetingInEmail(
    testCase.input.subject || '',
    testCase.input.bodyText || ''
  );
  console.log(`\n${YELLOW}Pre-filter result:${RESET}`);
  console.log(`  hasPotentialMeeting: ${preFilterResult.hasPotentialMeeting}`);
  console.log(`  confidence: ${preFilterResult.confidence}`);
  console.log(`  patterns: ${preFilterResult.matchedPatterns.slice(0, 5).join(', ')}${preFilterResult.matchedPatterns.length > 5 ? '...' : ''}`);

  const input: CalendarParserInput = {
    messageId: `test-${index}`,
    subject: testCase.input.subject,
    bodyText: testCase.input.bodyText,
    sender: testCase.input.sender,
    receivedAt: new Date(),
    userTimezone: 'America/Los_Angeles',
    preFilterResult,
  };

  try {
    const result = await parseCalendarFromEmail(input);

    if (!result.success) {
      console.log(`\n${RED}✗ Parser failed: ${result.error}${RESET}`);
      return false;
    }

    if (result.skipped) {
      console.log(`\n${YELLOW}⊘ Skipped (pre-filter said no meeting)${RESET}`);
      if (testCase.expectations.hasMeeting) {
        console.log(`${RED}✗ Expected meeting but was skipped${RESET}`);
        return false;
      }
      console.log(`${GREEN}✓ Correctly skipped non-meeting email${RESET}`);
      return true;
    }

    const parsed = result.result!;

    console.log(`\n${YELLOW}Parsed result:${RESET}`);
    console.log(`  hasMeeting: ${parsed.hasMeeting}`);
    console.log(`  confidence: ${parsed.confidence.toFixed(2)}`);
    console.log(`  title: ${parsed.title || '(none)'}`);
    console.log(`  startTime: ${parsed.startTime?.toISOString() || parsed.rawStartTime || '(none)'}`);
    console.log(`  endTime: ${parsed.endTime?.toISOString() || parsed.rawEndTime || '(none)'}`);
    console.log(`  location: ${parsed.location || '(none)'}`);
    console.log(`  meetingLink: ${parsed.meetingLink || '(none)'}`);
    console.log(`  platform: ${parsed.meetingPlatform || '(none)'}`);
    console.log(`  needsTimeConfirmation: ${parsed.needsTimeConfirmation}`);
    console.log(`  ambiguities: ${parsed.ambiguities.join(', ') || '(none)'}`);
    console.log(`  extractedFields: ${parsed.extractedFields.join(', ')}`);
    console.log(`  processingTime: ${parsed.processingTimeMs}ms`);

    // Validate expectations
    let passed = true;
    const failures: string[] = [];

    if (parsed.hasMeeting !== testCase.expectations.hasMeeting) {
      failures.push(`hasMeeting: expected ${testCase.expectations.hasMeeting}, got ${parsed.hasMeeting}`);
      passed = false;
    }

    if (testCase.expectations.minConfidence !== undefined && parsed.confidence < testCase.expectations.minConfidence) {
      failures.push(`confidence: expected >= ${testCase.expectations.minConfidence}, got ${parsed.confidence.toFixed(2)}`);
      passed = false;
    }

    if (testCase.expectations.shouldHaveTitle && !parsed.title) {
      failures.push('title: expected a title but got none');
      passed = false;
    }

    if (testCase.expectations.shouldHaveStartTime && !parsed.startTime && !parsed.rawStartTime) {
      failures.push('startTime: expected a start time but got none');
      passed = false;
    }

    if (testCase.expectations.shouldHaveStartTime === false && (parsed.startTime || parsed.rawStartTime)) {
      // This is okay - we just note that time is vague
    }

    if (testCase.expectations.shouldHaveLocation && !parsed.location) {
      failures.push('location: expected a location but got none');
      passed = false;
    }

    if (testCase.expectations.shouldHaveMeetingLink && !parsed.meetingLink) {
      failures.push('meetingLink: expected a meeting link but got none');
      passed = false;
    }

    if (testCase.expectations.expectedPlatform && parsed.meetingPlatform !== testCase.expectations.expectedPlatform) {
      failures.push(`platform: expected ${testCase.expectations.expectedPlatform}, got ${parsed.meetingPlatform}`);
      passed = false;
    }

    if (passed) {
      console.log(`\n${GREEN}✓ All expectations met${RESET}`);
    } else {
      console.log(`\n${RED}✗ Failed expectations:${RESET}`);
      failures.forEach(f => console.log(`  ${RED}- ${f}${RESET}`));
    }

    // Show storable format
    console.log(`\n${YELLOW}Storable format (for DB):${RESET}`);
    const storable = toStorableFormat(parsed);
    console.log(JSON.stringify(storable, null, 2).substring(0, 500) + '...');

    return passed;
  } catch (error) {
    console.log(`\n${RED}✗ Exception: ${error instanceof Error ? error.message : 'Unknown error'}${RESET}`);
    return false;
  }
}

async function main() {
  console.log(`${BOLD}${BLUE}`);
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║       Calendar Parser Service - Test Suite            ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`${RESET}`);

  // Check for API key
  if (!process.env.GROQ_API_KEY) {
    console.log(`${RED}Error: GROQ_API_KEY environment variable is not set${RESET}`);
    console.log('Please set it before running tests:');
    console.log('  export GROQ_API_KEY=your-api-key');
    process.exit(1);
  }

  console.log(`${GREEN}✓ GROQ_API_KEY is set${RESET}`);
  console.log(`Running ${TEST_CASES.length} test cases...`);

  const results: boolean[] = [];
  for (let i = 0; i < TEST_CASES.length; i++) {
    const passed = await runTest(TEST_CASES[i], i);
    results.push(passed);

    // Small delay between tests to avoid rate limiting
    if (i < TEST_CASES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary
  console.log(`\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;

  console.log(`\nTotal: ${results.length} tests`);
  console.log(`${GREEN}Passed: ${passed}${RESET}`);
  console.log(`${failed > 0 ? RED : GREEN}Failed: ${failed}${RESET}`);

  if (failed === 0) {
    console.log(`\n${GREEN}${BOLD}All tests passed! ✓${RESET}`);
  } else {
    console.log(`\n${RED}${BOLD}Some tests failed.${RESET}`);
    console.log('Review the output above for details.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
