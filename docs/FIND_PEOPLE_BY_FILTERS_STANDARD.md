# Validation Standard: `findPeopleByFilters`

You are the validation agent. Your job is to test the `findPeopleByFilters` function and all its sub-methods against this standard. A method passes only if it meets every requirement listed for it. You have budget for thousands of test queries — use them. Batch aggressively.

---

## EXECUTION ORDER

Run these phases in order. If a phase fails, STOP and report. Do not continue to the next phase.

```
PHASE 1: Role Classification Bank       → 100% pass required to continue
PHASE 2: Hard Filter Isolation Tests     → all pass required to continue
PHASE 3: Filter Composition Tests        → all pass required to continue
PHASE 4: Data Quality & Dedup Tests      → all pass required to continue
PHASE 5: Reliability & Edge Case Tests   → all pass required to continue
PHASE 6: Performance Tests               → all pass required to continue
PHASE 7: Contract & Observability Audit  → all pass required to continue
```

---

## FAILURE REPORT FORMAT

For every failed test, emit one JSON object:

```json
{
  "phase": 1,
  "test_id": "ROLE-BANK-0042",
  "method_under_test": "matchesRole",
  "input": { "searchTerm": "Software Engineer", "broadness": "standard", "candidateTitle": "DevOps Engineer" },
  "expected": "NO_MATCH",
  "actual": "MATCH",
  "severity": "BLOCKING",
  "fix_hint": "matchesRole is too permissive — 'Engineer' substring match is catching unrelated disciplines"
}
```

Severity levels:
- `BLOCKING` — fails the phase, stops all testing
- `DEGRADED` — passes the phase but must be logged for the coding agent to fix before final sign-off

---

## PHASE 1: ROLE CLASSIFICATION BANK

**What:** Test the role matching logic against a pre-classified ground truth dataset.
**Methods under test:** `matchesRole(searchTerm, broadness, candidateTitle) → boolean`
**Pass criteria:** 100%. Every entry. Zero tolerance.

### 1A. Build the Bank

The bank lives at `tests/fixtures/role-classification-bank.json`. If it doesn't exist or has < 1,000 entries, you must generate it before testing. Generate entries using this schema:

```typescript
interface RoleClassificationEntry {
  id: string;                    // e.g., "ROLE-BANK-0001"
  searchTerm: string;            // What the user searched for
  broadness: "narrow" | "standard" | "broad";
  candidateTitle: string;        // Title on the person's profile
  expected: "MATCH" | "NO_MATCH";
  category: string;              // Why: "exact" | "seniority_variant" | "synonym" | "specialization" | "adjacent_discipline" | "keyword_trap" | "management_role" | "abbreviation" | "regional_variant" | "emerging_title" | "intern_fellow" | "company_specific" | "cross_functional"
}
```

### 1B. Coverage Requirements

| Broadness | Min Entries | Min Distinct Search Terms | Min Positive per Term | Min Negative per Term |
|-----------|-------------|--------------------------|----------------------|----------------------|
| narrow    | 300         | 30                       | 5                    | 5                    |
| standard  | 400         | 25                       | 8                    | 8                    |
| broad     | 300         | 15                       | 10                   | 10                   |

### 1C. Required Search Terms (minimum — add more)

**Narrow (30+):** iOS Engineer, Android Engineer, Site Reliability Engineer, DevOps Engineer, ML Engineer, Data Engineer, Platform Engineer, Security Engineer, Embedded Engineer, Firmware Engineer, Quantitative Researcher, Quantitative Analyst, UX Researcher, UX Designer, Product Designer, Brand Designer, Growth Marketing Manager, Content Marketing Manager, Corporate Lawyer, Tax Accountant, Financial Analyst, Investment Banker, Management Consultant, Strategy Consultant, Technical Program Manager, Scrum Master, Solutions Architect, Cloud Architect, Network Engineer, Database Administrator

