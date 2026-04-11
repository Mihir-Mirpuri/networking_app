/**
 * Comprehensive threshold calibration: 300 queries (100 per bucket) against
 * 9,678 real Person.role_embedding rows in the DB.
 *
 * For each query:
 *   1. Embed the query string via OpenAI text-embedding-3-small
 *   2. Compute cosine distance against every Person.role_embedding in the DB
 *   3. At each threshold step (0.10–0.60, step 0.02), record what passes
 *
 * Output per bucket:
 *   - Aggregate pass counts at each threshold
 *   - Boundary inspection: roles that appear at each threshold step
 *   - "Relevance cliff" detection: where junk starts appearing
 *
 * Run: npx tsx tests/test-threshold-calibration.ts
 */

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { generateRoleEmbeddings } from '../src/lib/services/embeddings';

const prisma = new PrismaClient();

type Bucket = 'NARROW' | 'STANDARD' | 'BROAD';

interface QueryDef {
  query: string;
  bucket: Bucket;
}

// ─── 100 NARROW queries: highly specific titles ────────────────────────────
const NARROW: QueryDef[] = [
  // Engineering specialties
  'Quantitative Researcher', 'Site Reliability Engineer', 'iOS Developer',
  'Android Developer', 'Embedded Software Engineer', 'Firmware Engineer',
  'VLSI Engineer', 'ASIC Design Engineer', 'RF Engineer', 'PCB Designer',
  'DevOps Engineer', 'Cloud Security Engineer', 'Penetration Tester',
  'Blockchain Developer', 'Smart Contract Engineer', 'Robotics Engineer',
  'Computer Vision Engineer', 'NLP Engineer', 'Speech Recognition Engineer',
  'Audio Engineer', 'Game Developer', 'Graphics Programmer',
  'Compiler Engineer', 'Database Administrator', 'Network Engineer',
  'Systems Programmer', 'Kernel Developer', 'Driver Developer',
  'QA Automation Engineer', 'Performance Engineer',
  // Data/ML specialties
  'Machine Learning Engineer', 'Deep Learning Engineer', 'MLOps Engineer',
  'Data Infrastructure Engineer', 'Analytics Engineer', 'ETL Developer',
  'Computer Vision Researcher', 'Reinforcement Learning Engineer',
  'Recommendation Systems Engineer', 'Search Engine Engineer',
  // Finance specialties
  'Investment Banking Analyst', 'Equity Research Analyst', 'Credit Analyst',
  'Risk Analyst', 'Quantitative Trader', 'Algorithmic Trader',
  'Portfolio Manager', 'Derivatives Trader', 'Fixed Income Analyst',
  'Actuarial Analyst', 'Compliance Officer', 'Forensic Accountant',
  'Tax Accountant', 'Audit Manager', 'Treasury Analyst',
  // Design specialties
  'UX Researcher', 'Interaction Designer', 'Motion Graphics Designer',
  'Visual Designer', 'UI Designer', 'Brand Designer',
  'Design Systems Engineer', 'Accessibility Designer', 'Service Designer',
  'Content Designer',
  // PM/Strategy specialties
  'Technical Program Manager', 'Release Manager', 'Scrum Master',
  'Business Intelligence Analyst', 'Competitive Intelligence Analyst',
  'Pricing Analyst', 'Revenue Operations Analyst', 'Growth Product Manager',
  'Platform Product Manager', 'API Product Manager',
  // Operations/Other specialties
  'Supply Chain Analyst', 'Logistics Coordinator', 'Procurement Specialist',
  'Clinical Research Associate', 'Biostatistician', 'Epidemiologist',
  'Patent Attorney', 'Immigration Lawyer', 'Environmental Engineer',
  'Chemical Engineer', 'Biomedical Engineer', 'Aerospace Engineer',
  'Structural Engineer', 'Geotechnical Engineer', 'Urban Planner',
  // Sales/Marketing specialties
  'Sales Engineer', 'Solutions Architect', 'Customer Success Manager',
  'Technical Account Manager', 'Field Application Engineer',
  'Digital Marketing Specialist', 'SEO Specialist', 'PPC Specialist',
  'Email Marketing Manager', 'Conversion Rate Optimization Specialist',
].map(q => ({ query: q, bucket: 'NARROW' as Bucket }));

