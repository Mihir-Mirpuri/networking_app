# Canonical Entity Normalization (Company + School)

**Status:** Design approved, ready for implementation planning
**Date:** 2026-04-16
**Author:** Brainstorm with Saket
**Scope:** Normalize `Person.company` and `Person.educationSchool` / `Person.schools[]` into canonical entity tables with foreign-key references, to improve search recall and eliminate write-time drift.

---

## Problem

Today the discovery pipeline stores unnormalized string values for company and school on `Person` rows, and reconciles variance at query time with a mix of in-code alias maps, ILIKE substring matching, and keyword-AND heuristics. This causes three problems:

1. **Search recall loss.** A person whose LinkedIn profile says "Wharton School" doesn't match a search for "University of Pennsylvania" unless the alias map happens to cover that pair and the query path happens to normalize it. The problem is worst in the short-mode write path (`saveShortProfile` / `saveShortProfilesBatch`), which stores the user's raw `schoolTag` filter string verbatim in `Person.educationSchool` and `Person.schools`. A search for "Wharton" seeds Wharton-tagged rows that later miss a "Penn" search.
2. **Data hygiene.** "Goldman", "Goldman Sachs", and "Goldman Sachs Group" live as three buckets. Analytics like "count all Penn alumni in the DB" require string aggregation over noisy values.
3. **Cost and latency.** Company alias resolution fires Groq calls reactively from user input with no durable link to `Person` rows. Queries pay for ILIKE scans and a separate `::text ILIKE` scan on the `schools` JSON column.

## Goals

- Any input a user types (alias, abbreviation, sub-school, legal-suffix variant) resolves to the same canonical entity at both write and read time.
- Search results for "GS grads from Wharton" are identical to "Goldman Sachs grads from UPenn".
- New writes cannot re-introduce un-canonicalized values, even when a future engineer adds a new write path.
- Existing `Person` rows get retroactively canonicalized.
- Rollout is phased; each phase is shippable and reversible in isolation.

## Non-goals

- Normalizing roles — vector embeddings on `Person.role_embedding` already handle semantic variance; adding an alias table duplicates effort with worse coverage.
- Normalizing locations — geo normalization wants a geocoding service, not alias maps; separate future project.
- Introducing a two-level school schema (parent university + department). The original brainstorm considered preserving "Wharton vs Penn Law vs Penn College" as a queryable distinction; rejected because the degree column and raw `educationHistory` JSON already preserve that information for display, and no current product need requires filtering "Wharton MBAs only" as a distinct bucket.
- Dropping the `CompanyAlias` table immediately. Migrated-from but kept for one release as a rollback safety net.

---

## Data model

Two new tables. `Person` gets two new columns. Existing columns are preserved.

```prisma
model Company {
  id            String    @id @default(cuid())
  canonicalName String    @unique
  aliases       String[]
  source        String    @default("SEED") // SEED | LLM | MANUAL
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  persons       Person[]

  @@index([aliases], type: Gin)
}

model School {
  id            String    @id @default(cuid())
  canonicalName String    @unique
  aliases       String[]
  source        String    @default("SEED")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([aliases], type: Gin)
}

model Person {
  // ... existing fields preserved as-is ...
  companyId     String?
  schoolIds     String[]  @default([])
  company2      Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)

  @@index([companyId])
  @@index([schoolIds], type: Gin)
}
```

### Key decisions

- **Nullable `companyId`.** Legacy rows without a resolved company don't break the schema. Phase 2 backfill populates them; Phase 3 readers handle null by falling back to string match until backfill completes.
- **Array `schoolIds`, not a single FK.** A person can have multiple degrees from different universities (undergrad + grad). Ordered — `[0]` is the primary for display.
- **Raw strings preserved.** `Person.company`, `Person.educationSchool`, `Person.schools[]`, `Person.experienceHistory`, `Person.educationHistory` stay. Load-bearing for bug-safety: if a canonical lookup fails, readers still match the old way. Also preserves display fidelity ("Google LLC" in the UI) and provenance.
- **GIN indexes on `aliases[]` and `schoolIds[]`.** Postgres native; makes `WHERE 'wharton' = ANY(aliases)` and `WHERE 'schoolId' = ANY(schoolIds)` index hits.
- **`@onDelete: SetNull`.** Deleting a Company row doesn't cascade-delete people; they fall back to string matching. Fail-safe.
- **Relation field named `company2`** in Phase 1/2 to avoid colliding with the existing `company` string column. Renamed in Phase 4 cleanup after the string is dropped (if we choose to drop it).
- **`CompanyAlias` table is deprecated but not dropped.** Rows migrated into `Company` during seeding; old table survives one release as rollback safety.

### What this does NOT change

