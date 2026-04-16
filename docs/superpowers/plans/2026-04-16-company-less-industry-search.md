# Company-less Industry/Function Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable queries like "find people in healthcare" or "fintech PMs" to run against Apify LinkedIn search, without breaking any currently-working query.

**Architecture:** Extend the extraction prompt with a company-less "primary signal" branch (RULE 2A + new RULE 13 for `industry_ids`). Un-strip `industryIds` in the sanitizer, adding a curated allowlist. Extend the filter types, wrapper, and search action to forward `industryIds` through to Apify. Preserve RULE 1 invariant exactly (title queries → `current_job_titles`; discipline queries → `function_ids`; never both).

**Tech Stack:** TypeScript (strict), Next.js 14 App Router, Apify client, Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), Anthropic SDK, `npx tsx` for test harnesses.

**Spec reference:** `docs/superpowers/specs/2026-04-16-company-less-industry-search-design.md`

---

## File Structure

### Modified (production)
| File | Responsibility | Change |
|---|---|---|
| `src/lib/types/linkedin-filters.ts` | Filter interface types | Add `industryIds?: string[]` to `LinkedInFilters` |
| `src/lib/services/linkedin-filter-validator.ts` | Drop unknown filter IDs before Apify | Remove force-strip of `industryIds`; add `VALID_INDUSTRY_IDS` allowlist |
| `src/lib/services/linkedin-search.ts` | Apify wrapper | Add `industryIds` to `LinkedInSearchParams` and forward to actor input |
| `src/app/actions/ai-search.ts` | LLM extraction action | Add `industry_ids` → `industryIds` transform in `convertLinkedInFilters`; add `industry_ids` to the `linkedin_filters` LLM response type |
| `src/app/actions/search.ts` | Search orchestrator | Include `industryIds` in `hasAdvancedFilters` check and log keys |
| `src/lib/prompts/search-extraction-prompt.ts` | Haiku extraction prompt | Rewrite decision tree step 2/2A; add RULE 13; update RULE 1 addendum; update 2 existing examples; add 6 new examples |

### Created (tests only)
| File | Responsibility |
|---|---|
| `tests/filter-sanitizer-qa.ts` | Unit tests for `sanitizeLinkedInFilters` industry handling |
| `tests/prompt-regression-qa.ts` | 30-query baseline diff to prove RULE 1 preservation |
| `tests/company-less-industry-qa.ts` | 13-query test: new capability (replaces `healthcare-query-qa.ts`) |
| `tests/company-less-offtopic-qa.ts` | 8-query test: bare queries stay off_topic |
| `tests/company-less-unsupported-qa.ts` | 4-query test: unsupported criteria still win |
| `tests/apify-industry-id-smoke.ts` | Integration smoke test against real Apify (2 calls, ~$0.20) |
| `tests/company-less-search-integration.ts` | End-to-end: `searchPeopleV2Action` with company-less query |

### Deleted
| File | Reason |
|---|---|
| `tests/healthcare-query-qa.ts` | Replaced by `tests/company-less-industry-qa.ts` — do not delete until new test passes |

---

## Verification strategy

This plan uses `npx tsx` test harnesses (no Jest). Each test prints per-query PASS/FAIL and exits with code 0 (all pass) or 1 (any fail). All tests are runnable standalone via `npx tsx tests/<file>.ts`. Commits follow TDD: failing test first, then implementation, then verify green.

---

## Task 1 — Add `industryIds` to `LinkedInFilters` type

**Files:**
- Modify: `src/lib/types/linkedin-filters.ts`

- [ ] **Step 1: Add `industryIds` to the interface**

Edit `src/lib/types/linkedin-filters.ts`. Add `industryIds?` immediately after `functionIds?`.

Use the Edit tool with:
- `old_string`:
```
  functionIds?: string[];
  companyHeadcount?: string[];
```
- `new_string`:
```
  functionIds?: string[];
  industryIds?: string[];             // Curated subset — see VALID_INDUSTRY_IDS
  companyHeadcount?: string[];
```

Final `LinkedInFilters` interface should look like:

```typescript
export interface LinkedInFilters {
  searchQuery?: string;
  locations?: string[];
  currentCompanies?: string[];        // LinkedIn company URLs
  pastCompanies?: string[];
  schools?: string[];
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  seniorityLevelIds?: string[];
  functionIds?: string[];
  industryIds?: string[];             // Curated subset — see VALID_INDUSTRY_IDS
  companyHeadcount?: string[];
  yearsOfExperienceIds?: string[];
  yearsAtCurrentCompanyIds?: string[];
  recentlyChangedJobs?: boolean;
  // Exclude filters
  excludeLocations?: string[];
  excludeCurrentCompanies?: string[];
  excludeSeniorityLevelIds?: string[];
  excludeFunctionIds?: string[];
}
```

- [ ] **Step 2: Verify types still compile**

Run: `npx tsc --noEmit`
Expected: 0 errors (pre-existing `OnboardingClient.tsx` apostrophe issue acceptable per CLAUDE.md; only new errors fail this step).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/linkedin-filters.ts
git commit -m "types: add industryIds to LinkedInFilters"
```

---

## Task 2 — Sanitizer: add `VALID_INDUSTRY_IDS` allowlist + unit tests

**Files:**
- Modify: `src/lib/services/linkedin-filter-validator.ts`
- Create: `tests/filter-sanitizer-qa.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/filter-sanitizer-qa.ts` with the following content:

```typescript
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx tsx tests/filter-sanitizer-qa.ts`
Expected: FAIL — 3/6 cases fail (cases 1, 2, 6). The current sanitizer force-strips `industryIds`, so inputs that expect valid IDs to survive all fail. Cases 3, 4, 5 pass because they expect the key to be absent.

- [ ] **Step 3: Add `VALID_INDUSTRY_IDS` allowlist**

Edit `src/lib/services/linkedin-filter-validator.ts`. After the `VALID_YEARS_AT_COMPANY_IDS` constant (line 85), add:

```typescript
// Industry IDs — curated subset from
// https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv
// Only includes industries that RULE 13 in search-extraction-prompt.ts emits.
// Each ID is verified against the authoritative CSV. To add more, verify the
// ID in the CSV, then update BOTH this Set AND RULE 13 in the prompt.
export const VALID_INDUSTRY_IDS = new Set<string>([
  '4',    // Software Development
  '10',   // Law Practice
  '12',   // Biotechnology Research
  '14',   // Hospitals and Health Care
  '42',   // Insurance
  '43',   // Financial Services
  '44',   // Real Estate
  '75',   // Government Administration
]);
```

Use the Edit tool with:
- `old_string`: `// Years at Current Company — same 1-5 scale as YoE\nexport const VALID_YEARS_AT_COMPANY_IDS = new Set<string>(['1', '2', '3', '4', '5']);\n\n/**\n * Filter a string array through an allowlist Set, logging any rejected values.`
- `new_string`:
```
// Years at Current Company — same 1-5 scale as YoE
export const VALID_YEARS_AT_COMPANY_IDS = new Set<string>(['1', '2', '3', '4', '5']);

// Industry IDs — curated subset from
// https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv
// Only includes industries that RULE 13 in search-extraction-prompt.ts emits.
// Each ID is verified against the authoritative CSV. To add more, verify the
// ID in the CSV, then update BOTH this Set AND RULE 13 in the prompt.
export const VALID_INDUSTRY_IDS = new Set<string>([
  '4',    // Software Development
  '10',   // Law Practice
  '12',   // Biotechnology Research
  '14',   // Hospitals and Health Care
  '42',   // Insurance
  '43',   // Financial Services
  '44',   // Real Estate
  '75',   // Government Administration
]);

/**
 * Filter a string array through an allowlist Set, logging any rejected values.
```