// ─── 100 STANDARD queries: common well-defined titles ─────────────────────
const STANDARD: QueryDef[] = [
  // Engineering
  'Software Engineer', 'Software Developer', 'Backend Engineer',
  'Frontend Engineer', 'Full Stack Engineer', 'Full Stack Developer',
  'Web Developer', 'Platform Engineer', 'Infrastructure Engineer',
  'Data Engineer', 'Security Engineer', 'Mobile Developer',
  'Application Developer', 'Systems Engineer', 'Release Engineer',
  'Build Engineer', 'Integration Engineer', 'Automation Engineer',
  // Data/Science
  'Data Scientist', 'Data Analyst', 'Research Scientist',
  'Applied Scientist', 'Research Engineer', 'ML Researcher',
  'Statistician', 'Bioinformatician',
  // Product/Design
  'Product Manager', 'Product Designer', 'UX Designer',
  'Graphic Designer', 'Industrial Designer', 'Creative Director',
  'Art Director', 'Design Manager', 'Product Owner',
  'Technical Writer', 'Content Strategist', 'Copywriter',
  // Business/Finance
  'Business Analyst', 'Financial Analyst', 'Management Consultant',
  'Strategy Consultant', 'Operations Manager', 'Project Manager',
  'Program Manager', 'Account Manager', 'Account Executive',
  'Sales Manager', 'Marketing Manager', 'Brand Manager',
  'Public Relations Manager', 'Communications Manager',
  // Operations
  'Operations Analyst', 'Business Operations Manager', 'Chief of Staff',
  'Office Manager', 'Executive Assistant', 'Administrative Assistant',
  // HR/People
  'Recruiter', 'Technical Recruiter', 'HR Manager',
  'Talent Acquisition Manager', 'People Operations Manager',
  'Compensation Analyst', 'Benefits Administrator',
  // Legal/Compliance
  'Corporate Lawyer', 'General Counsel', 'Paralegal',
  'Compliance Analyst', 'Contract Manager',
  // Finance
  'Controller', 'Accountant', 'Auditor',
  'Investment Analyst', 'Venture Capital Analyst', 'Private Equity Associate',
  'Financial Planner', 'Wealth Manager',
  // Healthcare
  'Physician', 'Pharmacist', 'Nurse Practitioner',
  'Clinical Psychologist', 'Physical Therapist',
  // Education/Research
  'Professor', 'Research Fellow', 'Postdoctoral Researcher',
  'Teaching Assistant', 'Academic Advisor',
  // Other
  'Journalist', 'Editor', 'Photographer',
  'Event Manager', 'Real Estate Agent', 'Insurance Agent',
  'Social Worker', 'Policy Analyst', 'Urban Designer',
  'Architect', 'Interior Designer', 'Landscape Architect',
].map(q => ({ query: q, bucket: 'STANDARD' as Bucket }));

