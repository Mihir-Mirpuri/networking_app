/**
 * End-to-end test for the pagination feature
 * Tests the full refresh flow with different page starts
 */
import { PrismaClient } from '@prisma/client';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '../src/lib/services/linkedin-scraper';
import { saveScrapedProfile, findPeopleByLinkedInUrls, getExcludedPersonKeys, findPeopleByFilters } from '../src/lib/db/person-service';
import { getOrLearnPattern, generateEmailFromPattern, normalizeCompanyName, bootstrapCompanyPattern } from '../src/lib/services/email-pattern';
import { verifyEmailsBatch } from '../src/lib/services/email-verification';

const prisma = new PrismaClient();

interface RefreshBatchResult {
  newPeopleCount: number;
  emailsGenerated: number;
  apolloCallsMade: number;
  savedPersonIds: string[];
  urlsScraped: number;
  urlsFromCse: number;
}

/**
 * Simulates processRefreshBatch from search.ts
 */
async function simulateProcessRefreshBatch(
  input: { company: string; university?: string; role?: string; location?: string },
  excludedKeys: Set<string>,
  pageStart: number,
  batchLabel: string
): Promise<RefreshBatchResult> {
  let newPeopleCount = 0;
  let emailsGenerated = 0;
  let apolloCallsMade = 0;
  const savedPersonIds: string[] = [];

  // STEP 1: CSE Discovery
  console.log(`[${batchLabel}] CSE Discovery (page ${pageStart})`);
  const cseResults = await discoverLinkedInProfiles({
    company: input.company,
    university: input.university,
    role: input.role,
    location: input.location,
    limit: 10,
    pageStart,
  });
  console.log(`[${batchLabel}] CSE found ${cseResults.length} LinkedIn profiles`);

  if (cseResults.length === 0) {
    return { newPeopleCount: 0, emailsGenerated: 0, apolloCallsMade: 0, savedPersonIds: [], urlsScraped: 0, urlsFromCse: 0 };
  }

  // STEP 2: Check existing
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existingPeopleMap = await findPeopleByLinkedInUrls(linkedinUrls);
  console.log(`[${batchLabel}] Found ${existingPeopleMap.size} existing in DB`);

  let urlsToScrape = linkedinUrls.filter(url => !existingPeopleMap.has(url));
  console.log(`[${batchLabel}] Need to scrape ${urlsToScrape.length} new profiles`);

  const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

  // STEP 3: Scrape (if any new)
  if (urlsToScrape.length > 0) {
    const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
      console.log(`[${batchLabel}] Processing scrape batch ${batchIndex + 1}/${totalBatches} (${profiles.length} profiles)`);

      for (const profile of profiles) {
        const cseResult = cseResultMap.get(profile.linkedinUrl);
        if (!cseResult) continue;

        const { personId, isNew } = await saveScrapedProfile(
          profile,
          cseResult.linkedinUrl,
          cseResult.sourceTitle,
          cseResult.sourceSnippet,
          cseResult.sourceDomain,
          input.company,
          input.university
        );

        savedPersonIds.push(personId);
        if (isNew) newPeopleCount++;
      }
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });
  }

  // STEP 4: Generate emails
  console.log(`[${batchLabel}] Generating emails for ${savedPersonIds.length} people`);

  const peopleWithoutEmails = await prisma.person.findMany({
    where: {
      id: { in: savedPersonIds },
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, company: true, linkedinUrl: true },
  });

  // Group by company
  const byCompany = new Map<string, typeof peopleWithoutEmails>();
  for (const person of peopleWithoutEmails) {
    const normalized = normalizeCompanyName(person.company);
    if (!byCompany.has(normalized)) {
      byCompany.set(normalized, []);
    }
    byCompany.get(normalized)!.push(person);
  }

  for (const [, people] of Array.from(byCompany)) {
    const company = people[0].company;
    let pattern = await getOrLearnPattern(company);

    if (!pattern) {
      console.log(`[${batchLabel}] No pattern for "${company}" - bootstrapping with Apollo`);
      const bootstrapResult = await bootstrapCompanyPattern(company, people);
      apolloCallsMade += bootstrapResult.apolloCallsMade;
      emailsGenerated += bootstrapResult.emailsFound;

      if (bootstrapResult.success && bootstrapResult.pattern && bootstrapResult.domain) {
        pattern = {
          pattern: bootstrapResult.pattern,
          domain: bootstrapResult.domain,
          confidence: bootstrapResult.confidence,
        };
      } else {
        continue;
      }
    }

    // Generate emails for remaining people
    const remainingPeople = await prisma.person.findMany({
      where: {
        id: { in: people.map(p => p.id) },
        email: null,
        firstName: { not: null },
        lastName: { not: null },
      },
      select: { id: true, firstName: true, lastName: true },
    });

    const emailsToVerify: Array<{ personId: string; email: string }> = [];
    for (const person of remainingPeople) {
      const generatedEmail = generateEmailFromPattern(
        person.firstName!,
        person.lastName!,
        pattern.pattern as any,
        pattern.domain
      );
      emailsToVerify.push({ personId: person.id, email: generatedEmail });
    }

    if (emailsToVerify.length > 0) {
      const verificationResults = await verifyEmailsBatch(emailsToVerify.map(e => e.email));

      for (let i = 0; i < emailsToVerify.length; i++) {
        const { personId, email } = emailsToVerify[i];
        const verification = verificationResults[i];

        if (verification.deliverable) {
          await prisma.person.update({
            where: { id: personId },
            data: {
              email,
              emailStatus: 'UNVERIFIED',
              emailConfidence: Math.round(pattern.confidence * 100),
              emailDeliverable: true,
              emailVerifiedAt: new Date(),
              emailVerificationReason: verification.reason,
            },
          });
          emailsGenerated++;
        }
      }
    }
  }

  return {
    newPeopleCount,
    emailsGenerated,
    apolloCallsMade,
    savedPersonIds,
    urlsScraped: urlsToScrape.length,
    urlsFromCse: cseResults.length,
  };
}

