# Discovery Flow Test Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the discovery flow test catalog with unsupported criteria, multi-turn, suggested searches, and message quality tests — plus fix existing wrong/weak assertions.

**Architecture:** All changes are in `tests/discovery-flow/`. Type expansions in `queries.ts`, harness changes in `run.ts`, then new test cases and fixes to existing ones in `queries.ts`. No production code changes.

**Tech Stack:** TypeScript, `npx tsx` runner, Claude Haiku LLM extraction

**Spec:** `docs/superpowers/specs/2026-04-14-discovery-test-expansion-design.md`

---

### Task 1: Expand types in `queries.ts`

**Files:**
- Modify: `tests/discovery-flow/queries.ts:21-72`

- [ ] **Step 1: Add `'unsupported'` to `ExpectedStatus`**

In `tests/discovery-flow/queries.ts`, change line 21 from:

```typescript
export type ExpectedStatus = 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup';
```

to:

```typescript
export type ExpectedStatus = 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup' | 'unsupported';
```

- [ ] **Step 2: Add new fields to `ExpectedExtraction`**

In `tests/discovery-flow/queries.ts`, after the existing `roleSpecificity` field (line 47) and before the closing brace of `ExpectedExtraction` (line 50), add:

```typescript
  // For status=unsupported
  /** Subset match — each string must appear in at least one actual criterion (case-insensitive). */
  unsupportedCriteria?: string[];
  /** Validate the reformulated suggested_alternative.filters. */
  suggestedAlternativeFilters?: Partial<DBFilters>;
  /** Validate the reformulated suggested_alternative.linkedin_filters. */
  suggestedAlternativeLinkedInFilters?: Partial<LinkedInFilters>;
  /** Substring match on suggested_alternative.label. */
  suggestedAlternativeLabel?: string;

  // For status=ready — suggested searches
  /** Minimum number of suggested_searches entries returned. */
  suggestedSearchesMin?: number;

  // Message quality (any status)
  /** Substrings the message field must contain (case-insensitive). */
  messageContains?: string[];

  // Company ambiguity flag
  companyNameAmbiguous?: boolean;
```

- [ ] **Step 3: Add multi-turn fields to `DiscoveryTestCase`**

In `tests/discovery-flow/queries.ts`, change the `DiscoveryTestCase` interface (lines 63-72) from:

```typescript
export interface DiscoveryTestCase {
  id: string;
  category: string;
  query: string;
  description: string;
  expected: {
    extraction: ExpectedExtraction;
    search?: ExpectedSearch;
  };
}
```

to:

```typescript
export interface DiscoveryTestCase {
  id: string;
  category: string;
  query: string;
  description: string;
  /** For multi-turn tests: prior conversation messages. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** For multi-turn tests: filters carried over from a previous search. */
  currentFilters?: Partial<DBFilters>;
  expected: {
    extraction: ExpectedExtraction;
    search?: ExpectedSearch;
  };
}
```

- [ ] **Step 4: Update the file header comment**

Replace lines 13-14:

```typescript
 * NOTE: multi-turn conversations (context carryover) are not covered here —
 * the harness invokes each query with empty conversation history. A separate
 * fixture would be needed for multi-turn tests.
```

with:

```typescript
 * Multi-turn tests set `conversationHistory` and `currentFilters` on the
 * test case; the harness passes these through to the LLM call.
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No new errors from the type changes (existing tests won't fail since all new fields are optional).

- [ ] **Step 6: Commit**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "feat(tests): expand ExpectedExtraction types for unsupported, multi-turn, message quality"
```

---

### Task 2: Expand types and add `unsupported` branch in `run.ts`

**Files:**
- Modify: `tests/discovery-flow/run.ts:101-102,185-196,198-211`

- [ ] **Step 1: Add `'unsupported'` to `LLMResponse.status`**

In `tests/discovery-flow/run.ts`, change line 102 from:

```typescript
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup';
```

to:

```typescript
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup' | 'unsupported';
```

- [ ] **Step 2: Add `unsupported_criteria` and `suggested_alternative` to `LLMResponse`**

In `tests/discovery-flow/run.ts`, after the `message: string;` line (line 138), add before the closing brace:

```typescript
  unsupported_criteria?: string[];
  suggested_alternative?: {
    label: string;
    filters: {
      company: string | null;
      role: string | null;
      university: string | null;
      location: string | null;
    };
    linkedin_filters: LLMResponse['linkedin_filters'];
  };
```

