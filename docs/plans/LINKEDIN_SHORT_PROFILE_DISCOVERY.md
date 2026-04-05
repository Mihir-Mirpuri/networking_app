# LinkedIn Short Profile Discovery — Migration Plan

## Overview

Replace the current Serper-based discovery flow (Google SERP → LinkedIn URLs → Apify full scrape) with a two-tier approach:
1. **Tier 1: Short Profile Search** — `harvestapi/linkedin-profile-search` in Short mode ($0.10/25 profiles, ~6s)
2. **Tier 2: Full Scrape on Demand** — Existing Apify actor ($0.004/profile, ~5-10s) triggered on profile click

Users type natural language queries. Haiku parses intent into structured LinkedIn filters. DB is queried first; API is called only when DB can't satisfy the query.

## Architecture

```
User types query
  → Haiku (parse to structured filters, ~0.5-1s)
  → DB query with DB-compatible filters (free)
  → Enough results? → Return
  → Not enough? → Short mode API ($0.10/25 profiles, ~6s)
  → Save short profiles to DB → Merge with DB results → Return
  → User clicks profile → Full scrape on demand ($0.004)
  → Load More → DB first, then next Short mode page ($0.10)
```

## Short Mode Response Shape

Each profile returns:
- `id` — LinkedIn internal ID
- `linkedinUrl` — encoded URL (not clean /in/slug)
- `firstName`, `lastName`
- `summary` — LinkedIn About section (optional, not always present)
- `currentPositions[]` — `companyName`, `title`, `current`, `tenureAtPosition`, `tenureAtCompany`, `startedOn`, `companyId`, `companyLinkedinUrl`
- `location.linkedinText` — raw text like "San Francisco, California, United States"
- `pictureUrl` — profile photo URL
- `openProfile`, `premium` — booleans
- `_meta.pagination` — `totalElements`, `totalPages`, `pageNumber`, `pageSize`

**Not returned in Short mode:** education, experience history, skills, about (inconsistent), clean LinkedIn URL slug.

## Filter Mapping

### DB-compatible filters (query Person table)
- role → Person.role
- company → Person.company (+ alias resolution)
- location → Person.city / Person.state / Person.country
- university → Person.schools (JSON array)
- years of experience → computed from Person.experienceHistory

### LinkedIn-only filters (API only, can't query in DB)
- `seniorityLevelIds` — In Training (100), Entry (110), Senior (120), Strategic (130), etc.
- `functionIds` — Engineering (8), Product Management (19), Sales (25), etc.
- `industryIds` — Software Development (4), Financial Services (43), etc.
- `companyHeadcount` — Self-employed (A), 1-10 (B), 11-50 (C), 51-200 (D), etc.
- `yearsAtCurrentCompanyIds`
- `profileLanguages`
- `recentlyChangedJobs`
- All exclude variants of the above

### University search strategy
When search includes a school filter:
- Short mode `schools` param filters server-side on LinkedIn
- All returned profiles are tagged with that school in DB (free education data)
- No education field in response, but we know the school from the filter

## Cost Analysis (1,000 concurrent users)

| | Current (Serper) | New (Short Mode) |
|---|---|---|
| Per new search | ~$0.05 | ~$0.113 |
| Per cached search | $0 | ~$0.012 (clicks) |
| Monthly (1K daily users) | ~$3K-6K | ~$10.8K |
| At 80% cache hit (mature DB) | ~$3K-6K | ~$6K |

## Rate Limits
- 300,000+ profiles/hour before rate limiting
- At 25 profiles/search = 12,000 unique searches/hour
- Rate limits reset hourly

## Cost Tracking

Every search tracks API usage and cost in real time. Stored per Search record for analytics/billing.

### Cost Constants
- Short mode page: $0.10 (25 profiles)
- Apify full scrape: $0.004 per profile
- Haiku query parse: ~$0.001 per call (input + output tokens)
- Serper call (legacy/fallback): $0.001 per call

### Tracked Per Search
- `haikuCalls` — number of Haiku parse calls
- `shortModePages` — number of Short mode pages fetched
- `fullScrapeCalls` — number of Apify full scrapes triggered
- `serperCalls` — legacy Serper calls (if fallback used)
- `totalCostCents` — computed total cost in cents (for easy aggregation)
- `costBreakdown` — JSON: `{ haiku: 0.001, shortMode: 0.10, fullScrape: 0.012, serper: 0 }`

