'use client';

import { useState, useEffect } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';

interface ExpandedReviewProps {
  results: SearchResultWithDraft[];
  currentIndex: number;
  onClose: () => void;
  onSend: (index: number, subject: string, body: string) => Promise<void>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
}

export function ExpandedReview({
  results,
  currentIndex,
  onClose,
  onSend,
  sendStatuses,
}: ExpandedReviewProps) {
  const person = results[currentIndex];
  const [subject, setSubject] = useState(person?.draftSubject || '');
  const [body, setBody] = useState(person?.draftBody || '');
  const [isSending, setIsSending] = useState(false);
  const [internalIndex, setInternalIndex] = useState(currentIndex);

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;

  // Update subject/body when currentPerson changes
  useEffect(() => {
    if (currentPerson) {
      setSubject(currentPerson.draftSubject);
      setBody(currentPerson.draftBody);
    }
  }, [internalIndex, currentPerson]);


  const handleSend = async () => {
    if (!currentPerson?.email) return;

    setIsSending(true);
    await onSend(internalIndex, subject, body);
    setIsSending(false);

    // Auto-advance to next unsent person
    const nextIndex = findNextUnsent(internalIndex + 1);
    if (nextIndex !== -1) {
      setInternalIndex(nextIndex);
    } else {
      // No more to send, close the review
      onClose();
    }
  };

  const findNextUnsent = (startIndex: number): number => {
    for (let i = startIndex; i < results.length; i++) {
      if (results[i].email && !sendStatuses.has(results[i].id)) {
        return i;
      }
    }
    return -1;
  };

  const handlePrevious = () => {
    if (internalIndex > 0) {
      setInternalIndex(internalIndex - 1);
    }
  };

  const handleNext = () => {
    if (internalIndex < results.length - 1) {
      setInternalIndex(internalIndex + 1);
    }
  };

  const handleSkip = () => {
    const nextIndex = findNextUnsent(internalIndex + 1);
    if (nextIndex !== -1) {
      setInternalIndex(nextIndex);
    } else {
      onClose();
    }
  };

  if (!currentPerson) {
    return null;
  }

  const canSend = currentPerson.email && !status;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">{currentPerson.fullName}</h2>
            <p className="text-sm text-gray-600">
              {currentPerson.role ? `${currentPerson.role} at ` : ''}
              {currentPerson.company}
            </p>
            {currentPerson.email ? (
              <p className="text-sm text-blue-600">{currentPerson.email}</p>
            ) : (
              <p className="text-sm text-red-500">No email found</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              {internalIndex + 1} of {results.length}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {status && (
          <div
            className={`px-4 py-2 ${
              status === 'success'
                ? 'bg-green-100 text-green-800'
                : status === 'failed'
                ? 'bg-red-100 text-red-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {status === 'success' && 'Email sent successfully!'}
            {status === 'failed' && 'Failed to send email'}
            {status === 'pending' && 'Sending...'}
          </div>
        )}

        {/* Email Form */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={handlePrevious}
              disabled={internalIndex === 0}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={handleNext}
              disabled={internalIndex === results.length - 1}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
            >
              Skip
            </button>
            <button
              onClick={handleSend}
              disabled={!canSend || isSending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? 'Sending...' : 'Send & Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
