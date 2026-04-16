# Apollo Company-URL Resolver (Drop-in Replacement for Sonnet)

**Date:** 2026-04-16
**Status:** Design — pending user review (v2 — revised cost model + cache-based validation)
**Related research:** [`docs/linkedin-company-url-resolution-research.md`](../../linkedin-company-url-resolution-research.md)
**Related benchmark:** [`tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md`](../../../tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md)

---

## 1. Problem

`src/lib/services/company-resolver.ts` uses Sonnet 4.6 (LLM recall only) to resolve company-name → LinkedIn-company-URL on cache miss. Empirical benchmark of 10 resolvers over 25 hard-case companies showed Sonnet at **72% accuracy**. Apollo's `/v1/mixed_companies/search` endpoint scored **84%** at comparable latency (~600ms). Cost estimate: **~$0.024/call** (matches existing `APOLLO_COST_PER_LOOKUP` calibration for `/v1/people/match` — assumes 1 credit per call on our current plan; to be validated empirically via Phase A of the shadow test).

This spec replaces the Sonnet-backed resolver with an Apollo-backed one, keeping the public interface byte-identical so no call sites need changes.

**Out of scope:** Serper fallback, Claude-web-search offline drain, DB-backfill mining. Those are future work (see research doc §5).

---

## 2. Goals & non-goals

### Goals
1. Production `resolveCompanyUrl` and `resolveCompanyLinkedInUrls` use Apollo instead of Sonnet.
2. Public interface (`CompanyResolveResult` shape, function signatures) unchanged.
3. DB cache (`CompanyUrl` table) behavior unchanged.
4. Shadow-mode test validates production swap via: (A) 50-row agreement check against existing cache, (B) manual adjudication of disagreements, (C) 15-company fresh-eyes test on unresolved backlog.
5. Total test budget ≤ $1.60 (≤ 65 Apollo calls × $0.024 estimated; may be lower if our plan has a cheaper credit rate).
6. Rollback is a single `git revert`.

### Non-goals
1. No chain logic (Apollo-only, no Serper/Sonnet fallback).
2. No schema changes.
3. No changes to the 3 existing call sites (`search.ts:491`, `ai-search.ts:363`, `ai-search.ts:502`).

### Clarifications (from design review)

- **Cost constant:** Reuse the existing `APOLLO_COST_PER_LOOKUP = 0.024` in `cost-logger.ts`. This value is calibrated for `/v1/people/match` but assumes 1 credit per call, which is widely reported to also apply to `/v1/mixed_companies/search`. The number is conservative — if our plan is actually Professional ($0.0066/credit) then we're over-reporting by ~4×; if our plan is Basic ($0.020/credit) it's accurate. Phase A of the shadow test will validate empirically by comparing before/after Apollo dashboard credit counts.
- **Billing on errors:** Unlike Sonnet (where Anthropic charges for input tokens even when output fails), Apollo only consumes credits on successful HTTP 200 responses. The helper returns a 2-tuple `{url, billed}` so `resolveCompanyUrl` can record cost accurately (0 on HTTP/network errors, 1 credit on 200 OK regardless of empty/populated result).

---

## 3. Architecture

```
┌──────────────────────────────────────────┐
│ Caller (search.ts, ai-search.ts)         │
│   resolveCompanyUrl(name, context?)       │
└────────────────┬─────────────────────────┘
                 │ (unchanged signature)
                 ▼
┌──────────────────────────────────────────┐
│ company-resolver.ts                       │
│                                           │
│ 1. normalizeCompanyName(name)             │
│ 2. prisma.companyUrl.findUnique  ─── hit ─▶ return cached
│ 3. findCompanyLinkedInUrlViaApollo ◀── (was Sonnet)
│ 4. prisma.companyUrl.upsert (if found)   │
│ 5. return {url, cost: {llmCalls, ¢}}     │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────┐
│ Apollo /v1/mixed_companies/search         │
│   POST, X-Api-Key header                  │
│   body: {q_organization_name, page, per_page}
│   returns: organizations[].linkedin_url   │
└──────────────────────────────────────────┘
```

