import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.person.count();

  const fullyEnriched = await prisma.person.count({
    where: {
      email: { not: null },
      role: { not: null },
      city: { not: null },
      educationSchool: { not: null },
    }
  });

  // Check each field individually
  const hasEmail = await prisma.person.count({ where: { email: { not: null } } });
  const hasRole = await prisma.person.count({ where: { role: { not: null } } });
  const hasLocation = await prisma.person.count({ where: { city: { not: null } } });
  const hasUniversity = await prisma.person.count({ where: { educationSchool: { not: null } } });

  console.log('=== ENRICHMENT STATS ===');
  console.log(`Total people: ${total}`);
  console.log(`Fully enriched (all 5 fields): ${fullyEnriched} (${Math.round(fullyEnriched/total*100)}%)`);
  console.log('');
  console.log('By field:');
  console.log(`  email: ${hasEmail} (${Math.round(hasEmail/total*100)}%)`);
  console.log(`  role: ${hasRole} (${Math.round(hasRole/total*100)}%)`);
  console.log(`  company: ${total} (100% - required field)`);
  console.log(`  location (city): ${hasLocation} (${Math.round(hasLocation/total*100)}%)`);
  console.log(`  university: ${hasUniversity} (${Math.round(hasUniversity/total*100)}%)`);

  await prisma.$disconnect();
}

main().catch(console.error);
