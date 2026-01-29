'use client';

import { useState } from 'react';
import { MeetingSuggestionWithMessage } from '@/lib/types/meetingSuggestion';
import { CreateEventInput } from './types';

interface MeetingSuggestionCardProps {
  suggestion: MeetingSuggestionWithMessage;
  onAccept: (suggestionId: string, eventData: CreateEventInput) => Promise<void>;
  onDismiss: (suggestionId: string) => Promise<void>;
  isLoading: boolean;
}

export function MeetingSuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
  isLoading,
}: MeetingSuggestionCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [editedData, setEditedData] = useState({
    summary: suggestion.extractedData.title,
    startDateTime: formatForInput(suggestion.extractedData.startTime),
    endDateTime: formatForInput(
      suggestion.extractedData.endTime ||
        calculateEndTime(suggestion.extractedData.startTime, suggestion.extractedData.duration)
    ),
    location: suggestion.extractedData.location || '',
    description: suggestion.extractedData.description || '',
    addGoogleMeet: false,
  });

  const confidencePercent = Math.round(suggestion.confidence * 100);
  const confidenceColor =
    suggestion.confidence >= 0.8
      ? 'text-green-600 bg-green-50'
      : suggestion.confidence >= 0.5
        ? 'text-yellow-600 bg-yellow-50'
        : 'text-red-600 bg-red-50';

  function handleAccept() {
    onAccept(suggestion.id, {
      summary: editedData.summary,
      startDateTime: new Date(editedData.startDateTime).toISOString(),
      endDateTime: new Date(editedData.endDateTime).toISOString(),
      location: editedData.location || undefined,
      description: editedData.description || undefined,
      addGoogleMeet: editedData.addGoogleMeet,
    });
  }

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      {/* Email context header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span className="font-medium">{suggestion.message.sender}</span>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${confidenceColor}`}>
            {confidencePercent}% confidence
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-gray-900 truncate flex-1">
            {suggestion.message.subject || '(No subject)'}
          </p>
          <button
            onClick={() => setShowEmailModal(true)}
            className="ml-2 text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
          >
            View Email
          </button>
        </div>
      </div>

      {/* Meeting details */}
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event Title
              </label>
              <input
                type="text"
                value={editedData.summary}
                onChange={(e) => setEditedData({ ...editedData, summary: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start
                </label>
                <input
                  type="datetime-local"
                  value={editedData.startDateTime}
                  onChange={(e) => setEditedData({ ...editedData, startDateTime: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End
                </label>
                <input
                  type="datetime-local"
                  value={editedData.endDateTime}
                  onChange={(e) => setEditedData({ ...editedData, endDateTime: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location
              </label>
              <input
                type="text"
                value={editedData.location}
                onChange={(e) => setEditedData({ ...editedData, location: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Starbucks, Zoom, etc."
              />
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editedData.addGoogleMeet}
                  onChange={(e) => setEditedData({ ...editedData, addGoogleMeet: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Add Google Meet
                </span>
              </label>
            </div>

            <button
              onClick={() => setIsEditing(false)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Done editing
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <div>
                <p className="font-medium text-gray-900">{editedData.summary}</p>
                <p className="text-sm text-gray-600">
                  {formatDateTime(editedData.startDateTime)} - {formatTime(editedData.endDateTime)}
                </p>
              </div>
            </div>

            {editedData.location && (
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <p className="text-sm text-gray-600">{editedData.location}</p>
              </div>
            )}

            {suggestion.extractedData.rawText && (
              <div className="mt-3 p-3 bg-gray-50 rounded-md">
                <p className="text-xs text-gray-500 mb-1">From email:</p>
                <p className="text-sm text-gray-700 italic">
                  &quot;{suggestion.extractedData.rawText}&quot;
                </p>
              </div>
            )}

            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Edit details
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-3">
        <button
          onClick={handleAccept}
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Creating...' : 'Accept & Create Event'}
        </button>
        <button
          onClick={() => onDismiss(suggestion.id)}
          disabled={isLoading}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => setShowEmailModal(false)}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-2xl sm:w-full">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Email</h3>
                  <button
                    onClick={() => setShowEmailModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Email Content */}
              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-500">From:</span>
                    <span className="text-gray-900">{suggestion.message.sender}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-500">Subject:</span>
                    <span className="text-gray-900">{suggestion.message.subject || '(No subject)'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-500">Date:</span>
                    <span className="text-gray-900">
                      {new Date(suggestion.message.received_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                <hr className="my-4" />

                <div className="prose prose-sm max-w-none">
                  {suggestion.message.body_text ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">
                      {suggestion.message.body_text}
                    </pre>
                  ) : (
                    <p className="text-gray-500 italic">No email content available</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <button
                  onClick={() => setShowEmailModal(false)}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function formatForInput(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function calculateEndTime(startTime: string, duration?: number): string {
  const start = new Date(startTime);
  const durationMs = (duration || 30) * 60 * 1000;
  return new Date(start.getTime() + durationMs).toISOString();
}

function formatDateTime(dateTimeLocal: string): string {
  const date = new Date(dateTimeLocal);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(dateTimeLocal: string): string {
  const date = new Date(dateTimeLocal);
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
