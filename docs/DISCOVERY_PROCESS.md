# Full Discovery Process Mapped Out

## Context

- **SearchPageClient.tsx** is the top-level search page component. It orchestrates the entire client-side flow.
- **Server Actions** are functions marked with `'use server'` that run on the server. They live in `src/app/actions/search.ts`.
- **Key files:** `SearchForm.tsx` (UI form), `SearchPageClient.tsx` (orchestrator), `search.ts` (server actions), `discovery.ts` (CSE API), `person-service.ts` (DB service layer), `search-cache.ts` (scrape progress tracking), `ranking.ts` (candidate scoring), `linkedin-scraper.ts` (Apify scraper), `enrichment.ts` (Apollo API), `email-pattern.ts` (email pattern matching).

---

## Part 1: Initial Search

### UI: User Clicks Search

1. In **SearchForm.tsx**, `handleSubmit()` collects the form inputs (company, role, university, location, templateId) and calls the parent `onSearch()` callback. SearchForm does NOT call any server actions directly — it's a pure presentation component.

2. `onSearch()` is actually **`handleSearch()`** in SearchPageClient.tsx, passed as a prop to SearchForm.

3. `handleSearch()` clears all state (results, sessionStorage, errors) and then calls the server action `searchPeopleAction(input)`.

---

### Step 1: Auth + Setup (searchPeopleAction)

```
Client: handleSearch(params)
 |
 |-- sessionStorage.clear()
 |
 \-- searchPeopleAction(input)                    <-- Server Action
      |
      |-- AUTH -----------------------------------------------
      |-- getServerSession(authOptions)            // which user is this?
      |-- prisma.user.findUnique()                 // get user profile (name, university, major, etc.)
      |-- getExcludedPersonIds(userId)             // IDs of people already sent to or hidden
      |
      |-- NORMALIZE ------------------------------------------
      |-- normalizeSearchParams({ name, company, role, university, location })
```

**Auth section does 3 things:**
- `getServerSession()` — identifies which user is making the request
- `prisma.user.findUnique()` — fetches user profile data needed for email template replacement (name, university, classification, major, career) plus daily send tracking
- `getExcludedPersonIds(userId)` — returns Person IDs where the user has either successfully sent an email (SendLog with status=SUCCESS) or marked as hidden (doNotShow=true). These are excluded from all future queries.

**Normalize section:**
- Trims whitespace, lowercases everything, converts empty strings to null
- Used for consistent scrape progress tracking in the Search table

---

### Step 2: Query DB, Enrich With Patterns If Needed

```
      |-- QUERY DB FIRST ------------------------------------
      |-- findPeopleByFilters(filters)
      |   |-- IF role provided + OPENAI_API_KEY set:
      |   |   \-- findPeopleByFiltersVector() (pgvector cosine distance)
      |   |-- ELSE:
      |   |   \-- findPeopleByFiltersPrisma() (keyword ILIKE matching)
      |   |
      |   |-- buildPersonWhereClause():
      |   |   |-- company: getCompanySearchTerms() -> startsWith for known aliases, contains for unknown
      |   |   |-- role: getRoleSearchTerms() -> expands aliases (e.g., "VP" -> also matches "Vice President")
      |   |   |-- location: city ILIKE contains
      |   |   |-- university: educationSchool ILIKE contains
      |   |   |-- excludePersonIds: NOT IN (sent/hidden + already displayed)
      |   |   |-- requireEmail: false (email status hidden from user)
      |   |   \-- Apollo-failed filter: NOT (email IS NULL AND apolloEnrichedAt IS NOT NULL)
      |   |
      |   |-- overfetch: limit * 2 (to compensate for post-query filtering)
      |   |-- applyPostQueryFilters(): companiesMatch() fuzzy matching
      |   \-- sort: emailStatus ASC (VERIFIED first), emailConfidence DESC, createdAt ASC
      |
      |-- IF results.length < limit:
      |   |-- enrichPeopleWithPatterns(filters, company)
      |   |   |-- Find people matching filters who have NO email
      |   |   |-- For each candidate:
      |   |   |   \-- Try pattern lookup (canonical key, then raw company name) --> FREE
      |   |   \-- Update Person rows with emails found
      |   \-- findPeopleByFilters(filters)  <-- re-query to pick up newly enriched people
```