**Standard (25+):** Software Engineer, Product Manager, Data Scientist, Designer, Marketing Manager, Sales Representative, Account Executive, Business Analyst, Project Manager, HR Manager, Operations Manager, Recruiter, Customer Success Manager, Content Writer, Copywriter, Graphic Designer, Mechanical Engineer, Civil Engineer, Electrical Engineer, Chemical Engineer, Nurse, Teacher, Accountant, Lawyer, Consultant

**Broad (15+):** Engineer, Designer, Analyst, Manager, Consultant, Developer, Scientist, Director, Coordinator, Specialist, Associate, Administrator, Strategist, Researcher, Architect

### 1D. Required Edge Case Categories (each must have ≥ 20 entries in the bank)

| Category | What It Tests | Example |
|----------|--------------|---------|
| `seniority_variant` | Seniority prefixes/suffixes don't break matching | "Staff Software Engineer" MATCH for "Software Engineer" standard |
| `synonym` | Known synonyms resolve | "SDE" MATCH for "Software Engineer" standard |
| `adjacent_discipline` | Similar-sounding but wrong discipline rejected | "DevOps Engineer" NO_MATCH for "Software Engineer" standard |
| `keyword_trap` | Shared keywords don't cause false matches | "Software Engineering Recruiter" NO_MATCH for "Software Engineer" standard |
| `management_role` | IC vs management boundary respected | "Engineering Manager" NO_MATCH for "Software Engineer" standard |
| `abbreviation` | Common abbreviations work | "PM" MATCH for "Product Manager" standard |
| `regional_variant` | International title conventions work | "Software Developer" MATCH for "Software Engineer" standard |
| `emerging_title` | New/trending titles classified correctly | "AI Engineer" — classify per broadness |
| `cross_functional` | Hybrid roles classified explicitly | "Technical Product Manager" — classify per broadness |
| `company_specific` | Company jargon doesn't cause false matches | "Googler" NO_MATCH for "Software Engineer" standard |
| `intern_fellow` | Intern/Fellow variants classified explicitly | "Software Engineer Intern" — classify per broadness |
| `specialization` | Role + team/domain suffix still matches | "Software Engineer, Backend" MATCH for "Software Engineer" standard |

### 1E. How to Run

```
FOR each entry in role-classification-bank.json:
  result = matchesRole(entry.searchTerm, entry.broadness, entry.candidateTitle)
  IF result !== entry.expected:
    EMIT failure report with severity=BLOCKING

IF any failures: STOP. Do not proceed to Phase 2.
```

You may batch these — call `matchesRole` in loops of 100+ for efficiency. The entire bank should complete in seconds since this is pure logic with no I/O.

---

## PHASE 2: HARD FILTER ISOLATION TESTS

**What:** Test each hard filter in isolation with hundreds of queries against real data.
**Methods under test:** `buildPersonWhereClause`, `resolveCompanyAliases`, `resolveUniversityAbbreviation`, `findPeopleByFilters`
**Pass criteria:** Precision must meet the targets below. Sample size must be statistically meaningful.

### 2A. Test Protocol

For each filter type:
1. Pick N distinct filter values (see table below)
2. For each value, call `findPeopleByFilters` with ONLY that filter, `limit: 50`
3. For each returned person, classify as CORRECT or INCORRECT
4. Compute precision = correct / total_returned
5. Aggregate precision across all values for that filter

You can batch: run all queries for a filter type in parallel, then validate results in bulk.

### 2B. Hard Filter Targets