Two files change:

| File | Change |
|---|---|
| `src/lib/services/company-resolver.ts` | **Modify.** Swap Sonnet impl for Apollo. Drop Anthropic SDK import. |
| `tests/apollo-resolver-shadow.ts` | **New.** Shadow-mode test script that runs production `resolveCompanyUrl` against 15 fresh companies and emits a report. |

No migrations. No other files touched.

---

## 4. Components

### 4a. `findCompanyLinkedInUrlViaApollo(companyName): Promise<{url: string | null, billed: boolean}>`

Replaces `findCompanyLinkedInUrlViaSonnet`. Private to the module (not exported).

**Inputs:** company name string (already-normalized by caller).

**Outputs:**
- `url`: LinkedIn URL string (normalized to `https://`) or `null`
- `billed`: `true` iff Apollo returned HTTP 200 (so a credit was consumed), `false` on HTTP/network errors

**Implementation:**

```ts
async function findCompanyLinkedInUrlViaApollo(companyName: string): Promise<{url: string | null; billed: boolean}> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY not configured');
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q_organization_name: companyName,
        page: 1,
        per_page: 1,
      }),
    });

    if (!res.ok) {
      console.warn(`[CompanyResolver] Apollo HTTP ${res.status} for "${companyName}"`);
      log.error('company-resolver', `Apollo HTTP ${res.status}`, { companyName });
      return { url: null, billed: false };
    }

    const data = await res.json();
    const first = (data.organizations || [])[0];
    const raw: string | undefined = first?.linkedin_url;
    const elapsed = Date.now() - start;

    if (!raw) {
      console.log(`[CompanyResolver] Apollo no match for "${companyName}" (${elapsed}ms)`);
      log.api('company-resolver', {
        service: 'apollo',
        endpoint: 'mixed_companies/search',
        request: { companyName },
        response: { url: null },
        durationMs: elapsed,
        costUsd: APOLLO_COST_PER_LOOKUP,
      });
      return { url: null, billed: true };  // Apollo charged us, just no match
    }

    // Apollo returns http://www.linkedin.com/... — normalize to https://
    const url = raw.replace(/^http:\/\//, 'https://');
    console.log(`[CompanyResolver] Apollo resolved "${companyName}" → ${url} (${elapsed}ms)`);
    log.api('company-resolver', {
      service: 'apollo',
      endpoint: 'mixed_companies/search',
      request: { companyName },
      response: { url, matchedName: first?.name },
      durationMs: elapsed,
      costUsd: APOLLO_COST_PER_LOOKUP,
    });
    return { url, billed: true };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[CompanyResolver] Apollo failed for "${companyName}" (${elapsed}ms): ${msg}`);
    log.error('company-resolver', `Apollo failed for "${companyName}"`, { durationMs: elapsed, error: msg });
    return { url: null, billed: false };
  }
}
```

### 4b. Cost constant

Reuse the existing constant in `src/lib/services/cost-logger.ts`:

```ts
// Existing — unchanged
export const APOLLO_COST_PER_LOOKUP = 0.024;
```

Inside `company-resolver.ts`:

```ts
import { APOLLO_COST_PER_LOOKUP } from '@/lib/services/cost-logger';
const COST_PER_APOLLO_CALL_CENTS = APOLLO_COST_PER_LOOKUP * 100; // 2.4¢
```

Replaces `COST_PER_SONNET_CALL_CENTS = 0.02`.

**Rationale for reuse:** Both `/v1/people/match` (email reveal) and `/v1/mixed_companies/search` consume 1 credit per call (community-reported for the latter; official docs just say "consumes credits"). The $0.024 value is a conservative upper bound that matches what our plan actually charges per credit. **Phase A of the shadow test will empirically validate** by comparing Apollo dashboard credits before and after a known call count. If the true number differs materially (e.g., our plan is Professional and credits actually cost $0.0066), we can introduce a separate constant later. For now, over-reporting cost is safer than under-reporting.

### 4c. `resolveCompanyUrl` and `resolveCompanyLinkedInUrls`

**Control flow unchanged.** The edits inside `resolveCompanyUrl` (lines 117–143 of current file) are:

1. Swap helper call: `findCompanyLinkedInUrlViaSonnet(companyName)` → `findCompanyLinkedInUrlViaApollo(companyName)`
2. Destructure `{url, billed}` from the helper return
3. Only count cost when `billed === true` (Apollo only charges on successful HTTP 200)

Diff (in pseudocode):

```ts
// Before:
const url = await findCompanyLinkedInUrlViaSonnet(companyName);
// ... cache write if url ...
return { url, cost: { llmCalls: 1, costCents: COST_PER_SONNET_CALL_CENTS } };

