'use client';

import { useState, useEffect } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';

interface BulkReviewProps {
  results: SearchResultWithDraft[];
  onClose: () => void;
  onSendAll: (emails: { index: number; subject: string; body: string }[]) => Promise<void>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
}

interface EmailDraft {
  subject: string;
  body: string;
}

export function BulkReview({
  results,
  onClose,
  onSendAll,
  sendStatuses,
}: BulkReviewProps) {
  const [drafts, setDrafts] = useState<Map<number, EmailDraft>>(new Map());
  const [isSending, setIsSending] = useState(false);

  // Get only sendable results (have email and not already sent)
  const sendableResults = results
    .map((r, i) => ({ result: r, index: i }))
    .filter(({ result }) => result.email && !sendStatuses.has(result.id));

  const sendableCount = sendableResults.filter(({ index }) => {
    const draft = drafts.get(index);
    return draft && draft.subject && draft.body;
  }).length;

  // Initialize drafts from search results
  useEffect(() => {
    const newDrafts = new Map<number, EmailDraft>();
    for (const { result, index } of sendableResults) {
      newDrafts.set(index, {
        subject: result.draftSubject || '',
        body: result.draftBody || '',
      });
    }
    setDrafts(newDrafts);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubjectChange = (index: number, value: string) => {
    setDrafts((prev) => {
      const newDrafts = new Map(prev);
      const current = newDrafts.get(index) || { subject: '', body: '' };
      newDrafts.set(index, { ...current, subject: value });
      return newDrafts;
    });
  };

  const handleBodyChange = (index: number, value: string) => {
    setDrafts((prev) => {
      const newDrafts = new Map(prev);
      const current = newDrafts.get(index) || { subject: '', body: '' };
      newDrafts.set(index, { ...current, body: value });
      return newDrafts;
    });
  };

  const handleSendAll = async () => {
    const emailsToSend = sendableResults
      .filter(({ index }) => {
        const draft = drafts.get(index);
        return draft && draft.subject && draft.body;
      })
      .map(({ index }) => ({
        index,
        subject: drafts.get(index)!.subject,
        body: drafts.get(index)!.body,
      }));

    if (emailsToSend.length === 0) return;

    setIsSending(true);
    await onSendAll(emailsToSend);
    setIsSending(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Review Emails</h2>
            <p className="text-sm text-gray-600">
              {sendableCount} of {sendableResults.length} emails ready to send
            </p>
          </div>
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

        {/* Scrollable Email List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {sendableResults.map(({ result, index }) => {
            const draft = drafts.get(index) || { subject: '', body: '' };

            return (
              <div key={result.id} className="border rounded-lg p-4 bg-gray-50">
                {/* Person Info */}
                <div className="mb-3 pb-3 border-b">
                  <h3 className="font-semibold text-gray-900">{result.fullName}</h3>
                  <p className="text-sm text-gray-600">
                    {result.role ? `${result.role} at ` : ''}{result.company}
                  </p>
                  <p className="text-sm text-blue-600">{result.email}</p>
                </div>

                {/* Subject */}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={draft.subject}
                    onChange={(e) => handleSubjectChange(index, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Body
                  </label>
                  <textarea
                    value={draft.body}
                    onChange={(e) => handleBodyChange(index, e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with Send All Button */}
        <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSendAll}
            disabled={isSending || sendableCount === 0}
            className="px-6 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : `Send All (${sendableCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
