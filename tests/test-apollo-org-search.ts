/**
 * Test: Apollo Organization People Search
 *
 * Purpose: Determine if Apollo's /v1/mixed_people/search returns linkedin_url
 * in unenriched results when filtering by company.
 *
 * Credit tracking:
 * - We check Apollo credit balance BEFORE and AFTER each call
 * - /v1/mixed_people/search returns a mix of enriched + unenriched contacts
 * - Unenriched contacts should NOT cost credits (they're "teaser" data)
 * - Enriched contacts cost 1 credit each
 *
 * IMPORTANT: This is a READ-ONLY test. It does NOT modify the database.
 */

import 'dotenv/config';

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const BASE_URL = 'https://api.apollo.io';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getApolloCredits(): Promise<{ credits_used: number; credits_limit: number; credits_remaining: number } | null> {
  // Try multiple endpoints to find credit usage info
  for (const endpoint of ['/v1/usage', '/v1/auth/health', '/v1/email_accounts']) {
    try {
      const method = endpoint === '/v1/usage' ? 'GET' : 'POST';
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY! },
        ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`  [credits via ${endpoint}] Raw response keys: ${Object.keys(data).join(', ')}`);
        if (data.usage || data.credits_used !== undefined || data.current_usage !== undefined) {
          return {
            credits_used: data.credits_used ?? data.current_usage ?? data.usage?.credits_used ?? -1,
            credits_limit: data.credits_limit ?? data.plan_credit_limit ?? data.usage?.credits_limit ?? -1,
            credits_remaining: data.credits_remaining ?? data.usage?.credits_remaining ?? -1,
          };
        }
      } else {
        console.log(`  [credits via ${endpoint}] HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(`  [credits via ${endpoint}] Failed: ${e}`);
    }
  }
  return null;
}

interface SearchResult {
  people: ApolloPersonResult[];
  pagination: { total_entries: number; per_page: number; page: number };
  num_fetch_result: number;
}

interface ApolloPersonResult {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  linkedin_url: string | null;
  photo_url: string | null;
  email: string | null;
  email_status: string | null;
  organization?: {
    id: string;
    name: string;
  };
  // Track what fields are present
  [key: string]: unknown;
}

async function searchPeopleAtCompany(
  organizationName: string,
  opts: { perPage?: number; page?: number; titles?: string[] } = {}
): Promise<SearchResult | null> {
  const { perPage = 10, page = 1, titles } = opts;

  const body: Record<string, unknown> = {
    per_page: perPage,
    page,
    organization_name: organizationName,
  };

  if (titles && titles.length > 0) {
    body.person_titles = titles;
  }

  const res = await fetch(`${BASE_URL}/v1/mixed_people/api_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY! },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log(`  [search] HTTP ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }

  return res.json();
}

// ── Main Test ────────────────────────────────────────────────────────────────

async function main() {
  if (!APOLLO_API_KEY) {
    console.error('ERROR: APOLLO_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('=== Apollo Organization People Search Test ===\n');

  // Step 1: Check credits before
  console.log('1. Checking credits BEFORE test...');
  const creditsBefore = await getApolloCredits();
  if (creditsBefore) {
    console.log(`   Credits used: ${creditsBefore.credits_used}`);
    console.log(`   Credits limit: ${creditsBefore.credits_limit}`);
    console.log(`   Credits remaining: ${creditsBefore.credits_remaining}`);
  } else {
    console.log('   Could not fetch credit balance (will still proceed)');
  }

  // Step 2: Search for people at a well-known company (small request)
  const testCompany = 'Stripe';
  console.log(`\n2. Searching for people at "${testCompany}" (per_page=10)...`);
  const result = await searchPeopleAtCompany(testCompany, { perPage: 10 });

  if (!result) {
    console.error('   Search failed. Exiting.');
    process.exit(1);
  }

  // Debug: show top-level keys
  console.log(`   Response keys: ${Object.keys(result).join(', ')}`);
  if (result.pagination) {
    console.log(`   Pagination keys: ${Object.keys(result.pagination).join(', ')}`);
  }

  console.log(`   Total entries: ${result.pagination?.total_entries ?? 'N/A'}`);
  console.log(`   Returned: ${result.people?.length ?? 0} people`);

  // Step 3: Analyze each person's data
  console.log('\n3. Analyzing returned people...\n');

  let withLinkedIn = 0;
  let withEmail = 0;
  let withTitle = 0;
  let totalPeople = result.people?.length ?? 0;

  const fieldPresence: Record<string, number> = {};

  for (const person of result.people ?? []) {
    // Track which fields are present
    for (const key of Object.keys(person)) {
      fieldPresence[key] = (fieldPresence[key] ?? 0) + 1;
    }

    if (person.linkedin_url) withLinkedIn++;
    if (person.email) withEmail++;
    if (person.title) withTitle++;

    // Print summary for each person
    console.log(`   ${person.name || `${person.first_name} ${person.last_name}`}`);
    console.log(`     Title:    ${person.title ?? '(none)'}`);
    console.log(`     LinkedIn: ${person.linkedin_url ?? '(none)'}`);
    console.log(`     Email:    ${person.email ?? '(none)'}`);
    console.log(`     Status:   ${person.email_status ?? '(none)'}`);
    console.log('');
  }

  // Step 4: Summary stats
  console.log('4. Summary:');
  console.log(`   People returned:    ${totalPeople}`);
  console.log(`   With LinkedIn URL:  ${withLinkedIn}/${totalPeople} (${totalPeople > 0 ? Math.round(withLinkedIn / totalPeople * 100) : 0}%)`);
  console.log(`   With email:         ${withEmail}/${totalPeople} (${totalPeople > 0 ? Math.round(withEmail / totalPeople * 100) : 0}%)`);
  console.log(`   With title:         ${withTitle}/${totalPeople} (${totalPeople > 0 ? Math.round(withTitle / totalPeople * 100) : 0}%)`);

  // Step 5: Field presence analysis
  console.log('\n5. Field presence (which fields came back):');
  const sortedFields = Object.entries(fieldPresence).sort((a, b) => b[1] - a[1]);
  for (const [field, count] of sortedFields) {
    console.log(`   ${field}: ${count}/${totalPeople}`);
  }

  // Step 6: Check credits after
  console.log('\n6. Checking credits AFTER test...');
  const creditsAfter = await getApolloCredits();
  if (creditsAfter) {
    console.log(`   Credits used: ${creditsAfter.credits_used}`);
    console.log(`   Credits limit: ${creditsAfter.credits_limit}`);
    console.log(`   Credits remaining: ${creditsAfter.credits_remaining}`);
  }

  if (creditsBefore && creditsAfter) {
    const creditsConsumed = (creditsAfter.credits_used) - (creditsBefore.credits_used);
    console.log(`\n   >>> CREDITS CONSUMED BY THIS TEST: ${creditsConsumed} <<<`);
  }

  // Step 7: Print raw first person for full field inspection
  if (result.people?.[0]) {
    console.log('\n7. Raw first person object (for field inspection):');
    console.log(JSON.stringify(result.people[0], null, 2));
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
