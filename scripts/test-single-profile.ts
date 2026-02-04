import { ApifyClient } from 'apify-client';
import * as fs from 'fs';

const APIFY_API_KEY = process.env.APIFY_API_KEY;

async function main() {
  if (!APIFY_API_KEY) {
    console.error('APIFY_API_KEY not set');
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_API_KEY });

  const input = {
    profileScraperMode: 'Profile details no email ($4 per 1k)',
    queries: ['https://www.linkedin.com/in/williamhgates']
  };

  console.log('Scraping Bill Gates profile...');
  const startTime = Date.now();

  const run = await client.actor('LpVuK3Zozwuipa5bp').call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Done in ${duration}s`);

  // Save full response
  const profile = items[0];
  fs.writeFileSync('scripts/profile-response-sample.json', JSON.stringify(profile, null, 2));
  console.log('\nSaved to scripts/profile-response-sample.json');

  console.log('\n=== TOP-LEVEL KEYS ===');
  console.log(Object.keys(profile as object));

  console.log('\n=== KEY FIELDS ===');
  const p = profile as any;
  console.log('fullName:', p.fullName);
  console.log('firstName:', p.firstName);
  console.log('lastName:', p.lastName);
  console.log('email:', p.email);
  console.log('company:', p.companyName);
  console.log('jobTitle:', p.jobTitle);
  console.log('location:', p.addressWithCountry);
  console.log('educations:', p.educations?.length, 'entries');
  console.log('experiences:', p.experiences?.length, 'entries');
}

main().catch(console.error);
