import { ViewMode } from './types';

interface CalendarControlsProps {
  dateRangeLabel: string;
  viewMode: ViewMode;
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onRefresh: () => void;
}

export function CalendarControls({
  dateRangeLabel,
  viewMode,
  isLoading,
  onPrevious,
  onNext,
  onToday,
  onViewModeChange,
  onRefresh,
}: CalendarControlsProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onPrevious}
            className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
            aria-label="Previous"
          >
            <svg
              className="w-5 h-5 text-surface-600"
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
            onClick={onToday}
            className="px-3 py-1.5 text-sm font-medium text-surface-700 hover:bg-surface-100 rounded-lg transition-colors"
          >
            Today
          </button>
          <button
            onClick={onNext}
            className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
            aria-label="Next"
          >
            <svg
              className="w-5 h-5 text-surface-600"
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
          <span className="ml-4 text-lg font-semibold text-surface-900">
            {dateRangeLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onViewModeChange('week')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'week'
                ? 'bg-primary-500/20 text-primary-400'
                : 'text-surface-600 hover:bg-surface-100'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => onViewModeChange('month')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              viewMode === 'month'
                ? 'bg-primary-500/20 text-primary-400'
                : 'text-surface-600 hover:bg-surface-100'
            }`}
          >
            Month
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <svg
              className={`w-5 h-5 text-surface-600 ${isLoading ? 'animate-spin' : ''}`}
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
  );
}
