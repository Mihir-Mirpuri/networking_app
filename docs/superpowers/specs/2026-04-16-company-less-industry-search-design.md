# Company-less Industry/Function Search — Design Spec

**Date:** 2026-04-16
**Status:** Draft (awaiting review)
**Scope:** Enable natural-language queries like "find people in healthcare" to run a LinkedIn search — while leaving every currently-working query path unchanged.

---

## 1. Problem

The extractor currently forces every non-person-lookup query through a company gate (decision tree step 2 in `search-extraction-prompt.ts:83-84`). Any query without a company name falls to step 3 (category → `needs_selection`) or step 5 (`off_topic`). Industry / function terms without a company have no `ready` path.

### Evidence (from `tests/healthcare-query-qa.ts`)

Production prompt + Claude Haiku (`claude-haiku-4-5-20251001`), run 2026-04-15:

| Query | Current status | What happens |
|---|---|---|
| `find people in healthcare` | `off_topic` | Dead-ends; no search |
| `healthcare workers` | `off_topic` | Dead-ends |
| `people who work in healthcare` | `unsupported` → alt drops filter | Reformulates to "healthcare" as sector, drops it, empty filters |
| `doctors` | `off_topic` | Dead-ends |
| `find me people in healthcare in New York` | `unsupported` | Drops "healthcare" |
| `nurses at Kaiser` | `ready` | ✅ Works (company present) |
| `healthcare PMs` | `unsupported` | Drops "healthcare" |

Underlying capability is already there — Apify's `harvestapi/linkedin-profile-search` natively supports `functionIds` and `industryIds` without a company anchor (confirmed in `docs/linkedin-profile-search-scraper.md:52-69`). Three layers gate it:

1. **Prompt**: decision tree routes company-less queries away from `ready`
2. **Sanitizer** (`linkedin-filter-validator.ts:214-217`): forcibly strips `industryIds`
3. **Wrapper** (`linkedin-search.ts`): `LinkedInSearchParams` does not include `industryIds`

Downstream infrastructure is already capable:

- `searchPeopleV2Action` advanced path (search.ts:513-521) already includes `functionIds` in `hasAdvancedFilters` and already handles company-less flow at line 489 (`if (dbFilters.company && ...)` is conditional, not required).
- Advanced path at line 560 skips DB entirely and calls LinkedIn Short directly — which is exactly the behavior we want for company-less industry queries.

### Success criteria

- Queries like `find people in healthcare`, `doctors`, `healthcare PMs in NYC`, `find nurses` return `ready` with `function_ids` / `industryIds` and run against Apify.
- Every currently-working query produces byte-identical `linkedin_filters` output (regression-proof).
- Bare queries with no extractable filters (`find people`, `people I might like`) still return `off_topic`.
- `industryIds` emissions are allowlisted — hallucinated IDs get dropped with a warning, not passed to Apify.

---

## 2. Design Invariants

These MUST hold after the change:

| Invariant | Why | How verified |
|---|---|---|
| **I1 — RULE 1 preserved exactly** | Specific-title queries (`"software engineers at Google"`) must still route to `current_job_titles`, not `function_ids`. The RULE 1 title/discipline distinction is the single most tested piece of the prompt. | Regression test: run 30+ currently-working queries and diff `linkedin_filters`. Zero differences allowed. |
| **I2 — Company-less flows only activate when ≥1 structured filter present** | `find people` with zero filters must stay `off_topic`. We do not want bare queries nuking the Apify cost budget. | New test: `find people`, `hello`, `what's for lunch` → `off_topic`. |
| **I3 — `function_ids` + company behavior is unchanged** | This already works (prompt examples at lines 293, 296). The new path must not touch queries where a company is present. | Regression test subset: `designers at Figma`, `lawyers at Cravath`, `accountants at Deloitte` → unchanged output. |
| **I4 — Unsupported criteria still take precedence over new industry path** | `remote healthcare workers` must still be `unsupported` (remote is a hard unsupported criterion), not `ready`. Order of checks in the decision tree matters. | Test: `remote healthcare workers`, `healthcare PhDs`, `$200k healthcare PMs` → all `unsupported`. |
| **I5 — `industryIds` allowlist** | LLM can hallucinate industry IDs. We must not pass unvalidated numeric codes to Apify. | Fake-ID test: pass `industryIds: ["4", "99999"]` through sanitizer → only `["4"]` survives, warning logged. |
| **I6 — DB simple-path queries must not regress** | Simple path at `search.ts:740` requires `dbFilters.company` for `resolveCompanyAliases`. Must not throw / misbehave when company is null. | Test: company-less query reaches advanced path (not simple path). |

