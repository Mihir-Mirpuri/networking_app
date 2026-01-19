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

interface ExpandedReviewProps {
  results: SearchResultWithDraft[];
  currentIndex: number;
  onClose: () => void;
  onSend: (index: number, subject: string, body: string) => Promise<void>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  generatingStatuses: Map<string, boolean>;
}

export function ExpandedReview({
  results,
  currentIndex,
  onClose,
  onSend,
  sendStatuses,
  generatingStatuses,
}: ExpandedReviewProps) {
  const person = results[currentIndex];
  const [subject, setSubject] = useState(person?.draftSubject || '');
  const [body, setBody] = useState(person?.draftBody || '');
  const [isSending, setIsSending] = useState(false);
  const [internalIndex, setInternalIndex] = useState(currentIndex);
  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;
  const isGenerating = currentPerson?.userCandidateId
    ? generatingStatuses.get(currentPerson.userCandidateId) || false
    : false;

  // Define startPolling first (used by triggerGenerationWithTemplate)
  const startPolling = useCallback(() => {
    if (!currentPerson?.userCandidateId) return;

    // Capture userCandidateId at the time polling starts
    const userCandidateIdToCheck = currentPerson.userCandidateId;

    // Clear any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const startTime = Date.now();
    pollingIntervalRef.current = setInterval(async () => {
      // Timeout after 120 seconds (increased from 60)
      if (Date.now() - startTime > 120000) {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsGeneratingLocal(false);
        setGenerationError('Generation timed out. Please try again.');
        console.error('[Polling] Timeout after 120 seconds for userCandidateId:', userCandidateIdToCheck);
        return;
      }

      try {
        // Use the captured userCandidateId instead of currentPerson
        const statusResult = await checkDraftsStatus([userCandidateIdToCheck]);
        if (statusResult.success) {
          const draftStatus = statusResult.results[0];
          console.log('[Polling] Draft status check:', {
            userCandidateId: userCandidateIdToCheck,
            status: draftStatus?.status,
            hasSubject: !!draftStatus?.subject,
            hasBody: !!draftStatus?.body,
            elapsed: Math.round((Date.now() - startTime) / 1000) + 's',
          });
          
          if (draftStatus?.status === 'APPROVED' && draftStatus.subject && draftStatus.body) {
            // Generation complete
            console.log('[Polling] ✓ Generation complete!');
            setSubject(draftStatus.subject);
            setBody(draftStatus.body);
            setIsGeneratingLocal(false);
            setGenerationError(null);
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          } else if (draftStatus?.status === 'REJECTED' || draftStatus?.status === 'SENT') {
            // Generation failed or already sent
            console.log('[Polling] Generation failed or sent, status:', draftStatus?.status);
            setIsGeneratingLocal(false);
            if (draftStatus?.status === 'REJECTED') {
              setGenerationError('Email generation was rejected. Please try again.');
            }
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
          // Otherwise keep polling (status is PENDING)
        } else {
          // Error checking status
          console.error('[Polling] Error checking draft status:', statusResult.error);
        }
      } catch (error) {
        console.error('[Polling] Error in polling:', error);
        // Continue polling on error, but log it
      }
    }, 2500); // Poll every 2.5 seconds
  }, [currentPerson?.userCandidateId]);

  // Define triggerGenerationWithTemplate second (used by useEffect)
  const triggerGenerationWithTemplate = useCallback(async (template: TemplatePrompt) => {
    if (!currentPerson?.userCandidateId) {
      setGenerationError('No candidate selected');
      return;
    }

    const userCandidateId = currentPerson.userCandidateId;
    console.log('[ExpandedReview] Triggering generation for userCandidateId:', userCandidateId);

    setIsGeneratingLocal(true);
    setGenerationError(null);

    try {
      const result = await generateEmailForCandidateAction(
        userCandidateId,
        template
      );

      if (result.success) {
        console.log('[ExpandedReview] Job queued successfully, jobId:', result.jobId);
        // Start polling for completion
        startPolling();
      } else {
        console.error('[ExpandedReview] Failed to queue job:', result.error);
        setGenerationError(result.error || 'Failed to queue email generation');
        setIsGeneratingLocal(false);
      }
    } catch (error) {
      console.error('[ExpandedReview] Error triggering generation:', error);
      setGenerationError(error instanceof Error ? error.message : 'Failed to generate email');
      setIsGeneratingLocal(false);
    }
  }, [currentPerson?.userCandidateId, startPolling]);

  // Load template and check draft status when modal opens or person changes
  useEffect(() => {
    if (!currentPerson?.userCandidateId) return;

    let mounted = true;

    const initializeTemplate = async () => {
      let loadedTemplate: TemplatePrompt | null = null;

      try {
        const templateResult = await getDefaultTemplateAction();
        if (templateResult.success && mounted) {
          loadedTemplate = templateResult.template;
        } else if (!templateResult.success && mounted) {
          setGenerationError('Failed to load template. Using default.');
          // Use fallback template
          const fallback = EMAIL_TEMPLATES[0];
          loadedTemplate = { subject: fallback.subject, body: fallback.body };
        }
      } catch (error) {
        console.error('Error loading template:', error);
        if (mounted) {
          setGenerationError('Error loading template. Please refresh and try again.');
        }
      }

      if (!mounted) return;

      // Check if email is already generated
      try {
        const statusResult = await checkDraftsStatus([currentPerson.userCandidateId!]);
        if (statusResult.success && mounted) {
          const draftStatus = statusResult.results[0];
          if (draftStatus?.status === 'APPROVED' && draftStatus.subject && draftStatus.body) {
            // Email already generated
            setSubject(draftStatus.subject);
            setBody(draftStatus.body);
            return; // Don't trigger generation
          }
        }
      } catch (error) {
        console.error('Error checking draft status:', error);
      }

      if (!mounted) return;

      // Not generated yet - trigger generation with loaded template
      if (loadedTemplate && loadedTemplate.subject && loadedTemplate.body) {
        await triggerGenerationWithTemplate(loadedTemplate);
      }
    };

    initializeTemplate();

    return () => {
      mounted = false;
      // Cleanup polling on unmount or person change
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [internalIndex, currentPerson?.userCandidateId, triggerGenerationWithTemplate]);

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

  const canSend = currentPerson.email && !status && !isGenerating && !isGeneratingLocal;

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
        {(isGenerating || isGeneratingLocal) && (
          <div className="px-4 py-2 bg-blue-100 text-blue-800 animate-pulse">
            Generating personalized email... This may take a few seconds.
          </div>
        )}
        {generationError && (
          <div className="px-4 py-2 bg-red-100 text-red-800">
            Error: {generationError}
            <button
              onClick={async () => {
                setGenerationError(null);
                // Reload template and retry generation
                try {
                  const templateResult = await getDefaultTemplateAction();
                  if (templateResult.success && currentPerson?.userCandidateId) {
                    await triggerGenerationWithTemplate(templateResult.template);
                  } else {
                    const fallback = EMAIL_TEMPLATES[0];
                    if (currentPerson?.userCandidateId) {
                      await triggerGenerationWithTemplate({ subject: fallback.subject, body: fallback.body });
                    }
                  }
                } catch (error) {
                  console.error('Error retrying generation:', error);
                  setGenerationError('Failed to retry generation');
                }
              }}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}
        {status && !isGenerating && !isGeneratingLocal && (
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
              disabled={isGenerating || isGeneratingLocal}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
              disabled={isGenerating || isGeneratingLocal}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
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
