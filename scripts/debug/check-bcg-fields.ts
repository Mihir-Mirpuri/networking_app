import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const bcg = await prisma.person.findMany({
    where: { company: 'Boston Consulting Group' },
    select: { fullName: true, email: true, role: true, city: true, educationSchool: true },
  });

  let hasAll = 0, missingEmail = 0, missingRole = 0, missingCity = 0, missingSchool = 0;

  for (const p of bcg) {
    if (p.email && p.role && p.city && p.educationSchool) hasAll++;
    if (!p.email) missingEmail++;
    if (!p.role) missingRole++;
    if (!p.city) missingCity++;
    if (!p.educationSchool) missingSchool++;
  }

  console.log(`BCG Total: ${bcg.length}`);
  console.log(`Fully enriched: ${hasAll}`);
  console.log('');
  console.log('Missing fields:');
  console.log(`  email: ${missingEmail}`);
  console.log(`  role: ${missingRole}`);
  console.log(`  city: ${missingCity}`);
  console.log(`  university: ${missingSchool}`);

  await prisma.$disconnect();
}

main().catch(console.error);
