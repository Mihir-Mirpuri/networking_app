'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createCalendarEventAction, CreateEventInput } from './calendar';
import {
  ExtractedMeetingData,
  MeetingSuggestionWithMessage,
} from '@/lib/types/meetingSuggestion';

// ============================================================================
// Types
// ============================================================================

export interface SuggestionActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  requiresReauth?: boolean;
}

// ============================================================================
// Get Pending Suggestions
// ============================================================================

/**
 * Fetches all pending meeting suggestions for the current user.
 * Includes related message data for context.
 */
export async function getPendingSuggestionsAction(): Promise<
  SuggestionActionResult<MeetingSuggestionWithMessage[]>
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const suggestions = await prisma.extractedMeetingSuggestion.findMany({
      where: {
        userId: session.user.id,
        status: 'PENDING',
      },
      include: {
        message: {
          select: {
            subject: true,
            sender: true,
            received_at: true,
            body_text: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform to match MeetingSuggestionWithMessage type
    const result: MeetingSuggestionWithMessage[] = suggestions.map((s) => ({
      id: s.id,
      userId: s.userId,
      messageId: s.messageId,
      status: s.status,
      extractedData: s.extractedData as unknown as ExtractedMeetingData,
      confidence: s.confidence,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      message: {
        subject: s.message.subject,
        sender: s.message.sender,
        received_at: s.message.received_at,
        body_text: s.message.body_text,
      },
    }));

    return { success: true, data: result };
  } catch (error) {
    console.error('[MeetingSuggestions] Error fetching pending suggestions:', error);
    return { success: false, error: 'Failed to fetch suggestions' };
  }
}

// ============================================================================
// Get Suggestion by ID
// ============================================================================

/**
 * Fetches a single meeting suggestion by ID.
 * Used for viewing/editing before accepting.
 */
export async function getSuggestionByIdAction(
  suggestionId: string
): Promise<SuggestionActionResult<MeetingSuggestionWithMessage>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!suggestionId) {
    return { success: false, error: 'Suggestion ID is required' };
  }

  try {
    const suggestion = await prisma.extractedMeetingSuggestion.findFirst({
      where: {
        id: suggestionId,
        userId: session.user.id,
      },
      include: {
        message: {
          select: {
            subject: true,
            sender: true,
            received_at: true,
            body_text: true,
          },
        },
      },
    });

    if (!suggestion) {
      return { success: false, error: 'Suggestion not found' };
    }

    const result: MeetingSuggestionWithMessage = {
      id: suggestion.id,
      userId: suggestion.userId,
      messageId: suggestion.messageId,
      status: suggestion.status,
      extractedData: suggestion.extractedData as unknown as ExtractedMeetingData,
      confidence: suggestion.confidence,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      message: {
        subject: suggestion.message.subject,
        sender: suggestion.message.sender,
        received_at: suggestion.message.received_at,
        body_text: suggestion.message.body_text,
      },
    };

    return { success: true, data: result };
  } catch (error) {
    console.error('[MeetingSuggestions] Error fetching suggestion:', error);
    return { success: false, error: 'Failed to fetch suggestion' };
  }
}

// ============================================================================
// Accept Suggestion
// ============================================================================

/**
 * Accepts a meeting suggestion and creates a calendar event.
 * Optionally allows overriding the extracted event data.
 */
export async function acceptSuggestionAction(
  suggestionId: string,
  eventDataOverride?: Partial<CreateEventInput>
): Promise<SuggestionActionResult<{ eventId: string }>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!suggestionId) {
    return { success: false, error: 'Suggestion ID is required' };
  }

  try {
    // 1. Fetch and validate the suggestion
    const suggestion = await prisma.extractedMeetingSuggestion.findFirst({
      where: {
        id: suggestionId,
        userId: session.user.id,
      },
    });

    if (!suggestion) {
      return { success: false, error: 'Suggestion not found' };
    }

    if (suggestion.status !== 'PENDING') {
      return { success: false, error: `Suggestion already ${suggestion.status.toLowerCase()}` };
    }

    // 2. Extract event data
    const extractedData = suggestion.extractedData as unknown as ExtractedMeetingData;

    // 3. Build calendar event input
    // Extract email strings from attendees (which may be objects with {name, email})
    const attendeeEmails = extractedData.attendees?.map((a: string | { email?: string }) =>
      typeof a === 'string' ? a : a.email
    ).filter((email): email is string => !!email);

    const eventInput: CreateEventInput = {
      summary: eventDataOverride?.summary ?? extractedData.title,
      description: eventDataOverride?.description ?? extractedData.description,
      location: eventDataOverride?.location ?? extractedData.location,
      startDateTime: eventDataOverride?.startDateTime ?? extractedData.startTime,
      endDateTime: eventDataOverride?.endDateTime ?? calculateEndTime(extractedData),
      timeZone: eventDataOverride?.timeZone,
      attendeeEmails: eventDataOverride?.attendeeEmails ?? attendeeEmails,
      addGoogleMeet: eventDataOverride?.addGoogleMeet,
    };

    // 4. Create calendar event
    const calendarResult = await createCalendarEventAction(eventInput);

    if (!calendarResult.success) {
      return {
        success: false,
        error: calendarResult.error || 'Failed to create calendar event',
        requiresReauth: calendarResult.requiresReauth,
      };
    }

    // 5. Mark suggestion as accepted
    await prisma.extractedMeetingSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'ACCEPTED' },
    });

    return {
      success: true,
      data: { eventId: calendarResult.data!.id },
    };
  } catch (error) {
    console.error('[MeetingSuggestions] Error accepting suggestion:', error);
    return { success: false, error: 'Failed to accept suggestion' };
  }
}

