'use client';

import { useState, useEffect } from 'react';
import { CreateEventInput } from './types';
import { formatForDateTimeInput, getDefaultEventTimes } from './utils';

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateEventInput) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  conflictWarning: string | null;
  initialDateTime?: Date;
  onCheckConflicts: (startDateTime: string, endDateTime: string) => void;
}

export function CreateEventModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  error,
  conflictWarning,
  initialDateTime,
  onCheckConflicts,
}: CreateEventModalProps) {
  const [formData, setFormData] = useState<CreateEventInput>({
    summary: '',
    description: '',
    location: '',
    startDateTime: '',
    endDateTime: '',
    attendeeEmails: [],
    addGoogleMeet: false,
  });

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const { start, end } = initialDateTime
        ? { start: initialDateTime, end: new Date(initialDateTime.getTime() + 30 * 60 * 1000) }
        : getDefaultEventTimes();

      setFormData({
        summary: '',
        description: '',
        location: '',
        startDateTime: formatForDateTimeInput(start),
        endDateTime: formatForDateTimeInput(end),
        attendeeEmails: [],
        addGoogleMeet: false,
      });
    }
  }, [isOpen, initialDateTime]);

  const handleSubmit = async () => {
    await onSubmit(formData);
  };

  const handleTimeBlur = () => {
    if (formData.startDateTime && formData.endDateTime) {
      onCheckConflicts(formData.startDateTime, formData.endDateTime);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-surface-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card max-w-lg w-full max-h-[90vh] overflow-y-auto animate-scale-in">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900">Create Event</h2>
            <button
              onClick={onClose}
              className="text-surface-400 hover:text-surface-600 transition-colors"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {conflictWarning && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-700">{conflictWarning}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">
                Event Title *
              </label>
              <input
                type="text"
                value={formData.summary}
                onChange={(e) =>
                  setFormData({ ...formData, summary: e.target.value })
                }
                className="input"
                placeholder="Coffee chat with John"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Start *
                </label>
                <input
                  type="datetime-local"
                  value={formData.startDateTime}
                  onChange={(e) =>
                    setFormData({ ...formData, startDateTime: e.target.value })
                  }
                  onBlur={handleTimeBlur}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  End *
                </label>
                <input
                  type="datetime-local"
                  value={formData.endDateTime}
                  onChange={(e) =>
                    setFormData({ ...formData, endDateTime: e.target.value })
                  }
                  onBlur={handleTimeBlur}
                  className="input"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                className="input"
                placeholder="Starbucks, Zoom, etc."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
                className="input"
                placeholder="Notes about this meeting..."
              />
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.addGoogleMeet}
                  onChange={(e) =>
                    setFormData({ ...formData, addGoogleMeet: e.target.checked })
                  }
                  className="w-4 h-4 text-primary-600 border-surface-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-surface-700">
                  Add Google Meet video conferencing
                </span>
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="btn-primary flex-1"
              >
                {isSubmitting ? 'Creating...' : 'Create Event'}
              </button>
              <button
                onClick={onClose}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
