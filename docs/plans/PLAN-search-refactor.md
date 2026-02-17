# Search Refactor: Database-First Approach

## Current Problem
- CSE query with all filters (company + role + university + location) is too restrictive
- Returns 0 results because LinkedIn profiles rarely contain all exact phrases
- Apollo data is wasted when people don't match current search filters

## New Approach
1. **CSE Discovery**: Broad query (company only, or company + university)
2. **Apollo Enrichment**: Enrich ALL discovered people
3. **Save to DB**: Store ALL people with valid Apollo data
4. **Query DB**: Filter by user criteria at database level

---

## Implementation Plan

### Phase 1: Refactor Discovery Query
**File:** `src/lib/services/discovery.ts`

**Changes:**
- Simplify query building - only use company (required) and optionally university
- Remove role and location from CSE query (these become DB filters)
- Keep the same pagination and name extraction logic

**Before:**
```typescript
if (company) queryParts.push(`"${company}"`);
if (location) queryParts.push(location);
if (role) queryParts.push(`"${role}"`);
if (university) queryParts.push(`"${university}"`);
```

**After:**
```typescript
// Only company is used for CSE (required)
if (company) queryParts.push(`"${company}"`);
// University helps narrow to alumni but doesn't over-restrict
if (university) queryParts.push(`"${university}"`);
// Role and location are NOT used in CSE - they become DB filters
```

---

### Phase 2: Refactor Search Action - Fresh Search Path
**File:** `src/app/actions/search.ts`

**Changes:**
1. Call CSE with broad query (company + university only)
2. Enrich ALL people with Apollo (no pre-filtering)
3. Save ALL people with valid Apollo data to Person table
4. Query Person table with user's filters (company, location, email required)
5. Return filtered results to user

**New Flow:**
```
1. CSE: searchPeople({ company, university, limit: 100 })
2. Apollo: enrich ALL people
3. Save: ALL people with apolloEnrichedAt to Person table
4. Query: SELECT * FROM Person WHERE
     company ILIKE '%{company}%'
     AND city ILIKE '%{location}%'
     AND email IS NOT NULL
5. Rank & Return: top N results
```

---

### Phase 3: Create Database Query Function
**File:** `src/lib/db/person-service.ts` (new function)

**New Function:** `findPeopleByFilters()`
```typescript
interface PersonFilters {
  company?: string;      // Required - ILIKE match
  location?: string;     // Optional - city ILIKE match
  role?: string;         // Optional - role ILIKE match
  university?: string;   // Optional - educationSchool ILIKE match
  requireEmail: boolean; // Usually true
  limit: number;
}

async function findPeopleByFilters(filters: PersonFilters): Promise<Person[]>
```

---

### Phase 4: Update Search Action - Cached Path
**File:** `src/app/actions/search.ts`

**Changes:**
- Remove hard filters from cached path (they're now in DB query)
- Use `findPeopleByFilters()` instead of `getPersonsByIds()`
- Cache stores search params, not person IDs (or we skip cache entirely)

**Decision:** Consider if caching is still needed:
- Option A: No cache - always query DB (simpler, DB is fast)
- Option B: Cache search params + results for 24h (current approach)

**Recommendation:** Option A (no search cache) - the Person table IS the cache

---

### Phase 5: Cleanup
- Remove `Search` and `SearchPerson` tables if no longer needed
- Or repurpose them for analytics/history

---

## Testing Plan

### Test 1: CSE Query Simplification
**Goal:** Verify broad CSE query finds more people

```typescript
// Test script: scripts/test-broad-cse.ts
const results = await searchPeople({
  company: "Boston Consulting Group",
  university: "University of Texas at Austin",
  limit: 50,
});
console.log(`Found: ${results.length} people`);
// Expected: 20-50 people (vs 0 with all filters)
```

### Test 2: Apollo Enrichment & Storage
**Goal:** Verify all CSE results get Apollo data and are saved

```typescript
// After running search for BCG + UT Austin
const bcgPeople = await prisma.person.findMany({
  where: { company: { contains: "boston consulting", mode: "insensitive" } }
});
console.log(`Total BCG in DB: ${bcgPeople.length}`);
console.log(`With email: ${bcgPeople.filter(p => p.email).length}`);
console.log(`With Apollo data: ${bcgPeople.filter(p => p.apolloEnrichedAt).length}`);
// Expected: All have apolloEnrichedAt, ~70% have email
```

### Test 3: Database Filtering
**Goal:** Verify DB query returns correct filtered results

```typescript
// Test findPeopleByFilters
const houstonBCG = await findPeopleByFilters({
  company: "Boston Consulting Group",
  location: "Houston",
  requireEmail: true,
  limit: 20,
});
console.log(`Houston BCG with email: ${houstonBCG.length}`);
// All should have: company contains BCG, city contains Houston, email not null
```

### Test 4: End-to-End User Search
**Goal:** Verify user search returns expected results

```
1. Clear all BCG data
2. User searches: BCG + Houston + UT Austin + Consulting Associate
3. Verify:
   - CSE called with: "Boston Consulting Group" "University of Texas at Austin"
   - Multiple people enriched via Apollo
   - DB queried with: company=BCG, city=Houston, email required
   - Only Houston BCG people with emails shown
```

### Test 5: Data Reuse Across Searches
**Goal:** Verify Apollo data is reused

```
1. Search: BCG + Houston
2. Note Apollo API calls made
3. Search: BCG + Dallas
4. Verify: People already in DB don't trigger new Apollo calls
5. Dallas people shown (from same CSE discovery, different DB filter)
```

### Test 6: Edge Cases
- Search with no location → all BCG people with email
- Search with no results → graceful empty response
- Person with no city from Apollo → excluded when location filter specified
- Person at different company (Apollo reveals) → excluded

---

## Migration Steps

1. Deploy Phase 1-3 (new code paths)
2. Keep old code path as fallback
3. Test with feature flag or A/B
4. Once validated, remove old code
5. Optionally drop Search/SearchPerson tables

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/services/discovery.ts` | Simplify query (Phase 1) |
| `src/lib/db/person-service.ts` | Add `findPeopleByFilters()` (Phase 3) |
| `src/app/actions/search.ts` | Refactor search flow (Phase 2, 4) |
| `src/lib/db/search-cache.ts` | Possibly remove or simplify (Phase 5) |

---

## Estimated Changes
- ~50 lines modified in discovery.ts
- ~100 lines new in person-service.ts
- ~150 lines modified in search.ts
- Tests: ~200 lines
