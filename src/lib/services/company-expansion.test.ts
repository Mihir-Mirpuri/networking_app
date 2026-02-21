/**
 * Tests for company name expansion in CSE queries
 *
 * Run with: npx tsx src/lib/services/company-expansion.test.ts
 */

import { buildCompanyQueryPart } from '@/lib/services/discovery';

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

async function main() {
  // ===== buildCompanyQueryPart =====
  console.log(`\n${BOLD}buildCompanyQueryPart${RESET}`);

  const gsPart = await buildCompanyQueryPart('Goldman Sachs');
  assert(gsPart === '"Goldman Sachs"', `Known company returns quoted string: ${gsPart}`);

  const emptyPart = await buildCompanyQueryPart('');
  assert(emptyPart === '', 'Empty string returns empty string');

  const trimPart = await buildCompanyQueryPart('  BCG  ');
  assert(trimPart === '"BCG"', `Trims whitespace: ${trimPart}`);

  // ===== Summary =====
  console.log(`\n${BOLD}Results: ${passed} passed, ${failed} failed${RESET}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
