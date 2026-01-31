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

  const formatDate = (date: Date | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
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
          className="w-full px-2 py-1 text-sm border border-primary-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 bg-white"
        />
      );
    }

    return (
      <button
        onClick={() => handleStartEdit(field, value)}
        className="w-full text-left truncate hover:text-primary-600 cursor-pointer transition-colors"
        title={value || 'Click to edit'}
      >
        {value || <span className="text-surface-400">-</span>}
      </button>
    );
  };

  const cellClass = "px-4 py-3 text-sm border-r border-surface-100 last:border-r-0";
  const rowBg = isEven ? 'bg-white' : 'bg-surface-50/30';

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
          className="text-primary-600 hover:text-primary-800 hover:underline"
          title="View LinkedIn"
        >
          {nameContent}
        </a>
      );
    }

    return (
      <button
        onClick={() => handleStartEdit('contactName', tracker.contactName)}
        className="text-left hover:text-primary-600"
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
        className={`${rowBg} hover:bg-primary-50/40 cursor-pointer transition-colors`}
        onClick={handleRowClick}
      >
        {/* Name */}
        <td className={cellClass}>
          <div className="truncate font-medium text-surface-900">
            {renderNameCell()}
          </div>
          <div className="text-xs text-surface-500 truncate">{tracker.contactEmail}</div>
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
          <div className="truncate text-surface-700">
            {renderEditableCell('company', tracker.company)}
          </div>
        </td>

        {/* Role */}
        <td className={cellClass}>
          <div className="truncate text-surface-700">
            {renderEditableCell('role', tracker.role)}
          </div>
        </td>

        {/* Location */}
        <td className={cellClass}>
          <div className="truncate text-surface-700">
            {renderEditableCell('location', tracker.location)}
          </div>
        </td>

        {/* Date Emailed */}
        <td className={`${cellClass} text-surface-600 whitespace-nowrap`}>
          {formatDate(tracker.dateEmailed)}
        </td>

        {/* Spoke To */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowInteractionModal(true)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              tracker.spokeToThem
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
            }`}
          >
            {tracker.spokeToThem ? getInteractionLabel(tracker.interactionType) : 'No'}
          </button>
        </td>

        {/* Notes */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowNotesModal(true)}
            className="w-full text-left text-surface-700 hover:text-primary-600 truncate transition-colors"
            title={tracker.notes || 'Click to add notes'}
          >
            {tracker.notes || <span className="text-surface-400">-</span>}
          </button>
        </td>

        {/* Actions */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 text-surface-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-soft-xl max-w-sm w-full p-6 animate-scale-in">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-center text-surface-900 mb-2">Delete Contact</h3>
            <p className="text-surface-600 text-center mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium text-surface-900">{tracker.contactName || tracker.contactEmail}</span>?
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
