'use client';

import { useState, useRef, useEffect } from 'react';
import { FilterOption } from '@/app/actions/outreach';

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  isLoading?: boolean;
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  isLoading = false,
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = options.filter((opt) =>
    opt.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clearSelection = () => {
    onChange([]);
    setIsOpen(false);
  };

  const hasSelection = selected.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-['Inter'] transition-colors ${
          hasSelection
            ? 'bg-[var(--accent-badge-bg)] border-[var(--accent)] text-white'
            : 'bg-[#1a1a1a] border-[#3a3a3a] text-white hover:border-[#505050]'
        }`}
      >
        <span>{label}</span>
        {hasSelection && (
          <span className="w-4 h-4 rounded bg-[var(--accent)] text-white text-[10px] font-medium flex items-center justify-center">
            {selected.length}
          </span>
        )}
        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-[260px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg shadow-lg shadow-black/40 z-50">
          {/* Search input */}
          <div className="p-2 border-b border-[#3a3a3a]">
            <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-md px-2.5 py-1.5">
              <svg className="w-3.5 h-3.5 text-white shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                placeholder={`Search ${label.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-xs text-white placeholder-[#505050] outline-none w-full font-['Inter']"
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="w-4 h-4 border-2 border-[#505050] border-t-[#808080] rounded-full animate-spin" />
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-white font-['Inter']">
                {searchQuery ? 'No matches found' : 'No options available'}
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    onClick={() => toggleOption(option.value)}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-[#353535] transition-colors text-left"
                  >
                    {/* Checkbox */}
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[var(--accent)]' : 'border border-[#505050]'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {/* Value */}
                    <span className={`text-[13px] font-['Inter'] flex-1 truncate ${isSelected ? 'text-white' : 'text-white'}`}>
                      {option.value}
                    </span>
                    {/* Count */}
                    <span className="text-[11px] text-white font-['Inter'] shrink-0">
                      {option.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Clear selection footer */}
          {hasSelection && (
            <div className="border-t border-[#3a3a3a] p-2">
              <button
                onClick={clearSelection}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-['Inter'] text-white hover:text-white hover:bg-[#353535] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
