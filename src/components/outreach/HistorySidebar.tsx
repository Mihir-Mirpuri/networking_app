'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { HistorySidebarStats, HistorySection } from '@/app/actions/outreach';
import { ColumnKey } from './OutreachFilters';

function SignalLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="12" fill="currentColor" />
      <path d="M78 56 A30 30 0 0 0 78 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M122 56 A30 30 0 0 1 122 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M58 38 A55 55 0 0 0 58 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M142 38 A55 55 0 0 1 142 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M38 20 A80 80 0 0 0 38 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M162 20 A80 80 0 0 1 162 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export interface HistorySidebarFilterProps {
  isLoading: boolean;
  activeSection: HistorySection;
  onSectionChange: (section: HistorySection) => void;
  columnOrder: ColumnKey[];
  isColumnVisible: (column: ColumnKey) => boolean;
  onToggleColumn: (column: ColumnKey) => void;
  onReorderColumns: (fromIndex: number, toIndex: number) => void;
  columnLabels: Record<ColumnKey, string>;
}

interface HistorySidebarProps {
  stats: HistorySidebarStats;
  filterProps: HistorySidebarFilterProps;
}

const SECTIONS: { key: HistorySection; label: string; icon: React.ReactNode }[] = [
  {
    key: 'all',
    label: 'All Sent',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'starred',
    label: 'Starred',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    key: 'savedForLater',
    label: 'Saved for Later',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
  },
  {
    key: 'hasResponse',
    label: 'Has Response',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function FiltersTab({ f, stats }: { f: HistorySidebarFilterProps; stats: HistorySidebarStats }) {
  const sectionCounts: Record<HistorySection, number> = {
    all: stats.totalTrackers,
    starred: stats.starredCount,
    scheduled: stats.scheduledEmailsPending,
    savedForLater: stats.savedForLaterCount,
    hasResponse: stats.responsesReceived,
  };

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Stats Quadrant */}
      <div className="py-3 border-b border-[#1a1a1a] flex justify-center">
        <div className="grid grid-cols-2 gap-y-3" style={{ columnGap: 0, gridTemplateColumns: 'auto auto' }}>
          <div className="text-center px-4">
            <p className="text-3xl font-bold text-white tabular-nums leading-none">{stats.totalEmailsSent}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#666] leading-none mt-1">Total Sent</p>
          </div>
          <div className="text-center px-4">
            <p className="text-3xl font-bold text-white tabular-nums leading-none">{stats.emailsSentThisWeek}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#666] leading-none mt-1">This Week</p>
          </div>
          <div className="text-center px-4">
            <p className="text-3xl font-bold text-white tabular-nums leading-none">{stats.emailsSentThisMonth}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#666] leading-none mt-1">This Month</p>
          </div>
          <div className="text-center px-4">
            <p className="text-3xl font-bold text-white tabular-nums leading-none">{stats.avgEmailsPerWeek}</p>
            <p className="text-[10px] uppercase tracking-wider text-[#666] leading-none mt-1">Avg / Week</p>
          </div>
        </div>
      </div>

      {/* Section Filters */}
      <div className="px-4 py-3 border-b border-[#1a1a1a]">
        <div className="flex flex-col gap-1">
          {SECTIONS.map((section) => (
            <button
              key={section.key}
              onClick={() => f.onSectionChange(section.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                f.activeSection === section.key
                  ? 'bg-[#6364FF]/20 text-white'
                  : 'text-[#888] hover:text-white hover:bg-[#252525]'
              }`}
            >
              {section.icon}
              <span className="flex-1 text-left">{section.label}</span>
              <span className="text-[11px] text-[#888] font-medium tabular-nums">
                {sectionCounts[section.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

export function HistorySidebar({ stats, filterProps }: HistorySidebarProps) {
  const [showColumns, setShowColumns] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setShowColumns(false);
      }
    };
    if (showColumns) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColumns]);

  const getVisibleIndex = (column: ColumnKey): number | null => {
    const visibleColumns = filterProps.columnOrder.filter(filterProps.isColumnVisible);
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

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      filterProps.onReorderColumns(draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <aside className="w-80 bg-[#181818] flex-shrink-0 flex flex-col border-r border-[#1a1a1a]">
      {/* Signl logo header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-[#1a1a1a]">
        <Link href="/" className="flex items-center gap-2 group">
          <SignalLogo className="w-7 h-7 text-white" />
          <span className="text-xl font-bold text-white group-hover:text-white transition-colors">
            Signl
          </span>
        </Link>

        {/* Columns button */}
        <div className="relative" ref={columnsRef}>
          <button
            onClick={() => setShowColumns(!showColumns)}
            className={`p-1.5 rounded-md transition-colors ${
              showColumns ? 'bg-[#2a2a2a] text-white' : 'text-[#666] hover:text-white hover:bg-[#252525]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v16M15 4v16M3 8h18M3 16h18" />
            </svg>
          </button>

          {showColumns && (
            <div className="absolute right-0 top-full mt-2 w-[240px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg shadow-lg shadow-black/40 z-50 py-2">
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-white">Columns</span>
                <span className="text-[10px] text-[#666]">Drag to reorder</span>
              </div>
              <div className="h-px bg-[#3a3a3a] my-1" />
              <div className="py-0.5">
                {filterProps.columnOrder.map((col, index) => {
                  const isActive = filterProps.isColumnVisible(col);
                  const visibleNum = getVisibleIndex(col);
                  const isDragging = draggedIndex === index;
                  const isDragOver = dragOverIndex === index;

                  return (
                    <div
                      key={col}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-[#353535] transition-colors cursor-grab active:cursor-grabbing ${
                        isDragging ? 'opacity-50' : ''
                      } ${isDragOver ? 'bg-[#353535]' : ''}`}
                    >
                      <div className="flex flex-col gap-0.5 text-[#555] shrink-0">
                        <div className="flex gap-0.5">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          <div className="w-1 h-1 bg-current rounded-full" />
                        </div>
                        <div className="flex gap-0.5">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          <div className="w-1 h-1 bg-current rounded-full" />
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          filterProps.onToggleColumn(col);
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
                      <span className="text-[13px] flex-1 text-white">{filterProps.columnLabels[col]}</span>
                      {visibleNum && (
                        <span className="w-5 h-5 rounded bg-[#3a3a3a] text-[10px] text-[#888] font-medium flex items-center justify-center">
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
      </div>

      <FiltersTab f={filterProps} stats={stats} />
    </aside>
  );
}
