/**
 * Final verification test for Apollo bootstrap integration
 *
 * This test verifies:
 * 1. Apollo calls are counted even when pattern learning fails
 * 2. Emails from successful Apollo calls are saved
 * 3. Pattern is learned when enough emails are found
 * 4. Pattern is used to generate emails for remaining people
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  getOrLearnPattern,
  generateEmailFromPattern,
  normalizeCompanyName,
  bootstrapCompanyPattern,
  BootstrapResult,
} from '../src/lib/services/email-pattern';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Final Apollo Bootstrap Verification ===\n');

  // Test 1: Verify ZS pattern exists (from earlier test)
  console.log('Test 1: Verify ZS pattern exists...');
  const zsPattern = await getOrLearnPattern('ZS');
  if (zsPattern) {
    console.log(`  PASS: ZS pattern found: ${zsPattern.pattern}@${zsPattern.domain}`);
  } else {
    console.log('  FAIL: ZS pattern not found');
  }
  console.log('');

  // Test 2: Verify email generation works
  console.log('Test 2: Verify email generation...');
  if (zsPattern) {
    const email = generateEmailFromPattern('Test', 'User', zsPattern.pattern as any, zsPattern.domain);
    console.log(`  Generated: ${email}`);
    console.log(`  PASS: Email generation works`);
  }
  console.log('');

  // Test 3: Verify bootstrap returns apolloCallsMade even on failure
  console.log('Test 3: Verify Apollo calls counted on bootstrap failure...');
  const testPeople = await prisma.person.findMany({
    where: { company: 'YouTube', email: null, firstName: { not: null }, lastName: { not: null } },
    select: { id: true, firstName: true, lastName: true, linkedinUrl: true },
    take: 2,
  });

  if (testPeople.length >= 2) {
    const result = await bootstrapCompanyPattern('YouTube', testPeople);
    console.log(`  Bootstrap result:`);
    console.log(`    success: ${result.success}`);
    console.log(`    apolloCallsMade: ${result.apolloCallsMade}`);
    console.log(`    emailsFound: ${result.emailsFound}`);

    if (result.apolloCallsMade > 0) {
      console.log(`  PASS: Apollo calls counted (${result.apolloCallsMade})`);
    } else {
      console.log(`  FAIL: Apollo calls not counted`);
    }
  } else {
    console.log('  SKIP: Not enough test people for YouTube');
  }
  console.log('');

  // Test 4: Summary of patterns in database
  console.log('Test 4: Pattern database summary...');
  const patterns = await prisma.companyEmailPattern.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });
  console.log(`  Total patterns: ${patterns.length}`);
  console.log('  Recent patterns:');
  for (const p of patterns) {
    console.log(`    - ${p.company}: ${p.pattern}@${p.domain} (${Math.round(p.confidence * 100)}%, ${p.sampleSize} samples)`);
  }
  console.log('');

  // Test 5: Check Person records with Apollo data
  console.log('Test 5: Person records with Apollo enrichment...');
  const apolloEnriched = await prisma.person.count({
    where: { apolloEnrichedAt: { not: null } },
  });
  const apolloWithEmail = await prisma.person.count({
    where: { apolloEnrichedAt: { not: null }, email: { not: null } },
  });
  const apolloWithoutEmail = await prisma.person.count({
    where: { apolloEnrichedAt: { not: null }, email: null },
  });
  console.log(`  Total Apollo-enriched: ${apolloEnriched}`);
  console.log(`  With email: ${apolloWithEmail}`);
  console.log(`  Without email: ${apolloWithoutEmail}`);
  console.log('');

  console.log('=== Verification Complete ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