**Cost optimization:** Enrichment during search is pattern-only (free). Apollo enrichment has been moved to send time — `enrichPersonBeforeSend()` in `send.ts` calls Apollo only when the user actually clicks Send on a person without an email. People where Apollo already tried and found nothing (`apolloEnrichedAt` set, `email` null) are excluded from all search results — they won't appear in the UI.

**Key functions explained:**

- **enrichPeopleWithPatterns()** — Only runs when `results.length < limit`. Finds people in the DB who match the search filters but don't have an email yet (`email = null`). For each:
  1. Try email pattern lookup (company key -> CompanyPattern table) — free, no API call
  2. If pattern found, generate email and update the Person row
  3. No Apollo calls — Apollo enrichment happens at send time instead

- **getCompanySearchTerms()** — Returns search terms for the DB WHERE clause. For known companies (in COMPANY_ALIASES map), returns all alias variations with `startsWith` matching. For unknown companies, extracts key words with `contains` matching. Purpose: cast a wide net at the DB level for speed. The actual strict filtering happens post-query.

- **getRoleSearchTerms()** — Similar concept for roles. Expands abbreviations like "VP" -> ["vice president", "vp"]. Used in the WHERE clause OR condition.

- **buildPersonWhereClause()** — Constructs the Prisma/SQL WHERE clause. It INCLUDES people matching aliases (broadens the search), excludes already-displayed people and sent/hidden people at the DB level.

- **applyPostQueryFilters() / companiesMatch()** — Post-query strict filtering. `getCompanySearchTerms()` is intentionally loose for DB speed. `companiesMatch()` is the strict filter using the canonical alias map. Both companies must resolve to the same canonical key, or for unknown companies, uses bidirectional substring matching with word boundary awareness for short names.

- **findPeopleByFiltersVector()** — When vector mode is active, uses raw SQL with pgvector's `<=>` (cosine distance) operator. Threshold of 0.35 filters out dissimilar roles. Null embeddings get penalty distance of 1.0 (appear at the end). Ordering: role_distance ASC, emailStatus ASC, emailConfidence DESC.

---

### Step 3: Scrape Decision

```
      |-- SCRAPE DECISION ------------------------------------
      |-- findOrCreateScrapeProgress(normalizedParams)
      |-- getNextCsePageStart(lastCsePageScraped, cseExhausted)
      |
      |-- IF nextPage exists (CSE has more pages to scrape):
      |   |
      |   |-- IF people.length === 0:
      |   |   |-- SYNC SCRAPE (user waits) -----
      |   |   |-- processRefreshBatch(input, nextPage)
      |   |   |-- updateScrapeProgress()
      |   |   |-- enrichPeopleWithPatterns() <-- enrich newly scraped people (pattern-only)
      |   |   \-- findPeopleByFilters() <-- re-query DB with new data
      |   |
      |   \-- IF people.length >= 1:
      |       \-- Return immediately (prescrape fires from client after response)
      |
      \-- IF nextPage is null (CSE exhausted or 3-page cap reached):
          \-- Skip scraping entirely, return whatever DB has
```

**The two-path decision:**
- **0 results + CSE has more pages** -> Sync scrape one CSE page, enrich with patterns, re-query, then return
- **1+ results OR CSE exhausted** -> Return DB results immediately

**Scrape progress tracking:**
- `findOrCreateScrapeProgress()` looks up or creates a Search record matching the normalized params
- Tracks `lastCsePageScraped` (0, 1, 11, 21) and `cseExhausted` (boolean)
- CSE pagination: page 1 = start 1, page 2 = start 11, page 3 = start 21
- Hard cap: 3 total pages (start values 1, 11, 21). `MAX_CSE_PAGE_START = 21`
- After **30 days** (`SCRAPE_PROGRESS_TTL_DAYS = 30`), progress resets, allowing re-scraping from page 1

---

