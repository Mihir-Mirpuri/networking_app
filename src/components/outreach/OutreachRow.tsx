'use client';

import { useState, useRef, useEffect } from 'react';
import { OutreachTrackerEntry, updateOutreachTracker, toggleResponseReceived } from '@/app/actions/outreach';
import { NotesModal } from './NotesModal';
import { InteractionModal } from './InteractionModal';
import { ColumnKey } from './OutreachFilters';
import { ALL_COLUMNS } from './useColumnSettings';
import { InteractionType } from '@prisma/client';

interface OutreachRowProps {
  tracker: OutreachTrackerEntry;
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onToggleResponse: (id: string) => void;
  onRowClick: (tracker: OutreachTrackerEntry) => void;
  visibleColumns: ColumnKey[];
  columnWidths: Record<string, number>;
  getColumnLabel: (column: ColumnKey) => string;
  getCustomCellValue: (trackerId: string, columnKey: string) => string;
  onCustomCellChange: (trackerId: string, columnKey: string, value: string) => void;
}

// Deterministic avatar color from name
const AVATAR_COLORS = ['#6364FF', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];
function getAvatarColor(name: string | null, email: string): string {
  const str = name || email;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function CustomCell({ trackerId, columnKey, width, getValue, onChange }: {
  trackerId: string;
  columnKey: string;
  width: number;
  getValue: (trackerId: string, columnKey: string) => string;
  onChange: (trackerId: string, columnKey: string, value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const value = getValue(trackerId, columnKey);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(value);
    setIsEditing(true);
  };

  const handleFinish = () => {
    onChange(trackerId, columnKey, editValue);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="px-2 shrink-0" style={{ width }} data-column={columnKey}>
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleFinish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinish();
            if (e.key === 'Escape') setIsEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-[#333] border border-[#505050] rounded px-1.5 py-0.5 text-[13px] text-white outline-none focus:border-[var(--accent)] font-['Inter']"
        />
      </div>
    );
  }

  return (
    <div
      className="px-2 shrink-0 cursor-text"
      style={{ width }}
      data-column={columnKey}
      onClick={handleStartEdit}
    >
      <span className="text-[13px] text-white font-['Inter'] truncate block">
        {value || <span className="text-[#555]">--</span>}
      </span>
    </div>
  );
}

export function OutreachRow({ tracker, onUpdate, onDelete, onToggleStar, onToggleResponse, onRowClick, visibleColumns, columnWidths, getColumnLabel, getCustomCellValue, onCustomCellChange }: OutreachRowProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showInteractionModal, setShowInteractionModal] = useState(false);

  const formatDate = (date: Date | null) => {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const handleNotesSave = async (notes: string | null) => {
    const result = await updateOutreachTracker({ id: tracker.id, notes });
    if (result.success) onUpdate(result.tracker);
    else throw new Error(result.error);
  };

  const handleInteractionSave = async (
    spokeToThem: boolean,
    interactionType: InteractionType,
    interactionDate: Date | null
  ) => {
    const result = await updateOutreachTracker({ id: tracker.id, spokeToThem, interactionType, interactionDate });
    if (result.success) onUpdate(result.tracker);
    else throw new Error(result.error);
  };

  const handleRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) return;
    onRowClick(tracker);
  };

  const avatarColor = getAvatarColor(tracker.contactName, tracker.contactEmail);
  const initials = getInitials(tracker.contactName, tracker.contactEmail);

  const renderCell = (col: ColumnKey) => {
    const width = columnWidths[col];

    switch (col) {
      case 'name':
        return (
          <div
            className="px-2 flex items-center gap-2.5 shrink-0"
            style={{ width }}
            data-column={col}
          >
            {/* Avatar */}
            <div
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: avatarColor }}
            >
              <span className="text-[11px] font-semibold text-white font-['Inter']">{initials}</span>
            </div>
            {/* Name + Email */}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-[13px] font-medium text-white font-['Inter'] truncate">
                {tracker.contactName || tracker.contactEmail}
              </span>
              <span className="text-[11px] text-white font-['Inter'] truncate">
                {tracker.contactEmail}
              </span>
            </div>
          </div>
        );
      case 'firm':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.company || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'role':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.role || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'location':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.location || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'group':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.group || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'connection':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.connectionType || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'firstEmailDate':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block whitespace-nowrap">
              {formatDate(tracker.dateEmailed)}
            </span>
          </div>
        );
      case 'lastEmailDate':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block whitespace-nowrap">
              {formatDate(tracker.lastEmailDate)}
            </span>
          </div>
        );
      case 'followUps':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block text-center">
              {tracker.followUpCount > 0 ? tracker.followUpCount : <span className="text-white">0</span>}
            </span>
          </div>
        );
      case 'response':
        return (
          <div className="px-2 flex justify-center shrink-0" style={{ width }} data-column={col}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleResponse(tracker.id); }}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                tracker.responseReceivedAt
                  ? 'bg-[#22c55e] border-[#22c55e]'
                  : 'border-[#505050] hover:border-[#22c55e]'
              }`}
            >
              {tracker.responseReceivedAt && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
        );
      case 'subject':
        return (
          <div className="px-2 shrink-0" style={{ width }} data-column={col}>
            <span className="text-[13px] text-white font-['Inter'] truncate block">
              {tracker.emailSubject || <span className="text-white">--</span>}
            </span>
          </div>
        );
      case 'notes':
        return (
          <div className="px-2 flex justify-center shrink-0" style={{ width }} data-column={col}>
            {tracker.notes ? (
              <svg className="w-4 h-4 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
              </svg>
            ) : (
              <span className="text-white">--</span>
            )}
          </div>
        );
      default:
        // Custom column — inline editable
        if (!ALL_COLUMNS.includes(col as any)) {
          return (
            <CustomCell
              trackerId={tracker.id}
              columnKey={col}
              width={width}
              getValue={getCustomCellValue}
              onChange={onCustomCellChange}
            />
          );
        }
        return null;
    }
  };

  return (
    <>
      <div
        className="flex items-center px-4 py-2.5 bg-[#1a1a1a] border-b border-[#2a2a2a] hover:bg-[#252525] cursor-pointer transition-colors group"
        onClick={handleRowClick}
      >
        {/* Star button - always visible */}
        <div className="w-10 min-w-[40px] flex justify-center shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(tracker.id); }}
            className="p-1 transition-colors rounded"
          >
            <svg
              className={`w-4 h-4 ${tracker.starred ? 'text-[#f59e0b]' : 'text-[#505050] hover:text-[#f59e0b]'}`}
              fill={tracker.starred ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </div>

        {visibleColumns.map((col) => (
          <div key={col} className="contents">
            {renderCell(col)}
          </div>
        ))}

        {/* Delete button - visible on hover */}
        <div className="w-10 min-w-[40px] flex justify-center shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
            className="p-1 text-[#505050] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Modals */}
      <NotesModal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        onSave={handleNotesSave}
        currentNotes={tracker.notes}
        contactName={tracker.contactName}
      />

      <InteractionModal
        isOpen={showInteractionModal}
        onClose={() => setShowInteractionModal(false)}
        onSave={handleInteractionSave}
        currentSpokeToThem={tracker.spokeToThem}
        currentInteractionType={tracker.interactionType}
        currentInteractionDate={tracker.interactionDate}
        contactName={tracker.contactName}
      />

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#2a2a2a] rounded-2xl shadow-lg shadow-black/40 max-w-sm w-full p-6 animate-scale-in">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-center text-white mb-2">Delete Contact</h3>
            <p className="text-white text-center mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium text-white">{tracker.contactName || tracker.contactEmail}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2.5 text-sm font-medium bg-[#333333] text-white rounded-lg hover:bg-[#3a3a3a] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(tracker.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
