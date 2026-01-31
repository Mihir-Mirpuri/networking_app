import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function restoreCities() {
  const logPath = '/Users/kavithanair/.claude/projects/-Users-kavithanair-Documents-networking-app/7f7c4370-2beb-4b5d-ac8c-0e4d4ff7c7b8/tool-results/toolu_01BMx1TuWJsCFiHBGTkhE8Sa.txt';

  const log = fs.readFileSync(logPath, 'utf8');
  const lines = log.split('\n');

  console.log('=== RESTORING CITIES FROM APOLLO LOG ===\n');

  let currentPerson: { name: string; company: string } | null = null;
  let restored = 0;
  let notFound = 0;

  for (const line of lines) {
    // Match: [X/Y] Enriching: Name @ Company
    const enrichMatch = line.match(/Enriching: (.+) @ (.+)/);
    if (enrichMatch) {
      currentPerson = { name: enrichMatch[1], company: enrichMatch[2] };
      continue;
    }

    // Match: Found: ... location: City, State, Country ...
    const locationMatch = line.match(/location: ([^,]+), ([^,]+), ([^,]+)/);
    if (locationMatch && currentPerson) {
      const city = locationMatch[1];
      const state = locationMatch[2];
      const country = locationMatch[3];

      // Find the person in database
      const person = await prisma.person.findFirst({
        where: {
          fullName: { contains: currentPerson.name },
          company: { contains: currentPerson.company.split(' ')[0] },
        },
        select: { id: true, fullName: true }
      });

      if (person) {
        await prisma.person.update({
          where: { id: person.id },
          data: { city, state, country }
        });
        restored++;
        if (restored % 50 === 0) {
          console.log(`Restored ${restored} cities...`);
        }
      } else {
        notFound++;
      }

      currentPerson = null;
    }
  }

  console.log(`\nDone! Restored ${restored} cities, ${notFound} not found in DB`);

  await prisma.$disconnect();
}

restoreCities().catch(console.error);
