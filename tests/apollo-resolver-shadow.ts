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

  let report = `# Apollo Resolver Shadow Report

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

`;

  if (disagreements.length === 0) {
    report += `_No disagreements — skip Phase B._`;
  } else {
    report += `Review each row. Click both URLs, decide which points to the correct company on LinkedIn.

| # | Name | Cached URL | Apollo URL | Verdict |
|---|---|---|---|---|
`;
    for (let i = 0; i < disagreements.length; i++) {
      const r = disagreements[i];
      report += `| ${i + 1} | ${r.name} | [${r.cachedUrl}](${r.cachedUrl}) | [${r.apolloUrl}](${r.apolloUrl}) | ☐ apollo_right ☐ cache_right ☐ both_wrong |\n`;
    }

    report += `\n### Apollo nulls (Apollo couldn't find)\n\n`;
    if (apolloNulls.length === 0) {
      report += `_None._`;
    } else {
      for (const r of apolloNulls) {
        report += `- **${r.name}** — cached: [${r.cachedUrl}](${r.cachedUrl})\n`;
      }
    }

    report += `\n### Adjudication tally (fill in after review)\n\n- apollo_right: ___\n- cache_right: ___\n- both_wrong: ___\n- **True Apollo accuracy** = (agree + apollo_right) / (agree + disagree + apollo_null) = ___%`;
  }

  report += `\n\n---\n\n## Phase C — Fresh-Eyes on Unresolved Backlog (15 rows)\n\n| # | Name | Apollo URL | Cost | Latency |\n|---|---|---|---|---|\n`;

  for (let i = 0; i < phaseC.length; i++) {
    const r = phaseC[i];
    const urlCell = r.apolloUrl ? `[${r.apolloUrl}](${r.apolloUrl})` : '_null_';
    report += `| ${i + 1} | ${r.name} | ${urlCell} | ${r.costCents.toFixed(2)}¢ | ${r.elapsed}ms |\n`;
  }

  report += `\n**Resolved:** ${phaseCResolved}/15 (${((phaseCResolved / 15) * 100).toFixed(1)}%)

### Acceptance gate

- Resolution rate ≥ 40%: ${(phaseCResolved / 15) * 100 >= 40 ? '✅ PASS' : '❌ FAIL'} (${((phaseCResolved / 15) * 100).toFixed(1)}%)

---

## Cost Calibration (fill in after run)

1. Apollo dashboard credits BEFORE: _____
2. Apollo dashboard credits AFTER: _____
3. Delta: _____
4. Billed calls this run: ${billed + phaseC.filter((r) => r.costCents > 0).length}
5. Credits per call = delta / billed = _____ (expect 1.00 ± 0.1)
6. If ≠ 1, file follow-up to re-calibrate \`APOLLO_COST_PER_LOOKUP\`
`;

  return report;
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
