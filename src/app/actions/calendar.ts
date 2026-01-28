'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  checkConflicts,
  suggestAvailableTimes,
  hasCalendarAccess,
  markCalendarConnected,
  markCalendarDisconnected,
  CalendarEvent,
  CalendarEventDisplay,
  ConflictCheckResult,
  NoCalendarAccessError,
} from '@/lib/services/calendar';

// ============================================================================
// Types
// ============================================================================

export interface CalendarActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  requiresReauth?: boolean;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string; // ISO 8601
  endDateTime: string;   // ISO 8601
  timeZone?: string;
  attendeeEmails?: string[];
  addGoogleMeet?: boolean;
}

export interface UpdateEventInput {
  summary?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  timeZone?: string;
  attendeeEmails?: string[];
}

// ============================================================================
// Calendar Access Check
// ============================================================================

/**
 * Checks if the current user has granted calendar access.
 * If user claims to have access but API fails, marks as disconnected.
 * Returns requiresReauth: true if they need to re-authenticate.
 */
export async function checkCalendarAccessAction(): Promise<
  CalendarActionResult<{ hasAccess: boolean }>
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // First check if we've already verified access
    const hasAccess = await hasCalendarAccess(session.user.id);

    if (hasAccess) {
      return {
        success: true,
        data: { hasAccess: true },
      };
    }

    // User doesn't have access marked - they need to re-auth
    return {
      success: true,
      data: { hasAccess: false },
      requiresReauth: true,
    };
  } catch (error) {
    console.error('[Calendar Action] Error checking access:', error);
    return { success: false, error: 'Failed to check calendar access' };
  }
}

/**
 * Verifies calendar access by making a test API call.
 * Call this after user re-authenticates to confirm access works.
 * Marks user as connected if successful.
 */
export async function verifyAndMarkCalendarAccessAction(): Promise<
  CalendarActionResult<{ verified: boolean }>
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Try to list events as a test (small date range)
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await listEvents(session.user.id, now, tomorrow, 1);

    // If we get here, access works - mark as connected
    await markCalendarConnected(session.user.id);

    return {
      success: true,
      data: { verified: true },
    };
  } catch (error) {
    console.error('[Calendar Action] Verification failed:', error);

    if (error instanceof NoCalendarAccessError) {
      await markCalendarDisconnected(session.user.id);
      return {
        success: true,
        data: { verified: false },
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to verify calendar access' };
  }
}

// ============================================================================
// List Events
// ============================================================================

/**
 * Lists calendar events within a date range.
 */
export async function listCalendarEventsAction(
  startDate: string, // ISO 8601
  endDate: string,    // ISO 8601
  maxResults?: number
): Promise<CalendarActionResult<CalendarEventDisplay[]>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const events = await listEvents(
      session.user.id,
      new Date(startDate),
      new Date(endDate),
      maxResults
    );

    return { success: true, data: events };
  } catch (error) {
    console.error('[Calendar Action] Error listing events:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted. Please re-authenticate.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to fetch calendar events' };
  }
}

// ============================================================================
// Get Single Event
// ============================================================================

/**
 * Gets a single calendar event by ID.
 */
export async function getCalendarEventAction(
  eventId: string
): Promise<CalendarActionResult<CalendarEventDisplay | null>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const event = await getEvent(session.user.id, eventId);
    return { success: true, data: event };
  } catch (error) {
    console.error('[Calendar Action] Error getting event:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to fetch calendar event' };
  }
}

// ============================================================================
// Create Event
// ============================================================================

/**
 * Creates a new calendar event.
 */
export async function createCalendarEventAction(
  input: CreateEventInput
): Promise<CalendarActionResult<CalendarEventDisplay>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Validate required fields
  if (!input.summary?.trim()) {
    return { success: false, error: 'Event title is required' };
  }

  if (!input.startDateTime || !input.endDateTime) {
    return { success: false, error: 'Start and end times are required' };
  }

  const startDate = new Date(input.startDateTime);
  const endDate = new Date(input.endDateTime);

  if (endDate <= startDate) {
    return { success: false, error: 'End time must be after start time' };
  }

  try {
    const event: CalendarEvent = {
      summary: input.summary.trim(),
      description: input.description?.trim(),
      location: input.location?.trim(),
      start: {
        dateTime: input.startDateTime,
        timeZone: input.timeZone || 'America/New_York',
      },
      end: {
        dateTime: input.endDateTime,
        timeZone: input.timeZone || 'America/New_York',
      },
      attendees: input.attendeeEmails?.map((email) => ({ email })),
    };

    // Add Google Meet if requested
    if (input.addGoogleMeet) {
      event.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const createdEvent = await createEvent(session.user.id, event);

    return { success: true, data: createdEvent };
  } catch (error) {
    console.error('[Calendar Action] Error creating event:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to create calendar event' };
  }
}

// ============================================================================
// Update Event
// ============================================================================

/**
 * Updates an existing calendar event.
 */
