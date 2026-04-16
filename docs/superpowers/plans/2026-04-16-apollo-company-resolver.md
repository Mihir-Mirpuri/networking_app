# Apollo Company-URL Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap `src/lib/services/company-resolver.ts` from Sonnet 4.6 (72% accuracy) to Apollo `/v1/mixed_companies/search` (84% accuracy, 3–5× faster), keeping the public interface byte-identical.

**Architecture:** Two-file change. (1) Replace the private `findCompanyLinkedInUrlViaSonnet` helper with `findCompanyLinkedInUrlViaApollo` that calls Apollo's org search endpoint and returns `{url, billed}`. The outer `resolveCompanyUrl` / `resolveCompanyLinkedInUrls` keep their signatures and only count cost when `billed === true`. (2) Add a shadow-mode test script that exercises Phases A (50-row cache agreement), B (manual adjudication of disagreements), and C (15-company fresh-eyes on unresolved backlog), then emits a markdown+JSON report.

**Tech Stack:** TypeScript (strict), Next.js 14 App Router, Prisma, Apollo API, existing `@/lib/services/cost-logger` constants. No new dependencies.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md`
- Research: `docs/linkedin-company-url-resolution-research.md`
- Benchmark: `tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.md`
- Validation (42-call pilot, 81% agreement): `tests/apollo-cost-validation.ts`

**Pre-flight context for the implementer:**

- `APOLLO_API_KEY` is already in `.env` (Apollo is used elsewhere — `src/lib/services/enrichment.ts:170`).
- `APOLLO_COST_PER_LOOKUP = 0.024` lives in `src/lib/services/cost-logger.ts:16`. Reuse it; do NOT create a new constant.
- Apollo only bills on HTTP 200. Helper must signal that to the caller via a `billed` field so costs are zero on network/5xx errors.
- Apollo returns `http://www.linkedin.com/...` (no https, sometimes with locale subdomain). Normalize to `https://` before caching.
- DB cache (`CompanyUrl` table) is already in place — do not migrate.
- Codebase convention: manual-assertion tsx scripts, no Jest/Vitest. Follow the pattern in `tests/company-url-resolution-benchmark.ts` and `tests/apollo-cost-validation.ts`.
- Call sites that must NOT change: `src/app/actions/search.ts:491`, `src/lib/services/ai-search.ts:363`, `src/lib/services/ai-search.ts:502`. All three call `resolveCompanyUrl(name, context?)` and expect `{url, cost}`.

**File map:**

| File | Action | Responsibility |
|---|---|---|
| `src/lib/services/company-resolver.ts` | **Modify** | Swap Sonnet helper for Apollo helper. Keep public API unchanged. Export a test-only alias of the private helper so the shadow test can bypass cache. |
| `tests/apollo-resolver-shadow.ts` | **Create** | Phase A + B + C shadow test. Emits markdown + JSON to `tests/company-url-benchmark-reports/apollo-shadow-<stamp>.{md,json}`. |
| `tests/apollo-cost-validation.ts` | **Delete** (or keep for reference) | Pilot script superseded by the shadow test. User's call at commit time. |

---

## Task 1: Swap resolver from Sonnet to Apollo

**Files:**
- Modify: `src/lib/services/company-resolver.ts` (entire file — rewrite core sections)

**Why this first:** Everything else (shadow test, manual review) depends on the new resolver existing. We don't TDD the production file because this codebase has no test framework — verification happens via the shadow test in Task 3. We do a fast `tsc --noEmit` after to catch syntax/type errors.

- [ ] **Step 1: Replace the file content.**

Full replacement for `src/lib/services/company-resolver.ts`:

