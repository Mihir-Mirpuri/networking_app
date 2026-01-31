import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function exportMissingRoles() {
  const people = await prisma.person.findMany({
    where: {
      email: { not: null },
      role: null
    },
    select: {
      fullName: true,
      company: true,
      email: true,
      linkedinUrl: true,
    },
    orderBy: { company: 'asc' }
  });

  let output = `PEOPLE WITH MISSING ROLES (${people.length} total)\n`;
  output += '='.repeat(60) + '\n\n';

  let currentCompany = '';
  for (const p of people) {
    if (p.company !== currentCompany) {
      currentCompany = p.company;
      output += `\n--- ${currentCompany} ---\n`;
    }
    output += p.fullName;
    if (p.linkedinUrl) {
      output += ` | ${p.linkedinUrl}`;
    }
    output += '\n';
  }

  fs.writeFileSync('missing-roles.txt', output);
  console.log(`Saved ${people.length} people to missing-roles.txt`);

  await prisma.$disconnect();
}

exportMissingRoles().catch(console.error);