### DB Schema Addition (Search model)
```prisma
haikuCalls          Int     @default(0)
shortModePages      Int     @default(0)
fullScrapeCalls     Int     @default(0)
totalCostCents      Float   @default(0)
costBreakdown       Json?
```

### Implementation
- Each service function (`searchLinkedInShort`, `parseSearchQuery`, `scrapeLinkedInProfiles`) returns a cost metric alongside its result
- The orchestrator (`searchPeopleAction`) accumulates costs and persists to the Search record
- Cost is computed at the action level, not the service level (services just report counts)

---

## Phase 1: New Search Service (No UI Changes)

### Goal
Build three standalone services — Short mode client, Haiku query parser with tool use, and company URL resolver. All testable in isolation, no existing code touched.

### Files to create

#### 1. `src/lib/services/linkedin-search.ts` — Short mode API client
- `searchLinkedInShort(params: LinkedInSearchParams): Promise<LinkedInSearchResult>`
- Calls `harvestapi/linkedin-profile-search` with `profileScraperMode: "Short"`
- Maps response to typed `ShortProfileResult` interface
- Returns parsed profiles + pagination metadata (`totalElements`, `totalPages`, `pageNumber`) + cost metrics

```typescript
// Return type
interface LinkedInSearchResult {
  profiles: ShortProfileResult[];
  pagination: {
    totalElements: number;
    totalPages: number;
    pageNumber: number;
    pageSize: number;
  };
  cost: { shortModePages: number; costCents: number };
}

// Per-profile shape (mapped from API response)
interface ShortProfileResult {
  linkedinId: string;              // "ACwAAD5JVk4B..."
  linkedinUrl: string;             // encoded URL from API
  firstName: string;
  lastName: string;
  fullName: string;                // computed: firstName + lastName
  summary: string | null;          // LinkedIn About section (optional)
  company: string | null;          // from currentPositions[0].companyName
  companyLinkedinUrl: string | null; // from currentPositions[0].companyLinkedinUrl
  role: string | null;             // from currentPositions[0].title
  tenureMonths: number | null;     // computed from tenureAtPosition
  startedOn: { month: number; year: number } | null;
  location: string | null;         // raw linkedinText
  city: string | null;             // parsed from location
  state: string | null;
  country: string | null;
  pictureUrl: string | null;
  openProfile: boolean;
  premium: boolean;
}

// Input params (maps to actor input)
interface LinkedInSearchParams {
  searchQuery?: string;
  locations?: string[];
  currentCompanies?: string[];     // LinkedIn company URLs
  pastCompanies?: string[];
  schools?: string[];
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  seniorityLevelIds?: string[];
  functionIds?: string[];
  industryIds?: string[];
  companyHeadcount?: string[];
  yearsOfExperienceIds?: string[];
  yearsAtCurrentCompanyIds?: string[];
  recentlyChangedJobs?: boolean;
  // Exclude filters
  excludeLocations?: string[];
  excludeCurrentCompanies?: string[];
  excludeIndustryIds?: string[];
  excludeSeniorityLevelIds?: string[];
  excludeFunctionIds?: string[];
  // Pagination
  startPage?: number;              // default 1
  takePages?: number;              // default 1
  maxItems?: number;
}
```

#### 2. `src/lib/services/company-resolver.ts` — Company name → LinkedIn URL resolver
- `resolveCompanyLinkedInUrl(companyName: string): Promise<{ url: string | null; cost: { serperCalls: number; costCents: number } }>`
- Uses Serper: `site:linkedin.com/company "companyName"` → extract first company URL
- Caches results in DB to avoid repeat lookups (company name → URL mapping)
- Cost: $0.001 per Serper call

```typescript
// DB cache table (new model)
model CompanyUrl {
  id        String   @id @default(cuid())
  name      String   // normalized company name (lowercase, trimmed)
  url       String   // LinkedIn company URL
  createdAt DateTime @default(now())
  @@unique([name])
}
```

#### 3. `src/lib/services/query-parser.ts` — Haiku query parser with tool use
- `parseSearchQuery(query: string): Promise<ParsedSearchResult>`
- Uses `ANTHROPIC_API_KEY` env var to call Claude Haiku (`claude-haiku-4-5-20251001`)
- Haiku has access to a `resolve_company_url` tool — when it encounters a company name (especially small/ambiguous ones), it calls the tool to get the LinkedIn company URL
- Returns structured filters split into `dbFilters` and `linkedInFilters` + cost metrics
- Handles edge cases (empty query, nonsensical input, etc.)