// ─── 100 BROAD queries: single-word discipline nouns ──────────────────────
const BROAD: QueryDef[] = [
  // Core disciplines
  'Engineer', 'Designer', 'Scientist', 'Analyst', 'Developer',
  'Manager', 'Consultant', 'Researcher', 'Architect', 'Strategist',
  // Business
  'Director', 'Partner', 'Associate', 'Executive', 'Officer',
  'Administrator', 'Coordinator', 'Supervisor', 'Lead', 'Principal',
  // Technical
  'Programmer', 'Coder', 'Hacker', 'Technologist', 'Technician',
  'Specialist', 'Expert', 'Professional', 'Practitioner', 'Operator',
  // Creative
  'Creator', 'Artist', 'Writer', 'Editor', 'Producer',
  'Animator', 'Illustrator', 'Photographer', 'Filmmaker', 'Musician',
  // Finance
  'Banker', 'Trader', 'Investor', 'Broker', 'Underwriter',
  'Actuary', 'Accountant', 'Auditor', 'Controller', 'Treasurer',
  // Sales/Marketing
  'Salesperson', 'Marketer', 'Advertiser', 'Promoter', 'Merchandiser',
  'Buyer', 'Planner', 'Forecaster', 'Publicist', 'Spokesperson',
  // People/HR
  'Recruiter', 'Mentor', 'Coach', 'Trainer', 'Facilitator',
  'Counselor', 'Advisor', 'Advocate', 'Mediator', 'Negotiator',
  // Legal
  'Lawyer', 'Attorney', 'Solicitor', 'Barrister', 'Paralegal',
  'Judge', 'Arbitrator', 'Litigator', 'Prosecutor', 'Defender',
  // Healthcare
  'Doctor', 'Nurse', 'Surgeon', 'Therapist', 'Pharmacist',
  'Dentist', 'Psychiatrist', 'Psychologist', 'Radiologist', 'Pathologist',
  // Science
  'Biologist', 'Chemist', 'Physicist', 'Mathematician', 'Statistician',
  'Geologist', 'Ecologist', 'Astronomer', 'Geneticist', 'Neuroscientist',
  // Education
  'Professor', 'Teacher', 'Instructor', 'Lecturer', 'Tutor',
  'Educator', 'Dean', 'Provost', 'Chancellor', 'Superintendent',
].map(q => ({ query: q, bucket: 'BROAD' as Bucket }));

const ALL_QUERIES = [...NARROW, ...STANDARD, ...BROAD];
// Build thresholds as integers (10..60 step 2) to avoid floating point issues
const THRESHOLD_INTS = Array.from({ length: 26 }, (_, i) => 10 + i * 2);
// Also include 0.35 (35) and 0.25 (25) and 0.45 (45) since they're important reference points
for (const extra of [15, 25, 35, 45, 55]) {
  if (!THRESHOLD_INTS.includes(extra)) THRESHOLD_INTS.push(extra);
}
THRESHOLD_INTS.sort((a, b) => a - b);
const THRESHOLDS = THRESHOLD_INTS.map(i => i / 100);

interface PersonRow {
  id: string;
  role: string;
  embedding: number[];
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log('=== Comprehensive Threshold Calibration (300 queries × 9.6K DB rows) ===\n');

  // ─── Step 1: Load all Person rows with embeddings ───
  console.log('Loading Person embeddings from DB...');
  const t0 = Date.now();
  const rawRows2 = await prisma.$queryRaw<Array<{ id: string; role: string; emb: string }>>(
    Prisma.sql`
      SELECT id, role, role_embedding::text as emb
      FROM "Person"
      WHERE role IS NOT NULL AND role_embedding IS NOT NULL
    `
  );

  const persons: PersonRow[] = rawRows2.map(r => ({
    id: r.id,
    role: r.role,
    embedding: JSON.parse(r.emb) as number[],
  }));
  console.log(`  Loaded ${persons.length} Person rows in ${Date.now() - t0}ms\n`);

  if (persons.length === 0) {
    console.error('No Person rows with embeddings found');
    await prisma.$disconnect();
    process.exit(1);
  }

  // ─── Step 2: Embed all 300 query strings ───
  const queryStrings = ALL_QUERIES.map(q => q.query);
  console.log(`Embedding ${queryStrings.length} query strings via OpenAI...`);
  const t1 = Date.now();
  const queryEmbeddings = await generateRoleEmbeddings(queryStrings);
  console.log(`  Done in ${Date.now() - t1}ms (${queryEmbeddings.size} embeddings)\n`);

  // ─── Step 3: For each query, compute distances to all Person rows ───
  interface QueryResult {
    query: string;
    bucket: Bucket;
    // For each threshold, the count of Person rows that pass + sample roles at the boundary
    thresholdData: Map<number, { count: number; boundaryRoles: string[] }>;
    // Closest 20 roles (for inspection)
    closest: Array<{ role: string; dist: number }>;
    // Distance stats
    minDist: number;
    medianDist: number;
    p25Dist: number;
    p75Dist: number;
  }