export async function updateCalendarEventAction(
  eventId: string,
  input: UpdateEventInput
): Promise<CalendarActionResult<CalendarEventDisplay>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!eventId) {
    return { success: false, error: 'Event ID is required' };
  }

  try {
    const updates: Partial<CalendarEvent> = {};

    if (input.summary !== undefined) {
      updates.summary = input.summary.trim();
    }
    if (input.description !== undefined) {
      updates.description = input.description.trim();
    }
    if (input.location !== undefined) {
      updates.location = input.location.trim();
    }
    if (input.startDateTime) {
      updates.start = {
        dateTime: input.startDateTime,
        timeZone: input.timeZone || 'America/New_York',
      };
    }
    if (input.endDateTime) {
      updates.end = {
        dateTime: input.endDateTime,
        timeZone: input.timeZone || 'America/New_York',
      };
    }
    if (input.attendeeEmails) {
      updates.attendees = input.attendeeEmails.map((email) => ({ email }));
    }

    const updatedEvent = await updateEvent(session.user.id, eventId, updates);

    return { success: true, data: updatedEvent };
  } catch (error) {
    console.error('[Calendar Action] Error updating event:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to update calendar event' };
  }
}

// ============================================================================
// Delete Event
// ============================================================================

/**
 * Deletes a calendar event.
 */
export async function deleteCalendarEventAction(
  eventId: string
): Promise<CalendarActionResult<void>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!eventId) {
    return { success: false, error: 'Event ID is required' };
  }

  try {
    await deleteEvent(session.user.id, eventId);
    return { success: true };
  } catch (error) {
    console.error('[Calendar Action] Error deleting event:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to delete calendar event' };
  }
}

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Checks if a proposed time slot conflicts with existing events.
 */
export async function checkCalendarConflictsAction(
  startDateTime: string, // ISO 8601
  durationMinutes: number
): Promise<CalendarActionResult<ConflictCheckResult>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!startDateTime) {
    return { success: false, error: 'Start time is required' };
  }

  if (durationMinutes <= 0) {
    return { success: false, error: 'Duration must be positive' };
  }

  try {
    const result = await checkConflicts(
      session.user.id,
      new Date(startDateTime),
      durationMinutes
    );

    return { success: true, data: result };
  } catch (error) {
    console.error('[Calendar Action] Error checking conflicts:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to check calendar conflicts' };
  }
}

// ============================================================================
// Suggest Available Times
// ============================================================================

/**
 * Suggests available time slots for scheduling.
 */
export async function suggestAvailableTimesAction(
  startDate: string, // ISO 8601
  endDate: string,
  durationMinutes: number,
  preferredStartHour?: number,
  preferredEndHour?: number
): Promise<CalendarActionResult<string[]>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!startDate || !endDate) {
    return { success: false, error: 'Start and end dates are required' };
  }

  if (durationMinutes <= 0) {
    return { success: false, error: 'Duration must be positive' };
  }

  try {
    const suggestions = await suggestAvailableTimes(
      session.user.id,
      new Date(startDate),
      new Date(endDate),
      durationMinutes,
      {
        start: preferredStartHour ?? 9,
        end: preferredEndHour ?? 17,
      }
    );

    // Convert to ISO strings for serialization
    return {
      success: true,
      data: suggestions.map((d) => d.toISOString()),
    };
  } catch (error) {
    console.error('[Calendar Action] Error suggesting times:', error);

    if (error instanceof NoCalendarAccessError) {
      return {
        success: false,
        error: 'Calendar access not granted.',
        requiresReauth: true,
      };
    }

    return { success: false, error: 'Failed to suggest available times' };
  }
}

// ============================================================================
// Quick Event Creation (for networking meetings)
// ============================================================================

/**
 * Creates a coffee chat / networking meeting with sensible defaults.
 */
export async function createNetworkingMeetingAction(input: {
  contactName: string;
  contactEmail?: string;
  startDateTime: string;
  durationMinutes?: number;
  meetingType?: 'coffee_chat' | 'phone_call' | 'video_call';
  location?: string;
  notes?: string;
}): Promise<CalendarActionResult<CalendarEventDisplay>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const duration = input.durationMinutes || 30;
  const startDate = new Date(input.startDateTime);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  // Generate title based on meeting type
  let title: string;
  switch (input.meetingType) {
    case 'phone_call':
      title = `Phone call with ${input.contactName}`;
      break;
    case 'video_call':
      title = `Video call with ${input.contactName}`;
      break;
    case 'coffee_chat':
    default:
      title = `Coffee chat with ${input.contactName}`;
  }

  // Build description
  const descriptionParts: string[] = [];
  if (input.notes) {
    descriptionParts.push(input.notes);
  }
  descriptionParts.push(`\n---\nScheduled via Alumni Reach`);

  return createCalendarEventAction({
    summary: title,
    description: descriptionParts.join('\n'),
    location: input.location,
    startDateTime: startDate.toISOString(),
    endDateTime: endDate.toISOString(),
    attendeeEmails: input.contactEmail ? [input.contactEmail] : undefined,
    addGoogleMeet: input.meetingType === 'video_call',
  });
}
