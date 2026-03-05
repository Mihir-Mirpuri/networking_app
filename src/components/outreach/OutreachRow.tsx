'use client';

import { useState } from 'react';
import { OutreachStatus, InteractionType } from '@prisma/client';
import { OutreachTrackerEntry, updateOutreachTracker } from '@/app/actions/outreach';
import { StatusDropdown } from './StatusDropdown';
import { NotesModal } from './NotesModal';
import { InteractionModal, getInteractionLabel } from './InteractionModal';

interface OutreachRowProps {
  tracker: OutreachTrackerEntry;
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
  onRowClick: (tracker: OutreachTrackerEntry) => void;
  isEven?: boolean;
}

export function OutreachRow({ tracker, onUpdate, onDelete, onRowClick, isEven = false }: OutreachRowProps) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const formatRelativeDate = (date: Date | null) => {
    if (!date) return '-';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  const formatFullDate = (date: Date | null) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleStartEdit = (field: string, value: string | null) => {
    setIsEditing(field);
    setEditValue(value || '');
  };

  const handleSaveEdit = async (field: string) => {
    if (isSaving) return;
    setIsSaving(true);

    try {
      const result = await updateOutreachTracker({
        id: tracker.id,
        [field]: editValue.trim() || null,
      });

      if (result.success) {
        onUpdate(result.tracker);
      }
    } catch (error) {
      console.error('Error updating tracker:', error);
    } finally {
      setIsSaving(false);
      setIsEditing(null);
    }
  };

  const handleStatusChange = async (status: OutreachStatus) => {
    setIsSaving(true);
    try {
      const result = await updateOutreachTracker({
        id: tracker.id,
        status,
      });
      if (result.success) {
        onUpdate(result.tracker);
      }
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNotesSave = async (notes: string | null) => {
    const result = await updateOutreachTracker({
      id: tracker.id,
      notes,
    });
    if (result.success) {
      onUpdate(result.tracker);
    } else {
      throw new Error(result.error);
    }
  };

  const handleInteractionSave = async (
    spokeToThem: boolean,
    interactionType: InteractionType,
    interactionDate: Date | null
  ) => {
    const result = await updateOutreachTracker({
      id: tracker.id,
      spokeToThem,
      interactionType,
      interactionDate,
    });
    if (result.success) {
      onUpdate(result.tracker);
    } else {
      throw new Error(result.error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(field);
    } else if (e.key === 'Escape') {
      setIsEditing(null);
    }
  };

  const renderEditableCell = (field: string, value: string | null) => {
    if (isEditing === field) {
      return (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => handleSaveEdit(field)}
          onKeyDown={(e) => handleKeyDown(e, field)}
          autoFocus
          className="w-full px-2 py-1 text-sm border border-[#505050] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#606060]/30 bg-[#2a2a2a] text-[#E0E0E0]"
        />
      );
    }

    return (
      <button
        onClick={() => handleStartEdit(field, value)}
        className="w-full text-left truncate hover:text-[#c0c0c0] cursor-pointer transition-colors flex items-center gap-1 group/edit"
        title={value || 'Click to edit'}
      >
        <span className="truncate">{value || <span className="text-[#505050]">--</span>}</span>
        <svg className="w-3 h-3 text-[#505050] opacity-0 group-hover/edit:opacity-100 shrink-0 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    );
  };

  const cellClass = "px-4 py-3 text-sm border-r border-[#333333] last:border-r-0";
  const rowBg = isEven ? 'bg-[#2a2a2a]' : 'bg-[#252525]/30';

  const renderNameCell = () => {
    const nameContent = (
      <div className="flex items-center gap-1">
        <span className="truncate">{tracker.contactName || tracker.contactEmail}</span>
        {tracker.messageCount >= 2 && (
          <span className="text-xs text-gray-500">({tracker.messageCount})</span>
        )}
      </div>
    );

    if (tracker.linkedinUrl) {
      return (
        <a
          href={tracker.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#E0E0E0] hover:text-white hover:underline"
          title="View LinkedIn"
        >
          {nameContent}
        </a>
      );
    }

    return (
      <button
        onClick={() => handleStartEdit('contactName', tracker.contactName)}
        className="text-left hover:text-[#c0c0c0]"
      >
        {nameContent}
      </button>
    );
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger row click if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) {
      return;
    }
    onRowClick(tracker);
  };

  return (
    <>
      <tr
        className={`group ${rowBg} hover:bg-[#333333] cursor-pointer transition-colors`}
        onClick={handleRowClick}
      >
        {/* Name */}
        <td className={cellClass}>
          <div className="truncate font-semibold text-[#E0E0E0]">
            {renderNameCell()}
          </div>
          <div className="text-xs text-[#606060] truncate mt-0.5">{tracker.contactEmail}</div>
        </td>

        {/* Status */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <StatusDropdown
            value={tracker.status}
            onChange={handleStatusChange}
            disabled={isSaving}
          />
        </td>

        {/* Company */}
        <td className={cellClass}>
          <div className="truncate text-[#A0A0A0]">
            {renderEditableCell('company', tracker.company)}
          </div>
        </td>

        {/* Role */}
        <td className={cellClass}>
          <div className="truncate text-[#A0A0A0]">
            {renderEditableCell('role', tracker.role)}
          </div>
        </td>

        {/* Location */}
        <td className={cellClass}>
          <div className="truncate text-[#A0A0A0]">
            {renderEditableCell('location', tracker.location)}
          </div>
        </td>

        {/* Date Emailed */}
        <td
          className={`${cellClass} text-[#808080] whitespace-nowrap`}
          title={formatFullDate(tracker.dateEmailed)}
        >
          {formatRelativeDate(tracker.dateEmailed)}
        </td>

        {/* Spoke To */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowInteractionModal(true)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              tracker.spokeToThem
                ? 'bg-[#404040] text-[#c0c0c0]'
                : 'text-[#505050] hover:text-[#707070] hover:bg-[#333333]'
            }`}
            title={tracker.spokeToThem ? getInteractionLabel(tracker.interactionType) : 'Log interaction'}
          >
            {tracker.spokeToThem ? getInteractionLabel(tracker.interactionType) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>
        </td>

        {/* Notes */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowNotesModal(true)}
            className="w-full text-left text-[#A0A0A0] hover:text-[#c0c0c0] truncate transition-colors flex items-center gap-1 group/notes"
            title={tracker.notes || 'Add notes'}
          >
            {tracker.notes ? (
              <span className="truncate">{tracker.notes}</span>
            ) : (
              <svg className="w-4 h-4 text-[#505050] group-hover/notes:text-[#808080] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>
        </td>

        {/* Actions */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 text-[#505050] hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </td>
      </tr>

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
          <div className="bg-[#2a2a2a] rounded-2xl shadow-soft-xl max-w-sm w-full p-6 animate-scale-in">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-center text-[#E0E0E0] mb-2">Delete Contact</h3>
            <p className="text-[#808080] text-center mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium text-[#E0E0E0]">{tracker.contactName || tracker.contactEmail}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary"
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