  console.log('Computing distances (300 queries × ~9.7K persons)...');
  const t2 = Date.now();
  const results: QueryResult[] = [];

  for (const qd of ALL_QUERIES) {
    const qEmb = queryEmbeddings.get(qd.query);
    if (!qEmb) {
      console.warn(`  [SKIP] No embedding for "${qd.query}"`);
      continue;
    }

    // Compute all distances
    const dists: Array<{ role: string; dist: number }> = persons.map(p => ({
      role: p.role,
      dist: cosineDistance(qEmb, p.embedding),
    }));
    dists.sort((a, b) => a.dist - b.dist);

    const allDistValues = dists.map(d => d.dist);

    // For each threshold, count passes and grab boundary roles
    // Use integer keys (threshold * 100) to avoid floating point Map key issues
    const thresholdData = new Map<number, { count: number; boundaryRoles: string[] }>();
    for (const t of THRESHOLDS) {
      const passing = dists.filter(d => d.dist <= t);
      // Boundary roles: those within 0.01 of the threshold (just inside or just outside)
      const boundary = dists
        .filter(d => Math.abs(d.dist - t) <= 0.015)
        .slice(0, 5)
        .map(d => `${d.role} (d=${d.dist.toFixed(3)})`);
      thresholdData.set(t, { count: passing.length, boundaryRoles: boundary });
    }

    results.push({
      query: qd.query,
      bucket: qd.bucket,
      thresholdData,
      closest: dists.slice(0, 20),
      minDist: allDistValues[0],
      medianDist: median(allDistValues),
      p25Dist: percentile(allDistValues, 25),
      p75Dist: percentile(allDistValues, 75),
    });
  }
  console.log(`  Done in ${Date.now() - t2}ms\n`);

  // ─── Step 4: Aggregate by bucket ───
  const buckets: Bucket[] = ['NARROW', 'STANDARD', 'BROAD'];

