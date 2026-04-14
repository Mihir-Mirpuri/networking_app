# Retrieval Architecture Proposal

**Author:** Researcher
**Date:** 2026-04-13
**Status:** Draft for team review

---

## 1. DATA PROFILE

### Table: Person -- 10,005 rows

| Metric | Value |
|--------|-------|
| Total rows | 10,005 |
| With role | 9,979 (99.7%) |
| With role_embedding | 9,679 (97.0%) |
| With email | 2,905 (29.0%) |
| With city | 9,395 (93.9%) |
| With state | 7,703 (77.0%) |
| With educationSchool | 9,469 (94.6%) |
| With linkedinUrl | 10,005 (100%) |
| With schools JSON | 7,548 (75.4%) |
| With experienceHistory JSON | 2,641 (26.4%) |
| scrapeDepth "full" | 9,829 (98.2%) |
| scrapeDepth "short" | 176 (1.8%) |

### Role Distribution

- **5,123 distinct roles** across 9,979 people
- 4,546 roles appear only ONCE (88.7% of distinct roles are singletons)
- Only 10 roles appear >100 times
- Top 5: Investment Banking Analyst (333), Software Engineer (331), Associate (259), Partner (170), Consultant (162)
- This is an extremely long-tail distribution. Most people have unique or rare title variations.

### Company Distribution

- Top 5: McKinsey (687), Goldman Sachs (654), Bain (319), BCG (316), Google (300)
- Data is heavily skewed toward finance/consulting/big tech -- consistent with a professional networking tool aimed at students/young professionals.

### City Normalization Problem

"New York" exists as 6+ variants in the city column:
- "New York" -- 1,319
- "New York City" -- 486
- "New York City Metropolitan Area" -- 196
- "Greater New York City Area" -- 23
- "NYC" -- 4
- "New york" -- 1

Total: ~2,032 people in NYC, but a search for `city ILIKE '%New York%'` only catches 2,027 (misses "NYC" variants). The current `ILIKE '%part%'` approach handles this reasonably well but not perfectly.

### Email Status

| Status | Count |
|--------|-------|
| MISSING | 6,786 (67.8%) |
| VERIFIED | 1,834 (18.3%) |
| UNVERIFIED | 1,071 (10.7%) |
| NULL | 314 (3.1%) |

**Critical insight:** When `requireEmail=true` (the default), the searchable pool drops from 10,005 to ~2,905. This is the #1 constraint on result quality -- the pool is small.

### Education Distribution

- Top school: University of Texas at Austin (2,177 -- 21.7% of all rows)
- Heavily skewed toward UT Austin, Texas A&M, and Ivy League schools
- Schools stored as free text with some normalization (MIT, NYU, USC as abbreviations)

### Table Size and Indexes

- **Table data:** 7 MB
- **Indexes + embeddings:** 84 MB (12x the data -- dominated by vector storage)
- **No HNSW or IVFFlat vector index exists** -- every vector query does a sequential scan
- **No pg_trgm extension installed** -- no fuzzy text matching available
- **No composite index on (company, role)** or any text-search index
- **pgvector 0.8.0** is installed

### Existing Indexes on Person

1. `Person_pkey` -- btree(id)
2. `Person_fullName_company_key` -- unique btree(fullName, company)
3. `Person_emailStatus_idx` -- btree(emailStatus)
4. `Person_linkedinUrl_idx` -- btree(linkedinUrl)
5. `Person_apolloEnrichedAt_idx` -- btree(apolloEnrichedAt)
6. `Person_scrapedAt_idx` -- btree(scrapedAt)

None of these help with the search query pattern (company ILIKE + role matching + email IS NOT NULL).

### Vector Distance Distribution (search: "consultant")

| Percentile | Distance |
|-----------|----------|
| min | 0.0000 |
| p10 | 0.5082 |
| p25 | 0.5685 |
| p50 | 0.6163 |
| p75 | 0.6612 |
| p90 | 0.7045 |
| max | 0.9097 |

