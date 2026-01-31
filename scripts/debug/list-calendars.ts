import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listCalendars() {
  const userId = 'cmkz9a9xm0002kyllt7r4lxzn';

  // Get account
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
    select: { access_token: true, refresh_token: true },
  });

  if (!account?.refresh_token) {
    console.log('No refresh token');
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // List all calendars
  const calendarList = await calendar.calendarList.list();

  console.log('=== YOUR CALENDARS ===\n');

  for (const cal of calendarList.data.items || []) {
    console.log(`Calendar: ${cal.summary}`);
    console.log(`  ID: ${cal.id}`);
    console.log(`  Primary: ${cal.primary || false}`);
    console.log(`  Access Role: ${cal.accessRole}`);
    console.log('');

    // Count events this week for each calendar
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    try {
      const events = await calendar.events.list({
        calendarId: cal.id!,
        timeMin: weekStart.toISOString(),
        timeMax: weekEnd.toISOString(),
        singleEvents: true,
        maxResults: 50,
      });

      const eventCount = events.data.items?.length || 0;
      console.log(`  Events this week: ${eventCount}`);

      if (eventCount > 0) {
        events.data.items?.forEach((e) => {
          console.log(`    - ${e.summary || '(No title)'}`);
        });
      }
    } catch (err: any) {
      console.log(`  (Could not fetch events: ${err.message})`);
    }

    console.log('');
  }

  await prisma.$disconnect();
}

listCalendars().catch(console.error);
