'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);

  // Debounced search on query change
  useEffect(() => {
    // Skip auto-search on initial render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch();
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close status dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowStatusDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleStatus = useCallback((status: OutreachStatus) => {
    if (statusFilter.includes(status)) {
      onStatusFilterChange(statusFilter.filter((s) => s !== status));
    } else {
      onStatusFilterChange([...statusFilter, status]);
    }
  }, [statusFilter, onStatusFilterChange]);

  // Auto-search when status filter changes
  const statusFilterStr = statusFilter.join(',');
  const prevStatusFilter = useRef(statusFilterStr);
  useEffect(() => {
    if (prevStatusFilter.current !== statusFilterStr) {
      prevStatusFilter.current = statusFilterStr;
      onSearch();
    }
  }, [statusFilterStr]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearFilters = () => {
    onSearchChange('');
    onStatusFilterChange([]);
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search input with icon */}
      <div className="relative flex-1 min-w-[200px]">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search by name, email, company..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="input w-full pl-9"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Status filter */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          className={`px-4 py-2 border rounded-xl flex items-center gap-2 transition-colors text-sm ${
            statusFilter.length > 0
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-surface-300 bg-white text-surface-700 hover:border-surface-400'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span>Status</span>
          {statusFilter.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded-full">
              {statusFilter.length}
            </span>
          )}
          <svg className={`h-3.5 w-3.5 transition-transform ${showStatusDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Clear button - only when filters active */}
      {(searchQuery || statusFilter.length > 0) && (
        <button
          onClick={clearFilters}
          className="px-3 py-2 text-sm text-surface-500 hover:text-surface-700 hover:bg-surface-100 rounded-xl transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
