/**
 * Debug script to see what events are being returned from Google Calendar
 *
 * Run with: npx tsx tests/calendar/debug-calendar-events.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Use DIRECT_URL to avoid connection pool issues
const prisma = new PrismaClient({
  log: ['error'],
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

import { google } from 'googleapis';

async function debugCalendarEvents() {
  console.log('🔍 Debugging Calendar Events\n');

  await prisma.$connect();

  // Find a user with calendar access
  const user = await prisma.user.findFirst({
    where: {
      calendarConnected: true,
      accounts: {
        some: {
          provider: 'google',
          refresh_token: { not: null },
        },
      },
    },
    include: {
      accounts: {
        where: { provider: 'google' },
      },
    },
  });

  if (!user) {
    console.error('❌ No user with calendar access found');
    process.exit(1);
  }

  console.log(`📧 User: ${user.email}`);
  console.log(`📅 Calendar connected: ${user.calendarConnected}\n`);

  const account = user.accounts[0];
  if (!account?.refresh_token) {
    console.error('❌ No refresh token');
    process.exit(1);
  }

  // Create OAuth client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Get current week range
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  console.log(`📆 Date range: ${startOfWeek.toDateString()} - ${endOfWeek.toDateString()}\n`);

  try {
    // First, list all calendars the user has access to
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1️⃣  LISTING ALL CALENDARS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const calendarList = await calendar.calendarList.list();
    const calendars = calendarList.data.items || [];

    console.log(`Found ${calendars.length} calendars:\n`);
    for (const cal of calendars) {
      const isPrimary = cal.primary ? '⭐ PRIMARY' : '';
      const selected = cal.selected ? '✓ selected' : '✗ hidden';
      console.log(`  ${isPrimary} ${cal.summary}`);
      console.log(`    ID: ${cal.id}`);
      console.log(`    ${selected}, accessRole: ${cal.accessRole}`);
      console.log('');
    }

    // Now fetch events from primary calendar
    console.log('═══════════════════════════════════════════════════════════');
    console.log('2️⃣  EVENTS FROM PRIMARY CALENDAR (what the app fetches)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const primaryEvents = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfWeek.toISOString(),
      timeMax: endOfWeek.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const primaryItems = primaryEvents.data.items || [];
    console.log(`Found ${primaryItems.length} events in PRIMARY calendar this week:\n`);

    for (const event of primaryItems) {
      const start = event.start?.dateTime || event.start?.date || 'unknown';
      const isRecurring = event.recurringEventId ? '🔄 recurring' : '';
      console.log(`  • ${event.summary || '(No title)'}`);
      console.log(`    Start: ${start} ${isRecurring}`);
      if (event.recurringEventId) {
        console.log(`    Recurring ID: ${event.recurringEventId}`);
      }
      console.log('');
    }

    // Check if there are other calendars with events
    console.log('═══════════════════════════════════════════════════════════');
    console.log('3️⃣  EVENTS FROM OTHER CALENDARS (not shown in app)');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const cal of calendars) {
      if (cal.primary || !cal.id) continue;

      try {
        const otherEvents = await calendar.events.list({
          calendarId: cal.id,
          timeMin: startOfWeek.toISOString(),
          timeMax: endOfWeek.toISOString(),
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const otherItems = otherEvents.data.items || [];
        if (otherItems.length > 0) {
          console.log(`📅 ${cal.summary} (${otherItems.length} events):`);
          for (const event of otherItems.slice(0, 5)) {
            const start = event.start?.dateTime || event.start?.date || 'unknown';
            console.log(`  • ${event.summary || '(No title)'} - ${start}`);
          }
          if (otherItems.length > 5) {
            console.log(`  ... and ${otherItems.length - 5} more`);
          }
          console.log('');
        }
      } catch (err) {
        // Skip calendars we can't read
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\nThe app currently only shows events from the PRIMARY calendar.`);
    console.log(`If your recurring events are on a different calendar, they won't appear.`);
    console.log(`\nTo fix: Either move events to primary calendar, or update the app`);
    console.log(`to fetch from multiple calendars.`);

  } catch (error: unknown) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);

    const err = error as { code?: number; message?: string };
    if (err.code === 403) {
      console.error('\n💡 This might be a scope issue. User may need to re-authenticate.');
    }
  }

  await prisma.$disconnect();
}

debugCalendarEvents().catch(console.error);
