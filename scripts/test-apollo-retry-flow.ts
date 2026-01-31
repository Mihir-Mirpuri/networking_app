/**
 * Test script for Apollo credit exhaustion retry flow
 *
 * Phase 1: Run with no Apollo credits
 * - Discovers people via CSE for "Accenture + UT Austin + Houston + Consulting"
 * - Attempts Apollo enrichment (should fail due to no credits)
 * - Saves people with apolloStatus = 'API_ERROR' and apolloEnrichedAt = null
 *
 * Phase 2: Run again after credits are purchased
 * - Same search should find same people in DB
 * - Since apolloEnrichedAt is null, Apollo should be called again
 * - Verify apolloStatus = 'SUCCESS' and apolloEnrichedAt is set
 */

import { PrismaClient, ApolloStatus } from '@prisma/client';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { findEmail } from '../src/lib/services/enrichment';
import { saveDiscoveredPerson } from '../src/lib/db/person-service';

const prisma = new PrismaClient();

const TEST_COMPANY = 'Accenture';
const TEST_SEARCH_PARAMS = {
  company: 'Accenture',
  university: 'University of Texas at Austin',
  location: 'Houston',
  role: 'Consulting',
  limit: 10, // Just 1 page of results
};

async function runTest() {
  console.log('='.repeat(60));
  console.log('APOLLO RETRY FLOW TEST - PHASE 1 (No Credits)');
  console.log('='.repeat(60));
  console.log('');
  console.log('Search params:', TEST_SEARCH_PARAMS);
  console.log('');

  // Step 1: Discover LinkedIn profiles via CSE
  console.log('STEP 1: Discovering LinkedIn profiles via CSE...');
  console.log('-'.repeat(40));

  const discoveredProfiles = await discoverLinkedInProfiles(TEST_SEARCH_PARAMS);

  console.log(`\nDiscovered ${discoveredProfiles.length} profiles:`);
  discoveredProfiles.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} - ${p.linkedinUrl}`);
  });
  console.log('');

  if (discoveredProfiles.length === 0) {
    console.log('No profiles discovered. Exiting.');
    await prisma.$disconnect();
    return;
  }

  // Step 2: Attempt Apollo enrichment for each profile
  console.log('STEP 2: Attempting Apollo enrichment (expecting API_ERROR)...');
  console.log('-'.repeat(40));

  const enrichmentResults: Array<{
    profile: typeof discoveredProfiles[0];
    apolloResult: Awaited<ReturnType<typeof findEmail>>;
    personId: string | null;
  }> = [];

  for (const profile of discoveredProfiles) {
    console.log(`\nEnriching: ${profile.fullName}`);

    const apolloResult = await findEmail({
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      company: TEST_COMPANY,
      linkedinUrl: profile.linkedinUrl,
    });

    console.log(`  Apollo status: ${apolloResult.apolloStatus}`);
    console.log(`  Email: ${apolloResult.email || 'none'}`);

    // Step 3: Save to database (pass search university as fallback)
    const { personId } = await saveDiscoveredPerson(
      profile.fullName,
      profile.firstName,
      profile.lastName,
      profile.linkedinUrl,
      profile.linkedinUrl, // sourceUrl
      profile.sourceTitle,
      profile.sourceSnippet,
      profile.sourceDomain,
      {
        company: TEST_COMPANY, // Fallback company from search
        apolloCompany: apolloResult.employment?.company || null, // Apollo's current employer (source of truth)
        role: apolloResult.employment?.title || null,
        email: apolloResult.email,
        emailStatus: apolloResult.status,
        emailConfidence: apolloResult.confidence,
        city: apolloResult.city,
        state: apolloResult.state,
        country: apolloResult.country,
        education: apolloResult.education,
        apolloStatus: apolloResult.apolloStatus,
      },
      TEST_SEARCH_PARAMS.university // Fallback university from search
    );

    console.log(`  Saved with personId: ${personId}`);
    enrichmentResults.push({ profile, apolloResult, personId });

    // Small delay between API calls
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Step 4: Verify database state
  console.log('\n');
  console.log('STEP 3: Verifying database state...');
  console.log('-'.repeat(40));

  const personIds = enrichmentResults.map(r => r.personId).filter(Boolean) as string[];

  const savedPeople = await prisma.person.findMany({
    where: {
      id: { in: personIds },
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      apolloStatus: true,
      apolloEnrichedAt: true,
      email: true,
      role: true,
      city: true,
    },
  });

  console.log('\nDatabase state for discovered people:\n');
  console.log('| Name | Apollo Status | EnrichedAt | Email | Role | City |');
  console.log('|------|---------------|------------|-------|------|------|');

  let apiErrorCount = 0;
  let successCount = 0;
  let nullEnrichedAtCount = 0;

  for (const person of savedPeople) {
    const status = person.apolloStatus || 'null';
    const enrichedAt = person.apolloEnrichedAt ? 'SET' : 'null';
    const email = person.email || '-';
    const role = person.role || '-';
    const city = person.city || '-';

    console.log(`| ${person.fullName.substring(0, 20).padEnd(20)} | ${status.padEnd(13)} | ${enrichedAt.padEnd(10)} | ${email.substring(0, 20).padEnd(20)} | ${role.substring(0, 15).padEnd(15)} | ${city.padEnd(10)} |`);

    if (person.apolloStatus === 'API_ERROR') apiErrorCount++;
    if (person.apolloStatus === 'SUCCESS') successCount++;
    if (!person.apolloEnrichedAt) nullEnrichedAtCount++;
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total discovered: ${discoveredProfiles.length}`);
  console.log(`Total saved: ${savedPeople.length}`);
  console.log(`API_ERROR status: ${apiErrorCount}`);
  console.log(`SUCCESS status: ${successCount}`);
  console.log(`apolloEnrichedAt is null: ${nullEnrichedAtCount}`);
  console.log('');

  if (apiErrorCount > 0 && nullEnrichedAtCount === apiErrorCount) {
    console.log('✅ TEST PASSED: Apollo errors are being tracked correctly!');
    console.log('   - People with API_ERROR have apolloEnrichedAt = null');
    console.log('   - These will be re-enriched when credits are available');
  } else if (successCount > 0) {
    console.log('⚠️  Apollo has credits! Some enrichments succeeded.');
    console.log('   - This test is meant to run when credits are exhausted.');
  } else {
    console.log('❌ TEST INCONCLUSIVE: Check the results above.');
  }

  console.log('');
  console.log('Person IDs for Phase 2 verification:');
  personIds.forEach(id => console.log(`  - ${id}`));

  await prisma.$disconnect();
}

runTest().catch(async (error) => {
  console.error('Test failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
