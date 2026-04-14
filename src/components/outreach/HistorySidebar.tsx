'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { HistorySidebarStats, HistorySection } from '@/app/actions/outreach';
import { ColumnKey } from './OutreachFilters';
import { ALL_COLUMNS } from './useColumnSettings';

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
  getColumnLabel: (column: ColumnKey) => string;
  // Custom columns
  onAddCustomColumn: (label: string) => void;
  onRemoveCustomColumn: (key: string) => void;
  onRenameCustomColumn: (key: string, newLabel: string) => void;
  // Auto-fit
  onAutoFitAll: () => void;
  onResetDefaults: () => void;
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
  const [animatedIn, setAnimatedIn] = useState(false);

  useEffect(() => {
    // Trigger staggered animation on mount
    const timer = setTimeout(() => setAnimatedIn(true), 50);
    return () => clearTimeout(timer);
  }, []);

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
      <div
        className="py-3 border-b border-[#1a1a1a] flex justify-center"
        style={{
          opacity: animatedIn ? 1 : 0,
          transform: animatedIn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
        }}
      >
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
          {SECTIONS.map((section, index) => (
            <button
              key={section.key}
              onClick={() => f.onSectionChange(section.key)}
              style={{
                opacity: animatedIn ? 1 : 0,
                transform: animatedIn ? 'translateY(0)' : 'translateY(8px)',
                transition: `opacity 0.2s ease-out ${(index + 1) * 40}ms, transform 0.2s ease-out ${(index + 1) * 40}ms`,
              }}
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

function ColumnsTab({ f }: { f: HistorySidebarFilterProps }) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [animatedIn, setAnimatedIn] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Trigger staggered animation on mount
    const timer = setTimeout(() => setAnimatedIn(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (editingKey && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingKey]);

  useEffect(() => {
    if (showNewInput && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [showNewInput]);

  const getVisibleIndex = (column: ColumnKey): number | null => {
    const visible = f.columnOrder.filter(f.isColumnVisible);
    const idx = visible.indexOf(column);
    return idx >= 0 ? idx + 1 : null;
  };

  const isCustomColumn = (col: ColumnKey) => !ALL_COLUMNS.includes(col as any);

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
      f.onReorderColumns(draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAddColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    f.onAddCustomColumn(trimmed);
    setNewColumnName('');
    setShowNewInput(false);
  };

  const handleStartRename = (key: string) => {
    setEditingKey(key);
    setEditingLabel(f.getColumnLabel(key));
  };

  const handleFinishRename = () => {
    if (editingKey && editingLabel.trim()) {
      f.onRenameCustomColumn(editingKey, editingLabel.trim());
    }
    setEditingKey(null);
    setEditingLabel('');
  };

  const visibleCols = f.columnOrder.filter(f.isColumnVisible);
  const hiddenCols = f.columnOrder.filter((col) => !f.isColumnVisible(col));

  const renderColumnRow = (col: ColumnKey, index: number, animIndex: number) => {
    const isActive = f.isColumnVisible(col);
    const isDragging = draggedIndex === index;
    const isDragOver = dragOverIndex === index;
    const isCustom = isCustomColumn(col);
    const isEditing = editingKey === col;

    return (
      <div
        key={col}
        draggable={!isEditing}
        onDragStart={(e) => handleDragStart(e, index)}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={() => setDragOverIndex(null)}
        onDrop={(e) => handleDrop(e, index)}
        onDragEnd={handleDragEnd}
        style={{
          opacity: animatedIn ? 1 : 0,
          transform: animatedIn ? 'translateY(0)' : 'translateY(8px)',
          transition: `opacity 0.2s ease-out ${animIndex * 40}ms, transform 0.2s ease-out ${animIndex * 40}ms`,
        }}
        className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing ${
          isDragging ? 'opacity-40 scale-95' : ''
        } ${isDragOver ? 'bg-[#6364FF]/10' : 'hover:bg-[#252525]'}`}
      >
        {/* Drag handle */}
        <svg className="w-3.5 h-3.5 text-[#444] group-hover:text-[#666] shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" />
        </svg>

        {/* Position number */}
        {getVisibleIndex(col) && (
          <span className="w-5 h-5 rounded-md bg-[#2a2a2a] text-[10px] text-[#666] font-medium flex items-center justify-center shrink-0 tabular-nums">
            {getVisibleIndex(col)}
          </span>
        )}

        {/* Column name */}
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editingLabel}
            onChange={(e) => setEditingLabel(e.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFinishRename();
              if (e.key === 'Escape') { setEditingKey(null); setEditingLabel(''); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-[13px] flex-1 bg-[#333] border border-[#505050] rounded px-1.5 py-0.5 text-white outline-none focus:border-[#6364FF] min-w-0"
          />
        ) : (
          <span
            className="text-[13px] flex-1 truncate min-w-0 text-white"
            onDoubleClick={isCustom ? () => handleStartRename(col) : undefined}
            title={isCustom ? 'Double-click to rename' : undefined}
          >
            {f.getColumnLabel(col)}
          </span>
        )}

        {/* Delete for custom columns */}
        {isCustom && !isEditing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              f.onRemoveCustomColumn(col);
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-[#444] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-900/20 transition-all shrink-0"
            title="Remove column"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Toggle switch */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            f.onToggleColumn(col);
          }}
          className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors duration-200 ${
            isActive ? 'bg-[#6364FF]' : 'bg-[#333]'
          }`}
        >
          <div
            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all duration-200 ${
              isActive ? 'left-[14px] bg-white' : 'left-[2px] bg-[#666]'
            }`}
          />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#252525]">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white tracking-wide uppercase">Columns</span>
          <button
            onClick={f.onAutoFitAll}
            className="flex items-center gap-1 text-[11px] text-[#666] hover:text-white transition-colors"
          >
            Autosize
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Column list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {/* Visible columns */}
        {visibleCols.length > 0 && (
          <>
            <div className="px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[#555] font-medium">Visible</span>
            </div>
            {visibleCols.map((col, animIdx) => renderColumnRow(col, f.columnOrder.indexOf(col), animIdx))}
          </>
        )}

        {/* Hidden columns */}
        {hiddenCols.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[#555] font-medium">Hidden</span>
            </div>
            {hiddenCols.map((col, animIdx) => renderColumnRow(col, f.columnOrder.indexOf(col), visibleCols.length + animIdx))}
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-3 py-3 flex items-center gap-1.5">
        {showNewInput ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              ref={newInputRef}
              type="text"
              placeholder="Column name..."
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddColumn();
                if (e.key === 'Escape') { setShowNewInput(false); setNewColumnName(''); }
              }}
              onBlur={() => { if (!newColumnName.trim()) setShowNewInput(false); }}
              className="flex-1 bg-[#222] border border-[#3a3a3a] rounded-lg px-3 py-2 text-[13px] text-white placeholder-[#555] outline-none focus:border-[#6364FF] transition-colors min-w-0"
            />
            <button
              onClick={handleAddColumn}
              disabled={!newColumnName.trim()}
              className="p-2 rounded-lg bg-[#6364FF] text-white hover:bg-[#5354EE] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewInput(true)}
            className="flex items-center justify-center gap-2 flex-1 px-3 py-2 rounded-lg bg-[#0b57d0] hover:bg-[#0842a0] text-[13px] text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Column
          </button>
        )}
      </div>
    </div>
  );
}

export function HistorySidebar({ stats, filterProps }: HistorySidebarProps) {
  const [showColumns, setShowColumns] = useState(false);

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

        {/* Columns toggle button */}
        <button
          onClick={() => setShowColumns(!showColumns)}
          className={`p-1.5 rounded-md transition-colors ${
            showColumns ? 'bg-[#0b57d0] text-white' : 'text-[#666] hover:text-white hover:bg-[#252525]'
          }`}
          title={showColumns ? 'Back to filters' : 'Edit columns'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {/* Column grid lines */}
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 2v16M13 2v9M2 6h18M2 12h8" />
            {/* Pencil icon in bottom right */}
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l7-7 3 3-7 7h-3v-3z" />
          </svg>
        </button>
      </div>

      {/* Content: either filters or column manager */}
      {showColumns ? (
        <ColumnsTab f={filterProps} />
      ) : (
        <FiltersTab f={filterProps} stats={stats} />
      )}
    </aside>
  );
}