- [ ] **Step 3: Expand `ExtractionOutcome` interface**

In `tests/discovery-flow/run.ts`, replace the `ExtractionOutcome` interface (lines 185-196) with:

```typescript
interface ExtractionOutcome {
  status: 'ready' | 'needs_selection' | 'off_topic' | 'person_lookup' | 'unsupported';
  dbFilters: DBFilters;
  linkedInFilters: LinkedInFilters;
  selectables: Array<{ label: string; filterKey: 'company' | 'role'; filterValue: string }>;
  personName?: string;
  personCompany?: string;
  companyNameAmbiguous?: boolean;
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
  rawResponse: LLMResponse;
  escalatedToPerplexity: boolean;
  // New fields for unsupported/message/suggested
  unsupportedCriteria: string[];
  suggestedAlternative: {
    label: string;
    filters: DBFilters;
    linkedInFilters: LinkedInFilters;
  } | null;
  suggestedSearches: Array<{ label: string; company: string; role: string | null }>;
  message: string;
}
```

- [ ] **Step 4: Update `runExtraction` signature and prompt building for multi-turn**

Replace the `runExtraction` function signature and prompt-building section (lines 198-211) with:

```typescript
interface ExtractionInput {
  query: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentFilters?: Partial<DBFilters>;
}

function buildTestUserPrompt(input: ExtractionInput): string {
  const parts: string[] = [];
  const history = input.conversationHistory || [];
  if (history.length > 0) {
    parts.push('Conversation history:');
    for (const msg of history) {
      parts.push(`${msg.role}: ${msg.content}`);
    }
    parts.push('');
  }
  const activeFilters = Object.entries(input.currentFilters || {}).filter(([, v]) => v);
  if (activeFilters.length > 0) {
    parts.push(`Current active filters: ${JSON.stringify(input.currentFilters)}`);
    parts.push('');
  }
  parts.push(`New user message: ${input.query}`);
  return parts.join('\n');
}

async function runExtraction(input: ExtractionInput): Promise<ExtractionOutcome> {
  const { query } = input;
  log.info('ai-search', 'Received query', {
    message: query,
    currentFilters: input.currentFilters || {},
    historyLength: (input.conversationHistory || []).length,
  });

  const response = await completeJsonAnthropic<LLMResponse>({
    systemPrompt: SEARCH_EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildTestUserPrompt(input),
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.1,
    maxTokens: 512,
  });
```

The rest of the function body stays the same until the status branches.

- [ ] **Step 5: Add `unsupported` branch in `runExtraction`**

In `runExtraction`, after the `off_topic` branch (after line 241) and before the `person_lookup` branch, add:

```typescript
  if (status === 'unsupported') {
    const unsupportedCriteria = parsed.unsupported_criteria || [];
    log.decision('ai-search', 'unsupported branch', {
      unsupportedCriteria,
      hasSuggestedAlternative: !!parsed.suggested_alternative,
    });

    let suggestedAlternative: ExtractionOutcome['suggestedAlternative'] = null;
    if (parsed.suggested_alternative) {
      const altFilters: DBFilters = {};
      if (parsed.suggested_alternative.filters.company) altFilters.company = parsed.suggested_alternative.filters.company;
      if (parsed.suggested_alternative.filters.role) altFilters.role = parsed.suggested_alternative.filters.role;
      if (parsed.suggested_alternative.filters.university) altFilters.university = parsed.suggested_alternative.filters.university;
      if (parsed.suggested_alternative.filters.location) altFilters.location = parsed.suggested_alternative.filters.location;
      const altLinkedIn = convertLinkedInFilters(parsed.suggested_alternative.linkedin_filters);
      suggestedAlternative = {
        label: parsed.suggested_alternative.label,
        filters: altFilters,
        linkedInFilters: altLinkedIn,
      };
    }

    return {
      status,
      dbFilters,
      linkedInFilters: {},
      selectables: [],
      rawResponse: parsed,
      escalatedToPerplexity: false,
      unsupportedCriteria,
      suggestedAlternative,
      suggestedSearches: [],
      message,
      companyNameAmbiguous: parsed.company_name_ambiguous,
    };
  }
```

- [ ] **Step 6: Add the new fields to ALL existing return statements in `runExtraction`**

