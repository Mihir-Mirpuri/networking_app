import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugBainSearch() {
  console.log('=== Debugging Bain & Company Search ===\n');

  // 1. Total Bain people
  const totalBain = await prisma.person.count({
    where: { company: { contains: 'Bain', mode: 'insensitive' } },
  });
  console.log(`1. Total Bain & Company people in DB: ${totalBain}`);

  // 2. Bain people with emails
  const bainWithEmails = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      email: { not: null },
    },
  });
  console.log(`2. Bain people with emails: ${bainWithEmails}`);

  // 3. Bain people with Houston location
  const bainHouston = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      city: { contains: 'Houston', mode: 'insensitive' },
    },
  });
  console.log(`3. Bain people in Houston: ${bainHouston}`);

  // 4. Bain people with "Associate" in role
  const bainAssociate = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      role: { contains: 'Associate', mode: 'insensitive' },
    },
  });
  console.log(`4. Bain people with "Associate" in role: ${bainAssociate}`);

  // 5. Bain people with UT Austin education
  const bainUTAustin = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      educationSchool: { contains: 'Texas', mode: 'insensitive' },
    },
  });
  console.log(`5. Bain people with "Texas" in education: ${bainUTAustin}`);

  // 6. Combine all filters
  const allFilters = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      city: { contains: 'Houston', mode: 'insensitive' },
      role: { contains: 'Associate', mode: 'insensitive' },
      educationSchool: { contains: 'Texas', mode: 'insensitive' },
      email: { not: null },
    },
  });
  console.log(`6. All filters combined (company + Houston + Associate + Texas + email): ${allFilters}`);

  // 7. Let's see the actual people matching all filters
  console.log('\n=== People matching all filters ===');
  const matchingPeople = await prisma.person.findMany({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      city: { contains: 'Houston', mode: 'insensitive' },
      role: { contains: 'Associate', mode: 'insensitive' },
      educationSchool: { contains: 'Texas', mode: 'insensitive' },
      email: { not: null },
    },
    select: {
      fullName: true,
      company: true,
      role: true,
      city: true,
      educationSchool: true,
      email: true,
    },
  });

  matchingPeople.forEach((p, i) => {
    console.log(`\n${i + 1}. ${p.fullName}`);
    console.log(`   Company: ${p.company}`);
    console.log(`   Role: ${p.role}`);
    console.log(`   City: ${p.city}`);
    console.log(`   School: ${p.educationSchool}`);
    console.log(`   Email: ${p.email}`);
  });

  // 8. What if we relax the role filter?
  console.log('\n=== Without role filter ===');
  const noRoleFilter = await prisma.person.count({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      city: { contains: 'Houston', mode: 'insensitive' },
      educationSchool: { contains: 'Texas', mode: 'insensitive' },
      email: { not: null },
    },
  });
  console.log(`Without role filter: ${noRoleFilter}`);

  // 9. What roles do Bain Houston UT Austin people have?
  console.log('\n=== Roles of Bain + Houston + UT Austin people ===');
  const roles = await prisma.person.findMany({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
      city: { contains: 'Houston', mode: 'insensitive' },
      educationSchool: { contains: 'Texas', mode: 'insensitive' },
      email: { not: null },
    },
    select: {
      fullName: true,
      role: true,
    },
  });
  roles.forEach((p) => {
    console.log(`  ${p.fullName}: ${p.role}`);
  });

  // 10. Check what's being searched for in recent searches
  console.log('\n=== Recent Bain searches ===');
  const recentSearches = await prisma.search.findMany({
    where: {
      company: { contains: 'Bain', mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      company: true,
      role: true,
      university: true,
      location: true,
      createdAt: true,
      _count: { select: { searchPeople: true } },
    },
  });
  recentSearches.forEach((s) => {
    console.log(`  Search: company=${s.company}, role=${s.role}, uni=${s.university}, loc=${s.location}`);
    console.log(`    People found: ${s._count.searchPeople}, Date: ${s.createdAt}`);
  });

  await prisma.$disconnect();
}

debugBainSearch().catch(console.error);
