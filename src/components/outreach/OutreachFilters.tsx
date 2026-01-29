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
        className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="relative">
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          className={`px-4 py-2 border rounded-md flex items-center gap-2 ${
            statusFilter.length > 0
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-700'
          }`}
        >
          <span>Status</span>
          {statusFilter.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
              {statusFilter.length}
            </span>
          )}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusDropdown && (
          <div className="absolute right-0 z-50 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 py-1">
            {STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={statusFilter.includes(option.value)}
                  onChange={() => toggleStatus(option.value)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">{option.label}</span>
              </label>
            ))}
            <div className="border-t border-gray-200 mt-1 pt-1">
              <button
                onClick={() => {
                  onStatusFilterChange([]);
                  setShowStatusDropdown(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
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
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isLoading ? 'Searching...' : 'Search'}
      </button>

      {(searchQuery || statusFilter.length > 0) && (
        <button
          onClick={clearFilters}
          disabled={isLoading}
          className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
        >
          Clear
        </button>
      )}
    </div>
  );
}