| Filter | ID | Precision Target | Min Test Values | Min Total Results Validated | How to Validate |
|--------|----|-----------------|-----------------|---------------------------|-----------------|
| Company (exact) | HF-COMPANY-EXACT | ≥ 99.5% | 30 companies | 500+ | `person.company` matches input (case-insensitive) OR is a known alias |
| Company (alias) | HF-COMPANY-ALIAS | ≥ 98% | 20 companies × 3 alias variants each | 500+ | All alias variants return overlapping result sets (≥ 97% overlap) |
| Location (city) | HF-LOCATION-CITY | ≥ 99% | 20 cities | 400+ | `person.city` matches input city or recognized metro-area city |
| Location (state) | HF-LOCATION-STATE | ≥ 99.5% | 10 states | 300+ | `person.state` matches input state |
| Location (country) | HF-LOCATION-COUNTRY | ≥ 99.9% | 5 countries | 200+ | `person.country` matches input country |
| University (exact) | HF-UNI-EXACT | ≥ 99% | 20 universities | 300+ | `person.schools` JSON contains the specified school |
| University (abbreviation) | HF-UNI-ABBREV | ≥ 97% | 20 abbreviations | 300+ | Abbreviation resolves to correct canonical name AND results match |

### 2C. Company Alias Overlap Test

For each of 20 companies with known aliases:
```
results_A = findPeopleByFilters({ company: "JPMorgan Chase" })
results_B = findPeopleByFilters({ company: "JP Morgan" })
results_C = findPeopleByFilters({ company: "J.P. Morgan" })

overlap = intersection(results_A, results_B, results_C) / union(results_A, results_B, results_C)
ASSERT overlap >= 0.97
```

### 2D. Ambiguity Detection Test

