/**
 * Test script for Apollo pattern bootstrap flow
 *
 * Tests:
 * 1. For a company without a pattern, Apollo should be called
 * 2. Pattern should be learned from Apollo emails
 * 3. Remaining people should get emails generated from pattern
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  getOrLearnPattern,
  bootstrapCompanyPattern,
  normalizeCompanyName,
} from '../src/lib/services/email-pattern';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Testing Apollo Pattern Bootstrap ===\n');

  // Step 1: Check what patterns exist
  console.log('Step 1: Checking existing patterns...');
  const existingPatterns = await prisma.companyEmailPattern.findMany({
    select: { company: true, domain: true, pattern: true, confidence: true },
    orderBy: { company: 'asc' },
  });
  console.log(`  Found ${existingPatterns.length} existing patterns:`);
  existingPatterns.slice(0, 10).forEach(p => {
    console.log(`    - ${p.company}: ${p.pattern}@${p.domain} (${Math.round(p.confidence * 100)}%)`);
  });
  if (existingPatterns.length > 10) {
    console.log(`    ... and ${existingPatterns.length - 10} more`);
  }
  console.log('');

  // Step 2: Find a company that doesn't have a pattern but has people in DB
  console.log('Step 2: Finding a company without a pattern...');

  // Get companies with people but no pattern
  const companiesWithPeople = await prisma.person.groupBy({
    by: ['company'],
    _count: { id: true },
    where: {
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    having: {
      id: { _count: { gte: 3 } },
    },
    orderBy: { _count: { id: 'desc' } },
    take: 20,
  });

  console.log(`  Companies with 3+ people without emails:`);
  for (const c of companiesWithPeople.slice(0, 10)) {
    const normalized = normalizeCompanyName(c.company);
    const hasPattern = existingPatterns.some(p => p.company === normalized);
    console.log(`    - ${c.company} (${c._count.id} people) ${hasPattern ? '[HAS PATTERN]' : '[NO PATTERN]'}`);
  }
  console.log('');

  // Find a company without a pattern
  let testCompany: string | null = null;
  for (const c of companiesWithPeople) {
    const normalized = normalizeCompanyName(c.company);
    const hasPattern = existingPatterns.some(p => p.company === normalized);
    if (!hasPattern) {
      testCompany = c.company;
      break;
    }
  }

  if (!testCompany) {
    console.log('  No company found without a pattern. Testing with a known company instead.');
    // Use a company we know doesn't have a pattern - this will test the flow even if it fails
    testCompany = 'Accenture';
  }

  console.log(`  Selected test company: "${testCompany}"`);
  console.log('');

  // Step 3: Test getOrLearnPattern (should return null for new company)
  console.log('Step 3: Testing getOrLearnPattern...');
  const existingPattern = await getOrLearnPattern(testCompany);
  if (existingPattern) {
    console.log(`  Pattern already exists: ${existingPattern.pattern}@${existingPattern.domain}`);
    console.log('  Skipping bootstrap test (pattern already learned)');
  } else {
    console.log('  No pattern found - will need Apollo bootstrap');
  }
  console.log('');

  // Step 4: Get people for bootstrap test
  console.log('Step 4: Getting people for bootstrap...');
  const people = await prisma.person.findMany({
    where: {
      company: testCompany,
      email: null,
      firstName: { not: null },
      lastName: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      linkedinUrl: true,
    },
    take: 10,
  });

  console.log(`  Found ${people.length} people without emails at ${testCompany}:`);
  people.forEach(p => {
    console.log(`    - ${p.fullName} (${p.linkedinUrl ? 'has LinkedIn' : 'no LinkedIn'})`);
  });
  console.log('');

  if (people.length === 0) {
    console.log('  No people to test with. Exiting.');
    return;
  }

  // Step 5: Test bootstrapCompanyPattern (only if no existing pattern)
  if (!existingPattern && people.length >= 3) {
    console.log('Step 5: Testing bootstrapCompanyPattern...');
    console.log('  This will make Apollo API calls...');
    console.log('');

    const startTime = Date.now();
    const result = await bootstrapCompanyPattern(testCompany, people);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result) {
      console.log(`\n  Bootstrap successful in ${elapsed}s:`);
      console.log(`    Pattern: ${result.pattern}@${result.domain}`);
      console.log(`    Confidence: ${Math.round(result.confidence * 100)}%`);
      console.log(`    Apollo calls: ${result.apolloCallsMade}`);
      console.log(`    Emails found: ${result.emailsFound}`);
    } else {
      console.log(`\n  Bootstrap failed in ${elapsed}s - not enough emails from Apollo`);
    }
    console.log('');

    // Step 6: Verify pattern was saved
    console.log('Step 6: Verifying pattern was saved...');
    const savedPattern = await getOrLearnPattern(testCompany);
    if (savedPattern) {
      console.log(`  Pattern saved: ${savedPattern.pattern}@${savedPattern.domain} (${Math.round(savedPattern.confidence * 100)}%)`);
    } else {
      console.log('  No pattern saved (expected if Apollo didnt return enough emails)');
    }
    console.log('');

    // Step 7: Verify emails were saved to Person records
    console.log('Step 7: Checking Person records for Apollo emails...');
    const updatedPeople = await prisma.person.findMany({
      where: { id: { in: people.map(p => p.id) } },
      select: {
        fullName: true,
        email: true,
        emailStatus: true,
        apolloStatus: true,
        apolloEnrichedAt: true,
      },
    });

    const withEmail = updatedPeople.filter(p => p.email);
    const withApollo = updatedPeople.filter(p => p.apolloEnrichedAt);
    console.log(`  ${withEmail.length}/${updatedPeople.length} now have emails`);
    console.log(`  ${withApollo.length}/${updatedPeople.length} were processed by Apollo`);
    console.log('');
    updatedPeople.forEach(p => {
      console.log(`    - ${p.fullName}: ${p.email || 'no email'} (${p.apolloStatus || 'not processed'})`);
    });
  } else {
    console.log('Step 5: Skipping bootstrap test (pattern exists or not enough people)');
  }

  console.log('\n=== Test Complete ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
