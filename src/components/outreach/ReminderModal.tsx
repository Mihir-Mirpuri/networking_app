'use client';

import { useState } from 'react';

interface ReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (date: Date | null, note: string | null) => Promise<void>;
  currentDate: Date | null;
  currentNote: string | null;
  contactName: string | null;
}

export function ReminderModal({
  isOpen,
  onClose,
  onSave,
  currentDate,
  currentNote,
  contactName,
}: ReminderModalProps) {
  const [date, setDate] = useState<string>(
    currentDate ? new Date(currentDate).toISOString().slice(0, 16) : ''
  );
  const [note, setNote] = useState(currentNote || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const reminderDate = date ? new Date(date) : null;
      await onSave(reminderDate, note || null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reminder');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(null, null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear reminder');
    } finally {
      setIsSaving(false);
    }
  };

  // Set minimum date to now
  const minDate = new Date().toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-4">
          Set Reminder {contactName && <span className="text-gray-500">for {contactName}</span>}
        </h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reminder Date & Time
          </label>
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={minDate}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g., Follow up on internship opportunity"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-between">
          <button
            onClick={handleClear}
            disabled={isSaving || !currentDate}
            className="px-4 py-2 text-sm text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear Reminder
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !date}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
