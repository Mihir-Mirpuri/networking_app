/**
 * Manual assertion tests for the LinkedIn filter validator.
 * Run with: npx tsx tests/test-linkedin-filter-validator.ts
 *
 * No test framework — just assertions that throw on failure.
 */

import {
  sanitizeLinkedInFilters,
  VALID_SENIORITY_IDS,
  VALID_FUNCTION_IDS,
  VALID_HEADCOUNT_CODES,
  VALID_YOE_IDS,
} from '../src/lib/services/linkedin-filter-validator';
import type { LinkedInFilters } from '../src/lib/types/linkedin-filters';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

// Silence the console.warn noise from expected drops
const originalWarn = console.warn;
console.warn = () => {};

console.log('\n─── linkedin-filter-validator ───\n');

// ─── Allowlists ──────────────────────────────────────────────

test('seniority allowlist has all 10 expected IDs', () => {
  const expected = ['100', '110', '120', '130', '200', '210', '220', '300', '310', '320'];
  assertEqual([...VALID_SENIORITY_IDS].sort(), expected.sort(), 'seniority set');
});

test('function allowlist has all 26 expected IDs', () => {
  assertEqual(VALID_FUNCTION_IDS.size, 26, 'function count');
  for (let i = 1; i <= 26; i++) {
    if (!VALID_FUNCTION_IDS.has(String(i))) {
      throw new Error(`function ${i} missing from allowlist`);
    }
  }
});

test('headcount allowlist has A-I', () => {
  assertEqual([...VALID_HEADCOUNT_CODES].sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 'headcount set');
});

test('yoe allowlist has 1-5', () => {
  assertEqual([...VALID_YOE_IDS].sort(), ['1', '2', '3', '4', '5'], 'yoe set');
});

// ─── sanitizeLinkedInFilters: happy paths ────────────────────

test('sanitize null returns empty object', () => {
  assertEqual(sanitizeLinkedInFilters(null), {}, 'null input');
});

test('sanitize undefined returns empty object', () => {
  assertEqual(sanitizeLinkedInFilters(undefined), {}, 'undefined input');
});

test('sanitize empty object returns empty object', () => {
  assertEqual(sanitizeLinkedInFilters({}), {}, 'empty input');
});

test('valid seniority passes through', () => {
  const result = sanitizeLinkedInFilters({ seniorityLevelIds: ['120', '130'] });
  assertEqual(result, { seniorityLevelIds: ['120', '130'] }, 'valid seniority');
});

test('valid function passes through', () => {
  const result = sanitizeLinkedInFilters({ functionIds: ['8', '19'] });
  assertEqual(result, { functionIds: ['8', '19'] }, 'valid function');
});

test('valid headcount passes through', () => {
  const result = sanitizeLinkedInFilters({ companyHeadcount: ['B', 'C', 'D'] });
  assertEqual(result, { companyHeadcount: ['B', 'C', 'D'] }, 'valid headcount');
});

test('valid yoe passes through', () => {
  const result = sanitizeLinkedInFilters({ yearsOfExperienceIds: ['3'] });
  assertEqual(result, { yearsOfExperienceIds: ['3'] }, 'valid yoe');
});

test('non-ID pass-through fields are preserved', () => {
  const input: LinkedInFilters = {
    searchQuery: 'ML Engineer',
    locations: ['San Francisco'],
    schools: ['Stanford University'],
    currentCompanies: ['https://linkedin.com/company/anthropic'],
  };
  const result = sanitizeLinkedInFilters(input);
  assertEqual(result, input, 'pass-through');
});

// ─── sanitizeLinkedInFilters: hallucination drops ────────────

test('unknown seniority ID is dropped, valid ones kept', () => {
  const result = sanitizeLinkedInFilters({ seniorityLevelIds: ['120', '999'] });
  assertEqual(result, { seniorityLevelIds: ['120'] }, 'partial drop');
});

