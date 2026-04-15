'use client';

import { useCallback } from 'react';
import { OutreachTrackerEntry } from '@/app/actions/outreach';
import { OutreachRow } from './OutreachRow';
import { ColumnKey } from './OutreachFilters';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

interface OutreachTableProps {
  trackers: OutreachTrackerEntry[];
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onToggleResponse: (id: string) => void;
  onRowClick: (tracker: OutreachTrackerEntry) => void;
  visibleColumns: ColumnKey[];
  columnWidths: Record<string, number>;
  onStartResize: (column: ColumnKey, startX: number) => void;
  onAutoFitColumn: (column: ColumnKey, contentWidths: number[]) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  getColumnLabel: (column: ColumnKey) => string;
  getCustomCellValue: (trackerId: string, columnKey: string) => string;
  onCustomCellChange: (trackerId: string, columnKey: string, value: string) => void;
  tableRef: React.RefObject<HTMLDivElement>;
}

export function OutreachTable({
  trackers,
  onUpdate,
  onDelete,
  onToggleStar,
  onToggleResponse,
  onRowClick,
  visibleColumns,
  columnWidths,
  onStartResize,
  onAutoFitColumn,
  hasMore,
  isLoadingMore,
  onLoadMore,
  getColumnLabel,
  getCustomCellValue,
  onCustomCellChange,
  tableRef,
}: OutreachTableProps) {

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
  }, [onAutoFitColumn, tableRef]);

  return (
    <div ref={tableRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header Row - Fixed */}
      <div className="flex-shrink-0 flex items-center px-4 py-2.5 bg-[#2a2a2a] border-b border-[#3a3a3a]">
        {/* Star column header */}
        <div className="w-10 min-w-[40px] shrink-0" />
        {visibleColumns.map((col, index) => (
            <div
              key={col}
              className="relative flex items-center shrink-0"
              style={{ width: columnWidths[col] || 100 }}
              data-column={col}
            >
              <div
                className="flex-1 px-2 overflow-hidden cursor-pointer"
                onDoubleClick={() => handleDoubleClick(col)}
              >
                <span className="text-[13px] font-semibold text-white font-['Inter'] truncate">
                  {getColumnLabel(col)}
                </span>
              </div>

              {/* Resize handle - always visible divider with wide grab zone */}
              {index < visibleColumns.length - 1 && (
                <div
                  className="absolute -right-[3px] -top-2.5 -bottom-2.5 w-[7px] cursor-col-resize z-10 group flex items-center justify-center"
                  onMouseDown={(e) => handleResizeStart(col, e)}
                  onDoubleClick={() => handleDoubleClick(col)}
                >
                  <div className="w-[2px] h-full bg-[#404040] group-hover:bg-[var(--accent)] group-hover:w-[3px] transition-all" />
                </div>
              )}
            </div>
        ))}
        {/* Delete column header (empty) */}
        <div className="w-10 min-w-[40px] shrink-0" />
      </div>

      {/* Data Rows - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        {trackers.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[#666] text-sm">
            No results found
          </div>
        ) : (
          trackers.map((tracker) => (
            <OutreachRow
              key={tracker.id}
              tracker={tracker}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onToggleStar={onToggleStar}
              onToggleResponse={onToggleResponse}
              onRowClick={onRowClick}
              visibleColumns={visibleColumns}
              columnWidths={columnWidths}
              getColumnLabel={getColumnLabel}
              getCustomCellValue={getCustomCellValue}
              onCustomCellChange={onCustomCellChange}
            />
          ))
        )}

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
