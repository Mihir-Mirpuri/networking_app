'use client';

import { useState } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';
import { PersonCard } from './PersonCard';

interface ResultsListProps {
  results: SearchResultWithDraft[];
  onSendAll: () => void;
  onSendSingle: (index: number) => void;
  onExpand: (index: number) => void;
  isSending: boolean;
  sendingIndex?: number;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  remainingDaily: number;
}

export function ResultsList({
  results,
  onSendAll,
  onSendSingle,
  onExpand,
  isSending,
  sendingIndex,
  sendStatuses,
  remainingDaily,
}: ResultsListProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const sendableCount = results.filter(
    (r) => r.email && !sendStatuses.has(r.id)
  ).length;

  const handleSendAllClick = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    onSendAll();
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  return (
    <div>
      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Confirm Send All
            </h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to send {sendableCount} email{sendableCount !== 1 ? 's' : ''}?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                Send {sendableCount} Email{sendableCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {results.length} Results Found
          </h2>
          <p className="text-sm text-gray-500">
            {remainingDaily} emails remaining today
          </p>
        </div>
        <button
          onClick={handleSendAllClick}
          disabled={isSending || sendableCount === 0}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? 'Sending...' : `Send All (${sendableCount})`}
        </button>
      </div>

      <div className="space-y-3">
        {results.map((person, index) => (
          <PersonCard
            key={person.id}
            person={person}
            onSend={() => onSendSingle(index)}
            onExpand={() => onExpand(index)}
            isSending={isSending && sendingIndex === index}
            sendStatus={sendStatuses.get(person.id)}
          />
        ))}
      </div>
    </div>
  );
}
