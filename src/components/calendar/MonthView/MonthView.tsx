'use client';

import { CalendarEvent } from '../types';
import { getMonthGridDays, isSameDay } from '../utils';
import { MonthDayCell } from './MonthDayCell';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface MonthViewProps {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  onDayClick?: (date: Date) => void;
}

export function MonthView({
  events,
  currentDate,
  onEventClick,
  onDayClick,
}: MonthViewProps) {
  const days = getMonthGridDays(currentDate);

  // Group events by day for quick lookup
  const eventsByDay = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const key = event.start.toDateString();
    const existing = eventsByDay.get(key) || [];
    existing.push(event);
    eventsByDay.set(key, existing);
  });

  // Sort events within each day
  eventsByDay.forEach((dayEvents) => {
    dayEvents.sort((a, b) => {
      // All-day events first
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start.getTime() - b.start.getTime();
    });
  });

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="py-2 text-center text-sm font-medium text-gray-500 border-r border-gray-200 last:border-r-0"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => (
          <MonthDayCell
            key={day.toISOString()}
            date={day}
            currentMonth={currentDate}
            events={eventsByDay.get(day.toDateString()) || []}
            onEventClick={onEventClick}
            onDayClick={onDayClick}
          />
        ))}
      </div>
    </div>
  );
}