- No change to `Search`, `UserCandidate`, `SearchPerson`, `SourceLink`.
- No change to the public API of `searchPeopleV2Action`, `loadMoreV2Action`, `lookupPersonAction`, `findPeopleByFiltersV3`. These still take company-name strings; resolution happens inside.

---

## Write path

One new file, four call-site changes.

### New module: `src/lib/services/entity-resolver.ts`

```ts
findOrCreateCompany(rawName: string): Promise<{ companyId: string; canonicalName: string }>
findOrCreateSchool(rawName: string): Promise<{ schoolId: string; canonicalName: string }>
```

Both follow a 3-tier lookup, mirroring the existing `resolveCompanyAliases` in `src/lib/services/company-alias.ts`:

1. **DB alias match.** `SELECT ... WHERE normalizedInput = ANY(aliases) LIMIT 1`. Hit returns.
2. **LLM (Groq) resolution.** Returns `canonicalName` + 2–5 aliases. Row is created if new; merged if canonicalName collides.
3. **Fallback on LLM failure.** Create row with `canonicalName = rawName`, `aliases = [normalized]`, `source: "FALLBACK"`. Never throws.

An in-memory LRU cache (server-lifecycle) sits in front of both, keyed by `normalized(input)` — same pattern as the existing `companyExpansionCache` Map.

### Call site changes

| File | Current behavior | After |
|------|------------------|-------|
| `person-service.ts:saveScrapedProfile` | stores `company`, `educationSchool`, `schools[]` | ALSO calls `findOrCreateCompany(company)` and `findOrCreateSchool()` per entry in `schools[]` → stores `companyId` + `schoolIds[]` |
| `person-service.ts:saveShortProfile` | stores raw `schoolTag` verbatim in `educationSchool` + `schools` | calls `findOrCreateSchool(schoolTag)` → stores canonical name for display and `schoolIds[]` for matching. **Fixes the short-mode leak.** |
| `person-service.ts:saveShortProfilesBatch` | same as above, batched | batch-resolves unique companies + schools once per batch, then applies FKs in bulk update |
| `person-service.ts:saveDiscoveredPerson` | Apollo-enriched path | same resolver call added |

### Bug-safety properties

- **Dual-write.** Raw strings AND FKs written. If resolution returns null, raw string still lands; reader fallback still matches.
- **Idempotent.** `findOrCreateCompany("Google")` called twice returns the same `companyId`. Unique index on `canonicalName` + upsert semantics prevent duplicates under concurrency.
- **Non-blocking on failure.** Resolver is wrapped so a Groq outage doesn't break discovery. Failure is logged, counted, and execution continues.
- **No writes are removed.** A bug in the new resolver degrades to today's behavior.

---

## Read path

Two new resolver entry points, one query-builder change, one fallback branch.

### New helpers (same file as write resolvers)

```ts
resolveCompanyId(rawName: string): Promise<string | null>
resolveSchoolId(rawName: string): Promise<string | null>
```

Read-only siblings of the write helpers — same 3-tier DB→LLM→fallback, return `null` (not throw) on failure, same cache.

### Call-site changes

1. **`searchPeopleV2Action` / `findPeopleByFiltersV3`.** After parsing filters, call `resolveCompanyId(company)` + `resolveSchoolId(university)` in parallel. Pass resolved IDs to `buildPersonWhereClause`.

2. **`buildPersonWhereClause` (the hot path).**

   ```ts
   // BEFORE
   where.company = { contains: alias, mode: 'insensitive' }
   educationSchool: { contains: keyword, mode: 'insensitive' }

   // AFTER (when IDs resolved)
   where.companyId = resolvedCompanyId
   where.schoolIds = { has: resolvedSchoolId }
   ```

3. **Fallback branch (bug-safety).** If `resolvedCompanyId === null` (resolver failed OR the input is truly unknown), the builder falls back to today's `companiesMatch` / ILIKE path for that filter. Old behavior preserved for degraded cases.

### Deprecated but not deleted (Phase 3 makes them fallback-only; Phase 4 deletes)

- `companiesMatch()` — fallback on FK miss.
- `UNIVERSITY_ALIASES` in-code map + `getUniversityKeywords()` — fallback on FK miss.
- `getSchoolMatchIds()` raw-SQL ILIKE on JSON — fallback on FK miss.

### Affected readers (grep-verified)

`findPeopleByFilters`, `findPeopleByFiltersV2`, `findPeopleByFiltersV3`, `countPeopleByFilters` — all switch.
`findPeopleByName`, `lookupPersonAction` — name-based, no company/school filter, no change.

### Performance