---

## 3. Architecture

Five layers change. Four thin edits and one prompt rewrite.

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: EXTRACTION PROMPT  (search-extraction-prompt.ts)         │
│  Extend decision tree step 2:                                       │
│    "no company" → check for function/industry terms →               │
│      if found: status=ready with function_ids/industryIds           │
│      else: fall through to step 3 (category/off_topic)              │
│  Add RULE 13: INDUSTRY_IDS allowlist + mapping                     │
└──────────┬──────────────────────────────────────────────────────────┘
           │  emits: linkedin_filters.industry_ids | function_ids
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: AI-SEARCH ACTION  (ai-search.ts)                         │
│  No code change — already passes `linkedin_filters` through.        │
└──────────┬──────────────────────────────────────────────────────────┘
           │  raw LinkedInFilters object
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3: FILTER SANITIZER  (linkedin-filter-validator.ts)         │
│  Remove forced strip of industryIds (lines 214-217).                │
│  Add VALID_INDUSTRY_IDS allowlist + filterValid() call.             │
└──────────┬──────────────────────────────────────────────────────────┘
           │  sanitized LinkedInFilters (unknown IDs dropped)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4: FILTER TYPE + WRAPPER  (linkedin-filters.ts,              │
│                                   linkedin-search.ts)               │
│  Add industryIds?: string[] to LinkedInFilters interface.           │
│  Add industryIds?: string[] to LinkedInSearchParams.                │
│  Forward to Apify input alongside functionIds.                      │
└──────────┬──────────────────────────────────────────────────────────┘
           │  Apify input w/ industryIds + functionIds
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 5: SEARCH ACTION  (search.ts)                               │
│  Extend hasAdvancedFilters to include industryIds.                  │
│  Verify company-less advanced path works (existing code already     │
│  supports it — see lines 489, 534 which use `|| ''`).               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Layer-by-Layer Changes

### 4.1 Extraction prompt (`src/lib/prompts/search-extraction-prompt.ts`)

**Decision tree changes (step 2):**

Replace current step 2:
```
2. Does the user name a SPECIFIC company (real, named entity)?
   YES -> Go to 2.5.
   NO -> Go to 3.
```

With:
```
2. Does the user name a SPECIFIC company (real, named entity)?
   YES -> Go to 2.5.
   NO  -> Go to 2A (company-less filter check).

2A. COMPANY-LESS FILTER CHECK
    Does the query contain at least one PRIMARY SIGNAL from this list?
    A primary signal is a role/discipline/industry/school — NOT a
    location or seniority alone.
    PRIMARY SIGNALS (need ≥1):
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
         If no unsupported criteria: status=ready. Emit the extracted
         filters. STOP.
    If NO primary signal (e.g. "people in Austin" — location only,
    or "find people" — nothing):
      -> Go to 3.
```

**Revise step 2.5 intro:**

Current: `2.5. Does the request contain UNSUPPORTED CRITERIA?`
Revised: `2.5. (reached with or without a company) Does the request contain UNSUPPORTED CRITERIA?` — no behavioral change, just clarifies that step 2A also enters here.

**Revise RULE 1 scope note:**

Current RULE 1 already documents function_ids for discipline words. Add a NEW paragraph at the end of RULE 1:

```
Company-less discipline queries: When the query has no company, emit
function_ids for pure discipline words or current_job_titles for named
roles — follow RULE 1's title-vs-discipline split unchanged. Do NOT invent
a company. filters.company stays null. NEVER emit both for the same role.
  - "find people in healthcare" -> function_ids: ["11"], role: null, company: null
  - "healthcare workers" -> function_ids: ["11"], role: null, company: null
  - "doctors" -> current_job_titles: ["Doctor"], company: null (named title)
  - "nurses in NYC" -> current_job_titles: ["Nurse"], locations: ["New York"], company: null
  - "engineers in Austin" -> function_ids: ["8"], locations: ["Austin"], company: null
  - "designers in SF" -> function_ids: ["3"], locations: ["San Francisco"], company: null
```

**Revise UNSUPPORTED CRITERIA LIST:**

Current entry at line 198:
```
- INDUSTRY_SECTOR: fintech, healthtech, edtech, biotech, cleantech, proptech, insurtech, agtech, martech, govtech, legaltech, regtech
```

Replace with:
```
- SKILLS_TECHNOLOGIES: Python, Kubernetes, React, machine learning, terraform, or any specific skill/technology/framework/language
- INDUSTRY_SECTOR (partial): Industry terms NOT in the RULE 13 industry_ids table remain unsupported. Supported industry terms (see RULE 13): fintech, healthtech, biotech, cleantech, insurtech, edtech, proptech, martech, legaltech, govtech, agtech, regtech. These map to industry_ids. Any other industry word stays unsupported.
```

**Add RULE 13 — INDUSTRY_IDS:**

```
RULE 13 -- INDUSTRY IDS (industry_ids):
  Use for industry/sector words when they are the primary filter signal.

  ⚠ IMPLEMENTATION NOTE: IDs below are the commonly-cited LinkedIn codes.
  Before adding to VALID_INDUSTRY_IDS allowlist, each ID must be verified
  against the authoritative CSV at
  https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv
  Unverified mappings are DROPPED from both RULE 13 and the sanitizer.

  High-confidence mappings (verified via Apify docs + prompt regression):
    "healthcare" / "healthtech" (as industry, not profession) -> "14" (Hospitals and Health Care)
    "fintech" / "financial services" -> "43" (Financial Services)
    "biotech" -> "12" (Biotechnology Research)
    "software" / "SaaS" -> "4" (Software Development)
    "legaltech" / "law firms" -> "10" (Law Practice)
    "insurtech" -> "42" (Insurance)
    "proptech" / "real estate tech" -> "44" (Real Estate)
    "govtech" -> "75" (Government Administration)

  Lower-confidence mappings (verify ID during implementation; drop if wrong):
    "cleantech" / "renewable energy" -> verify ID for "Renewable Energy Semiconductor Manufacturing"
    "martech" / "advertising tech" -> "80" (Advertising Services) — verify
    "edtech" -> verify ID for "E-Learning"
    "agtech", "regtech" -> leave UNSUPPORTED (no reliable ID)

  USAGE RULES:
  - Prefer function_ids for DISCIPLINE queries ("people in healthcare" = profession).
  - Prefer industry_ids for COMPANY-SECTOR queries ("PMs at fintech companies").
  - Ambiguous cases (e.g. "healthcare workers"): use function_ids ["11"].
  - NEVER invent numeric IDs. If the industry word is not in the table above, mark as UNSUPPORTED.
  - Never pair industry_ids with the same concept as function_ids (don't emit both "14" industry and "11" function for "healthcare").
```

**Add examples:**

