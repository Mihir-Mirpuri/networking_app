/**
 * Unit tests for scrape progress functions in search-cache.ts
 *
 * Run with: npx tsx src/lib/db/search-cache.test.ts
 */

import { getNextCsePageStart, isCsePageExhausted, normalizeSearchParams } from './search-cache';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${description}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${description}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, description: string) {
  const pass = actual === expected;
  if (pass) {
    console.log(`  ${GREEN}✓${RESET} ${description}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${description} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ===== getNextCsePageStart =====
console.log(`\n${BOLD}getNextCsePageStart${RESET}`);

assertEqual(getNextCsePageStart(0, false), 1, 'never scraped → page 1 (start=1)');
assertEqual(getNextCsePageStart(1, false), 11, 'page 1 scraped → page 2 (start=11)');
assertEqual(getNextCsePageStart(11, false), 21, 'page 2 scraped → page 3 (start=21)');
assertEqual(getNextCsePageStart(21, false), 31, 'page 3 scraped → page 4 (start=31)');
assertEqual(getNextCsePageStart(0, true), null, 'exhausted with 0 scraped → null');
assertEqual(getNextCsePageStart(1, true), null, 'exhausted after page 1 → null');
assertEqual(getNextCsePageStart(21, true), null, 'exhausted after page 3 → null');

// ===== isCsePageExhausted =====
console.log(`\n${BOLD}isCsePageExhausted${RESET}`);

assertEqual(isCsePageExhausted(0), true, '0 profiles → exhausted');
assertEqual(isCsePageExhausted(1), true, '1 profile → exhausted');
assertEqual(isCsePageExhausted(4), true, '4 profiles → exhausted');
assertEqual(isCsePageExhausted(5), false, '5 profiles → NOT exhausted');
assertEqual(isCsePageExhausted(7), false, '7 profiles → NOT exhausted');
assertEqual(isCsePageExhausted(10), false, '10 profiles → NOT exhausted');

// ===== normalizeSearchParams =====
console.log(`\n${BOLD}normalizeSearchParams${RESET}`);

const p1 = normalizeSearchParams({ company: '  McKinsey  ', role: 'Analyst' });
assertEqual(p1.company, 'mckinsey', 'trims and lowercases company');
assertEqual(p1.role, 'analyst', 'lowercases role');
assertEqual(p1.university, null, 'undefined → null');
assertEqual(p1.location, null, 'undefined → null');
assertEqual(p1.name, null, 'undefined → null');

const p2 = normalizeSearchParams({ company: '', role: '  ' });
assertEqual(p2.company, null, 'empty string → null');
assertEqual(p2.role, null, 'whitespace-only → null');

const p3 = normalizeSearchParams({});
assertEqual(p3.company, null, 'all undefined → null company');
assertEqual(p3.role, null, 'all undefined → null role');

const p4 = normalizeSearchParams({ company: 'EY', university: 'Harvard', location: 'NYC' });
assertEqual(p4.company, 'ey', 'short company lowercased');
assertEqual(p4.university, 'harvard', 'university lowercased');
assertEqual(p4.location, 'nyc', 'location lowercased');

// ===== Summary =====
console.log(`\n${BOLD}Results: ${passed} passed, ${failed} failed${RESET}`);
if (failed > 0) {
  process.exit(1);
}
