'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  checkCalendarAccessAction,
  verifyAndMarkCalendarAccessAction,
  listCalendarEventsAction,
  listCalendarsAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  checkCalendarConflictsAction,
} from '@/app/actions/calendar';
import { getPendingSuggestionsCountAction } from '@/app/actions/meetingSuggestions';
import { Calendar, CalendarEvent, CreateEventInput, ViewMode } from './types';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import {
  getWeekRange,
  getMonthRange,
  formatWeekRange,
  formatMonthYear,
} from './utils';
import { CalendarHeader } from './CalendarHeader';
import { CalendarControls } from './CalendarControls';
import { CalendarAccessPrompt } from './CalendarAccessPrompt';
import { CreateEventModal } from './CreateEventModal';
import { EventDetailPopover } from './EventDetailPopover';
import { WeekView } from './WeekView/WeekView';
import { MonthView } from './MonthView/MonthView';
import { CalendarSidebar } from './CalendarSidebar';

const VISIBLE_CALENDARS_STORAGE_KEY = 'calendar-visible-calendars';

export function CalendarClient() {
  const { status } = useSession();

  // Access state
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);

  // Calendars state
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);

  // Events state
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Create event state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [initialEventDateTime, setInitialEventDateTime] = useState<Date | undefined>();

  // Event detail state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pending suggestions count
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);

  // Calculate date range based on view mode
  const getDateRange = () => {
    return viewMode === 'week' ? getWeekRange(currentDate) : getMonthRange(currentDate);
  };

  // Format date range label for controls
  const getDateRangeLabel = () => {
    if (viewMode === 'week') {
      const { start } = getWeekRange(currentDate);
      return formatWeekRange(start);
    }
    return formatMonthYear(currentDate);
  };

  // Check calendar access on mount
  useEffect(() => {
    if (status === 'authenticated') {
      checkAccess();
      fetchPendingSuggestionsCount();
    }
  }, [status]);

  // Load calendars when access is confirmed
  useEffect(() => {
    if (hasAccess) {
      loadCalendars();
    }
  }, [hasAccess]);

  const fetchPendingSuggestionsCount = async () => {
    const result = await getPendingSuggestionsCountAction();
    if (result.success && result.data !== undefined) {
      setPendingSuggestionsCount(result.data);
    }
  };

  const loadCalendars = async () => {
    setIsLoadingCalendars(true);

    const result = await listCalendarsAction();

    if (result.success && result.data) {
      const fetchedCalendars = result.data;
      setCalendars(fetchedCalendars);

      // Load saved visibility preferences from localStorage
      const savedVisibleIds = loadVisibleCalendarIds();
      if (savedVisibleIds) {
        // Filter to only include IDs that still exist
        const validIds = new Set(
          savedVisibleIds.filter((id) => fetchedCalendars.some((c) => c.id === id))
        );
        // If all saved calendars are gone, show all
        setVisibleCalendarIds(validIds.size > 0 ? validIds : new Set(fetchedCalendars.map((c) => c.id)));
      } else {
        // Default: show all calendars
        setVisibleCalendarIds(new Set(fetchedCalendars.map((c) => c.id)));
      }
    }

    setIsLoadingCalendars(false);
  };

  const loadVisibleCalendarIds = (): string[] | null => {
    try {
      const saved = localStorage.getItem(VISIBLE_CALENDARS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  };

  const saveVisibleCalendarIds = (ids: Set<string>) => {
    try {
      localStorage.setItem(VISIBLE_CALENDARS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch {
      // Ignore localStorage errors
    }
  };

  const handleCalendarVisibilityChange = (calendarId: string, visible: boolean) => {
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (visible) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }
      saveVisibleCalendarIds(next);
      return next;
    });
  };

  const handleSelectAllCalendars = () => {
    const allIds = new Set(calendars.map((c) => c.id));
    setVisibleCalendarIds(allIds);
    saveVisibleCalendarIds(allIds);
  };

  const handleDeselectAllCalendars = () => {
    const empty = new Set<string>();
    setVisibleCalendarIds(empty);
    saveVisibleCalendarIds(empty);
  };

  // Load events when access is confirmed or view changes
  useEffect(() => {
    if (hasAccess) {
      loadEvents();
    }
  }, [hasAccess, currentDate, viewMode]);

  const checkAccess = async () => {
    setIsCheckingAccess(true);

    const result = await checkCalendarAccessAction();
    if (result.success && result.data?.hasAccess) {
      setHasAccess(true);
      setIsCheckingAccess(false);
      return;
    }

    // Try to verify in case user just re-authenticated
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

    const { start, end } = getDateRange();
    const result = await listCalendarEventsAction(
      start.toISOString(),
      end.toISOString()
    );

    if (result.success && result.data) {
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

  // Navigation handlers
  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Create event handlers
  const handleOpenCreateModal = (initialDate?: Date) => {
    setInitialEventDateTime(initialDate);
    setCreateError(null);
    setConflictWarning(null);
    setShowCreateModal(true);
  };

  const handleCreateEvent = async (input: CreateEventInput) => {
    if (!input.summary.trim()) {
      setCreateError('Event title is required');
      return;
    }

    if (!input.startDateTime || !input.endDateTime) {
      setCreateError('Start and end times are required');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    const result = await createCalendarEventAction(input);

    if (result.success) {
      setShowCreateModal(false);
      setConflictWarning(null);
      await loadEvents();
    } else {
      setCreateError(result.error || 'Failed to create event');
    }

    setIsCreating(false);
  };

  const handleCheckConflicts = async (startDateTime: string, endDateTime: string) => {
    if (!startDateTime) return;

    const start = new Date(startDateTime);
    const end = endDateTime ? new Date(endDateTime) : new Date(start.getTime() + 30 * 60 * 1000);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

    const result = await checkCalendarConflictsAction(startDateTime, durationMinutes);

    if (result.success && result.data?.hasConflict) {
      const conflicts = result.data.conflictingEvents.map((e) => e.summary).join(', ');
      setConflictWarning(`Conflicts with: ${conflicts}`);
    } else {
      setConflictWarning(null);
    }
  };

  // Event detail handlers
  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleDeleteEvent = async (eventId: string) => {
    setIsDeleting(true);

    const result = await deleteCalendarEventAction(eventId);
    if (result.success) {
      setSelectedEvent(null);
      await loadEvents();
    } else {
      setEventsError(result.error || 'Failed to delete event');
    }

    setIsDeleting(false);
  };

  // Time slot click handler (for week view)
  const handleTimeSlotClick = (date: Date) => {
    handleOpenCreateModal(date);
  };

  // Day click handler (for month view)
  const handleDayClick = (date: Date) => {
    // Switch to week view for the clicked date
    setCurrentDate(date);
    setViewMode('week');
  };

  // Loading state
  if (status === 'loading' || isCheckingAccess) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-surface-900">Calendar</h1>
        <div className="card p-8">
          <div className="flex items-center justify-center gap-3">
            <LoadingSpinner size="md" />
            <span className="text-surface-600">Checking calendar access...</span>
          </div>
        </div>
      </div>
    );
  }

  // No access - prompt to connect
  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-surface-900">Calendar</h1>
        <CalendarAccessPrompt />
      </div>
    );
  }

  // Get week start for week view
  const weekStart = getWeekRange(currentDate).start;

  // Filter events by visible calendars
  const filteredEvents = events.filter((event) => visibleCalendarIds.has(event.calendarId));

  return (
    <div className="space-y-6">
      <CalendarHeader
        onCreateEvent={() => handleOpenCreateModal()}
        pendingSuggestionsCount={pendingSuggestionsCount}
      />

      <CalendarControls
        dateRangeLabel={getDateRangeLabel()}
        viewMode={viewMode}
        isLoading={isLoadingEvents}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onViewModeChange={setViewMode}
        onRefresh={loadEvents}
      />

      {/* Error display */}
      {eventsError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{eventsError}</p>
        </div>
      )}

      {/* Loading overlay */}
      {isLoadingEvents && (
        <div className="flex justify-center py-4">
          <LoadingSpinner size="md" />
        </div>
      )}

      {/* Main content with sidebar */}
      <div className="flex gap-6">
        <CalendarSidebar
          calendars={calendars}
          visibleCalendarIds={visibleCalendarIds}
          onVisibilityChange={handleCalendarVisibilityChange}
          onSelectAll={handleSelectAllCalendars}
          onDeselectAll={handleDeselectAllCalendars}
          isLoading={isLoadingCalendars}
        />

        {/* Calendar view */}
        <div className="flex-1 min-w-0">
          {viewMode === 'week' ? (
            <WeekView
              events={filteredEvents}
              weekStart={weekStart}
              onEventClick={handleEventClick}
              onTimeSlotClick={handleTimeSlotClick}
            />
          ) : (
            <MonthView
              events={filteredEvents}
              currentDate={currentDate}
              onEventClick={handleEventClick}
              onDayClick={handleDayClick}
            />
          )}
        </div>
      </div>

      {/* Create event modal */}
      <CreateEventModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateEvent}
        isSubmitting={isCreating}
        error={createError}
        conflictWarning={conflictWarning}
        initialDateTime={initialEventDateTime}
        onCheckConflicts={handleCheckConflicts}
      />

      {/* Event detail popover */}
      <EventDetailPopover
        event={selectedEvent}
        isOpen={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        onDelete={handleDeleteEvent}
        isDeleting={isDeleting}
      />
    </div>
  );
}