`ILIKE '%kw%'` → `= :id`. Orders of magnitude faster on the Person table. Eliminates the `getSchoolMatchIds` raw-SQL pre-query on the `schools` JSON column.

### Bug-safety properties

- **Three layers of fallback.** FK lookup → string match → empty result. Each failure mode returns degraded but correct results, never wrong.
- **No API contract change.** All entry points still take name strings.
- **Null-safe.** A Person with `companyId = null` is matched via the fallback branch, invisible to the user.

---

## Backfill

One-shot script: `scripts/backfill-canonical-entities.ts`. Runs via `npx tsx`.

### Pass 1 — Build canonical tables

```
1. Seed Company from existing sources:
   - SELECT DISTINCT company FROM Person (raw input strings)
   - SELECT canonicalName, aliases FROM CompanyAlias (existing table)
   - Group by normalized form; largest row-count wins canonical name on collision
   - For each unseen canonical: findOrCreateCompany(rawName) via resolver

2. Seed School:
   - Merge SCHOOL_ALIASES + UNIVERSITY_ALIASES into canonical→aliases map
   - SELECT DISTINCT educationSchool FROM Person + flatten schools[] JSON
   - For each distinct raw: findOrCreateSchool via resolver

3. Deduplicate: if two canonical rows share any alias, merge. Log the first 5 for human review; auto-merge obvious cases (substring + same normalized form).
```

### Pass 2 — Stamp Person rows

```
Batched 500 rows per transaction.

For each person:
  newCompanyId = resolve(person.company)   // cache hit after Pass 1
  newSchoolIds = (person.schools || [person.educationSchool])
                   .map(resolveSchool).filter(notNull)
  UPDATE Person SET companyId=?, schoolIds=? WHERE id=?

Track progress in a BackfillProgress table:
  lastProcessedId, totalProcessed, errorCount, startedAt, completedAt
```

### Bug-safety properties

- **Idempotent.** Re-running is safe; already-stamped rows get the same IDs back (cache hits).
- **Resumable.** Crash at row 50,000 of 100,000 → restart picks up from `lastProcessedId`.
- **Non-blocking.** App stays live. Dual-write (Section: Write path) means new writes during the run work correctly. Readers use fallback for not-yet-backfilled rows.
- **Dry-run mode.** `--dry-run` reports proposed changes without writing.
- **Rollback.** `UPDATE Person SET companyId=NULL, schoolIds=ARRAY[]::text[]` reverts. No data loss; raw strings untouched.

### Estimated cost (~100K rows, ~5K unique companies, ~2K unique schools)

- ~7K Groq calls @ ~$0.0001 = **~$0.70 total** for LLM resolution.
- Most distinct values hit `SCHOOL_ALIASES` + `CompanyAlias` seeds in Pass 1, reducing LLM calls.
- Runtime: ~15–30 minutes for Pass 2.

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| LLM returns wrong canonical (e.g., "Apple" → "Apple Records") | Dry-run review surfaces; manual aliases override in seed data; unit tests cover known-hard cases. |
| Two distinct inputs wrongly merged ("Accenture" vs "Accenture Federal Services") | Dry-run diff exposes; manual correction in seed. |
| Script crashes mid-batch | Resumable via `lastProcessedId`; batches bound by transactions. |
| Live-traffic perf impact | Small batch size; can pause between batches; run off-peak. |

### Validation gates (required before prod run)

1. `--dry-run` on prod; human reviews a sample of 100 proposed mappings.
2. Optional: run on staging copy; compare "top 20 companies by row count" before/after.
3. Run the full discovery-flow test suite against staging post-backfill.

---

## Phased rollout

### Phase 1 — Foundation (no behavior change)

- `prisma db push` for new tables and columns.
- Ship `entity-resolver.ts` with helpers.
- Seed `School` from `SCHOOL_ALIASES` + `UNIVERSITY_ALIASES`.
- Seed `Company` from existing `CompanyAlias` rows.
- No writers or readers use the new columns yet.
- **Rollback:** Drop new tables/columns. Pure additive.
- **Merge gate:** Unit tests on resolvers; schema push succeeds on staging.

### Phase 2 — Dual-write

- Update all 4 write paths to stamp `companyId` / `schoolIds`.
- Readers unchanged (still ILIKE).
- Run backfill: `--dry-run` → human sample review → full run.
- Post-backfill: `companyId` non-null on >95% of rows; investigate remainder.
- **Rollback:** Revert writer PR. Backfilled data is harmless if unread. Or SQL-null the FK columns.
- **Merge gate:** discovery-flow tests pass; post-backfill spot-query "Penn alumni via FK vs via ILIKE" matches within 1–2%.

### Phase 3 — Reader cutover

