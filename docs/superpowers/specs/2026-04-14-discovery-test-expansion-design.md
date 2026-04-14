# Discovery Flow Test Expansion

Expand the `tests/discovery-flow/` test catalog to cover unsupported criteria, multi-turn conversations, suggested searches, and message quality. Fix existing tests with wrong or weak assertions.

## 1. Fix Existing Tests

### Wrong expected values

| Test ID | Problem | Fix |
|---|---|---|
| `seniority-senior-engineers` | Expects `seniorityLevelIds: ['120']` | Change to `excludeSeniorityLevelIds: ['110']` per prompt CRITICAL RULE |
| `negation-not-california` | Expects `seniorityLevelIds: ['120']` for "senior" | Change to `excludeSeniorityLevelIds: ['110']` |
| `category-fintech-startups` | "fintech startups" expects `needs_selection` | Change to `unsupported` — fintech is in UNSUPPORTED CRITERIA LIST |

### Tighten weak assertions

| Test ID | Add assertion |
|---|---|
| `role-devs` | `filters.role` containing "Engineer" or "Developer" |
| `role-ml-engineers` | `filters.role: 'Machine Learning Engineer'`, `roleSpecificity: 'narrow'` |
| `role-bankers` | `filters.role` containing "Banker" or banking role |
| `university-mit` | `filters.university: 'Massachusetts Institute of Technology'` |
| `university-cmu` | `filters.university: 'Carnegie Mellon University'` |
| `university-upenn` | `filters.university: 'University of Pennsylvania'` |
| `university-berkeley` | `filters.university: 'University of California, Berkeley'` |

### Other fixes

- `company-ambiguity` tests (chase, block, square): add `companyNameAmbiguous: true` assertion
- `seniority-staff`: add `linkedInFilters` assertion for `excludeSeniorityLevelIds: ['110']`
- `seniority-cxo`: recategorize from `linkedin-seniority` to `anti-category`
- `phrasing-who-works`: "designer" should be `advancedPath` with `functionIds: ['3']`, not `simplePath`
- `integrity-no-industry-ids`: "fintech engineers at Ramp" should expect `unsupported` (fintech triggers unsupported before ready)
- `edge-very-long`: rewrite query to remove "payments infrastructure" (unsupported skill), replace with purely filter-based terms

## 2. Type Changes

### `queries.ts`

**`ExpectedStatus`** — add `'unsupported'`.

**New fields on `ExpectedExtraction`:**
- `unsupportedCriteria?: string[]` — subset match, case-insensitive
- `suggestedAlternativeFilters?: Partial<DBFilters>` — validate reformulated filters
- `suggestedAlternativeLinkedInFilters?: Partial<LinkedInFilters>` — validate reformulated LinkedIn filters
- `suggestedAlternativeLabel?: string` — substring match on label
- `suggestedSearchesMin?: number` — minimum suggested searches for ready status
- `messageContains?: string[]` — substrings message must contain
- `companyNameAmbiguous?: boolean` — validate ambiguity flag

**New fields on `DiscoveryTestCase`:**
- `conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>` — for multi-turn
- `currentFilters?: Partial<DBFilters>` — carried-over filters for multi-turn

### `run.ts`

**`LLMResponse`** — add `'unsupported'` to status union.

**`ExtractionOutcome`** — add:
- `'unsupported'` to status union
- `unsupportedCriteria: string[]`
- `suggestedAlternative: { label: string; filters: DBFilters; linkedInFilters: LinkedInFilters } | null`
- `suggestedSearches: Array<{ label: string; company: string; role: string | null }>`
- `message: string`

**`runExtraction()`** — accept `conversationHistory` and `currentFilters` params, pass to LLM call. Capture `unsupported_criteria`, `suggested_alternative`, `suggested_searches`, `message` on outcome.

**`validateExtraction()`** — add checks for:
- `unsupportedCriteria` subset match
- `suggestedAlternativeFilters` / `suggestedAlternativeLinkedInFilters`
- `suggestedAlternativeLabel` substring
- `suggestedSearchesMin` count
- `messageContains` substrings
- `companyNameAmbiguous` flag

## 3. New Test Cases (~30 queries)

### 20. Unsupported — degree type (3)

