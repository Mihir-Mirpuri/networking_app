# Discovery Refactor: Query-by-Filters + Page Tracking

## Overview

Refactor the discovery flow to:
1. Always query the `Person` table by filters (no more cached person links)
2. Track which CSE pages have been scraped per search to enable true pagination
3. Use "Load More" button for user-controlled discovery

## Problem Statement

### Current Bug
When a cached search returns results, excluded people (already emailed, marked doNotShow) are filtered out AFTER fetching, but `needsRefresh` is not triggered based on the reduced count.

Example:
- Cache has 10 people linked to a Search
- User has emailed 3 of them
- User sees 7 results, but `needsRefresh` stays false
- User is stuck with fewer results than requested

### Current Architecture Limitations
1. `SearchPerson` junction stores exact people found, not search metadata
2. No tracking of which CSE pages have been scraped
3. "Load More" may re-scrape the same CSE pages
4. Users don't benefit from other users' discoveries with the same search criteria

## Proposed Solution

### New Architecture
```
Search table = pagination tracker (not a cache)
    ↓
Stores: which CSE pages have been scraped for this query
    ↓
searchPeopleAction: Always query Person table by filters
    ↓
"Load More" button → scrape next unscraped CSE page
```

### Key Insight
The `Search` table is no longer a "cache" - it's a **pagination state tracker**. The flow is the same whether or not a Search record exists:

```typescript
// 1. Get pagination state (if exists)
const existingSearch = await getSearchPagination(normalizedParams);
const scrapedPages = existingSearch?.scrapedPages ?? [];

// 2. Always query by filters (same path regardless of cache)
const people = await findPeopleByFilters(filters);

// 3. Determine if more discovery is possible
const hasMorePages = scrapedPages.length === 0 || lastPageHadResults;
```

### Benefits
1. Exclusions handled correctly at query time
2. True pagination through CSE results without duplicate scraping
3. All users benefit from shared discovery
4. Simpler code - no branching between cache hit/miss

---

## UX Decision: Load More Button (Not Auto-Load)

### Recommendation: Manual "Load More" Button

**Why not auto-load in background:**

1. **API Quota Conservation**
   - CSE has daily limits (100 queries/day free tier)
   - LinkedIn scraping costs money (Apify credits)
   - Apollo calls are expensive
   - User might be satisfied with 5 results - don't waste quota fetching 20

2. **User Control**
   - Users know their intent - maybe they just want to see who's in the DB
   - Some users are browsing, not committing to outreach yet
   - "Load More" is a clear signal: "I need more people"

3. **Predictable UX**
   - No surprise changes to results while user is reading
   - No "wait, where did that person go?" confusion
   - User knows exactly when new results are being fetched

4. **Simpler Implementation**
   - No background job orchestration
   - No WebSocket/polling for progress updates
   - No race conditions between auto-load and user actions

**When to show "Load More" button:**
- `results.length < requestedLimit` AND `hasMorePages = true`
- Hide when: no more CSE pages available (previous page returned < 10 results)

**Exception - Auto-scrape on first search:**
- If `scrapedPages.length === 0` AND `results.length === 0`: auto-trigger first scrape
- User shouldn't have to click "Load More" to see ANY results
- This is a one-time bootstrap, not ongoing background loading

---

## Implementation Steps

### Step 1: Update Prisma Schema

**File:** `prisma/schema.prisma`

#### 1a. Add `scrapedPages` to Search model

```prisma
model Search {
  id                    String         @id @default(cuid())
  name                  String?
  company               String?
  role                  String?
  university            String?
  location              String?
  scrapedPages          Int[]          @default([])  // Tracks which CSE pages have been scraped
  lastPageResultCount   Int?           // How many results the last scraped page returned (< 10 = no more pages)
  apolloCallsMade       Int            @default(0)
  apolloCacheHits       Int            @default(0)
  cseCallsMade          Int            @default(0)
  linkedinScraperCalls  Int            @default(0)
  completedAt           DateTime?
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt

  @@index([createdAt])
  @@index([completedAt])
  @@index([company, role, university, location, name])  // For lookups
}
```

#### 1b. Mark SearchPerson for deprecation (don't delete yet)

