'use client';

import { useEffect, useRef } from 'react';

interface OutreachFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearch: () => void;
  isLoading: boolean;
}

export function OutreachFilters({
  searchQuery,
  onSearchChange,
  onSearch,
  isLoading,
}: OutreachFiltersProps) {
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

  const clearSearch = () => {
    onSearchChange('');
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search input with icon */}
      <div className="relative flex-1 min-w-[200px]">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#606060] pointer-events-none"
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
            <div className="w-4 h-4 border-2 border-[#505050] border-t-[#808080] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Clear button - only when search active */}
      {searchQuery && (
        <button
          onClick={clearSearch}
          className="px-3 py-2 text-sm text-[#707070] hover:text-[#A0A0A0] hover:bg-[#333333] rounded-xl transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
