'use client';

import { useEffect, useRef, useState } from 'react';
import { OutreachFilterOptions } from '@/app/actions/outreach';
import { MultiSelectFilter } from './MultiSelectFilter';

export type ColumnKey = 'name' | 'firm' | 'role' | 'location' | 'group' | 'connection' | 'firstEmailDate' | 'lastEmailDate' | 'followUps' | 'subject' | 'notes';

interface OutreachFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearch: () => void;
  isLoading: boolean;
  starredFilter: boolean | undefined;
  onStarredFilterChange: (starred: boolean | undefined) => void;
  scheduledFilter: boolean | undefined;
  onScheduledFilterChange: (scheduled: boolean | undefined) => void;
  // Column settings
  columnOrder: ColumnKey[];
  isColumnVisible: (column: ColumnKey) => boolean;
  onToggleColumn: (column: ColumnKey) => void;
  onReorderColumns: (fromIndex: number, toIndex: number) => void;
  columnLabels: Record<ColumnKey, string>;
  showClearAll: boolean;
  onClearAll: () => void;
  // Multi-select filter options
  filterOptions: OutreachFilterOptions | null;
  filterOptionsLoading: boolean;
  selectedFirms: string[];
  selectedRoles: string[];
  selectedGroups: string[];
  selectedConnections: string[];
  onFirmsChange: (firms: string[]) => void;
  onRolesChange: (roles: string[]) => void;
  onGroupsChange: (groups: string[]) => void;
  onConnectionsChange: (connections: string[]) => void;
}