```prisma
// DEPRECATED: Will be removed in future migration
// Keeping for now to avoid data loss during transition
model SearchPerson {
  id        String   @id @default(cuid())
  searchId  String
  personId  String
  createdAt DateTime @default(now())
  search    Search   @relation(fields: [searchId], references: [id], onDelete: Cascade)
  person    Person   @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([searchId, personId])
  @@index([searchId])
  @@index([personId])
}
```

**Note:** If you want to fully remove SearchPerson, also remove the `searches SearchPerson[]` relation from the Person model (around line 117).

#### 1c. Add composite index on Person for filter queries

```prisma
model Person {
  // ... existing fields ...

  @@unique([fullName, company])
  @@index([scrapedAt])
  @@index([apolloEnrichedAt])
  @@index([company])                           // NEW
  @@index([educationSchool])                   // NEW
  @@index([city])                              // NEW
  @@index([company, city, educationSchool])    // NEW: composite for common queries
}
```

#### 1d. Run migration

```bash
npx prisma migrate dev --name add-scraped-pages-tracking
```

---

### Step 2: Refactor Search Functions (Rename for Clarity)

**File:** `src/lib/db/search-cache.ts`

Rename file to `src/lib/db/search-pagination.ts` to reflect its actual purpose.

#### 2a. Replace `findCachedSearch` with `getSearchPagination`

```typescript
export interface SearchPaginationState {
  id: string;
  scrapedPages: number[];
  lastPageResultCount: number | null;
  createdAt: Date;
}

/**
 * Get pagination state for a search query.
 * Returns which CSE pages have been scraped, NOT cached results.
 */
export async function getSearchPagination(
  params: NormalizedSearchParams
): Promise<SearchPaginationState | null> {
  const { name, company, role, university, location } = params;

  const search = await prisma.search.findFirst({
    where: {
      name: name ?? null,
      company: company ?? null,
      role: role ?? null,
      university: university ?? null,
      location: location ?? null,
    },
    select: {
      id: true,
      scrapedPages: true,
      lastPageResultCount: true,
      createdAt: true,
    },
  });

  return search;
}
```

#### 2b. Remove these functions (no longer needed):
- `getCachedPersonIds()`
- `createSearchWithPeople()`
- `updateSearchWithPeople()`
- `clearSearchCache()`

#### 2c. Add function to create/update pagination state

```typescript
/**
 * Create a new search pagination record
 */
export async function createSearchPagination(
  params: NormalizedSearchParams,
  scrapedPages: number[],
  lastPageResultCount: number
): Promise<string> {
  const search = await prisma.search.create({
    data: {
      name: params.name,
      company: params.company,
      role: params.role,
      university: params.university,
      location: params.location,
      scrapedPages,
      lastPageResultCount,
      cseCallsMade: 1,
    },
    select: { id: true },
  });
  return search.id;
}

/**
 * Update pagination state after scraping a new page
 */
export async function updateSearchPagination(
  searchId: string,
  scrapedPages: number[],
  lastPageResultCount: number,
  apiStats?: {
    cseCallsMade?: number;
    linkedinScraperCalls?: number;
    apolloCallsMade?: number;
    apolloCacheHits?: number;
  }
): Promise<void> {
  await prisma.search.update({
    where: { id: searchId },
    data: {
      scrapedPages,
      lastPageResultCount,
      updatedAt: new Date(),
      ...(apiStats?.cseCallsMade && { cseCallsMade: { increment: apiStats.cseCallsMade } }),
      ...(apiStats?.linkedinScraperCalls && { linkedinScraperCalls: { increment: apiStats.linkedinScraperCalls } }),
      ...(apiStats?.apolloCallsMade && { apolloCallsMade: { increment: apiStats.apolloCallsMade } }),
      ...(apiStats?.apolloCacheHits && { apolloCacheHits: { increment: apiStats.apolloCacheHits } }),
    },
  });
}
```

#### 2d. Add helper to determine if more pages exist