For each of these ambiguous inputs, the function must NOT silently pick one:
- "Amazon" (Amazon.com vs Amazon Salon)
- "Chase" (JPMorgan Chase vs Chase Coleman's firm)
- "Apple" (Apple Inc vs Apple Leisure Group)
- "Mercury" (Mercury Financial vs Mercury Insurance)
- "SMU" (Southern Methodist vs Singapore Management)
- "Georgia" (state vs university)
- "MIT" (Massachusetts vs Manipal or Madras)

Test: call with ambiguous input. Assert `filterWarnings` is non-empty OR a disambiguation prompt is returned. If it silently returns results for one interpretation: `severity=BLOCKING`.

### 2E. Failure Reporting

```
FOR each filter test:
  IF precision < target:
    EMIT failure report with:
      severity = BLOCKING
      test_id = filter ID (e.g., "HF-COMPANY-EXACT")
      input = { filter_value, results_count, correct_count, incorrect_count }
      fix_hint = list of specific incorrect results with why they're wrong
```

---

## PHASE 3: FILTER COMPOSITION TESTS

**What:** Test that multiple filters AND together correctly and are never silently dropped.
**Methods under test:** `findPeopleByFilters`, `buildPersonWhereClause`
**Pass criteria:** 100% of composition tests pass. Zero silent filter drops.

### 3A. Composition Matrix

Generate and run ≥ 50 multi-filter queries using this combinatorial approach:

| Combo ID | Filters | What It Proves |
|----------|---------|----------------|
| COMP-2A-{1..10} | company + role (10 combos) | Two-filter AND works |
| COMP-2B-{1..10} | company + location (10 combos) | Two-filter AND works |
| COMP-2C-{1..5} | role + location (5 combos) | Two-filter AND works |
| COMP-2D-{1..5} | company + university (5 combos) | Two-filter AND works |
| COMP-3A-{1..10} | company + role + location (10 combos) | Three-filter AND works |
| COMP-3B-{1..5} | company + role + university (5 combos) | Three-filter AND works |
| COMP-4A-{1..5} | company + role + location + university (5 combos) | Four-filter AND works |

### 3B. Validation Rule

For every returned person in a multi-filter query:
```
FOR each person in results:
  FOR each filter in query:
    IF person does not match filter:
      EMIT failure with severity=BLOCKING
      test_id = combo ID
      fix_hint = "Person {name} at {company} does not match filter {filter}={value}"
```

### 3C. Silent Drop Detection

For each multi-filter query, also run the same query with each filter removed one at a time:
```
full_results = findPeopleByFilters({ company: "Stripe", role: "SWE", location: "NYC" })
no_company = findPeopleByFilters({ role: "SWE", location: "NYC" })
no_role = findPeopleByFilters({ company: "Stripe", location: "NYC" })
no_location = findPeopleByFilters({ company: "Stripe", role: "SWE" })

ASSERT full_results is a SUBSET of each single-removed variant
IF full_results == no_company: BLOCKING — company filter was silently dropped
IF full_results == no_role: BLOCKING — role filter was silently dropped
IF full_results == no_location: BLOCKING — location filter was silently dropped
```

Run this for ≥ 10 three-filter combos.

### 3D. False Negative Test (Seeded Data)

Insert 100 known people into DB with controlled attributes. Run 20 filter combos. Assert exact expected result sets.
```
FOR each combo:
  expected_ids = manually computed set of person IDs that match all filters
  actual_ids = findPeopleByFilters(combo).people.map(p => p.id)
  ASSERT expected_ids == actual_ids (order-independent)
  IF missing: EMIT failure — false negative
  IF extra: EMIT failure — false positive
```

---

## PHASE 4: DATA QUALITY & DEDUP TESTS

**Methods under test:** `findPeopleByFilters`, dedup logic, ranking logic
**Pass criteria:** All tests pass.

### 4A. Deduplication (≥ 20 tests)

Insert intentional duplicates into DB:
- Same person, different `company` spelling (e.g., "Google" vs "Google LLC")
- Same person, different `Person.id` but same `linkedinUrl`
- Same person, same name + company but no LinkedIn URL

```
FOR each duplicate set:
  results = findPeopleByFilters(query that matches duplicate)
  count = results matching this person
  ASSERT count == 1
  IF count > 1: EMIT failure, severity=BLOCKING
```

### 4B. Email Ordering (≥ 10 tests)

```
results = findPeopleByFilters(query)
FOR i in 0..results.length-2:
  IF results[i].emailStatus == "MISSING" AND results[i+1].emailStatus == "VERIFIED":
    EMIT failure, severity=BLOCKING, fix_hint="MISSING-email person ranked above VERIFIED"
```

### 4C. Bounced Email Exclusion (≥ 5 tests)

```
results_default = findPeopleByFilters({ ...filters })
results_with_bounced = findPeopleByFilters({ ...filters, includeBouncedEmails: true })

FOR person in results_default:
  ASSERT person.emailDeliverable !== false
  IF person.emailDeliverable === false: EMIT failure, severity=BLOCKING

ASSERT results_with_bounced.length >= results_default.length
```

### 4D. Exclusion Honoring (≥ 10 tests)

```
first_run = findPeopleByFilters({ ...filters })
excluded_id = first_run.people[0].id
second_run = findPeopleByFilters({ ...filters, excludePersonIds: [excluded_id] })

ASSERT excluded_id NOT IN second_run.people.map(p => p.id)
IF present: EMIT failure, severity=BLOCKING
```

---

## PHASE 5: RELIABILITY & EDGE CASE TESTS

**Methods under test:** `findPeopleByFilters`, fallback logic, error handling
**Pass criteria:** All tests pass.

### 5A. Graceful Degradation (6 tests)

| Test ID | Simulate | Expected Behavior | Assert |
|---------|----------|-------------------|--------|
| REL-01 | Company URL resolution fails | Returns DB results + filterWarning | `filterWarnings.length > 0` AND `people.length >= 0` (no throw) |
| REL-02 | LinkedIn API timeout | Returns DB results + filterWarning | Response within 15s AND `filterWarnings` mentions timeout |
| REL-03 | LinkedIn API 429 | Returns DB results + filterWarning | No throw AND `filterWarnings` mentions rate limit |
| REL-04 | LinkedIn API returns 0 | Returns DB results (even if few) | No throw AND no empty-error |
| REL-05 | DB connection pool full | Throws typed error | Error code == `DB_CONNECTION_FAILED` |
| REL-06 | Alias resolution fails | Uses exact name + filterWarning | `filterWarnings.length > 0` AND results use exact company name |

### 5B. Idempotency (10 tests)

```
FOR each of 10 distinct queries:
  results = []
  REPEAT 5 times:
    results.push(findPeopleByFilters(query))
  ASSERT all 5 result sets have identical IDs in identical order
  IF any differ: EMIT failure, severity=BLOCKING
```

### 5C. Concurrency (1 test, 10 parallel calls)

```
queries = [10 distinct filter sets]
results = await Promise.all(queries.map(q => findPeopleByFilters(q)))

FOR i in 0..9:
  FOR person in results[i].people:
    ASSERT person matches queries[i] filters
    IF person matches queries[j] where j != i: EMIT failure, severity=BLOCKING, fix_hint="Cross-contamination"
```

### 5D. Empty Results (5 tests)

Query with impossible filter combos (e.g., company="zzznonexistent123"). Assert:
- Returns `{ people: [], pagination: { totalAvailable: 0, returned: 0, hasMore: false } }`
- No throw
- `meta.path` is set correctly

### 5E. DB-First Exhaustion (5 tests)

```
// Seed DB with 50 people matching a query
results_25 = findPeopleByFilters({ ...filters, limit: 25 })
ASSERT results_25.meta.path == "db-only"
ASSERT results_25.meta.apiCostCents == 0

results_100 = findPeopleByFilters({ ...filters, limit: 100 })
ASSERT results_100.meta.dbResultCount >= 50
// API call is acceptable here since DB < limit
```

---

## PHASE 6: PERFORMANCE TESTS

**Pass criteria:** All benchmarks met.

### 6A. Latency Benchmarks

Run each benchmark ≥ 50 times to get stable percentiles.

| Test ID | Scenario | P50 | P95 | Hard Ceiling |
|---------|----------|-----|-----|-------------|
| PERF-01 | DB-only, single filter, warm cache | < 100ms | < 300ms | 1s |
| PERF-02 | DB-only, 4 filters combined | < 200ms | < 500ms | 1.5s |
| PERF-03 | DB + API fallback (1 page) | < 3s | < 5s | 10s |
| PERF-04 | Full pipeline (extraction → resolution → query) | < 4s | < 7s | 15s |

```
FOR each benchmark:
  latencies = []
  REPEAT 50 times:
    start = Date.now()
    findPeopleByFilters(benchmark_query)
    latencies.push(Date.now() - start)
  p50 = percentile(latencies, 50)
  p95 = percentile(latencies, 95)
  max = Math.max(...latencies)
  IF p50 > target OR p95 > target OR max > ceiling: EMIT failure, severity=BLOCKING
```

### 6B. Pagination Non-Degradation

```
page_latencies = []
FOR page in 1..20:
  start = Date.now()
  findPeopleByFilters({ ...filters, cursor: cursor_for_page })
  page_latencies.push(Date.now() - start)

ratio = page_latencies[19] / page_latencies[0]
ASSERT ratio < 2.0
IF ratio >= 2.0: EMIT failure, severity=BLOCKING, fix_hint="Pagination degrades — page 20 is {ratio}x slower than page 1"
```

### 6C. Concurrency Under Load

```
start = Date.now()
await Promise.all(Array(10).fill(null).map(() => findPeopleByFilters(random_query)))
elapsed = Date.now() - start

ASSERT elapsed < p95_target * 1.5
// 10 concurrent should not be more than 1.5x slower than a single call
```

---

## PHASE 7: CONTRACT & OBSERVABILITY AUDIT

**What:** Static analysis + runtime checks on types, logging, and cost tracking.
**Pass criteria:** All checks pass.

### 7A. TypeScript Contract

```
1. Compile with strict: true. Zero errors.
2. No `any` types in findPeopleByFilters signature, input type, or return type.
3. Return type matches this shape exactly:

interface FindPeopleByFiltersResult {
  people: PersonResult[];
  pagination: {
    totalAvailable: number;
    returned: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    path: "db-only" | "db+api" | "api-only";
    dbResultCount: number;
    apiResultCount: number;
    latencyMs: number;
    apiCostCents: number;
    confidenceTier: "high" | "medium" | "low";
    filterWarnings: string[];
    filtersApplied: Record<string, boolean>;
  };
}
```

Assert every field exists. Assert `filterWarnings` is `string[]` not `string | undefined`.

### 7B. Structured Logging

Run 5 queries with different filter combos. For each, capture logged output and assert:
```json
{
  "functionName": "findPeopleByFilters",   // MUST be present
  "filters": {},                            // MUST be present, PII-redacted
  "path": "db-only | db+api | api-only",   // MUST be present
  "dbResultCount": "number",                // MUST be present
  "apiResultCount": "number",               // MUST be present
  "totalReturned": "number",                // MUST be present
  "filterWarnings": "string[]",             // MUST be present (can be empty)
  "latencyMs": "number",                    // MUST be present, > 0
  "apiCostCents": "number",                 // MUST be present, >= 0
  "timestamp": "ISO8601"                    // MUST be present
}
```

Missing field = `severity=BLOCKING`.

### 7C. Cost Tracking

```
before = getSearchRecord(searchId).totalCostCents
findPeopleByFilters({ ...filters_that_trigger_api, searchId })
after = getSearchRecord(searchId).totalCostCents

ASSERT after > before
ASSERT after - before == result.meta.apiCostCents
IF not: EMIT failure, severity=BLOCKING
```

### 7D. Filter Warnings

Test that degraded paths emit warnings:
```
| Scenario | Assert |
|----------|--------|
| Company URL resolution fails | "Company URL not resolved" in filterWarnings |
| API timeout | "timeout" or "timed out" in filterWarnings |
| API rate limited | "rate limit" in filterWarnings |
| Alias resolution fails | "alias" or "exact name" in filterWarnings |
| Broad role used | confidenceTier == "medium" or "low" |
| Soft filter used (seniority, function) | confidenceTier reflects reduced confidence |
```

### 7E. Confidence Tier Accuracy

```
// Hard filters only → high
result = findPeopleByFilters({ company: "Stripe", location: "NYC" })
ASSERT result.meta.confidenceTier == "high"

// Soft filter included → medium or low
result = findPeopleByFilters({ company: "Stripe", seniorityLevelIds: ["300"] })
ASSERT result.meta.confidenceTier in ["medium", "low"]

// Broad role → medium
result = findPeopleByFilters({ company: "Stripe", role: "Engineer", roleSpecificity: "broad" })
ASSERT result.meta.confidenceTier == "medium"
```

---

## FINAL ACCEPTANCE CHECKLIST

The function is production-ready when ALL are true. Check these in order — first failure = not ready.

```
[ ] PHASE 1: Role classification bank exists with ≥ 1,000 entries AND passes at 100%
[ ] PHASE 2: All 7 hard filter tests pass at their precision targets across 500+ validated results each
[ ] PHASE 2: Ambiguity detection passes for all 7+ ambiguous inputs
[ ] PHASE 3: All 50+ composition tests pass with zero silent filter drops
[ ] PHASE 3: Seeded false-negative test passes with exact expected result sets
[ ] PHASE 4: Dedup, email ordering, bounce exclusion, and exclusion honoring all pass
[ ] PHASE 5: All 6 graceful degradation scenarios handled correctly
[ ] PHASE 5: Idempotency and concurrency tests pass
[ ] PHASE 5: DB-first exhaustion verified
[ ] PHASE 6: All latency benchmarks met at P50 and P95
[ ] PHASE 6: Pagination non-degradation ratio < 2.0
[ ] PHASE 7: TypeScript strict compilation, no `any` types
[ ] PHASE 7: Structured logging emits for every call
[ ] PHASE 7: Cost tracking increments correctly
[ ] PHASE 7: Filter warnings and confidence tiers accurate
```

**One unchecked box = NOT production-ready. Report all failures to the coding agent with the structured failure format above.**
