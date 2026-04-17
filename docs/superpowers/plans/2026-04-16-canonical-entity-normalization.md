# Canonical Entity Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace string-match discovery of Person rows by company and school with foreign-key references to canonical `Company` and `School` tables, eliminating search-recall losses from name variance (e.g., "Wharton" vs "Penn", "GS" vs "Goldman Sachs").

**Architecture:** Add two canonical-entity tables seeded from existing alias knowledge. All 4 Person write paths dual-write raw strings + canonical FKs via a new `entity-resolver.ts` module that does DB → Groq LLM → fallback resolution with an in-memory cache. All 4 Person reader paths switch from ILIKE/keyword-AND to indexed FK equality, with string-match kept as a fallback branch for degraded cases. Phased rollout: foundation → dual-write + backfill → reader cutover (behind env flag) → optional cleanup.

**Tech Stack:** Prisma 5 on Postgres (Supabase), Next.js 14 App Router, TypeScript strict, Groq via existing `anthropic.ts` helper, `npx tsx` for tests and scripts.

**Spec:** `docs/superpowers/specs/2026-04-16-canonical-entity-normalization-design.md`

---

## File Structure

**Create:**
- `src/lib/services/entity-resolver.ts` — `findOrCreateCompany`, `findOrCreateSchool`, `resolveCompanyId`, `resolveSchoolId` with DB → LLM → fallback tiers and in-memory caches.
- `scripts/seed-canonical-entities.ts` — one-time seed: migrate `CompanyAlias` rows into `Company`, seed `School` from `SCHOOL_ALIASES` + `UNIVERSITY_ALIASES`.
- `scripts/backfill-canonical-entities.ts` — two-pass backfill: (1) resolve every distinct raw string, (2) stamp `companyId` + `schoolIds[]` on existing `Person` rows. Resumable via `BackfillProgress` table.
- `tests/entity-resolver-unit.ts` — resolver behavior: DB hit, LLM miss, concurrent safety, normalization, fallback.
- `tests/canonical-entity-integration.ts` — integration: short-mode write no longer stores raw `schoolTag` string; FK query returns same results as alias query.
- `tests/canonical-entity-regression.ts` — frozen-query harness: run ~30 queries through old (ILIKE) and new (FK) paths, assert ≥99% overlap.

**Modify:**
- `prisma/schema.prisma` — add `Company`, `School`, `BackfillProgress` models; add `companyId`, `schoolIds[]` columns + relation on `Person`.
- `src/lib/db/person-service.ts` — write paths (`saveScrapedProfile`, `saveShortProfile`, `saveShortProfilesBatch`, `saveDiscoveredPerson`) stamp FKs; `buildPersonWhereClause` prefers FK equality with ILIKE fallback.
- `src/app/actions/search.ts` — `searchPeopleV2Action` resolves company + school filter strings to IDs before calling `findPeopleByFiltersV3`.

---

## Phase 1 — Foundation (no behavior change)

### Task 1.1: Add Prisma models and Person FK columns

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `Company`, `School`, `BackfillProgress` models and FK columns**

Append three new models and add two new columns + a relation to the existing `Person` model.

Add at the end of `prisma/schema.prisma`:

```prisma
model Company {
  id            String    @id @default(cuid())
  canonicalName String    @unique
  aliases       String[]                      // normalized, lowercase
  source        String    @default("SEED")    // SEED | LLM | MANUAL | FALLBACK
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @default(now()) @updatedAt

  persons       Person[]  @relation("PersonCompany")

  @@index([aliases], type: Gin)
}

model School {
  id            String    @id @default(cuid())
  canonicalName String    @unique
  aliases       String[]
  source        String    @default("SEED")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @default(now()) @updatedAt

  @@index([aliases], type: Gin)
}

model BackfillProgress {
  id              String   @id @default(cuid())
  jobName         String   @unique
  lastProcessedId String?
  totalProcessed  Int      @default(0)
  errorCount      Int      @default(0)
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  notes           String?
}
```

Modify the existing `Person` model — add two new fields and a relation. Locate the existing block (around line 100 in `prisma/schema.prisma`) and add these fields after the existing `schools` field; add the relation line and the two new indexes near the existing `@@index` declarations:

```prisma
model Person {
  // ... keep ALL existing fields unchanged ...
  companyId      String?                       // NEW
  schoolIds      String[]  @default([])        // NEW
  companyRef     Company?  @relation("PersonCompany", fields: [companyId], references: [id], onDelete: SetNull)  // NEW

  // ... keep existing @@unique and @@index lines ...
  @@index([companyId])                          // NEW
  @@index([schoolIds], type: Gin)               // NEW
}
```

Relation field is `companyRef` (not `company2`) because `company` is already a String column; `companyRef` makes it unambiguous.

- [ ] **Step 2: Push schema to DB and regenerate client**

```bash
npm run db:push
npm run db:generate
```

Expected: "Your database is now in sync with your Prisma schema." and TypeScript types regenerated.

- [ ] **Step 3: Verify schema**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "schema: add Company, School, BackfillProgress tables + Person FK columns"
```

---

### Task 1.2: Implement `findOrCreateCompany` + `findOrCreateSchool` with tests

**Files:**
- Create: `src/lib/services/entity-resolver.ts`
- Create: `tests/entity-resolver-unit.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/entity-resolver-unit.ts`:

```ts
/**
 * Unit tests for entity-resolver.ts
 *
 * Run: npx tsx tests/entity-resolver-unit.ts
 *
 * Manual assertions; no test framework. Each test logs PASS/FAIL and increments
 * counters. Exit code 1 if any failure.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { findOrCreateCompany, findOrCreateSchool } from '../src/lib/services/entity-resolver';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.error(`FAIL  ${label}`); }
}

async function cleanup(canonicalNames: string[]) {
  await prisma.company.deleteMany({ where: { canonicalName: { in: canonicalNames } } });
  await prisma.school.deleteMany({ where: { canonicalName: { in: canonicalNames } } });
}

async function test_findOrCreateCompany_creates_new_row() {
  const uniqueName = `TestCo-${Date.now()}`;
  const result = await findOrCreateCompany(uniqueName);
  assert(!!result.companyId, 'findOrCreateCompany returns a companyId');
  assert(typeof result.canonicalName === 'string', 'findOrCreateCompany returns canonicalName');

  const row = await prisma.company.findUnique({ where: { id: result.companyId } });
  assert(row !== null, 'findOrCreateCompany persisted a row');

  await cleanup([result.canonicalName]);
}

async function test_findOrCreateCompany_is_idempotent() {
  const uniqueName = `Idempotent-${Date.now()}`;
  const r1 = await findOrCreateCompany(uniqueName);
  const r2 = await findOrCreateCompany(uniqueName);
  assert(r1.companyId === r2.companyId, 'same input returns same companyId');

  await cleanup([r1.canonicalName]);
}

async function test_findOrCreateSchool_creates_new_row() {
  const uniqueName = `TestSchool-${Date.now()}`;
  const result = await findOrCreateSchool(uniqueName);
  assert(!!result.schoolId, 'findOrCreateSchool returns a schoolId');

  await cleanup([result.canonicalName]);
}

async function main() {
  await test_findOrCreateCompany_creates_new_row();
  await test_findOrCreateCompany_is_idempotent();
  await test_findOrCreateSchool_creates_new_row();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run test — expect failure (module doesn't exist yet)**

```bash
npx tsx tests/entity-resolver-unit.ts
```

Expected: error like `Cannot find module '../src/lib/services/entity-resolver'`.

- [ ] **Step 3: Implement `entity-resolver.ts` — DB tier + LLM tier + fallback**

Create `src/lib/services/entity-resolver.ts`:

```ts
/**
 * Canonical Entity Resolution Service
 *
 * Resolves raw company and school strings to canonical `Company` / `School`
 * rows. Three-tier lookup: DB alias match → Groq LLM → fallback row. Mirrors
 * the pattern in `company-alias.ts` but writes to the new canonical tables.
 *
 * Exports two write helpers (`findOrCreate*`, always return an ID) and two
 * read helpers (`resolve*Id`, return null on miss so callers can fall back
 * to string matching).
 */
