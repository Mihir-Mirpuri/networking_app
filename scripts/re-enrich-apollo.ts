/**
 * Re-enrich people who were saved without emails due to Apollo credit shortage
 *
 * Usage: npx tsx scripts/re-enrich-apollo.ts [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Show what would be updated without making changes
 *   --limit N   Limit to N people (default: 337, your credit count)
 */

import { PrismaClient, EmailStatus } from '@prisma/client';
import { findEmail, EmailResult } from '../src/lib/services/enrichment';

const prisma = new PrismaClient();

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 337;

// The cutoff when credits started running low (Jan 30, 2026 05:00 UTC)
// This is when success rate dropped from ~98% to ~19%
const CREDIT_SHORTAGE_START = new Date('2026-01-30T05:00:00Z');

// Don't re-process people we already tried today
const ALREADY_PROCESSED_AFTER = new Date('2026-01-30T20:10:00Z');

interface PersonToReEnrich {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string;
  linkedinUrl: string | null;
  apolloEnrichedAt: Date | null;
}

async function getAffectedPeople(): Promise<PersonToReEnrich[]> {
  // Get people who:
  // 1. Were enriched after the credit shortage started
  // 2. Have no email
  // 3. Have a LinkedIn URL (for better Apollo matching)
  // 4. Haven't been re-processed already today
  const people = await prisma.person.findMany({
    where: {
      apolloEnrichedAt: {
        gte: CREDIT_SHORTAGE_START,
        lt: ALREADY_PROCESSED_AFTER,  // Skip people we already tried
      },
      email: null,
      linkedinUrl: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
      apolloEnrichedAt: true,
    },
    orderBy: { apolloEnrichedAt: 'asc' }, // Process oldest first
    take: LIMIT,
  });

  return people;
}

async function updatePersonWithApolloData(
  personId: string,
  emailResult: EmailResult
): Promise<void> {
  const updateData: Record<string, unknown> = {
    apolloEnrichedAt: new Date(),
  };

  // Only update email if we got one
  if (emailResult.email) {
    updateData.email = emailResult.email;
    updateData.emailStatus = emailResult.status as EmailStatus;
    updateData.emailConfidence = emailResult.confidence;
    updateData.emailLastUpdated = new Date();
  }

  // Update location if provided
  if (emailResult.city) updateData.city = emailResult.city;
  if (emailResult.state) updateData.state = emailResult.state;
  if (emailResult.country) updateData.country = emailResult.country;

  // Update education if provided
  if (emailResult.education) {
    if (emailResult.education.schoolName) updateData.educationSchool = emailResult.education.schoolName;
    if (emailResult.education.degree) updateData.educationDegree = emailResult.education.degree;
    if (emailResult.education.fieldOfStudy) updateData.educationField = emailResult.education.fieldOfStudy;
    if (emailResult.education.graduationYear) updateData.educationYear = emailResult.education.graduationYear;
  }

  await prisma.person.update({
    where: { id: personId },
    data: updateData,
  });

  // Also update any UserCandidate records linked to this person
  if (emailResult.email) {
    await prisma.userCandidate.updateMany({
      where: { personId },
      data: {
        email: emailResult.email,
        emailStatus: emailResult.status as EmailStatus,
        emailConfidence: emailResult.confidence,
      },
    });
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Apollo Re-Enrichment Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Limit: ${LIMIT} people`);
  console.log(`Credit shortage cutoff: ${CREDIT_SHORTAGE_START.toISOString()}`);
  console.log('');

  // Get affected people
  const people = await getAffectedPeople();
  console.log(`Found ${people.length} people to re-enrich`);
  console.log('');

  if (people.length === 0) {
    console.log('No people need re-enrichment!');
    await prisma.$disconnect();
    return;
  }

  // Show first few
  console.log('First 10 people to process:');
  people.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} @ ${p.company}`);
  });
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN - No API calls will be made');
    console.log('Run without --dry-run to execute');
    await prisma.$disconnect();
    return;
  }

  // Process each person
  let successCount = 0;
  let failCount = 0;
  let noEmailCount = 0;
  let consecutiveNoEmail = 0;
  const CONSECUTIVE_THRESHOLD = 15; // Stop if 15+ consecutive no-email after having success

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const progress = `[${i + 1}/${people.length}]`;

    // Need first/last name for Apollo
    if (!person.firstName || !person.lastName) {
      console.log(`${progress} SKIP: ${person.fullName} - missing first/last name`);
      failCount++;
      continue;
    }

    console.log(`${progress} Enriching: ${person.fullName} @ ${person.company}`);

    try {
      const result = await findEmail({
        firstName: person.firstName,
        lastName: person.lastName,
        company: person.company,
        linkedinUrl: person.linkedinUrl,
      });

      if (result.email) {
        await updatePersonWithApolloData(person.id, result);
        console.log(`         ✓ Found: ${result.email} (${result.status})`);
        successCount++;
        consecutiveNoEmail = 0; // Reset counter on success
      } else {
        // Still update apolloEnrichedAt to mark as processed
        await prisma.person.update({
          where: { id: person.id },
          data: { apolloEnrichedAt: new Date() },
        });
        console.log(`         ✗ No email found (Apollo has no data for this person)`);
        noEmailCount++;
        consecutiveNoEmail++;

        // Detect potential credit exhaustion
        if (successCount > 0 && consecutiveNoEmail >= CONSECUTIVE_THRESHOLD) {
          console.log('');
          console.log('⚠️  WARNING: Possible credit exhaustion detected!');
          console.log(`    ${consecutiveNoEmail} consecutive people with no email after ${successCount} successes.`);
          console.log('    Stopping to preserve remaining credits.');
          console.log('    (This could also just be a batch of people Apollo doesn\'t have)');
          break;
        }
      }

      // Rate limiting - Apollo recommends 300ms between calls
      await new Promise((r) => setTimeout(r, 350));
    } catch (error) {
      console.log(`         ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failCount++;
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${people.length}`);
  console.log(`Emails found:    ${successCount} (${((successCount / people.length) * 100).toFixed(1)}%)`);
  console.log(`No email in Apollo: ${noEmailCount}`);
  console.log(`Errors/skipped:  ${failCount}`);
  console.log('');
  console.log(`Credits used: ~${successCount + noEmailCount}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
