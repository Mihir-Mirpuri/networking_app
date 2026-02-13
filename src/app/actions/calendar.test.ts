/**
 * Unit tests for calendar action datetime normalization
 *
 * Run with: npx tsx src/app/actions/calendar.test.ts
 */

// Test the normalizeDateTime logic
const normalizeDateTime = (dt: string): string => {
  if (dt.length > 16) return dt;
  return `${dt}:00`;
};

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface TestCase {
  input: string;
  expected: string;
  description: string;
}

const testCases: TestCase[] = [
  {
    input: '2026-02-05T06:00',
    expected: '2026-02-05T06:00:00',
    description: 'datetime-local format (no seconds) should add :00',
  },
  {
    input: '2026-02-05T14:30',
    expected: '2026-02-05T14:30:00',
    description: 'afternoon time without seconds should add :00',
  },
  {
    input: '2026-02-05T06:00:00',
    expected: '2026-02-05T06:00:00',
    description: 'already has seconds - should not modify',
  },
  {
    input: '2026-02-05T06:00:00.000Z',
    expected: '2026-02-05T06:00:00.000Z',
    description: 'full ISO format - should not modify',
  },
  {
    input: '2026-02-05T06:00:30',
    expected: '2026-02-05T06:00:30',
    description: 'has non-zero seconds - should not modify',
  },
];

console.log('Testing datetime normalization for Google Calendar API\n');
console.log('═'.repeat(60));

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = normalizeDateTime(tc.input);
  const success = result === tc.expected;

  if (success) {
    console.log(`${GREEN}✓${RESET} ${tc.description}`);
    console.log(`  Input:    "${tc.input}"`);
    console.log(`  Output:   "${result}"`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} ${tc.description}`);
    console.log(`  Input:    "${tc.input}"`);
    console.log(`  Expected: "${tc.expected}"`);
    console.log(`  Got:      "${result}"`);
    failed++;
  }
  console.log();
}

console.log('═'.repeat(60));
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);

if (failed > 0) {
  process.exit(1);
}
