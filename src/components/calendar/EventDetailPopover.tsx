'use client';

import { CalendarEvent } from './types';
import { formatTime, formatDate } from './utils';

interface EventDetailPopoverProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (eventId: string) => void;
  isDeleting: boolean;
}

export function EventDetailPopover({
  event,
  isOpen,
  onClose,
  onDelete,
  isDeleting,
}: EventDetailPopoverProps) {
  if (!isOpen || !event) return null;

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this event?')) {
      onDelete(event.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {event.summary}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {event.isAllDay ? (
                  formatDate(event.start)
                ) : (
                  <>
                    {formatDate(event.start)} &middot; {formatTime(event.start)} -{' '}
                    {formatTime(event.end)}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 ml-4"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Details */}
          <div className="space-y-3">
            {event.location && (
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span className="text-sm text-gray-700">{event.location}</span>
              </div>
            )}

            {event.hangoutLink && (
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <a
                  href={event.hangoutLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Join Google Meet
                </a>
              </div>
            )}

            {event.description && (
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h7"
                  />
                </svg>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {event.attendees.length > 0 && (
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                <div className="text-sm text-gray-700">
                  <p className="font-medium mb-1">
                    {event.attendees.length} attendee
                    {event.attendees.length > 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-0.5">
                    {event.attendees.slice(0, 5).map((attendee, i) => (
                      <li key={i} className="text-gray-500">
                        {attendee.displayName || attendee.email}
                        {attendee.responseStatus && (
                          <span className="ml-1 text-xs text-gray-400">
                            ({attendee.responseStatus})
                          </span>
                        )}
                      </li>
                    ))}
                    {event.attendees.length > 5 && (
                      <li className="text-gray-400">
                        +{event.attendees.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2">
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  <svg
                    className="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  Open in Calendar
                </a>
              )}
            </div>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md disabled:opacity-50"
            >
              <svg
                className="w-4 h-4 mr-1.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
