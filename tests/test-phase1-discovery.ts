/**
 * Phase 1 Test: LinkedIn Short Profile Discovery Pipeline
 *
 * Tests all 3 new services:
 * 1. Query Parser (Haiku) — natural language → structured filters
 * 2. Company Resolver — company name → LinkedIn URL (via Serper)
 * 3. LinkedIn Search — Short mode API call
 *
 * Runs 5 queries to validate the full pipeline.
 * Expected cost: ~5 × $0.103 = ~$0.52 total
 */

import 'dotenv/config';
import { parseSearchQuery } from '../src/lib/services/query-parser';
import { searchLinkedInShort } from '../src/lib/services/linkedin-search';
import { resolveCompanyUrl } from '../src/lib/services/company-resolver';

const QUERIES = [
  // 1. Big company + role + location (no company URL resolution needed)
  'software engineers at Google in San Francisco',

  // 2. Small company (should trigger resolve_company_url tool)
  'product managers at Anara in Austin',

  // 3. University filter + seniority
  'senior engineers from UT Austin in New York',

  // 4. Industry + company size + role
  'founders at fintech startups in San Francisco',

  // 5. Complex multi-filter query
  'VPs of engineering at large tech companies in Seattle who went to Stanford',
];

async function testCompanyResolver() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST: Company URL Resolver');
  console.log('='.repeat(80));

  const companies = ['Anara', 'Google', 'Ramp'];
  for (const name of companies) {
    const result = await resolveCompanyUrl(name);
    console.log(`  "${name}" → ${result.url || 'NOT FOUND'} (perplexity calls: ${result.cost.perplexityCalls})`);
  }
}

async function testQueryParser() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST: Query Parser (Haiku)');
  console.log('='.repeat(80));

  for (let i = 0; i < QUERIES.length; i++) {
    console.log(`\n--- Query ${i + 1}: "${QUERIES[i]}" ---`);
    const result = await parseSearchQuery(QUERIES[i]);
    console.log('DB Filters:', JSON.stringify(result.dbFilters, null, 2));
    console.log('LinkedIn Filters:', JSON.stringify(result.linkedInFilters, null, 2));
    console.log(`Cost: ${result.cost.haikuCalls} haiku calls, ${result.cost.serperCalls} serper calls, $${(result.cost.costCents / 100).toFixed(4)}`);
  }
}

async function testLinkedInSearch() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST: LinkedIn Short Mode Search');
  console.log('='.repeat(80));

  // Test with a simple search
  console.log('\n--- Direct search: SWE at Google in SF ---');
  const result = await searchLinkedInShort({
    searchQuery: 'Software Engineer',
    locations: ['San Francisco'],
    takePages: 1,
  });

  console.log(`Profiles returned: ${result.profiles.length}`);
  console.log(`Total matches: ${result.pagination.totalElements}`);
  console.log(`Cost: $${(result.cost.costCents / 100).toFixed(2)}`);
  console.log('\nFirst 3 profiles:');
  for (const p of result.profiles.slice(0, 3)) {
    console.log(`  ${p.fullName} — ${p.role} at ${p.company} (${p.location})`);
  }
}

async function testEndToEnd() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST: End-to-End Pipeline (Parse → Search)');
  console.log('='.repeat(80));

  const query = QUERIES[0]; // "software engineers at Google in San Francisco"
  console.log(`\nQuery: "${query}"`);

  // Step 1: Parse
  console.log('\n[Step 1] Parsing with Haiku...');
  const parsed = await parseSearchQuery(query);
  console.log('LinkedIn Filters:', JSON.stringify(parsed.linkedInFilters, null, 2));

  // Step 2: Search
  console.log('\n[Step 2] Searching LinkedIn Short mode...');
  const result = await searchLinkedInShort({
    ...parsed.linkedInFilters,
    takePages: 1,
  });

  console.log(`\nResults: ${result.profiles.length} profiles (${result.pagination.totalElements} total matches)`);
  console.log('\nFirst 5 profiles:');
  for (const p of result.profiles.slice(0, 5)) {
    console.log(`  ${p.fullName} — ${p.role} at ${p.company} (${p.location})`);
  }

  // Total cost
  const totalCostCents = parsed.cost.costCents + result.cost.costCents;
  console.log(`\nTotal cost: $${(totalCostCents / 100).toFixed(4)}`);
  console.log(`  Haiku: ${parsed.cost.haikuCalls} calls`);
  console.log(`  Serper: ${parsed.cost.serperCalls} calls`);
  console.log(`  Short mode: ${result.cost.shortModePages} pages`);
}

async function main() {
  console.log('Phase 1 Discovery Pipeline Test');
  console.log('================================\n');

  // Check env vars
  const checks = [
    ['APIFY_API_KEY', !!process.env.APIFY_API_KEY],
    ['ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
    ['SERPER_API_KEY', !!process.env.SERPER_API_KEY],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }

  if (checks.some(([, ok]) => !ok)) {
    console.error('\nMissing required env vars. Aborting.');
    process.exit(1);
  }

  try {
    // Test 1: Company resolver (3 Serper calls max)
    await testCompanyResolver();

    // Test 2: Query parser with all 5 queries (5 Haiku calls + possible Serper)
    await testQueryParser();

    // Test 3: Direct LinkedIn search (1 Short mode call)
    await testLinkedInSearch();

    // Test 4: End-to-end (1 Haiku + 1 Short mode)
    await testEndToEnd();

    console.log('\n' + '='.repeat(80));
    console.log('ALL TESTS COMPLETE');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\nTEST FAILED:', error);
    process.exit(1);
  }
}

main();
