'use client';

import { OutreachTrackerEntry, SortField, SortDirection } from '@/app/actions/outreach';
import { OutreachRow } from './OutreachRow';

interface OutreachTableProps {
  trackers: OutreachTrackerEntry[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
  onRowClick: (tracker: OutreachTrackerEntry) => void;
}

interface ColumnConfig {
  key: SortField | null;
  label: string;
  sortable: boolean;
  className?: string;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'contactName', label: 'Name', sortable: true, className: 'w-[18%]' },
  { key: 'company', label: 'Company', sortable: true, className: 'w-[14%]' },
  { key: 'role', label: 'Role', sortable: true, className: 'w-[14%]' },
  { key: 'location', label: 'Location', sortable: true, className: 'w-[12%]' },
  { key: 'dateEmailed', label: 'Emailed', sortable: true, className: 'w-[9%]' },
  { key: null, label: 'Spoke To', sortable: false, className: 'w-[8%]' },
  { key: null, label: 'Notes', sortable: false, className: 'w-[11%]' },
  { key: 'status', label: 'Status', sortable: true, className: 'w-[10%]' },
  { key: null, label: '', sortable: false, className: 'w-[4%]' },
];

export function OutreachTable({
  trackers,
  sortField,
  sortDirection,
  onSort,
  onUpdate,
  onDelete,
  onRowClick,
}: OutreachTableProps) {
  const renderSortIcon = (field: SortField | null) => {
    if (!field) return null;
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-[#606060]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-[#808080]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  if (trackers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[#707070]">
        <div className="w-20 h-20 mb-5 rounded-2xl bg-[#2a2a2a] flex items-center justify-center border border-[#353535]">
          <svg className="w-10 h-10 text-[#505050]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-xl font-semibold text-[#c0c0c0]">No outreach contacts yet</p>
        <p className="text-sm mt-2 text-[#606060]">
          Send an email through the app to automatically track your outreach
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[#353535] rounded-2xl overflow-hidden shadow-lg shadow-black/20 overflow-x-auto bg-[#1e1e1e]">
      <table className="w-full border-collapse md:table-fixed">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#282828] border-b border-[#3a3a3a]">
            {COLUMNS.map((column, index) => (
              <th
                key={index}
                className={`px-5 py-4 text-left text-[11px] font-semibold text-[#888888] uppercase tracking-wider ${column.className || ''}`}
              >
                {column.sortable && column.key ? (
                  <button
                    onClick={() => onSort(column.key!)}
                    className="flex items-center gap-1.5 hover:text-[#c0c0c0] transition-colors"
                  >
                    {column.label}
                    {renderSortIcon(column.key)}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trackers.map((tracker, index) => (
            <OutreachRow
              key={tracker.id}
              tracker={tracker}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onRowClick={onRowClick}
              isEven={index % 2 === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
