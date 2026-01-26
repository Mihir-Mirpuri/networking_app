'use client';

import { useState, useEffect, useCallback } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';
import { scheduleEmailAction } from '@/app/actions/send';
import { personalizeEmailAction, useFoundInfoAction } from '@/app/actions/personalize';

// Extension ID - set via environment variable after publishing to Chrome Web Store
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || '';

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
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);

  // Personalization state
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null);
  const [personalizeResult, setPersonalizeResult] = useState<{
    similarityFound: boolean;
    changes?: string[];
    foundInfo?: string[];
  } | null>(null);
  const [lastLinkedInData, setLastLinkedInData] = useState<unknown>(null);

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;

  // Update subject/body when currentPerson changes
  useEffect(() => {
    if (currentPerson) {
      setSubject(currentPerson.draftSubject);
      setBody(currentPerson.draftBody);
      setPersonalizeResult(null);
      setPersonalizeError(null);
      setLastLinkedInData(null);
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

  const handleSchedule = async () => {
    if (!currentPerson?.email || !currentPerson.userCandidateId) return;

    if (!scheduledDateTime) {
      setScheduleError('Please select a date and time');
      return;
    }

    const selectedDate = new Date(scheduledDateTime);
    const now = new Date();
    const minScheduledTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now

    if (selectedDate < minScheduledTime) {
      setScheduleError('Scheduled time must be at least 5 minutes in the future');
      return;
    }

    setIsScheduling(true);
    setScheduleError(null);

    try {
      const result = await scheduleEmailAction({
        email: currentPerson.email,
        subject,
        body,
        userCandidateId: currentPerson.userCandidateId,
        resumeId: currentPerson.resumeId ?? undefined,
        scheduledFor: selectedDate,
      });

      if (result.success) {
        setShowScheduleModal(false);
        setScheduledDateTime('');
        // Auto-advance to next unsent person
        const nextIndex = findNextUnsent(internalIndex + 1);
        if (nextIndex !== -1) {
          setInternalIndex(nextIndex);
        } else {
          onClose();
        }
      } else {
        setScheduleError(result.error || 'Failed to schedule email');
      }
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'Failed to schedule email');
    } finally {
      setIsScheduling(false);
    }
  };

  // Set default scheduled time to 1 hour from now
  useEffect(() => {
    if (showScheduleModal && !scheduledDateTime) {
      const defaultTime = new Date();
      defaultTime.setHours(defaultTime.getHours() + 1);
      defaultTime.setMinutes(0);
      defaultTime.setSeconds(0);
      const localDateTime = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setScheduledDateTime(localDateTime);
    }
  }, [showScheduleModal, scheduledDateTime]);

  // Check if Chrome extension is installed
  const checkExtension = useCallback(async (): Promise<boolean> => {
    if (!EXTENSION_ID) {
      console.warn('Extension ID not configured');
      return false;
    }

    return new Promise((resolve) => {
      try {
        // @ts-expect-error - Chrome extension API
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          // @ts-expect-error - Chrome extension API
          chrome.runtime.sendMessage(
            EXTENSION_ID,
            { action: 'ping' },
            (response: { success: boolean } | undefined) => {
              // @ts-expect-error - Chrome extension API
              if (chrome.runtime.lastError) {
                resolve(false);
              } else {
                resolve(response?.success === true);
              }
            }
          );
          // Timeout if no response
          setTimeout(() => resolve(false), 1000);
        } else {
          resolve(false);
        }
      } catch {
        resolve(false);
      }
    });
  }, []);

  // Handle personalize button click
  const handlePersonalize = async () => {
    if (!currentPerson?.linkedinUrl) {
      setPersonalizeError('No LinkedIn URL available for this person');
      return;
    }

    setPersonalizeError(null);

    // Check if extension is installed
    const installed = await checkExtension();
    setExtensionInstalled(installed);

    if (!installed) {
      setShowExtensionModal(true);
      return;
    }

    // Extension is installed, start personalization
    await runPersonalization();
  };

  // Run the actual personalization flow
  const runPersonalization = async () => {
    if (!currentPerson?.linkedinUrl) return;

    setIsPersonalizing(true);
    setPersonalizeError(null);

    try {
      // Send message to extension to scrape LinkedIn
      const scrapeResult = await new Promise<{ success: boolean; data?: unknown; error?: string }>((resolve) => {
        // @ts-expect-error - Chrome extension API
        chrome.runtime.sendMessage(
          EXTENSION_ID,
          {
            action: 'scrapeLinkedIn',
            linkedinUrl: currentPerson.linkedinUrl
          },
          (response: { success: boolean; data?: unknown; error?: string } | undefined) => {
            // @ts-expect-error - Chrome extension API
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: 'Extension communication failed' });
            } else if (response) {
              resolve(response);
            } else {
              resolve({ success: false, error: 'No response from extension' });
            }
          }
        );

        // Timeout after 30 seconds
        setTimeout(() => {
          resolve({ success: false, error: 'Request timed out' });
        }, 30000);
      });

      if (!scrapeResult.success) {
        throw new Error(scrapeResult.error || 'Failed to scrape LinkedIn profile');
      }

      // Save LinkedIn data for potential "Use this" action
      setLastLinkedInData(scrapeResult.data);

      // Call server action to personalize with Groq
      const result = await personalizeEmailAction({
        linkedinData: scrapeResult.data as Parameters<typeof personalizeEmailAction>[0]['linkedinData'],
        originalSubject: subject,
        originalBody: body,
        personName: currentPerson.fullName,
        personCompany: currentPerson.company,
        personRole: currentPerson.role || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to personalize email');
      }

      // Update the email fields
      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);

      // Save the result for displaying changes/found info
      setPersonalizeResult({
        similarityFound: result.similarityFound || false,
        changes: result.changes,
        foundInfo: result.foundInfo,
      });

    } catch (error) {
      console.error('Personalization error:', error);
      setPersonalizeError(error instanceof Error ? error.message : 'Personalization failed');
    } finally {
      setIsPersonalizing(false);
    }
  };

  // Handle "Use this info" button click
  const handleUseFoundInfo = async () => {
    if (!personalizeResult?.foundInfo || !currentPerson) return;

    setIsPersonalizing(true);
    setPersonalizeError(null);

    try {
      const result = await useFoundInfoAction({
        foundInfo: personalizeResult.foundInfo,
        originalSubject: subject,
        originalBody: body,
        personName: currentPerson.fullName,
        personCompany: currentPerson.company,
        personRole: currentPerson.role || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to personalize email');
      }

      // Update the email fields
      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);

      // Update result to show changes
      setPersonalizeResult({
        similarityFound: true,
        changes: result.changes,
        foundInfo: undefined,
      });

    } catch (error) {
      console.error('UseFoundInfo error:', error);
      setPersonalizeError(error instanceof Error ? error.message : 'Failed to personalize');
    } finally {
      setIsPersonalizing(false);
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
            {currentPerson.linkedinUrl && (
              <a
                href={currentPerson.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                aria-label="View LinkedIn profile"
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                View LinkedIn Profile
              </a>
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
          {/* Personalize Button */}
          {currentPerson.linkedinUrl && (
            <div className="mb-4">
              <button
                onClick={handlePersonalize}
                disabled={isPersonalizing || !currentPerson.linkedinUrl}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPersonalizing ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Personalizing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    Personalize with AI
                  </>
                )}
              </button>
              {personalizeError && (
                <p className="mt-2 text-sm text-red-600">{personalizeError}</p>
              )}

              {/* Personalization Result */}
              {personalizeResult && (
                <div className="mt-3">
                  {personalizeResult.similarityFound ? (
                    // Similarity found - show what was changed
                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm font-medium text-green-800">Changes made:</p>
                      <ul className="mt-1 text-sm text-green-700 list-disc list-inside">
                        {personalizeResult.changes?.map((change, i) => (
                          <li key={i}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    // No similarity found - show found info with "Use this" option
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                      <p className="text-sm font-medium text-amber-800">No similarities found.</p>
                      {personalizeResult.foundInfo && personalizeResult.foundInfo.length > 0 && (
                        <>
                          <p className="mt-2 text-sm text-amber-700">Found this about them:</p>
                          <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                            {personalizeResult.foundInfo.map((info, i) => (
                              <li key={i}>{info}</li>
                            ))}
                          </ul>
                          <button
                            onClick={handleUseFoundInfo}
                            disabled={isPersonalizing}
                            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 disabled:opacity-50"
                          >
                            {isPersonalizing ? 'Applying...' : 'Use this info'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
          
          {/* Resume Attachment Indicator */}
          {currentPerson.resumeId && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md">
              <svg
                className="w-5 h-5 text-green-800"
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
              <span className="text-sm font-medium text-green-800">
                Resume will be attached
              </span>
            </div>
          )}
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
              onClick={() => setShowScheduleModal(true)}
              disabled={!canSend || isSending}
              className="px-4 py-2 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Schedule
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

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Schedule Email</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date & Time
              </label>
              <input
                type="datetime-local"
                value={scheduledDateTime}
                onChange={(e) => {
                  setScheduledDateTime(e.target.value);
                  setScheduleError(null);
                }}
                min={new Date(new Date().getTime() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Minimum: 5 minutes from now
              </p>
            </div>

            {scheduleError && (
              <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md text-sm">
                {scheduleError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowScheduleModal(false);
                  setScheduledDateTime('');
                  setScheduleError(null);
                }}
                disabled={isScheduling}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={isScheduling || !scheduledDateTime}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScheduling ? 'Scheduling...' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extension Install Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Install LinkedIn Helper</h3>
                <p className="text-sm text-gray-500">One-time setup (10 seconds)</p>
              </div>
            </div>

            <p className="text-gray-600 mb-6">
              To personalize emails, install our Chrome extension. It reads LinkedIn profiles to help craft better outreach messages.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Note:</strong> You need to be logged into LinkedIn for this to work. The extension only reads public profile data.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
              <a
                href="https://chrome.google.com/webstore/detail/lattice-linkedin-helper/YOUR_EXTENSION_ID"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.193-5.101A11.94 11.94 0 0 0 24 12c0-1.537-.29-3.009-.818-4.364zM12 8.91a3.091 3.091 0 1 0 0 6.181 3.091 3.091 0 0 0 0-6.181z"/>
                </svg>
                Add to Chrome
              </a>
            </div>

            <p className="mt-4 text-xs text-gray-500 text-center">
              After installing, click &quot;Personalize with AI&quot; again
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
