import 'dotenv/config';
import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'VhxlqQXRwhW8H5hNV';

const usernames = [
  'martin-gonzalez-a0a31612b',
  'sarah-b-hepburn',
  'justinesmith14',
  'shawn-sadler-3bb66438',
  'shannon-sanders-mba-b3518295',
  'alexa-owen-a6a971205',
  'charles10',
  'curtisbaryla',
  'brandon-dial-54b918124',
  'jae-chang-946254160',
  'taylor-rendon-795646184',
  'emily-shyshka-224a90121',
  'nicole-cason-50bb1218a',
  'nick-carter-34b3691a0',
  'grant-morrison-51692b61',
  'cristyncram',
  'james-mcardle-0013b5a1',
];

async function main() {
  const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

  console.log(`Testing email actor on ${usernames.length} Booz Allen profiles...`);
  console.log('(Running sequentially - 1 at a time)\n');

  let withEmail = 0;
  let withoutEmail = 0;
  const results: { name: string; email: string | null }[] = [];

  const startTime = Date.now();

  for (const username of usernames) {
    const profileStart = Date.now();
    console.log(`Checking: ${username}...`);

    try {
      const run = await client.actor(ACTOR_ID).call({
        username,
        includeEmail: true,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const profile = items[0] as any;

      const elapsed = ((Date.now() - profileStart) / 1000).toFixed(1);

      if (profile?.email) {
        withEmail++;
        console.log(`  ✅ ${profile.fullName}: ${profile.email} (${elapsed}s)`);
        results.push({ name: profile.fullName, email: profile.email });
      } else {
        withoutEmail++;
        console.log(`  ❌ ${profile?.fullName || username}: No email (${elapsed}s)`);
        results.push({ name: profile?.fullName || username, email: null });
      }
    } catch (error: any) {
      withoutEmail++;
      console.log(`  ❌ ${username}: Error - ${error.message}`);
      results.push({ name: username, email: null });
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== SUMMARY ===');
  console.log(`With email: ${withEmail}`);
  console.log(`Without email: ${withoutEmail}`);
  console.log(`Success rate: ${((withEmail / usernames.length) * 100).toFixed(1)}%`);
  console.log(`Total time: ${totalTime}s`);
  console.log(`Avg per profile: ${(parseFloat(totalTime) / usernames.length).toFixed(1)}s`);

  console.log('\n=== EMAILS FOUND ===');
  for (const r of results) {
    if (r.email) {
      console.log(`${r.name}: ${r.email}`);
    }
  }
}

main().catch(console.error);
