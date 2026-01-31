/**
 * Test location filter specifically
 */

import { findPeopleByFilters } from '../src/lib/db/person-service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Location Filter Tests ===\n');

  // Test 1: Goldman Sachs + Houston
  console.log('--- Test 1: Goldman Sachs + Houston ---');
  const gsHouston = await findPeopleByFilters({
    company: 'Goldman Sachs',
    location: 'Houston',
    requireEmail: true,
    limit: 50,
  });
  console.log(`Goldman Sachs + Houston with email: ${gsHouston.length}`);
  gsHouston.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} - ${p.city}, ${p.state} - ${p.email}`);
  });
  console.log('');

  // Test 2: Goldman Sachs + New York
  console.log('--- Test 2: Goldman Sachs + New York ---');
  const gsNY = await findPeopleByFilters({
    company: 'Goldman Sachs',
    location: 'New York',
    requireEmail: true,
    limit: 50,
  });
  console.log(`Goldman Sachs + New York with email: ${gsNY.length}`);
  gsNY.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} - ${p.city}, ${p.state} - ${p.email}`);
  });
  console.log('');

  // Test 3: Goldman Sachs + Dallas
  console.log('--- Test 3: Goldman Sachs + Dallas ---');
  const gsDallas = await findPeopleByFilters({
    company: 'Goldman Sachs',
    location: 'Dallas',
    requireEmail: true,
    limit: 50,
  });
  console.log(`Goldman Sachs + Dallas with email: ${gsDallas.length}`);
  gsDallas.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.fullName} - ${p.city}, ${p.state} - ${p.email}`);
  });
  console.log('');

  // Test 4: Verify NO results without matching location
  console.log('--- Test 4: Hard Filter Verification ---');
  const gsHoustonCities = gsHouston.map(p => p.city?.toLowerCase() || '');
  const nonHouston = gsHoustonCities.filter(c => !c.includes('houston'));
  console.log(`Houston results without 'houston' in city: ${nonHouston.length} (should be 0)`);
  if (nonHouston.length > 0) {
    console.log(`  ❌ FAIL - Found non-Houston cities: ${nonHouston.join(', ')}`);
  } else {
    console.log(`  ✅ PASS - All Houston results have Houston in city`);
  }

  // Test 5: Verify all results have email
  const noEmail = gsHouston.filter(p => !p.email).length;
  console.log(`Houston results without email: ${noEmail} (should be 0)`);
  if (noEmail > 0) {
    console.log(`  ❌ FAIL - Found ${noEmail} results without email`);
  } else {
    console.log(`  ✅ PASS - All results have email`);
  }

  console.log('\n=== Tests Complete ===');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Test error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
