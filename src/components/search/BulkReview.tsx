'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';
import {
  generateEmailForCandidateAction,
  getDefaultTemplateAction,
  checkDraftsStatus,
} from '@/app/actions/jobs';
import type { TemplatePrompt } from '@/lib/services/groq-email';
import { EMAIL_TEMPLATES } from '@/lib/constants';

interface BulkReviewProps {
  results: SearchResultWithDraft[];
  onClose: () => void;
  onSendAll: (emails: { index: number; subject: string; body: string }[]) => Promise<void>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  generatingStatuses: Map<string, boolean>;
}

interface EmailDraft {
  subject: string;
  body: string;
  isGenerating: boolean;
  error: string | null;
}

export function BulkReview({
  results,
  onClose,
  onSendAll,
  sendStatuses,
  generatingStatuses,
}: BulkReviewProps) {
  const [drafts, setDrafts] = useState<Map<number, EmailDraft>>(new Map());
  const [isSending, setIsSending] = useState(false);
  const pollingIntervalsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  // Get only sendable results (have email and not already sent)
  const sendableResults = results
    .map((r, i) => ({ result: r, index: i }))
    .filter(({ result }) => result.email && !sendStatuses.has(result.id));

  const sendableCount = sendableResults.filter(({ index }) => {
    const draft = drafts.get(index);
    return draft && draft.subject && draft.body && !draft.isGenerating;
  }).length;

  // Initialize drafts and trigger generation for each
  useEffect(() => {
    const initializeDrafts = async () => {
      // Load template first
      let template: TemplatePrompt | null = null;
      try {
        const templateResult = await getDefaultTemplateAction();
        if (templateResult.success) {
          template = templateResult.template;
        } else {
          const fallback = EMAIL_TEMPLATES[0];
          template = { subject: fallback.subject, body: fallback.body };
        }
      } catch (error) {
        console.error('Error loading template:', error);
        const fallback = EMAIL_TEMPLATES[0];
        template = { subject: fallback.subject, body: fallback.body };
      }

      // Initialize drafts for each sendable result
      for (const { result, index } of sendableResults) {
        if (!result.userCandidateId) continue;

        // Set initial state
        setDrafts((prev) => {
          const newDrafts = new Map(prev);
          newDrafts.set(index, {
            subject: result.draftSubject || '',
            body: result.draftBody || '',
            isGenerating: false,
            error: null,
          });
          return newDrafts;
        });

        // Check if already generated
        try {
          const statusResult = await checkDraftsStatus([result.userCandidateId]);
          if (statusResult.success) {
            const draftStatus = statusResult.results[0];
            if (draftStatus?.status === 'APPROVED' && draftStatus.subject && draftStatus.body) {
              setDrafts((prev) => {
                const newDrafts = new Map(prev);
                newDrafts.set(index, {
                  subject: draftStatus.subject!,
                  body: draftStatus.body!,
                  isGenerating: false,
                  error: null,
                });
                return newDrafts;
              });
              continue; // Skip generation
            }
          }
        } catch (error) {
          console.error('Error checking draft status:', error);
        }

        // Trigger generation
        if (template) {
          triggerGeneration(index, result.userCandidateId, template);
        }
      }
    };

    initializeDrafts();

    // Cleanup polling on unmount
    return () => {
      pollingIntervalsRef.current.forEach((interval) => clearInterval(interval));
      pollingIntervalsRef.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerGeneration = async (index: number, userCandidateId: string, template: TemplatePrompt) => {
    setDrafts((prev) => {
      const newDrafts = new Map(prev);
      const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
      newDrafts.set(index, { ...current, isGenerating: true, error: null });
      return newDrafts;
    });

    try {
      const result = await generateEmailForCandidateAction(userCandidateId, template);
      if (result.success) {
        startPolling(index, userCandidateId);
      } else {
        setDrafts((prev) => {
          const newDrafts = new Map(prev);
          const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
          newDrafts.set(index, { ...current, isGenerating: false, error: result.error || 'Failed to generate' });
          return newDrafts;
        });
      }
    } catch (error) {
      setDrafts((prev) => {
        const newDrafts = new Map(prev);
        const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
        newDrafts.set(index, { ...current, isGenerating: false, error: 'Failed to generate email' });
        return newDrafts;
      });
    }
  };

  const startPolling = (index: number, userCandidateId: string) => {
    // Clear existing polling for this index
    const existingInterval = pollingIntervalsRef.current.get(index);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startTime > 120000) {
        clearInterval(interval);
        pollingIntervalsRef.current.delete(index);
        setDrafts((prev) => {
          const newDrafts = new Map(prev);
          const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
          newDrafts.set(index, { ...current, isGenerating: false, error: 'Generation timed out' });
          return newDrafts;
        });
        return;
      }

      try {
        const statusResult = await checkDraftsStatus([userCandidateId]);
        if (statusResult.success) {
          const draftStatus = statusResult.results[0];
          if (draftStatus?.status === 'APPROVED' && draftStatus.subject && draftStatus.body) {
            clearInterval(interval);
            pollingIntervalsRef.current.delete(index);
            setDrafts((prev) => {
              const newDrafts = new Map(prev);
              newDrafts.set(index, {
                subject: draftStatus.subject!,
                body: draftStatus.body!,
                isGenerating: false,
                error: null,
              });
              return newDrafts;
            });
          } else if (draftStatus?.status === 'REJECTED') {
            clearInterval(interval);
            pollingIntervalsRef.current.delete(index);
            setDrafts((prev) => {
              const newDrafts = new Map(prev);
              const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
              newDrafts.set(index, { ...current, isGenerating: false, error: 'Generation was rejected' });
              return newDrafts;
            });
          }
        }
      } catch (error) {
        console.error('Error polling draft status:', error);
      }
    }, 2500);

    pollingIntervalsRef.current.set(index, interval);
  };

  const handleSubjectChange = (index: number, value: string) => {
    setDrafts((prev) => {
      const newDrafts = new Map(prev);
      const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
      newDrafts.set(index, { ...current, subject: value });
      return newDrafts;
    });
  };

  const handleBodyChange = (index: number, value: string) => {
    setDrafts((prev) => {
      const newDrafts = new Map(prev);
      const current = newDrafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
      newDrafts.set(index, { ...current, body: value });
      return newDrafts;
    });
  };

  const handleSendAll = async () => {
    const emailsToSend = sendableResults
      .filter(({ index }) => {
        const draft = drafts.get(index);
        return draft && draft.subject && draft.body && !draft.isGenerating;
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
            const draft = drafts.get(index) || { subject: '', body: '', isGenerating: false, error: null };
            const isGenerating = draft.isGenerating || (result.userCandidateId ? generatingStatuses.get(result.userCandidateId) || false : false);

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

                {/* Status */}
                {isGenerating && (
                  <div className="mb-3 px-3 py-2 bg-blue-100 text-blue-800 rounded text-sm animate-pulse">
                    Generating email...
                  </div>
                )}
                {draft.error && (
                  <div className="mb-3 px-3 py-2 bg-red-100 text-red-800 rounded text-sm">
                    {draft.error}
                  </div>
                )}

                {/* Subject */}
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={draft.subject}
                    onChange={(e) => handleSubjectChange(index, e.target.value)}
                    disabled={isGenerating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
                    disabled={isGenerating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