With the current thresholds:
- narrow (<=0.28): 331 matches -- all genuine consulting variants
- standard (<=0.38): 419 matches -- adds borderline roles like "Consulting Solutions Associate", "Energy Consultant"
- broad (<=0.48): 737 matches -- adds "Strategy Advisor", "Internal Client Advisor" (more noise)

The vector approach shows **excellent precision** at the narrow threshold and **good precision** at standard. The broad threshold starts introducing noise.

For "product manager" the picture is even cleaner -- distance 0.18 cleanly separates PM variants from non-PM roles.

### Query Timing (at 10K rows, both sequential scan)

- **Vector path:** ~15.8ms (consultant at McKinsey with email)
- **ILIKE path:** ~8.5ms (same query)

Both are fast enough. The difference is the vector path computes 9,679 cosine distances per query.

### RoleEmbedding Cache

Only 9 entries cached. Most search-time embeddings are computed via OpenAI API call (~1.2s latency) on first use, then cached in-memory and DB.

---

## 2. CODEBASE ANALYSIS

### How the Current System Works

**Entry point:** `searchPeopleAction` in `/src/app/actions/search.ts`

**Search extraction:** User's natural language query is parsed by Claude Haiku using the prompt in `/src/lib/prompts/search-extraction-prompt.ts`. This extracts:
- `filters.company`, `filters.role`, `filters.location`, `filters.university`
- `linkedin_filters` for the Apify LinkedIn scraper
- `role_specificity`: narrow / standard / broad

**Company resolution pipeline:**
1. `resolveCompanyAliases()` (`/src/lib/services/company-alias.ts`) -- resolves "GS" to ["goldman sachs", "gs"] via DB cache or Groq LLM
2. `resolveCompanyUrl()` (`/src/lib/services/company-resolver.ts`) -- resolves company name to LinkedIn URL via DB cache or Claude Sonnet

**DB query path:** `findPeopleByFilters()` in `/src/lib/db/person-service.ts` (line 934):
1. If role provided AND `USE_VECTOR_ROLE_MATCHING !== 'false'` AND `OPENAI_API_KEY` set:
   - Get search role embedding via `getSearchRoleEmbedding()` (3-tier: memory -> DB -> OpenAI API)
   - Dispatch to `findPeopleByFiltersVector()` (line 1020)
2. Else: use ILIKE path with `getRoleSearchTerms()` alias expansion

**Vector path** (`findPeopleByFiltersVector`, line 1020-1211):
- Builds raw SQL with WHERE clauses for company (ILIKE), location (ILIKE on city/state), university (ILIKE on educationSchool + schools JSON), email (IS NOT NULL), excludes (NOT IN)
- Adds `role_embedding <=> search_embedding <= threshold` where threshold is {narrow: 0.28, standard: 0.38, broad: 0.48}
- Orders by cosine distance ASC, then email status, then confidence
- Overfetches 2x limit, then post-filters on company name fuzzy match
- Fetches source links in a second query

**ILIKE path** (`findPeopleByFilters`, line 934-1012):
- Uses Prisma `findMany` with `{ contains: term, mode: 'insensitive' }` for role matching
- Role aliases expand "VP" to ["vice president", "vp"] for OR-based ILIKE
- Same company/location/university/email filters
- Orders by emailStatus ASC, emailConfidence DESC, createdAt ASC

**Post-query ranking:** `rankCandidates()` in `/src/lib/services/ranking.ts`:
- When vector matching is active: weights are 100% email quality (role already sorted by vector distance)
- When ILIKE: weights are 90% role match (Jaccard similarity), 10% email quality
- Company/location/university get 0% weight because they're hard-filtered in SQL

### Key Architectural Observations

1. **The vector path is well-designed for role matching.** Empirical data confirms it finds semantically similar roles (e.g., "Sr. Consultant" at distance 0.29, "Management Consultant" at 0.21). The thresholds are reasonable.

2. **The ILIKE path has a precision problem with roles.** `ILIKE '%consultant%'` matches "Vice President Financial Consultant", "CEO Peer Advisory Group Chair + Strategic Consultant", "Tax Consultant - Transfer Pricing" -- all of which are semantically distant from the user's intent. The alias expansion helps but only covers hardcoded groups.