```ts
/**
 * Company Name → LinkedIn Company URL Resolver
 *
 * Uses Apollo's /v1/mixed_companies/search endpoint to resolve company-name →
 * LinkedIn-company-URL on cache miss. Results are cached in the CompanyUrl DB
 * table to avoid repeat lookups.
 *
 * Flow: DB cache (free, instant) → Apollo (~$0.024, ~200ms) → cache result.
 * If Apollo can't find it, the caller falls back to using the company name string.
 *
 * Swapped from Sonnet 4.6 on 2026-04-16 (see
 * docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md).
 * Apollo scored 84% in benchmark vs Sonnet's 72% with 3–5× lower latency.
 */

import prisma from '@/lib/prisma';
import { log } from '@/lib/services/discovery-logger';
import { APOLLO_COST_PER_LOOKUP } from '@/lib/services/cost-logger';

export interface CompanyResolveResult {
  url: string | null;
  cost: {
    llmCalls: number;
    costCents: number;
  };
}

const COST_PER_APOLLO_CALL_CENTS = APOLLO_COST_PER_LOOKUP * 100; // 2.4¢

function normalizeCompanyName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Ask Apollo for the LinkedIn company page URL.
 * Returns {url, billed}. `billed` is true iff Apollo returned HTTP 200
 * (so a credit was consumed, regardless of whether the search matched).
 */
async function findCompanyLinkedInUrlViaApollo(
  companyName: string
): Promise<{ url: string | null; billed: boolean }> {
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

    const elapsed = Date.now() - start;

    if (!res.ok) {
      console.warn(`[CompanyResolver] Apollo HTTP ${res.status} for "${companyName}" (${elapsed}ms)`);
      log.error('company-resolver', `Apollo HTTP ${res.status}`, { companyName, durationMs: elapsed });
      return { url: null, billed: false };
    }

    const data = await res.json();
    const first = (data.organizations || [])[0];
    const raw: string | undefined = first?.linkedin_url;

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
      return { url: null, billed: true };
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
    log.error('company-resolver', `Apollo failed for "${companyName}"`, {
      durationMs: elapsed,
      error: msg,
    });
    return { url: null, billed: false };
  }
}

// Test-only export for shadow script. Prefix `_` signals do-not-import from app code.
export const _findCompanyLinkedInUrlViaApollo = findCompanyLinkedInUrlViaApollo;

/**
 * Resolve a company name to its LinkedIn company page URL.
 *
 * 1. Check DB cache first (free)
 * 2. If not cached, ask Apollo (~$0.024)
 * 3. Cache the result for future lookups
 */
export async function resolveCompanyUrl(
  companyName: string,
  _context?: string
): Promise<CompanyResolveResult> {
  const normalized = normalizeCompanyName(companyName);

  if (!normalized) {
    return { url: null, cost: { llmCalls: 0, costCents: 0 } };
  }

  // 1. Check DB cache
  try {
    const cached = await prisma.companyUrl.findUnique({
      where: { name: normalized },
    });

    if (cached) {
      console.log(`[CompanyResolver] "${companyName}" → ${cached.url} (cached)`);
      log.info('company-resolver', 'Cache hit', { companyName, url: cached.url });
      return { url: cached.url, cost: { llmCalls: 0, costCents: 0 } };
    }
  } catch (err) {
    console.warn(
      `[CompanyResolver] Cache lookup failed for "${companyName}": ${
        err instanceof Error ? err.message : 'unknown'
      }`
    );
  }

  // 2. Ask Apollo
  const { url, billed } = await findCompanyLinkedInUrlViaApollo(companyName);

  if (url) {
    // 3. Cache the result
    try {
      await prisma.companyUrl.upsert({
        where: { name: normalized },
        create: { name: normalized, url },
        update: { url },
      });
    } catch (err) {
      console.warn(
        `[CompanyResolver] Failed to cache "${companyName}": ${
          err instanceof Error ? err.message : 'unknown'
        }`
      );
    }
  } else {
    console.warn(`[CompanyResolver] No LinkedIn URL found for "${companyName}"`);
    log.warn('company-resolver', `No LinkedIn URL found for "${companyName}"`);
  }

  return {
    url,
    cost: {
      llmCalls: billed ? 1 : 0,
      costCents: billed ? COST_PER_APOLLO_CALL_CENTS : 0,
    },
  };
}

/**
 * Batch resolve multiple company names.
 * Checks cache first, then resolves uncached names via Apollo.
 */
export async function resolveCompanyLinkedInUrls(
  companyNames: string[]
): Promise<{
  urls: Map<string, string | null>;
  cost: { llmCalls: number; costCents: number };
}> {
  console.log(
    `[CompanyResolver] Batch resolving ${companyNames.length} companies: ${companyNames.join(', ')}`
  );
  const urls = new Map<string, string | null>();
  let totalLlmCalls = 0;

  for (const name of companyNames) {
    const result = await resolveCompanyUrl(name);
    urls.set(name, result.url);
    totalLlmCalls += result.cost.llmCalls;
  }

  const resolved = Array.from(urls.entries()).filter(([, v]) => v !== null).length;
  console.log(
    `[CompanyResolver] Batch complete — ${resolved}/${companyNames.length} resolved, ${totalLlmCalls} Apollo calls`
  );

  return {
    urls,
    cost: {
      llmCalls: totalLlmCalls,
      costCents: totalLlmCalls * COST_PER_APOLLO_CALL_CENTS,
    },
  };
}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`

