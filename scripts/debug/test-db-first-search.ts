/**
 * Test script for database-first search approach
 *
 * Tests:
 * 1. CSE Discovery (broad query)
 * 2. Apollo enrichment
 * 3. Database storage
 * 4. Database query with filters
 * 5. End-to-end search flow
 */

import { searchPeople } from '../src/lib/services/discovery';
import { findPeopleByFilters, saveDiscoveredPerson } from '../src/lib/db/person-service';
import { getOrFindEmail } from '../src/lib/services/email-cache';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Database-First Search Tests ===\n');

  // Test 1: CSE Discovery (Broad Query)
  console.log('--- Test 1: CSE Discovery (Broad Query) ---');
  const cseResults = await searchPeople({
    company: 'Boston Consulting Group',
    university: 'University of Texas at Austin',
    limit: 20,
  });
  console.log(`CSE found ${cseResults.length} LinkedIn profiles`);
  if (cseResults.length > 0) {
    console.log('Sample profiles:');
    cseResults.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.fullName} - ${p.sourceUrl}`);
    });
  }
  console.log('');

  // Test 2: Apollo Enrichment + Storage
  console.log('--- Test 2: Apollo Enrichment & Storage ---');
  let newCount = 0;
  let existingCount = 0;

  // Take first 5 for testing (to save API calls)
  const testProfiles = cseResults.slice(0, 5);

  for (const person of testProfiles) {
    if (!person.firstName || !person.lastName) continue;

    const linkedinUrl = person.sourceDomain?.includes('linkedin.com') ? person.sourceUrl : null;

    // Get Apollo data
    const emailResult = await getOrFindEmail({
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      linkedinUrl,
    });

    const apolloCompany = emailResult.employment?.company || person.company;

    // Save to database
    const { isNew } = await saveDiscoveredPerson(
      person.fullName,
      person.firstName,
      person.lastName,
      linkedinUrl,
      person.sourceUrl,
      person.sourceTitle,
      person.sourceSnippet,
      person.sourceDomain,
      {
        company: apolloCompany,
        role: emailResult.employment?.title || null,
        email: emailResult.email,
        emailStatus: emailResult.status,
        emailConfidence: emailResult.confidence,
        city: emailResult.city,
        state: emailResult.state,
        country: emailResult.country,
        education: emailResult.education,
      }
    );

    if (isNew) newCount++;
    else existingCount++;

    console.log(`  ${isNew ? '✅ NEW' : '📦 EXISTS'}: ${person.fullName} - Email: ${emailResult.email || 'none'}, City: ${emailResult.city || 'unknown'}`);
  }
  console.log(`Summary: ${newCount} new, ${existingCount} existing`);
  console.log('');

  // Test 3: Database Query with Filters
  console.log('--- Test 3: Database Query with Filters ---');

  // Test 3a: BCG people with email
  const bcgWithEmail = await findPeopleByFilters({
    company: 'Boston Consulting Group',
    requireEmail: true,
    limit: 100,
  });
  console.log(`BCG people with email: ${bcgWithEmail.length}`);

  // Test 3b: BCG + Houston
  const bcgHouston = await findPeopleByFilters({
    company: 'Boston Consulting Group',
    location: 'Houston',
    requireEmail: true,
    limit: 100,
  });
  console.log(`BCG + Houston with email: ${bcgHouston.length}`);
  if (bcgHouston.length > 0) {
    console.log('Houston BCG people:');
    bcgHouston.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.fullName} - ${p.city}, ${p.state} - Email: ${p.email}`);
    });
  }

  // Test 3c: BCG + Dallas
  const bcgDallas = await findPeopleByFilters({
    company: 'Boston Consulting Group',
    location: 'Dallas',
    requireEmail: true,
    limit: 100,
  });
  console.log(`BCG + Dallas with email: ${bcgDallas.length}`);
  console.log('');

  // Test 4: Verify hard filters work
  console.log('--- Test 4: Hard Filter Verification ---');

  // All results should have email
  const noEmailCount = bcgWithEmail.filter(p => !p.email).length;
  console.log(`Results without email (should be 0): ${noEmailCount}`);

  // Houston results should all have Houston in city
  const nonHoustonCount = bcgHouston.filter(p =>
    !p.city?.toLowerCase().includes('houston')
  ).length;
  console.log(`Houston results without Houston city (should be 0): ${nonHoustonCount}`);
  console.log('');

  // Test 5: Data summary
  console.log('--- Test 5: Database Summary ---');
  const totalBCG = await prisma.person.count({
    where: { company: { contains: 'Boston Consulting', mode: 'insensitive' } }
  });
  const bcgWithApollo = await prisma.person.count({
    where: {
      company: { contains: 'Boston Consulting', mode: 'insensitive' },
      apolloEnrichedAt: { not: null }
    }
  });
  const bcgWithEmailCount = await prisma.person.count({
    where: {
      company: { contains: 'Boston Consulting', mode: 'insensitive' },
      email: { not: null }
    }
  });

  console.log(`Total BCG people in DB: ${totalBCG}`);
  console.log(`With Apollo enrichment: ${bcgWithApollo}`);
  console.log(`With email: ${bcgWithEmailCount}`);
  console.log('');

  console.log('=== All Tests Complete ===');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Test error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
