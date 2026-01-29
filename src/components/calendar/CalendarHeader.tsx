import Link from 'next/link';

interface CalendarHeaderProps {
  onCreateEvent: () => void;
  pendingSuggestionsCount?: number;
}

export function CalendarHeader({ onCreateEvent, pendingSuggestionsCount = 0 }: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
      <div className="flex items-center gap-3">
        {pendingSuggestionsCount > 0 && (
          <Link
            href="/calendar/suggestions"
            className="inline-flex items-center px-4 py-2 bg-amber-100 text-amber-800 font-medium rounded-lg hover:bg-amber-200 transition-colors"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            {pendingSuggestionsCount} Suggestion{pendingSuggestionsCount !== 1 ? 's' : ''}
          </Link>
        )}
        <button
          onClick={onCreateEvent}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Event
        </button>
      </div>
    </div>
  );
}
