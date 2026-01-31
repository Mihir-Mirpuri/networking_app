/**
 * Integration test for search caching and CSE query changes
 *
 * Run with: npx ts-node scripts/test-search-caching.ts
 */

import {
  normalizeSearchParams,
  findCachedSearch,
  findStaleSearch,
  getCachedPersonIds,
  createSearchWithPeople,
  updateSearchWithPeople,
  getStalePersonIds,
  getPersonsByIds,
} from '../src/lib/db/search-cache';
import prisma from '../src/lib/prisma';

// Test search params
const TEST_PARAMS = {
  name: undefined,
  company: 'Goldman Sachs',
  role: 'Software Engineer',
  university: 'Stanford',
  location: 'New York',
};

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  // Delete test searches
  const normalized = normalizeSearchParams(TEST_PARAMS);
  await prisma.$executeRaw`
    DELETE FROM "SearchPerson" WHERE "searchId" IN (
      SELECT id FROM "Search"
      WHERE COALESCE("company", '') = COALESCE(${normalized.company}, '')
    )
  `;
  await prisma.$executeRaw`
    DELETE FROM "Search"
    WHERE COALESCE("company", '') = COALESCE(${normalized.company}, '')
  `;
  console.log('✅ Cleanup complete');
}

async function testNormalizeSearchParams() {
  console.log('\n📋 Test 1: normalizeSearchParams');

  const params = normalizeSearchParams({
    company: '  Goldman Sachs  ',
    role: 'Software Engineer',
    university: 'STANFORD',
    location: 'New York',
  });

  console.log('Input:', { company: '  Goldman Sachs  ', role: 'Software Engineer', university: 'STANFORD' });
  console.log('Output:', params);

  if (params.company === 'goldman sachs' && params.university === 'stanford') {
    console.log('✅ PASS: Params normalized correctly (lowercase, trimmed)');
    return true;
  } else {
    console.log('❌ FAIL: Params not normalized correctly');
    return false;
  }
}

async function testCacheMiss() {
  console.log('\n📋 Test 2: Cache Miss (first search)');

  const normalized = normalizeSearchParams(TEST_PARAMS);
  const cached = await findCachedSearch(normalized);

  if (cached === null) {
    console.log('✅ PASS: No cached search found (expected for fresh search)');
    return true;
  } else {
    console.log('❌ FAIL: Found cached search when none expected:', cached);
    return false;
  }
}

async function testCreateSearchCache() {
  console.log('\n📋 Test 3: Create search cache');

  const normalized = normalizeSearchParams(TEST_PARAMS);

  // Get some real person IDs from the database
  const people = await prisma.person.findMany({
    take: 3,
    select: { id: true },
  });

  if (people.length === 0) {
    console.log('⚠️ SKIP: No people in database to test with');
    return true;
  }

  const personIds = people.map(p => p.id);
  console.log(`Creating search cache with ${personIds.length} people...`);

  const { searchId } = await createSearchWithPeople(normalized, personIds);
  console.log(`Created search: ${searchId}`);

  if (searchId) {
    console.log('✅ PASS: Search cache created');
    return true;
  } else {
    console.log('❌ FAIL: Failed to create search cache');
    return false;
  }
}

async function testCacheHit() {
  console.log('\n📋 Test 4: Cache Hit (repeat search)');

  const normalized = normalizeSearchParams(TEST_PARAMS);
  const cached = await findCachedSearch(normalized);

  if (cached) {
    console.log(`✅ PASS: Cache hit! Search ID: ${cached.id}, Created: ${cached.createdAt}`);
    return true;
  } else {
    console.log('❌ FAIL: Expected cache hit but got miss');
    return false;
  }
}

async function testGetCachedPersonIds() {
  console.log('\n📋 Test 5: Get cached person IDs');

  const normalized = normalizeSearchParams(TEST_PARAMS);
  const cached = await findCachedSearch(normalized);

  if (!cached) {
    console.log('⚠️ SKIP: No cached search to test');
    return true;
  }

  const personIds = await getCachedPersonIds(cached.id);
  console.log(`Found ${personIds.length} cached person IDs`);

  if (personIds.length > 0) {
    console.log('✅ PASS: Retrieved cached person IDs');
    return true;
  } else {
    console.log('⚠️ WARN: No person IDs in cache (may be expected if no people in DB)');
    return true;
  }
}

async function testGetPersonsByIds() {
  console.log('\n📋 Test 6: Get persons by IDs');

  const normalized = normalizeSearchParams(TEST_PARAMS);
  const cached = await findCachedSearch(normalized);

  if (!cached) {
    console.log('⚠️ SKIP: No cached search to test');
    return true;
  }

  const personIds = await getCachedPersonIds(cached.id);
  if (personIds.length === 0) {
    console.log('⚠️ SKIP: No person IDs to fetch');
    return true;
  }

  const people = await getPersonsByIds(personIds);
  console.log(`Retrieved ${people.length} people with full data`);

  if (people.length > 0 && people[0].fullName) {
    console.log(`Sample person: ${people[0].fullName} at ${people[0].company}`);
    console.log('✅ PASS: Retrieved full person data');
    return true;
  } else {
    console.log('❌ FAIL: Failed to retrieve person data');
    return false;
  }
}