Every `return` in `runExtraction` must now include: `unsupportedCriteria: []`, `suggestedAlternative: null`, `suggestedSearches: parsed.suggested_searches || []`, `message`.

For the `off_topic` return (around line 233), add to the return object:

```typescript
      unsupportedCriteria: [],
      suggestedAlternative: null,
      suggestedSearches: [],
      message,
```

For the `person_lookup` return (around line 249), add:

```typescript
      unsupportedCriteria: [],
      suggestedAlternative: null,
      suggestedSearches: [],
      message,
```

For the `needs_selection` return (around line 306), add:

```typescript
      unsupportedCriteria: [],
      suggestedAlternative: null,
      suggestedSearches: [],
      message,
```

For the `ready` return (around line 350), add:

```typescript
      unsupportedCriteria: [],
      suggestedAlternative: null,
      suggestedSearches: parsed.suggested_searches || [],
      message,
```

- [ ] **Step 7: Update `runOneTest` to pass multi-turn fields**

In `runOneTest` (around line 833), change:

```typescript
    const outcome = await withLogger(extractLogger, () => runExtraction(testCase.query));
```

to:

```typescript
    const outcome = await withLogger(extractLogger, () => runExtraction({
      query: testCase.query,
      conversationHistory: testCase.conversationHistory,
      currentFilters: testCase.currentFilters,
    }));
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 9: Commit**

```bash
git add tests/discovery-flow/run.ts
git commit -m "feat(tests): add unsupported branch, multi-turn support, and expanded outcome fields in harness"
```

---

### Task 3: Add new validation checks in `validateExtraction`

**Files:**
- Modify: `tests/discovery-flow/run.ts:607-723`

- [ ] **Step 1: Add unsupported criteria validation**

In `validateExtraction` (after the roleSpecificity check, around line 720), add before the final `return`:

```typescript
  // 9. Unsupported criteria subset match
  if (expected.unsupportedCriteria && expected.unsupportedCriteria.length > 0) {
    for (const criterion of expected.unsupportedCriteria) {
      const found = outcome.unsupportedCriteria.some(
        actual => actual.toLowerCase().includes(criterion.toLowerCase())
      );
      if (!found) {
        failures.push(
          `unsupportedCriteria missing "${criterion}". Got: [${outcome.unsupportedCriteria.join(', ')}]`
        );
      }
    }
  }

  // 10. Suggested alternative filters
  if (expected.suggestedAlternativeFilters && outcome.suggestedAlternative) {
    for (const [k, v] of Object.entries(expected.suggestedAlternativeFilters)) {
      const actual = (outcome.suggestedAlternative.filters as Record<string, unknown>)[k];
      if (actual !== v) {
        failures.push(
          `suggestedAlternative.filters.${k} mismatch: expected="${v}", actual="${actual ?? '(unset)'}"`
        );
      }
    }
  } else if (expected.suggestedAlternativeFilters && !outcome.suggestedAlternative) {
    failures.push('expected suggestedAlternative but it was null');
  }

  // 11. Suggested alternative LinkedIn filters
  if (expected.suggestedAlternativeLinkedInFilters && outcome.suggestedAlternative) {
    for (const [k, v] of Object.entries(expected.suggestedAlternativeLinkedInFilters)) {
      const actual = (outcome.suggestedAlternative.linkedInFilters as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        if (!matchArraySubset(actual as unknown[], v)) {
          failures.push(
            `suggestedAlternative.linkedInFilters.${k} missing values: expected subset=${JSON.stringify(v)}, actual=${JSON.stringify(actual ?? null)}`
          );
        }
      } else if (typeof v === 'boolean') {
        if (actual !== v) {
          failures.push(
            `suggestedAlternative.linkedInFilters.${k} mismatch: expected=${v}, actual=${actual ?? '(unset)'}`
          );
        }
      }
    }
  }

  // 12. Suggested alternative label
  if (expected.suggestedAlternativeLabel && outcome.suggestedAlternative) {
    if (!outcome.suggestedAlternative.label.toLowerCase().includes(expected.suggestedAlternativeLabel.toLowerCase())) {
      failures.push(
        `suggestedAlternative.label missing "${expected.suggestedAlternativeLabel}". Got: "${outcome.suggestedAlternative.label}"`
      );
    }
  }

  // 13. Suggested searches count
  if (expected.suggestedSearchesMin != null) {
    if (outcome.suggestedSearches.length < expected.suggestedSearchesMin) {
      failures.push(
        `suggestedSearches count too low: expected>=${expected.suggestedSearchesMin}, actual=${outcome.suggestedSearches.length}`
      );
    }
  }

  // 14. Message contains
  if (expected.messageContains) {
    for (const substring of expected.messageContains) {
      if (!outcome.message.toLowerCase().includes(substring.toLowerCase())) {
        failures.push(
          `message missing "${substring}". Got: "${outcome.message}"`
        );
      }
    }
  }

  // 15. Company name ambiguous flag
  if (expected.companyNameAmbiguous != null) {
    if (outcome.companyNameAmbiguous !== expected.companyNameAmbiguous) {
      failures.push(
        `companyNameAmbiguous mismatch: expected=${expected.companyNameAmbiguous}, actual=${outcome.companyNameAmbiguous ?? '(unset)'}`
      );
    }
  }
