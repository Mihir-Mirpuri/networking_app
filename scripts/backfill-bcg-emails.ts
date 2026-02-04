/**
 * Backfill script to generate emails for BCG people missing emails
 *
 * Uses the known pattern (last.first@bcg.com) and verifies with Emailable.
 * With the fix to trust patterns when SMTP is blocked, these should now save.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import emailable from 'emailable';

const prisma = new PrismaClient();
const emailClient = emailable(process.env.EMAILABLE_API_KEY!);

// BCG pattern: last.first@bcg.com
const PATTERN = 'last.first';
const DOMAIN = 'bcg.com';

/**
 * Clean first name (remove middle initials)
 */
function cleanFirstName(firstName: string): string {
  if (!firstName) return '';
  let cleaned = firstName.trim();
  cleaned = cleaned.replace(/\s+[A-Z]\.?$/i, '');
  cleaned = cleaned.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  return parts[0] || cleaned;
}

/**
 * Clean last name (remove credentials)
 */
function cleanLastName(lastName: string): string {
  if (!lastName) return '';
  const credentials = ['mba', 'mha', 'mph', 'phd', 'md', 'jd', 'cpa', 'cfa', 'jr', 'sr', 'ii', 'iii'];
  let cleaned = lastName.trim();
  cleaned = cleaned.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  const filtered = parts.filter(p => !credentials.includes(p.toLowerCase().replace(/[.,]/g, '')));
  return filtered.length > 0 ? filtered.join(' ') : cleaned;
}

/**
 * Normalize name for email
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Generate email from pattern
 */
function generateEmail(firstName: string, lastName: string): string {
  const first = normalizeName(cleanFirstName(firstName));
  const last = normalizeName(cleanLastName(lastName));
  return `${last}.${first}@${DOMAIN}`;
}

/**
 * Verify email with Emailable
 */
async function verifyEmail(email: string): Promise<{ deliverable: boolean; reason: string }> {
  try {
    const response = await emailClient.verify(email);

    let deliverable = false;
    if (response.state === 'deliverable') {
      deliverable = true;
    } else if (response.state === 'risky' && response.accept_all) {
      deliverable = true;
    } else if (
      response.state === 'unknown' &&
      (response.reason === 'unavailable_smtp' || response.reason === 'unexpected_error')
    ) {
      // Trust the pattern when SMTP is blocked
      deliverable = true;
    }

    const trustNote =
      response.state === 'unknown' &&
      (response.reason === 'unavailable_smtp' || response.reason === 'unexpected_error')
        ? ' (trusting pattern)'
        : '';

    console.log(`  [Emailable] ${email} → ${response.state} (${response.reason})${trustNote} → deliverable=${deliverable}`);

    return { deliverable, reason: response.reason || 'unknown' };
  } catch (error) {
    console.error(`  [Emailable] Error: ${error}`);
    return { deliverable: false, reason: 'verification_error' };
  }
}

async function backfillBCGEmails() {
  console.log('=== BCG Email Backfill ===\n');

  // Find all BCG people without emails who have first/last names
  const bcgPeople = await prisma.person.findMany({
    where: {
      OR: [
        { company: { contains: 'boston consulting', mode: 'insensitive' } },
        { company: { contains: 'bcg', mode: 'insensitive' } },
      ],
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      role: true,
    },
  });

  console.log(`Found ${bcgPeople.length} BCG people without emails\n`);

  if (bcgPeople.length === 0) {
    console.log('Nothing to backfill!');
    return;
  }

  // Generate and verify emails
  let savedCount = 0;
  let skippedCount = 0;

  for (const person of bcgPeople) {
    const email = generateEmail(person.firstName!, person.lastName!);
    console.log(`\n${person.fullName} (${person.role || 'no role'})`);
    console.log(`  Generated: ${email}`);

    const verification = await verifyEmail(email);

    if (verification.deliverable) {
      await prisma.person.update({
        where: { id: person.id },
        data: {
          email,
          emailStatus: 'UNVERIFIED', // Pattern-generated
          emailConfidence: 100,
          emailDeliverable: true,
          emailVerifiedAt: new Date(),
          emailVerificationReason: verification.reason,
        },
      });
      savedCount++;
      console.log(`  ✓ Saved!`);
    } else {
      skippedCount++;
      console.log(`  ✗ Skipped (undeliverable)`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total BCG people: ${bcgPeople.length}`);
  console.log(`Emails saved: ${savedCount}`);
  console.log(`Emails skipped: ${skippedCount}`);
}

backfillBCGEmails()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