- [ ] **Step 4: Replace the force-strip with allowlist validation**

In the same file, find the block at lines 214-217:

```typescript
  // ─── Industry (forcibly stripped — no longer supported) ────
  if ('industryIds' in (result as Record<string, unknown>)) {
    delete (result as Record<string, unknown>).industryIds;
  }
```

Use the Edit tool to replace it with:

```typescript
  // ─── Industry ──────────────────────────────────────────────
  if (raw.industryIds?.length) {
    const valid = filterValid(raw.industryIds, VALID_INDUSTRY_IDS, 'industryIds');
    if (valid.length) {
      result.industryIds = valid;
    } else {
      delete result.industryIds;
    }
  } else if ('industryIds' in (result as Record<string, unknown>)) {
    // Empty array or undefined — drop the key so we never send [] to Apify
    delete (result as Record<string, unknown>).industryIds;
  }
```

- [ ] **Step 5: Update the doc comment**

Find lines 9-10 of `linkedin-filter-validator.ts`:
```typescript
 * Industry IDs are NOT validated here because industry-based filtering has
 * been removed from the discovery flow.
```

Replace with:
```typescript
 * Industry IDs are validated against VALID_INDUSTRY_IDS — a curated subset
 * of LinkedIn's industry codes. The prompt's RULE 13 is the contract for
 * which IDs may be emitted.
```

And find line 127:
```typescript
 * - `industryIds` is forcibly stripped — industry-based filtering is disabled
```

Replace with:
```typescript
 * - `industryIds` is validated against VALID_INDUSTRY_IDS (curated subset)
```

- [ ] **Step 6: Run the test — should pass**

Run: `npx tsx tests/filter-sanitizer-qa.ts`
Expected: `6/6 passed`, exit code 0.

- [ ] **Step 7: Verify type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/linkedin-filter-validator.ts tests/filter-sanitizer-qa.ts
git commit -m "sanitizer: allowlist-validate industryIds instead of stripping"
```

---

## Task 3 — Wrapper: forward `industryIds` to Apify actor input

**Files:**
- Modify: `src/lib/services/linkedin-search.ts`

- [ ] **Step 1: Add `industryIds` to `LinkedInSearchParams`**

Edit `src/lib/services/linkedin-search.ts`. Find line 44:
```typescript
  functionIds?: string[];
  profileLanguages?: string[];
```

Replace with:
```typescript
  functionIds?: string[];
  industryIds?: string[];            // Curated subset — validated in sanitizer
  profileLanguages?: string[];
```

- [ ] **Step 2: Add `industryIds` to the `directMappings` forwarder**

In the same file, find the mapping block starting at line 291. After the `['functionIds', 'functionIds'],` line, add `['industryIds', 'industryIds'],`.

Use the Edit tool with:
- `old_string`: `    ['functionIds', 'functionIds'],\n    ['profileLanguages', 'profileLanguages'],`
- `new_string`: `    ['functionIds', 'functionIds'],\n    ['industryIds', 'industryIds'],\n    ['profileLanguages', 'profileLanguages'],`

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/linkedin-search.ts
git commit -m "linkedin-search: forward industryIds to Apify actor input"
```

---

## Task 4 — `convertLinkedInFilters`: handle `industry_ids` → `industryIds` transform

**Files:**
- Modify: `src/app/actions/ai-search.ts`

- [ ] **Step 1: Add `industry_ids` to the `LLMResponse.linkedin_filters` type**

Edit `src/app/actions/ai-search.ts`. Find line 72:
```typescript
    function_ids?: string[];
    company_headcount?: string[];
```

Replace with:
```typescript
    function_ids?: string[];
    industry_ids?: string[];
    company_headcount?: string[];
```

- [ ] **Step 2: Add the conversion line in `convertLinkedInFilters`**

In the same file, find line 126:
```typescript
  if (raw.function_ids?.length) result.functionIds = raw.function_ids;
  if (raw.company_headcount?.length) result.companyHeadcount = raw.company_headcount;
```

Replace with:
```typescript
  if (raw.function_ids?.length) result.functionIds = raw.function_ids;
  if (raw.industry_ids?.length) result.industryIds = raw.industry_ids;
  if (raw.company_headcount?.length) result.companyHeadcount = raw.company_headcount;
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/ai-search.ts
git commit -m "ai-search: convert industry_ids snake_case to industryIds"
```

---

## Task 5 — Search action: include `industryIds` in `hasAdvancedFilters`

**Files:**
- Modify: `src/app/actions/search.ts`

- [ ] **Step 1: Add `industryIds` to the advanced filter check**

Edit `src/app/actions/search.ts`. Find line 513-521:

```typescript
    const hasAdvancedFilters = !!(
      linkedInFilters.seniorityLevelIds?.length ||
      linkedInFilters.companyHeadcount?.length ||
      linkedInFilters.functionIds?.length ||
      linkedInFilters.yearsOfExperienceIds?.length ||
      linkedInFilters.pastCompanies?.length ||
      linkedInFilters.pastJobTitles?.length ||
      linkedInFilters.recentlyChangedJobs
    );
```

Replace with:

```typescript
    const hasAdvancedFilters = !!(
      linkedInFilters.seniorityLevelIds?.length ||
      linkedInFilters.companyHeadcount?.length ||
      linkedInFilters.functionIds?.length ||
      linkedInFilters.industryIds?.length ||
      linkedInFilters.yearsOfExperienceIds?.length ||
      linkedInFilters.pastCompanies?.length ||
      linkedInFilters.pastJobTitles?.length ||
      linkedInFilters.recentlyChangedJobs
    );
```

- [ ] **Step 2: Add `industryIds` to the `advancedFilterKeys` log list**

In the same file, find the array of advanced filter key names around line 569-576:

```typescript
        advancedFilterKeys: Object.entries(linkedInFilters)
          .filter(
            ([k, v]) =>
              [
                'seniorityLevelIds',
                'companyHeadcount',
                'functionIds',
                'yearsOfExperienceIds',
                'pastCompanies',
                'pastJobTitles',
                'recentlyChangedJobs',
              ].includes(k) && v
          )
          .map(([k]) => k),
```