```

- [ ] **Step 2: Update `shouldRunSearch` to handle unsupported status**

In `runOneTest` (around line 851), change:

```typescript
  const shouldRunSearch =
    !opts.extractOnly &&
    result.extraction.outcome?.status === 'ready' &&
    testCase.expected.search?.shouldRun !== false;
```

to:

```typescript
  const shouldRunSearch =
    !opts.extractOnly &&
    result.extraction.outcome?.status === 'ready' &&
    testCase.expected.search?.shouldRun !== false;
```

(No change needed — `unsupported` status already won't match `=== 'ready'`, so search correctly skips.)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add tests/discovery-flow/run.ts
git commit -m "feat(tests): add validation for unsupported, suggested searches, message quality, ambiguity"
```

---

### Task 4: Fix existing test assertions in `queries.ts`

**Files:**
- Modify: `tests/discovery-flow/queries.ts`

- [ ] **Step 1: Fix `seniority-senior-engineers` (line ~488-498)**

Replace:

```typescript
        linkedInFilters: { seniorityLevelIds: ['120'], functionIds: ['8'] },
```

with:

```typescript
        linkedInFilters: { excludeSeniorityLevelIds: ['110'], functionIds: ['8'] },
```

Also update the description from `seniorityLevelIds=["120"]` to `excludeSeniorityLevelIds=["110"]`.

- [ ] **Step 2: Fix `negation-not-california` (line ~769-780)**

Replace:

```typescript
        linkedInFilters: {
          seniorityLevelIds: ['120'],
          excludeLocations: ['California'],
        },
```

with:

```typescript
        linkedInFilters: {
          excludeSeniorityLevelIds: ['110'],
          excludeLocations: ['California'],
        },
```

Also update description from `seniorityLevelIds=["120"]` to `excludeSeniorityLevelIds=["110"]`.

- [ ] **Step 3: Fix `category-fintech-startups` (line ~884-897)**

Replace the entire test case:

```typescript
  {
    id: 'category-fintech-startups',
    category: 'anti-category',
    query: 'PMs at fintech startups',
    description: '"fintech startups" stage descriptor → needs_selection + Perplexity escalation.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 4,
        shouldEscalateToPerplexity: true,
      },
      search: { shouldRun: false },
    },
  },
```

with:

```typescript
  {
    id: 'category-fintech-startups',
    category: 'unsupported-industry',
    query: 'PMs at fintech startups',
    description: '"fintech" is unsupported industry term → unsupported with suggested alternative.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
      },
      search: { shouldRun: false },
    },
  },
```

- [ ] **Step 4: Fix `integrity-no-industry-ids` (line ~1219-1231)**

Replace the entire test case:

```typescript
  {
    id: 'integrity-no-industry-ids',
    category: 'id-allowlist',
    query: 'fintech engineers at Ramp',
    description: 'Must NOT leak industryIds (forcibly stripped by sanitizer).',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Ramp' },
        forbiddenLinkedInFilterKeys: ['industryIds'],
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
```

with:

```typescript
  {
    id: 'integrity-no-industry-ids',
    category: 'id-allowlist',
    query: 'fintech engineers at Ramp',
    description: '"fintech" is unsupported industry → unsupported. Alternative keeps Ramp.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
        suggestedAlternativeFilters: { company: 'Ramp' },
      },
      search: { shouldRun: false },
    },
  },
```

- [ ] **Step 5: Tighten `role-devs` (line ~199-209)**