  for (const bucket of buckets) {
    const bucketResults = results.filter(r => r.bucket === bucket);
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  BUCKET: ${bucket} (${bucketResults.length} queries)`);
    console.log(`${'═'.repeat(70)}`);

    // Aggregate threshold sweep
    console.log(`\n  Threshold sweep (aggregate across all ${bucketResults.length} queries):`);
    console.log(`  ${pad('threshold', 11)}${pad('avg_pass', 10)}${pad('med_pass', 10)}${pad('min_pass', 10)}${pad('max_pass', 10)}${pad('queries_w_0', 13)}`);
    console.log(`  ${'-'.repeat(64)}`);

    for (const t of THRESHOLDS) {
      const counts = bucketResults.map(r => r.thresholdData.get(t)!.count);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const med = median(counts);
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      const zeroCount = counts.filter(c => c === 0).length;
      console.log(
        `  ${pad(t.toFixed(2), 11)}${pad(avg.toFixed(1), 10)}${pad(String(med), 10)}${pad(String(min), 10)}${pad(String(max), 10)}${pad(String(zeroCount), 13)}`
      );
    }

    // Show boundary inspection at key thresholds
    const keyThresholds = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
    for (const t of keyThresholds) {
      console.log(`\n  ── Boundary roles at threshold ${t.toFixed(2)} (sample from ${bucket}) ──`);
      let shown = 0;
      for (const r of bucketResults) {
        const td = r.thresholdData.get(t);
        if (!td || td.boundaryRoles.length === 0) continue;
        if (shown >= 8) break;
        console.log(`    Query "${r.query}" (${td.count} pass):`);
        for (const br of td.boundaryRoles.slice(0, 3)) {
          console.log(`      ${br}`);
        }
        shown++;
      }
    }

    // Show closest roles for sample queries
    console.log(`\n  ── Closest 10 roles for sample ${bucket} queries ──`);
    const samples = bucketResults.slice(0, 5);
    for (const r of samples) {
      console.log(`\n    Query: "${r.query}" (minDist=${r.minDist.toFixed(3)})`);
      for (const c of r.closest.slice(0, 10)) {
        console.log(`      d=${c.dist.toFixed(3)}  ${c.role.slice(0, 70)}${c.role.length > 70 ? '…' : ''}`);
      }
    }

    // Distance distribution stats
    console.log(`\n  ── Distance distribution (min distance per query) ──`);
    const minDists = bucketResults.map(r => r.minDist);
    console.log(`    Min:    ${Math.min(...minDists).toFixed(3)}`);
    console.log(`    P25:    ${percentile(minDists, 25).toFixed(3)}`);
    console.log(`    Median: ${median(minDists).toFixed(3)}`);
    console.log(`    P75:    ${percentile(minDists, 75).toFixed(3)}`);
    console.log(`    Max:    ${Math.max(...minDists).toFixed(3)}`);
  }

  // ─── Step 5: Cross-bucket comparison at key thresholds ───
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('  CROSS-BUCKET COMPARISON');
  console.log(`${'═'.repeat(70)}\n`);

  console.log(`  Average pass count per query at each threshold:\n`);
  console.log(`  ${pad('threshold', 11)}${pad('NARROW', 10)}${pad('STANDARD', 10)}${pad('BROAD', 10)}`);
  console.log(`  ${'-'.repeat(41)}`);

  for (const t of THRESHOLDS) {
    const avgs: string[] = [];
    for (const bucket of buckets) {
      const br = results.filter(r => r.bucket === bucket);
      const counts = br.map(r => r.thresholdData.get(t)!.count);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      avgs.push(avg.toFixed(1));
    }
    console.log(`  ${pad(t.toFixed(2), 11)}${pad(avgs[0], 10)}${pad(avgs[1], 10)}${pad(avgs[2], 10)}`);
  }

  // ─── Step 6: Find the "relevance cliff" per bucket ───
  // For each bucket, find queries where a threshold jump causes clearly irrelevant roles to enter
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('  RELEVANCE CLIFF ANALYSIS');
  console.log(`${'═'.repeat(70)}`);
  console.log('  (Where avg pass count jumps significantly between threshold steps)\n');

  for (const bucket of buckets) {
    const br = results.filter(r => r.bucket === bucket);
    console.log(`  ${bucket}:`);
    let prevAvg = 0;
    for (const t of THRESHOLDS) {
      const counts = br.map(r => r.thresholdData.get(t)!.count);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const jump = avg - prevAvg;
      const pctJump = prevAvg > 0 ? ((jump / prevAvg) * 100).toFixed(0) : 'N/A';
      if (jump > 1 || t <= 0.12) {
        console.log(`    t=${t.toFixed(2)}: avg=${avg.toFixed(1)} (+${jump.toFixed(1)}, ${pctJump}%)`);
      }
      prevAvg = avg;
    }
    console.log('');
  }

  // ─── Step 7: Recommendation ───
  console.log(`${'═'.repeat(70)}`);
  console.log('  CURRENT (0.35) vs PROPOSED — avg matches per query');
  console.log(`${'═'.repeat(70)}\n`);

  for (const bucket of buckets) {
    const br = results.filter(r => r.bucket === bucket);
    const at35 = br.map(r => r.thresholdData.get(0.35)!.count);
    const avg35 = at35.reduce((a, b) => a + b, 0) / at35.length;
    const zero35 = at35.filter(c => c === 0).length;

    // Find threshold where most queries have at least 1 match but avg isn't exploding
    console.log(`  ${bucket}:`);
    console.log(`    Current (0.35): avg=${avg35.toFixed(1)} matches/query, ${zero35}/${br.length} queries with 0 matches`);

    for (const t of [0.25, 0.30, 0.35, 0.40, 0.45, 0.50]) {
      const counts = br.map(r => r.thresholdData.get(t)!.count);
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const zeros = counts.filter(c => c === 0).length;
      console.log(`    t=${t.toFixed(2)}: avg=${avg.toFixed(1)}, zeros=${zeros}/${br.length}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
  console.log('Done.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Test crashed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
