/**
 * Test: Calibrate a dynamic role-embedding threshold based on query specificity.
 *
 * Context:
 *   The static 0.35 threshold in person-service.ts is extremely conservative:
 *   100% precision on clean titles but 40% recall loss. Since the new pipeline
 *   does strict title filtering at Apify (current_job_titles), the DB-side
 *   threshold is now a safety net rather than the primary role filter — we can
 *   afford to relax it to recover recall, and relax it MORE when the LLM
 *   query is itself vague.
 *
 * Approach:
 *   Classify every (query, candidate) pair into one of four specificity
 *   classes that mirror what the LLM produces in ParsedFilters:
 *
 *   - NARROW    : highly specific title (e.g. "Quantitative Researcher",
 *                 "Site Reliability Engineer", "iOS Developer"). LLM would
 *                 emit currentJobTitles=[one specific title]. Threshold
 *                 should stay TIGHT — user wants exactly that title.
 *
 *   - STANDARD  : common, well-defined title (e.g. "Software Engineer",
 *                 "Product Manager"). LLM emits currentJobTitles=[title].
 *                 Moderate threshold — include obvious variants like
 *                 "Senior Software Engineer", "iOS Developer" while still
 *                 blocking "Mechanical Engineer".
 *
 *   - BROAD     : discipline-level noun (e.g. "Engineer", "Designer",
 *                 "Scientist"). LLM typically emits functionIds rather
 *                 than currentJobTitles. Loose threshold — we WANT the
 *                 full discipline to match.
 *
 *   - SKILL     : keyword / skill query (e.g. "payments infrastructure",
 *                 "LLM inference"). LLM emits searchQuery, no titles.
 *                 Very loose or no threshold — the role embedding shouldn't
 *                 be the gatekeeper; the keyword filter does that work.
 *
 * For each class we:
 *   1. Generate embeddings for the query + all labeled candidates
 *   2. Sweep thresholds 0.20 → 0.60 step 0.05
 *   3. Compute TP/FP/FN/TN, precision, recall, F1
 *   4. Report:
 *       - best-F1 threshold
 *       - best threshold with precision ≥ 0.90 ("safe recall")
 *       - best threshold with precision ≥ 0.95 ("strict")
 *
 * Then print a proposed dynamic rule grounded in the numbers.
 *
 * Run: npx tsx tests/test-role-threshold-dynamic.ts
 */

import 'dotenv/config';
import { generateRoleEmbeddings } from '../src/lib/services/embeddings';

type Class = 'NARROW' | 'STANDARD' | 'BROAD' | 'SKILL';
type Label = 'MATCH' | 'MISS';

interface Candidate {
  title: string;
  expected: Label;
}

interface QueryCase {
  query: string;           // string passed to embed (what the DB filter sees)
  cls: Class;
  candidates: Candidate[];
}

// Unit-normalized vectors from text-embedding-3-small → distance = 1 - dot,
// matching pgvector's `<=>` operator exactly.
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

