/**
 * Test: Find optimal vector distance threshold for role matching
 * Generates embeddings for many role pairs and measures cosine distances.
 *
 * Usage: npx tsx tests/test-role-threshold.ts
 */

import 'dotenv/config';
import { generateRoleEmbeddings } from '../src/lib/services/embeddings';

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Search roles users would type
const SEARCH_ROLES = [
  'Software Engineer',
  'Product Manager',
  'Data Scientist',
  'Investment Banking',
  'Management Consulting',
  'Marketing Manager',
  'Mechanical Engineer',
  'Recruiter',
  'Sales',
  'UX Designer',
  'Financial Analyst',
  'Hardware Engineer',
  'Machine Learning Engineer',
  'Chip Design',
  'Account Executive',
  'Business Analyst',
  'DevOps Engineer',
  'Research Scientist',
  'Civil Engineer',
  'Lawyer',
];

// DB roles — the actual titles people have on their profiles
const DB_ROLES = [
  // Software Engineering variants
  'Software Engineer',
  'Software Developer',
  'Senior Software Engineer',
  'Staff Software Engineer',
  'Backend Engineer',
  'Frontend Engineer',
  'Full Stack Developer',
  'Mobile Engineer',
  'iOS Developer',
  'Android Developer',
  'Platform Engineer',
  'Infrastructure Engineer',
  'Site Reliability Engineer',
  'Engineering Manager',

  // Product
  'Product Manager',
  'Senior Product Manager',
  'Associate Product Manager',
  'Group Product Manager',
  'Technical Program Manager',
  'Program Manager',
  'Product Owner',
  'Chief Product Officer',

  // Data
  'Data Scientist',
  'Senior Data Scientist',
  'Data Analyst',
  'Data Engineer',
  'Analytics Engineer',
  'Business Intelligence Analyst',
  'Quantitative Analyst',
  'Statistician',

  // ML/AI
  'Machine Learning Engineer',
  'ML Engineer',
  'AI Research Scientist',
  'Deep Learning Engineer',
  'NLP Engineer',
  'Computer Vision Engineer',
  'Applied Scientist',
  'Research Engineer',

  // Finance / IB
  'Investment Banking Analyst',
  'Investment Banking Associate',
  'Financial Analyst',
  'Equity Research Analyst',
  'Private Equity Associate',
  'Venture Capital Analyst',
  'Portfolio Manager',
  'Trader',
  'Risk Analyst',
  'Wealth Management Associate',
  'Corporate Finance Analyst',
  'FP&A Analyst',

  // Consulting
  'Management Consultant',
  'Strategy Consultant',
  'Associate Consultant',
  'Senior Consultant',
  'Business Consultant',
  'Technology Consultant',
  'Principal Consultant',

  // Marketing
  'Marketing Manager',
  'Digital Marketing Manager',
  'Brand Manager',
  'Growth Marketing Manager',
  'Content Marketing Manager',
  'Social Media Manager',
  'Marketing Coordinator',
  'Product Marketing Manager',
  'CMO',

  // Design
  'UX Designer',
  'UI Designer',
  'Product Designer',
  'UX Researcher',
  'Visual Designer',
  'Interaction Designer',
  'Design Lead',
  'Creative Director',
  'Graphic Designer',

  // Hardware / EE
  'Hardware Engineer',
  'Electrical Engineer',
  'ASIC Design Engineer',
  'VLSI Engineer',
  'Chip Design Engineer',
  'Firmware Engineer',
  'Embedded Systems Engineer',
  'RF Engineer',
  'PCB Design Engineer',
  'Semiconductor Process Engineer',

  // Mechanical
  'Mechanical Engineer',
  'Senior Mechanical Engineer',
  'Manufacturing Engineer',
  'Aerospace Engineer',
  'Structural Engineer',
  'Robotics Engineer',
  'CAD Engineer',

  // Civil
  'Civil Engineer',
  'Structural Engineer',
  'Transportation Engineer',
  'Environmental Engineer',
  'Construction Manager',
  'Urban Planner',

  // Sales
  'Account Executive',
  'Sales Development Representative',
  'Enterprise Account Executive',
  'Sales Manager',
  'Business Development Representative',
  'Solutions Engineer',
  'Sales Engineer',
  'Regional Sales Manager',
  'VP of Sales',

  // Recruiting / HR
  'Recruiter',
  'Technical Recruiter',
  'Talent Acquisition Specialist',
  'HR Manager',
  'HR Business Partner',
  'People Operations Manager',
  'Sourcer',

  // Legal
  'Lawyer',
  'Attorney',
  'Corporate Counsel',
  'General Counsel',
  'Legal Analyst',
  'Paralegal',
  'Compliance Officer',

  // Research
  'Research Scientist',
  'Senior Research Scientist',
  'Postdoctoral Researcher',
  'Research Associate',
  'Lab Manager',
  'Principal Researcher',

  // Business Analyst
  'Business Analyst',
  'Senior Business Analyst',
  'Systems Analyst',
  'Operations Analyst',
  'Strategy Analyst',

  // DevOps
  'DevOps Engineer',
  'Cloud Engineer',
  'Systems Administrator',
  'Platform Engineer',
  'Release Engineer',
  'Security Engineer',

  // Miscellaneous — clearly unrelated to most searches
  'Executive Assistant',
  'Office Manager',
  'Customer Success Manager',
  'Customer Support Specialist',
  'Project Manager',
  'Scrum Master',
  'Quality Assurance Engineer',
  'Technical Writer',
  'Solutions Architect',
];

