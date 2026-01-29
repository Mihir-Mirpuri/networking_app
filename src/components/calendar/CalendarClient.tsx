'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  checkCalendarAccessAction,
  verifyAndMarkCalendarAccessAction,
  listCalendarEventsAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  checkCalendarConflictsAction,
} from '@/app/actions/calendar';
import { getPendingSuggestionsCountAction } from '@/app/actions/meetingSuggestions';
import { CalendarEvent, CreateEventInput, ViewMode } from './types';
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

  const fetchPendingSuggestionsCount = async () => {
    const result = await getPendingSuggestionsCountAction();
    if (result.success && result.data !== undefined) {
      setPendingSuggestionsCount(result.data);
    }
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
        <CalendarAccessPrompt />
      </div>
    );
  }

  // Get week start for week view
  const weekStart = getWeekRange(currentDate).start;

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
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Calendar view */}
      {viewMode === 'week' ? (
        <WeekView
          events={events}
          weekStart={weekStart}
          onEventClick={handleEventClick}
          onTimeSlotClick={handleTimeSlotClick}
        />
      ) : (
        <MonthView
          events={events}
          currentDate={currentDate}
          onEventClick={handleEventClick}
          onDayClick={handleDayClick}
        />
      )}

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
