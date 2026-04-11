/**
 * Test: Validate the proposed dynamic role threshold against REAL Person.role
 *       strings from the DB — including the leaky LinkedIn headlines that
 *       motivated the whole exercise.
 *
 * This closes the loop on the benchmark that used only clean titles:
 *   1. Pull a sample of real Person.role strings, grouped into buckets
 *      (clean short titles, mid-length, long headline-style).
 *   2. Pick a set of realistic queries covering NARROW / STANDARD / BROAD / SKILL.
 *   3. For each query, classify it via getRoleThreshold() and compute the
 *      threshold that would actually be applied.
 *   4. Embed every query and every sampled role, compute distances, and
 *      report: what percentage of real DB rows would each query return
 *      at the dynamic threshold vs. the static 0.35?
 *   5. Spot-check the long LinkedIn headlines (the IBM leak case) — do
 *      they get blocked at the proposed thresholds?
 *
 * Also unit-tests getRoleThreshold() on ~25 realistic query strings so we
 * know the classifier picks the right bucket before trusting the numbers.
 *
 * Run: npx tsx tests/test-role-threshold-realworld.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { generateRoleEmbeddings } from '../src/lib/services/embeddings';

const prisma = new PrismaClient();

// ──────────────────────────────────────────────────────────────────────────
// Candidate classifier — the function we'd ship.
// ──────────────────────────────────────────────────────────────────────────
interface LinkedInFiltersShape {
  searchQuery?: string;
  currentJobTitles?: string[];
  functionIds?: string[];
}

type Class = 'NARROW' | 'STANDARD' | 'BROAD' | 'SKILL';

const BROAD_DISCIPLINES =
  /^(engineers?|developers?|designers?|scientists?|analysts?|managers?|consultants?|researchers?)$/i;

const NARROW_MARKERS =
  /\b(quant(itative)?|reliability|embedded|firmware|vlsi|asic|ios|android|cryptograph(y|ic)|sre|nlp|rf|pcb|actuar(y|ial))\b/i;

function classifyRole(
  role: string | undefined,
  lf: LinkedInFiltersShape
): { cls: Class; threshold: number | null } {
  // SKILL: skill-only query (searchQuery present, no specific title)
  if (lf.searchQuery && !lf.currentJobTitles?.length) {
    return { cls: 'SKILL', threshold: null };
  }
  if (!role || !role.trim()) return { cls: 'STANDARD', threshold: 0.40 };
  const r = role.trim();
  const words = r.split(/\s+/);

  // BROAD: single discipline noun
  if (words.length === 1 && BROAD_DISCIPLINES.test(r)) {
    return { cls: 'BROAD', threshold: 0.50 };
  }

  // NARROW: niche markers OR 4+ words (3 words = "Senior Software Engineer" = standard)
  if (NARROW_MARKERS.test(r) || words.length >= 4) {
    return { cls: 'NARROW', threshold: 0.25 };
  }

  // STANDARD: everything else
  return { cls: 'STANDARD', threshold: 0.40 };
}

// Unit-normalized OpenAI vectors → cos dist = 1 - dot (matches pgvector `<=>`)
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

// ──────────────────────────────────────────────────────────────────────────
// Unit tests for the classifier — make sure real-looking inputs route right
// ──────────────────────────────────────────────────────────────────────────
interface ClassifierCase {
  name: string;
  role?: string;
  lf: LinkedInFiltersShape;
  expect: Class;
}

const CLASSIFIER_CASES: ClassifierCase[] = [
  // BROAD
  { name: 'engineers at IBM', role: 'Engineer', lf: { currentJobTitles: [] }, expect: 'BROAD' },
  { name: 'designers at Figma', role: 'Designer', lf: { currentJobTitles: [] }, expect: 'BROAD' },
  { name: 'scientists', role: 'Scientist', lf: {}, expect: 'BROAD' },
  { name: 'analysts', role: 'Analyst', lf: {}, expect: 'BROAD' },

  // STANDARD
  { name: 'SWE', role: 'Software Engineer', lf: { currentJobTitles: ['Software Engineer'] }, expect: 'STANDARD' },
  { name: 'PM', role: 'Product Manager', lf: { currentJobTitles: ['Product Manager'] }, expect: 'STANDARD' },
  { name: 'DS', role: 'Data Scientist', lf: { currentJobTitles: ['Data Scientist'] }, expect: 'STANDARD' },
  { name: 'Senior SWE', role: 'Senior Software Engineer', lf: { currentJobTitles: ['Senior Software Engineer'] }, expect: 'STANDARD' },
  { name: 'Backend Eng', role: 'Backend Engineer', lf: {}, expect: 'STANDARD' },
  { name: 'Prod Designer', role: 'Product Designer', lf: {}, expect: 'STANDARD' },

  // NARROW — niche markers
  { name: 'Quant Researcher', role: 'Quantitative Researcher', lf: { currentJobTitles: ['Quantitative Researcher'] }, expect: 'NARROW' },
  { name: 'SRE', role: 'Site Reliability Engineer', lf: { currentJobTitles: ['Site Reliability Engineer'] }, expect: 'NARROW' },
  { name: 'iOS Dev', role: 'iOS Developer', lf: { currentJobTitles: ['iOS Developer'] }, expect: 'NARROW' },
  { name: 'Android Dev', role: 'Android Developer', lf: { currentJobTitles: ['Android Developer'] }, expect: 'NARROW' },
  { name: 'Embedded Eng', role: 'Embedded Software Engineer', lf: {}, expect: 'NARROW' },
  { name: 'VLSI', role: 'VLSI Engineer', lf: {}, expect: 'NARROW' },
  { name: 'Firmware', role: 'Firmware Engineer', lf: {}, expect: 'NARROW' },

  // NARROW — word count
  { name: 'IB Analyst', role: 'Investment Banking Analyst', lf: {}, expect: 'STANDARD' }, // 3 words = standard
  { name: 'Staff SWE II', role: 'Staff Software Engineer II', lf: {}, expect: 'NARROW' }, // 4 words
  { name: 'Principal ML Eng', role: 'Principal Machine Learning Engineer', lf: {}, expect: 'NARROW' }, // 4 words

  // SKILL
  { name: 'payments infra', role: undefined, lf: { searchQuery: 'payments infrastructure' }, expect: 'SKILL' },
  { name: 'LLM inference', role: undefined, lf: { searchQuery: 'LLM inference' }, expect: 'SKILL' },
  { name: 'skill + no title', role: 'engineer working on rust', lf: { searchQuery: 'rust' }, expect: 'SKILL' },

  // Edge — searchQuery + title → title wins (use its threshold)
  { name: 'SWE + rust skill', role: 'Software Engineer', lf: { searchQuery: 'rust', currentJobTitles: ['Software Engineer'] }, expect: 'STANDARD' },
];

function runClassifierTests(): { passed: number; failed: number; failures: ClassifierCase[] } {
  console.log('── Unit test: classifyRole() ──');
  let passed = 0;
  let failed = 0;
  const failures: ClassifierCase[] = [];
  for (const tc of CLASSIFIER_CASES) {
    const got = classifyRole(tc.role, tc.lf);
    if (got.cls === tc.expect) {
      passed++;
      console.log(`  PASS  [${got.cls}] ${tc.name} (threshold=${got.threshold})`);
    } else {
      failed++;
      failures.push(tc);
      console.log(`  FAIL  expected=${tc.expect} got=${got.cls}  ${tc.name} role="${tc.role}"`);
    }
  }
  console.log(`  → ${passed}/${CLASSIFIER_CASES.length} passed\n`);
  return { passed, failed, failures };
}

// ──────────────────────────────────────────────────────────────────────────
// Real-world test: sample real Person.role strings and check how they
// behave under the dynamic threshold vs the static 0.35.
// ──────────────────────────────────────────────────────────────────────────
interface Query {
  name: string;     // short label for the log
  role: string;     // string we embed and compare to
  lf: LinkedInFiltersShape;
}

const QUERIES: Query[] = [
  // BROAD — biggest expected win
  { name: 'engineers', role: 'Engineer', lf: {} },
  { name: 'designers', role: 'Designer', lf: {} },

  // STANDARD
  { name: 'software engineer', role: 'Software Engineer', lf: { currentJobTitles: ['Software Engineer'] } },
  { name: 'product manager', role: 'Product Manager', lf: { currentJobTitles: ['Product Manager'] } },
  { name: 'data scientist', role: 'Data Scientist', lf: { currentJobTitles: ['Data Scientist'] } },

  // NARROW
  { name: 'iOS developer', role: 'iOS Developer', lf: { currentJobTitles: ['iOS Developer'] } },
  { name: 'SRE', role: 'Site Reliability Engineer', lf: { currentJobTitles: ['Site Reliability Engineer'] } },
];

async function main() {
  console.log('=== Real-World Dynamic Threshold Validation ===\n');

  // ─── Step 1: classifier unit tests ───
  const clsResult = runClassifierTests();
  if (clsResult.failed > 0) {
    console.error(`CLASSIFIER HAS BUGS — ${clsResult.failed} cases failed. Review before trusting real-world numbers.\n`);
  }

  // ─── Step 2: sample real Person.role strings ───
  console.log('── Sampling real Person.role strings from DB ──');

  // Short clean titles
  const cleanShort = await prisma.$queryRaw<Array<{ role: string; cnt: bigint }>>`
    SELECT role, COUNT(*) as cnt
    FROM "Person"
    WHERE role IS NOT NULL
      AND length(role) <= 40
      AND role NOT ILIKE '%|%'
      AND role NOT ILIKE '%·%'
    GROUP BY role
    ORDER BY cnt DESC
    LIMIT 40
  `;
  console.log(`  clean short (<=40 chars, no pipes): ${cleanShort.length} distinct`);

  // Medium titles
  const medium = await prisma.$queryRaw<Array<{ role: string; cnt: bigint }>>`
    SELECT role, COUNT(*) as cnt
    FROM "Person"
    WHERE role IS NOT NULL
      AND length(role) BETWEEN 41 AND 80
    GROUP BY role
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log(`  medium (41-80 chars): ${medium.length} distinct`);

  // Long LinkedIn-headline style
  const longHeadlines = await prisma.$queryRaw<Array<{ role: string; cnt: bigint }>>`
    SELECT role, COUNT(*) as cnt
    FROM "Person"
    WHERE role IS NOT NULL
      AND length(role) > 80
    GROUP BY role
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log(`  long headlines (>80 chars): ${longHeadlines.length} distinct`);

  const sampledRoles = [
    ...cleanShort.map(r => ({ role: r.role, bucket: 'short' as const, cnt: Number(r.cnt) })),
    ...medium.map(r => ({ role: r.role, bucket: 'medium' as const, cnt: Number(r.cnt) })),
    ...longHeadlines.map(r => ({ role: r.role, bucket: 'long' as const, cnt: Number(r.cnt) })),
  ];
  console.log(`  total sampled: ${sampledRoles.length}\n`);

  if (sampledRoles.length === 0) {
    console.error('DB is empty — seed some Person rows first or run a live search');
    await prisma.$disconnect();
    process.exit(1);
  }

  // ─── Step 3: embed everything in batch ───
  const allStrings = new Set<string>();
  for (const q of QUERIES) allStrings.add(q.role);
  for (const r of sampledRoles) allStrings.add(r.role);

  console.log(`── Embedding ${allStrings.size} distinct strings ──`);
  const t0 = Date.now();
  const embeddings = await generateRoleEmbeddings(Array.from(allStrings));
  console.log(`  done in ${Date.now() - t0}ms\n`);

  // ─── Step 4: for each query, compute distances to every sampled role ───
  interface Row {
    role: string;
    bucket: 'short' | 'medium' | 'long';
    cnt: number;
    dist: number;
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Per-query comparison: static 0.35 vs dynamic threshold');
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const q of QUERIES) {
    const { cls, threshold } = classifyRole(q.role, q.lf);
    const qEmb = embeddings.get(q.role);
    if (!qEmb) {
      console.log(`  [SKIP] no embedding for "${q.role}"`);
      continue;
    }

    const rows: Row[] = sampledRoles
      .map(r => {
        const rEmb = embeddings.get(r.role);
        if (!rEmb) return null;
        return { role: r.role, bucket: r.bucket, cnt: r.cnt, dist: cosineDistance(qEmb, rEmb) };
      })
      .filter((r): r is Row => r !== null)
      .sort((a, b) => a.dist - b.dist);

    const passStatic = rows.filter(r => r.dist <= 0.35);
    const passDynamic =
      threshold === null ? rows : rows.filter(r => r.dist <= threshold);

    console.log(`── Query "${q.name}"  [${cls}]  dynamic=${threshold === null ? 'SKIP' : threshold.toFixed(2)} ──`);
    console.log(`   Static 0.35:    ${passStatic.length}/${rows.length} rows pass`);
    console.log(
      `   Dynamic ${threshold === null ? 'SKIP' : threshold.toFixed(2)}: ${passDynamic.length}/${rows.length} rows pass  (${
        threshold === null
          ? 'role gate disabled'
          : passDynamic.length > passStatic.length
          ? `+${passDynamic.length - passStatic.length} more`
          : passDynamic.length < passStatic.length
          ? `${passDynamic.length - passStatic.length} fewer`
          : 'same'
      })`
    );

    // Show top 5 passing under each
    console.log('   Top 5 under static 0.35:');
    for (const r of passStatic.slice(0, 5)) {
      console.log(`     d=${r.dist.toFixed(3)}  [${r.bucket}]  ${r.role.slice(0, 70)}${r.role.length > 70 ? '…' : ''}`);
    }
    console.log(`   Top 5 under dynamic ${threshold === null ? 'SKIP' : threshold.toFixed(2)}:`);
    for (const r of passDynamic.slice(0, 5)) {
      console.log(`     d=${r.dist.toFixed(3)}  [${r.bucket}]  ${r.role.slice(0, 70)}${r.role.length > 70 ? '…' : ''}`);
    }

    // Which rows does dynamic add beyond static?
    const addedIds = new Set(passStatic.map(r => r.role));
    const added = passDynamic.filter(r => !addedIds.has(r.role));
    if (added.length > 0) {
      console.log(`   Added by dynamic (${added.length}):`);
      for (const r of added.slice(0, 10)) {
        const risky = r.bucket === 'long' ? ' ⚠ LONG' : '';
        console.log(`     d=${r.dist.toFixed(3)}  [${r.bucket}]${risky}  ${r.role.slice(0, 70)}${r.role.length > 70 ? '…' : ''}`);
      }
      if (added.length > 10) console.log(`     ... ${added.length - 10} more`);
    }
    console.log('');
  }

  // ─── Step 5: spot-check the long headlines specifically ───
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Leaky-headline spot-check vs "Software Engineer"');
  console.log('══════════════════════════════════════════════════════════════');
  const sweEmb = embeddings.get('Software Engineer');
  if (sweEmb && longHeadlines.length > 0) {
    const scored = longHeadlines
      .map(h => {
        const e = embeddings.get(h.role);
        if (!e) return null;
        return { role: h.role, dist: cosineDistance(sweEmb, e) };
      })
      .filter((r): r is { role: string; dist: number } => r !== null)
      .sort((a, b) => a.dist - b.dist);

    console.log(`  ${scored.length} long headlines scored. Counts leaking past each threshold:`);
    for (const t of [0.25, 0.30, 0.35, 0.40, 0.45, 0.50]) {
      const n = scored.filter(r => r.dist <= t).length;
      console.log(`    t=${t.toFixed(2)}: ${n} leak${n === 1 ? '' : 's'} past`);
    }
    console.log('\n  Closest (most likely to leak):');
    for (const r of scored.slice(0, 10)) {
      console.log(`    d=${r.dist.toFixed(3)}  ${r.role.slice(0, 90)}${r.role.length > 90 ? '…' : ''}`);
    }
    console.log('\n  Farthest (safe):');
    for (const r of scored.slice(-5)) {
      console.log(`    d=${r.dist.toFixed(3)}  ${r.role.slice(0, 90)}${r.role.length > 90 ? '…' : ''}`);
    }
  }
  console.log('');

  await prisma.$disconnect();
  process.exit(clsResult.failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Test crashed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