interface PairResult {
  searchRole: string;
  dbRole: string;
  distance: number;
  shouldMatch: boolean;
}

// Define which (search, dbRole) pairs SHOULD match
// This is the ground truth for computing optimal threshold
function shouldMatch(searchRole: string, dbRole: string): boolean | null {
  const s = searchRole.toLowerCase();
  const d = dbRole.toLowerCase();

  const rules: Record<string, { yes: string[]; no: string[] }> = {
    'software engineer': {
      yes: ['software engineer', 'software developer', 'senior software engineer', 'staff software engineer',
            'backend engineer', 'frontend engineer', 'full stack developer', 'mobile engineer', 'ios developer',
            'android developer', 'platform engineer', 'infrastructure engineer', 'site reliability engineer',
            'quality assurance engineer'],
      no: ['recruiter', 'technical recruiter', 'marketing manager', 'account executive', 'lawyer', 'attorney',
           'executive assistant', 'office manager', 'hr manager', 'investment banking analyst',
           'management consultant', 'mechanical engineer', 'civil engineer', 'paralegal', 'sourcer',
           'customer support specialist', 'customer success manager', 'brand manager', 'social media manager',
           'trader', 'wealth management associate', 'urban planner'],
    },
    'product manager': {
      yes: ['product manager', 'senior product manager', 'associate product manager', 'group product manager',
            'product owner', 'chief product officer', 'technical program manager'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'data scientist',
           'investment banking analyst', 'account executive', 'executive assistant', 'civil engineer',
           'customer support specialist'],
    },
    'data scientist': {
      yes: ['data scientist', 'senior data scientist', 'data analyst', 'data engineer', 'analytics engineer',
            'business intelligence analyst', 'quantitative analyst', 'statistician', 'applied scientist'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'mechanical engineer',
           'executive assistant', 'office manager', 'hr manager', 'civil engineer', 'paralegal'],
    },
    'investment banking': {
      yes: ['investment banking analyst', 'investment banking associate', 'financial analyst',
            'equity research analyst', 'private equity associate', 'corporate finance analyst'],
      no: ['software engineer', 'recruiter', 'marketing manager', 'mechanical engineer', 'data scientist',
           'ux designer', 'lawyer', 'civil engineer', 'executive assistant', 'customer support specialist'],
    },
    'management consulting': {
      yes: ['management consultant', 'strategy consultant', 'associate consultant', 'senior consultant',
            'business consultant', 'principal consultant', 'strategy analyst'],
      no: ['software engineer', 'recruiter', 'mechanical engineer', 'data scientist', 'lawyer',
           'civil engineer', 'executive assistant', 'investment banking analyst'],
    },
    'marketing manager': {
      yes: ['marketing manager', 'digital marketing manager', 'brand manager', 'growth marketing manager',
            'content marketing manager', 'marketing coordinator', 'product marketing manager', 'cmo',
            'social media manager'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'data scientist',
           'investment banking analyst', 'civil engineer', 'executive assistant', 'trader'],
    },
    'recruiter': {
      yes: ['recruiter', 'technical recruiter', 'talent acquisition specialist', 'sourcer',
            'hr manager', 'hr business partner', 'people operations manager'],
      no: ['software engineer', 'data scientist', 'mechanical engineer', 'lawyer',
           'investment banking analyst', 'marketing manager', 'civil engineer', 'account executive'],
    },
    'ux designer': {
      yes: ['ux designer', 'ui designer', 'product designer', 'ux researcher', 'visual designer',
            'interaction designer', 'design lead', 'creative director'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'data scientist',
           'investment banking analyst', 'civil engineer', 'account executive', 'executive assistant'],
    },
    'hardware engineer': {
      yes: ['hardware engineer', 'electrical engineer', 'asic design engineer', 'vlsi engineer',
            'chip design engineer', 'firmware engineer', 'embedded systems engineer', 'rf engineer',
            'pcb design engineer', 'semiconductor process engineer'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'data scientist',
           'investment banking analyst', 'executive assistant', 'ux designer', 'civil engineer'],
    },
    'machine learning engineer': {
      yes: ['machine learning engineer', 'ml engineer', 'ai research scientist', 'deep learning engineer',
            'nlp engineer', 'computer vision engineer', 'applied scientist', 'research engineer'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'mechanical engineer',
           'investment banking analyst', 'executive assistant', 'civil engineer', 'hr manager'],
    },
    'chip design': {
      yes: ['asic design engineer', 'vlsi engineer', 'chip design engineer', 'hardware engineer',
            'electrical engineer', 'semiconductor process engineer'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'software engineer', 'data scientist',
           'investment banking analyst', 'executive assistant', 'ux designer', 'civil engineer',
           'account executive'],
    },
    'sales': {
      yes: ['account executive', 'sales development representative', 'enterprise account executive',
            'sales manager', 'business development representative', 'sales engineer', 'regional sales manager',
            'vp of sales'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'data scientist',
           'investment banking analyst', 'civil engineer', 'executive assistant', 'ux designer'],
    },
    'account executive': {
      yes: ['account executive', 'enterprise account executive', 'sales manager',
            'sales development representative', 'business development representative', 'regional sales manager'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'data scientist',
           'civil engineer', 'executive assistant', 'ux designer'],
    },
    'financial analyst': {
      yes: ['financial analyst', 'fp&a analyst', 'corporate finance analyst', 'equity research analyst',
            'investment banking analyst', 'risk analyst', 'quantitative analyst'],
      no: ['software engineer', 'recruiter', 'mechanical engineer', 'ux designer', 'civil engineer',
           'executive assistant', 'marketing manager'],
    },
    'mechanical engineer': {
      yes: ['mechanical engineer', 'senior mechanical engineer', 'manufacturing engineer',
            'aerospace engineer', 'robotics engineer', 'cad engineer'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'data scientist',
           'investment banking analyst', 'executive assistant', 'ux designer'],
    },
    'civil engineer': {
      yes: ['civil engineer', 'structural engineer', 'transportation engineer', 'environmental engineer',
            'construction manager'],
      no: ['software engineer', 'recruiter', 'lawyer', 'marketing manager', 'data scientist',
           'investment banking analyst', 'executive assistant', 'ux designer', 'account executive'],
    },
    'research scientist': {
      yes: ['research scientist', 'senior research scientist', 'postdoctoral researcher', 'research associate',
            'principal researcher', 'ai research scientist', 'applied scientist'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'executive assistant',
           'investment banking analyst', 'civil engineer', 'hr manager'],
    },
    'business analyst': {
      yes: ['business analyst', 'senior business analyst', 'systems analyst', 'operations analyst',
            'strategy analyst'],
      no: ['software engineer', 'recruiter', 'lawyer', 'mechanical engineer', 'civil engineer',
           'executive assistant', 'ux designer'],
    },
    'devops engineer': {
      yes: ['devops engineer', 'cloud engineer', 'systems administrator', 'platform engineer',
            'release engineer', 'security engineer', 'infrastructure engineer', 'site reliability engineer'],
      no: ['recruiter', 'lawyer', 'marketing manager', 'account executive', 'data scientist',
           'investment banking analyst', 'executive assistant', 'civil engineer', 'ux designer'],
    },
    'lawyer': {
      yes: ['lawyer', 'attorney', 'corporate counsel', 'general counsel', 'legal analyst', 'paralegal',
            'compliance officer'],
      no: ['software engineer', 'recruiter', 'marketing manager', 'mechanical engineer', 'data scientist',
           'investment banking analyst', 'executive assistant', 'ux designer', 'civil engineer'],
    },
  };

  const rule = rules[s];
  if (!rule) return null;

  if (rule.yes.some(r => d === r)) return true;
  if (rule.no.some(r => d === r)) return false;
  return null; // ambiguous — don't count
}