```typescript
// Return type
interface ParsedSearchResult {
  dbFilters: {
    role?: string;
    company?: string;
    location?: string;
    university?: string;
    minYearsExperience?: number;
  };
  linkedInFilters: {
    searchQuery?: string;
    locations?: string[];
    currentCompanies?: string[];     // resolved LinkedIn URLs
    schools?: string[];
    currentJobTitles?: string[];
    seniorityLevelIds?: string[];
    functionIds?: string[];
    industryIds?: string[];
    companyHeadcount?: string[];
    yearsOfExperienceIds?: string[];
    recentlyChangedJobs?: boolean;
  };
  cost: {
    haikuCalls: number;
    serperCalls: number;             // from company URL resolution
    costCents: number;
  };
}
```

**Haiku system prompt includes:**
- All LinkedIn filter IDs (seniority, function, industry, headcount reference tables)
- Instructions to use `resolve_company_url` tool for small/ambiguous companies
- Instructions to skip tool call for well-known companies (Google, Meta, Apple, etc.) and use `searchQuery` instead
- Instructions to map university names to proper forms (e.g., "UT" → "University of Texas at Austin")

**Tool definition:**
```typescript
tools: [{
  name: "resolve_company_url",
  description: "Look up the LinkedIn company page URL for a company name. Use this for small, ambiguous, or uncommon companies. Skip for well-known companies (Google, Meta, Apple, Amazon, etc.) where searchQuery is sufficient.",
  input_schema: {
    type: "object",
    properties: {
      company_name: { type: "string", description: "The company name to look up" }
    },
    required: ["company_name"]
  }
}]
```

### Schema changes (Prisma)
- Add to Person model: `scrapeDepth String @default("full")`, `pictureUrl String?`, `tenureMonths Int?`, `openProfile Boolean?`, `premium Boolean?`
- Add new `CompanyUrl` model for caching company name → LinkedIn URL mappings
- Add cost tracking fields to Search model: `haikuCalls`, `shortModePages`, `fullScrapeCalls`, `totalCostCents`, `costBreakdown`
- Migration: all existing Person records are already `scrapeDepth: "full"` via default

### Testing
```bash
# Test Short mode client with various filters
npx tsx tests/test-linkedin-search.ts

# Test company URL resolver (small company like "anara")
npx tsx tests/test-company-resolver.ts

# Test Haiku query parser with natural language inputs
npx tsx tests/test-query-parser.ts

# Push schema changes
npm run db:push
```

**Test cases for query parser:**
- "software engineers at Google in SF" → searchQuery + location, no company URL needed
- "PMs at Anara in Austin from UT" → tool call for Anara URL + schools + location
- "senior fintech founders in NYC" → seniorityLevelIds + industryIds + location + companyHeadcount
- "entry level engineers who recently changed jobs" → seniorityLevelIds + recentlyChangedJobs
- "" (empty) → error/fallback
- "asdfghjkl" (nonsense) → graceful handling

---

## Phase 2: DB-First Query Layer

### Goal
Extend `findPeopleByFilters` to handle the expanded filter set so existing profiles are queryable by new criteria.

### Files to modify
1. **`src/lib/db/person-service.ts`**
   - Extend `PersonFilters` type with new fields (minYearsExperience, etc.)
   - Update `buildPersonWhereClause` to support new filters
   - Add logic to compute years of experience from `experienceHistory` JSON

2. **`src/lib/db/search-cache.ts`**
   - Update cache key hashing to include new filter params
   - Update exhaustion logic (25 per page vs 10)
   - Update `MAX_SERPER_PAGE` → `MAX_SEARCH_PAGE` naming
   - Adjust `CSE_EXHAUSTED_THRESHOLD` for new page size

### Testing
- Query existing DB with new filter combinations
- Verify cache key generation is deterministic
- Test exhaustion logic with new thresholds

---

## Phase 3: New Search Orchestrator

### Goal
Replace the core search flow in `search.ts` with the DB-first + Short mode pipeline.

### Key decisions
- **DB-first threshold:** If DB returns 6+ results for the dbFilters, skip the API ($0 cost). Under 6 → call Short mode ($0.10).
- **University tagging:** When `linkedInFilters.schools` is set, tag all returned short profiles with that school in DB.
- **Cache key:** Hash of full parsed filter set (both dbFilters + linkedInFilters). Stored as `queryHash` on Search record.
- **Raw query storage:** Add `rawQuery` and `parsedFilters` fields to Search model.

### Step 1: `searchPeopleAction` rewrite
The core search flow. Can be tested end-to-end alone.

