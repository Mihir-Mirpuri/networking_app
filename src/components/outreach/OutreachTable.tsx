'use client';

import { OutreachTrackerEntry, SortField, SortDirection } from '@/app/actions/outreach';
import { OutreachRow } from './OutreachRow';
import { ColumnKey } from './OutreachFilters';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
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
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

interface ColumnConfig {
  key: ColumnKey;
  sortKey: SortField | null;
  label: string;
  width: string; // Tailwind class
}

const COLUMNS: ColumnConfig[] = [
  { key: 'name', sortKey: 'contactName', label: 'Name', width: 'w-[200px] min-w-[200px]' },
  { key: 'firm', sortKey: 'company', label: 'Firm', width: 'w-[100px] min-w-[100px]' },
  { key: 'role', sortKey: 'role', label: 'Role', width: 'w-[120px] min-w-[120px]' },
  { key: 'location', sortKey: 'location', label: 'Location', width: 'w-[100px] min-w-[100px]' },
  { key: 'group', sortKey: 'group', label: 'Group', width: 'w-[80px] min-w-[80px]' },
  { key: 'connection', sortKey: 'connectionType', label: 'Connection', width: 'w-[100px] min-w-[100px]' },
  { key: 'firstEmailDate', sortKey: 'dateEmailed', label: 'First Email', width: 'w-[100px] min-w-[100px]' },
  { key: 'lastEmailDate', sortKey: 'lastEmailDate', label: 'Last Email', width: 'w-[100px] min-w-[100px]' },
  { key: 'followUps', sortKey: 'followUpCount', label: 'Follow-ups', width: 'w-[80px] min-w-[80px]' },
  { key: 'subject', sortKey: null, label: 'Subject', width: 'flex-1 min-w-[100px]' },
  { key: 'notes', sortKey: null, label: 'Notes', width: 'w-[60px] min-w-[60px]' },
];

const SortIcon = ({ field, sortField, sortDirection }: { field: SortField | null; sortField: SortField; sortDirection: SortDirection }) => {
  if (!field) return null;
  if (sortField !== field) {
    return (
      <svg className="w-3 h-3 text-[#606060]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return sortDirection === 'asc' ? (
    <svg className="w-3 h-3 text-[#909090]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 text-[#909090]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  hasMore,
  isLoadingMore,
  onLoadMore,
}: OutreachTableProps) {
  const activeColumns = COLUMNS.filter((col) => visibleColumns.includes(col.key));

  if (trackers.length === 0) {
    return (
      <div className="flex-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg flex flex-col items-center justify-center py-20 gap-5">
        {/* Icon circle */}
        <div className="w-20 h-20 rounded-full bg-[#6364FF]/10 flex items-center justify-center">
          <svg className="w-9 h-9 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        {/* Text block */}
        <div className="flex flex-col items-center gap-2 max-w-[400px]">
          <h3 className="text-xl font-semibold text-[#E0E0E0] font-['Inter'] text-center">
            No emails sent yet
          </h3>
          <p className="text-sm text-[#707070] font-['Inter'] text-center max-w-[380px]">
            Once you send your first outreach email, it will appear here. Start by searching for people to connect with.
          </p>
        </div>

        {/* CTA button */}
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
    <div className="flex-1 flex flex-col min-h-0 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
      {/* Header Row - Fixed */}
      <div className="flex-shrink-0 flex items-center px-4 py-2.5 bg-[#2a2a2a] border-b border-[#3a3a3a]">
        {activeColumns.map((col) => (
          <div key={col.key} className={`${col.width} px-2`}>
            {col.sortKey ? (
              <button
                onClick={() => onSort(col.sortKey!)}
                className="flex items-center gap-1 hover:text-[#c0c0c0] transition-colors"
              >
                <span className="text-[13px] font-semibold text-[#909090] font-['Inter']">{col.label}</span>
                <SortIcon field={col.sortKey} sortField={sortField} sortDirection={sortDirection} />
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-[13px] font-semibold text-[#909090] font-['Inter']">{col.label}</span>
              </div>
            )}
          </div>
        ))}
        {/* Actions column header (empty) */}
        <div className="w-10 min-w-[40px]" />
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
          />
        ))}

        {/* Load More Button */}
        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="px-5 py-2.5 text-sm font-medium bg-[#252525] border border-[#3a3a3a] text-[#E0E0E0] rounded-lg hover:bg-[#303030] transition-all disabled:opacity-50"
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
