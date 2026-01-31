import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const people = await prisma.person.findMany({
    where: {
      company: { contains: 'McKinsey', mode: 'insensitive' },
      email: { not: null },
      OR: [
        { role: null },
        { city: null }
      ]
    },
    select: {
      fullName: true,
      linkedinUrl: true,
      role: true,
      city: true
    },
    orderBy: { fullName: 'asc' }
  });

  for (const p of people) {
    const missing: string[] = [];
    if (!p.role) missing.push('role');
    if (!p.city) missing.push('location');
    console.log(`${p.fullName} | ${p.linkedinUrl || 'NO LINKEDIN'} | Missing: ${missing.join(', ')}`);
  }

  await prisma.$disconnect();
}
main();