**Flow:**
1. Receive raw text query from user
2. Call `parseSearchQuery(query)` → get `dbFilters` + `linkedInFilters` + cost
3. Query DB with `dbFilters` via `findPeopleByFilters` (limit 6)
4. If 6+ results → return from DB ($0 cost, skip API)
5. If <6 results → call `searchLinkedInShort(linkedInFilters)` → 25 short profiles
6. Save short profiles to DB as `scrapeDepth: "short"` (tag with school if `schools` filter used)
7. Merge DB results (full depth) + new short profiles → deduplicate on `linkedinUrl` → rank → return
8. Create/update Search record with cache key, raw query, parsed filters, cost metrics

**Schema changes:**
- Add `rawQuery String?` to Search model
- Add `parsedFilters Json?` to Search model (full Haiku output)

**Files to modify:**
- `src/app/actions/search.ts` — rewrite `searchPeopleAction`
- `src/lib/db/search-cache.ts` — update cache key logic for new filter shape
- `prisma/schema.prisma` — add new Search fields

**Testing:**
- Test with cached search (DB has 6+ results) → verify $0 cost
- Test with uncached search → verify Short mode call + save + return
- Test university search → verify school tagging on saved profiles
- Verify cost tracking accumulation on Search record

### Step 2: `fullScrapePersonAction`
Independent from Step 1. Triggered on profile click.

**Flow:**
1. Receive `personId` (or `linkedinUrl`)
2. Check Person `scrapeDepth` — if already "full", return existing data
3. Call existing `scrapeLinkedInProfiles([linkedinUrl])` → full Apify scrape
4. Update Person: `scrapeDepth: "short"` → `"full"`, fill education, experience, schools, etc.
5. Update cost tracking on the associated Search record (`fullScrapeCalls++`)
6. Return full profile data

**Files to modify:**
- `src/app/actions/search.ts` — add new `fullScrapePersonAction`

**Testing:**
- Click short profile → verify full scrape triggers → verify Person updated
- Click full profile → verify no scrape (already full)
- Verify cost tracking increments

### Step 3: `loadMorePeopleAction` rewrite + cleanup
Pagination and removal of old prescrape logic.

**Flow:**
1. Query DB first (same dbFilters, exclude already-shown IDs)
2. If 6+ new results from DB → return
3. If <6 → call `searchLinkedInShort` with `startPage: nextPage` → save + merge + return
4. Track `lastPageScraped` on Search record for Short mode pagination

**Cleanup:**
- Remove `prescrapeAction` (no more background page-ahead scraping)
- Remove prescrape fire-and-forget from MainSearchView
- Remove `/api/prescrape/route.ts` (or repurpose)

**Files to deprecate:**
- `src/lib/services/snippet-filter.ts` — no longer needed
- `src/lib/services/discovery.ts` — Serper query building no longer primary (keep as fallback)

**Files to modify:**
- `src/app/actions/search.ts` — rewrite `loadMorePeopleAction`, remove `prescrapeAction`
- `src/app/api/prescrape/route.ts` — remove or repurpose

**Testing:**
- Load More with DB results available → verify no API call
- Load More with DB exhausted → verify next Short mode page fetched
- Verify pagination state tracked correctly
- Verify old prescrape code no longer runs

---

## Phase 4: UI Changes

### Goal
Replace 4-dropdown SearchForm with natural language search box. Handle mixed short/full profile display.

### Files to modify
1. **`src/components/search/SearchForm.tsx`** — Single text input
2. **`src/components/layout/MainSearchView.tsx`** — Pass raw text → Haiku → structured params
3. **`src/hooks/useSearchResults.ts`** — Handle mixed scrapeDepth results, click-to-expand
4. **`src/components/search/PersonCard.tsx`** — Short profile display (no education, loading state on click)
5. **`src/app/api/prescrape/route.ts`** — Repurpose or remove

### Testing
- Full UI flow: type query → see results → click → see full profile
- Verify short vs full profile card rendering
- Test loading states during full scrape

---

## Phase 5: Migration & Cleanup

### Goal
Clean up legacy code and migrate data.

### Tasks
- Tag all existing Person records as `scrapeDepth: "full"` (migration script)
- Remove dead code (old Serper flow, snippet filter, CSE naming)
- Rename legacy DB fields if desired (`lastCsePageScraped` → `lastPageScraped`)
- Update constants (page size 25, new exhaustion threshold)
- Update CLAUDE.md with new architecture documentation
