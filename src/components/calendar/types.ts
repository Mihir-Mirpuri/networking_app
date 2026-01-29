// Shared types for calendar components

export interface CalendarEvent {
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

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  attendeeEmails?: string[];
  addGoogleMeet?: boolean;
}

export type ViewMode = 'week' | 'month';

export interface DateRange {
  start: Date;
  end: Date;
}