### Step 4: Rank + Build Results

```
      |-- RANK + BUILD ---------------------------------------
      |
      |-- IF vector mode active (OPENAI_API_KEY + role filter):
      |   |-- Skip rankCandidates() entirely
      |   \-- Use DB ordering directly, score = (1 - cosineDistance) * 100
      |
      |-- ELSE (keyword fallback):
      |   \-- rankCandidates(searchCriteria, people, mapper, limit)
      |       |-- Weights: role=0.85, email=0.10, company/location/university=0.00
      |       |-- Role scoring: exact match -> alias match -> abbreviation expansion -> Jaccard similarity
      |       |-- Email scoring: VERIFIED=1.0, UNVERIFIED=0.5, MISSING=0.3
      |       \-- Sort by weighted score descending, take top N
      |
      |-- buildResultsWithDrafts(rankedPeople, userId, templateId, user)
      |   |-- prisma.userCandidate.upsert()        // create user-person relationship
      |   |-- generateEmailDraft()                  // template variable replacement
      |   \-- prisma.emailDraft.upsert()            // save draft
      |
      |-- HASMORE + LOG --------------------------------------
      |-- hasMore = people.length >= limit || cseHasMorePages
      |-- prisma.searchLog.create()                 // analytics logging
      |
      \-- return { results, searchMeta: { hasMore, ... }, remainingDaily }
```

**Why company/location/university weights are 0.00:**
These are already hard-filtered in the DB query. Everyone in the result set already matches on company, location, and university. Role is the only differentiator among candidates, so it gets 85% weight. Email quality gets 10% to slightly prefer people we can contact immediately, but MISSING scores 0.3 (not 0) since Apollo enrichment now happens at send time.

---

### Step 5: Back in Client + Prescrape Trigger

```
 -- Back in Client (SearchPageClient.tsx) -------------------
 |-- Display results to user
 |-- Save results + params to sessionStorage (for page refresh persistence)
 |
 \-- HTTP POST /api/prescrape (fire-and-forget)
     |
     \-- prescrapeAction(input)                    <-- Server Action
         |-- Check if prescrape already RUNNING -> bail out
         |-- Set prescrapeStatus = 'RUNNING'
         |-- Loop (up to MAX_PRESCRAPE_PAGES = 2):
         |   |-- findOrCreateScrapeProgress()
         |   |-- getNextCsePageStart()
         |   |-- IF null -> break (exhausted or cap reached)
         |   |-- processRefreshBatch()             <-- CSE + LinkedIn scraping
         |   |-- updateScrapeProgress()
         |   \-- IF urlsFromCse < 5 -> break (CSE exhausted)
         \-- Set prescrapeStatus = 'DONE'
```

**Why fetch() instead of server action for prescrape:**
Using `fetch('/api/prescrape')` ensures the background scrape doesn't block subsequent server action calls (like Load More). Next.js can serialize server actions, but API route calls run independently.

**Prescrape concurrency guard:**
`prescrapeStatus = 'RUNNING'` prevents duplicate prescrapes for the same search params. If a prescrape is already running, the new request bails out immediately.

**Total page budget:** 1 (sync, if needed) + 2 (prescrape) = 3 pages maximum per search.

---

## Part 2: processRefreshBatch (Scraper In Depth)

This is the core scraping function used by both sync scrape and prescrape.

