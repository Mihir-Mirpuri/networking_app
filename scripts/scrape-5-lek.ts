import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import * as fs from 'fs';

const ACTOR_ID = '2SyF0bVxmgGr8IVCZ';

const urls = [
  'https://www.linkedin.com/in/ckini',
  'https://www.linkedin.com/in/jennylieb',
  'https://www.linkedin.com/in/leon-nguyen-57626614b',
  'https://www.linkedin.com/in/rkiani',
  'https://www.linkedin.com/in/zayn-cochinwala',
];

async function main() {
  const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

  console.log('Scraping 5 L.E.K. profiles...');

  const run = await client.actor(ACTOR_ID).call({ profileUrls: urls });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Save full JSON
  const outputPath = 'scripts/lek-profiles-full.json';
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2));
  console.log('Full JSON saved to:', outputPath);

  // Print summary
  for (const item of items) {
    const p = item as any;
    console.log('---');
    console.log('Name:', p.fullName);
    console.log('Email:', p.email || '(none)');
    console.log('Company:', p.companyName);
  }
}

main().catch(console.error);
