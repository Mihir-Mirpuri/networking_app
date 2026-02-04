import { ApifyClient } from 'apify-client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;

async function main() {
  if (!APIFY_API_KEY) {
    console.error('APIFY_API_KEY not set');
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_API_KEY });

  // Test with a few diverse profiles
  const input = {
    profileScraperMode: 'Profile details no email ($4 per 1k)',
    queries: [
      'https://www.linkedin.com/in/adamnover',  // L.E.K. consultant
      'https://www.linkedin.com/in/satyanadella' // Microsoft CEO
    ]
  };

  console.log('Scraping profiles to analyze fields...\n');
  const run = await client.actor('LpVuK3Zozwuipa5bp').call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  for (const profile of items as any[]) {
    console.log('='.repeat(60));
    console.log('NAME:', profile.firstName, profile.lastName);
    console.log('');

    // Location analysis
    console.log('--- LOCATION DATA ---');
    console.log('Profile location:', JSON.stringify(profile.location?.parsed, null, 2));

    // Check experience for location
    console.log('\nExperience locations:');
    if (profile.experience?.length) {
      for (const exp of profile.experience.slice(0, 3)) {
        console.log(`  ${exp.companyName}: location="${exp.location}"`);
      }
    }

    // Check currentPosition
    console.log('\nCurrent Position:');
    if (profile.currentPosition?.length) {
      console.log(JSON.stringify(profile.currentPosition[0], null, 2));
    }

    // Education analysis
    console.log('\n--- EDUCATION DATA ---');
    if (profile.education?.length) {
      for (const edu of profile.education) {
        console.log(`  School: ${edu.schoolName}`);
        console.log(`    Degree: ${edu.degree}`);
        console.log(`    Field: ${edu.fieldOfStudy}`);
        console.log('');
      }
    }

    console.log('');
  }
}

main().catch(console.error);