- `buildPersonWhereClause` uses FK equality when resolved; falls back to ILIKE on null.
- Resolvers called at query time.
- **Feature flag `USE_CANONICAL_ENTITY_FKS`.** Default false for one deploy; flip to true; observe 24h.
- **Rollback:** Flip flag back. Instant revert.
- **Merge gate:** frozen-query regression (~30 queries) shows ≥99% overlap old vs new; any new misses investigated before flip.

### Phase 4 — Cleanup (optional, after 2+ weeks stable)

- Delete `companiesMatch`, `getSchoolMatchIds`, in-code `UNIVERSITY_ALIASES` and `SCHOOL_ALIASES` maps.
- Optionally drop `Person.educationSchool` (display reads `schools[0]`).
- Unrushed; Phase 3 is the value-delivering phase.
- **Rollback:** Revert cleanup PR.

### Bug-safety invariants per phase

| Phase | Failure mode |
|-------|-------------|
| 1 | Nothing. Tables exist; nobody reads. |
| 2 | Writes log errors; raw strings still persist; readers unchanged; no user impact. |
| 3 | Feature flag flip reverts in under a minute. |
| 4 | Revert commit; Phase 3 code still works. |

### Implementation effort

~5 days of work across 4 PRs, spread over however many calendar days the team wants to soak each phase.

---

## Testing

### Unit tests — `tests/entity-resolver-unit.ts`

- DB hit → returns existing ID, no LLM call.
- DB miss → calls LLM, creates row, returns ID.
- LLM failure → creates fallback row with input as canonical, source=`FALLBACK`.
- Concurrent callers of same input → one row, not two (unique constraint).
- Normalization inputs: `"The Wharton School"`, `"WHARTON"`, `"wharton school of business"` → same `schoolId`.
- Seeded hard cases: Booth → UChicago, HBS → Harvard, INSEAD → INSEAD (no parent), Google LLC / Google Inc / Google → same `companyId`.

### Integration tests — extends `tests/discovery-flow/`

- `searchPeopleV2Action` with canonical input ("Wharton grads at Goldman") → non-empty results, all results have `schoolIds` containing the Penn ID.
- Same query with non-canonical alias ("UPenn MBAs at GS") → identical result set.
- Short-mode path: search with `schools: ["Wharton School"]` creates rows whose `schoolIds` contains the Penn ID AND whose `educationSchool` string is canonicalized (not raw). **Regression test proving the short-mode leak is fixed.**

### Regression test — `tests/canonical-entity-regression.ts` (new)

- Extends the existing `tests/prompt-regression-baseline.ts` frozen query set.
- For each query, record old-path and new-path result sets.
- Assert ≥99% overlap; <1% allowance is for cases where canonicalization corrects prior false positives.
- Diff report exposes any delta for human review before Phase 3 flip.

### Backfill dry-run validation

- `scripts/backfill-canonical-entities.ts --dry-run` reports total unique values, top 20 by row count, proposed canonical mappings.
- Flags suspicious merges (two big distinct companies → same canonical).
- Human review before `--live`.

### Production observability (via existing `discovery-logger.ts`)

- Counters: `entity.resolve.hit.db`, `entity.resolve.hit.llm`, `entity.resolve.fallback`. Steady-state cache-hit ratio >95%.
- Log each null-return with input + reason; monitor rate post-Phase-3 flip.
- Dashboard query: `COUNT(*) FROM Person WHERE companyId IS NULL`; trend toward zero after backfill, flat thereafter.

### Per-phase verification-before-completion gates

- **Phase 1:** unit tests green + `prisma db push` succeeds on staging + seed inserts expected row counts.
- **Phase 2:** integration tests green + backfill dry-run reviewed + `>95%` of Person rows have non-null `companyId`.
- **Phase 3:** frozen-query regression ≥99% overlap + 24h soak with flag off + flag-on logs show zero fallback hits on common queries.
- **Phase 4:** 2 weeks post-cutover with zero rollback triggers and zero user-reported missing-results incidents.

---

## Open questions

None. All design decisions confirmed in brainstorm (2026-04-16).

## References

- Current school normalization: `src/lib/services/linkedin-scraper.ts:41` (`SCHOOL_ALIASES`)
- Current university keyword map: `src/lib/db/person-service.ts:15` (`UNIVERSITY_ALIASES`)
- Current company alias resolution: `src/lib/services/company-alias.ts`
- Current query builder: `src/lib/db/person-service.ts:749` (`buildPersonWhereClause`)
- Short-mode write leak: `src/lib/db/person-service.ts:1541` (`saveShortProfile`), `src/lib/db/person-service.ts:1834` (`saveShortProfilesBatch`)
- Full-scrape path: `src/lib/db/person-service.ts:1259` (`saveScrapedProfile`)
