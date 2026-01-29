'use client';

import { useRef, useEffect } from 'react';
import { CalendarEvent } from '../types';
import { getWeekDays, isSameDay } from '../utils';
import { TimeColumn } from './TimeColumn';
import { DayColumn } from './DayColumn';

const HOUR_HEIGHT = 48;
const DEFAULT_SCROLL_HOUR = 7; // Scroll to 7 AM by default

interface WeekViewProps {
  events: CalendarEvent[];
  weekStart: Date;
  onEventClick: (event: CalendarEvent) => void;
  onTimeSlotClick?: (date: Date) => void;
}

export function WeekView({
  events,
  weekStart,
  onEventClick,
  onTimeSlotClick,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = getWeekDays(weekStart);

  // Get all-day events
  const allDayEvents = events.filter((e) => e.isAllDay);

  // Scroll to default hour on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, []);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50">
          <div className="flex">
            <div className="w-16 flex-shrink-0 border-r border-gray-200 px-2 py-2">
              <span className="text-xs text-gray-500">All day</span>
            </div>
            <div className="flex-1 flex">
              {days.map((day) => {
                const dayAllDayEvents = allDayEvents.filter((e) =>
                  isSameDay(e.start, day)
                );
                return (
                  <div
                    key={day.toISOString()}
                    className="flex-1 min-w-0 border-r border-gray-200 last:border-r-0 px-1 py-1"
                  >
                    {dayAllDayEvents.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        className="w-full text-left bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded truncate hover:bg-blue-200 mb-0.5"
                      >
                        {event.summary}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: 'calc(100vh - 280px)', minHeight: 400 }}
      >
        <div className="flex">
          <TimeColumn />
          {days.map((day) => (
            <DayColumn
              key={day.toISOString()}
              date={day}
              events={events}
              onEventClick={onEventClick}
              onTimeSlotClick={onTimeSlotClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
