/**
 * Check email status for McKinsey + Harvard people
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const people = await prisma.person.findMany({
    where: {
      company: 'McKinsey & Company',
      educationSchool: 'Harvard University'
    },
    select: {
      fullName: true,
      email: true,
      emailStatus: true,
      role: true,
      apolloEnrichedAt: true,
    },
    take: 30,
  });

  console.log('People with McKinsey + Harvard:\n');
  for (const p of people) {
    const apolloAt = p.apolloEnrichedAt ? p.apolloEnrichedAt.toISOString().split('T')[0] : 'never';
    console.log(`  ${p.fullName}`);
    console.log(`    email: ${p.email || 'none'} (${p.emailStatus})`);
    console.log(`    role: ${p.role || 'none'}`);
    console.log(`    apolloEnrichedAt: ${apolloAt}`);
    console.log('');
  }

  const withEmail = people.filter(p => p.email).length;
  const withoutEmail = people.filter(p => !p.email).length;

  console.log('='.repeat(50));
  console.log(`Total checked: ${people.length}`);
  console.log(`With email: ${withEmail}`);
  console.log(`Without email: ${withoutEmail}`);

  await prisma.$disconnect();
}

main().catch(console.error);
