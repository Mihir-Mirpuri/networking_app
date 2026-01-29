import { CalendarEvent } from '../types';
import { formatTime } from '../utils';

interface WeekEventCardProps {
  event: CalendarEvent;
  style: {
    top: number;
    height: number;
    left: string;
    width: string;
  };
  onClick: () => void;
}

export function WeekEventCard({ event, style, onClick }: WeekEventCardProps) {
  const isShortEvent = style.height < 40;

  return (
    <button
      onClick={onClick}
      className="absolute bg-blue-100 border-l-4 border-blue-600 rounded px-2 py-1 text-left overflow-hidden cursor-pointer hover:bg-blue-200 transition-colors"
      style={{
        top: style.top,
        height: style.height,
        left: style.left,
        width: style.width,
      }}
      title={`${event.summary}\n${formatTime(event.start)} - ${formatTime(event.end)}`}
    >
      {isShortEvent ? (
        <div className="flex items-center gap-1 text-xs truncate">
          <span className="font-medium text-gray-900 truncate">{event.summary}</span>
        </div>
      ) : (
        <>
          <div className="text-xs font-medium text-gray-900 truncate">
            {event.summary}
          </div>
          <div className="text-xs text-gray-600 truncate">
            {formatTime(event.start)} - {formatTime(event.end)}
          </div>
          {event.location && style.height >= 60 && (
            <div className="text-xs text-gray-500 truncate mt-0.5">
              {event.location}
            </div>
          )}
        </>
      )}
    </button>
  );
}
