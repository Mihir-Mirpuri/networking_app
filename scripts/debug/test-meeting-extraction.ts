/**
 * Test script to validate the meeting extraction pipeline
 * Run with: npx tsx scripts/test-meeting-extraction.ts
 *
 * Options:
 *   --synthetic   Also test with synthetic meeting emails to verify LLM extraction
 *   --user=EMAIL  Test with a specific user's emails
 */

import { PrismaClient } from '@prisma/client';
import { detectMeetingInEmail, MeetingDetectionResult } from '../src/lib/utils/meetingDetector';
import { parseCalendarFromEmail, CalendarParserInput } from '../src/lib/services/calendarParser';

const prisma = new PrismaClient();

// Parse command line args
const args = process.argv.slice(2);
const includeSynthetic = args.includes('--synthetic');
const userArg = args.find(a => a.startsWith('--user='));
const specificUserEmail = userArg ? userArg.split('=')[1] : undefined;

// Sample synthetic emails for testing the full pipeline
const syntheticEmails = [
  {
    messageId: 'synthetic-1',
    subject: 'Coffee chat next week?',
    body_text: `Hey! It was great meeting you at the conference last week.

I'd love to grab coffee and hear more about your work on the AI project.
Are you free next Tuesday around 3pm? There's a nice coffee shop near your office we could meet at.

Let me know what works for you!

Best,
Alex`,
    sender: 'alex.johnson@example.com',
    received_at: new Date(),
  },
  {
    messageId: 'synthetic-2',
    subject: 'Schedule demo - Thursday 2pm PT',
    body_text: `Hi there,

Following up on our conversation - I'd like to schedule a demo of our product for your team.

How does Thursday at 2pm PT work for you? We can do a 30-minute Zoom call.
Here's the link: https://zoom.us/j/123456789

Please confirm and I'll send a calendar invite.

Thanks,
Sarah
Product Manager @ TechCo`,
    sender: 'sarah.miller@techco.com',
    received_at: new Date(),
  },
  {
    messageId: 'synthetic-3',
    subject: 'Re: Interview follow-up',
    body_text: `Hi,

Thanks for your application! We'd like to schedule a phone interview for the Senior Engineer position.

Would January 30th at 10am work for you? The call should take about 45 minutes and will be with our engineering lead.

Please let me know your availability.

Best regards,
Hiring Team`,
    sender: 'hr@startup.io',
    received_at: new Date(),
  },
];

interface TestResult {
  messageId: string;
  subject: string | null;
  preFilter: MeetingDetectionResult;
  llmResult?: Awaited<ReturnType<typeof parseCalendarFromEmail>>;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Meeting Extraction Pipeline Test');
  console.log('='.repeat(60));