3. **Company matching is the weakest link.** The multi-layer approach (alias resolution -> ILIKE -> post-query fuzzy match) is complex and fragile. For short company names like "EY" or "GS", exact match is used (correct), but for longer names, `ILIKE '%term%'` can match unintended companies.

4. **No index supports the common query pattern.** Every search does a sequential scan. At 10K rows this is fine (~10-16ms), but will not scale.

5. **The email constraint is the biggest bottleneck.** Only 29% of people have email. When `requireEmail=true`, the candidate pool for "Consultants at McKinsey" drops from ~40+ to just 7-8 people. The system often has the right people but can't show them because they lack email.

6. **300 people have roles but no embedding** -- these are invisible to the vector path. They include common roles like "Business Analyst" (11) and "Senior Business Analyst" (7), suggesting a stamping gap.

---

## 3. THREE PROPOSED ARCHITECTURES

### Architecture A: Tuned Current System + Missing Indexes

**How it works:** Keep the existing dual-path (vector + ILIKE fallback) but fix the gaps:
- Add HNSW index on role_embedding for faster vector search
- Add composite btree index on (company, email) for the most common filter pattern
- Backfill the 300 missing role_embeddings
- Pre-seed RoleEmbedding cache with top 50 searched roles
- Relax `requireEmail` by default -- show email-less people with a "no email yet" badge, trigger Apollo enrichment on click

**Pros:**
- Minimal code changes -- mostly SQL migrations and config
- Vector path already has good precision (data confirms this)
- No reindexing of embeddings needed
- Can be shipped in a day

**Cons:**
- Does not fix the company matching fragility
- Does not fix the city normalization problem
- ILIKE fallback still has low precision for role matching
- At 10K rows, the performance gains from indexes are negligible (15ms -> ~5ms)

**Expected precision:** Same as current -- HIGH for common roles at specific companies, MEDIUM for long-tail roles, LOW for broad/generic searches.

**Complexity:** Very low. 2-3 SQL migrations + one backfill script.

### Architecture B: Hybrid Vector + Full-Text Search with Composite Scoring

**How it works:**
- Enable `pg_trgm` extension for fuzzy text matching
- Keep role_embedding for semantic role matching (proven effective)
- Add GIN trigram indexes on company and role columns
- Replace ILIKE company matching with `similarity()` function (threshold-based fuzzy match)
- Add a `tsvector` column for full-text search on role + company combined
- Composite scoring: vector distance for role + trgm similarity for company + exact match bonuses
- Single SQL query that combines all signals

**Query structure:**
```sql
SELECT p.*,
  (p.role_embedding <=> search_embedding) as role_dist,
  similarity(p.company, 'McKinsey') as company_sim,
  ts_rank(p.search_tsv, plainto_tsquery('consultant')) as text_rank
FROM "Person" p
WHERE p.company % 'McKinsey'  -- trgm similarity > threshold
  AND (p.role_embedding <=> search_embedding) <= 0.38
  AND p.email IS NOT NULL
ORDER BY role_dist * 0.7 + (1 - company_sim) * 0.3
LIMIT 20
```

**Pros:**
- Company matching becomes much more robust -- `similarity('Goldman Sachs', 'goldman sachs')` = 1.0, handles typos and variations
- GIN trigram index makes fuzzy company search index-backed (fast)
- Combines the best of vector (semantic role matching) and text (company/location matching)
- Naturally handles the city normalization problem (trgm similarity)

**Cons:**
- Requires `pg_trgm` extension (easy to enable on Supabase but needs migration)
- More complex query construction
- Tuning the composite score weights requires experimentation
- Two separate indexing systems to maintain (vector + trgm)
- trgm similarity has known weaknesses with very short strings ("EY", "GS")

**Expected precision:** HIGH for company+role queries (both signals reinforced), MEDIUM for broad role queries, LOW for very short company names (needs exact-match override).

