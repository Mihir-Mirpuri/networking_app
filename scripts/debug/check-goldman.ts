import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const gs = await prisma.person.findMany({
    where: { company: 'Goldman Sachs' },
    select: { fullName: true, email: true, role: true, city: true, educationSchool: true, apolloStatus: true },
  });

  let hasAll = 0, missingEmail = 0, missingRole = 0, missingCity = 0, missingSchool = 0;

  for (const p of gs) {
    if (p.email && p.role && p.city && p.educationSchool) hasAll++;
    if (!p.email) missingEmail++;
    if (!p.role) missingRole++;
    if (!p.city) missingCity++;
    if (!p.educationSchool) missingSchool++;
  }

  console.log(`Goldman Sachs Total: ${gs.length}`);
  console.log(`Fully enriched: ${hasAll} (${Math.round(hasAll/gs.length*100)}%)`);
  console.log('');
  console.log('Missing fields:');
  console.log(`  email: ${missingEmail}`);
  console.log(`  role: ${missingRole}`);
  console.log(`  city: ${missingCity}`);
  console.log(`  university: ${missingSchool}`);

  // Show some examples missing city
  console.log('');
  console.log('Sample people missing city (first 15):');
  const missingCityPeople = gs.filter(p => !p.city).slice(0, 15);
  for (const p of missingCityPeople) {
    console.log(`  ${p.fullName} | role=${p.role || 'none'} | school=${p.educationSchool || 'none'} | apolloStatus=${p.apolloStatus}`);
  }

  // Check apolloStatus distribution for those missing city
  const missingCityAll = gs.filter(p => !p.city);
  const statusCounts: Record<string, number> = {};
  for (const p of missingCityAll) {
    const status = p.apolloStatus || 'null';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  console.log('');
  console.log('Apollo status for people missing city:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
