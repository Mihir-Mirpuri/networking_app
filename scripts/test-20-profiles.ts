import 'dotenv/config';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';

const urls = [
  'https://www.linkedin.com/in/williamhgates',
  'https://www.linkedin.com/in/satyanadella',
  'https://www.linkedin.com/in/sundarpichai',
  'https://www.linkedin.com/in/reidhoffman',
  'https://www.linkedin.com/in/jenhsunhuang',
  'https://www.linkedin.com/in/rbranson',
  'https://www.linkedin.com/in/jeffweiner08',
  'https://www.linkedin.com/in/narendramodi',
  'https://www.linkedin.com/in/justintrudeau',
  'https://www.linkedin.com/in/khanacademy',
  'https://www.linkedin.com/in/stephencurry30',
  'https://www.linkedin.com/in/mr-beast',
  'https://www.linkedin.com/in/snoopdogg',
  'https://www.linkedin.com/in/vancityreynolds',
  'https://www.linkedin.com/in/ariabordi',
  'https://www.linkedin.com/in/sethberkley',
  'https://www.linkedin.com/in/adamgrant',
  'https://www.linkedin.com/in/garabordi',
  'https://www.linkedin.com/in/dabordi',
  'https://www.linkedin.com/in/mustafa-suleyman',
];

async function main() {
  console.log(`Testing with ${urls.length} profiles (5 batches of 4)...`);
  console.log('');

  console.time('Total time');
  const profiles = await scrapeLinkedInProfiles(urls);
  console.timeEnd('Total time');

  console.log('');
  console.log(`Got ${profiles.length} profiles`);

  let withEmail = 0;
  for (const p of profiles) {
    if (p.email) withEmail++;
  }
  console.log(`With email: ${withEmail}/${profiles.length}`);
}

main().catch(console.error);