// ──────────────────────────────────────────────────────────────────────────
// NARROW: specific titles. User wants exactly this niche — no broadenings.
// ──────────────────────────────────────────────────────────────────────────
const NARROW_CASES: QueryCase[] = [
  {
    query: 'Quantitative Researcher',
    cls: 'NARROW',
    candidates: [
      { title: 'Quantitative Researcher', expected: 'MATCH' },
      { title: 'Senior Quantitative Researcher', expected: 'MATCH' },
      { title: 'Quant Researcher', expected: 'MATCH' },
      { title: 'Quantitative Trader', expected: 'MISS' },
      { title: 'Quantitative Analyst', expected: 'MISS' },
      { title: 'Data Scientist', expected: 'MISS' },
      { title: 'Research Scientist', expected: 'MISS' },
      { title: 'Machine Learning Researcher', expected: 'MISS' },
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Financial Analyst', expected: 'MISS' },
    ],
  },
  {
    query: 'Site Reliability Engineer',
    cls: 'NARROW',
    candidates: [
      { title: 'Site Reliability Engineer', expected: 'MATCH' },
      { title: 'Senior Site Reliability Engineer', expected: 'MATCH' },
      { title: 'SRE', expected: 'MATCH' },
      { title: 'DevOps Engineer', expected: 'MISS' },       // related but distinct
      { title: 'Platform Engineer', expected: 'MISS' },      // related but distinct
      { title: 'Infrastructure Engineer', expected: 'MISS' },
      { title: 'Cloud Engineer', expected: 'MISS' },
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Network Engineer', expected: 'MISS' },
      { title: 'Systems Administrator', expected: 'MISS' },
    ],
  },
  {
    query: 'iOS Developer',
    cls: 'NARROW',
    candidates: [
      { title: 'iOS Developer', expected: 'MATCH' },
      { title: 'Senior iOS Developer', expected: 'MATCH' },
      { title: 'iOS Engineer', expected: 'MATCH' },
      { title: 'iOS Software Engineer', expected: 'MATCH' },
      { title: 'Android Developer', expected: 'MISS' },
      { title: 'Mobile Engineer', expected: 'MISS' },       // too broad
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Frontend Engineer', expected: 'MISS' },
      { title: 'Full Stack Developer', expected: 'MISS' },
    ],
  },
  {
    query: 'Investment Banking Analyst',
    cls: 'NARROW',
    candidates: [
      { title: 'Investment Banking Analyst', expected: 'MATCH' },
      { title: 'IB Analyst', expected: 'MATCH' },
      { title: 'Investment Banking Associate', expected: 'MATCH' },
      { title: 'Equity Research Analyst', expected: 'MISS' },
      { title: 'Private Equity Associate', expected: 'MISS' },
      { title: 'Financial Analyst', expected: 'MISS' },
      { title: 'Corporate Finance Analyst', expected: 'MISS' },
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Management Consultant', expected: 'MISS' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// STANDARD: common titles. Want obvious variants but not cross-discipline.
// ──────────────────────────────────────────────────────────────────────────
const STANDARD_CASES: QueryCase[] = [
  {
    query: 'Software Engineer',
    cls: 'STANDARD',
    candidates: [
      { title: 'Software Engineer', expected: 'MATCH' },
      { title: 'Senior Software Engineer', expected: 'MATCH' },
      { title: 'Staff Software Engineer', expected: 'MATCH' },
      { title: 'Software Engineer II', expected: 'MATCH' },
      { title: 'Software Developer', expected: 'MATCH' },
      { title: 'Backend Engineer', expected: 'MATCH' },
      { title: 'Frontend Engineer', expected: 'MATCH' },
      { title: 'Full Stack Engineer', expected: 'MATCH' },
      { title: 'Full Stack Developer', expected: 'MATCH' },
      { title: 'Platform Engineer', expected: 'MATCH' },
      { title: 'iOS Developer', expected: 'MATCH' },
      { title: 'Android Developer', expected: 'MATCH' },
      { title: 'Site Reliability Engineer', expected: 'MATCH' },
      { title: 'DevOps Engineer', expected: 'MATCH' },
      // Misses — cross-discipline
      { title: 'Mechanical Engineer', expected: 'MISS' },
      { title: 'Civil Engineer', expected: 'MISS' },
      { title: 'Hardware Engineer', expected: 'MISS' },
      { title: 'Sales Engineer', expected: 'MISS' },
      { title: 'Solutions Architect', expected: 'MISS' },
      { title: 'Engineering Manager', expected: 'MISS' },
      { title: 'CTO', expected: 'MISS' },
      { title: 'Technology Strategy & Digital Transformation Executive | CTO | AI | Cloud | IBM Client Engineering', expected: 'MISS' },
      { title: 'Product Manager', expected: 'MISS' },
      { title: 'Data Scientist', expected: 'MISS' },
      { title: 'Technical Recruiter', expected: 'MISS' },
    ],
  },
  {
    query: 'Product Manager',
    cls: 'STANDARD',
    candidates: [
      { title: 'Product Manager', expected: 'MATCH' },
      { title: 'Senior Product Manager', expected: 'MATCH' },
      { title: 'Principal Product Manager', expected: 'MATCH' },
      { title: 'Associate Product Manager', expected: 'MATCH' },
      { title: 'Group Product Manager', expected: 'MATCH' },
      { title: 'Technical Product Manager', expected: 'MATCH' },
      { title: 'Product Owner', expected: 'MATCH' },
      // Misses
      { title: 'Product Marketing Manager', expected: 'MISS' },
      { title: 'Project Manager', expected: 'MISS' },
      { title: 'Program Manager', expected: 'MISS' },
      { title: 'Engineering Manager', expected: 'MISS' },
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Operations Manager', expected: 'MISS' },
      { title: 'Marketing Manager', expected: 'MISS' },
    ],
  },
  {
    query: 'Data Scientist',
    cls: 'STANDARD',
    candidates: [
      { title: 'Data Scientist', expected: 'MATCH' },
      { title: 'Senior Data Scientist', expected: 'MATCH' },
      { title: 'Applied Scientist', expected: 'MATCH' },
      { title: 'Machine Learning Engineer', expected: 'MATCH' },
      { title: 'Research Scientist', expected: 'MATCH' },
      { title: 'ML Engineer', expected: 'MATCH' },
      // Misses
      { title: 'Data Engineer', expected: 'MISS' },            // related but distinct
      { title: 'Data Analyst', expected: 'MISS' },             // less rigorous
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Product Manager', expected: 'MISS' },
      { title: 'Financial Analyst', expected: 'MISS' },
    ],
  },
  {
    query: 'Product Designer',
    cls: 'STANDARD',
    candidates: [
      { title: 'Product Designer', expected: 'MATCH' },
      { title: 'Senior Product Designer', expected: 'MATCH' },
      { title: 'UX Designer', expected: 'MATCH' },
      { title: 'UI/UX Designer', expected: 'MATCH' },
      { title: 'Interaction Designer', expected: 'MATCH' },
      // Misses
      { title: 'Graphic Designer', expected: 'MISS' },
      { title: 'Visual Designer', expected: 'MISS' },
      { title: 'Industrial Designer', expected: 'MISS' },
      { title: 'Frontend Engineer', expected: 'MISS' },
      { title: 'Product Manager', expected: 'MISS' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// BROAD: discipline words. Want the whole discipline — be generous.
// ──────────────────────────────────────────────────────────────────────────
const BROAD_CASES: QueryCase[] = [
  {
    query: 'Engineer',
    cls: 'BROAD',
    candidates: [
      { title: 'Software Engineer', expected: 'MATCH' },
      { title: 'Senior Software Engineer', expected: 'MATCH' },
      { title: 'Mechanical Engineer', expected: 'MATCH' },
      { title: 'Electrical Engineer', expected: 'MATCH' },
      { title: 'Hardware Engineer', expected: 'MATCH' },
      { title: 'Platform Engineer', expected: 'MATCH' },
      { title: 'DevOps Engineer', expected: 'MATCH' },
      { title: 'Chemical Engineer', expected: 'MATCH' },
      { title: 'Civil Engineer', expected: 'MATCH' },
      // Misses — managers and non-engineers
      { title: 'Product Manager', expected: 'MISS' },
      { title: 'Marketing Manager', expected: 'MISS' },
      { title: 'Recruiter', expected: 'MISS' },
      { title: 'UX Designer', expected: 'MISS' },
      { title: 'Lawyer', expected: 'MISS' },
    ],
  },
  {
    query: 'Designer',
    cls: 'BROAD',
    candidates: [
      { title: 'Product Designer', expected: 'MATCH' },
      { title: 'UX Designer', expected: 'MATCH' },
      { title: 'Graphic Designer', expected: 'MATCH' },
      { title: 'Interaction Designer', expected: 'MATCH' },
      { title: 'Visual Designer', expected: 'MATCH' },
      { title: 'Industrial Designer', expected: 'MATCH' },
      { title: 'Creative Director', expected: 'MATCH' },
      // Misses
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Product Manager', expected: 'MISS' },
      { title: 'Marketing Manager', expected: 'MISS' },
    ],
  },
  {
    query: 'Scientist',
    cls: 'BROAD',
    candidates: [
      { title: 'Data Scientist', expected: 'MATCH' },
      { title: 'Research Scientist', expected: 'MATCH' },
      { title: 'Applied Scientist', expected: 'MATCH' },
      { title: 'Biologist', expected: 'MATCH' },
      { title: 'Chemist', expected: 'MATCH' },
      { title: 'Physicist', expected: 'MATCH' },
      { title: 'Machine Learning Researcher', expected: 'MATCH' },
      // Misses
      { title: 'Software Engineer', expected: 'MISS' },
      { title: 'Product Manager', expected: 'MISS' },
      { title: 'Recruiter', expected: 'MISS' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// SKILL: keyword / skill queries. No role title — embedding gate shouldn't
// be the filter (Apify searchQuery does the keyword work). We score these
// to see what threshold is even coherent.
// ──────────────────────────────────────────────────────────────────────────
const SKILL_CASES: QueryCase[] = [
  {
    query: 'payments infrastructure',
    cls: 'SKILL',
    candidates: [
      { title: 'Software Engineer', expected: 'MATCH' },             // could be on payments
      { title: 'Staff Software Engineer', expected: 'MATCH' },
      { title: 'Platform Engineer', expected: 'MATCH' },
      { title: 'Backend Engineer', expected: 'MATCH' },
      { title: 'Infrastructure Engineer', expected: 'MATCH' },
      { title: 'Engineering Manager', expected: 'MATCH' },
      { title: 'Product Manager', expected: 'MATCH' },               // PMs for payments exist
      // Misses — clearly unrelated disciplines
      { title: 'Mechanical Engineer', expected: 'MISS' },
      { title: 'Recruiter', expected: 'MISS' },
      { title: 'Graphic Designer', expected: 'MISS' },
      { title: 'Lawyer', expected: 'MISS' },
    ],
  },
  {
    query: 'LLM inference',
    cls: 'SKILL',
    candidates: [
      { title: 'Machine Learning Engineer', expected: 'MATCH' },
      { title: 'ML Engineer', expected: 'MATCH' },
      { title: 'Research Engineer', expected: 'MATCH' },
      { title: 'Research Scientist', expected: 'MATCH' },
      { title: 'Software Engineer', expected: 'MATCH' },
      { title: 'Applied Scientist', expected: 'MATCH' },
      // Misses
      { title: 'Mechanical Engineer', expected: 'MISS' },
      { title: 'Civil Engineer', expected: 'MISS' },
      { title: 'Recruiter', expected: 'MISS' },
      { title: 'Marketing Manager', expected: 'MISS' },
    ],
  },
];

const ALL_CASES: QueryCase[] = [
  ...NARROW_CASES,
  ...STANDARD_CASES,
  ...BROAD_CASES,
  ...SKILL_CASES,
];

const THRESHOLDS = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60];

interface Stats {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

function newStats(): Stats {
  return { tp: 0, fp: 0, tn: 0, fn: 0 };
}

function score(stats: Stats) {
  const { tp, fp, tn, fn } = stats;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, tn, fn };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  console.log('=== Dynamic Role-Embedding Threshold Calibration ===\n');

  // Batch-embed every distinct string
  const strings = new Set<string>();
  for (const qc of ALL_CASES) {
    strings.add(qc.query);
    for (const c of qc.candidates) strings.add(c.title);
  }
  console.log(`Embedding ${strings.size} distinct strings via OpenAI...`);
  const t0 = Date.now();
  const embeddings = await generateRoleEmbeddings(Array.from(strings));
  console.log(`  done in ${Date.now() - t0}ms\n`);

  if (embeddings.size === 0) {
    console.error('No embeddings returned — is OPENAI_API_KEY set?');
    process.exit(1);
  }

  // Compute distances per (query, candidate) pair, grouped by class
  interface Pair {
    cls: Class;
    query: string;
    title: string;
    expected: Label;
    dist: number;
  }
  const pairs: Pair[] = [];
  for (const qc of ALL_CASES) {
    const qEmb = embeddings.get(qc.query);
    if (!qEmb) continue;
    for (const c of qc.candidates) {
      const cEmb = embeddings.get(c.title);
      if (!cEmb) continue;
      pairs.push({
        cls: qc.cls,
        query: qc.query,
        title: c.title,
        expected: c.expected,
        dist: cosineDistance(qEmb, cEmb),
      });
    }
  }

  // ── Per-class threshold sweep ──
  const classes: Class[] = ['NARROW', 'STANDARD', 'BROAD', 'SKILL'];

  interface Recommendation {
    cls: Class;
    bestF1: { t: number; f1: number; precision: number; recall: number };
    safe90: { t: number; precision: number; recall: number } | null;  // precision >= 0.90
    strict95: { t: number; precision: number; recall: number } | null; // precision >= 0.95
  }
  const recommendations: Recommendation[] = [];

  for (const cls of classes) {
    const classPairs = pairs.filter(p => p.cls === cls);
    const positives = classPairs.filter(p => p.expected === 'MATCH').length;
    const negatives = classPairs.filter(p => p.expected === 'MISS').length;

    console.log(`── ${cls}  (${classPairs.length} pairs: ${positives} MATCH, ${negatives} MISS) ──`);
    console.log(
      `  ${pad('threshold', 11)}${pad('TP', 5)}${pad('FP', 5)}${pad('TN', 5)}${pad('FN', 5)}${pad('precision', 11)}${pad('recall', 9)}${pad('F1', 8)}`
    );
    console.log(`  ${'-'.repeat(58)}`);

    let bestF1 = { t: 0, f1: -1, precision: 0, recall: 0 };
    let safe90: Recommendation['safe90'] = null;   // loosest with precision >= 0.90
    let strict95: Recommendation['strict95'] = null; // loosest with precision >= 0.95

    for (const t of THRESHOLDS) {
      const s = newStats();
      for (const p of classPairs) {
        const passes = p.dist <= t;
        if (passes && p.expected === 'MATCH') s.tp++;
        else if (passes && p.expected === 'MISS') s.fp++;
        else if (!passes && p.expected === 'MISS') s.tn++;
        else s.fn++;
      }
      const { precision, recall, f1, tp, fp, tn, fn } = score(s);
      console.log(
        `  ${pad(t.toFixed(2), 11)}${pad(String(tp), 5)}${pad(String(fp), 5)}${pad(String(tn), 5)}${pad(String(fn), 5)}${pad(precision.toFixed(3), 11)}${pad(recall.toFixed(3), 9)}${pad(f1.toFixed(3), 8)}`
      );

      if (f1 > bestF1.f1) bestF1 = { t, f1, precision, recall };
      if (precision >= 0.90) safe90 = { t, precision, recall };
      if (precision >= 0.95) strict95 = { t, precision, recall };
    }

    recommendations.push({ cls, bestF1, safe90, strict95 });
    console.log('');
  }

  // ── Summary + proposed dynamic rule ──
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Proposed thresholds (safe-recall, precision ≥ 0.90)');
  console.log('══════════════════════════════════════════════════════════════');
  for (const r of recommendations) {
    const best = r.safe90 ?? r.bestF1;
    console.log(
      `  ${pad(r.cls, 10)}→ threshold ${best.t.toFixed(2)}  (precision=${best.precision.toFixed(3)}, recall=${best.recall.toFixed(3)})`
    );
  }
  console.log('');
  console.log('  Alt: strict mode (precision ≥ 0.95)');
  for (const r of recommendations) {
    if (r.strict95) {
      console.log(
        `  ${pad(r.cls, 10)}→ threshold ${r.strict95.t.toFixed(2)}  (precision=${r.strict95.precision.toFixed(3)}, recall=${r.strict95.recall.toFixed(3)})`
      );
    } else {
      console.log(`  ${pad(r.cls, 10)}→ no threshold reaches precision ≥ 0.95`);
    }
  }
  console.log('');
  console.log('  Alt: best F1');
  for (const r of recommendations) {
    console.log(
      `  ${pad(r.cls, 10)}→ threshold ${r.bestF1.t.toFixed(2)}  (F1=${r.bestF1.f1.toFixed(3)}, precision=${r.bestF1.precision.toFixed(3)}, recall=${r.bestF1.recall.toFixed(3)})`
    );
  }
  console.log('');

  // Show every SKILL pair in detail — these are the ones where a threshold
  // is most questionable, so the raw distances inform whether we should
  // even gate by embeddings at all.
  console.log('── SKILL pair distances (raw, for inspection) ──');
  for (const p of pairs.filter(p => p.cls === 'SKILL')) {
    console.log(
      `  ${pad(p.query, 24)} → ${pad(p.title, 36)}  d=${p.dist.toFixed(3)}  expected=${p.expected}`
    );
  }
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