```
processRefreshBatch(input, pageStart)
 |
 |-- STEP 1: CSE Discovery ---------------------------------
 |-- discoverLinkedInProfiles({ company, university, role, location, limit: 10, pageStart })
 |   |-- Build query: site:linkedin.com/in "company" "university" role location
 |   |   NOTE: company is just quoted, NO LLM expansion (disabled)
 |   |-- searchCSE(query, pageStart) -> Google Custom Search API
 |   |-- Filter: only linkedin.com/in/ URLs
 |   |-- Extract from each result:
 |   |   |-- Name: profile:first_name + profile:last_name metatags (primary)
 |   |   |         OR title parsing regex fallback
 |   |   |-- Company: og:description "Experience: [Company]" metatag
 |   |   \-- LinkedIn URL
 |   |-- Dedup by URL within page
 |   \-- Skip people in excludePersonKeys (sent/hidden)
 |
 |-- STEP 2: Check DB for existing people -------------------
 |-- findPeopleByLinkedInUrls(urls)            // which profiles already exist?
 |-- Filter out already-existing URLs
 |-- Double-check right before scraping (race condition guard for concurrent batches)
 |
 |-- STEP 2.5: CSE Company Pre-filter -----------------------
 |-- For each URL to scrape:
 |   |-- Get cseCompany from og:description metatag
 |   |-- IF cseCompany exists AND doesn't match search company:
 |   |   \-- Skip (don't waste a scraper call on wrong company)
 |   \-- IF no cseCompany metatag: keep (conservative, assume it might match)
 |-- Uses companiesMatch() with alias-aware matching
 |
 |-- STEP 3: Scrape LinkedIn profiles -----------------------
 |-- scrapeLinkedInProfiles(urlsToScrape, { includeEmail: false })
 |   |-- Uses Apify actor (LpVuK3Zozwuipa5bp)
 |   |-- Batch size: 10 URLs per batch, sequential batches
 |   |-- Extracts: fullName, firstName, lastName, company, role,
 |   |             city, state, country, schools, linkedinUrl
 |   \-- Calls onBatchComplete callback with scraped profiles
 |
 |-- For each scraped profile:
 |   \-- saveScrapedProfile(profile, sourceData, searchCompany, searchUniversity)
 |       |-- Check if person exists by LinkedIn URL -> update
 |       |-- Check if person exists by fullName+company -> update + add LinkedIn URL
 |       |-- Otherwise -> create new Person record
 |       |-- Normalize company name for storage (strip "Inc.", "LLC", "The ", etc.)
 |       |-- Fire-and-forget: updatePersonRoleEmbedding() (vectorize role)
 |       \-- Create SourceLink record (DISCOVERY kind)
 |
 \-- Return { newPeopleCount, matchedCount, urlsFromCse, urlsScraped, csePrefiltered }
```

**Important notes:**
- `discoverLinkedInProfiles()` does NOT filter by company. It returns all LinkedIn profiles from CSE. Company pre-filtering happens in Step 2.5 of processRefreshBatch.
- LLM-based company name expansion (Groq) is **disabled**. The `buildCompanyQueryPart()` function just quotes the company name. The `expandCompanyName()` function exists but is never called.
- Email enrichment does NOT happen during scraping. Profiles are saved without emails. Emails are populated later by `enrichPeopleWithPatterns()` (free, pattern-only) when a search query matches them. Apollo enrichment happens at send time.
- Role embeddings are generated fire-and-forget on every save/update, so they're available for future vector-based searches.

---

## Part 3: Load More

```
Client: handleLoadMore()                          <-- Pure DB pagination
 |
 \-- loadMorePeopleAction(input + excludePersonIds) <-- Server Action
     |-- getExcludedPersonIds(userId) + already-displayed IDs
     |-- findPeopleByFilters(filters)              // query DB first
     |-- IF results.length < limit:
     |   |-- enrichPeopleWithPatterns(filters, company) // pattern-only, free
     |   \-- findPeopleByFilters(filters)           // re-query with new emails
     |-- rankCandidates -> buildResultsWithDrafts  // rank + generate drafts
     |-- Check prescrape status
     |-- hasMore = people.length >= limit || prescrapeRunning
     \-- return { results, loadMoreMeta: { hasMore, prescrapeRunning } }

 -- Back in Client ------------------------------------------
 |-- Got results? -> append to list, reset retries
 |-- No results + prescrape RUNNING + retries < 5?
 |   \-- Auto-retry after 3 seconds (up to MAX_RETRIES = 5)
 \-- Else -> hasMore = false, stop
```

**Load More does NO scraping.** It only reads from the DB. The prescrape running in the background is what populates the DB with new profiles for Load More to find.