```typescript
/**
 * Determine if more CSE pages are available to scrape
 */
export function hasMorePagesToScrape(pagination: SearchPaginationState | null): boolean {
  if (!pagination) return true; // Never scraped = definitely has pages
  if (pagination.scrapedPages.length === 0) return true;

  // CSE returns max 10 results per page
  // If last page had < 10, there are no more pages
  return pagination.lastPageResultCount === null || pagination.lastPageResultCount >= 10;
}
```

---

### Step 3: Simplify searchPeopleAction (Unified Flow)

**File:** `src/app/actions/search.ts` (lines 169-438)

Replace the entire cache hit/miss branching logic with a unified flow:

```typescript
export async function searchPeopleAction(input: SearchInput): Promise<SearchActionResult> {
  // ... auth check, user fetch (keep existing lines 172-198) ...

  const excludedKeys = await getExcludedPersonKeys(userId);
  const normalizedParams = normalizeSearchParams(input);

  // ============================================
  // STEP 1: Get pagination state (replaces cache check)
  // ============================================
  const pagination = await getSearchPagination(normalizedParams);
  const scrapedPages = pagination?.scrapedPages ?? [];
  const searchId = pagination?.id ?? null;

  console.log(`[Search] Pagination state: ${scrapedPages.length} pages scraped, searchId=${searchId}`);

  // ============================================
  // STEP 2: Query database by filters (always - no branching)
  // ============================================
  const filters: PersonFilters = {
    company: input.company,
    location: input.location,
    role: input.role,
    university: input.university,
    requireEmail: true,
    excludePersonKeys: excludedKeys,
    limit: input.limit,
  };

  const people = await findPeopleByFilters(filters);
  console.log(`[Search] Found ${people.length} people matching filters`);

  // ============================================
  // STEP 3: Determine if "Load More" should be shown
  // ============================================
  const moreAvailable = hasMorePagesToScrape(pagination);
  const showLoadMore = people.length < input.limit && moreAvailable;

  // Special case: no results AND never scraped = auto-trigger first scrape
  const shouldAutoScrape = people.length === 0 && scrapedPages.length === 0;

  console.log(`[Search] showLoadMore=${showLoadMore}, shouldAutoScrape=${shouldAutoScrape}`);

  // ============================================
  // STEP 4: Rank candidates (no changes needed)
  // ============================================
  const searchCriteria: SearchCriteria = {
    company: input.company,
    role: input.role,
    university: input.university,
    location: input.location,
  };

  const rankedPeople = rankCandidates(
    searchCriteria,
    people,  // Use people directly - already filtered
    (person): CandidateData => ({
      company: person.company,
      role: person.role,
      email: person.email,
      emailStatus: (person.emailStatus as 'VERIFIED' | 'UNVERIFIED' | 'MISSING') || 'MISSING',
      city: person.city,
      state: person.state,
      country: person.country,
      educationSchool: person.educationSchool,
    }),
    input.limit
  );

  // ============================================
  // STEP 5: Build results with drafts (keep existing lines 308-395)
  // ============================================
  const results = await Promise.all(
    rankedPeople.map(async ({ candidate: person, score, breakdown }) => {
      // ... existing draft generation logic ...
    })
  );

  // ============================================
  // STEP 6: Return with pagination metadata
  // ============================================
  return {
    results,
    searchMeta: {
      searchId,
      scrapedPages,
      showLoadMore,
      shouldAutoScrape,
      moreAvailable,
      apolloCallsMade: 0,  // No Apollo calls in instant search
      apolloCacheHits: 0,
      cseCallsMade: 0,
    },
    remainingDaily,
  };
}
```

---

### Step 4: Update refreshSearchAction (Load More Handler)

**File:** `src/app/actions/search.ts` (lines 681-766)

This action is now explicitly the "Load More" handler:

```typescript
/**
 * Scrape the next CSE page for a search query.
 * Called when user clicks "Load More" or on auto-scrape for empty results.
 */
export async function loadMoreAction(input: {
  company: string;
  role?: string;
  university?: string;
  location?: string;
  name?: string;
  limit?: number;
  searchId?: string;
  scrapedPages?: number[];
}): Promise<LoadMoreResult> {
  // ... auth check ...

  const existingPages = input.scrapedPages ?? [];

  // ============================================
  // STEP 1: Determine next page to scrape
  // ============================================
  const nextPage = existingPages.length > 0
    ? Math.max(...existingPages) + 1
    : 1;

  // CSE start parameter: 1, 11, 21, 31, etc.
  const cseStart = (nextPage - 1) * 10 + 1;

  console.log(`[LoadMore] Scraping CSE page ${nextPage} (start=${cseStart})`);

  // ============================================
  // STEP 2: Discover LinkedIn profiles from CSE
  // ============================================
  const discoveryResults = await discoverLinkedInProfiles({
    company: input.company,
    role: input.role,
    university: input.university,
    location: input.location,
    name: input.name,
    start: cseStart,
  });

  console.log(`[LoadMore] CSE returned ${discoveryResults.length} results`);

  // ============================================
  // STEP 3: Scrape new profiles (existing logic)
  // ============================================
  // ... existing scraping logic from lines 508-555 ...

  // ============================================
  // STEP 4: Generate emails (existing logic)
  // ============================================
  // ... existing email generation logic from lines 558-671 ...

  // ============================================
  // STEP 5: Update pagination state
  // ============================================
  const normalizedParams = normalizeSearchParams({
    company: input.company,
    role: input.role,
    university: input.university,
    location: input.location,
    name: input.name,
  });

  const newScrapedPages = [...existingPages, nextPage];

  if (input.searchId) {
    await updateSearchPagination(
      input.searchId,
      newScrapedPages,
      discoveryResults.length,  // Track how many results this page returned
      {
        cseCallsMade: 1,
        linkedinScraperCalls: urlsToScrape.length > 0 ? 1 : 0,
        apolloCallsMade,
        apolloCacheHits,
      }
    );
  } else {
    const newSearchId = await createSearchPagination(
      normalizedParams,
      newScrapedPages,
      discoveryResults.length
    );
    console.log(`[LoadMore] Created new search record ${newSearchId}`);
  }

  // ============================================
  // STEP 6: Query fresh results to return
  // ============================================
  const excludedKeys = await getExcludedPersonKeys(userId);
  const freshResults = await findPeopleByFilters({
    company: input.company,
    location: input.location,
    role: input.role,
    university: input.university,
    requireEmail: true,
    excludePersonKeys: excludedKeys,
    limit: input.limit ?? 10,
  });

  return {
    results: freshResults,
    newPeopleCount,
    emailsGenerated,
    scrapedPages: newScrapedPages,
    hasMore: discoveryResults.length >= 10,  // CSE returns max 10, so 10 = likely more pages
    apolloCallsMade,
    apolloCacheHits,
  };
}
```

---

### Step 5: Update Discovery Service for Pagination

**File:** `src/lib/services/discovery.ts`

Add `start` parameter to CSE call:

```typescript
export async function discoverLinkedInProfiles(params: {
  company: string;
  role?: string;
  university?: string;
  location?: string;
  name?: string;
  start?: number;  // CSE start parameter (1, 11, 21, etc.)
}): Promise<CSEDiscoveryResult[]> {
  const { company, role, university, location, name, start = 1 } = params;

  // ... existing query building logic ...

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', process.env.GOOGLE_CSE_API_KEY!);
  url.searchParams.set('cx', process.env.GOOGLE_CSE_CX!);
  url.searchParams.set('q', query);
  url.searchParams.set('start', start.toString());  // ADD THIS
  url.searchParams.set('num', '10');

  const response = await fetch(url.toString());

  // ... rest of function ...
}
```

---

### Step 6: Update Frontend

**File:** `src/components/search/SearchPageClient.tsx`

