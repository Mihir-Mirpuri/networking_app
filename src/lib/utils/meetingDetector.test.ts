/**
 * Test file for meetingDetector
 * Run with: npx tsx src/lib/utils/meetingDetector.test.ts
 */

import { detectPotentialMeeting, detectMeetingInEmail, MeetingDetectionResult } from './meetingDetector';

interface TestCase {
  name: string;
  input: string;
  expected: {
    hasPotentialMeeting: boolean;
    minConfidence?: 'high' | 'medium' | 'low';
  };
}

const testCases: TestCase[] = [
  // === SHOULD DETECT (true positives) ===

  // Strong meeting words + time
  {
    name: 'Meeting with specific day',
    input: 'Can we schedule a meeting for Tuesday?',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Appointment with time',
    input: 'Your appointment is confirmed for 3pm tomorrow',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Interview scheduled',
    input: 'We would like to schedule an interview with you next week',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },

  // Scheduling phrases
  {
    name: 'Are you free question',
    input: 'Are you free for a quick call tomorrow?',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Lets schedule',
    input: "Let's schedule some time to discuss the project",
    expected: { hasPotentialMeeting: true, minConfidence: 'medium' }
  },
  {
    name: 'When works for you',
    input: 'When works for you to chat?',
    expected: { hasPotentialMeeting: true, minConfidence: 'medium' }
  },
  {
    name: 'How about proposal',
    input: 'How about we grab coffee next Wednesday?',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },

  // Video platforms
  {
    name: 'Zoom link',
    input: 'Join us on Zoom at 2pm: https://zoom.us/j/123456',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Google Meet',
    input: 'Here is the Google Meet link for our call: meet.google.com/abc-defg-hij',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Teams meeting',
    input: 'I set up a Teams meeting for Friday at 10am',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },

  // Social/food with time
  {
    name: 'Coffee with day',
    input: 'Want to grab coffee on Thursday?',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Lunch next week',
    input: 'Would love to do lunch next week if you have time',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Drinks after work',
    input: 'Happy hour Friday at 5pm?',
    expected: { hasPotentialMeeting: true }
  },

  // Time formats
  {
    name: 'Specific time format 12hr',
    input: 'Call me at 3:30pm to discuss',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Specific time format 24hr',
    input: 'The meeting is at 14:00',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'At time shorthand',
    input: 'Sync @ 4?',
    expected: { hasPotentialMeeting: true }
  },

  // Edge cases that should still match
  {
    name: 'Abbreviated day',
    input: 'Quick sync on Mon?',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Catch up phrase',
    input: 'Would love to catch up this week',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: '1:1 meeting',
    input: 'Can we do a 1:1 on Tuesday?',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Demo request',
    input: 'I would like to schedule a demo of your product',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Send invite',
    input: "I'll send you a calendar invite for next Thursday",
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Confirming meeting',
    input: 'Just confirming our meeting tomorrow at noon',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'I am available',
    input: "I'm free Tuesday afternoon if you want to chat",
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Find time phrase',
    input: "Let's find time to connect",
    expected: { hasPotentialMeeting: true, minConfidence: 'medium' }
  },
  {
    name: 'Looking forward to meeting',
    input: 'Looking forward to meeting you on Friday!',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Ordinal date',
    input: 'Can we meet on the 15th?',
    expected: { hasPotentialMeeting: true }
  },
  {
    name: 'Month and date',
    input: 'The workshop is scheduled for January 20th',
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Duration mentioned',
    input: 'Do you have 30 minutes for a call this week?',
    expected: { hasPotentialMeeting: true }
  },

  // Real-world email examples
  {
    name: 'Real: Networking email',
    input: `Hi! I saw your profile and would love to connect. Are you available for a quick coffee chat next week? I'm usually free Tuesday or Wednesday afternoons.`,
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Real: Follow-up meeting',
    input: `Thanks for the intro! I'd love to set up a call to discuss further. Does Thursday at 2pm work for you?`,
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },
  {
    name: 'Real: Interview scheduling',
    input: `We'd like to move forward with an interview. Please let me know your availability for next week and I'll send over a calendar invite.`,
    expected: { hasPotentialMeeting: true, minConfidence: 'high' }
  },

  // === SHOULD NOT DETECT (true negatives) ===

  {
    name: 'Marketing email',
    input: 'Check out our new product! Click here to unsubscribe from future emails.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Do not reply',
    input: 'This is an automated message. Please do not reply to this email.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Past meeting thanks',
    input: 'Thanks for meeting with me yesterday! It was great chatting.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Simple update email',
    input: 'Just wanted to share an update on the project. Everything is going well.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Newsletter',
    input: 'Welcome to our weekly newsletter! Here are the top stories this week.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Random day mention',
    input: 'The report was published on Monday. You can read it here.',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Calendar notification already scheduled',
    input: 'Invitation: Team Standup @ Weekly on Mondays',
    expected: { hasPotentialMeeting: false }
  },
  {
    name: 'Promotional email',
    input: 'Big sale this weekend! 50% off all promotional items.',
    expected: { hasPotentialMeeting: false }
  },
];

function runTests(): void {
  console.log('Running meetingDetector tests...\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of testCases) {
    const result = detectPotentialMeeting(tc.input);
    const matchesExpected = result.hasPotentialMeeting === tc.expected.hasPotentialMeeting;

    // Check confidence if specified
    let confidenceOk = true;
    if (tc.expected.minConfidence && result.hasPotentialMeeting) {
      const levels = ['low', 'medium', 'high'];
      const actualLevel = levels.indexOf(result.confidence);
      const expectedLevel = levels.indexOf(tc.expected.minConfidence);
      confidenceOk = actualLevel >= expectedLevel;
    }

    if (matchesExpected && confidenceOk) {
      passed++;
      console.log(`✓ ${tc.name}`);
    } else {
      failed++;
      const reason = !matchesExpected
        ? `expected hasPotentialMeeting=${tc.expected.hasPotentialMeeting}, got ${result.hasPotentialMeeting}`
        : `expected confidence >= ${tc.expected.minConfidence}, got ${result.confidence}`;
      console.log(`✗ ${tc.name}`);
      console.log(`  Input: "${tc.input.substring(0, 60)}${tc.input.length > 60 ? '...' : ''}"`);
      console.log(`  ${reason}`);
      console.log(`  Matched patterns: ${result.matchedPatterns.slice(0, 5).join(', ')}${result.matchedPatterns.length > 5 ? '...' : ''}`);
      failures.push(tc.name);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed}/${testCases.length} passed`);

  if (failed > 0) {
    console.log(`\nFailed tests:`);
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
  }
}

// Test the convenience function too
function testConvenienceFunction(): void {
  console.log('\nTesting detectMeetingInEmail convenience function...');

  const result = detectMeetingInEmail(
    'Coffee next week?',
    'Hey! Would love to grab coffee. Are you free Tuesday?'
  );

  if (result.hasPotentialMeeting && result.confidence === 'high') {
    console.log('✓ detectMeetingInEmail works correctly');
  } else {
    console.log('✗ detectMeetingInEmail failed');
    console.log('  Result:', result);
    process.exit(1);
  }
}

// Run all tests
runTests();
testConvenienceFunction();
