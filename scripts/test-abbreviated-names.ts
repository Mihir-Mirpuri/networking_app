/**
 * Test the abbreviated name detection and slug extraction logic
 *
 * Run with: npx tsx scripts/test-abbreviated-names.ts
 */

import { isAbbreviatedName, extractNameFromSlug } from '../src/lib/services/linkedin-scraper';

let passed = 0;
let failed = 0;

function assert(actual: unknown, expected: unknown, label: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
    console.log(`    Expected: ${expectedStr}`);
    console.log(`    Actual:   ${actualStr}`);
  }
}

console.log('=== isAbbreviatedName ===');
assert(isAbbreviatedName('G.'), true, '"G." is abbreviated');
assert(isAbbreviatedName('G'), true, '"G" is abbreviated');
assert(isAbbreviatedName('S.'), true, '"S." is abbreviated');
assert(isAbbreviatedName('Gelfer'), false, '"Gelfer" is not abbreviated');
assert(isAbbreviatedName('Smith'), false, '"Smith" is not abbreviated');
assert(isAbbreviatedName('Li'), false, '"Li" is not abbreviated');
assert(isAbbreviatedName('J.'), true, '"J." is abbreviated');

console.log('\n=== extractNameFromSlug — clean slugs ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/sarah-gelfer'),
  { firstName: 'Sarah', lastName: 'Gelfer' },
  'sarah-gelfer'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/john-van-der-berg'),
  { firstName: 'John', lastName: 'Van Der Berg' },
  'john-van-der-berg (multi-part last name)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/alex-abarca'),
  { firstName: 'Alex', lastName: 'Abarca' },
  'alex-abarca'
);

console.log('\n=== extractNameFromSlug — hash stripping ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/brandon-ramos-a8a2071aa'),
  { firstName: 'Brandon', lastName: 'Ramos' },
  'brandon-ramos-a8a2071aa (strips hash)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/linda-j-g-b0b7044'),
  null,
  'linda-j-g-b0b7044 (only initials left after hash strip → null)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/aaron-w-334773a'),
  null,
  'aaron-w-334773a (only initial left → null)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/anabel-t-596ba8113'),
  null,
  'anabel-t-596ba8113 (only initial left → null)'
);

console.log('\n=== extractNameFromSlug — trailing digits ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/aman-patel1'),
  { firstName: 'Aman', lastName: 'Patel' },
  'aman-patel1 (strips trailing digit)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/jordan-wright2'),
  { firstName: 'Jordan', lastName: 'Wright' },
  'jordan-wright2 (strips trailing digit)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/yanan-wang12'),
  { firstName: 'Yanan', lastName: 'Wang' },
  'yanan-wang12 (strips trailing digits)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/jordan-brown3'),
  { firstName: 'Jordan', lastName: 'Brown' },
  'jordan-brown3 (strips trailing digit)'
);

console.log('\n=== extractNameFromSlug — double dashes ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/het--desai'),
  { firstName: 'Het', lastName: 'Desai' },
  'het--desai (handles double dash)'
);

console.log('\n=== extractNameFromSlug — middle initial filtering ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/jessica-m-jimenez'),
  { firstName: 'Jessica', lastName: 'Jimenez' },
  'jessica-m-jimenez (filters middle initial "m")'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/sahil-u-shah'),
  { firstName: 'Sahil', lastName: 'Shah' },
  'sahil-u-shah (filters middle initial "u")'
);

console.log('\n=== extractNameFromSlug — single-segment slugs (no dashes) ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/ashishsdave'),
  null,
  'ashishsdave (no dashes → null)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/juliusnestler'),
  null,
  'juliusnestler (no dashes → null)'
);

console.log('\n=== extractNameFromSlug — non-name slugs ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/ACoAABcd1234'),
  null,
  'ACoAA ID → null'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/12345'),
  null,
  'Numeric ID → null'
);
assert(
  extractNameFromSlug(''),
  null,
  'Empty string → null'
);

console.log('\n=== extractNameFromSlug — all-digit disambiguation ===');
assert(
  extractNameFromSlug('https://www.linkedin.com/in/allyson-a-098'),
  null,
  'allyson-a-098 (098 is all digits, "a" is single char → null)'
);
assert(
  extractNameFromSlug('https://www.linkedin.com/in/shea-c-30781741'),
  null,
  'shea-c-30781741 (hash stripped, only initial left → null)'
);

console.log('\n=== RESULTS ===');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
