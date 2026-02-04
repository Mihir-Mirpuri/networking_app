import 'dotenv/config';
import { ApifyClient } from 'apify-client';

const ACTOR_ID = '2SyF0bVxmgGr8IVCZ';

const urls = [
  'https://www.linkedin.com/in/williamhgates',
  'https://www.linkedin.com/in/satyanadella',
  'https://www.linkedin.com/in/sundarpichai',
  'https://www.linkedin.com/in/reidhoffman',
  'https://www.linkedin.com/in/jenhsunhuang',
  'https://www.linkedin.com/in/jeffweiner08',
  'https://www.linkedin.com/in/adamgrant',
  'https://www.linkedin.com/in/ariabordi',
  'https://www.linkedin.com/in/sethberkley',
  'https://www.linkedin.com/in/mustafa-suleyman',
];

async function main() {
  const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

  console.log('Testing batch of ' + urls.length + ' profiles...');
  console.log('');

  const start = Date.now();
  const run = await client.actor(ACTOR_ID).call({ profileUrls: urls });
  const elapsed = (Date.now() - start) / 1000;

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log('Batch of 10: ' + elapsed.toFixed(1) + ' seconds');
  console.log('Profiles returned: ' + items.length);
  console.log('Per profile: ' + (elapsed / items.length).toFixed(1) + ' seconds');
}

main().catch(console.error);