// ============================================================================
// Dismiss Suggestion
// ============================================================================

/**
 * Dismisses a meeting suggestion (marks it as not wanted).
 */
export async function dismissSuggestionAction(
  suggestionId: string
): Promise<SuggestionActionResult<void>> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!suggestionId) {
    return { success: false, error: 'Suggestion ID is required' };
  }

  try {
    // 1. Fetch and validate the suggestion
    const suggestion = await prisma.extractedMeetingSuggestion.findFirst({
      where: {
        id: suggestionId,
        userId: session.user.id,
      },
    });

    if (!suggestion) {
      return { success: false, error: 'Suggestion not found' };
    }

    if (suggestion.status !== 'PENDING') {
      return { success: false, error: `Suggestion already ${suggestion.status.toLowerCase()}` };
    }

    // 2. Mark as dismissed
    await prisma.extractedMeetingSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'DISMISSED' },
    });

    return { success: true };
  } catch (error) {
    console.error('[MeetingSuggestions] Error dismissing suggestion:', error);
    return { success: false, error: 'Failed to dismiss suggestion' };
  }
}

// ============================================================================
// Get Pending Count (for badge)
// ============================================================================

/**
 * Returns the count of pending meeting suggestions.
 * Optimized for use in navigation badges.
 */
export async function getPendingSuggestionsCountAction(): Promise<
  SuggestionActionResult<number>
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const count = await prisma.extractedMeetingSuggestion.count({
      where: {
        userId: session.user.id,
        status: 'PENDING',
      },
    });

    return { success: true, data: count };
  } catch (error) {
    console.error('[MeetingSuggestions] Error counting suggestions:', error);
    return { success: false, error: 'Failed to count suggestions' };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculates end time from extracted data.
 * Uses endTime if available, otherwise calculates from duration (default 30 min).
 */
function calculateEndTime(data: ExtractedMeetingData): string {
  if (data.endTime) {
    return data.endTime;
  }

  const startDate = new Date(data.startTime);
  const durationMinutes = data.duration ?? 30;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  return endDate.toISOString();
}
