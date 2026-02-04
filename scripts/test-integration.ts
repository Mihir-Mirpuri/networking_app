/**
 * Integration test for the new LinkedIn scraper
 * Tests the full flow: CSE discovery → LinkedIn scraping → DB save
 */
import { PrismaClient } from '@prisma/client';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';
import { saveScrapedProfile } from '../src/lib/db/person-service';

const prisma = new PrismaClient();

async function main() {
  console.log('=== LinkedIn Scraper Integration Test ===\n');

  // Test with 3 known URLs
  const testUrls = [
    'https://www.linkedin.com/in/adamnover',
    'https://www.linkedin.com/in/satyanadella',
    'https://www.linkedin.com/in/williamhgates',
  ];

  console.log('Test URLs:');
  testUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
  console.log('');

  // Step 1: Scrape profiles
  console.log('Step 1: Scraping profiles...');
  const startTime = Date.now();
  const profiles = await scrapeLinkedInProfiles(testUrls);
  const scrapeTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`  Scraped ${profiles.length} profiles in ${scrapeTime}s\n`);

  // Step 2: Save to database
  console.log('Step 2: Saving to database...');
  for (const profile of profiles) {
    const { personId, isNew } = await saveScrapedProfile(
      profile,
      profile.linkedinUrl,
      `${profile.fullName} - LinkedIn`,
      null,
      'linkedin.com',
      profile.company || 'Unknown',
      profile.educationSchool
    );
    console.log(`  ${isNew ? 'Created' : 'Updated'}: ${profile.fullName} (${personId})`);
  }
  console.log('');

  // Step 3: Verify data in database
  console.log('Step 3: Verifying database records...\n');

  for (const profile of profiles) {
    const person = await prisma.person.findFirst({
      where: { linkedinUrl: profile.linkedinUrl },
      select: {
        fullName: true,
        company: true,
        role: true,
        city: true,
        state: true,
        country: true,
        schools: true,
        educationSchool: true,
        scrapedAt: true,
      },
    });

    if (person) {
      console.log(`${person.fullName}`);
      console.log(`  Company: ${person.company}`);
      console.log(`  Role: ${person.role}`);
      console.log(`  Location: ${[person.city, person.state, person.country].filter(Boolean).join(', ') || 'N/A'}`);
      console.log(`  Schools (array): ${JSON.stringify(person.schools)}`);
      console.log(`  Primary School: ${person.educationSchool || 'N/A'}`);
      console.log(`  Scraped At: ${person.scrapedAt}`);
      console.log('');
    }
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`Profiles scraped: ${profiles.length}`);
  console.log(`Time: ${scrapeTime}s`);
  console.log(`Schools extracted: ${profiles.filter(p => p.schools.length > 0).length}/${profiles.length}`);
  console.log(`Location extracted: ${profiles.filter(p => p.city || p.state).length}/${profiles.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
