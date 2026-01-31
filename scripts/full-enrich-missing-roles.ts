/**
 * Full re-enrichment for people missing roles
 * Uses Apollo as source of truth - updates ALL fields from Apollo response
 */

import { PrismaClient, EmailStatus } from '@prisma/client';
import { findEmail } from '../src/lib/services/enrichment';

const prisma = new PrismaClient();

async function main() {
  // Get people with email but missing role
  const people = await prisma.person.findMany({
    where: {
      email: { not: null },
      role: null,
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
      email: true,
      city: true,
      educationSchool: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log('=== FULL APOLLO ENRICHMENT ===');
  console.log(`People to enrich: ${people.length}`);
  console.log('Using Apollo as source of truth\n');

  let enriched = 0;
  let skipped = 0;
  let changes: string[] = [];

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const progress = `[${i + 1}/${people.length}]`;

    if (!person.firstName || !person.lastName) {
      console.log(`${progress} SKIP: ${person.fullName} - missing first/last name`);
      skipped++;
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

      // Track what changed
      const personChanges: string[] = [];

      // Build update data from Apollo response
      const updateData: Record<string, any> = {
        apolloEnrichedAt: new Date(),
      };

      // Email
      if (result.email && result.email !== person.email) {
        personChanges.push(`email: ${person.email} → ${result.email}`);
        updateData.email = result.email;
        updateData.emailStatus = result.status as EmailStatus;
        updateData.emailConfidence = result.confidence;
        updateData.emailLastUpdated = new Date();
      }

      // Location
      if (result.city && result.city !== person.city) {
        personChanges.push(`city: ${person.city || 'null'} → ${result.city}`);
        updateData.city = result.city;
      }
      if (result.state) updateData.state = result.state;
      if (result.country) updateData.country = result.country;

      // Role (from employment)
      if (result.employment?.title) {
        personChanges.push(`role: null → ${result.employment.title}`);
        updateData.role = result.employment.title;
      }

      // Company (from employment) - flag if different
      if (result.employment?.company) {
        const apolloCompany = result.employment.company;
        const dbCompany = person.company;
        // Check if substantially different (not just formatting)
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalize(apolloCompany).includes(normalize(dbCompany).slice(0, 10)) &&
            !normalize(dbCompany).includes(normalize(apolloCompany).slice(0, 10))) {
          personChanges.push(`⚠️ COMPANY MISMATCH: DB="${dbCompany}" Apollo="${apolloCompany}"`);
          updateData.company = apolloCompany;
        }
      }

      // Education
      if (result.education?.schoolName && result.education.schoolName !== person.educationSchool) {
        personChanges.push(`school: ${person.educationSchool || 'null'} → ${result.education.schoolName}`);
        updateData.educationSchool = result.education.schoolName;
      }
      if (result.education?.degree) updateData.educationDegree = result.education.degree;
      if (result.education?.fieldOfStudy) updateData.educationField = result.education.fieldOfStudy;
      if (result.education?.graduationYear) updateData.educationYear = result.education.graduationYear;

      // Apply update
      await prisma.person.update({
        where: { id: person.id },
        data: updateData,
      });

      if (personChanges.length > 0) {
        console.log(`   Changes: ${personChanges.join(', ')}`);
        changes.push(`${person.fullName}: ${personChanges.join(', ')}`);
      } else {
        console.log(`   No changes (Apollo data matches DB)`);
      }

      enriched++;

      // Rate limiting
      await new Promise((r) => setTimeout(r, 350));
    } catch (error) {
      console.log(`   ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
      skipped++;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Enriched: ${enriched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Records with changes: ${changes.length}`);

  if (changes.filter(c => c.includes('COMPANY MISMATCH')).length > 0) {
    console.log('\n=== COMPANY MISMATCHES (people who switched jobs) ===');
    changes.filter(c => c.includes('COMPANY MISMATCH')).forEach(c => console.log(c));
  }

  await prisma.$disconnect();
}

main().catch(console.error);