  // Get a user with messages
  const user = await prisma.user.findFirst({
    where: specificUserEmail
      ? { email: { contains: specificUserEmail } }
      : { messages: { some: {} } },
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) {
    console.error('No user with messages found in database');
    return;
  }

  console.log(`\nTesting with user: ${user.email} (${user.id})`);

  // Fetch recent messages for this user
  const messages = await prisma.messages.findMany({
    where: { userId: user.id },
    orderBy: { received_at: 'desc' },
    take: 10,
    select: {
      messageId: true,
      subject: true,
      body_text: true,
      sender: true,
      received_at: true,
    },
  });

  console.log(`Found ${messages.length} messages to test\n`);

  const results: TestResult[] = [];

  for (const msg of messages) {
    console.log('-'.repeat(60));
    console.log(`Message: ${msg.messageId}`);
    console.log(`Subject: ${msg.subject || '(no subject)'}`);
    console.log(`From: ${msg.sender}`);
    console.log(`Date: ${msg.received_at.toISOString()}`);

    // Step 1: Pre-filter test
    const preFilterResult = detectMeetingInEmail(
      msg.subject || '',
      msg.body_text || ''
    );

    console.log('\n[Pre-filter Result]');
    console.log(`  Has potential meeting: ${preFilterResult.hasPotentialMeeting}`);
    console.log(`  Confidence: ${preFilterResult.confidence}`);
    console.log(`  Matched patterns: ${preFilterResult.matchedPatterns.join(', ') || '(none)'}`);

    const result: TestResult = {
      messageId: msg.messageId,
      subject: msg.subject,
      preFilter: preFilterResult,
    };

    // Step 2: LLM parser test (only if pre-filter detects potential meeting)
    if (preFilterResult.hasPotentialMeeting) {
      console.log('\n[LLM Parser] Running extraction...');

      const parserInput: CalendarParserInput = {
        messageId: msg.messageId,
        subject: msg.subject,
        bodyText: msg.body_text,
        sender: msg.sender,
        receivedAt: msg.received_at,
        userTimezone: 'America/Los_Angeles', // Default timezone
        preFilterResult,
      };

      try {
        const llmResult = await parseCalendarFromEmail(parserInput);
        result.llmResult = llmResult;

        console.log(`  Success: ${llmResult.success}`);
        if (llmResult.skipped) {
          console.log('  Skipped: true');
        } else if (llmResult.result) {
          const r = llmResult.result;
          console.log(`  Has meeting: ${r.hasMeeting}`);
          if (r.hasMeeting) {
            console.log(`  Title: ${r.title}`);
            console.log(`  Start time: ${r.startTime?.toISOString() || r.rawStartTime || 'N/A'}`);
            console.log(`  End time: ${r.endTime?.toISOString() || r.rawEndTime || 'N/A'}`);
            console.log(`  Duration: ${r.duration ? `${r.duration} min` : 'N/A'}`);
            console.log(`  Location: ${r.location || 'N/A'}`);
            console.log(`  Meeting link: ${r.meetingLink || 'N/A'}`);
            console.log(`  Platform: ${r.meetingPlatform || 'N/A'}`);
            console.log(`  Confidence: ${r.confidence}`);
            console.log(`  Needs time confirmation: ${r.needsTimeConfirmation}`);
            console.log(`  Ambiguities: ${r.ambiguities.join(', ') || '(none)'}`);
          }
        }
        if (llmResult.error) {
          console.log(`  Error: ${llmResult.error}`);
        }
      } catch (error) {
        console.error('  LLM Parser error:', error);
      }
    } else {
      console.log('\n[LLM Parser] Skipped - no potential meeting detected');
    }

    results.push(result);
  }

  // Test synthetic emails to verify the full LLM pipeline
  if (includeSynthetic) {
    console.log('\n' + '='.repeat(60));
    console.log('SYNTHETIC EMAIL TESTS (verifying LLM extraction)');
    console.log('='.repeat(60));

    for (const msg of syntheticEmails) {
      console.log('\n' + '-'.repeat(60));
      console.log(`[Synthetic] Message: ${msg.messageId}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`From: ${msg.sender}`);
      console.log(`\nBody preview: ${msg.body_text.substring(0, 100)}...`);

      // Step 1: Pre-filter
      const preFilterResult = detectMeetingInEmail(
        msg.subject,
        msg.body_text
      );

      console.log('\n[Pre-filter Result]');
      console.log(`  Has potential meeting: ${preFilterResult.hasPotentialMeeting}`);
      console.log(`  Confidence: ${preFilterResult.confidence}`);
      console.log(`  Matched patterns: ${preFilterResult.matchedPatterns.slice(0, 5).join(', ')}${preFilterResult.matchedPatterns.length > 5 ? '...' : ''}`);

      // Step 2: LLM parser
      if (preFilterResult.hasPotentialMeeting) {
        console.log('\n[LLM Parser] Running extraction...');

        const parserInput: CalendarParserInput = {
          messageId: msg.messageId,
          subject: msg.subject,
          bodyText: msg.body_text,
          sender: msg.sender,
          receivedAt: msg.received_at,
          userTimezone: 'America/Los_Angeles',
          preFilterResult,
        };

        try {
          const llmResult = await parseCalendarFromEmail(parserInput);

          console.log(`  Success: ${llmResult.success}`);
          if (llmResult.result) {
            const r = llmResult.result;
            console.log(`  Has meeting: ${r.hasMeeting}`);
            if (r.hasMeeting) {
              console.log(`  Title: ${r.title}`);
              console.log(`  Start time: ${r.startTime?.toISOString() || r.rawStartTime || 'N/A'}`);
              console.log(`  End time: ${r.endTime?.toISOString() || r.rawEndTime || 'N/A'}`);
              console.log(`  Duration: ${r.duration ? `${r.duration} min` : 'N/A'}`);
              console.log(`  Location: ${r.location || 'N/A'}`);
              console.log(`  Meeting link: ${r.meetingLink || 'N/A'}`);
              console.log(`  Platform: ${r.meetingPlatform || 'N/A'}`);
              console.log(`  Confidence: ${r.confidence}`);
              console.log(`  Needs time confirmation: ${r.needsTimeConfirmation}`);
              console.log(`  Ambiguities: ${r.ambiguities.join(', ') || '(none)'}`);
            }
          }
          if (llmResult.error) {
            console.log(`  Error: ${llmResult.error}`);
          }
        } catch (error) {
          console.error('  LLM Parser error:', error);
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const potentialMeetings = results.filter(r => r.preFilter.hasPotentialMeeting);
  const confirmedMeetings = results.filter(r => r.llmResult?.result?.hasMeeting);

  console.log(`\nTotal messages tested: ${results.length}`);
  console.log(`Pre-filter potential meetings: ${potentialMeetings.length}`);
  console.log(`LLM confirmed meetings: ${confirmedMeetings.length}`);

  if (confirmedMeetings.length > 0) {
    console.log('\nConfirmed meetings:');
    for (const r of confirmedMeetings) {
      const meeting = r.llmResult!.result!;
      console.log(`  - ${meeting.title} (confidence: ${meeting.confidence})`);
      console.log(`    Subject: ${r.subject}`);
      console.log(`    Time: ${meeting.rawStartTime || meeting.startTime?.toISOString() || 'TBD'}`);
    }
  }

  console.log('\nPre-filter confidence breakdown:');
  const high = potentialMeetings.filter(r => r.preFilter.confidence === 'high').length;
  const medium = potentialMeetings.filter(r => r.preFilter.confidence === 'medium').length;
  const low = potentialMeetings.filter(r => r.preFilter.confidence === 'low').length;
  console.log(`  High: ${high}, Medium: ${medium}, Low: ${low}`);

  if (!includeSynthetic) {
    console.log('\n💡 Tip: Run with --synthetic to test the full LLM pipeline with sample meeting emails');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
