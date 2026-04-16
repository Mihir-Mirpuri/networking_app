/**
 * Test: DB_FIRST_THRESHOLD should only count exact/near_exact matches,
 * not "similar" tier results from vector search.
 *
 * Bug: When searching "test engineers at Saronic" after previously searching
 * "software engineers at Saronic", the DB returns software engineers as
 * "similar" tier vector matches. If ≥6 similar results exist, the system
 * skips the LinkedIn API and returns the wrong people.
 *
 * Fix: Only count exact/near_exact ("strong") matches toward the threshold.
 */

import { shouldSkipApi, DB_FIRST_THRESHOLD } from '../src/lib/services/search-threshold';

type MatchTier = 'exact' | 'near_exact' | 'similar';

interface MockResult {
  matchTier: MatchTier;
  role: string;
}

function makeResults(tiers: Array<{ tier: MatchTier; role: string; count: number }>): MockResult[] {
  const results: MockResult[] = [];
  for (const { tier, role, count } of tiers) {
    for (let i = 0; i < count; i++) {
      results.push({ matchTier: tier, role: `${role} ${i + 1}` });
    }
  }
  return results;
}

let passed = 0;
let failed = 0;

function assert(name: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} — expected ${expected}, got ${actual}`);
  }
}

console.log('\n=== Strong Match Threshold Tests ===\n');

// ── Test 1: All exact matches above threshold → skip API ──
console.log('Test 1: All exact matches above threshold');
{
  const results = makeResults([
    { tier: 'exact', role: 'Software Engineer', count: 8 },
  ]);
  assert('should skip API', shouldSkipApi(results), true);
}

// ── Test 2: All similar matches above threshold → DO NOT skip API ──
console.log('\nTest 2: All similar matches above threshold (the bug case)');
{
  const results = makeResults([
    { tier: 'similar', role: 'Software Engineer', count: 10 },
  ]);
  assert('should NOT skip API', shouldSkipApi(results), false);
}

// ── Test 3: Mixed — few exact + many similar → DO NOT skip API ──
console.log('\nTest 3: Few exact + many similar (below strong threshold)');
{
  const results = makeResults([
    { tier: 'exact', role: 'Test Engineer', count: 2 },
    { tier: 'similar', role: 'Software Engineer', count: 8 },
  ]);
  assert('should NOT skip API', shouldSkipApi(results), false);
}

// ── Test 4: Near_exact counts as strong ──
console.log('\nTest 4: near_exact counts as strong match');
{
  const results = makeResults([
    { tier: 'exact', role: 'Test Engineer', count: 3 },
    { tier: 'near_exact', role: 'Senior Test Engineer', count: 4 },
  ]);
  assert('should skip API (7 strong matches)', shouldSkipApi(results), true);
}

// ── Test 5: Mix of near_exact + similar, near_exact below threshold ──
console.log('\nTest 5: near_exact below threshold + many similar');
{
  const results = makeResults([
    { tier: 'near_exact', role: 'QA Engineer', count: 3 },
    { tier: 'similar', role: 'Software Engineer', count: 15 },
  ]);
  assert('should NOT skip API', shouldSkipApi(results), false);
}

// ── Test 6: Empty results → DO NOT skip API ──
console.log('\nTest 6: Empty results');
{
  assert('should NOT skip API', shouldSkipApi([]), false);
}

// ── Test 7: Exactly at threshold ──
console.log('\nTest 7: Exactly at threshold boundary');
{
  const results = makeResults([
    { tier: 'exact', role: 'Test Engineer', count: DB_FIRST_THRESHOLD },
  ]);
  assert('should skip API (at threshold)', shouldSkipApi(results), true);
}

// ── Test 8: One below threshold ──
console.log('\nTest 8: One below threshold');
{
  const results = makeResults([
    { tier: 'exact', role: 'Test Engineer', count: DB_FIRST_THRESHOLD - 1 },
  ]);
  assert('should NOT skip API (below threshold)', shouldSkipApi(results), false);
}

// ── Test 9: The exact user-reported bug scenario ──
console.log('\nTest 9: User scenario — "test engineers at Saronic" after "software engineers at Saronic"');
{
  // DB has software engineers from first search, returned as "similar" for test engineer query
  const results = makeResults([
    { tier: 'similar', role: 'Software Engineer', count: 12 },
    { tier: 'similar', role: 'Senior Software Engineer', count: 5 },
    { tier: 'similar', role: 'Staff Software Engineer', count: 3 },
  ]);
  assert('should NOT skip API — these are all wrong-role similar matches', shouldSkipApi(results), false);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
