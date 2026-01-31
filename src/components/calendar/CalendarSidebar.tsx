'use client';

import { useState } from 'react';
import { Calendar } from './types';

interface CalendarSidebarProps {
  calendars: Calendar[];
  visibleCalendarIds: Set<string>;
  onVisibilityChange: (calendarId: string, visible: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isLoading?: boolean;
}

export function CalendarSidebar({
  calendars,
  visibleCalendarIds,
  onVisibilityChange,
  onSelectAll,
  onDeselectAll,
  isLoading,
}: CalendarSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const allSelected = calendars.length > 0 && calendars.every((c) => visibleCalendarIds.has(c.id));
  const noneSelected = calendars.length > 0 && calendars.every((c) => !visibleCalendarIds.has(c.id));

  // Default colors for calendars without a background color
  const defaultColors = [
    '#4285f4', // Blue
    '#ea4335', // Red
    '#fbbc04', // Yellow
    '#34a853', // Green
    '#ff6d01', // Orange
    '#46bdc6', // Teal
    '#7b5bd6', // Purple
    '#f538a0', // Pink
  ];

  const getCalendarColor = (calendar: Calendar, index: number) => {
    return calendar.backgroundColor || defaultColors[index % defaultColors.length];
  };

  if (isLoading) {
    return (
      <div className="w-64 shrink-0 hidden lg:block">
        <div className="card p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-surface-200 rounded w-24" />
            <div className="h-4 bg-surface-200 rounded w-full" />
            <div className="h-4 bg-surface-200 rounded w-full" />
            <div className="h-4 bg-surface-200 rounded w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop sidebar */}
      <div className="w-64 shrink-0 hidden lg:block">
        <div className="card p-4 sticky top-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-900">My Calendars</h3>
            <div className="flex gap-1">
              <button
                onClick={onSelectAll}
                disabled={allSelected}
                className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed px-1"
                title="Select all"
              >
                All
              </button>
              <span className="text-surface-300">|</span>
              <button
                onClick={onDeselectAll}
                disabled={noneSelected}
                className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed px-1"
                title="Deselect all"
              >
                None
              </button>
            </div>
          </div>

          {calendars.length === 0 ? (
            <p className="text-sm text-surface-500">No calendars found</p>
          ) : (
            <ul className="space-y-1">
              {calendars.map((calendar, index) => (
                <li key={calendar.id}>
                  <label className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-50 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={visibleCalendarIds.has(calendar.id)}
                      onChange={(e) => onVisibilityChange(calendar.id, e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        borderColor: getCalendarColor(calendar, index),
                        backgroundColor: visibleCalendarIds.has(calendar.id)
                          ? getCalendarColor(calendar, index)
                          : 'transparent',
                      }}
                    >
                      {visibleCalendarIds.has(calendar.id) && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="text-sm text-surface-700 truncate flex-1">
                      {calendar.summary}
                      {calendar.primary && (
                        <span className="ml-1 text-xs text-surface-400">(primary)</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Mobile collapsible */}
      <div className="lg:hidden mb-4">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center justify-between w-full card px-4 py-3"
        >
          <span className="text-sm font-semibold text-surface-900">My Calendars</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-500">
              {visibleCalendarIds.size} of {calendars.length} visible
            </span>
            <svg
              className={`w-5 h-5 text-surface-500 transition-transform ${
                isCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {!isCollapsed && (
          <div className="card mt-2 p-4">
            <div className="flex gap-2 mb-3">
              <button
                onClick={onSelectAll}
                disabled={allSelected}
                className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Select All
              </button>
              <span className="text-surface-300">|</span>
              <button
                onClick={onDeselectAll}
                disabled={noneSelected}
                className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Deselect All
              </button>
            </div>

            {calendars.length === 0 ? (
              <p className="text-sm text-surface-500">No calendars found</p>
            ) : (
              <ul className="space-y-1">
                {calendars.map((calendar, index) => (
                  <li key={calendar.id}>
                    <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleCalendarIds.has(calendar.id)}
                        onChange={(e) => onVisibilityChange(calendar.id, e.target.checked)}
                        className="sr-only"
                      />
                      <span
                        className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0"
                        style={{
                          borderColor: getCalendarColor(calendar, index),
                          backgroundColor: visibleCalendarIds.has(calendar.id)
                            ? getCalendarColor(calendar, index)
                            : 'transparent',
                        }}
                      >
                        {visibleCalendarIds.has(calendar.id) && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="text-sm text-surface-700 truncate flex-1">
                        {calendar.summary}
                        {calendar.primary && (
                          <span className="ml-1 text-xs text-surface-400">(primary)</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
