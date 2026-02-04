import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import * as fs from 'fs';

const ACTOR_ID = '2SyF0bVxmgGr8IVCZ';

async function main() {
  const client = new ApifyClient({
    token: process.env.APIFY_API_KEY,
  });

  const input = {
    profileUrls: [
      'https://www.linkedin.com/in/williamhgates',
    ],
  };

  console.log('Calling Apify actor:', ACTOR_ID);
  console.log('Input:', JSON.stringify(input, null, 2));
  console.log('');

  const run = await client.actor(ACTOR_ID).call(input);

  console.log('Run completed. Status:', run.status);
  console.log('Run ID:', run.id);
  console.log('');

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log('Got', items.length, 'profiles');
  console.log('');

  // Save full result to file for analysis
  const outputPath = 'scripts/scraper-result.json';
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2));
  console.log('Full result saved to:', outputPath);

  // Print summary
  if (items[0]) {
    const profile = items[0] as any;
    console.log('');
    console.log('Profile summary:');
    console.log('  Name:', profile.firstName, profile.lastName);
    console.log('  Headline:', profile.headline);
    console.log('  Location:', profile.location);
    console.log('  Company:', profile.company);
    console.log('  Email:', profile.email);
  }
}

main().catch(console.error);
