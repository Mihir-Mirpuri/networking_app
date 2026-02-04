import 'dotenv/config';
import { discoverLinkedInProfiles } from '../src/lib/services/discovery';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';
import { findPeopleByLinkedInUrls, saveScrapedProfile } from '../src/lib/db/person-service';

/**
 * Test the new search flow:
 * 1. CSE Discovery → Find LinkedIn URLs
 * 2. Check DB → Which profiles already exist?
 * 3. Scrape → Only scrape NEW profiles
 * 4. Save → Store scraped data
 *
 * Field mapping from LinkedIn Scraper:
 * ─────────────────────────────────────────────────────
 * JSON field (from Apify)    → Person model field
 * ─────────────────────────────────────────────────────
 * linkedinUrl                → linkedinUrl
 * fullName                   → fullName
 * firstName                  → firstName
 * lastName                   → lastName
 * email                      → email (status = UNVERIFIED)
 * companyName                → company
 * jobTitle                   → role
 * addressWithCountry         → city, state, country (parsed)
 * educations[0].title        → educationSchool
 */
async function main() {
  const company = 'McKinsey';
  const university = 'Harvard';
  const limit = 5;

  console.log('=== TEST: NEW SEARCH FLOW ===');
  console.log(`Company: ${company}`);
  console.log(`University: ${university}`);
  console.log(`Limit: ${limit}`);
  console.log('');

  // Step 1: CSE Discovery
  console.log('Step 1: CSE Discovery...');
  const cseResults = await discoverLinkedInProfiles({
    company,
    university,
    limit,
  });
  console.log(`  Found ${cseResults.length} LinkedIn profiles`);

  if (cseResults.length === 0) {
    console.log('No profiles found. Done.');
    return;
  }

  // Show discovered URLs
  for (const result of cseResults) {
    console.log(`  - ${result.fullName}: ${result.linkedinUrl}`);
  }
  console.log('');

  // Step 2: Check DB for existing people
  console.log('Step 2: Checking database for existing people...');
  const linkedinUrls = cseResults.map(r => r.linkedinUrl);
  const existingPeopleMap = await findPeopleByLinkedInUrls(linkedinUrls);
  console.log(`  Found ${existingPeopleMap.size} existing people in database`);

  // Split into existing and new
  const urlsToScrape: string[] = [];
  const cseResultMap = new Map(cseResults.map(r => [r.linkedinUrl, r]));

  for (const result of cseResults) {
    if (existingPeopleMap.has(result.linkedinUrl)) {
      console.log(`  [SKIP] ${result.fullName} - already in DB`);
    } else {
      console.log(`  [NEW] ${result.fullName} - needs scraping`);
      urlsToScrape.push(result.linkedinUrl);
    }
  }
  console.log('');

  // Step 3: Scrape new profiles
  if (urlsToScrape.length > 0) {
    console.log(`Step 3: Scraping ${urlsToScrape.length} new profiles...`);
    console.time('  Scraping time');
    const scrapedProfiles = await scrapeLinkedInProfiles(urlsToScrape);
    console.timeEnd('  Scraping time');
    console.log(`  Successfully scraped ${scrapedProfiles.length} profiles`);
    console.log('');

    // Show scraped data with field mapping
    console.log('  Scraped data (JSON field → DB field):');
    for (const profile of scrapedProfiles) {
      console.log(`  ─── ${profile.fullName} ───`);
      console.log(`    linkedinUrl     → linkedinUrl:      ${profile.linkedinUrl}`);
      console.log(`    companyName     → company:          ${profile.company || '(none)'}`);
      console.log(`    jobTitle        → role:             ${profile.role || '(none)'}`);
      console.log(`    email           → email:            ${profile.email || '(none)'}`);
      console.log(`    addressWithCountry → location:      ${[profile.city, profile.state, profile.country].filter(Boolean).join(', ') || '(none)'}`);
      console.log(`    educations[0].title → educationSchool: ${profile.educationSchool || '(none)'}`);
    }
    console.log('');

    // Step 4: Save to database
    console.log('Step 4: Saving to database...');
    let newCount = 0;
    for (const profile of scrapedProfiles) {
      const cseResult = cseResultMap.get(profile.linkedinUrl);
      if (!cseResult) continue;

      const { isNew } = await saveScrapedProfile(
        profile,
        cseResult.linkedinUrl,
        cseResult.sourceTitle,
        cseResult.sourceSnippet,
        cseResult.sourceDomain,
        company,
        university
      );

      if (isNew) newCount++;
      console.log(`  [${isNew ? 'NEW' : 'UPDATED'}] ${profile.fullName}`);
    }
    console.log(`  Saved ${newCount} new, ${scrapedProfiles.length - newCount} updated`);
  } else {
    console.log('Step 3: No profiles to scrape (all already in DB)');
  }

  console.log('');
  console.log('=== DONE ===');
}

main().catch(console.error);