Replace with:

```typescript
        advancedFilterKeys: Object.entries(linkedInFilters)
          .filter(
            ([k, v]) =>
              [
                'seniorityLevelIds',
                'companyHeadcount',
                'functionIds',
                'industryIds',
                'yearsOfExperienceIds',
                'pastCompanies',
                'pastJobTitles',
                'recentlyChangedJobs',
              ].includes(k) && v
          )
          .map(([k]) => k),
```

- [ ] **Step 3: Add a clarifying comment on the company-less branch**

Find line 489:
```typescript
    if (dbFilters.company && (!linkedInFilters.currentCompanies || linkedInFilters.currentCompanies.length === 0)) {
```

Insert a comment immediately above it. Use the Edit tool with:
- `old_string`: `    // Resolve LinkedIn company URL if not already provided. Required for\n    // accurate Apify filtering — without it, the scraper falls back to\n    // text-matching the company name in profile bios.\n    if (dbFilters.company && (!linkedInFilters.currentCompanies || linkedInFilters.currentCompanies.length === 0)) {`
- `new_string`: `    // Resolve LinkedIn company URL if not already provided. Required for\n    // accurate Apify filtering — without it, the scraper falls back to\n    // text-matching the company name in profile bios.\n    // Company-less industry/function queries skip this block and rely on\n    // linkedInFilters.industryIds / functionIds alone (advanced path).\n    if (dbFilters.company && (!linkedInFilters.currentCompanies || linkedInFilters.currentCompanies.length === 0)) {`

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/search.ts
git commit -m "search: route industryIds queries through advanced path"
```

---

## Task 6 — Prompt: snapshot current behavior (regression baseline)

Before editing the prompt, snapshot its current output across 30 queries. The snapshot is the ground truth for proving RULE 1 is preserved.

**Files:**
- Create: `tests/prompt-regression-qa.ts`
- Create: `tests/prompt-regression-baseline.json` (generated by first run)

- [ ] **Step 1: Write the regression harness**

Create `tests/prompt-regression-qa.ts`:

```typescript
/**
 * Prompt regression QA.
 *
 * Step A (initial run, before prompt changes): snapshot current output to
 * tests/prompt-regression-baseline.json.
 * Step B (after prompt changes): compare against the baseline; any diff fails.
 *
 * Usage:
 *   npx tsx tests/prompt-regression-qa.ts --snapshot   # create baseline
 *   npx tsx tests/prompt-regression-qa.ts              # compare
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

const QUERIES: string[] = [
  'software engineers at Google',
  'PMs at Stripe',
  'senior engineers at Uber',
  'staff engineers at Stripe',
  'directors at Google',
  'designers at Figma',
  'lawyers at Cravath',
  'analysts at the FBI',
  'people at McKinsey',
  'MIT grads at Stripe',
  'Brandon Rudy, director of broadcasting at Texas A&M',
  'consultants at MBB',
  'PhD data scientists at Google',
  'remote engineers at Stripe',
  'ML engineers making $200k+ in San Francisco',
  'CFA holders at Goldman Sachs',
  'CPA accountants at Deloitte',
  'engineers at Series B startups in Austin',
  'people who know Python at Stripe',
  'I am looking for internships as a finance analyst in chicago',
  'trying to break into product management at Stripe',
  'how is the weather?',
  'John',
  'growth PMs at Airbnb',
  'quants at Jane Street',
  'TPMs at Meta',
  'ex-Google engineers at Anthropic',
  'recently joined PMs at OpenAI',
  'founders of AI startups',
  'CXOs at Salesforce',
];

const BASELINE_PATH = path.join(__dirname, 'prompt-regression-baseline.json');

type Snapshot = {
  query: string;
  status: string;
  linkedin_filters: Record<string, unknown>;
  filters: Record<string, unknown>;
};

async function runOne(client: Anthropic, query: string): Promise<Snapshot | { query: string; error: string }> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0, // deterministic: critical for diff stability
      system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `New user message: ${query}` }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      query,
      status: String(parsed.status ?? ''),
      linkedin_filters: (parsed.linkedin_filters ?? {}) as Record<string, unknown>,
      filters: (parsed.filters ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    return { query, error: err instanceof Error ? err.message : String(err) };
  }
}

async function snapshot(client: Anthropic) {
  console.log(`Snapshotting ${QUERIES.length} queries…`);
  const results: Snapshot[] = [];
  for (const q of QUERIES) {
    const r = await runOne(client, q);
    if ('error' in r) throw new Error(`Snapshot failed on "${q}": ${r.error}`);
    results.push(r);
    console.log(`  [${r.status.padEnd(16)}] ${q}`);
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2));
  console.log(`\nBaseline written to ${BASELINE_PATH}`);
}

function canonicalize(obj: unknown): string {
  // Deterministic JSON: sort keys, drop null/undefined/empty-array values
  if (obj === null || obj === undefined) return 'null';
  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'null';
    return `[${obj.map(canonicalize).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as object)
      .filter(k => {
        const v = (obj as Record<string, unknown>)[k];
        return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
      })
      .sort();
    return `{${keys.map(k => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k])).join(',')}}`;
  }
  return JSON.stringify(obj);
}

async function compare(client: Anthropic) {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`No baseline at ${BASELINE_PATH}. Run with --snapshot first.`);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as Snapshot[];
  const baselineByQuery = new Map(baseline.map(b => [b.query, b]));

  let failures = 0;
  for (const q of QUERIES) {
    const expected = baselineByQuery.get(q);
    if (!expected) {
      console.log(`[SKIP ] (not in baseline) ${q}`);
      continue;
    }
    const actual = await runOne(client, q);
    if ('error' in actual) {
      failures++;
      console.log(`[FAIL ] ${q} — threw ${actual.error}`);
      continue;
    }
    const expStatus = expected.status;
    const actStatus = actual.status;
    const expFilt = canonicalize(expected.linkedin_filters);
    const actFilt = canonicalize(actual.linkedin_filters);
    const expTop  = canonicalize(expected.filters);
    const actTop  = canonicalize(actual.filters);
    const ok = expStatus === actStatus && expFilt === actFilt && expTop === actTop;
    if (ok) {
      console.log(`[PASS ] ${q}`);
    } else {
      failures++;
      console.log(`[FAIL ] ${q}`);
      if (expStatus !== actStatus) console.log(`        status: ${expStatus} -> ${actStatus}`);
      if (expFilt !== actFilt)     console.log(`        linkedin_filters: ${expFilt}\n                    -> ${actFilt}`);
      if (expTop !== actTop)       console.log(`        filters: ${expTop}\n              -> ${actTop}`);
    }
  }
  console.log(`\n${QUERIES.length - failures}/${QUERIES.length} passed`);
  if (failures > 0) process.exit(1);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  if (process.argv.includes('--snapshot')) {
    await snapshot(client);
  } else {
    await compare(client);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Snapshot current behavior BEFORE any prompt edits**

Run: `npx tsx tests/prompt-regression-qa.ts --snapshot`
Expected: `Baseline written to .../tests/prompt-regression-baseline.json`. 30 queries processed.

**CRITICAL:** Do this step BEFORE Task 7 (prompt edits). The baseline captures current behavior. Any post-edit regression is measured against this file.

- [ ] **Step 3: Commit the baseline**

```bash
git add tests/prompt-regression-qa.ts tests/prompt-regression-baseline.json
git commit -m "tests: add prompt regression baseline for 30 currently-working queries"
```

---

## Task 7 — Prompt: rewrite decision tree step 2 + RULE 1 addendum

**Files:**
- Modify: `src/lib/prompts/search-extraction-prompt.ts`

This is a string-only edit; no production code logic changes. All behavior changes live in the prompt text.

- [ ] **Step 1: Rewrite decision tree step 2**

Edit `src/lib/prompts/search-extraction-prompt.ts`. Find lines 83-84:

```typescript
2. Does the user name a SPECIFIC company (real, named entity)?
   YES -> Go to 2.5.
   NO -> Go to 3.
```

Replace with:

```typescript
2. Does the user name a SPECIFIC company (real, named entity)?
   YES -> Go to 2.5.
   NO  -> Go to 2A (company-less filter check).

2A. COMPANY-LESS FILTER CHECK
    Does the query contain at least one PRIMARY SIGNAL from this list?
    A primary signal is a role/discipline/industry/school — NOT a
    location or seniority alone.
    PRIMARY SIGNALS (need >=1):
    - Discipline word (engineers, designers, salespeople, healthcare
      workers, lawyers, marketers, recruiters, finance people,
      consultants, researchers, biz dev) -> function_ids (RULE 1)
    - Named job title (Software Engineer, Product Manager, Doctor,
      Nurse, Lawyer, Data Scientist, etc.) -> current_job_titles (RULE 1)
    - Industry/sector term (fintech, biotech, healthtech, etc.)
      -> industry_ids (RULE 13)
    - School (alumni queries, e.g. "MIT grads", "Stanford alumni")
      -> schools
    MODIFIERS (may be combined with a primary signal, cannot stand alone):
    - location, seniority, company_headcount, years_of_experience,
      recently_changed_jobs

    If ANY primary signal present:
      -> Go to 2.5 (unsupported-criteria check) with company=null.
         If no unsupported criteria: status="ready". Emit the extracted
         filters. STOP.
    If NO primary signal (e.g. "people in Austin" = location only,
    or "find people" = nothing):
      -> Go to 3.
```

Use the Edit tool with the literal strings above as `old_string` / `new_string`.

- [ ] **Step 2: Add company-less addendum to RULE 1**

In the same file, find line 121 (the "Title precision note"):

```typescript
Title precision note: Distinctive titles ("Data Scientist", "Designer", "Analyst") match tightly (~100%). Common-substring titles ("Product Manager") leak ~15% to variants like "Product Marketing Manager". This is expected.
```

Immediately after this line (before RULE 2), add:

```typescript

Company-less discipline queries: When the query has no company, emit
function_ids for pure discipline words or current_job_titles for named
roles — follow the title-vs-discipline split above unchanged. Do NOT
invent a company. filters.company stays null. NEVER emit both for the
same role.
  - "find people in healthcare" -> function_ids: ["11"], role: null, company: null, role_specificity: "broad"
  - "healthcare workers" -> function_ids: ["11"], role: null, company: null, role_specificity: "broad"
  - "doctors" -> current_job_titles: ["Doctor"], company: null, role_specificity: "standard" (named title)
  - "nurses in NYC" -> current_job_titles: ["Nurse"], locations: ["New York"], company: null
  - "engineers in Austin" -> function_ids: ["8"], locations: ["Austin"], company: null, role_specificity: "broad"
  - "designers in SF" -> function_ids: ["3"], locations: ["San Francisco"], company: null, role_specificity: "broad"
```

Use the Edit tool with:
- `old_string`: `Title precision note: Distinctive titles ("Data Scientist", "Designer", "Analyst") match tightly (~100%). Common-substring titles ("Product Manager") leak ~15% to variants like "Product Marketing Manager". This is expected.\n\nRULE 2 -- LOCATION:`
- `new_string`:
```
Title precision note: Distinctive titles ("Data Scientist", "Designer", "Analyst") match tightly (~100%). Common-substring titles ("Product Manager") leak ~15% to variants like "Product Marketing Manager". This is expected.

Company-less discipline queries: When the query has no company, emit
function_ids for pure discipline words or current_job_titles for named
roles — follow the title-vs-discipline split above unchanged. Do NOT
invent a company. filters.company stays null. NEVER emit both for the
same role.
  - "find people in healthcare" -> function_ids: ["11"], role: null, company: null, role_specificity: "broad"
  - "healthcare workers" -> function_ids: ["11"], role: null, company: null, role_specificity: "broad"
  - "doctors" -> current_job_titles: ["Doctor"], company: null, role_specificity: "standard" (named title)
  - "nurses in NYC" -> current_job_titles: ["Nurse"], locations: ["New York"], company: null
  - "engineers in Austin" -> function_ids: ["8"], locations: ["Austin"], company: null, role_specificity: "broad"
  - "designers in SF" -> function_ids: ["3"], locations: ["San Francisco"], company: null, role_specificity: "broad"

RULE 2 -- LOCATION:
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/search-extraction-prompt.ts
git commit -m "prompt: add company-less branch (step 2A) and RULE 1 addendum"
```

---

## Task 8 — Prompt: add RULE 13 (industry_ids) and update unsupported list

**Files:**
- Modify: `src/lib/prompts/search-extraction-prompt.ts`

- [ ] **Step 1: Update the `linkedin_filters` schema to include `industry_ids`**

Find line 33 of `src/lib/prompts/search-extraction-prompt.ts`:

```typescript
    "function_ids": string[]|null,
    "company_headcount": string[]|null,
```

Replace with:

```typescript
    "function_ids": string[]|null,
    "industry_ids": string[]|null,
    "company_headcount": string[]|null,
```

- [ ] **Step 2: Update the UNSUPPORTED CRITERIA LIST**

Find line 198:

```typescript
- INDUSTRY_SECTOR: fintech, healthtech, edtech, biotech, cleantech, proptech, insurtech, agtech, martech, govtech, legaltech, regtech
- SKILLS_TECHNOLOGIES: Python, Kubernetes, React, machine learning, terraform, or any specific skill/technology/framework/language
```

Replace with:

```typescript
- INDUSTRY_SECTOR (partial — see RULE 13): Industry terms that map in RULE 13 (fintech, biotech, healthtech, software/SaaS, legaltech, insurtech, proptech, govtech) are SUPPORTED via industry_ids. Any other industry word (edtech, cleantech, agtech, martech, regtech, etc.) remains UNSUPPORTED.
- SKILLS_TECHNOLOGIES: Python, Kubernetes, React, machine learning, terraform, or any specific skill/technology/framework/language
```

- [ ] **Step 3: Update the reformulation table entry**

Find line 223:

```typescript
| fintech, biotech, industry terms | Drop | None |
```

Replace with:

```typescript
| industry terms NOT in RULE 13 (edtech, agtech, martech, cleantech, regtech) | Drop | None |
| industry terms in RULE 13 (fintech, biotech, healthtech, SaaS, legaltech, insurtech, proptech, govtech) | Use industry_ids | See RULE 13 |
```

- [ ] **Step 4: Add RULE 13 after RULE 12**

Find line 228:

```typescript
RULE 12 -- FILTER PERSISTENCE:
- If previous filters exist and user doesn't mention them, KEEP previous values.
- "try banks instead" -> replace company entirely.

=== COMPANY NAME RULES ===
```

Replace with:

```typescript
RULE 12 -- FILTER PERSISTENCE:
- If previous filters exist and user doesn't mention them, KEEP previous values.
- "try banks instead" -> replace company entirely.

RULE 13 -- INDUSTRY IDS (industry_ids):
  Use for industry/sector words when they are the primary filter signal.
  Supported mappings (only these IDs — never invent new ones):
    "healthcare" / "healthtech" (as industry, not profession) -> "14" (Hospitals and Health Care)
    "fintech" / "financial services" -> "43" (Financial Services)
    "biotech" -> "12" (Biotechnology Research)
    "software" / "SaaS" / "software companies" -> "4" (Software Development)
    "legaltech" / "law firms" -> "10" (Law Practice)
    "insurtech" -> "42" (Insurance)
    "proptech" / "real estate tech" -> "44" (Real Estate)
    "govtech" / "government" (as sector) -> "75" (Government Administration)

  USAGE:
  - Prefer function_ids for DISCIPLINE queries ("people in healthcare" = profession).
  - Prefer industry_ids for COMPANY-SECTOR queries ("PMs at fintech companies").
  - Ambiguous case ("healthcare workers"): use function_ids ["11"].
  - NEVER invent numeric IDs. Any industry term not above -> status="unsupported".
  - Never pair industry_ids and function_ids for the same concept (don't emit both "14" and "11" for "healthcare").

=== COMPANY NAME RULES ===
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/search-extraction-prompt.ts
git commit -m "prompt: add RULE 13 for industry_ids with 8 verified mappings"
```

---

## Task 9 — Prompt: update existing examples + add 6 new examples

**Files:**
- Modify: `src/lib/prompts/search-extraction-prompt.ts`

- [ ] **Step 1: Update the "fintech PMs in NYC" example**

Find line 340:

```typescript
User: "fintech PMs in NYC"
{"status":"unsupported","confidence":"high","filters":{"company":null,"role":"Product Manager","university":null,"location":"New York"},"linkedin_filters":{},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":["fintech (industry)"],"suggested_alternative":{"label":"Product Managers in New York","filters":{"company":null,"role":"Product Manager","university":null,"location":"New York"},"linkedin_filters":{"current_job_titles":["Product Manager"],"locations":["New York"]}},"selectables":[],"suggested_searches":[],"message":"I can't filter by industry (fintech). Here's the closest search I can run:"}
```

Replace with:

```typescript
User: "fintech PMs in NYC"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Product Manager","university":null,"location":"New York"},"linkedin_filters":{"current_job_titles":["Product Manager"],"industry_ids":["43"],"locations":["New York"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Product Managers in Financial Services in New York"}
```

- [ ] **Step 2: Update the "biotech engineers in Boston" example**

Find line 343:

```typescript
User: "biotech engineers in Boston"
{"status":"unsupported","confidence":"high","filters":{"company":null,"role":"Engineer","university":null,"location":"Boston"},"linkedin_filters":{},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":["biotech (industry)"],"suggested_alternative":{"label":"Engineers in Boston","filters":{"company":null,"role":"Engineer","university":null,"location":"Boston"},"linkedin_filters":{"function_ids":["8"],"locations":["Boston"]}},"selectables":[],"suggested_searches":[],"message":"I can't filter by industry (biotech). Here's the closest search I can run:"}
```

Replace with:

```typescript
User: "biotech engineers in Boston"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":"Boston"},"linkedin_filters":{"function_ids":["8"],"industry_ids":["12"],"locations":["Boston"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Engineers in Biotechnology in Boston"}
```

- [ ] **Step 3: Add 6 new examples at the end of the examples section**

Find the last example in the file (the `biotech engineers in Boston` one, at the very end — line 343+):

```typescript
User: "biotech engineers in Boston"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":"Boston"},"linkedin_filters":{"function_ids":["8"],"industry_ids":["12"],"locations":["Boston"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Engineers in Biotechnology in Boston"}`;
```

Replace with (adding 6 examples before the closing backtick):

```typescript
User: "biotech engineers in Boston"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":"Boston"},"linkedin_filters":{"function_ids":["8"],"industry_ids":["12"],"locations":["Boston"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Engineers in Biotechnology in Boston"}

User: "find people in healthcare"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{"function_ids":["11"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[{"label":"Doctors at Kaiser","company":"Kaiser","role":"Doctor"},{"label":"Nurses at Mass General","company":"Mass General","role":"Nurse"}],"message":"Searching for people in Healthcare"}

User: "doctors"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Doctor","university":null,"location":null},"linkedin_filters":{"current_job_titles":["Doctor"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Doctors"}

User: "nurses in New York"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Nurse","university":null,"location":"New York"},"linkedin_filters":{"current_job_titles":["Nurse"],"locations":["New York"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Nurses in New York"}

User: "engineers in Austin"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":"Austin"},"linkedin_filters":{"function_ids":["8"],"locations":["Austin"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[{"label":"Engineers at Tesla","company":"Tesla","role":"Software Engineer"}],"message":"Searching for Engineers in Austin"}

User: "healthcare PMs"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Product Manager","university":null,"location":null},"linkedin_filters":{"current_job_titles":["Product Manager"],"industry_ids":["14"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Product Managers in Healthcare"}

User: "find people"
{"status":"off_topic","confidence":"high","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Who are you looking for? Try 'software engineers at Google' or 'nurses in NYC'."}`;
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/search-extraction-prompt.ts
git commit -m "prompt: add 6 company-less examples, update 2 existing examples"
```

---

## Task 10 — Run prompt regression test (must stay green)

**Files:** (no edits — verification only)

- [ ] **Step 1: Re-run the regression harness against the baseline**

Run: `npx tsx tests/prompt-regression-qa.ts`
Expected: `30/30 passed`, exit code 0.

- [ ] **Step 2: If any query regresses, stop and fix the prompt**

Typical regression: a currently-working query like `designers at Figma` now drops `function_ids`. To diagnose, inspect the diff output and adjust RULE 1 / step 2.5 ordering. Do not edit the baseline — the baseline is the contract.

If a regression is intentional (e.g. a test query was ambiguous), discuss with the user before updating the baseline.

Once green, continue.

---

## Task 11 — New capability test: company-less industry/function queries

**Files:**
- Create: `tests/company-less-industry-qa.ts`

- [ ] **Step 1: Write the test harness**

Create `tests/company-less-industry-qa.ts`:

```typescript
/**
 * Verifies that the extractor prompt + Haiku produce ready status with
 * the right linkedin_filters for company-less industry / function queries.
 *
 * Usage: npx tsx tests/company-less-industry-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  status: 'ready';
  mustHave: (linkedin: Record<string, unknown>, top: Record<string, unknown>) => string | null;
};

const CASES: Case[] = [
  {
    query: 'find people in healthcare',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      if (!f.includes('11')) return `function_ids missing "11"; got ${JSON.stringify(f)}`;
      if (l.current_job_titles) return `current_job_titles should be absent for discipline-only query`;
      return null;
    },
  },
  {
    query: 'healthcare workers',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      return f.includes('11') ? null : `function_ids missing "11"; got ${JSON.stringify(f)}`;
    },
  },
  {
    query: 'doctors',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      if (!t.some(x => /doctor/i.test(x))) return `current_job_titles missing Doctor; got ${JSON.stringify(t)}`;
      if (l.function_ids) return `RULE 1 violation: function_ids present alongside named title`;
      return null;
    },
  },
  {
    query: 'nurses in New York',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!t.some(x => /nurse/i.test(x))) return `current_job_titles missing Nurse`;
      if (!loc.some(x => /new york/i.test(x))) return `locations missing New York`;
      return null;
    },
  },
  {
    query: 'healthcare PMs',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      if (!t.some(x => /product manager/i.test(x))) return `current_job_titles missing Product Manager`;
      if (!ind.includes('14')) return `industry_ids missing "14" (healthcare); got ${JSON.stringify(ind)}`;
      if (l.function_ids) return `Should NOT emit function_ids for "PMs" in a healthcare industry query`;
      return null;
    },
  },
  {
    query: 'find me people in healthcare in New York',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('11')) return `function_ids missing "11"`;
      if (!loc.some(x => /new york/i.test(x))) return `locations missing New York`;
      return null;
    },
  },
  {
    query: 'engineers in Austin',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('8')) return `function_ids missing "8"`;
      if (!loc.some(x => /austin/i.test(x))) return `locations missing Austin`;
      return null;
    },
  },
  {
    query: 'designers in SF',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('3')) return `function_ids missing "3"`;
      if (!loc.some(x => /san francisco/i.test(x))) return `locations missing San Francisco`;
      return null;
    },
  },
  {
    query: 'salespeople in NYC',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      return f.includes('25') ? null : `function_ids missing "25"; got ${JSON.stringify(f)}`;
    },
  },
  {
    query: 'fintech PMs',
    status: 'ready',
    mustHave: l => {
      const t = (l.current_job_titles ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      if (!t.some(x => /product manager/i.test(x))) return `current_job_titles missing Product Manager`;
      if (!ind.includes('43')) return `industry_ids missing "43"`;
      return null;
    },
  },
  {
    query: 'biotech engineers in Boston',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const ind = (l.industry_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('8')) return `function_ids missing "8"`;
      if (!ind.includes('12')) return `industry_ids missing "12"`;
      if (!loc.some(x => /boston/i.test(x))) return `locations missing Boston`;
      return null;
    },
  },
  {
    query: 'lawyers in Chicago',
    status: 'ready',
    mustHave: l => {
      const f = (l.function_ids ?? []) as string[];
      const loc = (l.locations ?? []) as string[];
      if (!f.includes('14')) return `function_ids missing "14"`;
      if (!loc.some(x => /chicago/i.test(x))) return `locations missing Chicago`;
      return null;
    },
  },
  {
    query: 'MIT grads',
    status: 'ready',
    mustHave: l => {
      const s = (l.schools ?? []) as string[];
      return s.some(x => /massachusetts institute of technology/i.test(x))
        ? null
        : `schools missing MIT expansion; got ${JSON.stringify(s)}`;
    },
  },
];

async function runOne(client: Anthropic, query: string) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0,
    system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `New user message: ${query}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  let failures = 0;
  console.log(`Company-less industry/function QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (status !== c.status) {
        failures++;
        console.log(`[FAIL ] "${c.query}" — status=${status}, expected ${c.status}`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
        continue;
      }
      const linkedin = (parsed.linkedin_filters ?? {}) as Record<string, unknown>;
      const top = (parsed.filters ?? {}) as Record<string, unknown>;
      const problem = c.mustHave(linkedin, top);
      if (problem) {
        failures++;
        console.log(`[FAIL ] "${c.query}" — ${problem}`);
        console.log(`        linkedin_filters=${JSON.stringify(linkedin)}`);
      } else {
        console.log(`[PASS ] "${c.query}"`);
      }
    } catch (err) {
      failures++;
      console.log(`[FAIL ] "${c.query}" — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run and verify all 13 cases pass**

Run: `npx tsx tests/company-less-industry-qa.ts`
Expected: `13/13 passed`, exit code 0.

If any case fails, inspect the failure and adjust either the prompt (if the Haiku output is genuinely wrong per our design) or the test assertion (if our assertion was too strict).

- [ ] **Step 3: Commit**

```bash
git add tests/company-less-industry-qa.ts
git commit -m "tests: assert company-less industry/function queries return ready"
```

---

## Task 12 — Off-topic guard test: bare queries must not trigger broad scrapes

**Files:**
- Create: `tests/company-less-offtopic-qa.ts`

- [ ] **Step 1: Write the test**

Create `tests/company-less-offtopic-qa.ts`:

```typescript
/**
 * Verifies that bare queries without a primary signal stay off_topic
 * (or needs_selection), never ready. Protects the Apify cost budget
 * from runaway broad scrapes.
 *
 * Usage: npx tsx tests/company-less-offtopic-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  allowedStatuses: string[];
};

const CASES: Case[] = [
  { query: 'find people', allowedStatuses: ['off_topic'] },
  { query: 'hello', allowedStatuses: ['off_topic'] },
  { query: 'what\'s for lunch', allowedStatuses: ['off_topic'] },
  { query: 'help', allowedStatuses: ['off_topic'] },
  { query: 'people I might like', allowedStatuses: ['off_topic'] },
  { query: 'people in Austin', allowedStatuses: ['off_topic'] },
  { query: 'senior people', allowedStatuses: ['off_topic'] },
  { query: 'startups', allowedStatuses: ['needs_selection', 'off_topic'] },
];

async function runOne(client: Anthropic, query: string) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0,
    system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `New user message: ${query}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  let failures = 0;
  console.log(`Company-less off-topic guard QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (c.allowedStatuses.includes(status)) {
        console.log(`[PASS ] "${c.query}" -> ${status}`);
      } else {
        failures++;
        console.log(`[FAIL ] "${c.query}" -> ${status} (allowed: ${c.allowedStatuses.join(', ')})`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
      }
    } catch (err) {
      failures++;
      console.log(`[FAIL ] "${c.query}" — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run and verify all 8 cases pass**

Run: `npx tsx tests/company-less-offtopic-qa.ts`
Expected: `8/8 passed`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add tests/company-less-offtopic-qa.ts
git commit -m "tests: assert bare queries without primary signal stay off_topic"
```

---

## Task 13 — Unsupported-precedence test: unsupported criteria still win

**Files:**
- Create: `tests/company-less-unsupported-qa.ts`

- [ ] **Step 1: Write the test**

Create `tests/company-less-unsupported-qa.ts`:

```typescript
/**
 * Verifies that hard-unsupported criteria (remote, PhD, salary, CFA, etc.)
 * still take precedence — even when a function/industry word is present.
 *
 * Usage: npx tsx tests/company-less-unsupported-qa.ts
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_EXTRACTION_SYSTEM_PROMPT } from '../src/lib/prompts/search-extraction-prompt';

type Case = {
  query: string;
  mustHaveUnsupported: RegExp;
};

const CASES: Case[] = [
  { query: 'remote healthcare workers', mustHaveUnsupported: /remote/i },
  { query: 'healthcare workers with PhD', mustHaveUnsupported: /phd/i },
  { query: '$200k healthcare PMs', mustHaveUnsupported: /salary|\$/i },
  { query: 'CFA holders in finance', mustHaveUnsupported: /cfa/i },
];

async function runOne(client: Anthropic, query: string) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature: 0,
    system: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `New user message: ${query}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  let failures = 0;
  console.log(`Unsupported precedence QA — ${CASES.length} queries\n`);
  for (const c of CASES) {
    try {
      const parsed = await runOne(client, c.query);
      const status = String(parsed.status);
      if (status !== 'unsupported') {
        failures++;
        console.log(`[FAIL ] "${c.query}" -> ${status}; expected unsupported`);
        console.log(`        linkedin_filters=${JSON.stringify(parsed.linkedin_filters)}`);
        continue;
      }
      const criteria = (parsed.unsupported_criteria ?? []) as string[];
      const matched = criteria.some(x => c.mustHaveUnsupported.test(x));
      if (!matched) {
        failures++;
        console.log(`[FAIL ] "${c.query}" unsupported_criteria=${JSON.stringify(criteria)}, expected regex ${c.mustHaveUnsupported}`);
      } else {
        console.log(`[PASS ] "${c.query}" -> unsupported (criteria=${JSON.stringify(criteria)})`);
      }
    } catch (err) {
      failures++;
      console.log(`[FAIL ] "${c.query}" — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run and verify all 4 cases pass**

Run: `npx tsx tests/company-less-unsupported-qa.ts`
Expected: `4/4 passed`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add tests/company-less-unsupported-qa.ts
git commit -m "tests: assert unsupported criteria still win over industry signal"
```

---

## Task 14 — Apify smoke test: confirm `industryIds` is accepted

**Files:**
- Create: `tests/apify-industry-id-smoke.ts`

**Cost:** $0.20 total (2 Apify Short pages at $0.10 each). Run once to confirm the actor accepts `industryIds`; re-run only when the actor version changes.

- [ ] **Step 1: Write the smoke test**

Create `tests/apify-industry-id-smoke.ts`:

```typescript
/**
 * Smoke test: does harvestapi/linkedin-profile-search accept industryIds
 * and return relevant profiles?
 *
 * Cost: 2 Apify Short pages = $0.20. Run rarely.
 *
 * Usage: npx tsx tests/apify-industry-id-smoke.ts
 */

