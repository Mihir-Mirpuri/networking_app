import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get all unique companies with counts
  const companies = await prisma.person.groupBy({
    by: ['company'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  console.log('Company | Enriched | Total | %');
  console.log('--------|----------|-------|---');

  let totalPeople = 0;
  let totalEnriched = 0;

  for (const c of companies) {
    const total = c._count.id;
    const enriched = await prisma.person.count({
      where: {
        company: c.company,
        email: { not: null },
        role: { not: null },
        city: { not: null },
        educationSchool: { not: null },
      }
    });
    const pct = Math.round(enriched/total*100);
    console.log(`${c.company} | ${enriched} | ${total} | ${pct}%`);
    totalPeople += total;
    totalEnriched += enriched;
  }

  console.log('--------|----------|-------|---');
  console.log(`TOTAL | ${totalEnriched} | ${totalPeople} | ${Math.round(totalEnriched/totalPeople*100)}%`);

  await prisma.$disconnect();
}

main().catch(console.error);