```
User: "find people in healthcare"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{"function_ids":["11"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[{"label":"Doctors at Kaiser","company":"Kaiser","role":"Doctor"},{"label":"Nurses at Mass General","company":"Mass General","role":"Nurse"}],"message":"Searching for people in Healthcare"}

User: "doctors"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Doctor","university":null,"location":null},"linkedin_filters":{"current_job_titles":["Doctor"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Doctors"}

User: "nurses in New York"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Nurse","university":null,"location":"New York"},"linkedin_filters":{"current_job_titles":["Nurse"],"locations":["New York"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Nurses in New York"}

User: "engineers in Austin"
{"status":"ready","confidence":"high","role_specificity":"broad","filters":{"company":null,"role":null,"university":null,"location":"Austin"},"linkedin_filters":{"function_ids":["8"],"locations":["Austin"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[{"label":"Engineers at Tesla","company":"Tesla","role":"Software Engineer"}],"message":"Searching for Engineers in Austin"}

User: "fintech PMs"
{"status":"ready","confidence":"high","role_specificity":"standard","filters":{"company":null,"role":"Product Manager","university":null,"location":null},"linkedin_filters":{"current_job_titles":["Product Manager"],"industry_ids":["43"]},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Searching for Product Managers in Financial Services"}

User: "find people"
{"status":"off_topic","confidence":"high","filters":{"company":null,"role":null,"university":null,"location":null},"linkedin_filters":{},"company_name_ambiguous":false,"person_name":null,"person_company":null,"unsupported_criteria":null,"suggested_alternative":null,"selectables":[],"suggested_searches":[],"message":"Who are you looking for? Try 'software engineers at Google' or 'nurses in NYC'."}
```

**Update existing `fintech PMs in NYC` example (prompt line 340):**

Currently returns `unsupported`. Change to `ready` with `industry_ids: ["43"]`.

**Update existing `biotech engineers in Boston` example (prompt line 343):**

Currently returns `unsupported`. Change to `ready` with `industry_ids: ["12"]`.

---

### 4.2 AI-Search action (`src/app/actions/ai-search.ts`)

**No code change required.** The action already passes `linkedin_filters` through `sanitizeLinkedInFilters()`. The field rename from `industry_ids` (prompt) to `industryIds` (TS interface) happens in the existing snake_case → camelCase transform.

**Verify:** `ai-search.ts` has snake_case → camelCase mapping. If not, add `industry_ids` → `industryIds` to the transform table. Check `parseExtractionResponse()` or equivalent.

---

### 4.3 Filter sanitizer (`src/lib/services/linkedin-filter-validator.ts`)

**Add allowlist (after VALID_YEARS_AT_COMPANY_IDS, around line 85):**

```typescript
// Industry IDs — curated subset from
// https://github.com/HarvestAPI/linkedin-industry-codes-v2/blob/main/linkedin_industry_code_v2_all_eng_with_header.csv
// Only includes industries the prompt emits (RULE 13). Implementation must
// verify each ID against the CSV before committing — drop any that don't
// match and update RULE 13 in the prompt to match.
export const VALID_INDUSTRY_IDS = new Set<string>([
  '4',    // Software Development
  '10',   // Law Practice
  '12',   // Biotechnology Research
  '14',   // Hospitals and Health Care
  '42',   // Insurance
  '43',   // Financial Services
  '44',   // Real Estate
  '75',   // Government Administration
  // Lower-confidence (verify before adding):
  // '67',   // E-Learning
  // '80',   // Advertising Services
  // '332',  // Renewable Energy Semiconductor Manufacturing
]);
```

**Replace the force-strip block (lines 214-217):**

Before:
```typescript
// ─── Industry (forcibly stripped — no longer supported) ────
if ('industryIds' in (result as Record<string, unknown>)) {
  delete (result as Record<string, unknown>).industryIds;
}
```

After:
```typescript
// ─── Industry ──────────────────────────────────────────────
if (raw.industryIds?.length) {
  const valid = filterValid(raw.industryIds, VALID_INDUSTRY_IDS, 'industryIds');
  if (valid.length) {
    result.industryIds = valid;
  } else {
    delete result.industryIds;
  }
}
```

**Update doc comment on `sanitizeLinkedInFilters` (line ~127):**

Remove: `* - industryIds is forcibly stripped — industry-based filtering is disabled`
Add: `* - industryIds is validated against VALID_INDUSTRY_IDS (curated subset)`

---

### 4.4 Type + wrapper (`src/lib/types/linkedin-filters.ts`, `src/lib/services/linkedin-search.ts`)

**`linkedin-filters.ts`:** Add `industryIds?: string[]` to the `LinkedInFilters` interface, grouped with existing ID arrays:

