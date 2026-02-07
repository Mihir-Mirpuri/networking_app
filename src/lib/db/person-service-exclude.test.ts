/**
 * Unit tests for excludePersonIds in buildPersonWhereClause
 *
 * Run with: npx tsx src/lib/db/person-service-exclude.test.ts
 */

import { buildPersonWhereClause } from './person-service';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string, detail?: string) {
  if (condition) {
    console.log(`  ${GREEN}✓${RESET} ${description}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ===== excludePersonIds =====
console.log(`\n${BOLD}buildPersonWhereClause — excludePersonIds${RESET}`);

// Test 1: No excludePersonIds → no id filter
const where1 = buildPersonWhereClause({ company: 'Google' });
assert(
  !('id' in where1),
  'No excludePersonIds → where clause has no id field'
);

// Test 2: Empty array → no id filter
const where2 = buildPersonWhereClause({ company: 'Google', excludePersonIds: [] });
assert(
  !('id' in where2),
  'Empty excludePersonIds → where clause has no id field'
);

// Test 3: With IDs → id: { notIn: [...] }
const ids = ['abc-123', 'def-456', 'ghi-789'];
const where3 = buildPersonWhereClause({ company: 'Google', excludePersonIds: ids });
assert(
  'id' in where3,
  'With excludePersonIds → where clause has id field'
);
const idFilter = where3.id as { notIn: string[] };
assert(
  idFilter.notIn !== undefined,
  'id filter uses notIn operator'
);
assert(
  JSON.stringify(idFilter.notIn) === JSON.stringify(ids),
  'notIn contains the exact IDs passed',
  `got ${JSON.stringify(idFilter.notIn)}`
);

// Test 4: excludePersonIds doesn't interfere with other filters
const where4 = buildPersonWhereClause({
  company: 'Google',
  role: 'Analyst',
  excludePersonIds: ['abc-123'],
});
assert(
  'id' in where4 && 'role' in where4,
  'excludePersonIds coexists with role filter'
);

// Test 5: Large list of IDs (simulate many Load More clicks)
const manyIds = Array.from({ length: 100 }, (_, i) => `id-${i}`);
const where5 = buildPersonWhereClause({ company: 'Google', excludePersonIds: manyIds });
const idFilter5 = where5.id as { notIn: string[] };
assert(
  idFilter5.notIn.length === 100,
  'Handles 100 excluded IDs correctly',
  `got ${idFilter5.notIn.length}`
);

// ===== Summary =====
console.log(`\n${BOLD}Results: ${passed} passed, ${failed} failed${RESET}`);
if (failed > 0) {
  process.exit(1);
}
