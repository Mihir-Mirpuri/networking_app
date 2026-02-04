import { ApifyClient } from 'apify-client';

const APIFY_API_KEY = process.env.APIFY_API_KEY;

const urls = [
  'https://www.linkedin.com/in/adamnover',
  'https://www.linkedin.com/in/sheilashah',
  'https://www.linkedin.com/in/huaming-yu-08b3821a',
  'https://www.linkedin.com/in/laurendevestern',
  'https://www.linkedin.com/in/gottlies5',
  'https://www.linkedin.com/in/robertnimsphd',
  'https://www.linkedin.com/in/matt-taylor-28756b13',
  'https://www.linkedin.com/in/hee-ryoung-silva-choi',
  'https://www.linkedin.com/in/yuanrong-li',
  'https://www.linkedin.com/in/zayn-cochinwala',
  'https://www.linkedin.com/in/bonnie-sue-reneau-33bba1203',
  'https://www.linkedin.com/in/leon-nguyen-57626614b',
  'https://www.linkedin.com/in/darianaghili',
  'https://www.linkedin.com/in/rkiani',
  'https://www.linkedin.com/in/ckini',
  'https://www.linkedin.com/in/jennylieb'
];

async function main() {
  if (!APIFY_API_KEY) {
    console.error('APIFY_API_KEY not set');
    process.exit(1);
  }

  const client = new ApifyClient({ token: APIFY_API_KEY });

  const input = {
    profileScraperMode: 'Profile details + email search ($10 per 1k)',
    queries: urls
  };

  console.log('Starting scrape of', urls.length, 'profiles...');
  console.log('Actor: LpVuK3Zozwuipa5bp');
  console.log('');

  const startTime = Date.now();

  const run = await client.actor('LpVuK3Zozwuipa5bp').call(input);

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  console.log('=== TIMING ===');
  console.log('Total time:', duration.toFixed(2), 'seconds');
  console.log('Time per profile:', (duration / urls.length).toFixed(2), 'seconds');

  // Fetch results
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log('\n=== EMAIL RESULTS ===');
  let withEmail = 0;
  let withoutEmail = 0;

  for (const item of items as any[]) {
    const email = item.email;
    const hasEmail = email && typeof email === 'string' && email.trim() !== '';
    const name = item.fullName || `${item.firstName || ''} ${item.lastName || ''}`.trim();

    if (hasEmail) {
      withEmail++;
      console.log('✓', name, '->', email);
    } else {
      withoutEmail++;
      console.log('✗', name, '-> NO EMAIL');
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Profiles scraped:', items.length);
  console.log('With email:', withEmail);
  console.log('Without email:', withoutEmail);
  console.log('Email rate:', ((withEmail / items.length) * 100).toFixed(1) + '%');
  console.log('\nTotal time:', duration.toFixed(2), 'seconds');
  console.log('Avg per profile:', (duration / urls.length).toFixed(2), 'seconds');
}

main().catch(console.error);