```typescript
// State
const [searchId, setSearchId] = useState<string | null>(null);
const [scrapedPages, setScrapedPages] = useState<number[]>([]);
const [showLoadMore, setShowLoadMore] = useState(false);
const [isLoadingMore, setIsLoadingMore] = useState(false);

// After initial search
const handleSearch = async (searchInput: SearchInput) => {
  setIsLoading(true);

  const result = await searchPeopleAction(searchInput);

  setResults(result.results);
  setSearchId(result.searchMeta.searchId);
  setScrapedPages(result.searchMeta.scrapedPages);
  setShowLoadMore(result.searchMeta.showLoadMore);

  // Auto-scrape if no results and never scraped
  if (result.searchMeta.shouldAutoScrape) {
    await handleLoadMore();
  }

  setIsLoading(false);
};

// Load More handler
const handleLoadMore = async () => {
  setIsLoadingMore(true);

  const result = await loadMoreAction({
    ...currentSearchParams,
    searchId,
    scrapedPages,
  });

  setResults(result.results);
  setScrapedPages(result.scrapedPages);
  setShowLoadMore(result.hasMore && result.results.length < requestedLimit);

  setIsLoadingMore(false);
};

// In JSX
{showLoadMore && (
  <button
    onClick={handleLoadMore}
    disabled={isLoadingMore}
    className="..."
  >
    {isLoadingMore ? 'Finding more people...' : 'Load More Results'}
  </button>
)}
```

---

### Step 7: Update Types

**File:** `src/types/search.ts`

```typescript
export interface SearchMeta {
  searchId: string | null;
  scrapedPages: number[];
  showLoadMore: boolean;
  shouldAutoScrape: boolean;
  moreAvailable: boolean;
  apolloCallsMade: number;
  apolloCacheHits: number;
  cseCallsMade: number;
}

export interface LoadMoreResult {
  results: SearchResultWithDraft[];
  newPeopleCount: number;
  emailsGenerated: number;
  scrapedPages: number[];
  hasMore: boolean;
  apolloCallsMade: number;
  apolloCacheHits: number;
}
```

---

## Migration Strategy

### For Existing Search Records

Existing `Search` records have `scrapedPages: []` (empty array by default).

**Approach: Treat empty as "needs first scrape"**
```typescript
const existingPages = pagination?.scrapedPages ?? [];
// If empty, nextPage will be 1 - correct behavior
```

No SQL migration needed. Empty array = fresh search = will scrape page 1.

### For SearchPerson Table

1. Keep the table and relation for now (no breaking changes)
2. Stop writing to it (remove calls to createSearchWithPeople, updateSearchWithPeople)
3. After confirming the new system works (1-2 weeks), create a migration to drop the table

---

## Testing Checklist

### Unit Tests
- [ ] `getSearchPagination` returns scrapedPages correctly
- [ ] `updateSearchPagination` appends new pages and tracks lastPageResultCount
- [ ] `hasMorePagesToScrape` returns false when lastPageResultCount < 10
- [ ] CSE pagination with start parameter works

### Integration Tests
- [ ] Fresh search with no DB results: auto-scrapes page 1
- [ ] Fresh search with DB results: shows results, "Load More" if < limit
- [ ] "Load More" scrapes page 2, updates scrapedPages to [1, 2]
- [ ] Exclusions work correctly (emailed users not shown)
- [ ] "Load More" hidden when lastPageResultCount < 10

### Manual Testing
1. Search for a new company (no prior data)
   - Verify auto-scrape happens
   - Verify results appear
2. Search for existing company with data
   - Verify instant results from DB
   - Verify "Load More" appears if < limit
3. Click "Load More"
   - Verify new results appear
   - Verify scrapedPages updated in DB
4. Email someone, search again
   - Verify they're excluded
   - Verify "Load More" still works

---

## Rollback Plan

If issues arise:
1. Revert code changes
2. `scrapedPages` and `lastPageResultCount` columns can remain (unused)
3. SearchPerson table is still intact
4. No data loss

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `scrapedPages`, `lastPageResultCount` to Search, add indexes to Person |
| `src/lib/db/search-cache.ts` | Rename to `search-pagination.ts`, rewrite functions |
| `src/app/actions/search.ts` | Unified flow (no cache branching), rename `refreshSearchAction` → `loadMoreAction` |
| `src/lib/services/discovery.ts` | Add `start` parameter to CSE call |
| `src/components/search/SearchPageClient.tsx` | Add Load More button, track pagination state |
| `src/types/search.ts` | Update SearchMeta and add LoadMoreResult types |

---

## Estimated Effort

- Schema + Migration: 15 min
- search-pagination.ts (renamed): 30 min
- search.ts (unified flow): 30 min
- discovery.ts: 10 min
- Frontend updates: 30 min
- Testing: 30 min

**Total: ~2.5 hours**