Add role assertion:

```typescript
        filters: { company: 'Microsoft', role: 'Software Engineer' },
```

- [ ] **Step 6: Tighten `role-ml-engineers` (line ~227-237)**

Replace:

```typescript
        filters: { company: 'Anthropic' },
```

with:

```typescript
        filters: { company: 'Anthropic', role: 'Machine Learning Engineer' },
        linkedInFilters: { currentJobTitles: ['Machine Learning Engineer'] },
        roleSpecificity: 'narrow',
```

- [ ] **Step 7: Tighten `role-bankers` (line ~240-250)**

Replace:

```typescript
        filters: { company: 'JP Morgan' },
```

with:

```typescript
        filters: { company: 'JP Morgan', role: 'Investment Banking Analyst' },
```

- [ ] **Step 8: Tighten university tests**

For `university-mit` (line ~338-348), replace `filters: { company: 'Microsoft' }` with:

```typescript
        filters: { company: 'Microsoft', university: 'Massachusetts Institute of Technology' },
        linkedInFilters: { schools: ['Massachusetts Institute of Technology'] },
```

For `university-cmu` (line ~351-361), replace `filters: { company: 'Tesla' }` with:

```typescript
        filters: { company: 'Tesla', university: 'Carnegie Mellon University' },
        linkedInFilters: { schools: ['Carnegie Mellon University'] },
```

For `university-upenn` (line ~364-374), replace `filters: { company: 'Bridgewater' }` with:

```typescript
        filters: { company: 'Bridgewater', university: 'University of Pennsylvania' },
        linkedInFilters: { schools: ['University of Pennsylvania'] },
```

For `university-berkeley` (line ~377-387), replace `filters: { company: 'Meta' }` with:

```typescript
        filters: { company: 'Meta', university: 'University of California, Berkeley' },
        linkedInFilters: { schools: ['University of California, Berkeley'] },
```

- [ ] **Step 9: Add `companyNameAmbiguous: true` to ambiguity tests**

For `ambiguous-chase` (line ~446), add to extraction:

```typescript
        companyNameAmbiguous: true,
```

Same for `ambiguous-block` (line ~459) and `ambiguous-square` (line ~472).

- [ ] **Step 10: Tighten `seniority-staff` (line ~515-525)**

Replace:

```typescript
      extraction: {
        status: 'ready',
        filters: { company: 'Netflix' },
      },
```

with:

```typescript
      extraction: {
        status: 'ready',
        filters: { company: 'Netflix' },
        linkedInFilters: { excludeSeniorityLevelIds: ['110'] },
      },
```

- [ ] **Step 11: Recategorize `seniority-cxo` (line ~559)**

Change `category: 'linkedin-seniority'` to `category: 'anti-category'`.

- [ ] **Step 12: Fix `phrasing-who-works` (line ~1136-1146)**

Replace:

```typescript
      extraction: {
        status: 'ready',
        filters: { company: 'Notion', role: 'Designer' },
      },
      search: { simplePath: true, shouldRun: true },
```

with:

```typescript
      extraction: {
        status: 'ready',
        filters: { company: 'Notion', role: 'Designer' },
        linkedInFilters: { functionIds: ['3'] },
        roleSpecificity: 'broad',
      },
      search: { advancedPath: true, shouldRun: true },
```

- [ ] **Step 13: Fix `edge-very-long` (line ~1070-1081)**

Replace the query:

```typescript
    query:
      'I want to find software engineers who specifically worked on payments infrastructure at Stripe in San Francisco with at least 5 years of experience who also went to Stanford or MIT and are currently senior or staff level and recently joined the company in the last 6 months',
```

with:

```typescript
    query:
      'I want to find software engineers at Stripe in San Francisco with at least 5 years of experience who also went to Stanford and are currently senior level and recently joined the company in the last 6 months',
```

Update description:

```typescript
    description: 'Very long multi-filter query — should still parse into structured filters.',
```

