/**
 * Migration script to extract and normalize school data from CSE snippets
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Map of variations to canonical school names
const SCHOOL_ALIASES: Record<string, string> = {
  // UT Austin variations
  'ut': 'University of Texas at Austin',
  'ut austin': 'University of Texas at Austin',
  'university of texas': 'University of Texas at Austin',
  'university of texas at austin': 'University of Texas at Austin',
  'the university of texas at austin': 'University of Texas at Austin',
  'texas mccombs': 'University of Texas at Austin',
  'mccombs school of business': 'University of Texas at Austin',
  'mccombs': 'University of Texas at Austin',
  'ut mccombs': 'University of Texas at Austin',
  'cockrell school of engineering': 'University of Texas at Austin',
  'ut cockrell': 'University of Texas at Austin',

  // Texas A&M variations
  'texas a&m': 'Texas A&M University',
  'texas a&m university': 'Texas A&M University',
  'tamu': 'Texas A&M University',
  'a&m': 'Texas A&M University',
  'mays business school': 'Texas A&M University',

  // Rice variations
  'rice': 'Rice University',
  'rice university': 'Rice University',
  'jones graduate school': 'Rice University',
  'rice jones': 'Rice University',

  // TCU variations
  'tcu': 'Texas Christian University',
  'texas christian': 'Texas Christian University',
  'texas christian university': 'Texas Christian University',
  'neeley school of business': 'Texas Christian University',

  // Yale variations
  'yale': 'Yale University',
  'yale university': 'Yale University',
  'yale som': 'Yale University',
  'yale school of management': 'Yale University',

  // Harvard variations
  'harvard': 'Harvard University',
  'harvard university': 'Harvard University',
  'harvard business school': 'Harvard University',
  'hbs': 'Harvard University',

  // Stanford variations
  'stanford': 'Stanford University',
  'stanford university': 'Stanford University',
  'stanford gsb': 'Stanford University',
  'stanford graduate school of business': 'Stanford University',

  // Wharton/Penn variations
  'wharton': 'University of Pennsylvania',
  'the wharton school': 'University of Pennsylvania',
  'wharton school': 'University of Pennsylvania',
  'upenn': 'University of Pennsylvania',
  'university of pennsylvania': 'University of Pennsylvania',
  'penn': 'University of Pennsylvania',

  // Columbia variations
  'columbia': 'Columbia University',
  'columbia university': 'Columbia University',
  'columbia business school': 'Columbia University',
  'cbs': 'Columbia University',

  // Duke variations
  'duke': 'Duke University',
  'duke university': 'Duke University',
  'fuqua': 'Duke University',
  'fuqua school of business': 'Duke University',

  // Northwestern variations
  'northwestern': 'Northwestern University',
  'northwestern university': 'Northwestern University',
  'kellogg': 'Northwestern University',
  'kellogg school of management': 'Northwestern University',

  // MIT variations
  'mit': 'Massachusetts Institute of Technology',
  'massachusetts institute of technology': 'Massachusetts Institute of Technology',
  'mit sloan': 'Massachusetts Institute of Technology',

  // Chicago variations
  'uchicago': 'University of Chicago',
  'university of chicago': 'University of Chicago',
  'chicago booth': 'University of Chicago',
  'booth school of business': 'University of Chicago',

  // Berkeley variations
  'berkeley': 'University of California, Berkeley',
  'uc berkeley': 'University of California, Berkeley',
  'university of california, berkeley': 'University of California, Berkeley',
  'haas': 'University of California, Berkeley',
  'haas school of business': 'University of California, Berkeley',

  // UCLA variations
  'ucla': 'University of California, Los Angeles',
  'university of california, los angeles': 'University of California, Los Angeles',
  'ucla anderson': 'University of California, Los Angeles',

  // USC variations
  'usc': 'University of Southern California',
  'university of southern california': 'University of Southern California',
  'usc marshall': 'University of Southern California',

  // NYU variations
  'nyu': 'New York University',
  'new york university': 'New York University',
  'nyu stern': 'New York University',
  'stern school of business': 'New York University',

  // Cornell variations
  'cornell': 'Cornell University',
  'cornell university': 'Cornell University',
  'johnson school': 'Cornell University',

  // Dartmouth variations
  'dartmouth': 'Dartmouth College',
  'dartmouth college': 'Dartmouth College',
  'tuck': 'Dartmouth College',
  'tuck school of business': 'Dartmouth College',

  // Princeton variations
  'princeton': 'Princeton University',
  'princeton university': 'Princeton University',

  // Brown variations
  'brown': 'Brown University',
  'brown university': 'Brown University',

  // UVA variations
  'uva': 'University of Virginia',
  'university of virginia': 'University of Virginia',
  'darden': 'University of Virginia',
  'darden school of business': 'University of Virginia',

  // Michigan variations
  'umich': 'University of Michigan',
  'university of michigan': 'University of Michigan',
  'michigan ross': 'University of Michigan',
  'ross school of business': 'University of Michigan',

  // Georgetown variations
  'georgetown': 'Georgetown University',
  'georgetown university': 'Georgetown University',
  'mcdonough school of business': 'Georgetown University',

  // Notre Dame variations
  'notre dame': 'University of Notre Dame',
  'university of notre dame': 'University of Notre Dame',
  'mendoza': 'University of Notre Dame',

  // Baylor variations
  'baylor': 'Baylor University',
  'baylor university': 'Baylor University',

  // SMU variations
  'smu': 'Southern Methodist University',
  'southern methodist university': 'Southern Methodist University',
  'cox school of business': 'Southern Methodist University',

  // LSU variations
  'lsu': 'Louisiana State University',
  'louisiana state': 'Louisiana State University',
  'louisiana state university': 'Louisiana State University',

  // Middlebury
  'middlebury': 'Middlebury College',
  'middlebury college': 'Middlebury College',

  // Emory
  'emory': 'Emory University',
  'emory university': 'Emory University',
  'goizueta': 'Emory University',

  // Vanderbilt
  'vanderbilt': 'Vanderbilt University',
  'vanderbilt university': 'Vanderbilt University',
  'owen school': 'Vanderbilt University',

  // Indiana
  'indiana university': 'Indiana University',
  'kelley school': 'Indiana University',

  // Ohio State
  'ohio state': 'Ohio State University',
  'ohio state university': 'Ohio State University',
  'fisher college': 'Ohio State University',

  // Carnegie Mellon
  'cmu': 'Carnegie Mellon University',
  'carnegie mellon': 'Carnegie Mellon University',
  'tepper': 'Carnegie Mellon University',

  // Boston College
  'boston college': 'Boston College',
  'bc': 'Boston College',

  // Boston University
  'boston university': 'Boston University',
  'bu questrom': 'Boston University',

  // Wake Forest
  'wake forest': 'Wake Forest University',
  'wake forest university': 'Wake Forest University',
};

// Patterns to extract school mentions from text
const SCHOOL_PATTERNS = [
  // "Education: School Name" pattern
  /Education:\s*([^·|]+)/i,
  // "@ School" in title
  /@\s*([A-Z][^|·-]+(?:University|College|School|Institute|MIT)[^|·-]*)/i,
  // "graduate from/of School"
  /graduate\s+(?:from|of)\s+([^·|,]+(?:University|College|School)[^·|,]*)/i,
  // School name followed by common patterns
  /([A-Z][a-zA-Z\s&]+(?:University|College|School of Business|School of Engineering|Institute of Technology))/,
];

// Words that indicate a bad parse
const BAD_PATTERNS = [
  /linkedin/i,
  /goldman sachs/i,
  /morgan stanley/i,
  /^the university$/i,
  /^senior at/i,
  /^incoming/i,
  /regions bank/i,
  /bain & company/i,
  /mckinsey/i,
  /jpmorgan/i,
];

function normalizeSchoolName(rawName: string): string | null {
  const lower = rawName.toLowerCase().trim();

  // Check for bad parses
  for (const pattern of BAD_PATTERNS) {
    if (pattern.test(rawName)) {
      return null;
    }
  }

  // Check direct alias match
  if (SCHOOL_ALIASES[lower]) {
    return SCHOOL_ALIASES[lower];
  }

  // Check if any alias is contained in the text
  for (const [alias, canonical] of Object.entries(SCHOOL_ALIASES)) {
    if (lower.includes(alias) && alias.length > 3) { // Avoid short matches
      return canonical;
    }
  }

  // If it looks like a valid school name, return cleaned version
  if (rawName.match(/University|College|School|Institute/i)) {
    // But reject if it's too short or looks wrong
    if (rawName.length < 10) return null;
    return rawName.trim().replace(/\s+/g, ' ');
  }

  return null;
}

function extractSchool(title: string | null, snippet: string | null): string | null {
  const text = `${title || ''} ${snippet || ''}`;

  // First, check for known school aliases directly in text
  const lowerText = text.toLowerCase();
  for (const [alias, canonical] of Object.entries(SCHOOL_ALIASES)) {
    // Only match longer aliases to avoid false positives
    if (alias.length >= 3 && lowerText.includes(alias)) {
      // Verify it's a word boundary match for short aliases
      if (alias.length <= 4) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        if (regex.test(text)) {
          return canonical;
        }
      } else {
        return canonical;
      }
    }
  }

  // Try regex patterns
  for (const pattern of SCHOOL_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const normalized = normalizeSchoolName(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

async function migrate() {
  console.log('=== School Data Migration ===\n');

  // Get all people with their sourceLinks
  const people = await prisma.person.findMany({
    select: {
      id: true,
      fullName: true,
      educationSchool: true,
      sourceLinks: {
        where: { kind: 'DISCOVERY' },
        select: { title: true, snippet: true },
        take: 1,
      },
    },
  });

  console.log(`Processing ${people.length} people...\n`);

  let updated = 0;
  let alreadyCorrect = 0;
  let noSchoolFound = 0;
  let changed = 0;

  const changes: Array<{ name: string; from: string | null; to: string }> = [];

  for (const person of people) {
    const sourceLink = person.sourceLinks[0];
    if (!sourceLink) {
      noSchoolFound++;
      continue;
    }

    const extractedSchool = extractSchool(sourceLink.title, sourceLink.snippet);

    if (!extractedSchool) {
      noSchoolFound++;
      continue;
    }

    // Check if update needed
    if (person.educationSchool === extractedSchool) {
      alreadyCorrect++;
      continue;
    }

    // Track change
    if (person.educationSchool && person.educationSchool !== extractedSchool) {
      changes.push({
        name: person.fullName,
        from: person.educationSchool,
        to: extractedSchool,
      });
      changed++;
    }

    // Update the record
    await prisma.person.update({
      where: { id: person.id },
      data: { educationSchool: extractedSchool },
    });
    updated++;
  }

  // Print changes
  if (changes.length > 0) {
    console.log('--- Schools Changed ---');
    changes.slice(0, 20).forEach((c) => {
      console.log(`${c.name}: "${c.from}" → "${c.to}"`);
    });
    if (changes.length > 20) {
      console.log(`... and ${changes.length - 20} more changes`);
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`Total people: ${people.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`Changed (was different): ${changed}`);
  console.log(`No school found in CSE data: ${noSchoolFound}`);

  // Verify
  const withSchool = await prisma.person.count({
    where: { educationSchool: { not: null } },
  });
  console.log(`\nPeople with educationSchool now: ${withSchool}/${people.length}`);

  // Show school distribution
  const schools = await prisma.person.groupBy({
    by: ['educationSchool'],
    _count: true,
    where: { educationSchool: { not: null } },
    orderBy: { _count: { educationSchool: 'desc' } },
    take: 15,
  });
  console.log('\n--- Top Schools ---');
  schools.forEach((s) => {
    console.log(`${s.educationSchool}: ${s._count}`);
  });

  await prisma.$disconnect();
}

migrate().catch(async (e) => {
  console.error('Migration error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