async function main() {
  console.log('Generating embeddings for all roles...\n');

  // Collect all unique roles
  const allRoles = Array.from(new Set([...SEARCH_ROLES, ...DB_ROLES]));
  console.log(`Total unique roles: ${allRoles.length}`);

  // Batch embed all roles
  const embeddings = await generateRoleEmbeddings(allRoles);
  console.log(`Embeddings generated: ${embeddings.size}\n`);

  if (embeddings.size === 0) {
    console.error('No embeddings generated. Check OPENAI_API_KEY.');
    process.exit(1);
  }

  // Compute all labeled pairs
  const pairs: PairResult[] = [];
  for (const searchRole of SEARCH_ROLES) {
    const searchEmb = embeddings.get(searchRole);
    if (!searchEmb) continue;

    for (const dbRole of DB_ROLES) {
      const dbEmb = embeddings.get(dbRole);
      if (!dbEmb) continue;

      const match = shouldMatch(searchRole, dbRole);
      if (match === null) continue; // ambiguous

      pairs.push({
        searchRole,
        dbRole,
        distance: cosineDistance(searchEmb, dbEmb),
        shouldMatch: match,
      });
    }
  }

  console.log(`Labeled pairs: ${pairs.length} (${pairs.filter(p => p.shouldMatch).length} positive, ${pairs.filter(p => !p.shouldMatch).length} negative)\n`);

  // Print distance distributions
  const positives = pairs.filter(p => p.shouldMatch).map(p => p.distance).sort((a, b) => a - b);
  const negatives = pairs.filter(p => !p.shouldMatch).map(p => p.distance).sort((a, b) => a - b);

  console.log('=== POSITIVE (should match) distance distribution ===');
  console.log(`  Min:    ${positives[0]?.toFixed(4)}`);
  console.log(`  P25:    ${positives[Math.floor(positives.length * 0.25)]?.toFixed(4)}`);
  console.log(`  Median: ${positives[Math.floor(positives.length * 0.5)]?.toFixed(4)}`);
  console.log(`  P75:    ${positives[Math.floor(positives.length * 0.75)]?.toFixed(4)}`);
  console.log(`  P90:    ${positives[Math.floor(positives.length * 0.9)]?.toFixed(4)}`);
  console.log(`  P95:    ${positives[Math.floor(positives.length * 0.95)]?.toFixed(4)}`);
  console.log(`  Max:    ${positives[positives.length - 1]?.toFixed(4)}`);

  console.log('\n=== NEGATIVE (should NOT match) distance distribution ===');
  console.log(`  Min:    ${negatives[0]?.toFixed(4)}`);
  console.log(`  P5:     ${negatives[Math.floor(negatives.length * 0.05)]?.toFixed(4)}`);
  console.log(`  P10:    ${negatives[Math.floor(negatives.length * 0.1)]?.toFixed(4)}`);
  console.log(`  P25:    ${negatives[Math.floor(negatives.length * 0.25)]?.toFixed(4)}`);
  console.log(`  Median: ${negatives[Math.floor(negatives.length * 0.5)]?.toFixed(4)}`);
  console.log(`  Max:    ${negatives[negatives.length - 1]?.toFixed(4)}`);

  // Test thresholds
  console.log('\n=== THRESHOLD ANALYSIS ===');
  console.log('Threshold | True Pos | False Neg | True Neg | False Pos | Precision | Recall  | F1');
  console.log('-'.repeat(95));

  for (const threshold of [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]) {
    let tp = 0, fn = 0, tn = 0, fp = 0;
    for (const pair of pairs) {
      const predicted = pair.distance <= threshold;
      if (pair.shouldMatch && predicted) tp++;
      else if (pair.shouldMatch && !predicted) fn++;
      else if (!pair.shouldMatch && !predicted) tn++;
      else fp++;
    }
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    const f1 = 2 * precision * recall / (precision + recall) || 0;
    console.log(
      `  ${threshold.toFixed(2)}    |  ${String(tp).padStart(6)}  |  ${String(fn).padStart(7)}  |  ${String(tn).padStart(6)}  |  ${String(fp).padStart(7)}  |  ${precision.toFixed(4)}   | ${recall.toFixed(4)} | ${f1.toFixed(4)}`
    );
  }

  // Show the worst false positives (negative pairs with lowest distance)
  console.log('\n=== WORST FALSE POSITIVES (negative pairs closest to matching) ===');
  const worstFP = pairs.filter(p => !p.shouldMatch).sort((a, b) => a.distance - b.distance).slice(0, 20);
  for (const p of worstFP) {
    console.log(`  d=${p.distance.toFixed(4)}  search="${p.searchRole}" → db="${p.dbRole}"`);
  }

  // Show the worst false negatives (positive pairs with highest distance)
  console.log('\n=== WORST FALSE NEGATIVES (positive pairs farthest from matching) ===');
  const worstFN = pairs.filter(p => p.shouldMatch).sort((a, b) => b.distance - a.distance).slice(0, 20);
  for (const p of worstFN) {
    console.log(`  d=${p.distance.toFixed(4)}  search="${p.searchRole}" → db="${p.dbRole}"`);
  }

  // Per-search-role breakdown at the best threshold candidates
  console.log('\n=== PER-SEARCH-ROLE BREAKDOWN (threshold=0.50) ===');
  for (const searchRole of SEARCH_ROLES) {
    const rolePairs = pairs.filter(p => p.searchRole === searchRole);
    const tp = rolePairs.filter(p => p.shouldMatch && p.distance <= 0.50).length;
    const fn = rolePairs.filter(p => p.shouldMatch && p.distance > 0.50).length;
    const fp = rolePairs.filter(p => !p.shouldMatch && p.distance <= 0.50).length;
    const total = rolePairs.filter(p => p.shouldMatch).length;
    if (total === 0) continue;
    console.log(`  "${searchRole}": ${tp}/${total} recalled, ${fp} false positives${fn > 0 ? ` | MISSED: ${rolePairs.filter(p => p.shouldMatch && p.distance > 0.50).map(p => `${p.dbRole}(${p.distance.toFixed(3)})`).join(', ')}` : ''}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
