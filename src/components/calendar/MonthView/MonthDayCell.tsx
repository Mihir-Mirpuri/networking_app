import { CalendarEvent } from '../types';
import { isToday, isSameMonth } from '../utils';
import { MonthEventPill } from './MonthEventPill';

const MAX_VISIBLE_EVENTS = 3;

interface MonthDayCellProps {
  date: Date;
  currentMonth: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onDayClick?: (date: Date) => void;
  onShowMore?: (date: Date, events: CalendarEvent[]) => void;
}

export function MonthDayCell({
  date,
  currentMonth,
  events,
  onEventClick,
  onDayClick,
  onShowMore,
}: MonthDayCellProps) {
  const today = isToday(date);
  const isCurrentMonth = isSameMonth(date, currentMonth);

  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
  const hiddenCount = events.length - MAX_VISIBLE_EVENTS;

  const handleClick = () => {
    onDayClick?.(date);
  };

  const handleShowMore = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShowMore?.(date, events);
  };

  return (
    <div
      className={`min-h-[100px] border-b border-r border-gray-200 p-1 cursor-pointer hover:bg-gray-50 transition-colors ${
        !isCurrentMonth ? 'bg-gray-50' : ''
      } ${today ? 'bg-blue-50' : ''}`}
      onClick={handleClick}
    >
      {/* Day number */}
      <div className="flex justify-end mb-1">
        <span
          className={`text-sm ${
            today
              ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center font-semibold'
              : isCurrentMonth
              ? 'text-gray-900'
              : 'text-gray-400'
          }`}
        >
          {date.getDate()}
        </span>
      </div>

      {/* Events */}
      <div className="space-y-0.5">
        {visibleEvents.map((event) => (
          <MonthEventPill
            key={event.id}
            event={event}
            onClick={() => onEventClick(event)}
            showTime={false}
          />
        ))}

        {hiddenCount > 0 && (
          <button
            onClick={handleShowMore}
            className="w-full text-left text-xs text-gray-500 hover:text-gray-700 px-2 py-0.5"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}
