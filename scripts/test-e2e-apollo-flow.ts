/**
 * End-to-end test for the Apollo bootstrap flow
 *
 * Simulates what happens when a user searches for a company
 * that doesn't have an email pattern yet.
 *
 * Test steps:
 * 1. Pick a company without a pattern (or delete existing pattern for test)
 * 2. Run the refresh flow (CSE → Scrape → Email generation with Apollo bootstrap)
 * 3. Verify pattern was learned
 * 4. Verify emails were generated for all people
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '../src/lib/services/linkedin-scraper';
import { saveScrapedProfile } from '../src/lib/db/person-service';
import {
  getOrLearnPattern,
  generateEmailFromPattern,
  normalizeCompanyName,
  bootstrapCompanyPattern,
} from '../src/lib/services/email-pattern';

const prisma = new PrismaClient();

// Test configuration
const TEST_COMPANY = 'Ernst & Young'; // EY - likely doesn't have pattern
const TEST_UNIVERSITY = 'University of Texas at Austin';
const CSE_LIMIT = 10;

async function main() {
  console.log('=== E2E Test: Apollo Bootstrap Flow ===\n');
  console.log(`Company: ${TEST_COMPANY}`);
  console.log(`University: ${TEST_UNIVERSITY}`);
  console.log('');

  const startTime = Date.now();

  // ===== STEP 1: Check initial state =====
  console.log('Step 1: Checking initial state...');
  const normalizedCompany = normalizeCompanyName(TEST_COMPANY);

  const existingPattern = await prisma.companyEmailPattern.findFirst({
    where: { company: normalizedCompany },
  });

  if (existingPattern) {
    console.log(`  Pattern exists: ${existingPattern.pattern}@${existingPattern.domain}`);
    console.log('  Deleting for clean test...');
    await prisma.companyEmailPattern.delete({
      where: { id: existingPattern.id },
    });
    console.log('  Deleted.');
  } else {
    console.log('  No existing pattern - clean state.');
  }
  console.log('');

  // ===== STEP 2: CSE Discovery =====
  console.log('Step 2: CSE Discovery...');
  const cseStart = Date.now();
  const cseResults = await discoverLinkedInProfiles({
    company: TEST_COMPANY,
    university: TEST_UNIVERSITY,
    limit: CSE_LIMIT,
  });
  console.log(`  Found ${cseResults.length} LinkedIn profiles in ${Date.now() - cseStart}ms`);

  if (cseResults.length === 0) {
    console.log('  No profiles found. Try a different company.');
    return;
  }

  cseResults.slice(0, 5).forEach(r => console.log(`    - ${r.linkedinUrl}`));
  if (cseResults.length > 5) console.log(`    ... and ${cseResults.length - 5} more`);
  console.log('');

  // ===== STEP 3: Check existing & scrape =====
  console.log('Step 3: Check existing & scrape...');
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existing = await prisma.person.findMany({
    where: { linkedinUrl: { in: linkedinUrls } },
    select: { id: true, linkedinUrl: true },
  });
  const existingUrls = new Set(existing.map(e => e.linkedinUrl));
  const urlsToScrape = linkedinUrls.filter(url => !existingUrls.has(url));

  console.log(`  Existing in DB: ${existing.length}`);
  console.log(`  Need to scrape: ${urlsToScrape.length}`);

  const savedPersonIds: string[] = existing.map(e => e.id);
  let newPeopleCount = 0;

  if (urlsToScrape.length > 0) {
    const scrapeStart = Date.now();
    const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

    const processBatch = async (profiles: ScrapedProfile[]) => {
      for (const profile of profiles) {
        const cseResult = cseResultMap.get(profile.linkedinUrl);
        if (!cseResult) continue;

        const { personId, isNew } = await saveScrapedProfile(
          profile,
          cseResult.linkedinUrl,
          cseResult.sourceTitle,
          cseResult.sourceSnippet,
          cseResult.sourceDomain,
          TEST_COMPANY,
          TEST_UNIVERSITY
        );

        savedPersonIds.push(personId);
        if (isNew) newPeopleCount++;
      }
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });

    console.log(`  Scraped ${newPeopleCount} new people in ${((Date.now() - scrapeStart) / 1000).toFixed(2)}s`);
  }
  console.log('');

  // ===== STEP 4: Generate emails (with Apollo bootstrap) =====
  console.log('Step 4: Generate emails with Apollo bootstrap...');
  const emailStart = Date.now();

  // Get people without emails
  const peopleWithoutEmails = await prisma.person.findMany({
    where: {
      id: { in: savedPersonIds },
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, company: true, linkedinUrl: true },
  });

  console.log(`  ${peopleWithoutEmails.length} people without emails`);

  // Group by company
  const byCompany = new Map<string, typeof peopleWithoutEmails>();
  for (const person of peopleWithoutEmails) {
    const normalized = normalizeCompanyName(person.company);
    if (!byCompany.has(normalized)) {
      byCompany.set(normalized, []);
    }
    byCompany.get(normalized)!.push(person);
  }

  let emailsGenerated = 0;
  let apolloCallsMade = 0;
  let patternsLearned = 0;

  for (const [normalized, people] of Array.from(byCompany)) {
    const company = people[0].company;
    console.log(`\n  Company: "${company}" (${people.length} people)`);

    // Check if pattern exists
    let pattern = await getOrLearnPattern(company);

    if (!pattern) {
      console.log(`    No pattern - calling Apollo for bootstrap...`);
      const bootstrapResult = await bootstrapCompanyPattern(company, people);

      if (bootstrapResult) {
        pattern = bootstrapResult;
        apolloCallsMade += bootstrapResult.apolloCallsMade;
        emailsGenerated += bootstrapResult.emailsFound;
        patternsLearned++;

        console.log(`    Learned: ${pattern.pattern}@${pattern.domain} (${bootstrapResult.apolloCallsMade} Apollo calls)`);
      } else {
        console.log(`    Could not learn pattern - Apollo returned insufficient emails`);
        continue;
      }
    } else {
      console.log(`    Existing pattern: ${pattern.pattern}@${pattern.domain}`);
    }

    // Generate emails for remaining people
    const remaining = await prisma.person.findMany({
      where: {
        id: { in: people.map(p => p.id) },
        email: null,
        firstName: { not: null },
        lastName: { not: null },
      },
      select: { id: true, firstName: true, lastName: true },
    });

    for (const person of remaining) {
      const email = generateEmailFromPattern(
        person.firstName!,
        person.lastName!,
        pattern.pattern as any,
        pattern.domain
      );

      await prisma.person.update({
        where: { id: person.id },
        data: {
          email,
          emailStatus: 'UNVERIFIED',
          emailConfidence: Math.round(pattern.confidence * 100),
        },
      });
      emailsGenerated++;
    }

    if (remaining.length > 0) {
      console.log(`    Generated ${remaining.length} additional emails from pattern`);
    }
  }

  const emailTime = ((Date.now() - emailStart) / 1000).toFixed(2);
  console.log(`\n  Email generation complete in ${emailTime}s`);
  console.log('');

  // ===== STEP 5: Verify results =====
  console.log('Step 5: Verify results...');
  const finalPeople = await prisma.person.findMany({
    where: { id: { in: savedPersonIds } },
    select: {
      fullName: true,
      company: true,
      email: true,
      emailStatus: true,
      emailConfidence: true,
      apolloStatus: true,
    },
    orderBy: { fullName: 'asc' },
  });

  const withEmail = finalPeople.filter(p => p.email);
  const apolloEnriched = finalPeople.filter(p => p.apolloStatus === 'SUCCESS');

  console.log(`  Total people: ${finalPeople.length}`);
  console.log(`  With emails: ${withEmail.length} (${Math.round((withEmail.length / finalPeople.length) * 100)}%)`);
  console.log(`  Apollo enriched: ${apolloEnriched.length}`);
  console.log(`  Pattern generated: ${withEmail.length - apolloEnriched.length}`);
  console.log('');

  // Check pattern was saved
  const savedPattern = await prisma.companyEmailPattern.findFirst({
    where: { company: normalizedCompany },
  });

  if (savedPattern) {
    console.log(`  Pattern saved: ${savedPattern.pattern}@${savedPattern.domain}`);
    console.log(`  Confidence: ${Math.round(savedPattern.confidence * 100)}%`);
    console.log(`  Sample size: ${savedPattern.sampleSize}`);
  } else {
    console.log('  WARNING: Pattern not saved!');
  }
  console.log('');

  // ===== SUMMARY =====
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('=== Summary ===');
  console.log(`Total time: ${totalTime}s`);
  console.log(`CSE profiles: ${cseResults.length}`);
  console.log(`New people scraped: ${newPeopleCount}`);
  console.log(`Apollo calls: ${apolloCallsMade}`);
  console.log(`Patterns learned: ${patternsLearned}`);
  console.log(`Emails generated: ${emailsGenerated}`);
  console.log(`Email coverage: ${Math.round((withEmail.length / finalPeople.length) * 100)}%`);
  console.log('');

  console.log('People:');
  finalPeople.forEach(p => {
    const source = p.apolloStatus === 'SUCCESS' ? 'Apollo' : 'Pattern';
    console.log(`  - ${p.fullName} @ ${p.company}`);
    console.log(`    ${p.email || 'NO EMAIL'} (${source}, ${p.emailConfidence || 0}%)`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