**Retry logic:**
- If Load More returns 0 results but prescrape is still RUNNING, the client automatically retries every 3 seconds
- Maximum 5 retries (15 seconds total wait)
- UI shows "Still searching for profiles..." during retries
- After 5 retries or prescrape DONE, stops retrying

**Pagination mechanism:**
- No OFFSET. Instead, all currently-displayed Person IDs are sent as `excludePersonIds`
- The DB query uses `id NOT IN (...)` to skip already-displayed people
- This avoids the classic offset pagination problem where background inserts shift positions

---

## Part 4: Vector Embedding Role Ranking

### How embeddings are created:
1. Every time a person is saved or updated (`saveScrapedProfile()`, `saveDiscoveredPerson()`), if they have a role, `updatePersonRoleEmbedding(personId, role)` is called fire-and-forget
2. This generates an OpenAI embedding for the role string and stores it in the `role_embedding` column (pgvector type)

### How embeddings are used in search:
1. `findPeopleByFilters()` checks `isVectorRoleMatchingEnabled()` — requires `OPENAI_API_KEY` set and `USE_VECTOR_ROLE_MATCHING !== 'false'`
2. If enabled AND role filter provided: dispatches to `findPeopleByFiltersVector()`
3. The search role is also embedded via `getSearchRoleEmbedding(role)`
4. Raw SQL query uses `p.role_embedding <=> searchVector::vector` for cosine distance
5. **Threshold:** distance <= 0.35 (people with dissimilar roles are excluded)
6. **Null handling:** People without embeddings get penalty distance of 1.0 (appear at end, not excluded)
7. **Ordering:** role_distance ASC, emailStatus ASC (VERIFIED first), emailConfidence DESC
8. When vector mode is active, `rankCandidates()` is SKIPPED — the DB ordering IS the ranking
9. Score displayed to user: `(1 - cosineDistance) * 100`

