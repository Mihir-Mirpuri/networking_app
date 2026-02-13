# Person Lookup — Implementation Plan

## Overview

A feature that lets users search for a specific person by name, find their LinkedIn profile via Google CSE, enrich their data (email, company, role, education) via Apollo, and send them a cold email — all from one focused UI.

**User story:** "I met Jane Smith from Goldman Sachs at a career fair. I want to find her email and reach out."

---

## CSE Experiment Results (18 people tested)

| Strategy | Find Rate | Avg Position | #1 Hits |
|---|---|---|---|
| Name only | 100% | 2.8 | 8/18 |
| "Name" quoted | 100% | 2.6 | 9/18 |
| Name + company | 89% | 1.0 | 16/16 |
| "Name" + "company" | 89% | 1.0 | 16/16 |

**Conclusion:** Use a two-pass strategy:
1. Try `site:linkedin.com/in "name" company` first — #1 hit 89% of the time
2. Fall back to `site:linkedin.com/in "name"` if 0 results — 100% find rate

Failures happened when the company name in the query didn't match how LinkedIn indexes it (e.g., "JPMorgan Chase" vs "JPMorgan"). Show top 3-5 results so the user can pick.

---

## What Actually Changes

The existing discovery pipeline (`discoverLinkedInProfiles` → `saveScrapedProfile` → `enrichPeopleOnDemand` → `buildResultsWithDrafts`) already handles CSE → enrich → draft generation. The only real difference for person lookup is **how the CSE query is constructed**.

### New code needed

| What | Where | Why | Size |
|---|---|---|---|
| `lookupByName()` | `discovery.ts` | Builds name-based CSE query instead of company-based | ~40 lines |
| `findPeopleByName()` | `person-service.ts` | DB lookup by name ILIKE (existing `findPeopleByFilters` requires company) | ~20 lines |
| `lookupPersonAction()` | `search.ts` | Thin server action: DB check → CSE → existing enrich/draft pipeline | ~80 lines |
| Wire up UI | `PersonLookup.tsx` | Connect to action + open ExpandedReview on select | ~60 lines modified |

### Reused as-is (no changes)

- `searchCSE()` — raw CSE API call
- `isLinkedInProfileUrl()`, `extractNameFromTitle()`, `parseExperienceCompany()` — result parsing
- `saveScrapedProfile()` — dedup + save Person record
- `enrichPeopleOnDemand()` — batch Apollo enrichment
- `buildResultsWithDrafts()` — UserCandidate + EmailDraft creation
- `ExpandedReview` component — email send/schedule UI
- `findPeopleByLinkedInUrls()` — check if CSE results already in DB

**No schema changes. No new dependencies. No migrations.**

---

## Architecture

### Flow

```
User types name + optional company
        │
        ▼
  ┌─────────────────────────┐
  │  1. Check DB first      │  ← findPeopleByName() — fast path if person exists
  │     (Person table by    │     with email already enriched
  │      name ILIKE match)  │
  └────────┬────────────────┘
           │  few/no DB results
           ▼
  ┌─────────────────────────┐
  │  2. CSE lookup          │  ← lookupByName() — new query builder
  │     Two-pass:           │     Pass 1: "name" + company
  │     with co, then w/o   │     Pass 2: "name" only (fallback)
  └────────┬────────────────┘
           │
           ▼
  ┌─────────────────────────┐
  │  3. Existing pipeline   │  ← saveScrapedProfile (dedup + save)
  │     saveScrapedProfile  │  ← enrichPeopleOnDemand (Apollo)
  │     enrichPeopleOnDemand│  ← buildResultsWithDrafts (draft gen)
  │     buildResultsWithDrafts
  └────────┬────────────────┘
           │
           ▼
  User picks the right person → ExpandedReview (existing) → Send email
```

### Key Difference from Discovery Search

| | Discovery Search | Person Lookup |
|---|---|---|
| **Intent** | "Find me people at Goldman Sachs" | "Find Jane Smith" |
| **CSE query** | `site:linkedin.com/in "Goldman Sachs"` | `site:linkedin.com/in "Jane Smith" Goldman Sachs` |
| **Results** | Many people, paginated | 3-5 candidates, user picks one |
| **Company** | Required (primary filter) | Optional (disambiguation) |
| **Everything else** | Same pipeline | Same pipeline |

