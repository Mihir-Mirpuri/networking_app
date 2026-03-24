/**
 * Test script: Verify insights parsing from Apify output
 * Usage: npx tsx tests/apify-raw-output.ts
 */

import 'dotenv/config';
import { ApifyClient } from 'apify-client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = 'LpVuK3Zozwuipa5bp';

async function main() {
  if (!APIFY_API_KEY) {
    console.error('APIFY_API_KEY not set');
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_API_KEY });

  console.log('Scraping Seaver Sasso profile...\n');
  const run = await client.actor(ACTOR_ID).call(
    {
      profileScraperMode: 'Profile details no email ($4 per 1k)',
      queries: ['https://www.linkedin.com/in/seaver-sasso/'],
    },
    { memory: 256, timeout: 60 }
  );

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const raw = items[0] as Record<string, unknown>;

  // Show raw education insights field
  console.log('=== RAW EDUCATION ENTRIES (insights field) ===');
  if (Array.isArray(raw.education)) {
    for (const edu of raw.education) {
      const e = edu as Record<string, unknown>;
      console.log(`School: ${e.schoolName}`);
      console.log(`  insights: ${e.insights ?? '(null)'}`);
      console.log(`  description: ${e.description ?? '(null)'}`);
      console.log();
    }
  }

  // Now test the parsed output via our scraper
  const { scrapeLinkedInProfile } = await import('../src/lib/services/linkedin-scraper');
  console.log('=== PARSED OUTPUT (via scrapeLinkedInProfile) ===');
  const parsed = await scrapeLinkedInProfile('https://www.linkedin.com/in/seaver-sasso/');

  if (parsed) {
    console.log(`Name: ${parsed.fullName}`);
    console.log(`Company: ${parsed.company}`);
    console.log(`Role: ${parsed.role}`);
    console.log(`Schools: ${parsed.schools.join(', ')}`);
    console.log();
    console.log('Education History:');
    for (const edu of parsed.educationHistory) {
      console.log(`  ${edu.schoolName}`);
      console.log(`    degree: ${edu.degree}`);
      console.log(`    fieldOfStudy: ${edu.fieldOfStudy}`);
      console.log(`    activities: ${edu.activities}`);
      console.log(`    grade: ${edu.grade}`);
      console.log(`    description: ${edu.description}`);
      console.log(`    dates: ${edu.startDate} - ${edu.endDate}`);
      console.log();
    }
  }
}

main().catch(console.error);
