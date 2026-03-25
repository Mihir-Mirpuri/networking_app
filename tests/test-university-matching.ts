/**
 * Test university keyword matching against the real database.
 * Verifies that common abbreviations and full names all return results.
 *
 * Usage: npx tsx tests/test-university-matching.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ── Copied from person-service.ts so the test is self-contained ──

const UNIVERSITY_ALIASES: Record<string, string[]> = {
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

function getUniversityKeywords(university: string): string[] {
  const trimmed = university.trim();
  const lower = trimmed.toLowerCase();
  if (UNIVERSITY_ALIASES[lower]) return UNIVERSITY_ALIASES[lower];
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [trimmed];
  const noise = new Set(['of', 'at', 'the', 'and', 'in', 'for']);
  const meaningful = words.filter(w => !noise.has(w.toLowerCase()));
  return meaningful.length > 0 ? meaningful : [trimmed];
}

// ── Test runner ──

interface TestCase {
  input: string;           // What the user types
  shouldMatch: string[];   // DB educationSchool values it should match
  shouldNotMatch?: string[]; // DB values it should NOT match (false positive check)
}

const TEST_CASES: TestCase[] = [
  // ── UT System ──
  // Note: schools JSON cross-matching means someone at Texas A&M who also attended UT Austin
  // will appear in UT Austin results — this is correct behavior (they DID attend a matching school).
  { input: 'UT Austin', shouldMatch: ['University of Texas at Austin', 'The University of Texas at Austin'] },
  { input: 'UT', shouldMatch: ['University of Texas at Austin'] },
  { input: 'University of Texas at Austin', shouldMatch: ['University of Texas at Austin'] },
  { input: 'UT Dallas', shouldMatch: ['University of Texas at Dallas', 'University of Texas at dallas'] },
  { input: 'UTD', shouldMatch: ['University of Texas at Dallas'] },

  // ── Texas A&M ──
  { input: 'Texas A&M', shouldMatch: ['Texas A&M University', 'Mays Business School - Texas A&M University'] },
  { input: 'TAMU', shouldMatch: ['Texas A&M University'] },

  // ── Ivy League ──
  { input: 'Harvard', shouldMatch: ['Harvard University'] },
  { input: 'Harvard University', shouldMatch: ['Harvard University'] },
  { input: 'Yale', shouldMatch: ['Yale University'] },
  { input: 'Princeton', shouldMatch: ['Princeton University'] },
  { input: 'Columbia', shouldMatch: ['Columbia University'] },
  { input: 'Cornell', shouldMatch: ['Cornell University'] },
  { input: 'Dartmouth', shouldMatch: ['Dartmouth College'] },
  { input: 'UPenn', shouldMatch: ['University of Pennsylvania'] },
  { input: 'Penn', shouldMatch: ['University of Pennsylvania'] },

  // ── Abbreviations that are stored abbreviated in DB (both directions) ──
  { input: 'MIT', shouldMatch: ['MIT'] },
  { input: 'Massachusetts Institute of Technology', shouldMatch: ['MIT'] },
  { input: 'NYU', shouldMatch: ['NYU'] },
  { input: 'New York University', shouldMatch: ['NYU'] },
  { input: 'USC', shouldMatch: ['USC'] },
  { input: 'University of Southern California', shouldMatch: ['USC'] },
  { input: 'UCLA', shouldMatch: ['UCLA'] },
  { input: 'University of California Los Angeles', shouldMatch: ['UCLA'] },
  { input: 'SMU', shouldMatch: ['SMU', 'Southern Methodist University'] },
  { input: 'Southern Methodist University', shouldMatch: ['SMU', 'Southern Methodist University'] },

  // ── UC Schools ──
  { input: 'UC Berkeley', shouldMatch: ['UC Berkeley'] },
  { input: 'Berkeley', shouldMatch: ['UC Berkeley'] },
  { input: 'Cal', shouldMatch: ['UC Berkeley'] },

  // ── Tech Schools ──
  { input: 'Georgia Tech', shouldMatch: ['Georgia Tech'] },
  { input: 'GaTech', shouldMatch: ['Georgia Tech'] },
  { input: 'GT', shouldMatch: ['Georgia Tech'] },
  { input: 'Stanford', shouldMatch: ['Stanford University', 'Stanford University Graduate School of Business'] },
  { input: 'Stanford University', shouldMatch: ['Stanford University', 'Stanford University Graduate School of Business'] },
  { input: 'CMU', shouldMatch: ['Carnegie Mellon University'] },
  { input: 'Carnegie Mellon', shouldMatch: ['Carnegie Mellon University'] },
  { input: 'UIUC', shouldMatch: ['University of Illinois Urbana-Champaign'] },
  { input: 'Cal Poly', shouldMatch: ['California Polytechnic State University-San Luis Obispo'] },

  // ── Big Ten / Other State Schools ──
  { input: 'UMich', shouldMatch: ['University of Michigan'] },
  { input: 'University of Michigan', shouldMatch: ['University of Michigan'] },
  { input: 'Penn State', shouldMatch: ['Penn State University'] },
  { input: 'Northwestern', shouldMatch: ['Northwestern University'] },
  { input: 'Duke', shouldMatch: ['Duke University'] },
  { input: 'Purdue', shouldMatch: ['Purdue University'] },
  { input: 'Indiana University', shouldMatch: ['Indiana University', 'Indiana University Bloomington'] },
  { input: 'UVA', shouldMatch: ['University of Virginia'] },

  // ── Boston Schools ──
  // "Boston University" keywords are [Boston, University] — matches BU primarily,
  // but also people whose schools JSON contains both "Boston" and "University" across entries.
  { input: 'Boston University', shouldMatch: ['Boston University'] },
  { input: 'Boston College', shouldMatch: ['Boston College'] },
  { input: 'BU', shouldMatch: ['Boston University'] },
  { input: 'BC', shouldMatch: ['Boston College'] },
  { input: 'Northeastern', shouldMatch: ['Northeastern University'] },
  { input: 'NEU', shouldMatch: ['Northeastern University'] },

  // ── Other ──
  { input: 'University of Chicago', shouldMatch: ['University of Chicago'] },
  { input: 'University of Washington', shouldMatch: ['University of Washington'] },
  { input: 'Texas State', shouldMatch: ['Texas State University'] },
];

async function testKeywordMatching(tc: TestCase): Promise<{ pass: boolean; details: string }> {
  const keywords = getUniversityKeywords(tc.input);

  // Build the same query the app would use — all keywords must ILIKE match
  const conditions = keywords.map(kw => {
    const term = '%' + kw + '%';
    return Prisma.sql`(p."educationSchool" ILIKE ${term} OR p.schools::text ILIKE ${term})`;
  });
  const whereClause = Prisma.join(conditions, ' AND ');

  const results = await prisma.$queryRaw<{ educationSchool: string; cnt: number }[]>(
    Prisma.sql`
      SELECT p."educationSchool", COUNT(*)::int as cnt
      FROM "Person" p
      WHERE ${whereClause}
        AND p."educationSchool" IS NOT NULL
      GROUP BY p."educationSchool"
      ORDER BY cnt DESC
      LIMIT 15
    `
  );

  const matchedNames = results.map(r => r.educationSchool);
  const errors: string[] = [];

  // Check expected matches
  for (const expected of tc.shouldMatch) {
    const found = matchedNames.some(name =>
      name.toLowerCase().includes(expected.toLowerCase()) ||
      expected.toLowerCase().includes(name.toLowerCase())
    );
    if (!found) {
      errors.push(`MISSING: expected "${expected}" but not in results`);
    }
  }

  // Check false positives
  if (tc.shouldNotMatch) {
    for (const bad of tc.shouldNotMatch) {
      const found = matchedNames.some(name =>
        name.toLowerCase() === bad.toLowerCase()
      );
      if (found) {
        errors.push(`FALSE POSITIVE: "${bad}" should NOT match but did`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      pass: false,
      details: `"${tc.input}" → keywords: [${keywords.join(', ')}]\n    Matched: [${matchedNames.slice(0, 5).join(', ')}]\n    ${errors.join('\n    ')}`,
    };
  }

  return {
    pass: true,
    details: `"${tc.input}" → [${keywords.join(', ')}] → ${results.reduce((sum, r) => sum + r.cnt, 0)} people across ${matchedNames.length} school variants`,
  };
}

async function main() {
  console.log(`\n🎓 University Keyword Matching Tests (${TEST_CASES.length} cases)\n${'='.repeat(60)}\n`);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of TEST_CASES) {
    const result = await testKeywordMatching(tc);
    if (result.pass) {
      console.log(`  PASS  ${result.details}`);
      passed++;
    } else {
      console.log(`  FAIL  ${result.details}`);
      failed++;
      failures.push(result.details);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length}`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  ${f}`));
  }

  console.log('');
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main();