Expected: Exits 0 with no output. If it fails with unrelated pre-existing errors (e.g. `OnboardingClient.tsx` unescaped apostrophe — see CLAUDE.md "Known issues"), verify the failures are not in `company-resolver.ts` or any file that imports it. Run:

```bash
npx tsc --noEmit 2>&1 | grep -E "company-resolver|search\.ts|ai-search\.ts" | head -20
```

Expected: no output (no errors in files we touched or their consumers).

- [ ] **Step 3: Lint.**

Run: `npm run lint`

Expected: Zero warnings/errors in `company-resolver.ts`. Unrelated warnings elsewhere are fine.

- [ ] **Step 4: Verify call sites still compile.**

Three production call sites must keep working. Spot-check that none of them destructure fields we didn't return:

Run:
```bash
grep -n "resolveCompanyUrl\|resolveCompanyLinkedInUrls" src/app/actions/search.ts src/lib/services/ai-search.ts
```

Expected output (line numbers may drift by ±5):
```
src/app/actions/search.ts:491:      resolveCompanyUrl(...
src/lib/services/ai-search.ts:363:      resolveCompanyUrl(...
src/lib/services/ai-search.ts:502:      resolveCompanyUrl(...
```

Read each of those 3 lines plus the 2 following lines. Confirm each consumer uses only `.url` and `.cost.costCents` / `.cost.llmCalls` — all of which we still return. If anything else is read (e.g. a `confidence` field), STOP and re-read the spec.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/services/company-resolver.ts
git commit -m "$(cat <<'EOF'
feat(resolver): swap company-resolver from Sonnet 4.6 to Apollo

Empirical benchmark (see docs/linkedin-company-url-resolution-research.md)
showed Apollo /v1/mixed_companies/search at 84% accuracy vs Sonnet's 72%
on the 25-company hard-case sample, with 3–5× lower latency (~200ms vs
~1s). A separate 42-call cache-agreement pilot showed 81% agreement with
the existing CompanyUrl cache and zero errors.

Billing: Apollo only consumes credits on HTTP 200. Helper now returns
{url, billed} so the outer function records zero cost on network/5xx
errors (unlike Sonnet which billed even on failure).

Public API unchanged: {url, cost: {llmCalls, costCents}}.
Rollback: single git revert.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write shadow-mode test script

**Files:**
- Create: `tests/apollo-resolver-shadow.ts`
- Modify: nothing else

**Why:** We need an automated way to validate the swap against both existing cache (regression) and fresh backlog (new capability). The script has three phases matching spec §4e.

- [ ] **Step 1: Create the shadow test file.**

Create `tests/apollo-resolver-shadow.ts` with:

