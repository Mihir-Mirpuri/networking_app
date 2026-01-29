import { formatHour } from '../utils';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48;

export function TimeColumn() {
  return (
    <div className="flex-shrink-0 w-16 border-r border-gray-200">
      {/* Empty space for header alignment */}
      <div className="h-14 border-b border-gray-200" />

      {/* Hour labels */}
      <div className="relative">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="relative border-b border-gray-100"
            style={{ height: HOUR_HEIGHT }}
          >
            <span className="absolute -top-2.5 right-2 text-xs text-gray-500">
              {hour === 0 ? '' : formatHour(hour)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