// After:
const { url, billed } = await findCompanyLinkedInUrlViaApollo(companyName);
// ... cache write if url ... (unchanged)
return {
  url,
  cost: {
    llmCalls: billed ? 1 : 0,
    costCents: billed ? COST_PER_APOLLO_CALL_CENTS : 0,
  },
};
```

The `context?: string` parameter becomes unused (Apollo takes only the name). Keep the parameter in the signature for now — it's read at the call sites and removing it would force call-site edits. Mark it `_context` in the function body to indicate "intentionally unused."

### 4d. Imports cleanup

Remove:
```ts
import Anthropic from '@anthropic-ai/sdk';
let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic { ... }
```

Add:
```ts
import { APOLLO_COST_PER_LOOKUP } from '@/lib/services/cost-logger';
```

`prisma` and `log` imports stay.

### 4e. Shadow-mode test: `tests/apollo-resolver-shadow.ts`

**Purpose:** Exercise Apollo against both existing cache (regression check) and fresh unresolved companies (new-capability check). Not a unit test — manual-assertion tsx script, per codebase convention.

**Three phases:**

#### Phase A — Agreement check + empirical credit calibration

1. **Before running:** reviewer opens Apollo dashboard, records current month's used-credits count (e.g. "consumed: 3,412 / 12,000").
2. Sample 50 rows from `CompanyUrl` table (random order).
3. For each `{name, url: cachedUrl}`: call `findCompanyLinkedInUrlViaApollo(name)` **directly** (bypassing the cache read so we actually exercise Apollo).
4. Compare Apollo's URL to the cached URL using `urlsMatch`.
5. Classify each row as: `agree`, `disagree`, `apollo_null`, `apollo_error`.
6. Report agreement rate — a directional signal of how often Apollo and Sonnet concur.
7. **After running:** reviewer re-reads Apollo dashboard credits, records delta. The script also prints the count of `billed: true` responses so we can compute:
   - **credits consumed per billed call = dashboard delta / billed_count**
   - If this equals 1.00 ± 0.1: our $0.024 constant is correct. Proceed.
   - If materially different (e.g. 5 credits/call): open a follow-up ticket to re-calibrate `APOLLO_COST_PER_LOOKUP` or split it into endpoint-specific constants. Don't block the swap.

#### Phase B — Manual adjudication of disagreements

1. Write all `disagree` rows to the markdown report in a reviewer-friendly format (name, cached URL, Apollo URL, both clickable).
2. The test script **does not auto-adjudicate**. Reviewer opens the report and manually decides who's right (LinkedIn search + spot check).
3. Adjudication counts feed into final accuracy numbers.

#### Phase C — Fresh-eyes test on unresolved companies

1. Pick 15 companies from `companies_missing_linkedin_urls.txt` (the hardest 1,677-company backlog).
2. For each: call `resolveCompanyUrl(name)` **through the production interface** (will miss the cache → hit Apollo → write to cache). This validates the full code path end-to-end.
3. Report: how many Apollo now resolves that we previously couldn't.

#### Budget

- Phase A: 50 × $0.024 = **$1.20** (upper bound; errors cost $0)
- Phase C: 15 × $0.024 = **$0.36**
- **Total ≤ $1.60** (upper bound; Phase A may empirically prove our per-call cost is lower)

#### Structure

```ts
import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import prisma from '@/lib/prisma';
import { resolveCompanyUrl } from '@/lib/services/company-resolver';
// NB: we also need the private helper for Phase A (bypass cache).
// Spec choice: export findCompanyLinkedInUrlViaApollo from company-resolver.ts
// for test access. Keep the export named with an underscore prefix to signal
// test-only: `export const _findCompanyLinkedInUrlViaApollo = findCompanyLinkedInUrlViaApollo`.
import { _findCompanyLinkedInUrlViaApollo } from '@/lib/services/company-resolver';