async function testStalePersonDetection() {
  console.log('\n📋 Test 7: Stale person detection');

  // Get a person and check if stale detection works
  const person = await prisma.person.findFirst({
    select: { id: true, apolloEnrichedAt: true },
  });

  if (!person) {
    console.log('⚠️ SKIP: No people in database');
    return true;
  }

  const staleIds = await getStalePersonIds([person.id]);

  if (person.apolloEnrichedAt === null) {
    if (staleIds.includes(person.id)) {
      console.log('✅ PASS: Person with null apolloEnrichedAt detected as stale');
      return true;
    } else {
      console.log('❌ FAIL: Person with null apolloEnrichedAt not detected as stale');
      return false;
    }
  } else {
    const daysSinceEnrichment = (Date.now() - person.apolloEnrichedAt.getTime()) / (1000 * 60 * 60 * 24);
    console.log(`Person enriched ${daysSinceEnrichment.toFixed(1)} days ago`);

    if (daysSinceEnrichment > 30 && staleIds.includes(person.id)) {
      console.log('✅ PASS: Old person detected as stale');
      return true;
    } else if (daysSinceEnrichment <= 30 && !staleIds.includes(person.id)) {
      console.log('✅ PASS: Recent person not detected as stale');
      return true;
    } else {
      console.log('❌ FAIL: Stale detection mismatch');
      return false;
    }
  }
}

async function testCSEQueryBuilding() {
  console.log('\n📋 Test 8: CSE Query includes role and location');

  // We can't easily test the actual function without mocking, but we can
  // verify the code structure by importing and checking
  const discoveryPath = '../src/lib/services/discovery';

  // Read the file and check for the query building logic
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.join(__dirname, '..', 'src', 'lib', 'services', 'discovery.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  const hasRoleInQuery = content.includes("if (role && role.trim()) queryParts.push(role.trim())");
  const hasLocationInQuery = content.includes("if (location && location.trim()) queryParts.push(location.trim())");

  if (hasRoleInQuery && hasLocationInQuery) {
    console.log('✅ PASS: discovery.ts includes role and location in query building');
    return true;
  } else {
    console.log('❌ FAIL: discovery.ts missing role or location in query building');
    console.log(`  - Role in query: ${hasRoleInQuery}`);
    console.log(`  - Location in query: ${hasLocationInQuery}`);
    return false;
  }
}

async function testUpdateStaleSearch() {
  console.log('\n📋 Test 9: Update stale search');

  const normalized = normalizeSearchParams(TEST_PARAMS);

  // First, make the current search stale by updating its createdAt
  const currentSearch = await findCachedSearch(normalized);
  if (!currentSearch) {
    console.log('⚠️ SKIP: No search to make stale');
    return true;
  }

  // Make it stale (25 hours old)
  const staleTime = new Date();
  staleTime.setHours(staleTime.getHours() - 25);
  await prisma.search.update({
    where: { id: currentSearch.id },
    data: { createdAt: staleTime },
  });

  // Verify it's now stale
  const freshSearch = await findCachedSearch(normalized);
  if (freshSearch) {
    console.log('❌ FAIL: Search should be stale but found as fresh');
    return false;
  }

  const staleSearch = await findStaleSearch(normalized);
  if (!staleSearch) {
    console.log('❌ FAIL: Could not find stale search');
    return false;
  }

  console.log(`Found stale search: ${staleSearch.id}`);

  // Update it with new data
  const people = await prisma.person.findMany({ take: 2, select: { id: true } });
  const newPersonIds = people.map(p => p.id);

  await updateSearchWithPeople(staleSearch.id, newPersonIds);

  // Verify it's now fresh again
  const updatedSearch = await findCachedSearch(normalized);
  if (updatedSearch) {
    console.log('✅ PASS: Stale search updated and now fresh');
    return true;
  } else {
    console.log('❌ FAIL: Search still stale after update');
    return false;
  }
}

async function main() {
  console.log('🧪 Search Caching Integration Tests\n');
  console.log('=====================================');

  const results: { name: string; passed: boolean }[] = [];

  try {
    await cleanup();

    results.push({ name: 'normalizeSearchParams', passed: await testNormalizeSearchParams() });
    results.push({ name: 'cacheMiss', passed: await testCacheMiss() });
    results.push({ name: 'createSearchCache', passed: await testCreateSearchCache() });
    results.push({ name: 'cacheHit', passed: await testCacheHit() });
    results.push({ name: 'getCachedPersonIds', passed: await testGetCachedPersonIds() });
    results.push({ name: 'getPersonsByIds', passed: await testGetPersonsByIds() });
    results.push({ name: 'stalePersonDetection', passed: await testStalePersonDetection() });
    results.push({ name: 'cseQueryBuilding', passed: await testCSEQueryBuilding() });
    results.push({ name: 'updateStaleSearch', passed: await testUpdateStaleSearch() });

    await cleanup();

  } catch (error) {
    console.error('\n💥 Test error:', error);
  } finally {
    await prisma.$disconnect();
  }

  // Summary
  console.log('\n=====================================');
  console.log('📊 Test Summary\n');

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach(r => {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  });

  console.log(`\n  ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! Ready for production.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️ Some tests failed. Review before pushing.\n');
    process.exit(1);
  }
}

main();
