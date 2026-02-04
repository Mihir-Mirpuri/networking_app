/**
 * Migrate BCG company names to normalized form
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeCompanyForStorage(company: string): string {
  if (!company) return company;
  let normalized = company.trim();
  normalized = normalized.replace(/^The\s+/i, '');
  normalized = normalized.replace(/\s*\([^)]+\)\s*$/, '');
  normalized = normalized.replace(/,\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation)$/i, '');
  normalized = normalized.replace(/\s+(Inc\.?|LLC|LLP|Ltd\.?|Corp\.?|Corporation|Co\.)$/i, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/[,&]\s*$/, '').trim();
  return normalized;
}

async function main() {
  // Get all BCG variations
  const bcgPeople = await prisma.person.findMany({
    where: {
      OR: [
        { company: { contains: 'boston consulting', mode: 'insensitive' } },
        { company: { contains: 'bcg', mode: 'insensitive' } },
      ],
    },
    select: { id: true, company: true, fullName: true },
  });

  console.log('Found', bcgPeople.length, 'BCG people');

  // Group by current company name
  const byCompany: Record<string, number> = {};
  for (const p of bcgPeople) {
    byCompany[p.company] = (byCompany[p.company] || 0) + 1;
  }
  console.log('\nCurrent distribution:');
  for (const [company, count] of Object.entries(byCompany)) {
    console.log(`  "${company}": ${count}`);
  }

  // Update to normalized name
  const targetName = 'Boston Consulting Group';
  let updated = 0;
  let skipped = 0;

  for (const person of bcgPeople) {
    const normalized = normalizeCompanyForStorage(person.company);
    if (normalized === targetName && person.company !== targetName) {
      try {
        await prisma.person.update({
          where: { id: person.id },
          data: { company: targetName },
        });
        updated++;
      } catch (e: any) {
        // Unique constraint violation - person already exists with normalized name
        if (e.code === 'P2002') {
          console.log(`Skipping duplicate: ${person.fullName}`);
          skipped++;
        } else {
          throw e;
        }
      }
    }
  }

  console.log(`\nUpdated ${updated} records to "${targetName}"`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} duplicates`);
  }

  // Verify
  const afterCounts = await prisma.person.groupBy({
    by: ['company'],
    where: {
      OR: [
        { company: { contains: 'boston consulting', mode: 'insensitive' } },
        { company: { contains: 'bcg', mode: 'insensitive' } },
      ],
    },
    _count: true,
  });
  console.log('\nAfter migration:');
  for (const c of afterCounts) {
    console.log(`  "${c.company}": ${c._count}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