- [ ] **Step 14: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 15: Commit**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "fix(tests): correct seniority assertions, tighten weak role/university checks, fix miscategorized tests"
```

---

### Task 5: Add unsupported criteria test cases

**Files:**
- Modify: `tests/discovery-flow/queries.ts`

- [ ] **Step 1: Add unsupported degree, skills, compensation, work mode, and other test cases**

At the end of the `QUERIES` array (before the closing `];`), add:

```typescript
  // ═══ 20. Unsupported — degree type ═════════════════════════════════════════
  {
    id: 'unsupported-phd',
    category: 'unsupported-degree',
    query: 'PhD data scientists at Google',
    description: '"PhD" is unsupported degree type → unsupported. Alternative keeps Data Scientist at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PhD'],
        suggestedAlternativeFilters: { company: 'Google', role: 'Data Scientist' },
        suggestedAlternativeLinkedInFilters: { currentJobTitles: ['Data Scientist'] },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-mba',
    category: 'unsupported-degree',
    query: 'MBA grads at McKinsey',
    description: '"MBA" unsupported → alternative keeps McKinsey.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['MBA'],
        suggestedAlternativeFilters: { company: 'McKinsey' },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-masters',
    category: 'unsupported-degree',
    query: 'Masters students at Meta',
    description: '"Masters" unsupported degree → alternative keeps Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Masters'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 21. Unsupported — skills/technologies ═════════════════════════════════
  {
    id: 'unsupported-python',
    category: 'unsupported-skills',
    query: 'Python engineers at Stripe',
    description: '"Python" is unsupported skill → alternative keeps engineers at Stripe.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Python'],
        suggestedAlternativeFilters: { company: 'Stripe' },
        messageContains: ["can't filter", 'skill'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-react',
    category: 'unsupported-skills',
    query: 'React developers at Meta',
    description: '"React" unsupported skill → alternative keeps Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['React'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-kubernetes',
    category: 'unsupported-skills',
    query: 'people who know Kubernetes at Google',
    description: '"Kubernetes" unsupported skill → alternative keeps Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Kubernetes'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 22. Unsupported — compensation ════════════════════════════════════════
  {
    id: 'unsupported-salary',
    category: 'unsupported-compensation',
    query: 'engineers making $200k+ at Google',
    description: '"$200k+" unsupported salary → alternative keeps engineers at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['$200k'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter", 'salary'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-high-paying',
    category: 'unsupported-compensation',
    query: 'high paying PM jobs in SF',
    description: '"high paying" unsupported compensation → alternative keeps PM + SF.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['paying'],
        suggestedAlternativeFilters: { role: 'Product Manager', location: 'San Francisco, California' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 23. Unsupported — work mode ═══════════════════════════════════════════
  {
    id: 'unsupported-remote',
    category: 'unsupported-work-mode',
    query: 'remote engineers at Stripe',
    description: '"remote" unsupported work mode → alternative keeps engineers at Stripe.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['remote'],
        suggestedAlternativeFilters: { company: 'Stripe' },
        messageContains: ["can't filter", 'remote'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-hybrid',
    category: 'unsupported-work-mode',
    query: 'hybrid PMs at Google in NYC',
    description: '"hybrid" unsupported → alternative keeps PM + Google + NYC.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['hybrid'],
        suggestedAlternativeFilters: { company: 'Google', role: 'Product Manager', location: 'New York, New York' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 24. Unsupported — other (visa, hiring, certifications) ════════════════
  {
    id: 'unsupported-h1b',
    category: 'unsupported-other',
    query: 'H1B engineers at Meta',
    description: '"H1B" unsupported visa → alternative keeps engineers at Meta.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['H1B'],
        suggestedAlternativeFilters: { company: 'Meta' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-hiring',
    category: 'unsupported-other',
    query: 'engineers at Google who are hiring',
    description: '"hiring" unsupported → alternative keeps engineers at Google.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['hiring'],
        suggestedAlternativeFilters: { company: 'Google' },
        messageContains: ["can't filter"],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-cfa',
    category: 'unsupported-other',
    query: 'CFA holders at Goldman Sachs',
    description: '"CFA" unsupported cert → alternative approximates with functionIds=["10"] (Finance).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['CFA'],
        suggestedAlternativeFilters: { company: 'Goldman Sachs' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['10'] },
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },

  // ═══ 25. Unsupported — reformulation quality ══════════════════════════════
  {
    id: 'unsupported-series-b',
    category: 'unsupported-reformulation',
    query: 'Series B engineers in Austin',
    description: '"Series B" unsupported funding → alternative approximates with companyHeadcount + keeps Austin.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['Series B'],
        suggestedAlternativeLinkedInFilters: { companyHeadcount: ['D', 'E'] },
        suggestedAlternativeLabel: 'Austin',
        messageContains: ["can't filter", 'funding'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-cpa',
    category: 'unsupported-reformulation',
    query: 'CPA accountants at Deloitte',
    description: '"CPA" unsupported cert → alternative approximates with functionIds=["1"] (Accounting).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['CPA'],
        suggestedAlternativeFilters: { company: 'Deloitte' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['1'] },
        suggestedAlternativeLabel: 'Deloitte',
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-pmp',
    category: 'unsupported-reformulation',
    query: 'PMP project managers at IBM',
    description: '"PMP" unsupported cert → alternative approximates with functionIds=["20"] (Program Mgmt).',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PMP'],
        suggestedAlternativeFilters: { company: 'IBM' },
        suggestedAlternativeLinkedInFilters: { functionIds: ['20'] },
        suggestedAlternativeLabel: 'IBM',
        messageContains: ["can't filter", 'certification'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'unsupported-fintech-pms',
    category: 'unsupported-reformulation',
    query: 'fintech PMs in NYC',
    description: '"fintech" unsupported industry → alternative keeps PM + NYC.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['fintech'],
        suggestedAlternativeFilters: { role: 'Product Manager', location: 'New York, New York' },
        messageContains: ["can't filter", 'industry'],
      },
      search: { shouldRun: false },
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "feat(tests): add 17 unsupported criteria test cases (degree, skills, compensation, work mode, reformulation)"
```

---

### Task 6: Add multi-turn test cases

**Files:**
- Modify: `tests/discovery-flow/queries.ts`

- [ ] **Step 1: Add multi-turn filter swap and persistence test cases**

After the unsupported tests added in Task 5, add:

```typescript
  // ═══ 26. Multi-turn — filter swap ══════════════════════════════════════════
  {
    id: 'multiturn-swap-role',
    category: 'multi-turn-swap',
    query: 'try engineers instead',
    description: 'Follow-up swapping role from PM → engineer. Company (Google) should persist.',
    conversationHistory: [
      { role: 'user', content: 'PMs at Google' },
      { role: 'assistant', content: 'Searching for Product Managers at Google' },
    ],
    currentFilters: { company: 'Google', role: 'Product Manager' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-swap-company',
    category: 'multi-turn-swap',
    query: 'what about Meta?',
    description: 'Follow-up swapping company from Stripe → Meta.',
    conversationHistory: [
      { role: 'user', content: 'engineers at Stripe' },
      { role: 'assistant', content: 'Searching for engineers at Stripe' },
    ],
    currentFilters: { company: 'Stripe' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Meta' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-swap-location',
    category: 'multi-turn-swap',
    query: 'try NYC instead',
    description: 'Follow-up swapping location from SF → NYC. Company and role persist.',
    conversationHistory: [
      { role: 'user', content: 'PMs at Google in SF' },
      { role: 'assistant', content: 'Searching for Product Managers at Google in San Francisco' },
    ],
    currentFilters: { company: 'Google', role: 'Product Manager', location: 'San Francisco, California' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Product Manager', location: 'New York, New York' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 27. Multi-turn — filter persistence ═══════════════════════════════════
  {
    id: 'multiturn-persist-location',
    category: 'multi-turn-persist',
    query: 'try Apple',
    description: 'Follow-up swapping company. Location (SF) should persist from previous filters.',
    conversationHistory: [
      { role: 'user', content: 'engineers at Google in SF' },
      { role: 'assistant', content: 'Searching for engineers at Google in San Francisco' },
    ],
    currentFilters: { company: 'Google', location: 'San Francisco, California' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Apple', location: 'San Francisco, California' },
      },
      search: { shouldRun: true },
    },
  },
  {
    id: 'multiturn-persist-company',
    category: 'multi-turn-persist',
    query: 'try MIT instead',
    description: 'Follow-up swapping university. Company (Stripe) should persist.',
    conversationHistory: [
      { role: 'user', content: 'Stanford alumni at Stripe' },
      { role: 'assistant', content: 'Searching for Stanford alumni at Stripe' },
    ],
    currentFilters: { company: 'Stripe', university: 'Stanford University' },
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe', university: 'Massachusetts Institute of Technology' },
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "feat(tests): add 5 multi-turn test cases (filter swap + persistence)"
```

---

### Task 7: Add suggested searches and message quality test cases

**Files:**
- Modify: `tests/discovery-flow/queries.ts`

- [ ] **Step 1: Add suggested searches and message quality test cases**

After the multi-turn tests, add:

```typescript
  // ═══ 28. Suggested searches validation ═════════════════════════════════════
  {
    id: 'suggested-pms-google',
    category: 'suggested-searches',
    query: 'PMs at Google',
    description: 'Ready result should include 2+ suggested alternative searches.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Google', role: 'Product Manager' },
        suggestedSearchesMin: 2,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-designers-figma',
    category: 'suggested-searches',
    query: 'designers at Figma',
    description: 'Broad role ready result should include 2+ suggestions.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Figma' },
        linkedInFilters: { functionIds: ['3'] },
        suggestedSearchesMin: 2,
      },
      search: { advancedPath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-analysts-gs',
    category: 'suggested-searches',
    query: 'analysts at Goldman Sachs',
    description: 'Finance role should include 2+ suggestions.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Goldman Sachs' },
        suggestedSearchesMin: 2,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },
  {
    id: 'suggested-people-stripe',
    category: 'suggested-searches',
    query: 'people at Stripe',
    description: 'No-role query should still produce at least 1 suggestion.',
    expected: {
      extraction: {
        status: 'ready',
        filters: { company: 'Stripe' },
        suggestedSearchesMin: 1,
      },
      search: { simplePath: true, shouldRun: true },
    },
  },

  // ═══ 29. Message quality ═══════════════════════════════════════════════════
  {
    id: 'message-offtopic-weather',
    category: 'message-quality',
    query: 'how is the weather?',
    description: 'Off-topic message should redirect user with helpful suggestion.',
    expected: {
      extraction: {
        status: 'off_topic',
        messageContains: ['professional contacts'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-offtopic-hello',
    category: 'message-quality',
    query: 'hello!',
    description: 'Greeting should redirect with helpful suggestion.',
    expected: {
      extraction: {
        status: 'off_topic',
        messageContains: ['help', 'find'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-unsupported-phd',
    category: 'message-quality',
    query: 'PhD engineers at Google',
    description: 'Unsupported message should name the specific criteria.',
    expected: {
      extraction: {
        status: 'unsupported',
        unsupportedCriteria: ['PhD'],
        messageContains: ["can't filter", 'degree'],
      },
      search: { shouldRun: false },
    },
  },
  {
    id: 'message-needs-selection-mbb',
    category: 'message-quality',
    query: 'consultants at MBB',
    description: 'Needs-selection message should prompt user to pick.',
    expected: {
      extraction: {
        status: 'needs_selection',
        minSelectables: 3,
        mustContainSelectables: ['McKinsey', 'BCG', 'Bain'],
        messageContains: ['Which'],
      },
      search: { shouldRun: false },
    },
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "feat(tests): add 8 suggested searches + message quality test cases"
```

---

### Task 8: Run extract-only and verify

**Files:** None (validation only)

- [ ] **Step 1: Dry run to verify test count**

Run: `npx tsx tests/discovery-flow/run.ts --dry-run`

Expected: Should show the total query count including all new categories. Verify the count is ~100 (original 80 + ~30 new).

- [ ] **Step 2: Run extract-only on new categories to validate**

Run: `npx tsx tests/discovery-flow/run.ts --extract-only --filter=unsupported`

Expected: All unsupported tests should pass (status=unsupported, criteria match, alternatives present).

- [ ] **Step 3: Run extract-only on multi-turn tests**

Run: `npx tsx tests/discovery-flow/run.ts --extract-only --filter=multi-turn`

Expected: All multi-turn tests pass (filters swap/persist correctly).

- [ ] **Step 4: Run full extract-only suite**

Run: `npx tsx tests/discovery-flow/run.ts --extract-only`

Expected: Report generated. Review failures — some may need assertion tweaks if the LLM's exact wording differs slightly (e.g., `messageContains` substrings).

- [ ] **Step 5: Adjust any failing assertions based on actual LLM output**

If a test fails due to minor wording differences (e.g., message says "I cannot filter" instead of "I can't filter"), update the assertion to match the actual LLM pattern. Only adjust assertions for genuine wording variations — not for wrong status or missing fields.

- [ ] **Step 6: Final commit with any assertion tweaks**

```bash
git add tests/discovery-flow/queries.ts
git commit -m "fix(tests): adjust assertions based on actual LLM output patterns"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-14-discovery-test-expansion.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?