**Complexity:** Medium. Extension + 2-3 indexes + query builder refactor. ~3-5 days.

### Architecture C: Composite Profile Embedding + Two-Stage Retrieval

**How it works:**
- Generate a single composite embedding per Person that encodes role + company + location + seniority signal
- Template: `"{role} at {company} in {city}, {state}"` -> embed with text-embedding-3-small
- At search time, embed the user's full query the same way: `"consultant at McKinsey in New York"` -> single vector comparison
- Stage 1 (broad retrieval): vector similarity search with HNSW index, top 100 candidates
- Stage 2 (precision filter): apply hard filters (email, exclude IDs) and re-rank with exact match bonuses

**Pros:**
- Single embedding captures the full search intent holistically
- HNSW index makes Stage 1 very fast (~2-5ms for top 100)
- Company matching is handled semantically -- "Goldman Sachs" and "GS" will be close in embedding space
- Simplifies the query builder -- no more separate ILIKE filters for each dimension
- Most robust to variations in how companies/roles are described

**Cons:**
- **Requires re-embedding all 10,005 rows** (~$0.10 at text-embedding-3-small rates, plus compute time)
- **Must re-embed whenever a person's role/company changes** -- ongoing maintenance cost
- Embeddings are less interpretable -- harder to debug "why did this person match?"
- If the user only specifies role (no company), the composite embedding might match wrong companies that happen to be textually similar
- **Loses the ability to hard-filter on individual dimensions** -- a consultant at Google might match "consultant at McKinsey" because "consultant" dominates the embedding
- Single-vector approach conflates independent dimensions that should be filtered separately

**Expected precision:** MEDIUM for specific company+role queries (embedding conflates dimensions), HIGH for holistic queries that match the template well, LOW when user specifies only one filter dimension.

**Complexity:** High. New embedding pipeline + HNSW index + re-embedding script + ongoing embedding maintenance. ~1-2 weeks.

---

## 4. CHOSEN DESIGN: Architecture B (Hybrid Vector + Full-Text with pg_trgm)

### Rationale

Architecture A is too conservative -- the company matching problem is real and the data shows it (the system relies on a fragile chain of alias resolution + ILIKE + post-query fuzzy match). Architecture C is too risky -- conflating all dimensions into one embedding loses the ability to hard-filter, and the empirical data shows that company and role are independent dimensions that should be filtered separately.

Architecture B keeps what works (vector role matching, which the data validates) and fixes what does not (company text matching). The `pg_trgm` approach is battle-tested, requires no ML pipeline, and gives us index-backed fuzzy matching.

### Technical Specification

#### 4.1 Prerequisites (Migrations)

```sql
-- Migration 1: Enable pg_trgm
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Migration 2: Add trigram indexes
CREATE INDEX CONCURRENTLY idx_person_company_trgm
  ON "Person" USING GIN (company gin_trgm_ops);

CREATE INDEX CONCURRENTLY idx_person_role_trgm
  ON "Person" USING GIN (role gin_trgm_ops);

-- Migration 3: Add HNSW vector index (cosine distance)
CREATE INDEX CONCURRENTLY idx_person_role_embedding_hnsw
  ON "Person" USING hnsw (role_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Migration 4: Composite btree for the most common filter pattern
CREATE INDEX CONCURRENTLY idx_person_company_email
  ON "Person" (company, email) WHERE email IS NOT NULL;

-- Migration 5: Backfill missing role_embeddings (run as script, not migration)
-- Identifies 300 rows with role but no embedding, generates + stamps them
```

#### 4.2 Function Signature

```typescript
export interface PersonFiltersV2 {
  // Required
  company: string;               // Primary company name
  limit: number;

  // Optional filters
  companyAliases?: string[];      // Pre-resolved aliases (from company-alias service)
  role?: string;                  // Role/title to match
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
  location?: string;              // City, state, or "City, State"
  university?: string;            // School name or abbreviation

  // Behavior
  requireEmail?: boolean;         // Default true
  excludePersonIds?: string[];    // Already-shown people

  // New in V2
  companyMatchMode?: 'exact' | 'fuzzy'; // Default 'fuzzy'
  companySimThreshold?: number;   // Default 0.3 (trgm similarity)
}

export async function findPeopleByFiltersV2(
  filters: PersonFiltersV2
): Promise<PersonResult[]>
```

