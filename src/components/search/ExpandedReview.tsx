'use client';

import { useState, useEffect } from 'react';
import { SearchResultWithDraft } from '@/app/actions/search';
import { scheduleEmailAction } from '@/app/actions/send';
import { CompanyResearchPanel } from '@/components/compose/CompanyResearchPanel';

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

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;

  const [researchCollapsed, setResearchCollapsed] = useState(false);

  // Update subject/body when currentPerson changes
  useEffect(() => {
    if (currentPerson) {
      setSubject(currentPerson.draftSubject);
      setBody(currentPerson.draftBody);
    }
  }, [internalIndex, currentPerson]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showScheduleModal) {
          setShowScheduleModal(false);
          setScheduledDateTime('');
          setScheduleError(null);
        } else {
          onClose();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (currentPerson && !status && !isSending) {
          handleSend();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScheduleModal, currentPerson, status, isSending, onClose]);


  const handleSend = async () => {
    if (!currentPerson) return;

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
      if (!sendStatuses.has(results[i].id)) {
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
    if (!currentPerson?.userCandidateId) return;

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
        email: currentPerson.email || undefined,
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

  const handleUseTalkingPoint = (point: string) => {
    const lines = body.split('\n');
    const insertIdx = lines.findIndex(l => l.trim() === '') + 1 || 1;
    lines.splice(insertIdx, 0, `\nI saw that ${point.charAt(0).toLowerCase() + point.slice(1)} — really cool.\n`);
    setBody(lines.join('\n'));
  };

  if (!currentPerson) {
    return null;
  }

  const canSend = !status;

  return (
    <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-soft-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">{currentPerson.fullName}</h2>
            <p className="text-sm text-surface-600">
              {currentPerson.role ? `${currentPerson.role} at ` : ''}
              {currentPerson.company}
            </p>
            {currentPerson.linkedinUrl && (
              <a
                href={currentPerson.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
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
            <span className="text-sm text-surface-500">
              {internalIndex + 1} of {results.length}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-100 rounded-full"
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
                ? 'bg-green-100 text-emerald-700'
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
          {/* Company Research */}
          {currentPerson.company && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setResearchCollapsed(!researchCollapsed)}
                className="flex items-center gap-2 text-sm font-medium text-surface-700 hover:text-surface-900 mb-2"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${researchCollapsed ? '' : 'rotate-90'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Company Research
              </button>
              {!researchCollapsed && (
                <CompanyResearchPanel
                  key={internalIndex}
                  company={currentPerson.company}
                  role={currentPerson.role}
                  personName={currentPerson.fullName}
                  body={body}
                  onUseTalkingPoint={handleUseTalkingPoint}
                />
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="input resize-none text-sm"
            />
          </div>
          
          {/* Resume Attachment Indicator */}
          {currentPerson.resumeId && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
              <svg
                className="w-5 h-5 text-emerald-700"
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
              <span className="text-sm font-medium text-emerald-700">
                Resume will be attached
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-surface-50">
          <div className="flex items-center justify-between p-4">
            <div className="flex gap-2">
              <button
                onClick={handlePrevious}
                disabled={internalIndex === 0}
                className="btn-secondary text-sm"
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={internalIndex === results.length - 1}
                className="btn-secondary text-sm"
              >
                Next
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowScheduleModal(true)}
                disabled={!canSend || isSending}
                className="px-4 py-2 text-sm border border-primary-600 text-primary-600 rounded-md hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Schedule
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend || isSending}
                className="btn-primary text-sm"
              >
                {isSending ? 'Sending...' : 'Send & Next'}
              </button>
            </div>
          </div>
          <p className="text-xs text-surface-400 text-center pb-3">Esc to close · Cmd/Ctrl+Enter to send</p>
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-soft-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Schedule Email</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-700 mb-2">
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
                className="input text-sm"
              />
              <p className="mt-1 text-xs text-surface-500">
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
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={isScheduling || !scheduledDateTime}
                className="btn-primary text-sm"
              >
                {isScheduling ? 'Scheduling...' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
