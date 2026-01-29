import { CalendarEvent } from '../types';
import {
  isToday,
  isSameDay,
  formatDayHeader,
  calculateEventPosition,
  resolveOverlappingEvents,
} from '../utils';
import { WeekEventCard } from './WeekEventCard';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48;

interface DayColumnProps {
  date: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onTimeSlotClick?: (date: Date) => void;
}

export function DayColumn({ date, events, onEventClick, onTimeSlotClick }: DayColumnProps) {
  const { dayName, dayNumber } = formatDayHeader(date);
  const today = isToday(date);

  // Filter events for this day (excluding all-day events which go in header)
  const dayEvents = events.filter(
    (event) => isSameDay(event.start, date) && !event.isAllDay
  );

  // Calculate positions for overlapping events
  const positions = resolveOverlappingEvents(dayEvents);

  const handleSlotClick = (hour: number) => {
    if (onTimeSlotClick) {
      const slotDate = new Date(date);
      slotDate.setHours(hour, 0, 0, 0);
      onTimeSlotClick(slotDate);
    }
  };

  return (
    <div className="flex-1 min-w-0 border-r border-gray-200 last:border-r-0">
      {/* Day header */}
      <div
        className={`h-14 border-b border-gray-200 flex flex-col items-center justify-center ${
          today ? 'bg-blue-50' : ''
        }`}
      >
        <span className="text-xs text-gray-500 uppercase">{dayName}</span>
        <span
          className={`text-lg font-semibold ${
            today
              ? 'bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center'
              : 'text-gray-900'
          }`}
        >
          {date.getDate()}
        </span>
      </div>

      {/* Time slots */}
      <div className="relative">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
              today ? 'bg-blue-50/30' : ''
            }`}
            style={{ height: HOUR_HEIGHT }}
            onClick={() => handleSlotClick(hour)}
          />
        ))}

        {/* Events */}
        {dayEvents.map((event) => {
          const { top, height } = calculateEventPosition(event);
          const position = positions.get(event.id) || { column: 0, totalColumns: 1 };
          const width = `calc(${100 / position.totalColumns}% - 4px)`;
          const left = `calc(${(position.column / position.totalColumns) * 100}% + 2px)`;

          return (
            <WeekEventCard
              key={event.id}
              event={event}
              style={{ top, height, left, width }}
              onClick={() => onEventClick(event)}
            />
          );
        })}

        {/* Current time indicator */}
        {today && <CurrentTimeIndicator />}
      </div>
    </div>
  );
}

function CurrentTimeIndicator() {
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const top = (minutesSinceMidnight / 60) * HOUR_HEIGHT;

  return (
    <div
      className="absolute left-0 right-0 flex items-center pointer-events-none z-10"
      style={{ top }}
    >
      <div className="w-2 h-2 bg-red-500 rounded-full -ml-1" />
      <div className="flex-1 border-t-2 border-red-500" />
    </div>
  );
}
