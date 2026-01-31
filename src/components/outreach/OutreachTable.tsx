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
  { key: 'contactName', label: 'Name', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'company', label: 'Company', sortable: true },
  { key: 'role', label: 'Role', sortable: true },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'dateEmailed', label: 'Emailed', sortable: true },
  { key: null, label: 'Spoke To', sortable: false },
  { key: null, label: 'Notes', sortable: false },
  { key: null, label: '', sortable: false, className: 'w-12' },
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
        <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  if (trackers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-surface-500">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-surface-700">No outreach contacts yet</p>
        <p className="text-sm mt-1 text-surface-500">
          Send an email through the app to automatically track your outreach
        </p>
      </div>
    );
  }

  return (
    <div className="border border-surface-200 rounded-xl overflow-hidden shadow-soft">
      <table className="w-full border-collapse table-fixed">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface-50">
            {COLUMNS.map((column, index) => (
              <th
                key={index}
                className={`px-4 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider border-b border-surface-200 ${
                  index < COLUMNS.length - 1 ? 'border-r border-surface-100' : ''
                } ${column.className || ''}`}
              >
                {column.sortable && column.key ? (
                  <button
                    onClick={() => onSort(column.key!)}
                    className="flex items-center gap-1.5 hover:text-surface-900 transition-colors"
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
        <tbody className="bg-white divide-y divide-surface-100">
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