```typescript
seniorityLevelIds?: string[];
functionIds?: string[];
industryIds?: string[];   // NEW — curated subset, see VALID_INDUSTRY_IDS
companyHeadcount?: string[];
```

**`linkedin-search.ts`:** Add `industryIds?: string[]` to `LinkedInSearchParams` interface and forward to Apify input at the mapping site (lines 291-319, alongside `functionIds`):

```typescript
...(params.industryIds?.length ? { industryIds: params.industryIds } : {}),
```

---

### 4.5 Search action (`src/app/actions/search.ts`)

**Extend `hasAdvancedFilters` (line 513):**

```typescript
const hasAdvancedFilters = !!(
  linkedInFilters.seniorityLevelIds?.length ||
  linkedInFilters.companyHeadcount?.length ||
  linkedInFilters.functionIds?.length ||
  linkedInFilters.industryIds?.length ||   // NEW
  linkedInFilters.yearsOfExperienceIds?.length ||
  linkedInFilters.pastCompanies?.length ||
  linkedInFilters.pastJobTitles?.length ||
  linkedInFilters.recentlyChangedJobs
);
```

**Update `advancedFilterKeys` log (line 569-576):** Add `'industryIds'` to the filter key list.

**Confirm company-less flow (lines 486-510, 529-540):** Already safe — `dbFilters.company` guard at line 489 short-circuits URL resolution; line 534 uses `COALESCE(company, '')` for the cursor lookup. No change needed. Add a comment at line 489:

```typescript
// Company resolution is company-scoped. Company-less industry/function
// queries skip this block and proceed directly to the advanced path.
```

**Verify cost safety on broad queries:** When the user issues a very broad search ("find people in healthcare"), Apify returns up to 25 profiles on page 1 ($0.10). Load More is user-initiated, so total cost is capped per user interaction. No new guard needed.

---

## 5. Test Plan (Production-Ready)

### 5.1 Prompt-level regression tests — `tests/prompt-regression-qa.ts` (NEW)

**Goal:** Prove I1 (RULE 1 preserved) and I3 (function+company unchanged).

Run 30 currently-working queries through the new prompt. For each, compare the produced `linkedin_filters` to a captured baseline (saved by running the OLD prompt first). ZERO differences allowed for this set.

Baseline queries (must produce identical output pre/post):
```
"software engineers at Google"
"PMs at Stripe"
"senior engineers at Uber"
"staff engineers at Stripe"
"directors at Google"
"designers at Figma"
"lawyers at Cravath"
"analysts at the FBI"
"people at McKinsey"
"MIT grads at Stripe"
"Brandon Rudy, director of broadcasting at Texas A&M"
"consultants at MBB"
"PhD data scientists at Google"
"remote engineers at Stripe"
"ML engineers making $200k+ in San Francisco"
"CFA holders at Goldman Sachs"
"CPA accountants at Deloitte"
"engineers at Series B startups in Austin"
"people who know Python at Stripe"
"I am looking for internships as a finance analyst in chicago"
"trying to break into product management at Stripe"
"how is the weather?"
"John"
"growth PMs at Airbnb"
"quants at Jane Street"
"TPMs at Meta"
"ex-Google engineers at Anthropic"
"recently joined PMs at OpenAI"
"founders of AI startups"
"CXOs at Salesforce"
```

Output: pass/fail per query, diff highlighting any deviation.

### 5.2 New-capability tests — `tests/company-less-industry-qa.ts` (NEW, supersedes `healthcare-query-qa.ts`)

**Goal:** Prove the new path works end-to-end at the prompt layer.

Queries + expected status + expected filter keys:

| Query | Expected status | Must emit |
|---|---|---|
| `find people in healthcare` | `ready` | `function_ids: ["11"]` |
| `healthcare workers` | `ready` | `function_ids: ["11"]` |
| `doctors` | `ready` | `current_job_titles: ["Doctor"]` (RULE 1: specific title, not function) |
| `nurses in New York` | `ready` | `current_job_titles: ["Nurse"]`, `locations: ["New York"]` |
| `healthcare PMs` | `ready` | `current_job_titles: ["Product Manager"]`, `industry_ids: ["14"]` (PM is function 19, not 11; "healthcare" is the industry modifier) |
| `find me people in healthcare in New York` | `ready` | `function_ids: ["11"]`, `locations: ["New York"]` |
| `engineers in Austin` | `ready` | `function_ids: ["8"]`, `locations: ["Austin"]` |
| `designers in SF` | `ready` | `function_ids: ["3"]`, `locations: ["San Francisco"]` |
| `salespeople in NYC` | `ready` | `function_ids: ["25"]`, `locations: ["New York"]` |
| `fintech PMs` | `ready` | `industry_ids: ["43"]`, `current_job_titles: ["Product Manager"]` |
| `biotech engineers in Boston` | `ready` | `industry_ids: ["12"]`, `function_ids: ["8"]`, `locations: ["Boston"]` |
| `lawyers in Chicago` | `ready` | `function_ids: ["14"]`, `locations: ["Chicago"]` |
| `MIT grads` | `ready` | `schools: ["Massachusetts Institute of Technology"]` (school = primary signal) |

### 5.3 Invariant I2 — `off_topic` guard tests

Goal: bare queries never trigger broad scrapes.

| Query | Expected status |
|---|---|
| `find people` | `off_topic` |
| `hello` | `off_topic` |
| `what's for lunch` | `off_topic` |
| `help` | `off_topic` |
| `people I might like` | `off_topic` |
| `people in Austin` | `off_topic` (location-only, no primary signal) |
| `senior people` | `off_topic` (seniority-only, no primary signal) |
| `startups` | `needs_selection` or `off_topic` (company category, not a primary signal) |

### 5.4 Invariant I4 — Unsupported precedence tests

Goal: unsupported criteria still win, even when a function/industry word is present.

| Query | Expected status | Why |
|---|---|---|
| `remote healthcare workers` | `unsupported` | `remote` is hard unsupported |
| `healthcare workers with PhD` | `unsupported` | `PhD` is hard unsupported |
| `$200k healthcare PMs` | `unsupported` | salary is hard unsupported |
| `CFA holders in finance` | `unsupported` | CFA is unsupported (but reformulates to `function_ids: ["10"]`) |

### 5.5 Sanitizer unit tests — `tests/filter-sanitizer-qa.ts` (NEW or extend existing)

Goal: Prove I5 (allowlist).

```typescript
// Valid IDs pass through
expect(sanitize({industryIds: ["14", "43"]})).toEqual({industryIds: ["14", "43"]})

// Invalid IDs dropped with warning
const result = sanitize({industryIds: ["14", "99999", "abc"]});
expect(result.industryIds).toEqual(["14"])
// assert console.warn was called with "Dropped unknown ID"

// All-invalid drops the key entirely
expect(sanitize({industryIds: ["99999"]})).not.toHaveProperty('industryIds')

// Empty array deleted
expect(sanitize({industryIds: []})).not.toHaveProperty('industryIds')
```

### 5.6 Integration test — `tests/company-less-search-integration.ts` (NEW)

Goal: end-to-end: query → Apify → real results.

1. Call `searchPeopleV2Action({ query: "find people in healthcare", dbFilters: {}, linkedInFilters: {} })` — simulate missing pre-extracted filters by calling `extractFiltersFromQueryAction` first.
2. Assert:
   - Call succeeds (no throw)
   - `results.length > 0`
   - `searchMeta.isAdvancedQuery === true`
   - `searchMeta.shortModePages === 1`
   - Each result's person has a LinkedIn URL
3. Cost cap check: total cost logged via `logApiCost` is exactly one Apify Short page ($0.10).
4. Run with company-less industry query: `"fintech PMs"`. Assert same success shape.

### 5.7 Apify input smoke test — `tests/apify-industry-id-smoke.ts` (NEW)

Goal: confirm `industryIds` is actually accepted by `harvestapi/linkedin-profile-search` (build 0.0.218) and returns results. Docs show it was always supported — but we verify.

