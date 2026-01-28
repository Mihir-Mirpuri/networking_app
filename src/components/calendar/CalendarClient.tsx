'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import {
  checkCalendarAccessAction,
  verifyAndMarkCalendarAccessAction,
  listCalendarEventsAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  checkCalendarConflictsAction,
  CreateEventInput,
} from '@/app/actions/calendar';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  attendees: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  htmlLink?: string;
  hangoutLink?: string;
}

export function CalendarClient() {
  const { status } = useSession();

  // Access state
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);

  // Events state
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // View state
  const [viewRange, setViewRange] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Create event state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState<CreateEventInput>({
    summary: '',
    description: '',
    location: '',
    startDateTime: '',
    endDateTime: '',
    attendeeEmails: [],
    addGoogleMeet: false,
  });
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // Check calendar access on mount
  useEffect(() => {
    if (status === 'authenticated') {
      checkAccess();
    }
  }, [status]);

  // Load events when access is confirmed
  useEffect(() => {
    if (hasAccess) {
      loadEvents();
    }
  }, [hasAccess, currentDate, viewRange]);

  const checkAccess = async () => {
    setIsCheckingAccess(true);

    // First check if user already has access marked
    const result = await checkCalendarAccessAction();

    if (result.success && result.data?.hasAccess) {
      setHasAccess(true);
      setIsCheckingAccess(false);
      return;
    }

    // User doesn't have access marked - try to verify in case they just re-authenticated
    // This handles the case where user re-auths and comes back to calendar page
    const verifyResult = await verifyAndMarkCalendarAccessAction();

    if (verifyResult.success && verifyResult.data?.verified) {
      setHasAccess(true);
    } else {
      setHasAccess(false);
    }

    setIsCheckingAccess(false);
  };

  const loadEvents = async () => {
    setIsLoadingEvents(true);
    setEventsError(null);

    const { startDate, endDate } = getDateRange();

    const result = await listCalendarEventsAction(
      startDate.toISOString(),
      endDate.toISOString()
    );

    if (result.success && result.data) {
      // Convert date strings back to Date objects
      setEvents(
        result.data.map((e) => ({
          ...e,
          start: new Date(e.start),
          end: new Date(e.end),
        }))
      );
    } else if (result.requiresReauth) {
      setHasAccess(false);
    } else {
      setEventsError(result.error || 'Failed to load events');
    }

    setIsLoadingEvents(false);
  };

  const getDateRange = () => {
    const start = new Date(currentDate);
    const end = new Date(currentDate);

    if (viewRange === 'week') {
      // Start of week (Sunday)
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      // End of week (Saturday)
      end.setDate(start.getDate() + 7);
      end.setHours(23, 59, 59, 999);
    } else {
      // Start of month
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      // End of month
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
    }

    return { startDate: start, endDate: end };
  };

  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewRange === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewRange === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleCreateEvent = async () => {
    if (!newEvent.summary.trim()) {
      setCreateError('Event title is required');
      return;
    }

    if (!newEvent.startDateTime || !newEvent.endDateTime) {
      setCreateError('Start and end times are required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    const result = await createCalendarEventAction(newEvent);

    if (result.success) {
      setShowCreateModal(false);
      setNewEvent({
        summary: '',
        description: '',
        location: '',
        startDateTime: '',
        endDateTime: '',
        attendeeEmails: [],
        addGoogleMeet: false,
      });
      setConflictWarning(null);
      await loadEvents();
    } else {
      setCreateError(result.error || 'Failed to create event');
    }

    setIsCreating(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;

    const result = await deleteCalendarEventAction(eventId);
    if (result.success) {
      await loadEvents();
    } else {
      setEventsError(result.error || 'Failed to delete event');
    }
  };

  const handleCheckConflicts = async () => {
    if (!newEvent.startDateTime) return;

    const start = new Date(newEvent.startDateTime);
    const end = newEvent.endDateTime ? new Date(newEvent.endDateTime) : new Date(start.getTime() + 30 * 60 * 1000);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

    const result = await checkCalendarConflictsAction(newEvent.startDateTime, durationMinutes);

    if (result.success && result.data?.hasConflict) {
      const conflicts = result.data.conflictingEvents.map((e) => e.summary).join(', ');
      setConflictWarning(`Conflicts with: ${conflicts}`);
    } else {
      setConflictWarning(null);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateRange = () => {
    const { startDate, endDate } = getDateRange();
    if (viewRange === 'week') {
      return `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }
    return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const groupEventsByDay = () => {
    const grouped: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      const dateKey = event.start.toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  };

  const setDefaultTimes = () => {
    const now = new Date();
    // Round to next hour
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);

    const end = new Date(now.getTime() + 30 * 60 * 1000);

    const formatForInput = (date: Date) => {
      return date.toISOString().slice(0, 16);
    };

    setNewEvent({
      ...newEvent,
      startDateTime: formatForInput(now),
      endDateTime: formatForInput(end),
    });
  };

  // Loading state
  if (status === 'loading' || isCheckingAccess) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <div className="bg-white rounded-lg shadow p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Checking calendar access...</span>
          </div>
        </div>
      </div>
    );
  }

  // No access - prompt to connect
  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <div className="bg-white rounded-lg shadow p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Connect Your Google Calendar
            </h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              To view and manage your calendar, you need to grant access to your Google Calendar.
              This allows you to see your schedule and create meetings with your networking contacts.
            </p>
            <button
              onClick={async () => {
                // Sign out first to force fresh OAuth flow with all scopes
                await signOut({ redirect: false });
                // Then sign in - will show full consent screen including calendar
                signIn('google', { callbackUrl: '/calendar' });
              }}
              className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Connect Google Calendar
            </button>
            <p className="text-sm text-gray-500 mt-4">
              You&apos;ll be signed out and asked to sign back in to grant calendar permissions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Calendar view
  const groupedEvents = groupEventsByDay();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setDefaultTimes();
          }}
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

      {/* Calendar Controls */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevious}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Today
            </button>
            <button
              onClick={handleNext}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
            <span className="ml-4 text-lg font-semibold text-gray-900">
              {formatDateRange()}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewRange('week')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                viewRange === 'week'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewRange('month')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                viewRange === 'month'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Month
            </button>
            <button
              onClick={loadEvents}
              disabled={isLoadingEvents}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Refresh"
            >
              <svg
                className={`w-5 h-5 text-gray-600 ${isLoadingEvents ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="bg-white rounded-lg shadow">
        {eventsError && (
          <div className="p-4 bg-red-50 border-b border-red-100">
            <p className="text-red-700">{eventsError}</p>
          </div>
        )}

        {isLoadingEvents ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-3 text-gray-600">Loading events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="text-gray-600">No events scheduled for this period.</p>
            <button
              onClick={() => {
                setShowCreateModal(true);
                setDefaultTimes();
              }}
              className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
            >
              Create your first event
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {Object.entries(groupedEvents)
              .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
              .map(([dateKey, dayEvents]) => (
                <div key={dateKey} className="p-4">
                  <h3 className="text-sm font-semibold text-gray-500 mb-3">
                    {formatDate(new Date(dateKey))}
                  </h3>
                  <div className="space-y-2">
                    {dayEvents
                      .sort((a, b) => a.start.getTime() - b.start.getTime())
                      .map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                        >
                          <div className="flex-shrink-0 w-20 text-sm">
                            {event.isAllDay ? (
                              <span className="text-gray-600">All day</span>
                            ) : (
                              <>
                                <div className="font-medium text-gray-900">
                                  {formatTime(event.start)}
                                </div>
                                <div className="text-gray-500">
                                  {formatTime(event.end)}
                                </div>
                              </>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-medium text-gray-900 truncate">
                                  {event.summary}
                                </h4>
                                {event.location && (
                                  <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                    <svg
                                      className="w-4 h-4"
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
                                    {event.location}
                                  </p>
                                )}
                                {event.hangoutLink && (
                                  <a
                                    href={event.hangoutLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                                  >
                                    <svg
                                      className="w-4 h-4"
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
                                    Join Google Meet
                                  </a>
                                )}
                                {event.attendees.length > 0 && (
                                  <p className="text-sm text-gray-500 mt-1">
                                    {event.attendees.length} attendee
                                    {event.attendees.length > 1 ? 's' : ''}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {event.htmlLink && (
                                  <a
                                    href={event.htmlLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
                                    title="Open in Google Calendar"
                                  >
                                    <svg
                                      className="w-4 h-4"
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
                                  </a>
                                )}
                                <button
                                  onClick={() => handleDeleteEvent(event.id)}
                                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                  title="Delete event"
                                >
                                  <svg
                                    className="w-4 h-4"
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
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Create Event
                </h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError(null);
                    setConflictWarning(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
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

              {createError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{createError}</p>
                </div>
              )}

              {conflictWarning && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-700">{conflictWarning}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Title *
                  </label>
                  <input
                    type="text"
                    value={newEvent.summary}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, summary: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Coffee chat with John"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start *
                    </label>
                    <input
                      type="datetime-local"
                      value={newEvent.startDateTime}
                      onChange={(e) => {
                        setNewEvent({
                          ...newEvent,
                          startDateTime: e.target.value,
                        });
                      }}
                      onBlur={handleCheckConflicts}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End *
                    </label>
                    <input
                      type="datetime-local"
                      value={newEvent.endDateTime}
                      onChange={(e) =>
                        setNewEvent({ ...newEvent, endDateTime: e.target.value })
                      }
                      onBlur={handleCheckConflicts}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={newEvent.location}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, location: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Starbucks, Zoom, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={newEvent.description}
                    onChange={(e) =>
                      setNewEvent({ ...newEvent, description: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Notes about this meeting..."
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newEvent.addGoogleMeet}
                      onChange={(e) =>
                        setNewEvent({
                          ...newEvent,
                          addGoogleMeet: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Add Google Meet video conferencing
                    </span>
                  </label>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCreateEvent}
                    disabled={isCreating}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isCreating ? 'Creating...' : 'Create Event'}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateError(null);
                      setConflictWarning(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