```ts
/**
 * Apollo Resolver — Shadow-Mode Acceptance Test
 *
 * Phase A: 50 random rows from CompanyUrl → call Apollo directly, compare URLs
 * Phase B: Render disagreements into a reviewer-friendly markdown section
 * Phase C: 15 unresolved companies → call resolveCompanyUrl end-to-end
 *
 * Emits markdown + JSON to tests/company-url-benchmark-reports/apollo-shadow-<stamp>.{md,json}
 *
 * Cost: ~$1.60 upper bound (65 Apollo calls × $0.024). May be lower if plan gives
 * cheaper credits; the script prints the billed-call count so the reviewer can
 * cross-check against the Apollo dashboard.
 *
 * Run: npx tsx tests/apollo-resolver-shadow.ts
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import prisma from '../src/lib/prisma';
import {
  resolveCompanyUrl,
  _findCompanyLinkedInUrlViaApollo,
} from '../src/lib/services/company-resolver';

// ─── URL comparison helpers ───────────────────────────────────────
function normalizeUrl(u: string | null): string | null {
  if (!u) return null;
  return u
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\.linkedin\.com/, 'linkedin.com')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function urlsMatch(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizeUrl(a) === normalizeUrl(b);
}

// ─── Types ────────────────────────────────────────────────────────
type PhaseAStatus = 'agree' | 'disagree' | 'apollo_null' | 'apollo_error';
interface PhaseARow {
  name: string;
  cachedUrl: string;
  apolloUrl: string | null;
  status: PhaseAStatus;
  billed: boolean;
  elapsed: number;
}
interface PhaseCRow {
  name: string;
  apolloUrl: string | null;
  costCents: number;
  elapsed: number;
}

// ─── Phase A: 50-row cache agreement ──────────────────────────────
async function phaseA(): Promise<PhaseARow[]> {
  const sample = await prisma.$queryRaw<Array<{ name: string; url: string }>>`
    SELECT name, url FROM "CompanyUrl" ORDER BY random() LIMIT 50
  `;

  console.log(`\n── Phase A: 50-row cache agreement check ──`);
  console.log(`>>> Note Apollo dashboard "credits used" BEFORE. Starting in 3s...`);
  await new Promise((r) => setTimeout(r, 3000));

  const rows: PhaseARow[] = [];
  for (let i = 0; i < sample.length; i++) {
    const { name, url: cachedUrl } = sample[i];
    const start = Date.now();
    const { url: apolloUrl, billed } = await _findCompanyLinkedInUrlViaApollo(name);
    const elapsed = Date.now() - start;

    let status: PhaseAStatus;
    if (!apolloUrl) status = billed ? 'apollo_null' : 'apollo_error';
    else status = urlsMatch(apolloUrl, cachedUrl) ? 'agree' : 'disagree';

    rows.push({ name, cachedUrl, apolloUrl, status, billed, elapsed });
    const mark = { agree: '✓', disagree: '≠', apollo_null: '∅', apollo_error: '!' }[status];
    console.log(`  [${i + 1}/50] ${mark} ${name.padEnd(36).slice(0, 36)} ${status} (${elapsed}ms)`);
  }

  const agree = rows.filter((r) => r.status === 'agree').length;
  const disagree = rows.filter((r) => r.status === 'disagree').length;
  const apolloNull = rows.filter((r) => r.status === 'apollo_null').length;
  const apolloError = rows.filter((r) => r.status === 'apollo_error').length;
  const billedCount = rows.filter((r) => r.billed).length;

  console.log(
    `\n  agree: ${agree}/50, disagree: ${disagree}/50, apollo_null: ${apolloNull}/50, apollo_error: ${apolloError}/50`
  );
  console.log(
    `  billed: ${billedCount}/50 — compare to Apollo dashboard delta to compute credits/call`
  );
  return rows;
}

// ─── Phase C: 15 unresolved companies end-to-end ──────────────────
async function phaseC(): Promise<PhaseCRow[]> {
  const raw = await readFile(
    join(process.cwd(), 'companies_missing_linkedin_urls.txt'),
    'utf-8'
  );
  const all = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Spread picks across the file for variety (first/middle/last 5 each)
  const mid = Math.floor(all.length / 2);
  const picks = [...all.slice(0, 5), ...all.slice(mid, mid + 5), ...all.slice(-5)];

  console.log(`\n── Phase C: 15 unresolved companies (end-to-end through resolveCompanyUrl) ──`);
  const rows: PhaseCRow[] = [];
  for (let i = 0; i < picks.length; i++) {
    const name = picks[i];
    const start = Date.now();
    const res = await resolveCompanyUrl(name); // full path: DB → Apollo → cache upsert
    const elapsed = Date.now() - start;
    rows.push({
      name,
      apolloUrl: res.url,
      costCents: res.cost.costCents,
      elapsed,
    });
    console.log(
      `  [${i + 1}/15] ${res.url ? '✓' : '✗'} ${name.padEnd(40).slice(0, 40)} → ${
        res.url || 'null'
      } (${elapsed}ms)`
    );
  }

  const resolved = rows.filter((r) => r.apolloUrl).length;
  console.log(
    `\n  resolved: ${resolved}/15 — these are now cached in CompanyUrl for future free hits`
  );
  return rows;
}

// ─── Markdown rendering ───────────────────────────────────────────
function renderReport(phaseA: PhaseARow[], phaseC: PhaseCRow[]): string {
  const now = new Date().toISOString();
  const agree = phaseA.filter((r) => r.status === 'agree').length;
  const disagree = phaseA.filter((r) => r.status === 'disagree').length;
  const apolloNull = phaseA.filter((r) => r.status === 'apollo_null').length;
  const apolloError = phaseA.filter((r) => r.status === 'apollo_error').length;
  const billed = phaseA.filter((r) => r.billed).length;
  const latencies = phaseA.map((r) => r.elapsed).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const avg = latencies.length
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : 0;

  const phaseCResolved = phaseC.filter((r) => r.apolloUrl).length;
  const phaseCCost = phaseC.reduce((s, r) => s + r.costCents, 0) / 100;
  const totalCost = (billed * 0.024 + phaseCCost).toFixed(3);

  const disagreements = phaseA.filter((r) => r.status === 'disagree');
  const apolloNulls = phaseA.filter((r) => r.status === 'apollo_null');

  return `# Apollo Resolver Shadow Report

