/**
 * Phase 3 Step 1 Test: searchPeopleV2Action End-to-End
 *
 * Tests the new natural language → Haiku parse → DB-first → Short mode pipeline.
 *
 * Test cases:
 * 1. Query with likely DB hits (should skip API if 6+ exist)
 * 2. Query with few DB hits (should trigger Short mode)
 * 3. University query (should tag profiles with school)
 * 4. Query with LinkedIn-only filters (seniority, industry)
 * 5. Cost tracking verification
 *
 * Expected cost: ~$0.50 (5 × Haiku parse + 2-3 Short mode pages)
 */

import 'dotenv/config';
import { parseSearchQuery } from '../src/lib/services/query-parser';
import { searchLinkedInShort } from '../src/lib/services/linkedin-search';
import { saveShortProfile } from '../src/lib/db/person-service';
import { findPeopleByFilters, PersonFilters } from '../src/lib/db/person-service';
import { resolveCompanyAliases } from '../src/lib/services/company-alias';
import prisma from '../src/lib/prisma';
import { createHash } from 'crypto';

const DB_FIRST_THRESHOLD = 6;

interface TestResult {
  query: string;
  dbResultCount: number;
  apiCalled: boolean;
  shortModeProfiles: number;
  newProfilesSaved: number;
  finalResultCount: number;
  totalCostCents: number;
  totalMatchesOnLinkedIn: number;
  elapsedMs: number;
}

/**
 * Run the full V2 search pipeline manually (not going through the server action
 * since we don't have a session, but exercising the same logic).
 */
async function runSearchPipeline(query: string, limit: number = 25): Promise<TestResult> {
  const start = Date.now();

  // Step 1: Parse
  console.log(`\n[Test] Parsing: "${query}"`);
  const parsed = await parseSearchQuery(query);
  const { dbFilters, linkedInFilters, cost: parseCost } = parsed;
  console.log(`[Test] dbFilters: ${JSON.stringify(dbFilters)}`);
  console.log(`[Test] linkedInFilters keys: ${Object.keys(linkedInFilters).filter(k => (linkedInFilters as any)[k] !== undefined).join(', ')}`);

  // Step 2: Build filters and query DB
  let companyAliases: string[] = [];
  if (dbFilters.company) {
    const resolved = await resolveCompanyAliases(dbFilters.company);
    companyAliases = resolved.aliases;
  }

  const filters: PersonFilters = {
    company: dbFilters.company || '',
    companyAliases: companyAliases.length > 0 ? companyAliases : undefined,
    location: dbFilters.location || undefined,
    role: dbFilters.role || undefined,
    university: dbFilters.university || undefined,
    requireEmail: false,
    limit,
  };

  let people = await findPeopleByFilters(filters);
  const dbResultCount = people.length;
  console.log(`[Test] DB results: ${dbResultCount}`);

  // Step 3: Decision
  let apiCalled = false;
  let shortModeProfiles = 0;
  let newProfilesSaved = 0;
  let totalMatchesOnLinkedIn = 0;
  let shortModePages = 0;

  if (dbResultCount < DB_FIRST_THRESHOLD) {
    console.log(`[Test] DB has ${dbResultCount} (< ${DB_FIRST_THRESHOLD}) — calling Short mode`);
    apiCalled = true;

    const apiResult = await searchLinkedInShort({
      ...linkedInFilters,
      takePages: 1,
    });
    shortModePages = 1;
    shortModeProfiles = apiResult.profiles.length;
    totalMatchesOnLinkedIn = apiResult.pagination.totalElements;

    console.log(`[Test] API returned ${shortModeProfiles} profiles (${totalMatchesOnLinkedIn} total on LinkedIn)`);

    // Save profiles
    const schoolTag = linkedInFilters.schools?.[0] || null;
    for (const profile of apiResult.profiles) {
      try {
        const { isNew } = await saveShortProfile(profile, schoolTag);
        if (isNew) newProfilesSaved++;
      } catch (err) {
        // Skip failures
      }
    }
    console.log(`[Test] Saved ${newProfilesSaved} new profiles`);

    // Re-query
    people = await findPeopleByFilters(filters);
    console.log(`[Test] After merge: ${people.length} results`);
  } else {
    console.log(`[Test] DB has ${dbResultCount} (>= ${DB_FIRST_THRESHOLD}) — skipping API`);
  }

  const totalCostCents = parseCost.costCents + (shortModePages * 10);
  const elapsed = Date.now() - start;

  // Save Search record
  const queryHash = createHash('sha256')
    .update(JSON.stringify(linkedInFilters))
    .digest('hex');

  await prisma.search.create({
    data: {
      queryHash,
      rawQuery: query,
      parsedFilters: JSON.parse(JSON.stringify({ dbFilters, linkedInFilters })),
      company: dbFilters.company || null,
      role: dbFilters.role || null,
      university: dbFilters.university || null,
      location: dbFilters.location || null,
      haikuCalls: parseCost.haikuCalls,
      shortModePages,
      totalCostCents,
      costBreakdown: {
        haiku: parseCost.costCents,
        shortMode: shortModePages * 10,
        serper: parseCost.serperCalls * 0.1,
        fullScrape: 0,
      },
      totalLinkedInMatches: totalMatchesOnLinkedIn > 0 ? totalMatchesOnLinkedIn : null,
      profilesAdded: newProfilesSaved,
      completedAt: new Date(),
    },
  });

  // Show sample results
  if (people.length > 0) {
    console.log(`[Test] Top 3 results:`);
    for (const p of people.slice(0, 3)) {
      console.log(`  ${p.fullName} — ${p.role || 'no role'} at ${p.company} (${p.city || 'no city'}, scrapeDepth: ${(p as any).scrapeDepth || 'unknown'})`);
    }
  }

  return {
    query,
    dbResultCount,
    apiCalled,
    shortModeProfiles,
    newProfilesSaved,
    finalResultCount: people.length,
    totalCostCents,
    totalMatchesOnLinkedIn,
    elapsedMs: elapsed,
  };
}

