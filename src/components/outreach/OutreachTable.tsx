'use client';

import { useRef, useCallback } from 'react';
import { OutreachTrackerEntry, SortField, SortDirection } from '@/app/actions/outreach';
import { OutreachRow } from './OutreachRow';
import { ColumnKey } from './OutreachFilters';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { COLUMN_LABELS } from './useColumnSettings';
import Link from 'next/link';

interface OutreachTableProps {
  trackers: OutreachTrackerEntry[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onRowClick: (tracker: OutreachTrackerEntry) => void;
  visibleColumns: ColumnKey[];
  columnWidths: Record<ColumnKey, number>;
  onStartResize: (column: ColumnKey, startX: number) => void;
  onAutoFitColumn: (column: ColumnKey, contentWidths: number[]) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

// Map column keys to sortable fields
const SORT_KEYS: Partial<Record<ColumnKey, SortField>> = {
  name: 'contactName',
  firm: 'company',
  role: 'role',
  location: 'location',
  firstEmailDate: 'dateEmailed',
  lastEmailDate: 'lastEmailDate',
  followUps: 'followUpCount',
};

const SortIcon = ({ field, sortField, sortDirection }: { field: SortField | null; sortField: SortField; sortDirection: SortDirection }) => {
  if (!field) return null;
  if (sortField !== field) {
    return (
      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return sortDirection === 'asc' ? (
    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
};

export function OutreachTable({
  trackers,
  sortField,
  sortDirection,
  onSort,
  onUpdate,
  onDelete,
  onToggleStar,
  onRowClick,
  visibleColumns,
  columnWidths,
  onStartResize,
  onAutoFitColumn,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: OutreachTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((column: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onStartResize(column, e.clientX);
  }, [onStartResize]);

  const handleDoubleClick = useCallback((column: ColumnKey) => {
    if (!tableRef.current) return;

    const cells = tableRef.current.querySelectorAll(`[data-column="${column}"]`);
    const contentWidths: number[] = [];

    cells.forEach((cell) => {
      const content = cell.firstElementChild;
      if (content) {
        contentWidths.push(content.scrollWidth);
      }
    });

    onAutoFitColumn(column, contentWidths);
  }, [onAutoFitColumn]);

  if (trackers.length === 0) {
    return (
      <div className="flex-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg flex flex-col items-center justify-center py-20 gap-5">
        <div className="w-20 h-20 rounded-full bg-[#6364FF]/10 flex items-center justify-center">
          <svg className="w-9 h-9 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <div className="flex flex-col items-center gap-2 max-w-[400px]">
          <h3 className="text-xl font-semibold text-white font-['Inter'] text-center">
            No emails sent yet
          </h3>
          <p className="text-sm text-white font-['Inter'] text-center max-w-[380px]">
            Once you send your first outreach email, it will appear here. Start by searching for people to connect with.
          </p>
        </div>

        <Link
          href="/"
          className="flex items-center gap-2 bg-[#6364FF] rounded-lg px-6 py-3 hover:bg-[#5354EE] transition-colors"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm font-medium text-white font-['Inter']">Find People</span>
        </Link>
      </div>
    );
  }

  return (
    <div ref={tableRef} className="flex-1 flex flex-col min-h-0 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
      {/* Header Row - Fixed */}
      <div className="flex-shrink-0 flex items-center px-4 py-2.5 bg-[#2a2a2a] border-b border-[#3a3a3a]">
        {visibleColumns.map((col, index) => {
          const sortKey = SORT_KEYS[col] || null;

          return (
            <div
              key={col}
              className="relative flex items-center shrink-0"
              style={{ width: columnWidths[col] }}
              data-column={col}
            >
              <div className="flex-1 px-2 overflow-hidden">
                {sortKey ? (
                  <button
                    onClick={() => onSort(sortKey)}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                  >
                    <span className="text-[13px] font-semibold text-white font-['Inter'] truncate">
                      {COLUMN_LABELS[col]}
                    </span>
                    <SortIcon field={sortKey} sortField={sortField} sortDirection={sortDirection} />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[13px] font-semibold text-white font-['Inter'] truncate">
                      {COLUMN_LABELS[col]}
                    </span>
                  </div>
                )}
              </div>

              {/* Resize handle */}
              {index < visibleColumns.length - 1 && (
                <div
                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#6364FF] transition-colors z-10 group"
                  onMouseDown={(e) => handleResizeStart(col, e)}
                  onDoubleClick={() => handleDoubleClick(col)}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#505050] rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>
          );
        })}
        {/* Actions column header (empty) */}
        <div className="w-10 min-w-[40px] shrink-0" />
      </div>

      {/* Data Rows - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        {trackers.map((tracker) => (
          <OutreachRow
            key={tracker.id}
            tracker={tracker}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onRowClick={onRowClick}
            visibleColumns={visibleColumns}
            columnWidths={columnWidths}
          />
        ))}

        {/* Load More Button */}
        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="px-5 py-2.5 text-sm font-medium bg-[#252525] border border-[#3a3a3a] text-white rounded-lg hover:bg-[#303030] transition-all disabled:opacity-50"
            >
              {isLoadingMore ? (
                <span className="flex items-center gap-2">
                  <LoadingSpinner size="sm" />
                  Loading...
                </span>
              ) : (
                'Load More'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
