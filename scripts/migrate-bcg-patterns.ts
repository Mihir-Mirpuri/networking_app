/**
 * Normalize BCG email patterns
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get BCG patterns
  const patterns = await prisma.companyEmailPattern.findMany({
    where: {
      OR: [
        { company: { contains: 'boston', mode: 'insensitive' } },
        { company: { contains: 'bcg', mode: 'insensitive' } },
      ],
    },
  });

  console.log('Before:');
  for (const p of patterns) {
    console.log(`  "${p.company}" → ${p.domain} (${p.pattern}, unverifiable=${p.unverifiable})`);
  }

  // Delete variant patterns, keep normalized one
  const deleted = await prisma.companyEmailPattern.deleteMany({
    where: {
      domain: 'bcg.com',
      company: { not: 'boston consulting group' },
    },
  });
  console.log(`\nDeleted ${deleted.count} variant patterns`);

  // Update the remaining pattern to ensure it's unverifiable
  await prisma.companyEmailPattern.updateMany({
    where: { domain: 'bcg.com' },
    data: { unverifiable: true },
  });

  // Verify
  const after = await prisma.companyEmailPattern.findMany({
    where: { domain: 'bcg.com' },
  });
  console.log('\nAfter:');
  for (const p of after) {
    console.log(`  "${p.company}" → ${p.domain} (${p.pattern}, unverifiable=${p.unverifiable})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
