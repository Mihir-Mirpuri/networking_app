'use client';

import { useState } from 'react';
import { OutreachStatus, InteractionType } from '@prisma/client';
import { OutreachTrackerEntry, updateOutreachTracker } from '@/app/actions/outreach';
import { setReminder } from '@/app/actions/reminders';
import { StatusDropdown } from './StatusDropdown';
import { ReminderModal } from './ReminderModal';
import { NotesModal } from './NotesModal';
import { InteractionModal, getInteractionLabel } from './InteractionModal';

interface OutreachRowProps {
  tracker: OutreachTrackerEntry;
  onUpdate: (tracker: OutreachTrackerEntry) => void;
  onDelete: (id: string) => void;
}

export function OutreachRow({ tracker, onUpdate, onDelete }: OutreachRowProps) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
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

  const handleReminderSave = async (date: Date | null, note: string | null) => {
    const result = await setReminder(tracker.id, date, note);
    if (result.success) {
      onUpdate({
        ...tracker,
        reminderDate: date,
        reminderNote: note,
        reminderSent: false,
      });
    } else {
      throw new Error(result.error);
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

  const isReminderDue = tracker.reminderDate && new Date(tracker.reminderDate) <= new Date();
  const isReminderUpcoming =
    tracker.reminderDate &&
    new Date(tracker.reminderDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return (
    <>
      <tr className="border-b border-gray-200 hover:bg-gray-50">
        {/* Name */}
        <td className="px-3 py-2 text-sm">
          <div className="max-w-[150px]">
            {renderEditableCell('contactName', tracker.contactName)}
          </div>
          <div className="text-xs text-gray-500 truncate">{tracker.contactEmail}</div>
        </td>

        {/* Company */}
        <td className="px-3 py-2 text-sm">
          <div className="max-w-[120px]">
            {renderEditableCell('company', tracker.company)}
          </div>
        </td>

        {/* Role */}
        <td className="px-3 py-2 text-sm">
          <div className="max-w-[120px]">
            {renderEditableCell('role', tracker.role)}
          </div>
        </td>

        {/* Location */}
        <td className="px-3 py-2 text-sm">
          <div className="max-w-[100px]">
            {renderEditableCell('location', tracker.location)}
          </div>
        </td>

        {/* Date Emailed */}
        <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">
          {formatDate(tracker.dateEmailed)}
        </td>

        {/* Response */}
        <td className="px-3 py-2 text-sm whitespace-nowrap">
          {tracker.responseReceivedAt ? (
            <span className="text-green-600">{formatDate(tracker.responseReceivedAt)}</span>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>

        {/* Followed Up */}
        <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">
          {formatDate(tracker.followedUpAt)}
        </td>

        {/* Spoke To */}
        <td className="px-3 py-2 text-sm">
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
        <td className="px-3 py-2 text-sm">
          <button
            onClick={() => setShowNotesModal(true)}
            className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 max-w-[80px] truncate"
            title={tracker.notes || 'Add notes'}
          >
            {tracker.notes ? 'View' : 'Add'}
          </button>
        </td>

        {/* Status */}
        <td className="px-3 py-2">
          <StatusDropdown
            value={tracker.status}
            onChange={handleStatusChange}
            disabled={isSaving}
          />
        </td>

        {/* Reminder */}
        <td className="px-3 py-2 text-sm">
          <button
            onClick={() => setShowReminderModal(true)}
            className={`px-2 py-1 rounded text-xs ${
              isReminderDue
                ? 'bg-red-100 text-red-700 animate-pulse'
                : isReminderUpcoming
                ? 'bg-yellow-100 text-yellow-700'
                : tracker.reminderDate
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tracker.reminderDate ? formatDate(tracker.reminderDate) : 'Set'}
          </button>
        </td>

        {/* Actions */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {tracker.linkedinUrl && (
              <a
                href={tracker.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-blue-600 hover:text-blue-800"
                title="View LinkedIn"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
              </a>
            )}
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
          </div>
        </td>
      </tr>

      {/* Modals */}
      <ReminderModal
        isOpen={showReminderModal}
        onClose={() => setShowReminderModal(false)}
        onSave={handleReminderSave}
        currentDate={tracker.reminderDate}
        currentNote={tracker.reminderNote}
        contactName={tracker.contactName}
      />

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
