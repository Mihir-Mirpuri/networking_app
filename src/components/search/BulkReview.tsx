'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { SearchResultWithDraft } from '@/app/actions/search';
import { TemplateData } from '@/app/actions/profile';
import { SearchableCombobox } from './SearchableCombobox';

interface BulkReviewProps {
  results: SearchResultWithDraft[];
  onClose: () => void;
  onSendAll: (emails: { index: number; subject: string; body: string }[]) => Promise<void>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  templates?: TemplateData[];
  onApplyTemplateToAll?: (templateId: string) => Promise<void>;
  isRegenerating?: boolean;
  isAuthenticated?: boolean;
  onLoginRequired?: () => void;
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
  templates,
  onApplyTemplateToAll,
  isRegenerating,
  isAuthenticated = true,
  onLoginRequired,
}: BulkReviewProps) {
  const [drafts, setDrafts] = useState<Map<number, EmailDraft>>(new Map());
  const [isSending, setIsSending] = useState(false);

  // Get only sendable results (not already sent — email resolved on send if missing)
  const sendableResults = results
    .map((r, i) => ({ result: r, index: i }))
    .filter(({ result }) => !sendStatuses.has(result.id));

  const sendableCount = sendableResults.filter(({ index }) => {
    const draft = drafts.get(index);
    return draft && draft.subject && draft.body;
  }).length;

  // Initialize/refresh drafts from search results
  useEffect(() => {
    const newDrafts = new Map<number, EmailDraft>();
    for (const { result, index } of sendableResults) {
      newDrafts.set(index, {
        subject: result.draftSubject || '',
        body: result.draftBody || '',
      });
    }
    setDrafts(newDrafts);
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyTemplate = async (templateId: string) => {
    if (!onApplyTemplateToAll) return;
    await onApplyTemplateToAll(templateId);
    // Drafts will refresh via the results useEffect above
  };

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
    // Redirect to sign in if not authenticated
    if (!isAuthenticated) {
      signIn('google', { callbackUrl: '/' });
      return;
    }

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
    <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-100 rounded-lg shadow-soft-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-semibold text-surface-900">Review Emails</h2>
              <p className="text-sm text-surface-600">
                {sendableCount} of {sendableResults.length} emails ready to send
              </p>
            </div>
            {templates && templates.length > 0 && onApplyTemplateToAll && (
              <div className="w-48">
                <SearchableCombobox
                  options={templates.map((t) => ({
                    label: t.name + (t.isDefault ? ' (Default)' : ''),
                    value: t.id,
                  }))}
                  value=""
                  onChange={(id) => handleApplyTemplate(id)}
                  label=""
                  placeholder="Apply template..."
                  id="bulk-template"
                  disabled={isRegenerating}
                />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-100 rounded-full transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-surface-500"
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
              <div key={result.id} className="border border-surface-200 rounded-lg p-4 bg-surface-50">
                {/* Person Info */}
                <div className="mb-3 pb-3 border-b border-surface-200">
                  <h3 className="font-semibold text-surface-900">{result.fullName}</h3>
                  <p className="text-sm text-surface-600">
                    {result.role ? `${result.role} at ` : ''}{result.company}
                  </p>
                  {result.resumeId && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
                      <svg
                        className="w-4 h-4 text-emerald-700"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                        />
                      </svg>
                      <span className="text-xs font-medium text-emerald-700">
                        Resume attached
                      </span>
                    </div>
                  )}
                </div>

                {/* Subject */}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-surface-700 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={draft.subject}
                    onChange={(e) => handleSubjectChange(index, e.target.value)}
                    className="input text-sm"
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">
                    Body
                  </label>
                  <textarea
                    value={draft.body}
                    onChange={(e) => handleBodyChange(index, e.target.value)}
                    rows={6}
                    className="input resize-none text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-200 bg-surface-50 flex justify-end items-center">
          <button
            onClick={onClose}
            className="btn-secondary text-sm"
          >
            Close
          </button>
          {/* Send All button hidden for now
          <button
            onClick={handleSendAll}
            disabled={isSending || sendableCount === 0}
            className="btn-primary text-sm"
          >
            {isSending ? 'Sending...' : `Send All (${sendableCount})`}
          </button>
          */}
        </div>
      </div>
    </div>
  );
}
