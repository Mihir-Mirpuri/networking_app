/**
 * Tests for LLM-powered company name expansion in CSE queries
 *
 * Run with: npx tsx src/lib/services/company-expansion.test.ts
 */

import { getCompanyKey, getCompanyAliases } from '@/lib/db/person-service';
import { expandCompanyName, buildCompanyQueryPart } from '@/lib/services/discovery';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

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
  // ===== Tier 1: Alias-based expansion =====
  console.log(`\n${BOLD}Tier 1: getCompanyAliases${RESET}`);

  const gsKey = getCompanyKey('goldman sachs');
  assert(gsKey === 'goldmansachs', 'getCompanyKey resolves "goldman sachs"', `got: ${gsKey}`);

  const gsAliases = getCompanyAliases('goldmansachs');
  assert(gsAliases.length > 0, `getCompanyAliases("goldmansachs") returns aliases`, `got: ${JSON.stringify(gsAliases)}`);
  assert(gsAliases.includes('goldman sachs'), 'Aliases include "goldman sachs"');
  assert(gsAliases.includes('goldman'), 'Aliases include "goldman"');

  const bcgKey = getCompanyKey('boston consulting group');
  assert(bcgKey === 'bcg', 'getCompanyKey resolves "boston consulting group"', `got: ${bcgKey}`);

  const bcgAliases = getCompanyAliases('bcg');
  assert(bcgAliases.includes('bcg'), 'BCG aliases include "bcg"');
  assert(bcgAliases.includes('boston consulting group'), 'BCG aliases include "boston consulting group"');

  const unknownAliases = getCompanyAliases('nonexistent_company_xyz');
  assert(unknownAliases.length === 0, 'Unknown key returns empty array');

  // ===== Tier 1: expandCompanyName with known companies =====
  console.log(`\n${BOLD}Tier 1: expandCompanyName (alias path)${RESET}`);

  const gsExpansion = await expandCompanyName('Goldman Sachs');
  assert(gsExpansion.length > 0, `expandCompanyName("Goldman Sachs") returns alternatives`, `got: ${JSON.stringify(gsExpansion)}`);
  assert(!gsExpansion.some(a => a.toLowerCase() === 'goldman sachs'), 'Does not include the original name');
  assert(gsExpansion.length <= 3, `Returns at most 3 alternatives (got ${gsExpansion.length})`);

  const bcgExpansion = await expandCompanyName('BCG');
  assert(bcgExpansion.length > 0, `expandCompanyName("BCG") returns alternatives`, `got: ${JSON.stringify(bcgExpansion)}`);
  assert(bcgExpansion.some(a => a.toLowerCase() === 'boston consulting group'), 'BCG expands to "boston consulting group"');

  const eyExpansion = await expandCompanyName('Ernst & Young');
  assert(eyExpansion.length > 0, `expandCompanyName("Ernst & Young") returns alternatives`, `got: ${JSON.stringify(eyExpansion)}`);
  assert(eyExpansion.some(a => a.toLowerCase() === 'ey'), 'Ernst & Young expands to include "ey"');

  // ===== Cache behavior =====
  console.log(`\n${BOLD}Cache behavior${RESET}`);

  const t1 = performance.now();
  const gsExpansion2 = await expandCompanyName('Goldman Sachs');
  const t2 = performance.now();
  assert(t2 - t1 < 5, `Cached call returns in <5ms (took ${(t2 - t1).toFixed(1)}ms)`);
  assert(
    JSON.stringify(gsExpansion2) === JSON.stringify(gsExpansion),
    'Cached result matches original'
  );

  // ===== buildCompanyQueryPart =====
  console.log(`\n${BOLD}buildCompanyQueryPart${RESET}`);

  const gsPart = await buildCompanyQueryPart('Goldman Sachs');
  assert(gsPart.startsWith('('), `Known company returns OR-group: ${DIM}${gsPart}${RESET}`);
  assert(gsPart.includes('"Goldman Sachs"'), 'Includes original name quoted');
  assert(gsPart.includes(' OR '), 'Contains OR operator');

  const emptyPart = await buildCompanyQueryPart('');
  assert(emptyPart === '', 'Empty string returns empty string');

  // ===== Tier 2: LLM fallback (requires GROQ_API_KEY) =====
  console.log(`\n${BOLD}Tier 2: expandCompanyName (LLM path)${RESET}`);

  if (!process.env.GROQ_API_KEY) {
    console.log(`  ${DIM}⏭ Skipping LLM tests — GROQ_API_KEY not set${RESET}`);
  } else {
    // "International Business Machines" is NOT in COMPANY_ALIASES — forces LLM path
    const ibmKey = getCompanyKey('international business machines');
    if (ibmKey) {
      console.log(`  ${DIM}⏭ "International Business Machines" resolved via alias (key: ${ibmKey}), using different company${RESET}`);
    }

    // Use a company not in the alias map to guarantee LLM path
    const novelExpansion = await expandCompanyName('International Business Machines');
    console.log(`  ${DIM}LLM expansion for "International Business Machines": ${JSON.stringify(novelExpansion)}${RESET}`);
    if (!ibmKey) {
      assert(novelExpansion.length > 0, 'LLM returns alternatives for "International Business Machines"');
      assert(
        novelExpansion.some(a => a.toUpperCase() === 'IBM'),
        'LLM expands "International Business Machines" to include "IBM"',
        `got: ${JSON.stringify(novelExpansion)}`
      );
    }

    // Test a company that genuinely has no well-known abbreviation
    const obscureExpansion = await expandCompanyName('Kavita Networking Startup XYZ');
    console.log(`  ${DIM}LLM expansion for obscure company: ${JSON.stringify(obscureExpansion)}${RESET}`);
    assert(obscureExpansion.length <= 3, 'Obscure company returns 0-3 alternatives');

    // Test buildCompanyQueryPart for LLM-expanded company
    const novelPart = await buildCompanyQueryPart('International Business Machines');
    console.log(`  ${DIM}Query part: ${novelPart}${RESET}`);
    assert(novelPart.includes('"International Business Machines"'), 'Query part includes original');
  }

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
