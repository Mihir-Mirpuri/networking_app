/**
 * Test script for the full search flow with batch processing
 */
import { PrismaClient } from '@prisma/client';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles, ScrapedProfile } from '../src/lib/services/linkedin-scraper';
import { saveScrapedProfile } from '../src/lib/db/person-service';
import { getOrLearnPattern, generateEmailFromPattern } from '../src/lib/services/email-pattern';
import { rankCandidates, SearchCriteria } from '../src/lib/services/ranking';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Testing Full Search Flow ===\n');

  const input = {
    company: 'ZS Associates',
    university: 'University of Texas at Austin',
    limit: 10,
  };

  const startTime = Date.now();

  // Step 1: CSE Discovery
  console.log('Step 1: CSE Discovery');
  const cseResults = await discoverLinkedInProfiles({
    company: input.company,
    university: input.university,
    limit: 20,
  });
  console.log(`  Found ${cseResults.length} LinkedIn profiles`);
  console.log('  URLs:');
  cseResults.slice(0, 5).forEach((r, i) => console.log(`    ${i+1}. ${r.linkedinUrl}`));
  if (cseResults.length > 5) console.log(`    ... and ${cseResults.length - 5} more`);
  console.log('');

  // Step 2: Check existing in DB
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existing = await prisma.person.findMany({
    where: { linkedinUrl: { in: linkedinUrls } },
    select: { linkedinUrl: true }
  });
  const existingUrls = new Set(existing.map(e => e.linkedinUrl));
  const urlsToScrape = linkedinUrls.filter(url => !existingUrls.has(url));
  console.log('Step 2: DB Check');
  console.log(`  Existing: ${existing.length}`);
  console.log(`  Need to scrape: ${urlsToScrape.length}`);
  console.log('');

  // Step 3: Scrape with batch callback
  console.log('Step 3: Scraping with batch callbacks');
  const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));
  let newPeopleCount = 0;
  let emailsGenerated = 0;
  const allRankedPeople: Array<{ candidate: any; score: number }> = [];

  const searchCriteria: SearchCriteria = {
    company: input.company,
    university: input.university,
  };

  if (urlsToScrape.length > 0) {
    const processBatch = async (profiles: ScrapedProfile[], batchIndex: number, totalBatches: number) => {
      const batchStart = Date.now();
      console.log(`  [Batch ${batchIndex + 1}/${totalBatches}] Processing ${profiles.length} profiles...`);

      // Save to DB
      const savedPersonIds: string[] = [];
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

      // Generate emails
      const peopleWithoutEmails = await prisma.person.findMany({
        where: {
          id: { in: savedPersonIds },
          email: null,
          firstName: { not: null },
          lastName: { not: null },
        },
        select: { id: true, firstName: true, lastName: true, company: true },
      });

      let batchEmails = 0;
      for (const person of peopleWithoutEmails) {
        const pattern = await getOrLearnPattern(person.company);
        if (pattern && pattern.confidence >= 0.8) {
          const email = generateEmailFromPattern(
            person.firstName!,
            person.lastName!,
            pattern.pattern as any,
            pattern.domain
          );
          await prisma.person.update({
            where: { id: person.id },
            data: { email, emailStatus: 'UNVERIFIED', emailConfidence: Math.round(pattern.confidence * 100) },
          });
          emailsGenerated++;
          batchEmails++;
        }
      }

      // Fetch and rank
      const batchPeople = await prisma.person.findMany({
        where: { id: { in: savedPersonIds } },
        select: {
          id: true, fullName: true, firstName: true, lastName: true,
          company: true, role: true, linkedinUrl: true,
          email: true, emailStatus: true, emailConfidence: true,
          city: true, state: true, country: true,
          educationSchool: true, educationDegree: true, educationField: true, educationYear: true,
          sourceLinks: { where: { kind: 'DISCOVERY' }, take: 1, select: { url: true, title: true, snippet: true, domain: true } },
        },
      });

      const normalizeCompanyFn = (name: string) => name.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const searchCompanyNorm = normalizeCompanyFn(input.company);

      const filtered = batchPeople.filter(p => {
        const pNorm = normalizeCompanyFn(p.company);
        return pNorm.includes(searchCompanyNorm) || searchCompanyNorm.includes(pNorm);
      });

      const ranked = rankCandidates(
        searchCriteria,
        filtered,
        (p) => ({
          company: p.company,
          role: p.role,
          city: p.city,
          state: p.state,
          country: p.country,
          educationSchool: p.educationSchool,
          email: p.email,
          emailStatus: (p.emailStatus || 'MISSING') as 'VERIFIED' | 'UNVERIFIED' | 'MISSING',
        }),
        filtered.length
      );

      allRankedPeople.push(...ranked);

      const batchTime = ((Date.now() - batchStart) / 1000).toFixed(2);
      console.log(`  [Batch ${batchIndex + 1}] Done in ${batchTime}s: saved=${savedPersonIds.length}, emails=${batchEmails}, matched=${filtered.length}, ranked=${ranked.length}`);
    };

    await scrapeLinkedInProfiles(urlsToScrape, {
      includeEmail: false,
      onBatchComplete: processBatch,
    });
  }

  console.log('');
  console.log('Step 4: Results');
  console.log(`  New people saved: ${newPeopleCount}`);
  console.log(`  Emails generated: ${emailsGenerated}`);
  console.log(`  Total ranked (matching company): ${allRankedPeople.length}`);

  // Sort and show top results
  allRankedPeople.sort((a, b) => b.score - a.score);
  const topResults = allRankedPeople.slice(0, input.limit);

  console.log('');
  console.log(`Top ${topResults.length} Results:`);
  console.log('─'.repeat(80));
  topResults.forEach((r, i) => {
    const p = r.candidate;
    console.log(`${i+1}. ${p.fullName} @ ${p.company}`);
    console.log(`   Role: ${p.role || 'N/A'}`);
    console.log(`   School: ${p.educationSchool || 'N/A'}`);
    console.log(`   Email: ${p.email || 'N/A'} (${p.emailStatus || 'MISSING'})`);
    console.log(`   Score: ${r.score.toFixed(2)}`);
    console.log('');
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`=== Total Time: ${totalTime}s ===`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