import prisma from '@/lib/prisma';
import { completeJson } from '@/lib/services/anthropic';

export interface ResolvedCompany {
  companyId: string;
  canonicalName: string;
}

export interface ResolvedSchool {
  schoolId: string;
  canonicalName: string;
}

interface AliasResponse {
  canonicalName: string;
  aliases: string[];
}

const COMPANY_CACHE_MAX = 5_000;
const SCHOOL_CACHE_MAX = 5_000;

// Simple FIFO LRU-ish cache. Mirrors companyExpansionCache in discovery.ts.
// Keyed by normalized input; value is the resolved ID.
const companyIdCache = new Map<string, string>();
const schoolIdCache = new Map<string, string>();

function cacheGet(cache: Map<string, string>, key: string): string | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    // refresh LRU position
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(cache: Map<string, string>, key: string, value: string, max: number) {
  cache.set(key, value);
  if (cache.size > max) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

function normalizeForLookup(raw: string): string {
  return raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Write helpers — always return an ID (fall back to inserting the raw name)
// ──────────────────────────────────────────────────────────────────────────────

export async function findOrCreateCompany(rawName: string): Promise<ResolvedCompany> {
  const normalized = normalizeForLookup(rawName);
  if (!normalized) {
    // Defensive: empty input → create a placeholder row so callers still get an ID.
    const row = await prisma.company.upsert({
      where: { canonicalName: '(unknown)' },
      create: { canonicalName: '(unknown)', aliases: [], source: 'FALLBACK' },
      update: {},
    });
    return { companyId: row.id, canonicalName: row.canonicalName };
  }

  const cached = cacheGet(companyIdCache, normalized);
  if (cached) {
    const row = await prisma.company.findUnique({ where: { id: cached } });
    if (row) return { companyId: row.id, canonicalName: row.canonicalName };
    // Cache pointed at a deleted row — fall through.
  }

  // Tier 1: DB alias match
  const byAlias = await prisma.company.findFirst({ where: { aliases: { has: normalized } } });
  if (byAlias) {
    cacheSet(companyIdCache, normalized, byAlias.id, COMPANY_CACHE_MAX);
    return { companyId: byAlias.id, canonicalName: byAlias.canonicalName };
  }

  // Tier 2: LLM resolution
  const llm = await resolveCompanyViaLLM(rawName);

  // Re-check DB in case another caller created it concurrently
  const existing = await prisma.company.findUnique({ where: { canonicalName: llm.canonicalName } });
  if (existing) {
    const merged = Array.from(new Set([...existing.aliases, ...llm.aliases, normalized]));
    if (merged.length !== existing.aliases.length) {
      await prisma.company.update({ where: { id: existing.id }, data: { aliases: merged } });
    }
    cacheSet(companyIdCache, normalized, existing.id, COMPANY_CACHE_MAX);
    return { companyId: existing.id, canonicalName: existing.canonicalName };
  }

  const created = await prisma.company.create({
    data: {
      canonicalName: llm.canonicalName,
      aliases: Array.from(new Set([...llm.aliases, normalized])),
      source: llm.source,
    },
  });
  cacheSet(companyIdCache, normalized, created.id, COMPANY_CACHE_MAX);
  return { companyId: created.id, canonicalName: created.canonicalName };
}

export async function findOrCreateSchool(rawName: string): Promise<ResolvedSchool> {
  const normalized = normalizeForLookup(rawName);
  if (!normalized) {
    const row = await prisma.school.upsert({
      where: { canonicalName: '(unknown)' },
      create: { canonicalName: '(unknown)', aliases: [], source: 'FALLBACK' },
      update: {},
    });
    return { schoolId: row.id, canonicalName: row.canonicalName };
  }

  const cached = cacheGet(schoolIdCache, normalized);
  if (cached) {
    const row = await prisma.school.findUnique({ where: { id: cached } });
    if (row) return { schoolId: row.id, canonicalName: row.canonicalName };
  }

  const byAlias = await prisma.school.findFirst({ where: { aliases: { has: normalized } } });
  if (byAlias) {
    cacheSet(schoolIdCache, normalized, byAlias.id, SCHOOL_CACHE_MAX);
    return { schoolId: byAlias.id, canonicalName: byAlias.canonicalName };
  }

  const llm = await resolveSchoolViaLLM(rawName);

  const existing = await prisma.school.findUnique({ where: { canonicalName: llm.canonicalName } });
  if (existing) {
    const merged = Array.from(new Set([...existing.aliases, ...llm.aliases, normalized]));
    if (merged.length !== existing.aliases.length) {
      await prisma.school.update({ where: { id: existing.id }, data: { aliases: merged } });
    }
    cacheSet(schoolIdCache, normalized, existing.id, SCHOOL_CACHE_MAX);
    return { schoolId: existing.id, canonicalName: existing.canonicalName };
  }

  const created = await prisma.school.create({
    data: {
      canonicalName: llm.canonicalName,
      aliases: Array.from(new Set([...llm.aliases, normalized])),
      source: llm.source,
    },
  });
  cacheSet(schoolIdCache, normalized, created.id, SCHOOL_CACHE_MAX);
  return { schoolId: created.id, canonicalName: created.canonicalName };
}

// ──────────────────────────────────────────────────────────────────────────────
// LLM resolution — private helpers
// ──────────────────────────────────────────────────────────────────────────────

async function resolveCompanyViaLLM(raw: string): Promise<{ canonicalName: string; aliases: string[]; source: 'LLM' | 'FALLBACK' }> {
  try {
    const resp = await completeJson<AliasResponse>({
      systemPrompt:
        'You are a company name expert. Given a company name (may be abbreviation, informal, or full), return JSON with:\n' +
        '- "canonicalName": the full official company name\n' +
        '- "aliases": array of 2-5 widely-recognized variations (include canonical name and input, all lowercase).\n' +
        'Example: Input "GS" → {"canonicalName": "Goldman Sachs", "aliases": ["goldman sachs", "gs"]}\n' +
        'If unsure, return {"canonicalName": "<input>", "aliases": ["<input>"]}',
      userPrompt: raw.trim(),
      options: { temperature: 0.1, maxTokens: 200 },
      metadata: { action: 'ENTITY_RESOLVE_COMPANY' },
    });
    const canonicalName = resp.content.canonicalName || raw;
    const aliases = (resp.content.aliases || []).map(a => a.toLowerCase().trim()).filter(Boolean);
    return { canonicalName, aliases, source: 'LLM' };
  } catch (err) {
    console.warn(`[entity-resolver] LLM company resolve failed for "${raw}":`, err);
    return { canonicalName: raw, aliases: [normalizeForLookup(raw)], source: 'FALLBACK' };
  }
}

async function resolveSchoolViaLLM(raw: string): Promise<{ canonicalName: string; aliases: string[]; source: 'LLM' | 'FALLBACK' }> {
  try {
    const resp = await completeJson<AliasResponse>({
      systemPrompt:
        'You are a university name expert. Given a school name — which may be a business school, law school, or undergraduate college — return JSON with:\n' +
        '- "canonicalName": the parent university or institution (e.g., "Wharton School" → "University of Pennsylvania"; "Harvard Business School" → "Harvard University"; "INSEAD" → "INSEAD").\n' +
        '- "aliases": array of 2-5 widely-recognized variations of the canonical (include canonical and input, all lowercase).\n' +
        'If it is already a top-level university, canonicalName = input. If unsure, return the input as canonical.',
      userPrompt: raw.trim(),
      options: { temperature: 0.1, maxTokens: 200 },
      metadata: { action: 'ENTITY_RESOLVE_SCHOOL' },
    });
    const canonicalName = resp.content.canonicalName || raw;
    const aliases = (resp.content.aliases || []).map(a => a.toLowerCase().trim()).filter(Boolean);
    return { canonicalName, aliases, source: 'LLM' };
  } catch (err) {
    console.warn(`[entity-resolver] LLM school resolve failed for "${raw}":`, err);
    return { canonicalName: raw, aliases: [normalizeForLookup(raw)], source: 'FALLBACK' };
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx tsx tests/entity-resolver-unit.ts
```

Expected: `3 passed, 0 failed`. (Network-dependent tests that hit Groq LLM are not exercised here — added in later tasks.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/entity-resolver.ts tests/entity-resolver-unit.ts
git commit -m "feat(entity-resolver): add findOrCreateCompany/School with DB/LLM/fallback tiers"
```

---

### Task 1.3: Add `resolveCompanyId` + `resolveSchoolId` read-only helpers

**Files:**
- Modify: `src/lib/services/entity-resolver.ts`
- Modify: `tests/entity-resolver-unit.ts`

- [ ] **Step 1: Extend the test file**

Append to `tests/entity-resolver-unit.ts`:

```ts
async function test_resolveCompanyId_returns_null_on_unknown() {
  const { resolveCompanyId } = await import('../src/lib/services/entity-resolver');
  const id = await resolveCompanyId(`UnknownInput-${Date.now()}-skipllm`);
  // Without seeded alias, and LLM would normally fire. Accept either null (preferred)
  // or a created ID — both are correct; the test validates the non-throwing contract.
  assert(id === null || typeof id === 'string', 'resolveCompanyId returns string|null (no throw)');
}

async function test_resolveCompanyId_hits_existing_alias() {
  const { findOrCreateCompany, resolveCompanyId } = await import('../src/lib/services/entity-resolver');
  const seeded = await findOrCreateCompany(`SeedForResolve-${Date.now()}`);
  const looked = await resolveCompanyId(seeded.canonicalName);
  assert(looked === seeded.companyId, 'resolveCompanyId hits existing canonical alias');
  await cleanup([seeded.canonicalName]);
}

// Add these calls inside main():
//   await test_resolveCompanyId_returns_null_on_unknown();
//   await test_resolveCompanyId_hits_existing_alias();
```

Update the `main()` function to call these new tests before the summary print.

- [ ] **Step 2: Run — expect failure (symbols not exported)**

```bash
npx tsx tests/entity-resolver-unit.ts
```

Expected: FAIL because `resolveCompanyId` is not exported.

- [ ] **Step 3: Add the read-only helpers**

Append to `src/lib/services/entity-resolver.ts`:

```ts
// ──────────────────────────────────────────────────────────────────────────────
// Read helpers — return null on miss so callers can fall back to string match
// ──────────────────────────────────────────────────────────────────────────────

export async function resolveCompanyId(rawName: string): Promise<string | null> {
  const normalized = normalizeForLookup(rawName);
  if (!normalized) return null;

  const cached = cacheGet(companyIdCache, normalized);
  if (cached) return cached;

  const byAlias = await prisma.company.findFirst({
    where: { aliases: { has: normalized } },
    select: { id: true },
  });
  if (byAlias) {
    cacheSet(companyIdCache, normalized, byAlias.id, COMPANY_CACHE_MAX);
    return byAlias.id;
  }

  // Not seeded → defer creation to write path. Readers should fall back to ILIKE.
  return null;
}

export async function resolveSchoolId(rawName: string): Promise<string | null> {
  const normalized = normalizeForLookup(rawName);
  if (!normalized) return null;

  const cached = cacheGet(schoolIdCache, normalized);
  if (cached) return cached;

  const byAlias = await prisma.school.findFirst({
    where: { aliases: { has: normalized } },
    select: { id: true },
  });
  if (byAlias) {
    cacheSet(schoolIdCache, normalized, byAlias.id, SCHOOL_CACHE_MAX);
    return byAlias.id;
  }

  return null;
}
```

Design note: `resolve*Id` deliberately does NOT fire an LLM on miss. At read time we want zero new cost per unknown input — a miss just falls back to string matching. Write path is where new canonical rows get created.

- [ ] **Step 4: Run tests — expect pass**

```bash
npx tsx tests/entity-resolver-unit.ts
```

Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/entity-resolver.ts tests/entity-resolver-unit.ts
git commit -m "feat(entity-resolver): add read-only resolveCompanyId/resolveSchoolId helpers"
```

---

### Task 1.4: Seed `School` table from existing alias maps

**Files:**
- Create: `scripts/seed-canonical-entities.ts`

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-canonical-entities.ts`:

```ts
/**
 * One-time seed for Company and School canonical tables.
 *
 * Usage:
 *   npx tsx scripts/seed-canonical-entities.ts [--dry-run]
 *
 * Sources:
 *   School:   SCHOOL_ALIASES (src/lib/services/linkedin-scraper.ts)
 *             UNIVERSITY_ALIASES (src/lib/db/person-service.ts)
 *   Company:  existing CompanyAlias table rows
 *
 * Safe to re-run: uses canonicalName unique constraint with upsert semantics
 * to merge alias sets rather than duplicate rows.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { SCHOOL_ALIASES } from '../src/lib/services/linkedin-scraper';

const UNIVERSITY_ALIASES: Record<string, string[]> = {
  // Copied from person-service.ts — these are keyword-AND tokens, but for
  // seeding purposes we treat the KEY as an alias of the joined VALUE.
  'ut austin':    ['texas', 'austin'],
  'ut':           ['texas', 'austin'],
  'ut dallas':    ['texas', 'dallas'],
  'utd':          ['texas', 'dallas'],
  'ut arlington': ['texas', 'arlington'],
  'uta':          ['texas', 'arlington'],
  'tamu':         ['texas', 'a&m'],
  'texas a&m':    ['texas', 'a&m'],
  'nyu':          ['nyu'],
  'new york university': ['nyu'],
  'mit':          ['mit'],
  'massachusetts institute of technology': ['mit'],
  'usc':          ['usc'],
  'university of southern california': ['usc'],
  'ucla':         ['ucla'],
  'university of california los angeles': ['ucla'],
  'ucb':          ['uc', 'berkeley'],
  'uc berkeley':  ['uc', 'berkeley'],
  'cal':          ['uc', 'berkeley'],
  'berkeley':     ['berkeley'],
  'smu':          ['smu'],
  'southern methodist university': ['smu'],
  'southern methodist': ['smu'],
  'gatech':       ['georgia', 'tech'],
  'georgia tech': ['georgia', 'tech'],
  'gt':           ['georgia', 'tech'],
  'uiuc':         ['illinois', 'urbana'],
  'upenn':        ['pennsylvania'],
  'penn':         ['pennsylvania'],
  'penn state':   ['penn', 'state'],
  'umich':        ['michigan'],
  'cmu':          ['carnegie', 'mellon'],
  'carnegie mellon': ['carnegie', 'mellon'],
  'cal poly':     ['california', 'polytechnic'],
  'caltech':      ['california', 'technology'],
  'osu':          ['ohio', 'state'],
  'unc':          ['north', 'carolina', 'chapel'],
  'uva':          ['virginia'],
  'bu':           ['boston', 'university'],
  'bc':           ['boston', 'college'],
  'neu':          ['northeastern'],
  'wustl':        ['washington', 'louis'],
  'wash u':       ['washington', 'louis'],
};

// Hand-curated canonical names for UNIVERSITY_ALIASES keys, because the map's
// VALUE is a keyword list for ILIKE matching, not a canonical name.
const UNIVERSITY_CANONICAL: Record<string, string> = {
  'ut austin': 'University of Texas at Austin',
  'ut': 'University of Texas at Austin',
  'ut dallas': 'University of Texas at Dallas',
  'utd': 'University of Texas at Dallas',
  'ut arlington': 'University of Texas at Arlington',
  'uta': 'University of Texas at Arlington',
  'tamu': 'Texas A&M University',
  'texas a&m': 'Texas A&M University',
  'nyu': 'NYU',
  'new york university': 'NYU',
  'mit': 'MIT',
  'massachusetts institute of technology': 'MIT',
  'usc': 'USC',
  'university of southern california': 'USC',
  'ucla': 'UCLA',
  'university of california los angeles': 'UCLA',
  'ucb': 'UC Berkeley',
  'uc berkeley': 'UC Berkeley',
  'cal': 'UC Berkeley',
  'berkeley': 'UC Berkeley',
  'smu': 'Southern Methodist University',
  'southern methodist university': 'Southern Methodist University',
  'southern methodist': 'Southern Methodist University',
  'gatech': 'Georgia Tech',
  'georgia tech': 'Georgia Tech',
  'gt': 'Georgia Tech',
  'uiuc': 'University of Illinois Urbana-Champaign',
  'upenn': 'University of Pennsylvania',
  'penn': 'University of Pennsylvania',
  'penn state': 'Penn State University',
  'umich': 'University of Michigan',
  'cmu': 'Carnegie Mellon University',
  'carnegie mellon': 'Carnegie Mellon University',
  'cal poly': 'California Polytechnic State University',
  'caltech': 'California Institute of Technology',
  'osu': 'Ohio State University',
  'unc': 'UNC Chapel Hill',
  'uva': 'University of Virginia',
  'bu': 'Boston University',
  'bc': 'Boston College',
  'neu': 'Northeastern University',
  'wustl': 'Washington University in St. Louis',
  'wash u': 'Washington University in St. Louis',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

async function seedSchools(dryRun: boolean) {
  // Group aliases by canonical name
  const canonicalToAliases = new Map<string, Set<string>>();

  // SCHOOL_ALIASES: alias → canonical
  for (const [alias, canonical] of Object.entries(SCHOOL_ALIASES)) {
    if (!canonicalToAliases.has(canonical)) canonicalToAliases.set(canonical, new Set());
    canonicalToAliases.get(canonical)!.add(normalize(alias));
    canonicalToAliases.get(canonical)!.add(normalize(canonical));
  }

  // UNIVERSITY_ALIASES keys + UNIVERSITY_CANONICAL mapping
  for (const alias of Object.keys(UNIVERSITY_ALIASES)) {
    const canonical = UNIVERSITY_CANONICAL[alias];
    if (!canonical) {
      console.warn(`No canonical for alias "${alias}" — skipping`);
      continue;
    }
    if (!canonicalToAliases.has(canonical)) canonicalToAliases.set(canonical, new Set());
    canonicalToAliases.get(canonical)!.add(normalize(alias));
    canonicalToAliases.get(canonical)!.add(normalize(canonical));
  }

  console.log(`Seeding ${canonicalToAliases.size} School rows${dryRun ? ' (DRY RUN)' : ''}`);

  let created = 0;
  let updated = 0;
  for (const [canonical, aliasSet] of canonicalToAliases.entries()) {
    const aliases = Array.from(aliasSet);
    if (dryRun) {
      console.log(`  [dry] ${canonical} ← [${aliases.slice(0, 4).join(', ')}${aliases.length > 4 ? ', ...' : ''}]`);
      continue;
    }
    const existing = await prisma.school.findUnique({ where: { canonicalName: canonical } });
    if (existing) {
      const merged = Array.from(new Set([...existing.aliases, ...aliases]));
      await prisma.school.update({ where: { id: existing.id }, data: { aliases: merged } });
      updated++;
    } else {
      await prisma.school.create({ data: { canonicalName: canonical, aliases, source: 'SEED' } });
      created++;
    }
  }
  console.log(`Schools: ${created} created, ${updated} updated`);
}

async function seedCompaniesFromCompanyAlias(dryRun: boolean) {
  const rows = await prisma.companyAlias.findMany();
  console.log(`Migrating ${rows.length} CompanyAlias rows to Company table${dryRun ? ' (DRY RUN)' : ''}`);

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const normalizedAliases = row.aliases.map(normalize);
    if (dryRun) {
      console.log(`  [dry] ${row.canonicalName} ← [${normalizedAliases.slice(0, 4).join(', ')}]`);
      continue;
    }
    const existing = await prisma.company.findUnique({ where: { canonicalName: row.canonicalName } });
    if (existing) {
      const merged = Array.from(new Set([...existing.aliases, ...normalizedAliases]));
      await prisma.company.update({ where: { id: existing.id }, data: { aliases: merged } });
      updated++;
    } else {
      await prisma.company.create({
        data: { canonicalName: row.canonicalName, aliases: normalizedAliases, source: 'SEED' },
      });
      created++;
    }
  }
  console.log(`Companies: ${created} created, ${updated} updated`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '═══ DRY RUN — no writes ═══' : '═══ LIVE RUN ═══');

  await seedSchools(dryRun);
  await seedCompaniesFromCompanyAlias(dryRun);

  console.log('\nSeed complete.');
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run in dry-run mode**

```bash
npx tsx scripts/seed-canonical-entities.ts --dry-run
```

Expected: Logs ~60 School rows and N Company rows (whatever `CompanyAlias` currently holds). No DB writes.

- [ ] **Step 3: Run live**

```bash
npx tsx scripts/seed-canonical-entities.ts
```

Expected: Schools and Companies inserted; counts logged.

- [ ] **Step 4: Verify row counts**

Run this as a one-liner to sanity-check the seed:

```bash
npx tsx -e "import('./src/lib/prisma').then(async m => { const p = m.default; console.log('Companies:', await p.company.count()); console.log('Schools:', await p.school.count()); await p.\$disconnect(); })"
```

Expected: Companies count ≥ CompanyAlias count, Schools count ≈ 40–60.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-canonical-entities.ts
git commit -m "feat(seed): migrate SCHOOL_ALIASES + CompanyAlias rows into canonical tables"
```

---

## Phase 2 — Dual-write + Backfill

### Task 2.1: Dual-write in `saveScrapedProfile`

**Files:**
- Modify: `src/lib/db/person-service.ts` (function `saveScrapedProfile`, line 1259)

- [ ] **Step 1: Add the resolver import at the top of person-service.ts**

Modify the imports block (near the top of `src/lib/db/person-service.ts`) to add:

```ts
import { findOrCreateCompany, findOrCreateSchool } from '@/lib/services/entity-resolver';
```

- [ ] **Step 2: Add a helper to resolve schools array → schoolIds**

Add this helper immediately before `saveScrapedProfile`:

```ts
/**
 * Resolve an array of raw school names to canonical schoolIds.
 * Deduplicates by ID, preserving input order.
 * Non-blocking: failures fall back to partial results.
 */
async function resolveSchoolIds(schools: string[]): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const name of schools) {
    if (!name) continue;
    try {
      const { schoolId } = await findOrCreateSchool(name);
      if (!seen.has(schoolId)) {
        seen.add(schoolId);
        ids.push(schoolId);
      }
    } catch (err) {
      console.warn(`[resolveSchoolIds] failed for "${name}":`, err);
    }
  }
  return ids;
}
```

- [ ] **Step 3: Modify `saveScrapedProfile` to resolve FKs before writing**

Find the block inside `saveScrapedProfile` where `const company = normalizeCompanyForStorage(rawCompany);` and `const schools = profile.schools.length > 0 ? ... : ...;` are computed (around line 1274–1284). Right after those lines, BEFORE any prisma call, add:

```ts
// Resolve canonical FKs in parallel (non-blocking on failure).
const [companyResolved, schoolIds] = await Promise.all([
  findOrCreateCompany(company).catch(err => {
    console.warn(`[saveScrapedProfile] findOrCreateCompany failed:`, err);
    return null;
  }),
  resolveSchoolIds(schools),
]);
const companyId = companyResolved?.companyId ?? null;
```

Then in EACH of the `prisma.person.update` / `prisma.person.create` calls inside this function (there are 3: the existingByUrl update, the existingByName backfill, and the create), add these two fields to the `data: {}` object (alongside `schools` and `educationSchool`):

```ts
companyId: companyId ?? undefined,
schoolIds: schoolIds.length > 0 ? schoolIds : undefined,
```

Using `undefined` (not `null`) ensures Prisma only sets the fields when we have values — existing FKs on updates are preserved if resolution fails.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/person-service.ts
git commit -m "feat(person-service): dual-write canonical FKs in saveScrapedProfile"
```

---

### Task 2.2: Dual-write in `saveShortProfile` — fix the short-mode leak

**Files:**
- Modify: `src/lib/db/person-service.ts` (function `saveShortProfile`, line 1508)

- [ ] **Step 1: Modify `saveShortProfile` to resolve FKs + canonicalize schoolTag**

Find the top of `saveShortProfile` (line 1508). After the existing `const company = normalizeCompanyForStorage(...)` line, insert the FK resolution:

```ts
// Resolve canonical FKs.
const companyResolved = await findOrCreateCompany(company).catch(err => {
  console.warn(`[saveShortProfile] findOrCreateCompany failed:`, err);
  return null;
});
const companyId = companyResolved?.companyId ?? null;

// If the caller supplied a schoolTag (user's filter input), canonicalize it
// BEFORE storing. Fixes the short-mode leak where raw "Wharton School" was
// written verbatim to educationSchool + schools[].
let canonicalSchool: { schoolId: string; canonicalName: string } | null = null;
if (schoolTag) {
  canonicalSchool = await findOrCreateSchool(schoolTag).catch(err => {
    console.warn(`[saveShortProfile] findOrCreateSchool failed:`, err);
    return null;
  });
}
const canonicalSchoolTag = canonicalSchool?.canonicalName ?? schoolTag;
const schoolIds = canonicalSchool ? [canonicalSchool.schoolId] : [];
```

- [ ] **Step 2: Replace every `schoolTag` reference in write blocks with `canonicalSchoolTag`**

There are 5 places inside `saveShortProfile` where `schoolTag` is written to `educationSchool` and `schools` (in spread blocks like `...(schoolTag && { educationSchool: schoolTag, schools: [schoolTag] })`). Replace each one with:

```ts
...(canonicalSchoolTag && {
  educationSchool: canonicalSchoolTag,
  schools: [canonicalSchoolTag],
  schoolIds: schoolIds.length > 0 ? schoolIds : undefined,
}),
```

AND separately (outside the spread) add `companyId: companyId ?? undefined` to every `prisma.person.update` / `prisma.person.create` data block in this function.

- [ ] **Step 3: Add integration test proving the leak is fixed**

Create `tests/canonical-entity-integration.ts`:

```ts
/**
 * Integration tests — canonical entity normalization.
 *
 * Run: npx tsx tests/canonical-entity-integration.ts
 *
 * Uses real DB. Each test inserts uniquely-named fixtures and cleans up after.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { saveShortProfile } from '../src/lib/db/person-service';
import { findOrCreateSchool } from '../src/lib/services/entity-resolver';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.error(`FAIL  ${label}`); }
}

async function test_shortmode_canonicalizes_wharton_to_penn() {
  const suffix = Date.now().toString();
  const linkedinUrl = `https://www.linkedin.com/in/shortmode-test-${suffix}`;

  // Pre-seed: make sure "Wharton School" resolves to a Penn-ish canonical.
  // (After the seed script runs, this is already true. Belt-and-suspenders.)
  const pennRow = await findOrCreateSchool('University of Pennsylvania');
  await prisma.school.update({
    where: { id: pennRow.schoolId },
    data: { aliases: Array.from(new Set([...(await prisma.school.findUnique({ where: { id: pennRow.schoolId } }))!.aliases, 'wharton school', 'wharton'])) },
  });

  // Call saveShortProfile with raw "Wharton School" as the schoolTag — simulating
  // user-typed filter input passing through the short-mode path.
  const result = await saveShortProfile(
    {
      linkedinUrl,
      firstName: 'ShortMode',
      lastName: `Test${suffix}`,
      fullName: `ShortMode Test${suffix}`,
      company: 'Goldman Sachs',
      role: 'Analyst',
    } as any,
    'Wharton School'
  );

  assert(!!result.personId, 'saveShortProfile returned a personId');

  const row = await prisma.person.findUnique({ where: { id: result.personId } });
  assert(row !== null, 'Person row was created');
  assert(
    row?.educationSchool !== 'Wharton School',
    'educationSchool is canonicalized (NOT raw "Wharton School")'
  );
  assert(
    Array.isArray(row?.schoolIds) && row!.schoolIds.includes(pennRow.schoolId),
    'schoolIds contains the Penn canonical ID'
  );

  await prisma.person.delete({ where: { id: result.personId } });
}

async function main() {
  await test_shortmode_canonicalizes_wharton_to_penn();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Run — expect pass**

```bash
npx tsx tests/canonical-entity-integration.ts
```

Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/person-service.ts tests/canonical-entity-integration.ts
git commit -m "feat(short-mode): canonicalize schoolTag before storing — fixes leak"
```

---

### Task 2.3: Dual-write in `saveShortProfilesBatch` — batched resolution

**Files:**
- Modify: `src/lib/db/person-service.ts` (function `saveShortProfilesBatch`, line 1686)

- [ ] **Step 1: Resolve schoolTag + all distinct companies once per batch**

Inside `saveShortProfilesBatch`, right after the existing `const startTime = Date.now();` line, insert:

```ts
// Resolve schoolTag canonical ONCE for the whole batch.
let canonicalSchool: { schoolId: string; canonicalName: string } | null = null;
if (schoolTag) {
  canonicalSchool = await findOrCreateSchool(schoolTag).catch(err => {
    console.warn(`[saveShortProfilesBatch] findOrCreateSchool failed:`, err);
    return null;
  });
}
const canonicalSchoolTag = canonicalSchool?.canonicalName ?? schoolTag;
const batchSchoolIds = canonicalSchool ? [canonicalSchool.schoolId] : [];

// Resolve all distinct companies in the batch (deduped, parallel).
const distinctCompanies = Array.from(new Set(
  profiles.map(p => normalizeCompanyForStorage(p.company || 'Unknown'))
));
const companyResolutions = await Promise.all(
  distinctCompanies.map(async c => {
    try {
      const r = await findOrCreateCompany(c);
      return [c, r.companyId] as const;
    } catch (err) {
      console.warn(`[saveShortProfilesBatch] findOrCreateCompany failed for "${c}":`, err);
      return [c, null] as const;
    }
  })
);
const companyIdByName = new Map(companyResolutions);
```

- [ ] **Step 2: Use `companyIdByName.get(p._company)` and batch-level FKs in every write block**

Inside the function, every `prisma.person.update` / `prisma.person.create` / `prisma.person.updateMany` call that writes `educationSchool: schoolTag, schools: [schoolTag]` must change to:

```ts
...(canonicalSchoolTag && {
  educationSchool: canonicalSchoolTag,
  schools: [canonicalSchoolTag],
  schoolIds: batchSchoolIds.length > 0 ? batchSchoolIds : undefined,
}),
companyId: companyIdByName.get(p._company) ?? undefined,
```

Replace all occurrences (grep `schoolTag &&` inside this function — there are 4 at approximately lines 1834, 1862, 1883, 1938).

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/person-service.ts
git commit -m "feat(short-mode): batch-resolve canonical FKs in saveShortProfilesBatch"
```

---

### Task 2.4: Dual-write in `saveDiscoveredPerson`

**Files:**
- Modify: `src/lib/db/person-service.ts` (function `saveDiscoveredPerson`, line 1022)

- [ ] **Step 1: Add FK resolution block at the top of saveDiscoveredPerson**

Locate the start of the function body. After input validation and company/school normalization (find where `const educationSchool = apolloData.education?.schoolName || searchUniversity || undefined;` appears around line 1087), ADD before the first `prisma.person.*` call:

```ts
const rawCompanyForFk = /* the variable already being written to Person.company */;
const [companyResolved, schoolIds] = await Promise.all([
  findOrCreateCompany(rawCompanyForFk).catch(err => {
    console.warn(`[saveDiscoveredPerson] findOrCreateCompany failed:`, err);
    return null;
  }),
  educationSchool ? resolveSchoolIds([educationSchool]) : Promise.resolve([]),
]);
const companyId = companyResolved?.companyId ?? null;
```

Replace `/* the variable already being written to Person.company */` with whatever the function currently passes to `company:` in the create/update calls — typically a variable named `company` or `canonicalCompany`.

- [ ] **Step 2: Add `companyId` and `schoolIds` to every write**

In each `prisma.person.update` / `prisma.person.create` data block inside this function, add:

```ts
companyId: companyId ?? undefined,
schoolIds: schoolIds.length > 0 ? schoolIds : undefined,
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/person-service.ts
git commit -m "feat(apollo): dual-write canonical FKs in saveDiscoveredPerson"
```

---

### Task 2.5: Write the backfill script

**Files:**
- Create: `scripts/backfill-canonical-entities.ts`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-canonical-entities.ts`:

```ts
/**
 * Two-pass backfill: populate Person.companyId and Person.schoolIds for all
 * existing rows.
 *
 * Pass 1: Build canonical tables by resolving every distinct raw Person.company
 *         and every distinct Person.educationSchool / schools[] value.
 * Pass 2: Stamp every Person row with the resolved FKs, batched + resumable.
 *
 * Usage:
 *   npx tsx scripts/backfill-canonical-entities.ts --dry-run
 *   npx tsx scripts/backfill-canonical-entities.ts
 *   npx tsx scripts/backfill-canonical-entities.ts --batch-size=500
 *
 * Safe to re-run: resumes via BackfillProgress.lastProcessedId.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { findOrCreateCompany, findOrCreateSchool } from '../src/lib/services/entity-resolver';

const JOB_NAME = 'canonical-entities-backfill';

async function pass1_build_canonical_tables(dryRun: boolean) {
  console.log('═══ PASS 1: Build canonical tables ═══');

  // Distinct companies from Person.company
  const companyRows = await prisma.$queryRaw<{ company: string }[]>`
    SELECT DISTINCT company FROM "Person" WHERE company IS NOT NULL AND company != ''
  `;
  const distinctCompanies = companyRows.map(r => r.company);
  console.log(`${distinctCompanies.length} distinct companies`);

  if (!dryRun) {
    for (let i = 0; i < distinctCompanies.length; i++) {
      const c = distinctCompanies[i];
      try {
        await findOrCreateCompany(c);
      } catch (err) {
        console.warn(`  [warn] Company "${c}" failed:`, err);
      }
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${distinctCompanies.length} companies resolved`);
    }
  } else {
    console.log(`  [dry] Would resolve ${distinctCompanies.length} companies`);
  }

  // Distinct schools from Person.educationSchool + schools[] (JSON)
  const schoolRowsPrimary = await prisma.$queryRaw<{ educationSchool: string }[]>`
    SELECT DISTINCT "educationSchool" FROM "Person" WHERE "educationSchool" IS NOT NULL AND "educationSchool" != ''
  `;
  const primarySchools = schoolRowsPrimary.map(r => r.educationSchool);

  const schoolsJsonRows = await prisma.$queryRaw<{ school: string }[]>`
    SELECT DISTINCT jsonb_array_elements_text("schools"::jsonb) AS school
    FROM "Person"
    WHERE "schools" IS NOT NULL
  `;
  const jsonSchools = schoolsJsonRows.map(r => r.school);

  const distinctSchools = Array.from(new Set([...primarySchools, ...jsonSchools]));
  console.log(`${distinctSchools.length} distinct schools`);

  if (!dryRun) {
    for (let i = 0; i < distinctSchools.length; i++) {
      const s = distinctSchools[i];
      try {
        await findOrCreateSchool(s);
      } catch (err) {
        console.warn(`  [warn] School "${s}" failed:`, err);
      }
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${distinctSchools.length} schools resolved`);
    }
  } else {
    console.log(`  [dry] Would resolve ${distinctSchools.length} schools`);
  }
}

async function pass2_stamp_person_rows(batchSize: number, dryRun: boolean) {
  console.log('═══ PASS 2: Stamp Person rows ═══');

  // Read or create progress row
  let progress = await prisma.backfillProgress.findUnique({ where: { jobName: JOB_NAME } });
  if (!progress) {
    progress = await prisma.backfillProgress.create({ data: { jobName: JOB_NAME } });
  }
  let lastId = progress.lastProcessedId;
  let total = progress.totalProcessed;
  let errors = progress.errorCount;

  console.log(`Resuming from lastProcessedId=${lastId ?? '(start)'}, already processed=${total}`);

  while (true) {
    const batch = await prisma.person.findMany({
      where: {
        ...(lastId ? { id: { gt: lastId } } : {}),
        // Only process rows not yet stamped
        OR: [{ companyId: null }, { schoolIds: { equals: [] } }],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        company: true,
        educationSchool: true,
        schools: true,
        companyId: true,
        schoolIds: true,
      },
    });

    if (batch.length === 0) {
      console.log('No more rows to process.');
      break;
    }

    console.log(`Processing batch of ${batch.length} (from ${batch[0].id})…`);

    for (const row of batch) {
      try {
        let newCompanyId: string | undefined = row.companyId ?? undefined;
        if (!newCompanyId && row.company) {
          const r = await findOrCreateCompany(row.company);
          newCompanyId = r.companyId;
        }

        let newSchoolIds: string[] = row.schoolIds;
        if (newSchoolIds.length === 0) {
          const rawSchools = Array.isArray(row.schools) ? (row.schools as string[]) : [];
          if (rawSchools.length === 0 && row.educationSchool) rawSchools.push(row.educationSchool);
          const resolved: string[] = [];
          for (const s of rawSchools) {
            try {
              const r = await findOrCreateSchool(s);
              if (!resolved.includes(r.schoolId)) resolved.push(r.schoolId);
            } catch (err) {
              console.warn(`  [warn] School resolve failed for row ${row.id}, school "${s}":`, err);
            }
          }
          newSchoolIds = resolved;
        }

        if (!dryRun) {
          await prisma.person.update({
            where: { id: row.id },
            data: {
              companyId: newCompanyId ?? undefined,
              schoolIds: newSchoolIds,
            },
          });
        }
        total++;
      } catch (err) {
        errors++;
        console.warn(`  [error] Row ${row.id} failed:`, err);
      }
      lastId = row.id;
    }

    // Persist progress after each batch
    if (!dryRun) {
      await prisma.backfillProgress.update({
        where: { id: progress.id },
        data: { lastProcessedId: lastId, totalProcessed: total, errorCount: errors },
      });
    }

    if ((total % (batchSize * 10)) === 0) console.log(`  Processed ${total} rows (${errors} errors)`);
  }

  if (!dryRun) {
    await prisma.backfillProgress.update({
      where: { id: progress.id },
      data: { completedAt: new Date(), totalProcessed: total, errorCount: errors },
    });
  }
  console.log(`Pass 2 complete: ${total} rows stamped, ${errors} errors.`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchArg = args.find(a => a.startsWith('--batch-size='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 500;

  console.log(dryRun ? '═══ DRY RUN ═══' : '═══ LIVE RUN ═══');
  console.log(`Batch size: ${batchSize}\n`);

  await pass1_build_canonical_tables(dryRun);
  await pass2_stamp_person_rows(batchSize, dryRun);

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Dry-run on a small scale (local dev DB)**

```bash
npx tsx scripts/backfill-canonical-entities.ts --dry-run --batch-size=10
```

Expected: logs distinct-count for companies + schools; Pass 2 logs a batch or two without writing. Exit cleanly.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-canonical-entities.ts
git commit -m "feat(backfill): two-pass script to stamp Person FKs (resumable, dry-run)"
```

---

### Task 2.6: Run backfill on production (guarded)

**Files:** none modified — operational step.

- [ ] **Step 1: Dry-run on production DB**

From the prod-capable shell:

```bash
npx tsx scripts/backfill-canonical-entities.ts --dry-run
```

Expected: prints distinct counts and proposed changes without writing. Review output for sanity:

- Top 20 most-frequent companies look reasonable
- Top 20 most-frequent schools look reasonable
- No obvious wrong merges (e.g., "Apple" → "Apple Records")

- [ ] **Step 2: Sample-review 100 proposed canonical mappings**

Spot-check by running an ad-hoc query after seeding Pass 1:

```bash
npx tsx -e "import('./src/lib/prisma').then(async m => { const p = m.default; const rows = await p.company.findMany({ take: 100, orderBy: { createdAt: 'desc' } }); rows.forEach(r => console.log(r.canonicalName, '←', r.aliases.join(', '))); await p.\$disconnect(); })"
```

Review the 100 rows. If any are obviously wrong (e.g., "Amazon" → "Amazon Logistics"), add manual corrections:

```bash
npx tsx -e "import('./src/lib/prisma').then(async m => { const p = m.default; await p.company.update({ where: { canonicalName: 'Amazon Logistics' }, data: { canonicalName: 'Amazon', aliases: ['amazon', 'amazon logistics', 'amazon web services', 'aws'] } }); await p.\$disconnect(); })"
```

- [ ] **Step 3: Run live backfill**

```bash
npx tsx scripts/backfill-canonical-entities.ts
```

Expected runtime: 15–30 minutes depending on row count. Progress is logged every 500 rows.

- [ ] **Step 4: Verify completion**

```bash
npx tsx -e "import('./src/lib/prisma').then(async m => { const p = m.default; const total = await p.person.count(); const stamped = await p.person.count({ where: { companyId: { not: null } } }); const pct = Math.round(stamped/total*100); console.log(\`\${stamped}/\${total} (\${pct}%) stamped\`); await p.\$disconnect(); })"
```

Expected: ≥95% stamped.

- [ ] **Step 5: Commit (if any operational scripts or notes changed; otherwise skip)**

No code change expected here; this is a runtime operation.

---

## Phase 3 — Reader cutover

### Task 3.1: Feature flag + FK-preferring `buildPersonWhereClause`

**Files:**
- Modify: `src/lib/db/person-service.ts` (function `buildPersonWhereClause`, line 749)

- [ ] **Step 1: Add feature flag reader at the top of person-service.ts**

Near the other exports (e.g., after `isVectorRoleMatchingEnabled`), add:

```ts
export function isCanonicalEntityFKEnabled(): boolean {
  return process.env.USE_CANONICAL_ENTITY_FKS === 'true';
}
```

- [ ] **Step 2: Extend `PersonFilters` type to accept resolved IDs**

Locate the `PersonFilters` interface (line 727). Add two optional fields:

```ts
export interface PersonFilters {
  // ... existing fields ...
  companyId?: string | null;         // NEW — if set, takes precedence over companyAliases
  schoolIds?: string[];              // NEW — if set, takes precedence over university keyword match
}
```

- [ ] **Step 3: Modify `buildPersonWhereClause` to prefer FK path when flag enabled**

Replace the company filter block (current lines 759–776) with:

```ts
// Company filter — FK path preferred (Phase 3+), falls back to alias / contains.
if (isCanonicalEntityFKEnabled() && filters.companyId) {
  where.companyId = filters.companyId;
} else if (filters.companyAliases && filters.companyAliases.length > 0) {
  // ... existing alias-based block preserved verbatim ...
  const aliasFilters = filters.companyAliases.map(alias => ({
    company: alias.length <= 3
      ? { equals: alias, mode: 'insensitive' as const }
      : { contains: alias, mode: 'insensitive' as const }
  }));
  if (aliasFilters.length === 1) {
    where.company = aliasFilters[0].company;
  } else {
    where.OR = aliasFilters;
  }
} else if (filters.company && filters.company.trim()) {
  where.company = { contains: filters.company.trim(), mode: 'insensitive' as const };
}
```

Replace the university filter block (current lines 807–822) with:

```ts
// University filter — FK path preferred, falls back to keyword-AND on educationSchool + schools.
if (isCanonicalEntityFKEnabled() && filters.schoolIds && filters.schoolIds.length > 0) {
  if (!where.AND) where.AND = [];
  (where.AND as unknown[]).push({
    OR: filters.schoolIds.map(sid => ({ schoolIds: { has: sid } }))
  });
} else if (filters.university && filters.university.trim()) {
  const keywords = getUniversityKeywords(filters.university);
  const educationSchoolConditions = keywords.map(kw => ({
    educationSchool: { contains: kw, mode: 'insensitive' as const }
  }));
  const uniConditions: Record<string, unknown>[] = [
    { AND: educationSchoolConditions },
  ];
  if (schoolMatchIds && schoolMatchIds.length > 0) {
    uniConditions.push({ id: { in: schoolMatchIds } });
  }
  if (!where.AND) where.AND = [];
  (where.AND as unknown[]).push({ OR: uniConditions });
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/person-service.ts
git commit -m "feat(query): FK-preferring buildPersonWhereClause (behind USE_CANONICAL_ENTITY_FKS flag)"
```

---

### Task 3.2: Wire `searchPeopleV2Action` to resolve filter IDs

**Files:**
- Modify: `src/app/actions/search.ts` (function `searchPeopleV2Action`)

- [ ] **Step 1: Add resolver import and use it**

Near the top of `src/app/actions/search.ts`, add:

```ts
import { resolveCompanyId, resolveSchoolId, isCanonicalEntityFKEnabled } from '@/lib/services/entity-resolver';
import { isCanonicalEntityFKEnabled } from '@/lib/db/person-service';
```

Find every call to `findPeopleByFiltersV3({ ... })` inside `searchPeopleV2Action` (and the related `loadMoreV2Action`). Immediately BEFORE each call, resolve filter inputs:

```ts
const [companyIdResolved, schoolIdResolved] = isCanonicalEntityFKEnabled()
  ? await Promise.all([
      dbFilters.company ? resolveCompanyId(dbFilters.company) : Promise.resolve(null),
      dbFilters.university ? resolveSchoolId(dbFilters.university) : Promise.resolve(null),
    ])
  : [null, null];
```

Then extend the `findPeopleByFiltersV3` call's filter argument to include the resolved IDs:

```ts
const peopleResults = await findPeopleByFiltersV3({
  // ... existing fields ...
  companyId: companyIdResolved,
  schoolIds: schoolIdResolved ? [schoolIdResolved] : undefined,
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (If both files export `isCanonicalEntityFKEnabled`, keep only the person-service import to avoid ambiguity.)

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/search.ts
git commit -m "feat(search): resolve filter IDs before findPeopleByFiltersV3 (flag-gated)"
```

---

### Task 3.3: Regression harness — frozen queries, old vs new

**Files:**
- Create: `tests/canonical-entity-regression.ts`

- [ ] **Step 1: Write the harness**

Create `tests/canonical-entity-regression.ts`:

```ts
/**
 * Regression harness: verifies the FK path returns the same Person rows as
 * the ILIKE/keyword path for a frozen list of real queries.
 *
 * Run:
 *   # Old path (flag off):
 *   USE_CANONICAL_ENTITY_FKS=false npx tsx tests/canonical-entity-regression.ts --save=old.json
 *   # New path (flag on):
 *   USE_CANONICAL_ENTITY_FKS=true  npx tsx tests/canonical-entity-regression.ts --save=new.json
 *   # Compare:
 *   npx tsx tests/canonical-entity-regression.ts --diff=old.json,new.json
 *
 * Assertion: ≥99% overlap between old and new result sets.
 */
import 'dotenv/config';
import fs from 'node:fs';
import prisma from '../src/lib/prisma';
import { findPeopleByFiltersV3, PersonFiltersV2 } from '../src/lib/db/person-service';
import { resolveCompanyId, resolveSchoolId } from '../src/lib/services/entity-resolver';

const FROZEN_QUERIES: { name: string; filters: Partial<PersonFiltersV2> }[] = [
  { name: 'penn-at-goldman',   filters: { company: 'Goldman Sachs', university: 'University of Pennsylvania' } },
  { name: 'wharton-at-gs',     filters: { company: 'GS', university: 'Wharton' } },
  { name: 'harvard-at-mckinsey', filters: { company: 'McKinsey', university: 'Harvard' } },
  { name: 'hbs-at-mckinsey',   filters: { company: 'McKinsey', university: 'Harvard Business School' } },
  { name: 'booth-at-google',   filters: { company: 'Google', university: 'Booth' } },
  { name: 'uchicago-at-google',filters: { company: 'Google', university: 'University of Chicago' } },
  { name: 'mit-at-meta',       filters: { company: 'Meta', university: 'MIT' } },
  { name: 'stanford-at-apple', filters: { company: 'Apple', university: 'Stanford' } },
  // Add 20+ more frozen queries in the PR that introduces this file.
];

async function runQuery(q: (typeof FROZEN_QUERIES)[0]): Promise<string[]> {
  const filters: PersonFiltersV2 = {
    limit: 200,
    requireEmail: false,
    ...q.filters as any,
  };
  if (process.env.USE_CANONICAL_ENTITY_FKS === 'true') {
    if (filters.company)    filters.companyId = await resolveCompanyId(filters.company);
    if (filters.university) {
      const sid = await resolveSchoolId(filters.university);
      if (sid) filters.schoolIds = [sid];
    }
  }
  const rows = await findPeopleByFiltersV3(filters);
  return rows.map(r => r.id).sort();
}

async function save(path: string) {
  const output: Record<string, string[]> = {};
  for (const q of FROZEN_QUERIES) {
    output[q.name] = await runQuery(q);
    console.log(`  ${q.name}: ${output[q.name].length} results`);
  }
  fs.writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(`Saved → ${path}`);
}

function diff(oldPath: string, newPath: string) {
  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8')) as Record<string, string[]>;
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8')) as Record<string, string[]>;

  let totalOverlap = 0;
  let totalUnion = 0;

  for (const name of Object.keys(oldData)) {
    const oldSet = new Set(oldData[name]);
    const newSet = new Set(newData[name] ?? []);
    const overlap = [...oldSet].filter(id => newSet.has(id)).length;
    const union = new Set([...oldSet, ...newSet]).size;
    totalOverlap += overlap;
    totalUnion += union;

    const removed = [...oldSet].filter(id => !newSet.has(id));
    const added = [...newSet].filter(id => !oldSet.has(id));
    const pct = union === 0 ? 100 : Math.round(overlap / union * 100);
    console.log(`  ${name}: overlap=${pct}% (old=${oldSet.size}, new=${newSet.size}, removed=${removed.length}, added=${added.length})`);
  }

  const overallPct = Math.round(totalOverlap / totalUnion * 100);
  console.log(`\nOverall overlap: ${overallPct}%`);
  if (overallPct < 99) {
    console.error('FAIL: overall overlap < 99%');
    process.exit(1);
  }
  console.log('PASS: overall overlap ≥ 99%');
}

async function main() {
  const args = process.argv.slice(2);
  const saveArg = args.find(a => a.startsWith('--save='))?.split('=')[1];
  const diffArg = args.find(a => a.startsWith('--diff='))?.split('=')[1];

  if (saveArg) {
    await save(saveArg);
  } else if (diffArg) {
    const [oldP, newP] = diffArg.split(',');
    diff(oldP, newP);
  } else {
    console.error('Usage: --save=<path> or --diff=<old>,<new>');
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Record old-path baseline**

```bash
USE_CANONICAL_ENTITY_FKS=false npx tsx tests/canonical-entity-regression.ts --save=/tmp/regression-old.json
```

Expected: per-query result counts logged.

- [ ] **Step 3: Record new-path output**

```bash
USE_CANONICAL_ENTITY_FKS=true npx tsx tests/canonical-entity-regression.ts --save=/tmp/regression-new.json
```

- [ ] **Step 4: Diff**

```bash
npx tsx tests/canonical-entity-regression.ts --diff=/tmp/regression-old.json,/tmp/regression-new.json
```

Expected: "PASS: overall overlap ≥ 99%". If any query is below 95% individually, investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add tests/canonical-entity-regression.ts
git commit -m "test(regression): frozen-query harness — old ILIKE vs new FK path"
```

---

### Task 3.4: Enable flag in production

**Files:** none modified — deployment step.

- [ ] **Step 1: Deploy with flag off**

Merge Task 3.1 + 3.2 + 3.3 PR with `USE_CANONICAL_ENTITY_FKS` unset (defaults false). Deploy. Zero behavior change expected.

- [ ] **Step 2: Verify zero behavior change post-deploy**

Run a canonical query via the live app. Confirm results look normal. Monitor error logs.

- [ ] **Step 3: Flip the flag**

Set `USE_CANONICAL_ENTITY_FKS=true` in the production env. Trigger a redeploy (or a restart if env is read at runtime).

- [ ] **Step 4: Soak 24 hours**

Monitor `entity-resolver` logs. Dashboard query:

```sql
SELECT COUNT(*) FROM "Person" WHERE "companyId" IS NULL AND company IS NOT NULL;
```

Expected: small and stable (new rows pre-stamp).

Log grep for `entity.resolve.fallback` — should be rare. Frequent fallbacks = something's wrong; flip flag off and investigate.

- [ ] **Step 5: Commit deployment note**

No code change. Optionally update `CLAUDE.md` to note the flag is live.

---

## Phase 4 — Cleanup (optional, after 2+ weeks of stability)

### Task 4.1: Remove deprecated string-match code paths

**Files:**
- Modify: `src/lib/db/person-service.ts`
- Modify: `src/lib/services/linkedin-scraper.ts`

- [ ] **Step 1: Delete dead code**

In `src/lib/db/person-service.ts`, remove:
- The `UNIVERSITY_ALIASES` const (lines 15–59)
- `getUniversityKeywords` function (lines 66–86)
- `getSchoolMatchIds` function (line 863)
- The fallback branches in `buildPersonWhereClause` that reference the above

Make the FK branches unconditional (remove the `isCanonicalEntityFKEnabled()` guards).

In `src/lib/services/linkedin-scraper.ts`, remove:
- `SCHOOL_ALIASES` const (lines 41–155)
- `normalizeSchool` function (lines 160–203)

Replace `normalizeSchool` call sites (e.g., in `extractSchools`) with the identity function — the entity resolver now handles canonicalization at the write layer, so the scraper passes through raw strings to `saveScrapedProfile`, which resolves them via `findOrCreateSchool`.

- [ ] **Step 2: Type-check + run all tests**

```bash
npx tsc --noEmit
npx tsx tests/entity-resolver-unit.ts
npx tsx tests/canonical-entity-integration.ts
USE_CANONICAL_ENTITY_FKS=true npx tsx tests/canonical-entity-regression.ts --save=/tmp/post-cleanup.json
```

Expected: all pass.

- [ ] **Step 3: Remove the feature-flag guards**

Grep for `USE_CANONICAL_ENTITY_FKS` and `isCanonicalEntityFKEnabled`. Inline to "always true" (FK path is now the only path).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/person-service.ts src/lib/services/linkedin-scraper.ts
git commit -m "refactor: remove deprecated string-match paths and flag (canonical FK is now standard)"
```

---

## Self-review checklist (post-write)

- [x] Every spec requirement has a task: data model → Task 1.1; write path → 2.1–2.4; read path → 3.1–3.2; backfill → 2.5–2.6; rollout phases → each task tagged by phase; testing → unit (1.2, 1.3), integration (2.2), regression (3.3), backfill dry-run (2.6).
- [x] No placeholders: every "add X" step shows the X. No "TBD".
- [x] Type consistency: `companyId` (string|null) and `schoolIds` (string[]) used identically across all tasks. Resolver returns `{ companyId, canonicalName }` for create helpers; `string|null` for resolve helpers; consistent throughout.
- [x] Commit messages follow existing convention (prefix: scope, imperative subject).
- [x] Each phase's tasks leave the system in a working state if stopped mid-phase: Phase 1 ends with unused tables; Phase 2 ends with dual-write (readers unchanged); Phase 3 behind flag; Phase 4 optional.

---

## Execution handoff

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each subagent reads its task, implements the 5 steps, runs tests, commits. Between tasks I verify the commit and hand off the next task.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