export function OutreachFilters({
  searchQuery,
  onSearchChange,
  onSearch,
  isLoading,
  starredFilter,
  onStarredFilterChange,
  scheduledFilter,
  onScheduledFilterChange,
  columnOrder,
  isColumnVisible,
  onToggleColumn,
  onReorderColumns,
  columnLabels,
  showClearAll,
  onClearAll,
  filterOptions,
  filterOptionsLoading,
  selectedFirms,
  selectedRoles,
  selectedGroups,
  selectedConnections,
  onFirmsChange,
  onRolesChange,
  onGroupsChange,
  onConnectionsChange,
}: OutreachFiltersProps) {
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);
  const [showColumnsDropdown, setShowColumnsDropdown] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Debounced search on query change
  useEffect(() => {
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

  // Close columns dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setShowColumnsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const starredActive = starredFilter === true;
  const scheduledActive = scheduledFilter === true;

  // Count visible columns for numbering
  const getVisibleIndex = (column: ColumnKey): number | null => {
    const visibleColumns = columnOrder.filter(isColumnVisible);
    const idx = visibleColumns.indexOf(column);
    return idx >= 0 ? idx + 1 : null;
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    if (fromIndex !== null && fromIndex !== toIndex) {
      onReorderColumns(fromIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search Row */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg px-4 py-3">
          <svg className="w-4 h-4 text-[#505050] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, email, company, or subject..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-transparent text-sm text-[#E0E0E0] placeholder-[#505050] outline-none w-full font-['Inter']"
          />
          {isLoading && (
            <div className="w-4 h-4 border-2 border-[#505050] border-t-[#808080] rounded-full animate-spin shrink-0" />
          )}
        </div>

        <button className="flex items-center gap-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg px-4 py-3 shrink-0">
          <span className="text-sm text-[#E0E0E0] font-['Inter']">All time</span>
          <svg className="w-4 h-4 text-[#707070]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <button
          onClick={onSearch}
          className="bg-[#6364FF] rounded-lg px-5 py-3 shrink-0 hover:bg-[#5354EE] transition-colors"
        >
          <span className="text-sm text-white font-medium font-['Inter']">Search</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-[#707070] font-['Inter']">Filter by:</span>

        {/* Starred filter */}
        <button
          onClick={() => onStarredFilterChange(starredActive ? undefined : true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-['Inter'] transition-colors ${
            starredActive
              ? 'bg-[#6364FF]/20 border-[#6364FF] text-[#E0E0E0]'
              : 'bg-[#1a1a1a] border-[#3a3a3a] text-[#E0E0E0] hover:border-[#505050]'
          }`}
        >
          <svg className="w-3 h-3 text-[#f59e0b]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span>Starred</span>
        </button>

        {/* Scheduled filter */}
        <button
          onClick={() => onScheduledFilterChange(scheduledActive ? undefined : true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-['Inter'] transition-colors ${
            scheduledActive
              ? 'bg-[#6364FF]/20 border-[#6364FF] text-[#E0E0E0]'
              : 'bg-[#1a1a1a] border-[#3a3a3a] text-[#E0E0E0] hover:border-[#505050]'
          }`}
        >
          <svg className="w-3 h-3 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Scheduled</span>
        </button>

        {/* Multi-select filter dropdowns */}
        <MultiSelectFilter
          label="Firm"
          options={filterOptions?.firms ?? []}
          selected={selectedFirms}
          onChange={onFirmsChange}
          isLoading={filterOptionsLoading}
        />
        <MultiSelectFilter
          label="Role"
          options={filterOptions?.roles ?? []}
          selected={selectedRoles}
          onChange={onRolesChange}
          isLoading={filterOptionsLoading}
        />
        <MultiSelectFilter
          label="Group"
          options={filterOptions?.groups ?? []}
          selected={selectedGroups}
          onChange={onGroupsChange}
          isLoading={filterOptionsLoading}
        />
        <MultiSelectFilter
          label="Connection"
          options={filterOptions?.connections ?? []}
          selected={selectedConnections}
          onChange={onConnectionsChange}
          isLoading={filterOptionsLoading}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Columns button */}
        <div className="relative" ref={columnsRef}>
          <button
            onClick={() => setShowColumnsDropdown(!showColumnsDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1a] border border-[#3a3a3a] text-xs font-['Inter'] hover:border-[#505050] transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-[#E0E0E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16M15 4v16M3 8h18M3 16h18" />
            </svg>
            <span className="text-[#E0E0E0] font-medium">Columns</span>
            <svg className="w-3 h-3 text-[#707070]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Columns Dropdown */}
          {showColumnsDropdown && (
            <div className="absolute right-0 top-full mt-2 w-[260px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg shadow-lg shadow-black/40 z-50 py-2">
              <div className="px-3.5 py-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#E0E0E0] font-['Inter']">Manage Columns</span>
                <span className="text-[11px] text-[#606060] font-['Inter']">Drag to reorder</span>
              </div>
              <div className="h-px bg-[#3a3a3a]" />

              <div className="py-1">
                {columnOrder.map((col, index) => {
                  const isActive = isColumnVisible(col);
                  const visibleNum = getVisibleIndex(col);
                  const isDragging = draggedIndex === index;
                  const isDragOver = dragOverIndex === index;

                  return (
                    <div
                      key={col}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 w-full px-3.5 py-2 hover:bg-[#353535] transition-colors cursor-grab active:cursor-grabbing ${
                        isDragging ? 'opacity-50' : ''
                      } ${isDragOver ? 'bg-[#3a3a3a]' : ''}`}
                    >
                      {/* Drag handle */}
                      <div className="flex flex-col gap-0.5 text-[#505050] shrink-0">
                        <div className="flex gap-0.5">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          <div className="w-1 h-1 bg-current rounded-full" />
                        </div>
                        <div className="flex gap-0.5">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          <div className="w-1 h-1 bg-current rounded-full" />
                        </div>
                      </div>

                      {/* Checkbox */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleColumn(col);
                        }}
                        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                          isActive ? 'bg-[#6364FF]' : 'border border-[#505050]'
                        }`}
                      >
                        {isActive && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>

                      {/* Column name */}
                      <span className={`text-[13px] font-['Inter'] flex-1 ${isActive ? 'text-[#E0E0E0]' : 'text-[#707070]'}`}>
                        {columnLabels[col]}
                      </span>

                      {/* Position number */}
                      {visibleNum && (
                        <span className="w-5 h-5 rounded bg-[#3a3a3a] text-[11px] text-[#909090] font-medium font-['Inter'] flex items-center justify-center">
                          {visibleNum}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Clear All button */}
        {showClearAll && (
          <button
            onClick={onClearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1a] border border-[#3a3a3a] text-xs font-['Inter'] text-[#909090] hover:text-red-400 hover:border-red-400/50 hover:bg-red-900/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Clear All</span>
          </button>
        )}
      </div>
    </div>
  );
}
