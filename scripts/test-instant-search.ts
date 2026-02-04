/**
 * Test script for the instant search + refresh flow
 */
import { PrismaClient } from '@prisma/client';
import { findPeopleByFilters, PersonFilters } from '../src/lib/db/person-service';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '../src/lib/services/linkedin-scraper';
import { saveScrapedProfile } from '../src/lib/db/person-service';
import { getOrLearnPattern, generateEmailFromPattern } from '../src/lib/services/email-pattern';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Testing Instant Search + Refresh Flow ===\n');

  const input = {
    company: 'ZS Associates',
    university: 'University of Texas at Austin',
    limit: 10,
  };

  // ===== PHASE 1: INSTANT DB SEARCH =====
  console.log('PHASE 1: Instant DB Search');
  const phase1Start = Date.now();

  const filters: PersonFilters = {
    company: input.company,
    location: undefined,
    university: input.university,
    requireEmail: false,
    excludePersonKeys: new Set(),
    limit: input.limit * 3,
  };

  const existingPeople = await findPeopleByFilters(filters);
  const phase1Time = Date.now() - phase1Start;

  console.log(`  Found ${existingPeople.length} existing matches in ${phase1Time}ms`);
  if (existingPeople.length > 0) {
    existingPeople.slice(0, 3).forEach(p => console.log(`    - ${p.fullName} @ ${p.company}`));
  }
  console.log(`  needsRefresh: true (no cache)\n`);

  // User sees results instantly here (even if 0)
  // Frontend shows "Searching for more..."

  // ===== PHASE 2: BACKGROUND REFRESH =====
  console.log('PHASE 2: Background Refresh (CSE + Scraping)');
  const phase2Start = Date.now();

  // CSE Discovery
  console.log('  Step 1: CSE Discovery...');
  const cseResults = await discoverLinkedInProfiles({
    company: input.company,
    university: input.university,
    limit: 20,
  });
  console.log(`  Found ${cseResults.length} LinkedIn profiles`);

  // Check existing
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existing = await prisma.person.findMany({
    where: { linkedinUrl: { in: linkedinUrls } },
    select: { linkedinUrl: true }
  });
  const existingUrls = new Set(existing.map(e => e.linkedinUrl));
  const urlsToScrape = linkedinUrls.filter(url => !existingUrls.has(url));

  console.log(`  Need to scrape: ${urlsToScrape.length} new profiles`);

  // Scrape
  if (urlsToScrape.length > 0) {
    console.log('  Step 2: Scraping...');
    const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));
    let newCount = 0;
    let emailCount = 0;

    const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
      const savedIds: string[] = [];

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
        savedIds.push(personId);
        if (isNew) newCount++;
      }

      // Generate emails
      const noEmail = await prisma.person.findMany({
        where: { id: { in: savedIds }, email: null, firstName: { not: null }, lastName: { not: null } },
        select: { id: true, firstName: true, lastName: true, company: true },
      });

      for (const p of noEmail) {
        const pattern = await getOrLearnPattern(p.company);
        if (pattern && pattern.confidence >= 0.8) {
          const email = generateEmailFromPattern(p.firstName!, p.lastName!, pattern.pattern as any, pattern.domain);
          await prisma.person.update({
            where: { id: p.id },
            data: { email, emailStatus: 'UNVERIFIED', emailConfidence: Math.round(pattern.confidence * 100) },
          });
          emailCount++;
        }
      }

      console.log(`    Batch ${batchIndex + 1}/${totalBatches}: +${profiles.length} profiles`);
    };

    await scrapeLinkedInProfiles(urlsToScrape, { includeEmail: false, onBatchComplete: processBatch });
    console.log(`  Scraping complete: ${newCount} new, ${emailCount} emails`);
  }

  const phase2Time = Date.now() - phase2Start;

  // Query again to see new results
  const newPeople = await findPeopleByFilters(filters);

  console.log(`\n  Phase 2 complete in ${(phase2Time / 1000).toFixed(2)}s`);
  console.log(`  Total matching people now: ${newPeople.length}`);

  // ===== SUMMARY =====
  console.log('\n=== Summary ===');
  console.log(`Phase 1 (instant): ${phase1Time}ms - ${existingPeople.length} results`);
  console.log(`Phase 2 (refresh): ${(phase2Time / 1000).toFixed(2)}s - ${newPeople.length} results`);
  console.log('\nTop matches:');
  newPeople.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} @ ${p.company} (${p.educationSchool || 'N/A'})`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
