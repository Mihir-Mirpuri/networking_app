import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { getOrFindEmail } from '../src/lib/services/email-cache';

async function main() {
  // Get the 18 Booz Allen people we just scraped
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const people = await prisma.person.findMany({
    where: {
      createdAt: { gte: cutoff },
      company: { contains: 'Booz Allen', mode: 'insensitive' },
    },
    select: {
      fullName: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Testing Apollo on ${people.length} Booz Allen profiles...\n`);

  let withEmail = 0;
  let withoutEmail = 0;

  for (const person of people) {
    console.log(`Checking: ${person.fullName}...`);

    const result = await getOrFindEmail({
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      linkedinUrl: person.linkedinUrl,
    });

    if (result.email) {
      withEmail++;
      console.log(`  ✅ Email: ${result.email} (${result.status})`);
    } else {
      withoutEmail++;
      console.log(`  ❌ No email found`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`With email: ${withEmail}`);
  console.log(`Without email: ${withoutEmail}`);
  console.log(`Success rate: ${((withEmail / people.length) * 100).toFixed(1)}%`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
