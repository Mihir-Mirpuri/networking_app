/**
 * Unit tests for normalizeRoleForEmbedding().
 *
 * This is a pure function — no DB, no API calls. Tests run in-process.
 *
 * The function strips LinkedIn headline noise (content after the first `|`, `·`,
 * `—`, or `–` separator) then lowercases and trims. Goal: a role like
 * "Senior SWE | Ex-Google | ML/AI Enthusiast" produces the same embedding as
 * "Senior SWE", so noisy LinkedIn profile headlines match clean search queries.
 *
 * Usage: npx tsx tests/test-normalize-role-for-embedding.ts
 */

import { normalizeRoleForEmbedding } from '../src/lib/services/embeddings';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function assertEq(actual: string, expected: string, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERTION FAILED: ${msg}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(actual)}`
    );
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log('=== normalizeRoleForEmbedding tests ===\n');

// Basic passthrough
test('clean role passes through unchanged (lowercased)', () => {
  assertEq(normalizeRoleForEmbedding('Software Engineer'), 'software engineer', 'Should lowercase a clean role');
});

test('trims surrounding whitespace', () => {
  assertEq(normalizeRoleForEmbedding('  Analyst  '), 'analyst', 'Should trim whitespace');
});

test('lowercases', () => {
  assertEq(normalizeRoleForEmbedding('PRODUCT MANAGER'), 'product manager', 'Should lowercase');
});

// Headline separators — the main purpose
test('strips content after pipe', () => {
  assertEq(normalizeRoleForEmbedding('SWE | Ex-Google | ML/AI'), 'swe', 'Should strip after first pipe');
});

test('strips content after middle dot (·)', () => {
  assertEq(normalizeRoleForEmbedding('Engineer · Stanford \'20'), 'engineer', 'Should strip after middle dot');
});

test('strips content after em dash (—)', () => {
  assertEq(normalizeRoleForEmbedding('Designer — at Figma'), 'designer', 'Should strip after em dash');
});

test('strips content after en dash (–)', () => {
  assertEq(normalizeRoleForEmbedding('Data Scientist – Search Team'), 'data scientist', 'Should strip after en dash');
});

test('preserves simple hyphens inside words', () => {
  // "Co-Founder" has a hyphen but not the LinkedIn headline kind — we only strip em/en dashes
  assertEq(normalizeRoleForEmbedding('Co-Founder'), 'co-founder', 'Should keep in-word hyphens');
});

test('handles multiple separator types picks first', () => {
  assertEq(normalizeRoleForEmbedding('VP Engineering | Stripe · SF'), 'vp engineering', 'Should strip at first separator encountered');
});

test('handles separator without spaces', () => {
  assertEq(normalizeRoleForEmbedding('Senior SWE|Ex-Meta'), 'senior swe', 'Should strip even without spaces around pipe');
});

test('handles trailing separator', () => {
  assertEq(normalizeRoleForEmbedding('Analyst |'), 'analyst', 'Should trim trailing whitespace after strip');
});

test('preserves role fully when no separators', () => {
  assertEq(
    normalizeRoleForEmbedding('Senior Staff Machine Learning Engineer'),
    'senior staff machine learning engineer',
    'Should not modify roles without headline noise'
  );
});

// Edge cases
test('empty string returns empty', () => {
  assertEq(normalizeRoleForEmbedding(''), '', 'Empty input returns empty');
});

test('whitespace-only string returns empty', () => {
  assertEq(normalizeRoleForEmbedding('   '), '', 'Whitespace-only returns empty');
});

test('leading separator returns empty', () => {
  assertEq(normalizeRoleForEmbedding('| Engineer'), '', 'Leading separator means first segment is empty');
});

test('handles internal whitespace collapsing not required', () => {
  // We don't collapse internal spaces — keep as-is
  assertEq(normalizeRoleForEmbedding('Software  Engineer'), 'software  engineer', 'Internal spaces preserved');
});

// Real-world LinkedIn headlines from the audit
test('real example: "Building the future of AI | Staff Engineer at Anthropic"', () => {
  assertEq(
    normalizeRoleForEmbedding('Building the future of AI | Staff Engineer at Anthropic'),
    'building the future of ai',
    'First segment wins — even if later segments have the real title'
  );
});

test('real example: "Senior SWE | Ex-Google | ML/AI Enthusiast | Stanford \'18"', () => {
  assertEq(
    normalizeRoleForEmbedding("Senior SWE | Ex-Google | ML/AI Enthusiast | Stanford '18"),
    'senior swe',
    'Classic LinkedIn headline gets cleaned'
  );
});

// Idempotency
test('idempotent: normalize(normalize(x)) === normalize(x)', () => {
  const inputs = [
    'Software Engineer',
    'SWE | Ex-Google',
    '  Analyst · Stanford  ',
    '',
  ];
  for (const input of inputs) {
    const once = normalizeRoleForEmbedding(input);
    const twice = normalizeRoleForEmbedding(once);
    assertEq(twice, once, `Idempotency failed for input "${input}"`);
  }
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