**Generated:** ${now}
**Spec:** \`docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md\`

---

## Phase A — Cache Agreement (50 rows)

| Status | Count | % |
|---|---|---|
| agree | ${agree} | ${((agree / 50) * 100).toFixed(1)}% |
| disagree | ${disagree} | ${((disagree / 50) * 100).toFixed(1)}% |
| apollo_null | ${apolloNull} | ${((apolloNull / 50) * 100).toFixed(1)}% |
| apollo_error | ${apolloError} | ${((apolloError / 50) * 100).toFixed(1)}% |

**Latency:** p50 ${p50}ms / avg ${avg}ms / p95 ${p95}ms
**Billed calls:** ${billed}/50
**Estimated cost this run:** ~$${totalCost} (assumes $0.024/call — validate against dashboard delta)

### Acceptance gates

- Agreement rate ≥ 65%: ${(agree / 50) * 100 >= 65 ? '✅ PASS' : '❌ FAIL'} (${((agree / 50) * 100).toFixed(1)}%)
- Average latency < 1000ms: ${avg < 1000 ? '✅ PASS' : '❌ FAIL'} (${avg}ms)

---

## Phase B — Manual Adjudication of Disagreements

${
  disagreements.length === 0
    ? '_No disagreements — skip Phase B._'
    : `Review each row. Click both URLs, decide which points to the correct company on LinkedIn.

| # | Name | Cached URL | Apollo URL | Verdict |
|---|---|---|---|---|
${disagreements
  .map(
    (r, i) =>
      `| ${i + 1} | ${r.name} | [${r.cachedUrl}](${r.cachedUrl}) | [${r.apolloUrl}](${r.apolloUrl}) | ☐ apollo_right ☐ cache_right ☐ both_wrong |`
  )
  .join('\n')}

### Apollo nulls (Apollo couldn't find)

${
  apolloNulls.length === 0
    ? '_None._'
    : apolloNulls
        .map((r) => `- **${r.name}** — cached: [${r.cachedUrl}](${r.cachedUrl})`)
        .join('\n')
}

### Adjudication tally (fill in after review)

