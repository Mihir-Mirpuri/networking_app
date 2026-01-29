/**
 * Script to fix existing users with Google accounts but calendarConnected = false
 *
 * Run with: npx tsx tests/calendar/fix-existing-users.ts
 *
 * This verifies calendar access for all users and updates their calendarConnected flag.
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env file');
  process.exit(1);
}

const prisma = new PrismaClient({ log: ['error', 'warn'] });

import { verifyCalendarAccessOnSignIn } from '@/lib/services/calendar';

async function fixExistingUsers() {
  console.log('🔧 Fixing Calendar Access for Existing Users\n');

  await prisma.$connect();

  // Find all users with Google accounts
  const usersWithGoogleAccounts = await prisma.user.findMany({
    where: {
      accounts: {
        some: {
          provider: 'google',
          refresh_token: { not: null },
        },
      },
    },
    select: {
      id: true,
      email: true,
      calendarConnected: true,
    },
  });

  console.log(`Found ${usersWithGoogleAccounts.length} users with Google accounts\n`);

  let fixed = 0;
  let alreadyConnected = 0;
  let failed = 0;

  for (const user of usersWithGoogleAccounts) {
    process.stdout.write(`Processing ${user.email}... `);

    if (user.calendarConnected) {
      console.log('already connected ✓');
      alreadyConnected++;
      continue;
    }

    try {
      const result = await verifyCalendarAccessOnSignIn(user.id);
      if (result) {
        console.log('fixed ✓');
        fixed++;
      } else {
        console.log('no calendar access ✗');
        failed++;
      }
    } catch (error) {
      console.log('error ✗');
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Results:`);
  console.log(`  Already connected: ${alreadyConnected}`);
  console.log(`  Fixed: ${fixed}`);
  console.log(`  Failed/No access: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

fixExistingUsers().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