import 'dotenv/config';
import { searchLinkedInShort } from '../src/lib/services/linkedin-search';

async function main() {
  let failures = 0;

  console.log('Case 1: industryIds=["14"] (Hospitals & Health Care) in New York');
  try {
    const r1 = await searchLinkedInShort({
      industryIds: ['14'],
      locations: ['New York'],
      maxItems: 5,
      takePages: 1,
    });
    if (r1.profiles.length === 0) {
      failures++;
      console.log(`  [FAIL ] 0 profiles returned`);
    } else {
      console.log(`  [PASS ] ${r1.profiles.length} profiles returned`);
      for (const p of r1.profiles.slice(0, 3)) {
        console.log(`          - ${p.fullName} — ${p.role} @ ${p.company} (${p.city ?? '?'})`);
      }
    }
  } catch (err) {
    failures++;
    console.log(`  [FAIL ] threw: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\nCase 2: industryIds=["4"] (Software Development) in San Francisco');
  try {
    const r2 = await searchLinkedInShort({
      industryIds: ['4'],
      locations: ['San Francisco'],
      maxItems: 5,
      takePages: 1,
    });
    if (r2.profiles.length === 0) {
      failures++;
      console.log(`  [FAIL ] 0 profiles returned`);
    } else {
      console.log(`  [PASS ] ${r2.profiles.length} profiles returned`);
      for (const p of r2.profiles.slice(0, 3)) {
        console.log(`          - ${p.fullName} — ${p.role} @ ${p.company} (${p.city ?? '?'})`);
      }
    }
  } catch (err) {
    failures++;
    console.log(`  [FAIL ] threw: ${err instanceof Error ? err.message : err}`);
  }

  if (failures > 0) process.exit(1);
  console.log('\nAll smoke cases passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run against real Apify**

Run: `npx tsx tests/apify-industry-id-smoke.ts`
Expected: both cases return ≥1 profile each. Log prints 3 sample profiles per case.

**IMPORTANT:** This actually spends $0.20. Only run once unless debugging.

- [ ] **Step 3: Commit**

```bash
git add tests/apify-industry-id-smoke.ts
git commit -m "tests: smoke test confirming Apify accepts industryIds (Short mode)"
```

---

## Task 15 — End-to-end integration test: `searchPeopleV2Action` with company-less query

**Files:**
- Create: `tests/company-less-search-integration.ts`

**Cost:** $0.10 (one Apify Short page).

- [ ] **Step 1: Write the integration test**

Create `tests/company-less-search-integration.ts`:

```typescript
/**
 * Integration test: end-to-end company-less industry query through
 * searchPeopleV2Action. Proves the advanced-path routing works and
 * Apify returns real profiles.
 *
 * Cost: ~$0.10 per run (one Apify Short page).
 * Usage: npx tsx tests/company-less-search-integration.ts
 *
 * Requires a valid test user in the DB. If no userId is passed, runs
 * the anonymous code path (still exercises the filter routing).
 */

import 'dotenv/config';
import { searchPeopleV2Action, type SearchInputV2 } from '../src/app/actions/search';

async function main() {
  let failures = 0;

  const input: SearchInputV2 = {
    query: 'find people in healthcare',
    dbFilters: {},
    linkedInFilters: {
      functionIds: ['11'],  // Hospitals & Health Care function
    },
    limit: 10,
  } as SearchInputV2;

  console.log('Running searchPeopleV2Action with company-less functionIds=["11"]');
  const res = await searchPeopleV2Action(input);

  if (!res.success) {
    console.log(`[FAIL ] success=false: ${res.error}`);
    process.exit(1);
  }

  console.log(`  status: success`);
  console.log(`  results.length = ${res.results.length}`);
  console.log(`  searchMeta.isAdvancedQuery = ${res.searchMeta?.isAdvancedQuery}`);
  console.log(`  searchMeta.shortModePages = ${res.searchMeta?.shortModePages}`);
  console.log(`  searchMeta.apiResultCount = ${res.searchMeta?.apiResultCount}`);
  console.log(`  searchMeta.totalMatchesOnLinkedIn = ${res.searchMeta?.totalMatchesOnLinkedIn}`);

  if (res.results.length === 0) {
    failures++;
    console.log(`  [FAIL ] no results returned`);
  }
  if (res.searchMeta?.isAdvancedQuery !== true) {
    failures++;
    console.log(`  [FAIL ] isAdvancedQuery expected true, got ${res.searchMeta?.isAdvancedQuery}`);
  }
  if ((res.searchMeta?.shortModePages ?? 0) !== 1) {
    failures++;
    console.log(`  [FAIL ] shortModePages expected 1, got ${res.searchMeta?.shortModePages}`);
  }

  console.log('\nSample results:');
  for (const r of res.results.slice(0, 3)) {
    console.log(`  - ${r.candidate?.fullName ?? '?'} — ${r.candidate?.role ?? '?'} @ ${r.candidate?.company ?? '?'}`);
  }

  console.log('\nRunning searchPeopleV2Action with industryIds=["43"] (fintech)');
  const input2: SearchInputV2 = {
    query: 'fintech PMs',
    dbFilters: {},
    linkedInFilters: {
      currentJobTitles: ['Product Manager'],
      industryIds: ['43'],
    },
    limit: 10,
  } as SearchInputV2;

  const res2 = await searchPeopleV2Action(input2);
  if (!res2.success) {
    failures++;
    console.log(`  [FAIL ] fintech run: ${res2.error}`);
  } else {
    console.log(`  results.length = ${res2.results.length}`);
    console.log(`  isAdvancedQuery = ${res2.searchMeta?.isAdvancedQuery}`);
    if (res2.searchMeta?.isAdvancedQuery !== true) {
      failures++;
      console.log(`  [FAIL ] industryIds did not route through advanced path`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} failures`);
    process.exit(1);
  }
  console.log('\nAll integration checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx tsx tests/company-less-search-integration.ts`

Expected output:
```
Running searchPeopleV2Action with company-less functionIds=["11"]
  status: success
  results.length = 10 (or up to limit)
  searchMeta.isAdvancedQuery = true
  searchMeta.shortModePages = 1
  ...
All integration checks passed.
```

Exit code 0.

**If the action throws** (e.g. due to missing auth on a server action), wrap the call with the auth mocking pattern used by other tests in the repo (`npm run test:groq` or `tests/dedup-quality-qa.ts` for reference). The prod auth check should be bypassable in a test harness — do not disable it in production code.

- [ ] **Step 3: Commit**

```bash
git add tests/company-less-search-integration.ts
git commit -m "tests: end-to-end company-less industry search via searchPeopleV2Action"
```

---

## Task 16 — Delete the superseded healthcare-query-qa.ts

**Files:**
- Delete: `tests/healthcare-query-qa.ts`

- [ ] **Step 1: Remove the old test**

```bash
git rm tests/healthcare-query-qa.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "tests: remove healthcare-query-qa.ts (replaced by company-less-industry-qa.ts)"
```

---

## Task 17 — Final verification: full test sweep + type-check + lint + build

**Files:** (none — verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: 0 errors. The pre-existing `OnboardingClient.tsx` JSX-apostrophe warning is acceptable per `CLAUDE.md`; no new errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: exit code 0.

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Run every new/changed test in sequence**

```bash
npx tsx tests/filter-sanitizer-qa.ts
npx tsx tests/prompt-regression-qa.ts
npx tsx tests/company-less-industry-qa.ts
npx tsx tests/company-less-offtopic-qa.ts
npx tsx tests/company-less-unsupported-qa.ts
npx tsx tests/company-less-search-integration.ts
```

Expected: each exits 0, prints `N/N passed`.

**Do not** re-run `apify-industry-id-smoke.ts` — it was only for the first-time check.

- [ ] **Step 5: Manual UI smoke**

1. `npm run dev`
2. Visit `http://localhost:3000` and sign in.
3. Type `find people in healthcare` in the search box.
4. Verify: no "Unsupported" banner; results appear; Load More works.
5. Type `fintech PMs in New York`. Same checks.
6. Type `find people` (bare). Verify: off_topic message; no scrape triggered.

- [ ] **Step 6: Final commit (if any tidy-up needed)**

If any step above flagged a cleanup item, fix and commit. Otherwise, implementation is complete.

---

## Rollback notes

- If Task 17 reveals an issue not caught by earlier tests, revert the prompt commits first (Tasks 7-9) — they account for most behavioral risk. Sanitizer and type changes (Tasks 1-5) are safe to keep because the force-strip is replaced by an allowlist that's empty-input-safe.
- If Apify rejects `industryIds` despite the smoke test (Task 14) passing, the wrapper forwards a harmless parameter and the call still succeeds — the ID just has no effect. Low-risk failure mode.

## Acceptance criteria (all must hold)

1. `tests/prompt-regression-qa.ts` — 30/30 pass against the baseline (I1, I3).
2. `tests/company-less-industry-qa.ts` — 13/13 pass (new capability).
3. `tests/company-less-offtopic-qa.ts` — 8/8 pass (I2).
4. `tests/company-less-unsupported-qa.ts` — 4/4 pass (I4).
5. `tests/filter-sanitizer-qa.ts` — 6/6 pass (I5).
6. `tests/company-less-search-integration.ts` — exits 0 with ≥1 result for `find people in healthcare` (I6 + end-to-end).
7. `npx tsc --noEmit` clean; `npm run build` clean; `npm run lint` clean.
8. Manual UI smoke for the three queries in Task 17 Step 5 passes.
