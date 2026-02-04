import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  generateEmailFromPattern,
  getOrLearnPattern,
  normalizeCompanyName
} from '../src/lib/services/email-pattern';
import { verifyEmail } from '../src/lib/services/email-verification';

const prisma = new PrismaClient();

/**
 * Simulates the refresh flow's pattern-based email generation with Emailable verification
 */
async function testRefreshFlow() {
  console.log('=== Testing Refresh Flow with Emailable ===\n');

  // Find people without emails at a company with a known pattern
  const company = 'McKinsey & Company';
  const normalizedCompany = normalizeCompanyName(company);

  console.log(`Looking for pattern for: ${company}`);
  const pattern = await getOrLearnPattern(company);

  if (!pattern) {
    console.log('No pattern found for this company.');
    return;
  }

  console.log(`Found pattern: ${pattern.pattern}@${pattern.domain} (${Math.round(pattern.confidence * 100)}% confidence)\n`);

  // Find people at this company without emails
  const peopleWithoutEmails = await prisma.person.findMany({
    where: {
      company: { contains: 'McKinsey', mode: 'insensitive' },
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, fullName: true },
    take: 3, // Limit to 3 for testing
  });

  if (peopleWithoutEmails.length === 0) {
    console.log('No people without emails found. Testing with mock data instead.\n');

    // Use mock data for testing
    const mockPeople = [
      { firstName: 'Sarah', lastName: 'Johnson' },
      { firstName: 'Michael', lastName: 'Chen' },
    ];

    for (const person of mockPeople) {
      const generatedEmail = generateEmailFromPattern(
        person.firstName,
        person.lastName,
        pattern.pattern as any,
        pattern.domain
      );

      console.log(`\nGenerated: ${generatedEmail} for ${person.firstName} ${person.lastName}`);

      const verification = await verifyEmail(generatedEmail);

      console.log(`  State: ${verification.state}`);
      console.log(`  Reason: ${verification.reason}`);
      console.log(`  Deliverable: ${verification.deliverable}`);
      console.log(`  Latency: ${verification.latencyMs}ms`);

      if (verification.deliverable) {
        console.log(`  → Would save email with VERIFIED status`);
      } else {
        console.log(`  → Would NOT save email (undeliverable)`);
      }
    }
  } else {
    console.log(`Found ${peopleWithoutEmails.length} people without emails. Processing...\n`);

    for (const person of peopleWithoutEmails) {
      const generatedEmail = generateEmailFromPattern(
        person.firstName!,
        person.lastName!,
        pattern.pattern as any,
        pattern.domain
      );

      console.log(`\n${person.fullName}:`);
      console.log(`  Generated: ${generatedEmail}`);

      const verification = await verifyEmail(generatedEmail);

      console.log(`  State: ${verification.state}`);
      console.log(`  Reason: ${verification.reason}`);
      console.log(`  Deliverable: ${verification.deliverable}`);
      console.log(`  Latency: ${verification.latencyMs}ms`);

      if (verification.deliverable) {
        // Update the person with verified email
        await prisma.person.update({
          where: { id: person.id },
          data: {
            email: generatedEmail,
            emailStatus: 'VERIFIED',
            emailConfidence: Math.round(pattern.confidence * 100),
            emailDeliverable: true,
            emailVerifiedAt: new Date(),
            emailVerificationReason: verification.reason,
          },
        });
        console.log(`  → Saved email with VERIFIED status`);
      } else {
        // Mark as checked but don't set email
        await prisma.person.update({
          where: { id: person.id },
          data: {
            emailDeliverable: false,
            emailVerifiedAt: new Date(),
            emailVerificationReason: verification.reason,
          },
        });
        console.log(`  → Marked as undeliverable, no email saved`);
      }
    }
  }

  console.log('\n=== Test Complete ===');
  await prisma.$disconnect();
}

testRefreshFlow().catch(console.error);