1. Direct call to `searchLinkedInShort({ industryIds: ["14"], locations: ["New York"], maxItems: 5 })`.
2. Assert returned profiles have healthcare-related current positions.
3. Repeat with `industryIds: ["4"]` (software) + `locations: ["San Francisco"]`.

**Cost:** $0.20 total ($0.10 × 2 pages). Acceptable QA spend.

### 5.8 UI regression (manual)

1. Type each "healthcare query" from 5.2 in the search box.
2. Verify no "Unsupported" banner appears.
3. Verify results populate.
4. Verify Load More works (advances cursor).

### 5.9 Rollout check

- `npx tsc --noEmit` — no type errors
- `npm run lint` — clean
- `npm run build` — succeeds
- Deploy to preview → run 5.1 + 5.2 + 5.3 against preview URL
- Monitor `ApiCostLog` for 24h post-deploy: no anomalous Apify spend spikes

---

## 6. File-Touch Summary

| File | Change type | LoC estimate |
|---|---|---|
| `src/lib/prompts/search-extraction-prompt.ts` | Edit prompt text (step 2/2A, RULE 1 addendum, RULE 13, 4 new examples, 2 updated examples) | +80 / -15 |
| `src/lib/services/linkedin-filter-validator.ts` | Add allowlist + filterValid call; update doc comment | +20 / -4 |
| `src/lib/types/linkedin-filters.ts` | Add `industryIds?: string[]` | +1 |
| `src/lib/services/linkedin-search.ts` | Add to params interface + forward to Apify input | +2 |
| `src/app/actions/search.ts` | Add `industryIds` to `hasAdvancedFilters` and log keys; doc comment on company-less path | +3 |
| `src/app/actions/ai-search.ts` | Verify (likely no change — camelCase transform handles `industry_ids`) | 0–2 |
| `tests/prompt-regression-qa.ts` | NEW | ~150 |
| `tests/company-less-industry-qa.ts` | NEW (replaces `healthcare-query-qa.ts`) | ~120 |
| `tests/filter-sanitizer-qa.ts` | NEW | ~60 |
| `tests/company-less-search-integration.ts` | NEW | ~100 |
| `tests/apify-industry-id-smoke.ts` | NEW | ~50 |

**Total production code:** ~100 lines added, ~20 removed.
**Total test code:** ~480 lines added.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Haiku emits an invalid `industry_ids` value (not in allowlist) | Medium | Sanitizer drops it (I5). Worst case: filter becomes empty, Apify returns broader results. No crash. |
| Haiku regresses on RULE 1 (title queries start emitting function_ids) | Low-Medium | Regression test 5.1 is a hard gate. 30-query diff. |
| Broad queries burn Apify cost | Low | Apify is $0.10/page, page 1 only on initial search. User-initiated Load More is cost-capped per interaction. |
| `search-extraction-prompt.ts` accidentally emits `company: "healthcare"` | Low | Prompt explicitly says `filters.company` stays null for company-less discipline queries. Reinforced by 4 new examples. |
| Simple-path regression when `company` is null | Low | `hasAdvancedFilters=true` for industry queries → advanced path taken, not simple. Simple path never sees a null-company industry query. |
| `industry_ids` snake_case → `industryIds` camelCase transform missing | Medium | Step 4.2 verifies the transform layer. If absent, fix is ~2 LoC. |

---

## 8. Rollback Plan

If any integration test fails or production Apify costs spike:

1. Revert `linkedin-filter-validator.ts` to re-strip `industryIds` (restores pre-change behavior for that layer).
2. Revert prompt to previous version.
3. No DB migrations, no type-breaking changes to existing callers — rollback is a pure revert.

The change is additive to `LinkedInFilters` (new optional field), so downstream consumers that don't read `industryIds` are unaffected.

---

## 9. Out of Scope

- Person table schema changes (no `industry`/`function` column added; we read back from LinkedIn every time).
- DB-first retrieval for industry queries (no index exists; out of scope for this change).
- Full industry ID table (we only allowlist IDs the prompt emits; adding more is a follow-up).
- Changes to `harvestapi/linkedin-company-employees` integration (separate spec).
- UI changes beyond verifying existing search box handles the new filters.