---

## Implementation Steps

### Step 1: `lookupByName()` in discovery.ts

New function alongside existing `discoverLinkedInProfiles()`:

```typescript
export async function lookupByName(params: {
  name: string;
  company?: string;
}): Promise<CSEDiscoveryResult[]>
```

**Logic:**
1. If company provided, build query: `site:linkedin.com/in "${name}" ${company}`
2. Call existing `searchCSE(query)`
3. Filter to LinkedIn profile URLs (reuse `isLinkedInProfileUrl`)
4. Extract names from metatags/title (reuse `extractNameFromTitle`, `parseExperienceCompany`)
5. If 0 LinkedIn results AND company was provided, retry without company: `site:linkedin.com/in "${name}"`
6. Return top 5 `CSEDiscoveryResult`s

**Reuses:** `searchCSE()`, `isLinkedInProfileUrl()`, `extractNameFromTitle()`, `parseExperienceCompany()`

The result processing loop (filter URLs, extract metatags, build CSEDiscoveryResult) is the same as in `discoverLinkedInProfiles()` — can either extract a shared helper or inline it.

---

### Step 2: `findPeopleByName()` in person-service.ts

```typescript
export async function findPeopleByName(params: {
  name: string;
  company?: string;
  limit?: number;
}): Promise<PersonResult[]>
```

Simple Prisma query:
- `fullName` ILIKE `%name%`
- Optional `company` filter using existing `companiesMatch()` logic
- Order by emailStatus ASC (VERIFIED first), emailConfidence DESC
- Limit 5

Reuses existing `PersonResult` type (same return shape as `findPeopleByFilters`).

---

### Step 3: `lookupPersonAction()` in search.ts

```typescript
export async function lookupPersonAction(input: {
  name: string;
  company?: string;
  templateId: string;
}): Promise<LookupActionResult>
```

**Logic:**
1. Auth check (`getServerSession`)
2. Call `findPeopleByName({ name, company })` — check DB first
3. If DB returns 3+ results with emails → skip CSE, go to step 5
4. Call `lookupByName({ name, company })` → `saveScrapedProfile()` for each → `enrichPeopleOnDemand()`
5. Merge DB + CSE results, deduplicate by LinkedIn URL
6. Feed through existing `buildResultsWithDrafts()` for draft generation
7. Return `SearchResultWithDraft[]` (same type as discovery search)

**Returns the same `SearchResultWithDraft` type** so `ExpandedReview` works without modification.

---

### Step 4: Wire up PersonLookup.tsx

Changes to the existing skeleton:
- Import `lookupPersonAction`
- `handleSearch`: call the action, set results
- Add template selector (copy pattern from SearchForm)
- On result card click: set `expandedIndex`, render `ExpandedReview` with that result
- Reuse same `handleSendFromReview` pattern as `SearchPageClient`

`ExpandedReview` accepts `SearchResultWithDraft[]` — wrap results and pass through. All send/schedule/personalization works as-is.

---

## Edge Cases

1. **Common names (e.g., "John Smith")** — Show top 5 with company/role/location context so user can pick the right one. Name-only CSE still finds them (100% rate), just at varying positions.

2. **Name with suffixes (e.g., "Aisha Siddiqui, MBA, MHA")** — Strip common suffixes (MBA, CFA, PhD, etc.) before CSE query. DB ILIKE still matches the stored fullName.

3. **Company name mismatches** — "JPMorgan Chase" vs "JPMorgan". The two-pass fallback handles this: if company query fails, name-only retry succeeds.

4. **Person not on LinkedIn + not in DB** — Show empty state with redirect to Quick Send ("already have their email?").

5. **Duplicate results** — Same person from DB and CSE. Deduplicate by LinkedIn URL first, then fullName+company key. Prefer DB record (already enriched).

---

## What This Does NOT Include (Future)

- **CSV/bulk import** — Different feature; this is single-person lookup
- **Auto-complete/typeahead** — Could query DB as user types; add later if lookup is popular
- **Search history** — Tracking past lookups; not needed for v1
