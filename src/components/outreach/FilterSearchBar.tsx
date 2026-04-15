'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ActiveFilter, FilterSuggestion, getFilterSuggestions } from '@/app/actions/outreach';

interface FilterSearchBarProps {
  activeFilters: ActiveFilter[];
  onAddFilter: (filter: ActiveFilter) => void;
  onRemoveFilter: (index: number) => void;
}

export function FilterSearchBar({ activeFilters, onAddFilter, onRemoveFilter }: FilterSearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<FilterSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await getFilterSuggestions(q);
      if (result.success) {
        // Filter out suggestions that are already active
        const filtered = result.suggestions.filter(
          (s) => !activeFilters.some((f) => f.field === s.field && f.value === s.value)
        );
        setSuggestions(filtered);
        setIsOpen(filtered.length > 0);
        setSelectedIndex(-1);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeFilters]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 200);
  };

  const handleSelect = (suggestion: FilterSuggestion) => {
    onAddFilter({ field: suggestion.field, value: suggestion.value });
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Search input */}
      <div className="relative" ref={containerRef}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg">
          <svg className="w-4 h-4 text-[#505050] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search to add filters..."
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setIsOpen(true); }}
            className="bg-transparent text-sm text-white placeholder-[#505050] outline-none ring-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
          />
          {isLoading && (
            <div className="w-4 h-4 border-2 border-[#505050] border-t-[#808080] rounded-full animate-spin shrink-0" />
          )}
        </div>

        {/* Suggestions dropdown */}
        {isOpen && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg shadow-lg shadow-black/40 z-50 py-1 max-h-[300px] overflow-y-auto">
            {suggestions.map((suggestion, i) => (
              <button
                key={`${suggestion.field}-${suggestion.value}`}
                onClick={() => handleSelect(suggestion)}
                className={`flex items-center gap-2 w-full px-3.5 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-[#353535]' : 'hover:bg-[#353535]'
                }`}
              >
                <span className="text-[11px] uppercase tracking-wider text-[#888] w-20 shrink-0">
                  {suggestion.label}
                </span>
                <span className="text-[13px] text-white flex-1 truncate">{suggestion.value}</span>
                <span className="text-[11px] text-[#666] shrink-0">{suggestion.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active filters */}
      <div className="flex items-center gap-1.5 flex-wrap px-1">
        <span className="text-[13px] text-[#888]">Filters:</span>
        {activeFilters.length === 0 ? (
          <span className="text-[13px] text-[#555]">None</span>
        ) : (
          activeFilters.map((filter, i) => (
            <span
              key={`${filter.field}-${filter.value}-${i}`}
              className="flex items-center gap-1 bg-[var(--accent-badge-bg)] border border-[var(--accent-border)] text-white text-[12px] rounded-md px-2 py-0.5"
            >
              <span className="text-[#888]">{filter.field}:</span>
              <span>{filter.value}</span>
              <button
                onClick={() => onRemoveFilter(i)}
                className="ml-0.5 text-[#888] hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