async function testPaginatedRefresh() {
  console.log('=== Testing Paginated Refresh Flow ===\n');

  const input = { company: 'Boston Consulting Group' };
  const excludedKeys = new Set<string>();

  // Simulate what the frontend would do: initial search triggers page 1
  console.log('--- Initial Search (Page 1) ---');
  const page1Result = await simulateProcessRefreshBatch(input, excludedKeys, 1, 'Page1');
  const hasMoreAfterPage1 = page1Result.urlsFromCse === 10;

  console.log('\nPage 1 Results:');
  console.log(`  New people: ${page1Result.newPeopleCount}`);
  console.log(`  Emails generated: ${page1Result.emailsGenerated}`);
  console.log(`  URLs from CSE: ${page1Result.urlsFromCse}`);
  console.log(`  hasMore: ${hasMoreAfterPage1}`);

  // Check matching people after page 1
  const matching1 = await findPeopleByFilters({
    company: input.company,
    requireEmail: true,
    excludePersonKeys: excludedKeys,
    limit: 100,
  });
  console.log(`  Matching people with email: ${matching1.length}`);

  if (!hasMoreAfterPage1) {
    console.log('\n--- No more pages available ---');
    return;
  }

  // Simulate user clicking "Load More" - triggers page 2
  console.log('\n--- User Clicks "Load More" (Page 2) ---');
  const page2Result = await simulateProcessRefreshBatch(input, excludedKeys, 11, 'Page2');
  const hasMoreAfterPage2 = page2Result.urlsFromCse === 10;

  console.log('\nPage 2 Results:');
  console.log(`  New people: ${page2Result.newPeopleCount}`);
  console.log(`  Emails generated: ${page2Result.emailsGenerated}`);
  console.log(`  URLs from CSE: ${page2Result.urlsFromCse}`);
  console.log(`  hasMore: ${hasMoreAfterPage2}`);

  // Check matching people after page 2
  const matching2 = await findPeopleByFilters({
    company: input.company,
    requireEmail: true,
    excludePersonKeys: excludedKeys,
    limit: 100,
  });
  console.log(`  Matching people with email: ${matching2.length}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total new people: ${page1Result.newPeopleCount + page2Result.newPeopleCount}`);
  console.log(`Total emails generated: ${page1Result.emailsGenerated + page2Result.emailsGenerated}`);
  console.log(`Total people matching search: ${matching2.length}`);
}

async function testHasMoreLogic() {
  console.log('\n=== Testing hasMore Logic ===\n');

  // Test different scenarios
  const scenarios = [
    { company: 'Google', expectMore: true },
    { company: 'KPMG', expectMore: true },
  ];

  for (const scenario of scenarios) {
    console.log(`Testing "${scenario.company}":`);
    const cseResults = await discoverLinkedInProfiles({
      company: scenario.company,
      limit: 10,
      pageStart: 1,
    });
    const hasMore = cseResults.length === 10;
    console.log(`  CSE returned: ${cseResults.length}`);
    console.log(`  hasMore: ${hasMore}`);
    console.log('');
  }
}

async function main() {
  try {
    await testHasMoreLogic();
    await testPaginatedRefresh();

    console.log('\n=== All E2E Tests Complete ===');
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
