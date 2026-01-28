import { google, calendar_v3 } from 'googleapis';
import prisma from '@/lib/prisma';

/**
 * Custom error classes for Calendar client operations
 */
export class NoGoogleAccountError extends Error {
  constructor(userId: string) {
    super(`No Google account linked for user ${userId}`);
    this.name = 'NoGoogleAccountError';
  }
}

export class NoRefreshTokenError extends Error {
  constructor(userId: string) {
    super(`No refresh token available for user ${userId}`);
    this.name = 'NoRefreshTokenError';
  }
}

export class CalendarApiError extends Error {
  constructor(message: string, public originalError?: unknown) {
    super(`Calendar API error: ${message}`);
    this.name = 'CalendarApiError';
  }
}

export class NoCalendarAccessError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has not granted calendar access. Re-authentication required.`);
    this.name = 'NoCalendarAccessError';
  }
}

/**
 * Calendar event interface matching Google Calendar API structure
 */
export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime: string; // ISO 8601 format
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  conferenceData?: {
    createRequest?: {
      requestId: string;
      conferenceSolutionKey: { type: string };
    };
  };
}

/**
 * Simplified event for display
 */
export interface CalendarEventDisplay {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  attendees: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  htmlLink?: string;
  hangoutLink?: string;
}

/**
 * Free/busy time slot
 */
export interface BusySlot {
  start: Date;
  end: Date;
}

/**
 * Conflict check result
 */
export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingEvents: CalendarEventDisplay[];
}

/**
 * Gets an authenticated Google Calendar client for a user with automatic token refresh.
 */
export async function getCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
  // 1. Fetch user's OAuth account from Prisma
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: 'google',
    },
    select: {
      access_token: true,
      refresh_token: true,
      expires_at: true,
      scope: true,
    },
  });

  if (!account) {
    throw new NoGoogleAccountError(userId);
  }

  // 2. Check if calendar scope is granted
  if (account.scope && !account.scope.includes('calendar')) {
    throw new NoCalendarAccessError(userId);
  }

  // 3. Validate that refresh_token exists (required for auto-refresh)
  if (!account.refresh_token) {
    throw new NoRefreshTokenError(userId);
  }

  // 4. Get OAuth credentials from environment
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured');
  }

  // 5. Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  // 6. Set credentials
  oauth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token,
  });

  // 7. Configure automatic token refresh with database updates
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const expiresAt = tokens.expiry_date
        ? Math.floor(tokens.expiry_date / 1000)
        : null;

      try {
        await prisma.account.updateMany({
          where: {
            userId,
            provider: 'google',
          },
          data: {
            access_token: tokens.access_token,
            ...(expiresAt && { expires_at: expiresAt }),
          },
        });
        console.log('[Calendar] Token refreshed and database updated for user', userId);
      } catch (error) {
        console.error('[Calendar] Failed to update token in database:', error);
      }
    }
  });

  // 8. Create and return Calendar client
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  return calendar;
}

/**
 * Lists calendar events within a date range.
 */
export async function listEvents(
  userId: string,
  startDate: Date,
  endDate: Date,
  maxResults: number = 50
): Promise<CalendarEventDisplay[]> {
  try {
    const calendar = await getCalendarClient(userId);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      maxResults,
      singleEvents: true, // Expand recurring events
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    return events.map((event) => ({
      id: event.id || '',
      summary: event.summary || '(No title)',
      description: event.description || undefined,
      location: event.location || undefined,
      start: new Date(event.start?.dateTime || event.start?.date || ''),
      end: new Date(event.end?.dateTime || event.end?.date || ''),
      isAllDay: !event.start?.dateTime,
      attendees: (event.attendees || []).map((a) => ({
        email: a.email || '',
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus || undefined,
      })),
      htmlLink: event.htmlLink || undefined,
      hangoutLink: event.hangoutLink || undefined,
    }));
  } catch (error: any) {
    // Check if it's a scope/permission error
    if (error?.code === 403 || error?.message?.includes('insufficient')) {
      throw new NoCalendarAccessError(userId);
    }
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to list events',
      error
    );
  }
}

/**
 * Gets a single calendar event by ID.
 */
export async function getEvent(
  userId: string,
  eventId: string
): Promise<CalendarEventDisplay | null> {
  try {
    const calendar = await getCalendarClient(userId);

    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId,
    });

    const event = response.data;

    return {
      id: event.id || '',
      summary: event.summary || '(No title)',
      description: event.description || undefined,
      location: event.location || undefined,
      start: new Date(event.start?.dateTime || event.start?.date || ''),
      end: new Date(event.end?.dateTime || event.end?.date || ''),
      isAllDay: !event.start?.dateTime,
      attendees: (event.attendees || []).map((a) => ({
        email: a.email || '',
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus || undefined,
      })),
      htmlLink: event.htmlLink || undefined,
      hangoutLink: event.hangoutLink || undefined,
    };
  } catch (error: any) {
    if (error?.code === 404) {
      return null;
    }
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to get event',
      error
    );
  }
}

/**
 * Creates a new calendar event.
 */
export async function createEvent(
  userId: string,
  event: CalendarEvent
): Promise<CalendarEventDisplay> {
  try {
    const calendar = await getCalendarClient(userId);

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        attendees: event.attendees,
        reminders: event.reminders,
        conferenceData: event.conferenceData,
      },
      conferenceDataVersion: event.conferenceData ? 1 : undefined,
      sendUpdates: event.attendees?.length ? 'all' : 'none',
    });

    const created = response.data;

    console.log('[Calendar] Event created:', created.id);

    return {
      id: created.id || '',
      summary: created.summary || '(No title)',
      description: created.description || undefined,
      location: created.location || undefined,
      start: new Date(created.start?.dateTime || created.start?.date || ''),
      end: new Date(created.end?.dateTime || created.end?.date || ''),
      isAllDay: !created.start?.dateTime,
      attendees: (created.attendees || []).map((a) => ({
        email: a.email || '',
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus || undefined,
      })),
      htmlLink: created.htmlLink || undefined,
      hangoutLink: created.hangoutLink || undefined,
    };
  } catch (error: any) {
    if (error?.code === 403) {
      throw new NoCalendarAccessError(userId);
    }
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to create event',
      error
    );
  }
}

/**
 * Updates an existing calendar event.
 */
export async function updateEvent(
  userId: string,
  eventId: string,
  updates: Partial<CalendarEvent>
): Promise<CalendarEventDisplay> {
  try {
    const calendar = await getCalendarClient(userId);

    const response = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: {
        summary: updates.summary,
        description: updates.description,
        location: updates.location,
        start: updates.start,
        end: updates.end,
        attendees: updates.attendees,
        reminders: updates.reminders,
      },
      sendUpdates: updates.attendees?.length ? 'all' : 'none',
    });

    const updated = response.data;

    console.log('[Calendar] Event updated:', updated.id);

    return {
      id: updated.id || '',
      summary: updated.summary || '(No title)',
      description: updated.description || undefined,
      location: updated.location || undefined,
      start: new Date(updated.start?.dateTime || updated.start?.date || ''),
      end: new Date(updated.end?.dateTime || updated.end?.date || ''),
      isAllDay: !updated.start?.dateTime,
      attendees: (updated.attendees || []).map((a) => ({
        email: a.email || '',
        displayName: a.displayName || undefined,
        responseStatus: a.responseStatus || undefined,
      })),
      htmlLink: updated.htmlLink || undefined,
      hangoutLink: updated.hangoutLink || undefined,
    };
  } catch (error: any) {
    if (error?.code === 404) {
      throw new CalendarApiError('Event not found', error);
    }
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to update event',
      error
    );
  }
}

/**
 * Deletes a calendar event.
 */
export async function deleteEvent(
  userId: string,
  eventId: string
): Promise<void> {
  try {
    const calendar = await getCalendarClient(userId);

    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });

    console.log('[Calendar] Event deleted:', eventId);
  } catch (error: any) {
    if (error?.code === 404) {
      // Event already deleted, treat as success
      return;
    }
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to delete event',
      error
    );
  }
}

/**
 * Gets free/busy information for a time range.
 */
export async function getFreeBusy(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<BusySlot[]> {
  try {
    const calendar = await getCalendarClient(userId);

    // Get user's email for the freeBusy query
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      throw new Error('User email not found');
    }

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        items: [{ id: user.email }],
      },
    });

    const busySlots = response.data.calendars?.[user.email]?.busy || [];

    return busySlots.map((slot) => ({
      start: new Date(slot.start || ''),
      end: new Date(slot.end || ''),
    }));
  } catch (error: any) {
    throw new CalendarApiError(
      error instanceof Error ? error.message : 'Failed to get free/busy',
      error
    );
  }
}

/**
 * Checks if a proposed time slot conflicts with existing events.
 */
export async function checkConflicts(
  userId: string,
  startTime: Date,
  durationMinutes: number
): Promise<ConflictCheckResult> {
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  // Add buffer around the time range to catch adjacent events
  const searchStart = new Date(startTime.getTime() - 30 * 60 * 1000);
  const searchEnd = new Date(endTime.getTime() + 30 * 60 * 1000);

  const events = await listEvents(userId, searchStart, searchEnd);

  const conflictingEvents = events.filter((event) => {
    // Check for overlap: event starts before proposed end AND event ends after proposed start
    return event.start < endTime && event.end > startTime;
  });

  return {
    hasConflict: conflictingEvents.length > 0,
    conflictingEvents,
  };
}

/**
 * Suggests available time slots within a date range.
 */
export async function suggestAvailableTimes(
  userId: string,
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  preferredHours: { start: number; end: number } = { start: 9, end: 17 }
): Promise<Date[]> {
  const busySlots = await getFreeBusy(userId, startDate, endDate);
  const suggestions: Date[] = [];

  // Iterate through each day
  const currentDay = new Date(startDate);
  currentDay.setHours(preferredHours.start, 0, 0, 0);

  while (currentDay < endDate && suggestions.length < 5) {
    // Skip weekends
    const dayOfWeek = currentDay.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDay.setDate(currentDay.getDate() + 1);
      currentDay.setHours(preferredHours.start, 0, 0, 0);
      continue;
    }

    // Check each 30-minute slot during preferred hours
    const dayEnd = new Date(currentDay);
    dayEnd.setHours(preferredHours.end, 0, 0, 0);

    while (currentDay < dayEnd && suggestions.length < 5) {
      const slotEnd = new Date(currentDay.getTime() + durationMinutes * 60 * 1000);

      // Check if this slot overlaps with any busy period
      const isConflict = busySlots.some(
        (busy) => currentDay < busy.end && slotEnd > busy.start
      );

      if (!isConflict && slotEnd <= dayEnd) {
        suggestions.push(new Date(currentDay));
      }

      // Move to next 30-minute slot
      currentDay.setMinutes(currentDay.getMinutes() + 30);
    }

    // Move to next day
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(preferredHours.start, 0, 0, 0);
  }

  return suggestions;
}

/**
 * Checks if a user has granted calendar access.
 */
export async function hasCalendarAccess(userId: string): Promise<boolean> {
  try {
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'google',
      },
      select: {
        scope: true,
      },
    });

    if (!account?.scope) {
      return false;
    }

    return account.scope.includes('calendar');
  } catch {
    return false;
  }
}