### Keyword fallback (no OpenAI key):
1. `rankCandidates()` scores each person with weighted criteria
2. Weights: role = 0.85, email = 0.10 (company/location/university = 0.00 since they're hard-filtered)
3. Role scoring uses: exact match -> alias group match -> abbreviation expansion -> Jaccard token similarity
4. Email scoring: VERIFIED = 1.0, UNVERIFIED = 0.5, MISSING = 0.3 (non-zero since Apollo runs at send time)

---

## Part 5: Person Lookup (Separate from Discovery Search)

`lookupPersonAction` in search.ts is a separate flow for looking up a specific person by name.

```
lookupPersonAction({ name, company, templateId })
 |
 |-- STEP 1: Check DB first --------------------------------
 |-- findPeopleByName({ name, company, limit: 5 })
 |   \-- fullName ILIKE contains, optional company ILIKE contains
 |
 |-- STEP 2: CSE lookup (if DB has < 3 people with emails) -
 |-- lookupByName({ name, company })
 |   |-- Pass 1: site:linkedin.com/in "name" "company" -> if results, return
 |   \-- Pass 2: site:linkedin.com/in "name" -> fallback (name only)
 |-- Save new CSE profiles to DB
 |
 |-- STEP 3: Merge + deduplicate ---------------------------
 |-- Combine DB results + CSE results
 |-- Deduplicate by person ID
 |-- Sort: has email first, then VERIFIED > UNVERIFIED > MISSING
 |-- Take top 5
 |
 |-- STEP 4: Enrich people without emails (pattern-only) ---
 |-- For each of top 5 without email:
 |   \-- Try pattern lookup -> generateEmailFromPattern() (free)
 |-- Apollo enrichment happens at send time, not during lookup
 |
 \-- STEP 5: Build results with drafts ---------------------
     \-- buildResultsWithDrafts() (same as discovery search)
```

---

## Key Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| MAX_CSE_PAGE_START | 21 | search-cache.ts | Hard cap: 3 CSE pages per search |
| MAX_PRESCRAPE_PAGES | 2 | search.ts | Background prescrape page limit |
| CSE_EXHAUSTED_THRESHOLD | 5 | search-cache.ts | If CSE returns < 5 profiles, mark exhausted |
| SCRAPE_PROGRESS_TTL_DAYS | 30 | search-cache.ts | After 30 days, allow re-scraping |
| PERSON_CACHE_TTL_DAYS | 60 | search-cache.ts | Staleness check for person data |
| MAX_RETRIES | 5 | SearchPageClient.tsx | Load More retry attempts |
| Retry delay | 3 seconds | SearchPageClient.tsx | Delay between Load More retries |
| BATCH_SIZE | 10 | linkedin-scraper.ts | URLs per Apify scraper batch |
| Vector distance threshold | 0.35 | person-service.ts | Max cosine distance for role matching |
| Ranking weights (keyword) | role=0.85, email=0.10 | ranking.ts | Keyword mode scoring weights |

---

## Changes Since Last Refactor

### DB Query Changes:
1. **Persisted emailDeliverable** from Apollo (was available but never saved). Backfilled 239 rows.
2. **Removed offset pagination** — pagination now uses `excludePersonIds` (NOT IN) instead of OFFSET. Eliminates skipped people during background scraping.
3. **Moved sent/hidden exclusion to DB level** — replaced in-memory fullName_company key filtering with DB-level id NOT IN, reducing overfetch waste.
4. **Fixed short company alias matching** — changed `equals` to `startsWith` for aliases like "ey" so "EY Advisory" is no longer missed.

### Scrape Decision Changes:
- Simplified from three paths (0 / 1-4 / 5+) to two paths (0 / 1+). The "1-4 results" path that ran scraping in parallel with the query is gone. Now it's just:
  - 0 results -> sync scrape page 1
  - 1+ results -> return immediately, prescrape fires from client

### Scraper Changes:
1. **No Apollo during scraping** — profiles are saved without emails. Emails are populated via pattern matching when a search query matches them via `enrichPeopleWithPatterns()`. Apollo runs at send time only.
2. **enrichPeopleWithPatterns()** (renamed from `enrichPeopleOnDemand`) — pattern-only, no Apollo calls. Runs when DB results are under the limit. Apollo enrichment moved to `enrichPersonBeforeSend()` in `send.ts`.
3. **Apollo pattern learning removed from discovery flow** — patterns must be added manually.
4. **Prescrape moved to initial search** — prescrape fires immediately after the first search response, not triggered by Load More. Load More is now a pure DB read.
5. **CSE company pre-filter** — before scraping, checks og:description metatag to skip people whose CSE-reported company doesn't match the search company.
6. **LLM company expansion disabled** — `expandCompanyName()` (Groq) exists but is not called. `buildCompanyQueryPart()` just quotes the company name.

### Page Budget Changes:
1. **Reduced from 5 to 3 CSE pages** — `MAX_CSE_PAGE_START` 41→21, `MAX_PRESCRAPE_PAGES` 4→2. Pages 4-5 had diminishing relevance (CSE results ranked by quality) and consumed CSE quota + Apify credits on low-value profiles.
2. **Daily CSE capacity** — 100 free queries/day ÷ 3 pages = ~33 full searches/day (up from ~20).

### Enrichment Changes:
1. **Apollo moved to send time** — search flow is now entirely free (pattern-only enrichment). Apollo `findEmail()` only called via `enrichPersonBeforeSend()` in `send.ts` when the user clicks Send.
2. **requireEmail: false** — search now returns people without emails. Email status is hidden from the UI entirely for a consistent experience — every card looks the same.
3. **Apollo-failed filter** — people where Apollo already tried and found no email (`apolloEnrichedAt IS NOT NULL AND email IS NULL`) are excluded from all search results. This prevents showing un-contactable people and avoids duplicate Apollo calls across users.
4. **Ranking weight adjustment** — email weight 0.15→0.10, MISSING score 0→0.3 (people without emails no longer heavily penalized since Apollo runs at send time).

### Ranking Changes:
1. **Vector role matching** — pgvector cosine distance replaces keyword-based role scoring when OPENAI_API_KEY is set.
2. **Role embeddings** — generated fire-and-forget on every person save/update.
3. **Dual ranking path** — vector mode skips `rankCandidates()` entirely; keyword mode uses Jaccard similarity with abbreviation expansion.
