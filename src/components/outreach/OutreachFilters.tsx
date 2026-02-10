'use client';

import { useState } from 'react';
import { OutreachStatus } from '@prisma/client';

interface OutreachFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearch: () => void;
  statusFilter: OutreachStatus[];
  onStatusFilterChange: (statuses: OutreachStatus[]) => void;
  isLoading: boolean;
}

const STATUS_OPTIONS: { value: OutreachStatus; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not Started' },
  { value: 'SENT', label: 'Sent' },
  { value: 'WAITING', label: 'Waiting' },
  { value: 'RESPONDED', label: 'Responded' },
  { value: 'SCHEDULED_CALL', label: 'Scheduled Call' },
  { value: 'HAD_CALL', label: 'Had Call' },
  { value: 'GHOSTED', label: 'Ghosted' },
  { value: 'NOT_INTERESTED', label: 'Not Interested' },
  { value: 'CONNECTED', label: 'Connected' },
];

export function OutreachFilters({
  searchQuery,
  onSearchChange,
  onSearch,
  statusFilter,
  onStatusFilterChange,
  isLoading,
}: OutreachFiltersProps) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch();
    }
  };

  const toggleStatus = (status: OutreachStatus) => {
    if (statusFilter.includes(status)) {
      onStatusFilterChange(statusFilter.filter((s) => s !== status));
    } else {
      onStatusFilterChange([...statusFilter, status]);
    }
  };

  const clearFilters = () => {
    onSearchChange('');
    onStatusFilterChange([]);
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="text"
        placeholder="Search by name, email, company..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="input flex-1 min-w-[200px]"
      />

      <div className="relative">
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          className={`px-4 py-2 border rounded-xl flex items-center gap-2 transition-colors ${
            statusFilter.length > 0
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-surface-300 bg-white text-surface-700'
          }`}
        >
          <span>Status</span>
          {statusFilter.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded-full">
              {statusFilter.length}
            </span>
          )}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusDropdown && (
          <div className="absolute right-0 z-50 mt-1 w-48 bg-white rounded-xl shadow-lg border border-surface-200 py-1">
            {STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center px-3 py-2 hover:bg-surface-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={statusFilter.includes(option.value)}
                  onChange={() => toggleStatus(option.value)}
                  className="w-4 h-4 text-primary-600 border-surface-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-surface-700">{option.label}</span>
              </label>
            ))}
            <div className="border-t border-surface-200 mt-1 pt-1">
              <button
                onClick={() => {
                  onStatusFilterChange([]);
                  setShowStatusDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-surface-500 hover:bg-surface-50"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onSearch}
        disabled={isLoading}
        className="btn-primary"
      >
        {isLoading ? 'Searching...' : 'Search'}
      </button>

      {(searchQuery || statusFilter.length > 0) && (
        <button
          onClick={clearFilters}
          disabled={isLoading}
          className="btn-secondary"
        >
          Clear
        </button>
      )}
    </div>
  );
}