#### 4.3 Query Construction Logic

The query has three layers: hard filters (WHERE), scoring (SELECT), and ranking (ORDER BY).

```sql
-- Pseudocode for the generated SQL
SELECT
  p.*,
  -- Role score: vector distance (lower = better)
  CASE
    WHEN p.role_embedding IS NOT NULL
    THEN (p.role_embedding <=> $roleEmbedding::vector)
    ELSE 1.0  -- penalty for missing embedding
  END as role_distance,

  -- Company score: trgm similarity (higher = better)
  GREATEST(
    similarity(lower(p.company), lower($companySearch)),
    -- Also check each alias
    similarity(lower(p.company), lower($alias1)),
    similarity(lower(p.company), lower($alias2))
  ) as company_similarity

FROM "Person" p

WHERE
  -- Hard filter: company (trgm-indexed, threshold 0.3)
  (
    -- For short aliases (<=3 chars), use exact match
    lower(p.company) = lower($shortAlias)
    OR
    -- For longer names, use trgm similarity
    p.company % $companySearch  -- uses GIN trgm index
    OR
    -- Also check pre-resolved aliases
    p.company ILIKE ANY($aliasPatterns)
  )

  -- Hard filter: role (vector threshold)
  AND (
    p.role_embedding IS NULL  -- include unembedded rows, rank them last
    OR (p.role_embedding <=> $roleEmbedding::vector) <= $roleThreshold
  )

  -- Hard filter: location
  AND ($location IS NULL OR p.city ILIKE $locationPattern OR p.state ILIKE $locationPattern)

  -- Hard filter: university (keyword AND matching)
  AND ($university IS NULL OR (
    p."educationSchool" ILIKE $uniKw1 AND p."educationSchool" ILIKE $uniKw2
    OR p.schools::text ILIKE $uniKw1 AND p.schools::text ILIKE $uniKw2
  ))

  -- Hard filter: email
  AND ($requireEmail = false OR p.email IS NOT NULL)
  AND (p."emailDeliverable" IS NULL OR p."emailDeliverable" = true)

  -- Hard filter: excludes
  AND p.id NOT IN ($excludePersonIds)

  -- Hard filter: must have role, not incoming/future
  AND p.role IS NOT NULL
  AND p.role !~* '^(incoming|future)\s+'

ORDER BY
  -- Primary: role distance (semantic match quality)
  role_distance ASC,
  -- Secondary: company similarity (exact matches first)
  company_similarity DESC,
  -- Tertiary: email quality
  CASE p."emailStatus"::text
    WHEN 'VERIFIED' THEN 0
    WHEN 'MANUAL'   THEN 1
    WHEN 'UNVERIFIED' THEN 2
    ELSE 3
  END ASC,
  p."emailConfidence" DESC NULLS LAST

LIMIT $fetchLimit  -- 2x requested limit for post-filter safety margin
```

#### 4.4 How Each Filter Type is Handled

**Company:**
- Short names (<=3 chars like "EY", "GS"): exact case-insensitive match via `lower(company) = lower(alias)`. This prevents "EY" from matching "MonEY" or "HonEY".
- Longer names: `pg_trgm` similarity with threshold 0.3. This handles "Goldman Sachs" matching "Goldman Sachs & Co." or "Goldman, Sachs & Co." naturally. The GIN index makes this fast.
- Pre-resolved aliases are still checked via ILIKE as a fallback (backward compatible with the existing company-alias service).
- Post-query fuzzy filter is **removed** -- trgm makes it unnecessary.

**Role:**
- Vector cosine distance with thresholds (unchanged from current system -- it works well):
  - narrow: <= 0.28 (niche titles: "Quantitative Researcher")
  - standard: <= 0.38 (common titles: "Software Engineer", "Product Manager")
  - broad: <= 0.48 (generic: "Engineer", "Designer")