async function main() {
  console.log('Phase 3 Step 1: searchPeopleV2Action Pipeline Test');
  console.log('='.repeat(60));

  // Check env vars
  const checks = [
    ['APIFY_API_KEY', !!process.env.APIFY_API_KEY],
    ['ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
    ['SERPER_API_KEY', !!process.env.SERPER_API_KEY],
    ['DATABASE_URL', !!process.env.DATABASE_URL],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (checks.some(([, ok]) => !ok)) {
    console.error('\nMissing required env vars. Aborting.');
    process.exit(1);
  }

  const results: TestResult[] = [];

  const queries = [
    // 1. Likely many DB hits (Google engineers in SF — common in most DBs)
    'software engineers at Google in San Francisco',

    // 2. Small company (should trigger Short mode)
    'product managers at Anara in Austin',

    // 3. University query (should tag profiles with school)
    'engineers from Stanford in New York',

    // 4. LinkedIn-only filters (seniority + industry)
    'senior fintech founders in San Francisco',

    // 5. Broad query (many DB matches possible)
    'VPs of engineering at large tech companies in Seattle',
  ];

  try {
    for (let i = 0; i < queries.length; i++) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TEST ${i + 1}/${queries.length}: "${queries[i]}"`);
      console.log('='.repeat(60));

      const result = await runSearchPipeline(queries[i]);
      results.push(result);
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('');
    console.log(`${'Query'.padEnd(50)} | DB | API | New | Final | Cost    | Time`);
    console.log('-'.repeat(110));

    let totalCost = 0;
    for (const r of results) {
      totalCost += r.totalCostCents;
      const q = r.query.length > 48 ? r.query.substring(0, 45) + '...' : r.query;
      console.log(
        `${q.padEnd(50)} | ${String(r.dbResultCount).padStart(2)} | ${r.apiCalled ? 'YES' : ' NO'} | ${String(r.newProfilesSaved).padStart(3)} | ${String(r.finalResultCount).padStart(5)} | $${(r.totalCostCents / 100).toFixed(4)} | ${r.elapsedMs}ms`
      );
    }

    console.log('-'.repeat(110));
    console.log(`Total cost: $${(totalCost / 100).toFixed(4)}`);
    console.log(`API calls: ${results.filter(r => r.apiCalled).length}/${results.length} searches`);
    console.log(`New profiles: ${results.reduce((sum, r) => sum + r.newProfilesSaved, 0)}`);

    // Verify Search records were saved
    const recentSearches = await prisma.search.findMany({
      where: { rawQuery: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        rawQuery: true,
        haikuCalls: true,
        shortModePages: true,
        totalCostCents: true,
        costBreakdown: true,
      },
    });

    console.log(`\nSearch records saved: ${recentSearches.length}`);
    for (const s of recentSearches) {
      console.log(`  "${s.rawQuery}" — haiku:${s.haikuCalls}, short:${s.shortModePages}, cost:$${(s.totalCostCents / 100).toFixed(4)}`);
    }

    console.log('\nALL TESTS COMPLETE');
  } catch (error) {
    console.error('\nTEST FAILED:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