test('field is deleted when all IDs are invalid', () => {
  const result = sanitizeLinkedInFilters({ seniorityLevelIds: ['999'] });
  assertEqual(result, {}, 'empty field deleted');
});

test('unknown function ID is dropped', () => {
  const result = sanitizeLinkedInFilters({ functionIds: ['8', '99'] });
  assertEqual(result, { functionIds: ['8'] }, 'partial function drop');
});

test('unknown headcount code is dropped', () => {
  const result = sanitizeLinkedInFilters({ companyHeadcount: ['B', 'Z'] });
  assertEqual(result, { companyHeadcount: ['B'] }, 'partial headcount drop');
});

test('unknown yoe ID is dropped', () => {
  const result = sanitizeLinkedInFilters({ yearsOfExperienceIds: ['3', '99'] });
  assertEqual(result, { yearsOfExperienceIds: ['3'] }, 'partial yoe drop');
});

// ─── Exclude filters ─────────────────────────────────────────

test('valid exclude_seniority passes through', () => {
  const result = sanitizeLinkedInFilters({ excludeSeniorityLevelIds: ['110'] });
  assertEqual(result, { excludeSeniorityLevelIds: ['110'] }, 'valid exclude seniority');
});

test('unknown exclude_seniority is dropped', () => {
  const result = sanitizeLinkedInFilters({ excludeSeniorityLevelIds: ['999'] });
  assertEqual(result, {}, 'exclude seniority dropped');
});

test('valid exclude_function passes through', () => {
  const result = sanitizeLinkedInFilters({ excludeFunctionIds: ['8'] });
  assertEqual(result, { excludeFunctionIds: ['8'] }, 'valid exclude function');
});

test('exclude_locations (non-ID field) passes through untouched', () => {
  const result = sanitizeLinkedInFilters({ excludeLocations: ['California'] });
  assertEqual(result, { excludeLocations: ['California'] }, 'exclude locations');
});

// ─── Industry is forcibly stripped ───────────────────────────

test('industryIds is stripped even if valid', () => {
  const input = { industryIds: ['4'] } as unknown as LinkedInFilters;
  const result = sanitizeLinkedInFilters(input);
  assertEqual(result, {}, 'industry stripped');
});

test('industryIds stripped but other fields survive', () => {
  const input = {
    searchQuery: 'PM',
    seniorityLevelIds: ['120'],
    industryIds: ['4'],
  } as unknown as LinkedInFilters;
  const result = sanitizeLinkedInFilters(input);
  assertEqual(result, { searchQuery: 'PM', seniorityLevelIds: ['120'] }, 'industry stripped, rest kept');
});

// ─── Mixed realistic scenarios ───────────────────────────────

test('mixed valid/invalid with multiple fields', () => {
  const input: LinkedInFilters = {
    searchQuery: 'Senior Software Engineer',
    locations: ['New York'],
    seniorityLevelIds: ['120', '999'],
    functionIds: ['8', '99'],
    companyHeadcount: ['G'],
    yearsOfExperienceIds: ['4'],
  };
  const result = sanitizeLinkedInFilters(input);
  assertEqual(
    result,
    {
      searchQuery: 'Senior Software Engineer',
      locations: ['New York'],
      seniorityLevelIds: ['120'],
      functionIds: ['8'],
      companyHeadcount: ['G'],
      yearsOfExperienceIds: ['4'],
    },
    'mixed scenario'
  );
});

test('negation scenario (exclude_locations + seniority)', () => {
  const input: LinkedInFilters = {
    searchQuery: 'Software Engineer',
    seniorityLevelIds: ['120'],
    functionIds: ['8'],
    excludeLocations: ['California'],
  };
  const result = sanitizeLinkedInFilters(input);
  assertEqual(result, input, 'negation scenario');
});

// ─── Restore console.warn and report ─────────────────────────

console.warn = originalWarn;

console.log(`\n─── ${passed} passed, ${failed} failed ───\n`);

if (failed > 0) {
  process.exit(1);
}
