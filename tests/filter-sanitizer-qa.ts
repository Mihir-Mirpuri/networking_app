/**
 * Unit tests for sanitizeLinkedInFilters — industry ID handling.
 *
 * Usage: npx tsx tests/filter-sanitizer-qa.ts
 */

import 'dotenv/config';
import { sanitizeLinkedInFilters } from '../src/lib/services/linkedin-filter-validator';

type Case = {
  name: string;
  input: Record<string, unknown>;
  expect: (r: Record<string, unknown>) => { pass: boolean; detail: string };
};

const CASES: Case[] = [
  {
    name: 'all-valid industry IDs pass through',
    input: { industryIds: ['14', '43'] },
    expect: r => {
      const ok = Array.isArray(r.industryIds)
        && (r.industryIds as string[]).length === 2
        && (r.industryIds as string[]).includes('14')
        && (r.industryIds as string[]).includes('43');
      return { pass: ok, detail: `got industryIds=${JSON.stringify(r.industryIds)}` };
    },
  },
  {
    name: 'unknown industry IDs dropped, valid preserved',
    input: { industryIds: ['14', '99999', 'abc'] },
    expect: r => {
      const arr = r.industryIds as string[] | undefined;
      const ok = Array.isArray(arr) && arr.length === 1 && arr[0] === '14';
      return { pass: ok, detail: `got industryIds=${JSON.stringify(arr)}` };
    },
  },
  {
    name: 'all-invalid industry IDs removes the key',
    input: { industryIds: ['99999', 'abc'] },
    expect: r => {
      const ok = !('industryIds' in r);
      return { pass: ok, detail: `industryIds present=${'industryIds' in r}` };
    },
  },
  {
    name: 'empty industryIds array removes the key',
    input: { industryIds: [] },
    expect: r => {
      const ok = !('industryIds' in r);
      return { pass: ok, detail: `industryIds present=${'industryIds' in r}` };
    },
  },
  {
    name: 'undefined industryIds omitted from output',
    input: {},
    expect: r => {
      const ok = !('industryIds' in r);
      return { pass: ok, detail: `industryIds present=${'industryIds' in r}` };
    },
  },
  {
    name: 'industry IDs pass through alongside function IDs',
    input: { industryIds: ['14'], functionIds: ['11'] },
    expect: r => {
      const ok = Array.isArray(r.industryIds) && (r.industryIds as string[])[0] === '14'
        && Array.isArray(r.functionIds) && (r.functionIds as string[])[0] === '11';
      return { pass: ok, detail: `industryIds=${JSON.stringify(r.industryIds)} functionIds=${JSON.stringify(r.functionIds)}` };
    },
  },
];

function main() {
  let failures = 0;
  console.log('Filter sanitizer QA — industry handling\n');
  for (const c of CASES) {
    const result = sanitizeLinkedInFilters(c.input as Record<string, unknown>) as Record<string, unknown>;
    const { pass, detail } = c.expect(result);
    const status = pass ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${c.name}`);
    if (!pass) {
      failures++;
      console.log(`       input: ${JSON.stringify(c.input)}`);
      console.log(`       output: ${JSON.stringify(result)}`);
      console.log(`       detail: ${detail}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures > 0) process.exit(1);
}

main();
