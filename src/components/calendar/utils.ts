// Calendar utility functions

import { CalendarEvent, DateRange } from './types';

// ============================================================================
// Date Range Calculations
// ============================================================================

export function getWeekRange(date: Date): DateRange {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function getMonthRange(date: Date): DateRange {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Gets all days to display in a month grid (including prev/next month padding)
 */
export function getMonthGridDays(date: Date): Date[] {
  const days: Date[] = [];
  const { start: monthStart, end: monthEnd } = getMonthRange(date);

  // Add days from previous month to fill first week
  const firstDayOfWeek = monthStart.getDay();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = new Date(monthStart);
    day.setDate(day.getDate() - i - 1);
    days.push(day);
  }

  // Add all days of current month
  const currentDay = new Date(monthStart);
  while (currentDay <= monthEnd) {
    days.push(new Date(currentDay));
    currentDay.setDate(currentDay.getDate() + 1);
  }

  // Add days from next month to complete last week
  const lastDayOfWeek = monthEnd.getDay();
  for (let i = 1; i < 7 - lastDayOfWeek; i++) {
    const day = new Date(monthEnd);
    day.setDate(day.getDate() + i);
    days.push(day);
  }

  return days;
}

/**
 * Gets all days in a week starting from the given week start date
 */
export function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    days.push(day);
  }
  return days;
}

// ============================================================================
// Date Comparisons
// ============================================================================

export function isToday(date: Date): boolean {
  const today = new Date();
  return isSameDay(date, today);
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

export function isSameMonth(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth()
  );
}

// ============================================================================
// Formatting
// ============================================================================

export function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
  });
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function formatDayHeader(date: Date): { dayName: string; dayNumber: string } {
  return {
    dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
    dayNumber: date.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric' }),
  };
}

export function formatForDateTimeInput(date: Date): string {
  return date.toISOString().slice(0, 16);
}

// ============================================================================
// Event Positioning (Week View)
// ============================================================================

const HOUR_HEIGHT = 48; // pixels per hour
const START_HOUR = 0; // 12 AM
const END_HOUR = 24; // 12 AM next day

/**
 * Calculates the top position and height for an event in the week view
 */
export function calculateEventPosition(event: CalendarEvent): {
  top: number;
  height: number;
} {
  const startHour = event.start.getHours() + event.start.getMinutes() / 60;
  const endHour = event.end.getHours() + event.end.getMinutes() / 60;

  // Handle events that end at midnight (show as ending at 24:00)
  const adjustedEndHour = endHour === 0 && event.end.getDate() !== event.start.getDate()
    ? 24
    : endHour;

  const top = (startHour - START_HOUR) * HOUR_HEIGHT;
  const height = Math.max((adjustedEndHour - startHour) * HOUR_HEIGHT, HOUR_HEIGHT / 2);

  return { top, height };
}

/**
 * Resolves overlapping events by assigning columns
 * Returns a map of event ID to { column, totalColumns }
 */
export function resolveOverlappingEvents(
  events: CalendarEvent[]
): Map<string, { column: number; totalColumns: number }> {
  const result = new Map<string, { column: number; totalColumns: number }>();

  if (events.length === 0) return result;

  // Sort events by start time, then by duration (longer first)
  const sorted = [...events].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) return startDiff;
    return (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime());
  });

  // Group overlapping events
  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [];
  let groupEnd = new Date(0);

  for (const event of sorted) {
    if (event.start >= groupEnd) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [event];
      groupEnd = event.end;
    } else {
      currentGroup.push(event);
      if (event.end > groupEnd) {
        groupEnd = event.end;
      }
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Assign columns within each group
  for (const group of groups) {
    const columns: CalendarEvent[][] = [];

    for (const event of group) {
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        const lastInColumn = columns[col][columns[col].length - 1];
        if (event.start >= lastInColumn.end) {
          columns[col].push(event);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
      }
    }

    const totalColumns = columns.length;
    columns.forEach((column, colIndex) => {
      column.forEach((event) => {
        result.set(event.id, { column: colIndex, totalColumns });
      });
    });
  }

  return result;
}

// ============================================================================
// Event Grouping
// ============================================================================

/**
 * Groups events by day (using date string as key)
 */
export function groupEventsByDay(
  events: CalendarEvent[]
): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const dateKey = event.start.toDateString();
    const existing = grouped.get(dateKey) || [];
    existing.push(event);
    grouped.set(dateKey, existing);
  }

  // Sort events within each day
  grouped.forEach((dayEvents) => {
    dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  return grouped;
}

/**
 * Gets events for a specific day
 */
export function getEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((event) => isSameDay(event.start, day));
}

// ============================================================================
// Default Time Helpers
// ============================================================================

export function getDefaultEventTimes(): { start: Date; end: Date } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);

  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return { start, end };
}

export function getEventTimesForSlot(date: Date, hour: number): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(hour, 0, 0, 0);

  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return { start, end };
}
