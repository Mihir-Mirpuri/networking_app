import { listEvents } from '../../src/lib/services/calendar';

async function test() {
  const userId = 'cmkz9a9xm0002kyllt7r4lxzn';

  // Get events for this week
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  console.log('Fetching events from', weekStart.toISOString(), 'to', weekEnd.toISOString());
  console.log('');

  try {
    const events = await listEvents(userId, weekStart, weekEnd);

    console.log(`Found ${events.length} events:`);
    console.log('');

    if (events.length === 0) {
      console.log('No events found in this date range.');
      console.log('This could mean:');
      console.log('1. You have no events this week');
      console.log('2. Events are on a different calendar (not primary)');
    } else {
      events.forEach((event, i) => {
        console.log(`${i + 1}. ${event.summary}`);
        console.log(`   Start: ${event.start.toLocaleString()}`);
        console.log(`   End: ${event.end.toLocaleString()}`);
        console.log('');
      });
    }
  } catch (error: any) {
    console.error('ERROR fetching events:', error.message);
    console.error('');
    console.error('Full error:', error);
  }
}

test();
