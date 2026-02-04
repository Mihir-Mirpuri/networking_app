/**
 * Test the full refresh flow with Apollo bootstrap
 *
 * This simulates what happens when a user searches for a company
 * that doesn't have an email pattern yet.
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

async function main() {
  console.log('=== Testing Full Refresh Flow with Apollo Bootstrap ===\n');

  // Use a company that likely doesn't have a pattern yet
  const input = {
    company: 'Oliver Wyman',  // Consulting firm - probably no pattern
    university: 'University of Texas at Austin',
  };

  // Check if pattern exists
  console.log(`Step 1: Checking pattern for "${input.company}"...`);
  const existingPattern = await getOrLearnPattern(input.company);
  if (existingPattern) {
    console.log(`  Pattern already exists: ${existingPattern.pattern}@${existingPattern.domain}`);
    console.log('  This test will still run but Apollo wont be called for bootstrap.\n');
  } else {
    console.log('  No pattern found - Apollo bootstrap will be triggered.\n');
  }

  // Step 2: CSE Discovery
  console.log('Step 2: CSE Discovery...');
  const cseStart = Date.now();
  const cseResults = await discoverLinkedInProfiles({
    company: input.company,
    university: input.university,
    limit: 15,
  });
  console.log(`  Found ${cseResults.length} LinkedIn profiles in ${Date.now() - cseStart}ms`);
  cseResults.slice(0, 5).forEach(r => console.log(`    - ${r.linkedinUrl}`));
  if (cseResults.length > 5) console.log(`    ... and ${cseResults.length - 5} more`);
  console.log('');

  if (cseResults.length === 0) {
    console.log('No profiles found. Exiting.');
    return;
  }

  // Step 3: Check existing in DB
  console.log('Step 3: Checking existing profiles in DB...');
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existing = await prisma.person.findMany({
    where: { linkedinUrl: { in: linkedinUrls } },
    select: { linkedinUrl: true },
  });
  const existingUrls = new Set(existing.map(e => e.linkedinUrl));
  const urlsToScrape = linkedinUrls.filter(url => !existingUrls.has(url));
  console.log(`  Existing: ${existing.length}, Need to scrape: ${urlsToScrape.length}\n`);

  // Step 4: Scrape new profiles
  const savedPersonIds: string[] = [];
  let newPeopleCount = 0;

  if (urlsToScrape.length > 0) {
    console.log('Step 4: Scraping LinkedIn profiles...');
    const scrapeStart = Date.now();
    const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

    const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
      console.log(`  Batch ${batchIndex + 1}/${totalBatches}: ${profiles.length} profiles`);

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

    console.log(`  Scraped ${newPeopleCount} new people in ${((Date.now() - scrapeStart) / 1000).toFixed(2)}s\n`);
  } else {
    // Get existing person IDs
    const existingPeople = await prisma.person.findMany({
      where: { linkedinUrl: { in: linkedinUrls } },
      select: { id: true },
    });
    savedPersonIds.push(...existingPeople.map(p => p.id));
    console.log('Step 4: No scraping needed - all profiles already in DB\n');
  }

  // Step 5: Generate emails (with Apollo bootstrap if needed)
  console.log('Step 5: Generating emails...');
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

  for (const [normalizedCompany, people] of Array.from(byCompany)) {
    const company = people[0].company;
    console.log(`\n  Processing "${company}" (${people.length} people)...`);

    // Check if pattern exists
    let pattern = await getOrLearnPattern(company);

    if (!pattern) {
      console.log(`    No pattern - bootstrapping with Apollo...`);
      const bootstrapResult = await bootstrapCompanyPattern(company, people);

      if (bootstrapResult) {
        pattern = bootstrapResult;
        apolloCallsMade += bootstrapResult.apolloCallsMade;
        emailsGenerated += bootstrapResult.emailsFound;

        console.log(`    Bootstrap: ${pattern.pattern}@${pattern.domain} (${bootstrapResult.apolloCallsMade} calls, ${bootstrapResult.emailsFound} emails)`);
      } else {
        console.log(`    Bootstrap failed - skipping email generation`);
        continue;
      }
    } else {
      console.log(`    Using existing pattern: ${pattern.pattern}@${pattern.domain}`);
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

    console.log(`    Generated ${remaining.length} emails from pattern`);
  }

  const emailTime = ((Date.now() - emailStart) / 1000).toFixed(2);
  console.log(`\n  Email generation complete in ${emailTime}s`);
  console.log(`  Total emails: ${emailsGenerated}, Apollo calls: ${apolloCallsMade}\n`);

  // Step 6: Summary
  console.log('=== Summary ===');
  const finalPeople = await prisma.person.findMany({
    where: { id: { in: savedPersonIds } },
    select: {
      fullName: true,
      company: true,
      email: true,
      emailStatus: true,
      emailConfidence: true,
    },
    orderBy: { fullName: 'asc' },
  });

  const withEmail = finalPeople.filter(p => p.email);
  console.log(`People: ${finalPeople.length}`);
  console.log(`With emails: ${withEmail.length} (${Math.round((withEmail.length / finalPeople.length) * 100)}%)`);
  console.log(`Apollo calls: ${apolloCallsMade}`);
  console.log('');
  console.log('Sample results:');
  finalPeople.slice(0, 10).forEach(p => {
    console.log(`  - ${p.fullName} @ ${p.company}`);
    console.log(`    Email: ${p.email || 'none'} (${p.emailStatus || 'N/A'}, ${p.emailConfidence || 0}%)`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