- HNSW index accelerates the distance computation
- Rows without embeddings are included but ranked last (distance = 1.0)

**Location:**
- Unchanged from current system: ILIKE on city and state columns with comma-split handling
- Future improvement: normalize cities at ingest time (not in scope for V2)

**University:**
- Unchanged: keyword AND-matching via the existing `getUniversityKeywords()` function
- Also checks `schools` JSON column via `::text ILIKE`

**Email:**
- Unchanged: `IS NOT NULL` filter + `emailDeliverable` check

#### 4.5 Scoring and Ranking

The ORDER BY clause handles ranking directly in SQL (no post-query re-ranking needed):

1. **role_distance ASC** -- closest semantic match first. This is the primary differentiator because company/location/university are hard-filtered.
2. **company_similarity DESC** -- among equal role matches, prefer exact company name matches over fuzzy ones.
3. **emailStatus ASC** -- VERIFIED > MANUAL > UNVERIFIED > MISSING
4. **emailConfidence DESC** -- higher confidence emails first

This eliminates the need for the separate `rankCandidates()` post-processing step in most cases.

#### 4.6 Edge Cases and Fallbacks

1. **No role specified:** Skip vector matching entirely. Order by company_similarity DESC, then email quality. This is the "people at McKinsey" query pattern.

2. **No company specified:** This should not happen (search-extraction prompt enforces company), but if it does, skip company filter and use only role + location + university.

3. **OpenAI API failure (no role embedding):** Fall back to ILIKE role matching with alias expansion (current behavior). Log a warning.

4. **pg_trgm similarity returns 0 for all aliases:** This means the company name is completely different from what's in the DB. Fall back to ILIKE contains match. This handles the case where a brand-new company has no close matches in trgm space.

5. **Very few results (<5) with requireEmail=true:** Re-run with `requireEmail=false` and return results with a flag indicating "email not yet available -- will be enriched on send." This addresses the 29% email coverage problem.

6. **Embedding not in RoleEmbedding cache:** Current 3-tier lookup (memory -> DB -> OpenAI API) remains. First search for a new role incurs ~1.2s OpenAI latency, subsequent searches are instant.

#### 4.7 Migration Steps

1. **Enable pg_trgm** via Supabase SQL editor or migration
2. **Create GIN trigram indexes** on company and role (CONCURRENTLY to avoid locking)
3. **Create HNSW vector index** on role_embedding (CONCURRENTLY -- may take a few seconds for 10K rows)
4. **Create composite btree index** on (company, email)
5. **Backfill 300 missing role_embeddings** via script that:
   - Queries `SELECT id, role FROM "Person" WHERE role IS NOT NULL AND role_embedding IS NULL`
   - For each, calls `stampPersonRoleEmbedding()` (which uses cached embeddings from RoleEmbedding table)
   - For roles not in cache, generates embedding via OpenAI and caches first
6. **Pre-seed RoleEmbedding table** with top 50 searched roles
7. **Implement `findPeopleByFiltersV2()`** in person-service.ts
8. **Update `findPeopleByFilters()`** to call V2 (feature-flagged)
9. **Remove post-query company fuzzy filter** (trgm replaces it)
10. **Remove `rankCandidates()` call** from search action (SQL ORDER BY replaces it)

---

## 5. FILE PATHS

Every file the Engineer needs to read before implementing:

### Core (must read end-to-end)
- `/Users/saketmugunda/Documents/networking_app/prisma/schema.prisma` -- Person model, role_embedding column, RoleEmbedding model
- `/Users/saketmugunda/Documents/networking_app/src/lib/db/person-service.ts` -- `findPeopleByFilters()` (line 934), `findPeopleByFiltersVector()` (line 1020), `buildPersonWhereClause()` (line 748), `PersonFilters` interface (line 726), role alias groups (line 642), university aliases (line 14), `companiesMatch()` (line 100)
- `/Users/saketmugunda/Documents/networking_app/src/lib/services/embeddings.ts` -- `getSearchRoleEmbedding()`, `stampPersonRoleEmbedding()`, RoleEmbedding cache logic

