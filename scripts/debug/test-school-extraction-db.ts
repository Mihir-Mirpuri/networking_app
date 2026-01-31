import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KNOWN_UNIVERSITIES = [
  'Rice University',
  'Texas A&M University',
  'Texas Christian University',
  'The University of Texas at Austin',
  'University of Texas at Austin',
  'Duke University',
  'Stanford University',
  'Harvard University',
  'Yale University',
  'The Wharton School',
  'Columbia University',
  'University of Pennsylvania',
  'Northwestern University',
];

function extractSchool(title: string | null, snippet: string | null): string | null {
  const text = `${title || ''} ${snippet || ''}`;

  for (const uni of KNOWN_UNIVERSITIES) {
    if (text.includes(uni)) return uni;
  }

  // Fallback regex for Education: pattern
  const eduMatch = text.match(/Education:\s*([^·|]+(?:University|College|School)[^·|]*)/i);
  if (eduMatch) return eduMatch[1].trim();

  return null;
}

async function test() {
  const links = await prisma.sourceLink.findMany({
    select: {
      title: true,
      snippet: true,
      person: { select: { fullName: true, educationSchool: true } },
    },
    take: 50,
  });

  let extracted = 0;
  let mismatches = 0;
  let noExtract = 0;

  for (const l of links) {
    const school = extractSchool(l.title, l.snippet);

    if (school) {
      extracted++;
      const current = l.person.educationSchool || '';

      // Check if mismatch
      const isMatch = !current ||
        school === current ||
        school.includes(current) ||
        current.includes(school);

      if (!isMatch) {
        console.log(`MISMATCH: ${l.person.fullName}`);
        console.log(`  CSE says: ${school}`);
        console.log(`  DB has:   ${current}`);
        mismatches++;
      }
    } else {
      noExtract++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Extracted school from ${extracted}/50 records`);
  console.log(`Could not extract: ${noExtract}`);
  console.log(`Mismatches found: ${mismatches}`);

  await prisma.$disconnect();
}

test().catch(console.error);
