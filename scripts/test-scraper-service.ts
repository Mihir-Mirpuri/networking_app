import 'dotenv/config';
import { scrapeLinkedInProfiles } from '../src/lib/services/linkedin-scraper';

async function main() {
  const urls = [
    'https://www.linkedin.com/in/williamhgates',
    'https://www.linkedin.com/in/satyanadella',
  ];

  console.log(`Testing scraper service with ${urls.length} profiles...`);
  console.log('');

  console.time('Total time');
  const profiles = await scrapeLinkedInProfiles(urls);
  console.timeEnd('Total time');

  console.log('');
  console.log(`Got ${profiles.length} profiles:`);
  console.log('');

  for (const p of profiles) {
    console.log(`${p.fullName}`);
    console.log(`  Email: ${p.email || '(none)'}`);
    console.log(`  Company: ${p.company}`);
    console.log(`  Role: ${p.role}`);
    console.log(`  Location: ${[p.city, p.state, p.country].filter(Boolean).join(', ')}`);
    console.log(`  School: ${p.educationSchool}`);
    console.log('');
  }
}

main().catch(console.error);
