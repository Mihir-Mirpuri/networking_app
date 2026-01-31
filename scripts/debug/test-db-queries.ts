/**
 * Test database query functionality (no API calls)
 * Tests the findPeopleByFilters function directly
 */

import { findPeopleByFilters } from '../src/lib/db/person-service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Database Query Tests ===\n');

  // Check what data exists
  console.log('--- Existing Data Summary ---');
  const totalPeople = await prisma.person.count();
  const withEmail = await prisma.person.count({ where: { email: { not: null } } });
  const withApollo = await prisma.person.count({ where: { apolloEnrichedAt: { not: null } } });
  const withCity = await prisma.person.count({ where: { city: { not: null } } });

  console.log(`Total people: ${totalPeople}`);
  console.log(`With email: ${withEmail}`);
  console.log(`With Apollo data: ${withApollo}`);
  console.log(`With city: ${withCity}`);
  console.log('');

  // Get unique companies
  const companies = await prisma.person.groupBy({
    by: ['company'],
    _count: true,
    orderBy: { _count: { company: 'desc' } },
    take: 10,
  });
  console.log('Top companies in DB:');
  companies.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.company} (${c._count} people)`);
  });
  console.log('');

  // Get unique cities
  const cities = await prisma.person.groupBy({
    by: ['city'],
    _count: true,
    where: { city: { not: null } },
    orderBy: { _count: { city: 'desc' } },
    take: 10,
  });
  console.log('Top cities in DB:');
  cities.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.city} (${c._count} people)`);
  });
  console.log('');

  // Test queries if we have data
  if (companies.length > 0) {
    const testCompany = companies[0].company;
    console.log(`--- Testing filters with "${testCompany}" ---`);

    // Test 1: Company only
    const companyOnly = await findPeopleByFilters({
      company: testCompany,
      requireEmail: true,
      limit: 50,
    });
    console.log(`${testCompany} with email: ${companyOnly.length}`);

    // Test 2: Check result structure
    if (companyOnly.length > 0) {
      const sample = companyOnly[0];
      console.log('Sample result structure:');
      console.log(`  - id: ${sample.id}`);
      console.log(`  - fullName: ${sample.fullName}`);
      console.log(`  - company: ${sample.company}`);
      console.log(`  - role: ${sample.role}`);
      console.log(`  - email: ${sample.email}`);
      console.log(`  - city: ${sample.city}`);
      console.log(`  - emailStatus: ${sample.emailStatus}`);
    }
  }

  console.log('\n=== Tests Complete ===');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Test error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
