/**
 * Backfill abbreviated last names using LinkedIn URL slugs
 *
 * ~65 people in the DB have abbreviated last names (e.g., "Sarah G.")
 * because LinkedIn hides full last names from non-connections.
 * The LinkedIn URL slug typically contains the full name.
 *
 * Usage:
 *   npx tsx scripts/backfill-abbreviated-names.ts           # Dry run (default)
 *   npx tsx scripts/backfill-abbreviated-names.ts --apply   # Apply changes
 */

import { PrismaClient } from '@prisma/client';
import { extractNameFromSlug, isAbbreviatedName } from '../src/lib/services/linkedin-scraper';
import { detectPattern, generateEmailFromPattern } from '../src/lib/services/email-pattern';

const prisma = new PrismaClient();
const dryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN (pass --apply to write)' : 'APPLYING CHANGES'}\n`);

  // Find all Person records with abbreviated last names
  const people = await prisma.person.findMany({
    where: {
      linkedinUrl: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      linkedinUrl: true,
      email: true,
      emailStatus: true,
      emailConfidence: true,
      company: true,
    },
  });

  // Filter to abbreviated names in application code (regex not supported in Prisma where)
  const abbreviated = people.filter(
    (p) => (p.lastName && isAbbreviatedName(p.lastName)) || (p.firstName && isAbbreviatedName(p.firstName))
  );

  console.log(`Found ${abbreviated.length} people with abbreviated names\n`);

  let updated = 0;
  let skipped = 0;
  let emailsRegenerated = 0;

  for (const person of abbreviated) {
    const slugName = extractNameFromSlug(person.linkedinUrl!);
    if (!slugName) {
      console.log(`  SKIP ${person.fullName} (${person.linkedinUrl}) — could not parse slug`);
      skipped++;
      continue;
    }

    // Detect reversed slugs (e.g., "baker-natalie" for Natalie Baker)
    if (
      person.firstName &&
      slugName.lastName.toLowerCase() === person.firstName.toLowerCase() &&
      slugName.firstName.toLowerCase() !== person.firstName.toLowerCase()
    ) {
      const tmp = slugName.firstName;
      slugName.firstName = slugName.lastName;
      slugName.lastName = tmp;
    }

    // Verify slug firstName matches DB firstName (catches custom slugs)
    const slugFirstMatchesDb = person.firstName && (
      slugName.firstName.toLowerCase() === person.firstName.toLowerCase() ||
      slugName.firstName[0]?.toLowerCase() === person.firstName[0]?.toLowerCase()
    );

    if (!slugFirstMatchesDb) {
      console.log(`  SKIP ${person.fullName} (${person.linkedinUrl}) — slug firstName "${slugName.firstName}" doesn't match "${person.firstName}"`);
      skipped++;
      continue;
    }

    let newFirstName = person.firstName;
    let newLastName = person.lastName;
    let changed = false;

    if (person.lastName && isAbbreviatedName(person.lastName) && slugName.lastName.length > person.lastName.replace('.', '').length) {
      console.log(`  "${person.lastName}" → "${slugName.lastName}" for ${person.fullName} (${person.linkedinUrl})`);
      newLastName = slugName.lastName;
      changed = true;
    }

    if (person.firstName && isAbbreviatedName(person.firstName) && slugName.firstName.length > person.firstName.replace('.', '').length) {
      console.log(`  "${person.firstName}" → "${slugName.firstName}" for ${person.fullName} (${person.linkedinUrl})`);
      newFirstName = slugName.firstName;
      changed = true;
    }

    if (!changed) {
      console.log(`  SKIP ${person.fullName} — slug name not longer`);
      skipped++;
      continue;
    }

    const newFullName = `${newFirstName} ${newLastName}`.trim();

    // Check if person has a pattern-generated email that used the old abbreviated name
    let newEmail: string | null = null;
    if (person.email && person.firstName && person.lastName) {
      const detected = detectPattern(person.email, person.firstName, person.lastName);
      if (detected && newFirstName && newLastName) {
        // Email was pattern-generated with old name — regenerate with new name
        newEmail = generateEmailFromPattern(newFirstName, newLastName, detected.pattern, detected.domain);
        if (newEmail !== person.email) {
          console.log(`    Email: "${person.email}" → "${newEmail}"`);
          emailsRegenerated++;
        } else {
          newEmail = null; // No change needed
        }
      }
    }

    if (!dryRun) {
      // Check for conflicts: another Person with the new fullName+company might exist
      const conflict = await prisma.person.findUnique({
        where: {
          fullName_company: {
            fullName: newFullName,
            company: person.company,
          },
        },
        select: { id: true },
      });

      if (conflict && conflict.id !== person.id) {
        console.log(`    CONFLICT: "${newFullName}" at "${person.company}" already exists (${conflict.id}), skipping`);
        skipped++;
        continue;
      }

      await prisma.person.update({
        where: { id: person.id },
        data: {
          fullName: newFullName,
          firstName: newFirstName,
          lastName: newLastName,
          ...(newEmail ? { email: newEmail } : {}),
        },
      });
    }

    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Emails regenerated: ${emailsRegenerated}`);

  if (dryRun) {
    console.log(`\nThis was a dry run. Pass --apply to write changes.`);
  }
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
