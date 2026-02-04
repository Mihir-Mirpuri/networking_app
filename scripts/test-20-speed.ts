import 'dotenv/config';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';

const urls = [
  'https://www.linkedin.com/in/williamhgates',
  'https://www.linkedin.com/in/satyanadella',
  'https://www.linkedin.com/in/sundarpichai',
  'https://www.linkedin.com/in/reidhoffman',
  'https://www.linkedin.com/in/jenhsunhuang',
  'https://www.linkedin.com/in/jeffweiner08',
  'https://www.linkedin.com/in/adamgrant',
  'https://www.linkedin.com/in/sethberkley',
  'https://www.linkedin.com/in/mustafa-suleyman',
  'https://www.linkedin.com/in/rbranson',
  'https://www.linkedin.com/in/narendramodi',
  'https://www.linkedin.com/in/justintrudeau',
  'https://www.linkedin.com/in/khanacademy',
  'https://www.linkedin.com/in/stephencurry30',
  'https://www.linkedin.com/in/mr-beast',
  'https://www.linkedin.com/in/snoopdogg',
  'https://www.linkedin.com/in/vancityreynolds',
  'https://www.linkedin.com/in/garabordi',
  'https://www.linkedin.com/in/dabordi',
  'https://www.linkedin.com/in/ariabordi',
];

async function main() {
  console.log('Testing 20 profiles with BATCH_SIZE=10, MAX_CONCURRENT=2');
  console.log('');

  const start = Date.now();
  const profiles = await scrapeLinkedInProfiles(urls);
  const elapsed = (Date.now() - start) / 1000;

  console.log('');
  console.log('=== RESULTS ===');
  console.log('Profiles scraped:', profiles.length);
  console.log('Total time:', elapsed.toFixed(1), 'seconds');
  console.log('Per profile:', (elapsed / profiles.length).toFixed(2), 'seconds');
}

main().catch(console.error);