- apollo_right: ___
- cache_right: ___
- both_wrong: ___
- **True Apollo accuracy** = (agree + apollo_right) / (agree + disagree + apollo_null) = ___%`
}

---

## Phase C — Fresh-Eyes on Unresolved Backlog (15 rows)

| # | Name | Apollo URL | Cost | Latency |
|---|---|---|---|---|
${phaseC
  .map(
    (r, i) =>
      `| ${i + 1} | ${r.name} | ${r.apolloUrl ? `[${r.apolloUrl}](${r.apolloUrl})` : '_null_'} | ${r.costCents.toFixed(2)}¢ | ${r.elapsed}ms |`
  )
  .join('\n')}

**Resolved:** ${phaseCResolved}/15 (${((phaseCResolved / 15) * 100).toFixed(1)}%)

### Acceptance gate

- Resolution rate ≥ 40%: ${(phaseCResolved / 15) * 100 >= 40 ? '✅ PASS' : '❌ FAIL'} (${((phaseCResolved / 15) * 100).toFixed(1)}%)

---

## Cost Calibration (fill in after run)

1. Apollo dashboard credits BEFORE: \_\_\_\_\_
2. Apollo dashboard credits AFTER: \_\_\_\_\_
3. Delta: \_\_\_\_\_
4. Billed calls this run: ${billed + phaseC.filter((r) => r.costCents > 0).length}
5. Credits per call = delta / billed = \_\_\_\_\_ (expect 1.00 ± 0.1)
6. If ≠ 1, file follow-up to re-calibrate \`APOLLO_COST_PER_LOOKUP\`
`;
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  if (!process.env.APOLLO_API_KEY) {
    console.error('APOLLO_API_KEY not set — aborting');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('APOLLO RESOLVER — SHADOW-MODE ACCEPTANCE TEST');
  console.log('='.repeat(70));

  const phaseAResults = await phaseA();
  const phaseCResults = await phaseC();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(__dirname, 'company-url-benchmark-reports');
  await mkdir(dir, { recursive: true });

  const md = renderReport(phaseAResults, phaseCResults);
  const mdPath = join(dir, `apollo-shadow-${stamp}.md`);
  const jsonPath = join(dir, `apollo-shadow-${stamp}.json`);
  await writeFile(mdPath, md);
  await writeFile(
    jsonPath,
    JSON.stringify({ phaseA: phaseAResults, phaseC: phaseCResults }, null, 2)
  );

  console.log(`\n📊 Report: ${mdPath}`);
  console.log(`👀 Phase B: manually adjudicate disagreements in the report above.`);
  console.log(`💰 Fill in Apollo dashboard delta in the report to validate cost per call.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`

Expected: No errors from `tests/apollo-resolver-shadow.ts`. If there are errors, verify the import path for `_findCompanyLinkedInUrlViaApollo` matches the export from Task 1.

- [ ] **Step 3: Commit (without running yet).**

```bash
git add tests/apollo-resolver-shadow.ts
git commit -m "$(cat <<'EOF'
test: add Apollo resolver shadow-mode acceptance test

Three-phase script per design spec:
  A) 50 random CompanyUrl rows → Apollo direct call → compare with cache
  B) Render disagreements for manual adjudication
  C) 15 unresolved companies from backlog → resolveCompanyUrl end-to-end

Emits markdown+JSON report to tests/company-url-benchmark-reports/apollo-shadow-<stamp>.{md,json}.
Budget: ≤65 Apollo calls (~$1.60 upper bound).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Run shadow test and verify acceptance gates

**Files:**
- Create: `tests/company-url-benchmark-reports/apollo-shadow-<timestamp>.{md,json}` (auto-generated)

**Why:** This is the production-readiness gate. The 42-call pilot we ran earlier is a strong signal, but the spec defines 50 Phase A rows + 15 Phase C rows as the acceptance budget. Run the full test.

- [ ] **Step 1: Record Apollo dashboard baseline.**

Open Apollo dashboard → Settings → API Usage (or Billing → Credits). Record current month's used-credits count (e.g. "3,412 / 12,000"). Write it down physically or in a scratch note.

- [ ] **Step 2: Run the shadow test.**

```bash
npx tsx tests/apollo-resolver-shadow.ts
```

Expected runtime: ~20–30 seconds (65 Apollo calls × ~300ms each).

Expected terminal output (last 10 lines will look like):

```
  agree: 34/50, disagree: 6/50, apollo_null: 2/50, apollo_error: 0/50
  billed: 48/50 — compare to Apollo dashboard delta to compute credits/call

── Phase C: 15 unresolved companies (end-to-end through resolveCompanyUrl) ──
  [1/15] ✓ {company name} → https://www.linkedin.com/... (250ms)
  ... (more rows) ...
  resolved: 8/15 — these are now cached in CompanyUrl for future free hits

📊 Report: /abs/path/to/tests/company-url-benchmark-reports/apollo-shadow-<stamp>.md
👀 Phase B: manually adjudicate disagreements in the report above.
💰 Fill in Apollo dashboard delta in the report to validate cost per call.
```

If the script THROWS, do NOT commit anything further. Read the error, identify whether it's (a) a code bug in Task 1 (fix and amend, re-run) or (b) Apollo API/network issue (retry once; if still failing, open a blocker note in the report and stop).

- [ ] **Step 3: Check acceptance gates from terminal output.**

From the summary at the end:

- **Phase A agreement rate ≥ 65%** (pilot showed 81% — strong signal we'll pass).
- **Phase A avg latency < 1000ms** (pilot showed 206ms — strong signal we'll pass).
- **Phase C resolution rate ≥ 40%** (target: ≥ 6/15 resolved).

If any gate fails, STOP. Do not proceed to commit. Open a note in the report and escalate to the spec author.

- [ ] **Step 4: Record Apollo dashboard AFTER.**

Return to Apollo dashboard. Record the new credits-used number. Compute:

```
delta = after - before
credits_per_call = delta / billed_count  (from the terminal output's "billed: X/50" line, plus Phase C billed calls from report)
```

Expected: `credits_per_call ≈ 1.00 ± 0.1`. If materially different (e.g., 2 or 5), the $0.024 constant needs recalibration — file a follow-up ticket but do NOT block this swap on it.

- [ ] **Step 5: Open the markdown report.**

```bash
open tests/company-url-benchmark-reports/apollo-shadow-<stamp>.md
```

Fill in the "Cost Calibration" section at the bottom with the before/after/delta numbers you recorded.

- [ ] **Step 6: Complete Phase B manual adjudication.**

In the report's "Phase B — Manual Adjudication" section, for each disagreement row:

1. Click the cached URL. Does it land on a LinkedIn page for the intended company?
2. Click the Apollo URL. Does it land on a LinkedIn page for the intended company?
3. Check the corresponding verdict box: `apollo_right`, `cache_right`, or `both_wrong`.

Then fill in the adjudication tally and compute true Apollo accuracy.

**Time budget:** ~1–2 minutes per disagreement. If there are more than ~30 disagreements, that's itself a red flag — escalate to spec author.

- [ ] **Step 7: Commit the report.**

```bash
git add tests/company-url-benchmark-reports/apollo-shadow-*.md tests/company-url-benchmark-reports/apollo-shadow-*.json
git commit -m "$(cat <<'EOF'
test(report): Apollo resolver shadow-mode results

Phase A: {agree}/50 agree ({pct}%), avg {avg}ms — above 65% gate
Phase B: adjudicated — true accuracy {pct}%
Phase C: {resolved}/15 resolved ({pct}%) — above 40% gate
Cost calibration: {credits_per_call} credits/call observed (expected ~1.0)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Replace `{...}` placeholders with the actual numbers from the report before committing.

---

## Task 4: Clean up pilot validation script

**Files:**
- Delete: `tests/apollo-cost-validation.ts`

**Why:** The pilot script from before the plan (42-call cache-agreement run) is superseded by the shadow test. Deleting reduces drift between two scripts that validate the same thing.

- [ ] **Step 1: Delete pilot.**

```bash
git rm tests/apollo-cost-validation.ts
```

- [ ] **Step 2: Commit.**

```bash
git commit -m "$(cat <<'EOF'
chore: remove pilot Apollo cost-validation script

Superseded by tests/apollo-resolver-shadow.ts which does Phase A+B+C per spec.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Commit outstanding research + benchmark artifacts

**Files:**
- Already on disk but untracked:
  - `docs/linkedin-company-url-resolution-research.md`
  - `tests/company-url-resolution-benchmark.ts`
  - `tests/company-url-benchmark-reports/v2-report-2026-04-16T19-04-51-714Z.{md,json}`
  - `tests/company-url-benchmark-reports/v2-report-2026-04-16T19-14-47-265Z.{md,json}`
  - `tests/company-url-benchmark-reports/report-2026-04-11T21-37-50.137Z.md`
  - `docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md`
  - `docs/superpowers/plans/2026-04-16-apollo-company-resolver.md` (this file)

**Why:** These artifacts justify the swap and should live alongside the code change for future readers / rollback reviewers.

- [ ] **Step 1: Verify what's staged vs untracked.**

```bash
git status --porcelain | grep -E "company-url|apollo-company|company-resolver"
```

Expected: a mix of `??` (untracked) and nothing else — the `company-resolver.ts` change is already committed in Task 1.

- [ ] **Step 2: Stage and commit research artifacts.**

```bash
git add docs/linkedin-company-url-resolution-research.md \
        tests/company-url-resolution-benchmark.ts \
        tests/company-url-benchmark-reports/ \
        docs/superpowers/specs/2026-04-16-apollo-company-resolver-design.md \
        docs/superpowers/plans/2026-04-16-apollo-company-resolver.md

git commit -m "$(cat <<'EOF'
docs: Apollo resolver — research, spec, plan, and benchmark artifacts

- Research doc: 10-resolver benchmark comparing Sonnet, Apollo, Serper,
  Claude web search, Wikidata, Clearbit, HunterIO, Google Knowledge Graph,
  DuckDuckGo, and OpenCorporates. Apollo won on accuracy/latency/cost balance.
- Spec: shadow-mode swap design with billing-aware cost tracking.
- Plan: task-by-task implementation plan for the swap.
- Benchmark outputs: raw + markdown reports from the 25-company test sample.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification

**Files:** none

**Why:** Paranoia check. The swap is live in `main`, but we should verify no regressions in consumer code paths.

- [ ] **Step 1: Type-check from scratch.**

```bash
npx tsc --noEmit
```

Expected: Clean except for the pre-existing `OnboardingClient.tsx` apostrophe error noted in CLAUDE.md. No errors in `company-resolver.ts`, `search.ts`, or `ai-search.ts`.

- [ ] **Step 2: Smoke-test the production path via an existing test script.**

Run one of the existing tests that exercises the search flow (pick the fastest one that hits company resolution):

```bash
npm run test:db
```

Expected: Database connection test passes. This validates the Prisma client is still wired correctly after our import changes.

- [ ] **Step 3: Check the CompanyUrl table grew.**

```bash
npx tsx -e "
import 'dotenv/config';
import prisma from './src/lib/prisma';
(async () => {
  const n = await prisma.companyUrl.count();
  console.log('CompanyUrl row count:', n);
  await prisma.\$disconnect();
})();
"
```

Expected: `CompanyUrl row count: ~1692` (was 1684 pre-swap, +8 from Phase C if 8/15 resolved). Exact number depends on Phase C resolution rate.

- [ ] **Step 4: Final status summary.**

Write a 2–3 sentence summary to the terminal:

```
Apollo resolver swap deployed.
- Phase A: X/50 agreement ({pct}%)
- Phase C: X/15 newly resolved
- Cost: {actual_credits_per_call} credits/call (expected 1.0)
- Rollback: git revert {first-commit-sha}
```

---

## Self-Review Checklist

### Spec coverage audit

| Spec section | Task(s) | Notes |
|---|---|---|
| §2 Goals 1–3 (public API unchanged) | Task 1 Step 1, Task 1 Step 4 | Signatures preserved; `_context` retained |
| §2 Goal 4 (shadow test with Phases A/B/C) | Task 2, Task 3 | Full implementation |
| §2 Goal 5 (budget ≤ $1.60) | Task 3 Step 1+4 | Empirical cost calibration included |
| §2 Goal 6 (rollback = git revert) | Task 1 Step 5 | Single-file change committed separately |
| §3 Architecture (helper returns `{url, billed}`) | Task 1 Step 1 | Implemented |
| §4a helper signature + HTTP 200 billing | Task 1 Step 1 | Exact impl |
| §4b cost constant reuse | Task 1 Step 1 | Import from `cost-logger` |
| §4c `resolveCompanyUrl` changes | Task 1 Step 1 | Destructure + conditional cost |
| §4d import cleanup | Task 1 Step 1 | Anthropic SDK removed |
| §4e shadow test structure | Task 2 | Phases A + C automated, B rendered |
| §5 data flows (happy/cache/miss/error/missing-key) | Task 1 Step 1 | All 5 paths handled |
| §6 error handling table | Task 1 Step 1 | Matches table exactly |
| §7 acceptance criteria | Task 3 Step 3 | Gates checked |
| §8 risk: Apollo quota burn | Task 3 Step 4 | Dashboard delta recorded |
| §8 risk: silent wrong-URL caching | Deferred — future work | Called out in spec §8, not in this plan's scope |

All spec sections covered.

### Placeholder scan

- Commit messages in Task 3 Step 7 contain `{placeholder}` tokens. These are intentional — the implementer fills them in with actual numbers from the report. Flagged explicitly in the task description.
- No "TBD" / "TODO" / "implement later" language in any code block.
- All code blocks contain full runnable code.

### Type consistency

- `CompanyResolveResult` exported from Task 1, consumed by Task 2 (via imports). Shape matches spec §4a.
- `_findCompanyLinkedInUrlViaApollo` exported in Task 1, imported in Task 2 via exact name. Tilde-match verified.
- `{url: string | null, billed: boolean}` helper return is consistent across Task 1 Step 1 and Task 2 Step 1.
- `PhaseARow`/`PhaseCRow` types in Task 2 are local to that file, no cross-task dependencies.

---

## Execution notes

- Tasks 1 → 2 → 3 are strictly sequential (Task 2 imports from Task 1's exports; Task 3 runs Task 2's script).
- Tasks 4 and 5 can be done in any order after Task 3.
- Task 6 is the final verification gate.
- Total expected live API spend: ~$1.60 upper bound (45 Phase A + 15 Phase C billed calls at $0.024 conservative). Pilot at $1.01 already demonstrated the helper works; Phase A of the actual test may bring total project spend to ~$2.60 across all runs. Acceptable given spec §2 Goal 5.
