import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const user = await prisma.user.findUnique({
    where: { email: 'mihirmirpuri@gmail.com' },
    select: {
      id: true,
      email: true,
      calendarConnected: true,
      accounts: {
        where: { provider: 'google' },
        select: {
          provider: true,
          access_token: true,
          refresh_token: true,
          expires_at: true,
          scope: true,
        }
      }
    }
  });

  if (!user) {
    console.log('User not found');
    return;
  }

  console.log('=== USER CALENDAR STATUS ===');
  console.log('User ID:', user.id);
  console.log('Email:', user.email);
  console.log('Calendar Connected flag:', user.calendarConnected);
  console.log('');

  if (user.accounts.length === 0) {
    console.log('ERROR: No Google account linked!');
  } else {
    const account = user.accounts[0];
    console.log('=== GOOGLE ACCOUNT ===');
    console.log('Has access_token:', !!account.access_token);
    console.log('Has refresh_token:', !!account.refresh_token);
    console.log('Token expires_at:', account.expires_at ? new Date(account.expires_at * 1000).toISOString() : 'N/A');
    console.log('');
    console.log('Stored scope:', account.scope || 'Not stored in DB');

    // Check if calendar scope is present
    if (account.scope) {
      const hasCalendarScope = account.scope.includes('calendar');
      console.log('Has calendar scope:', hasCalendarScope);
    }
  }

  await prisma.$disconnect();
}

check().catch(console.error);