// Shared helpers — inlined (15 LOC)
function normalizeUrl(u: string | null): string | null {
  if (!u) return null;
  return u.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\.linkedin\.com/, 'linkedin.com')
    .replace(/[?#].*$/, '').replace(/\/+$/, '');
}
function urlsMatch(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizeUrl(a) === normalizeUrl(b);
}

// ─── Phase A: agreement check ─────────────────────────────────────
async function phaseA() {
  const sample = await prisma.$queryRaw<Array<{name: string; url: string}>>`
    SELECT name, url FROM "CompanyUrl" ORDER BY random() LIMIT 50
  `;
  console.log(`\n── Phase A: 50-row cache agreement check ──`);
  const rows = [];
  for (const { name, url: cachedUrl } of sample) {
    const start = Date.now();
    const { url: apolloUrl, billed } = await _findCompanyLinkedInUrlViaApollo(name);
    const elapsed = Date.now() - start;
    const status = !apolloUrl
      ? (billed ? 'apollo_null' : 'apollo_error')
      : urlsMatch(apolloUrl, cachedUrl) ? 'agree' : 'disagree';
    rows.push({ name, cachedUrl, apolloUrl, status, billed, elapsed });
    const mark = { agree: '✓', disagree: '≠', apollo_null: '∅', apollo_error: '!' }[status];
    console.log(`  ${mark} ${name.padEnd(32)} ${status}`);
  }
  const agree = rows.filter(r => r.status === 'agree').length;
  const disagree = rows.filter(r => r.status === 'disagree').length;
  const billedCount = rows.filter(r => r.billed).length;
  console.log(`\n  agree: ${agree}/50, disagree: ${disagree}/50, null/error: ${50 - agree - disagree}/50`);
  console.log(`  billed calls: ${billedCount}/50 — compare to Apollo dashboard delta to compute credits/call`);
  return rows;
}

// ─── Phase C: fresh-eyes on unresolved backlog ────────────────────
async function phaseC() {
  const raw = await readFile(join(process.cwd(), 'companies_missing_linkedin_urls.txt'), 'utf-8');
  const all = raw.split('\n').map(s => s.trim()).filter(Boolean);
  // Pick a spread across the file (first, middle, last thirds) for variety
  const picks = [
    ...all.slice(0, 5),
    ...all.slice(Math.floor(all.length / 2), Math.floor(all.length / 2) + 5),
    ...all.slice(-5),
  ];
  console.log(`\n── Phase C: 15 unresolved companies (fresh-eyes) ──`);
  const rows = [];
  for (const name of picks) {
    const start = Date.now();
    const res = await resolveCompanyUrl(name);  // full path: DB → Apollo → cache upsert
    const elapsed = Date.now() - start;
    rows.push({ name, apolloUrl: res.url, costCents: res.cost.costCents, elapsed });
    console.log(`  ${res.url ? '✓' : '✗'} ${name.padEnd(40)} → ${res.url || 'null'} (${elapsed}ms)`);
  }
  const resolved = rows.filter(r => r.apolloUrl).length;
  console.log(`\n  resolved: ${resolved}/15 — these go into CompanyUrl cache for future free hits`);
  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const phaseAResults = await phaseA();
  const phaseCResults = await phaseC();

  // Write markdown report — Phase B (disagreements) rendered in a reviewer format
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(__dirname, 'company-url-benchmark-reports');
  await mkdir(dir, { recursive: true });
  const md = renderReport(phaseAResults, phaseCResults);
  await writeFile(join(dir, `apollo-shadow-${stamp}.md`), md);
  await writeFile(join(dir, `apollo-shadow-${stamp}.json`),
    JSON.stringify({ phaseA: phaseAResults, phaseC: phaseCResults }, null, 2));
  console.log(`\n📊 Report: ${join(dir, `apollo-shadow-${stamp}.md`)}`);
  console.log(`👀 Phase B: review disagreements in the report to compute true accuracy.`);

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

The `renderReport` helper (not shown) emits three sections: (A) Phase A summary table + list of disagreements with both URLs for reviewer, (B) placeholder checklist for adjudication, (C) Phase C per-row table.

---

## 5. Data flow

### Happy path (cache miss → Apollo hit)
1. Caller calls `resolveCompanyUrl("Goldman Sachs")`.
2. `normalizeCompanyName` → `"goldman sachs"`.
3. `prisma.companyUrl.findUnique({where: {name: "goldman sachs"}})` → `null` (cache miss).
4. `findCompanyLinkedInUrlViaApollo("Goldman Sachs")` → POST to Apollo.
5. Apollo returns `{organizations: [{linkedin_url: "http://www.linkedin.com/company/goldman-sachs"}]}`.
6. Normalize `http://` → `https://`.
7. `prisma.companyUrl.upsert` with `{name: "goldman sachs", url: "https://www.linkedin.com/company/goldman-sachs"}`.
8. Return `{url: "...", cost: {llmCalls: 1, costCents: 2.4}}`.

### Cache hit
Steps 1–3, then return cached `{url, cost: {llmCalls: 0, costCents: 0}}`. Skip Apollo entirely.

### Apollo miss (no match in Apollo's DB)
Steps 1–4, Apollo returns HTTP 200 with `{organizations: []}`. Helper returns `{url: null, billed: true}`. No cache write. `resolveCompanyUrl` returns `{url: null, cost: {llmCalls: 1, costCents: 2.4}}` — Apollo consumed 1 credit even though nothing matched. Caller falls through to existing raw-name Apify behavior.

### Apollo error (HTTP 5xx, network failure)
Steps 1–4, fetch throws or `res.ok === false`. Helper returns `{url: null, billed: false}`. No cache write. `resolveCompanyUrl` returns `{url: null, cost: {llmCalls: 0, costCents: 0}}` — no credit consumed, no bill. This is more accurate than the current Sonnet drop-in behavior (which always bills).

### Missing `APOLLO_API_KEY`
Throws at first call (not module init). Surfaces as an exception to caller. This is acceptable because the key is validated the same way in `enrichment.ts` — consistent failure mode across the codebase.

---

## 6. Error handling

| Scenario | Helper returns | Caller `costCents` | Rationale |
|---|---|---|---|
| No API key | throws | n/a | Fail loud in dev; consistent with `enrichment.ts` |
| HTTP 4xx/5xx | `{url: null, billed: false}` | **0** | No successful Apollo response → no credit consumed |
| Network timeout / fetch throws | `{url: null, billed: false}` | **0** | Request may not have reached Apollo → don't bill |
| HTTP 200, empty `organizations` | `{url: null, billed: true}` | **2.4** | Apollo served a successful search, 1 credit consumed |
| HTTP 200, `linkedin_url` missing | `{url: null, billed: true}` | **2.4** | Same as empty array |
| HTTP 200, valid URL | `{url: "https://...", billed: true}` | **2.4** | Happy path |
| Malformed JSON on HTTP 200 | `{url: null, billed: true}` | **2.4** | Apollo billed us regardless of parse outcome |
| DB cache read failure | (helper still runs) | per helper | Continue to Apollo; current behavior (lines 113–115) |
| DB cache write failure | (helper already returned) | per helper | Log warning, still return URL; current behavior (lines 128–130) |

**Key difference from current Sonnet implementation:** the Sonnet resolver always bills on error because Anthropic charges for input tokens even when output fails. Apollo only consumes credits on successful searches, so we track a `billed` flag and zero-out cost when the call didn't reach Apollo.

---

## 7. Testing

### Shadow-mode acceptance criteria

Run `npx tsx tests/apollo-resolver-shadow.ts`. Pass if:

1. Script runs to completion without throwing.
2. **Phase A agreement rate ≥ 65%**. Given Sonnet's 72% accuracy and Apollo's 84%, expected overlap is ~60–75%; <65% suggests Apollo materially disagrees and needs human review before we ship.
3. **Phase C resolution rate ≥ 40%.** Of 15 previously-unresolved companies, Apollo should rescue at least 6. The sample is drawn from our hardest backlog; anything higher is gravy.
4. **Average Apollo latency < 1000ms** across both phases. Main benchmark showed 602ms; allow 2× headroom.
5. Markdown + JSON reports written to `tests/company-url-benchmark-reports/apollo-shadow-<timestamp>.{md,json}`.
6. After Phase C, `CompanyUrl` table has N new rows where N = Phase C resolutions (proves full-path cache write works).

### Manual adjudication (Phase B)

Acceptance criteria above are automatic. For true accuracy numbers, reviewer must:

1. Open the generated markdown report's "Phase A disagreements" section.
2. For each disagreement row, click both cached and Apollo URLs; note which resolves to the correct company on LinkedIn.
3. Tally adjudication: `apollo_right` / `cache_right` / `both_wrong`.
4. Compute **true Apollo accuracy** = (agree + apollo_right) / (agree + disagree + apollo_null).

This step is expected to take ~15 minutes if disagreements are ≤30. If the rate is higher, that's itself a signal to pause.

### Pre-commit verification

- `npx tsc --noEmit` passes (type check clean).
- `npm run lint` passes.

### Pre-commit verification

- `npx tsc --noEmit` passes (type check clean).
- `npm run lint` passes.

### Rollback plan

Single `git revert <commit>` on the `company-resolver.ts` change reverts to Sonnet-backed resolver. Shadow test file can stay — it's useful for any future resolver change.

---

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apollo credit quota (12k/mo Professional plan) burned faster than expected | Medium | Monitor Apollo credit usage via existing discovery-logger. Add alert if monthly burn > 80% of quota. |
| Apollo returns parent-org URL for regional subsidiaries (e.g., KPMG China) | Medium | Known failure mode from benchmark (§4b of research doc). For shadow test, sample avoids this category. For production, acceptable for now — Serper fallback would address this in future iteration. |
| Apollo API downtime | Low | Error handling returns null cleanly; caller falls through to raw-name Apify behavior. |
| Phase A agreement rate < 65% | Medium | Adjudicate disagreements manually (§7). If Apollo is materially worse than Sonnet in a category, revert the swap. If Apollo is better but rate is still low (because Sonnet was wrong a lot), ship the swap with confidence. |
| Phase C resolution rate is trivial (< 20%) | Low | Expected — the backlog is the hardest cases by definition. If Apollo resolves even 6/15, it's worth shipping because those stale entries become free DB hits forever after. |
| Silent caching of wrong URLs | Low (Apollo data is high-quality for this use case) | Cached URL is only overwritten when a new URL resolution runs for the same `name` — and `CompanyUrl` has no TTL. If Apollo is wrong once, we carry that error forever. Future work: add a 90-day freshness check. |

---

## 9. Open questions

None at design time. All architectural decisions resolved per §3–§4.

---

## 10. References

- Research doc: `docs/linkedin-company-url-resolution-research.md`
- Benchmark code: `tests/company-url-resolution-benchmark.ts`
- Benchmark report: `tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md`
- Apollo API docs: https://docs.apollo.io/reference/organization-search
- Apollo credit-usage confirmed: https://docs.apollo.io/docs/api-pricing
- Existing Apollo usage: `src/lib/services/enrichment.ts:170` (`/v1/people/match`)
- Existing cost constant: `src/lib/services/cost-logger.ts:16` (`APOLLO_COST_PER_LOOKUP = 0.024`)
