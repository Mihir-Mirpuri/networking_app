import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.person.count();
  const withEmail = await prisma.person.count({ where: { email: { not: null } } });
  const withoutEmail = await prisma.person.count({ where: { email: null } });
  const verified = await prisma.person.count({ where: { emailStatus: 'VERIFIED' } });
  const unverified = await prisma.person.count({ where: { emailStatus: 'UNVERIFIED' } });
  const missing = await prisma.person.count({ where: { emailStatus: 'MISSING' } });

  console.log('=== PERSON TABLE STATS ===');
  console.log(`Total people: ${total}`);
  console.log(`With email: ${withEmail} (${Math.round(withEmail/total*100)}%)`);
  console.log(`Without email: ${withoutEmail} (${Math.round(withoutEmail/total*100)}%)`);
  console.log('');
  console.log('By status:');
  console.log(`  VERIFIED: ${verified}`);
  console.log(`  UNVERIFIED: ${unverified}`);
  console.log(`  MISSING: ${missing}`);

  await prisma.$disconnect();
}

main().catch(console.error);
