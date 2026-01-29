/**
 * Backfill OutreachTracker from existing SendLogs
 *
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/scripts/backfill-outreach.ts
 * Or: npx tsx prisma/scripts/backfill-outreach.ts
 *
 * This script:
 * 1. Groups existing SendLogs by userId + toEmail
 * 2. Creates OutreachTracker entries for each unique contact
 * 3. Sets dateEmailed from the earliest successful send
 * 4. Sets followedUpAt if there are multiple sends
 * 5. Checks messages table for responses and sets responseReceivedAt
 * 6. Links SendLogs to the created tracker
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface GroupedSendLog {
  userId: string;
  toEmail: string;
  earliestSentAt: Date;
  latestSentAt: Date;
  sendLogIds: string[];
  gmailThreadId: string | null;
  contactName: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  linkedinUrl: string | null;
  userCandidateId: string | null;
}

async function backfillOutreach() {
  console.log('Starting OutreachTracker backfill...\n');

  try {
    // Step 1: Get all successful SendLogs grouped by user and email
    console.log('Step 1: Fetching all successful SendLogs...');

    const sendLogs = await prisma.sendLog.findMany({
      where: {
        status: 'SUCCESS',
      },
      include: {
        userCandidate: {
          include: {
            person: true,
          },
        },
      },
      orderBy: {
        sentAt: 'asc',
      },
    });

    console.log(`Found ${sendLogs.length} successful SendLogs`);

    // Step 2: Group by userId + toEmail
    console.log('\nStep 2: Grouping SendLogs by user and contact...');

    const groupedLogs = new Map<string, GroupedSendLog>();

    for (const log of sendLogs) {
      const key = `${log.userId}:${log.toEmail.toLowerCase()}`;

      if (!groupedLogs.has(key)) {
        // Extract contact info from UserCandidate/Person if available
        let contactName = log.directRecipientName;
        let company: string | null = null;
        let role: string | null = null;
        let location: string | null = null;
        let linkedinUrl: string | null = null;

        if (log.userCandidate?.person) {
          const person = log.userCandidate.person;
          contactName = contactName || person.fullName;
          company = person.company;
          role = person.role;
          location = [person.city, person.state, person.country]
            .filter(Boolean)
            .join(', ') || null;
          linkedinUrl = person.linkedinUrl;
        }

        groupedLogs.set(key, {
          userId: log.userId,
          toEmail: log.toEmail,
          earliestSentAt: log.sentAt,
          latestSentAt: log.sentAt,
          sendLogIds: [log.id],
          gmailThreadId: log.gmailThreadId,
          contactName,
          company,
          role,
          location,
          linkedinUrl,
          userCandidateId: log.userCandidateId,
        });
      } else {
        const existing = groupedLogs.get(key)!;
        existing.sendLogIds.push(log.id);
        existing.latestSentAt = log.sentAt;
        // Update gmailThreadId if we don't have one yet
        if (!existing.gmailThreadId && log.gmailThreadId) {
          existing.gmailThreadId = log.gmailThreadId;
        }
        // Update userCandidateId if we don't have one yet
        if (!existing.userCandidateId && log.userCandidateId) {
          existing.userCandidateId = log.userCandidateId;
        }
      }
    }

    console.log(`Grouped into ${groupedLogs.size} unique contacts`);

    // Step 3: Check for responses in messages table
    console.log('\nStep 3: Checking for responses...');

    const threadsWithResponses = new Map<string, Date>();

    // Get all received messages
    const receivedMessages = await prisma.messages.findMany({
      where: {
        direction: 'RECEIVED',
      },
      select: {
        threadId: true,
        received_at: true,
      },
      orderBy: {
        received_at: 'asc',
      },
    });

    for (const msg of receivedMessages) {
      if (!threadsWithResponses.has(msg.threadId)) {
        threadsWithResponses.set(msg.threadId, msg.received_at);
      }
    }

    console.log(`Found ${threadsWithResponses.size} threads with responses`);

    // Step 4: Create OutreachTracker entries
    console.log('\nStep 4: Creating OutreachTracker entries...');

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const [key, group] of Array.from(groupedLogs.entries())) {
      try {
        // Check if tracker already exists
        const existing = await prisma.outreachTracker.findUnique({
          where: {
            userId_contactEmail: {
              userId: group.userId,
              contactEmail: group.toEmail,
            },
          },
        });

        if (existing) {
          console.log(`  Skipping ${group.toEmail} (already exists)`);
          skipped++;
          continue;
        }

        // Determine if there was a follow-up (multiple sends)
        const followedUpAt = group.sendLogIds.length > 1 ? group.latestSentAt : null;

        // Check for response
        let responseReceivedAt: Date | null = null;
        if (group.gmailThreadId && threadsWithResponses.has(group.gmailThreadId)) {
          responseReceivedAt = threadsWithResponses.get(group.gmailThreadId)!;
        }

        // Determine status
        let status: 'NOT_STARTED' | 'SENT' | 'WAITING' | 'RESPONDED' = 'SENT';
        if (responseReceivedAt) {
          status = 'RESPONDED';
        } else if (followedUpAt) {
          status = 'WAITING';
        }

        // Create tracker
        const tracker = await prisma.outreachTracker.create({
          data: {
            userId: group.userId,
            contactEmail: group.toEmail,
            contactName: group.contactName,
            company: group.company,
            role: group.role,
            location: group.location,
            linkedinUrl: group.linkedinUrl,
            userCandidateId: group.userCandidateId,
            gmailThreadId: group.gmailThreadId,
            dateEmailed: group.earliestSentAt,
            followedUpAt,
            responseReceivedAt,
            status,
          },
        });

        // Link SendLogs to this tracker
        await prisma.sendLog.updateMany({
          where: {
            id: { in: group.sendLogIds },
          },
          data: {
            outreachTrackerId: tracker.id,
          },
        });

        console.log(`  Created tracker for ${group.toEmail} (status: ${status})`);
        created++;
      } catch (error) {
        console.error(`  Error creating tracker for ${group.toEmail}:`, error);
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('Backfill completed!');
    console.log(`  Created: ${created}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Fatal error during backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backfill
backfillOutreach();
