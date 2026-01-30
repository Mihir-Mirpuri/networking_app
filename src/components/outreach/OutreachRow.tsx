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
          className="w-full px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      );
    }

    return (
      <button
        onClick={() => handleStartEdit(field, value)}
        className="w-full text-left truncate hover:text-blue-600 cursor-pointer"
        title={value || 'Click to edit'}
      >
        {value || <span className="text-gray-400">-</span>}
      </button>
    );
  };

  const cellClass = "px-3 py-2 text-sm border-b border-r border-gray-200 last:border-r-0";
  const rowBg = isEven ? 'bg-white' : 'bg-gray-50/50';

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
          className="text-blue-600 hover:text-blue-800 hover:underline"
          title="View LinkedIn"
        >
          {nameContent}
        </a>
      );
    }

    return (
      <button
        onClick={() => handleStartEdit('contactName', tracker.contactName)}
        className="text-left hover:text-blue-600"
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
        className={`${rowBg} hover:bg-blue-50/50 cursor-pointer`}
        onClick={handleRowClick}
      >
        {/* Name */}
        <td className={cellClass}>
          <div className="truncate">
            {renderNameCell()}
          </div>
          <div className="text-xs text-gray-500 truncate">{tracker.contactEmail}</div>
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
          <div className="truncate">
            {renderEditableCell('company', tracker.company)}
          </div>
        </td>

        {/* Role */}
        <td className={cellClass}>
          <div className="truncate">
            {renderEditableCell('role', tracker.role)}
          </div>
        </td>

        {/* Location */}
        <td className={cellClass}>
          <div className="truncate">
            {renderEditableCell('location', tracker.location)}
          </div>
        </td>

        {/* Date Emailed */}
        <td className={`${cellClass} text-gray-600 whitespace-nowrap`}>
          {formatDate(tracker.dateEmailed)}
        </td>

        {/* Spoke To */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowInteractionModal(true)}
            className={`px-2 py-1 rounded text-xs ${
              tracker.spokeToThem
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tracker.spokeToThem ? getInteractionLabel(tracker.interactionType) : 'No'}
          </button>
        </td>

        {/* Notes */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowNotesModal(true)}
            className="w-full text-left text-gray-700 hover:text-blue-600 truncate"
            title={tracker.notes || 'Click to add notes'}
          >
            {tracker.notes || <span className="text-gray-400">-</span>}
          </button>
        </td>

        {/* Actions */}
        <td className={cellClass} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1 text-gray-400 hover:text-red-600"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold mb-2">Delete Contact</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete{' '}
              <span className="font-medium">{tracker.contactName || tracker.contactEmail}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(tracker.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
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