### Secondary (understand the callers)
- `/Users/saketmugunda/Documents/networking_app/src/app/actions/search.ts` -- `searchPeopleAction()` which calls `findPeopleByFilters()` and `rankCandidates()`
- `/Users/saketmugunda/Documents/networking_app/src/lib/services/ranking.ts` -- `rankCandidates()` and `scoreCandidate()` which will be partially replaced by SQL ORDER BY
- `/Users/saketmugunda/Documents/networking_app/src/lib/services/company-alias.ts` -- `resolveCompanyAliases()` which produces the `companyAliases` array
- `/Users/saketmugunda/Documents/networking_app/src/lib/services/company-resolver.ts` -- `resolveCompanyUrl()` for LinkedIn URL resolution (not directly related but part of the search pipeline)
- `/Users/saketmugunda/Documents/networking_app/src/lib/prompts/search-extraction-prompt.ts` -- the Haiku prompt that produces `role_specificity` and `linkedin_filters`

### Reference (for migration writing)
- `/Users/saketmugunda/Documents/networking_app/src/lib/prisma.ts` -- Prisma client singleton
- pgvector docs for HNSW index syntax
- pg_trgm docs for `%` operator and `similarity()` function

---

## APPENDIX: Raw Query Results

### A. Vector Neighborhood for "consultant" (top 20 by distance)

| Role | Distance | Count |
|------|----------|-------|
| Consultant | 0.0000 | 162 |
| Consulting | 0.1952 | 1 |
| Senior Consultant | 0.2028-0.2029 | 60 |
| Expert Consultant | 0.2046 | 1 |
| Management Consultant | 0.2062-0.2063 | 14 |
| Strategy Consultant | 0.2307 | 2 |
| Business Consultant | 0.2396 | 1 |
| Consulting Manager | 0.2429 | 2 |
| Associate Consultant | 0.2503-0.2505 | 79 |
| Advisory Consultant | 0.2515 | 1 |
| Research Consultant | 0.2548 | 1 |
| Principal Consultant | 0.2727 | 1 |
| Healthcare Consultant | 0.2741 | 2 |

**Observation:** At distance <= 0.28 (narrow threshold), all 331 results are genuine consulting roles. Zero noise. The vector space for roles is well-separated.

### B. Borderline roles (0.28-0.38 from "consultant")

Includes: Consulting Assistant, Junior Consultant, Technical Consultant, Consulting Analyst, Sr. Consultant, Independent Consultant, Senior Associate Consultant, Energy Consultant, Security Consultant.

**Observation:** All still genuine consulting-adjacent roles. Standard threshold (0.38) has high precision for this search.

### C. ILIKE '%consultant%' results (for comparison)

Includes everything from A+B, plus: "Vice President Financial Consultant", "CEO Peer Advisory Group Chair + Strategic Consultant", "Tax Consultant - Transfer Pricing".

**Observation:** ILIKE has higher recall but lower precision. The vector approach is strictly better for role matching when embeddings are available.

### D. Vector Neighborhood for "product manager" (top 20 by distance)

| Role | Distance | Count |
|------|----------|-------|
| Product Manager | 0.0000 | 146 |
| Product Marketing Manager | 0.1254 | 1 |
| Technical Product Manager | 0.1290-0.1291 | 5 |
| Product Manager 2 | 0.1311 | 3 |
| Product Manager - Lead | 0.1400 | 1 |
| Product Director | 0.1403 | 1 |
| Principal Product Manager | 0.1439-0.1496 | 17 |
| Senior Product Manager | 0.1453-0.1454 | 67 |
| Lead Product Manager | 0.1599-0.1600 | 4 |
| Group Product Manager | 0.1614 | 10 |
| Staff Product Manager | 0.1712 | 6 |

**Observation:** At distance <= 0.18, you get exact PM variants. At <= 0.38 (standard), you get all PM-family roles including Director of Product Management (0.23) and VP Product Management (0.22). Excellent separation.