- `"PhD data scientists at Google"` → unsupported, criteria: ["PhD"], alternative keeps Data Scientist at Google
- `"MBA grads at McKinsey"` → unsupported, criteria: ["MBA"], alternative keeps McKinsey
- `"Masters students at Meta"` → unsupported, criteria: ["Masters"], alternative keeps Meta

### 21. Unsupported — skills/technologies (3)

- `"Python engineers at Stripe"` → unsupported, criteria: ["Python"], alternative keeps engineers at Stripe
- `"React developers at Meta"` → unsupported, criteria: ["React"], alternative keeps Meta
- `"people who know Kubernetes at Google"` → unsupported, criteria: ["Kubernetes"], alternative keeps Google

### 22. Unsupported — compensation (2)

- `"engineers making $200k+ at Google"` → unsupported, criteria: ["$200k"], alternative keeps engineers at Google
- `"high paying PM jobs in SF"` → unsupported, criteria: ["paying"], alternative keeps PM + SF

### 23. Unsupported — work mode (2)

- `"remote engineers at Stripe"` → unsupported, criteria: ["remote"], alternative keeps engineers at Stripe
- `"hybrid PMs at Google in NYC"` → unsupported, criteria: ["hybrid"], alternative keeps PM + Google + NYC

### 24. Unsupported — other (3)

- `"H1B engineers at Meta"` → unsupported, criteria: ["H1B"], alternative keeps engineers at Meta
- `"engineers at Google who are hiring"` → unsupported, criteria: ["hiring"], alternative keeps engineers at Google
- `"CFA holders at Goldman Sachs"` → unsupported, criteria: ["CFA"], alternative has `functionIds: ["10"]`

### 25. Unsupported — reformulation quality (4)

- `"Series B engineers in Austin"` → unsupported, alternative has `companyHeadcount: ["D","E"]` + location Austin, label readable
- `"CPA accountants at Deloitte"` → unsupported, alternative has `functionIds: ["1"]`, label like "Accountants at Deloitte"
- `"PMP project managers at IBM"` → unsupported, alternative has `functionIds: ["20"]`, label readable
- `"fintech PMs in NYC"` → unsupported, alternative keeps PM + NYC, messageContains: ["fintech", "industry"]

### 26. Multi-turn — filter swap (3)

- History: user="PMs at Google" → Follow-up: `"try engineers instead"`, currentFilters: `{company: 'Google', role: 'Product Manager'}` → ready, company stays Google, role changes to engineer
- History: user="engineers at Stripe" → Follow-up: `"what about Meta?"`, currentFilters: `{company: 'Stripe'}` → ready, company changes to Meta
- History: user="PMs at Google in SF" → Follow-up: `"try NYC instead"`, currentFilters: `{company: 'Google', role: 'Product Manager', location: 'San Francisco, California'}` → ready, location changes to NYC, company+role persist

### 27. Multi-turn — filter persistence (2)

- History: user="engineers at Google in SF" → Follow-up: `"try Apple"`, currentFilters: `{company: 'Google', location: 'San Francisco, California'}` → ready, company=Apple, location persists as SF
- History: user="Stanford alumni at Stripe" → Follow-up: `"try MIT instead"`, currentFilters: `{company: 'Stripe', university: 'Stanford University'}` → ready, company=Stripe persists, university changes to MIT

### 28. Suggested searches (4)

- `"PMs at Google"` → ready, `suggestedSearchesMin: 2`
- `"designers at Figma"` → ready, `suggestedSearchesMin: 2`
- `"analysts at Goldman Sachs"` → ready, `suggestedSearchesMin: 2`
- `"people at Stripe"` → ready, `suggestedSearchesMin: 1`

### 29. Message quality (4)

- `"how is the weather?"` → off_topic, `messageContains: ["professional contacts", "Try"]`
- `"hello!"` → off_topic, `messageContains: ["help", "find"]`
- `"PhD engineers at Google"` → unsupported, `messageContains: ["can't filter", "degree"]`
- `"consultants at MBB"` → needs_selection, `messageContains: ["Which"]`

## 4. Files Changed

- `tests/discovery-flow/queries.ts` — type changes + fix existing + add new test cases
- `tests/discovery-flow/run.ts` — type changes + validator additions + multi-turn support

## 5. Run Command

```bash
npx tsx tests/discovery-flow/run.ts --extract-only
```

Cost per run: ~$0.50 (LLM extraction only, no Apify/DB search).
