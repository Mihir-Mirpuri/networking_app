import { CalendarEvent } from '../types';
import { formatTime } from '../utils';

interface MonthEventPillProps {
  event: CalendarEvent;
  onClick: () => void;
  showTime?: boolean;
}

export function MonthEventPill({ event, onClick, showTime = true }: MonthEventPillProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-full text-left bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded truncate hover:bg-blue-200 transition-colors"
      title={`${event.summary}${!event.isAllDay ? `\n${formatTime(event.start)} - ${formatTime(event.end)}` : ''}`}
    >
      {!event.isAllDay && showTime && (
        <span className="text-blue-600 mr-1">{formatTime(event.start)}</span>
      )}
      {event.summary}
    </button>
  );
}
