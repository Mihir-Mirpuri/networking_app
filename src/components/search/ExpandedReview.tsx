'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchResultWithDraft, generateLLMDraftAction } from '@/app/actions/search';
import { scheduleEmailAction } from '@/app/actions/send';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
// import { CompanyResearchPanel } from '@/components/compose/CompanyResearchPanel';
import { SearchableCombobox } from './SearchableCombobox';
import { LoadingDots } from './LoadingSpinner';
import { TemplateData } from '@/app/actions/profile';
import { useEmailChat } from '@/contexts/EmailChatContext';
import { InsightsSection } from '@/components/sidebar/EmailChatPanel';

interface ExpandedReviewProps {
  results: SearchResultWithDraft[];
  currentIndex: number;
  onClose: () => void;
  onSend: (index: number, subject: string, body: string, resumeIdOverride?: string | null) => Promise<boolean>;
  sendStatuses: Map<string, 'success' | 'failed' | 'pending'>;
  sendErrors?: Map<string, string>;
  templates?: TemplateData[];
  defaultTemplateId?: string;
  onTemplateChange?: (templateId: string, personIndex: number) => void;
  isRegenerating?: boolean;
  autoPersonalize?: boolean;
  limitReached?: boolean;
  onLimitReached?: () => void;
  onDraftGenerated?: (personIndex: number, subject: string, body: string) => void;
}

function SendFailureAnimation({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 animate-fade-in">
      <svg className="w-16 h-16" viewBox="0 0 52 52">
        <circle
          className="draw-check-circle"
          cx="26" cy="26" r="25"
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
        />
        <path
          className="draw-check-mark"
          fill="none"
          stroke="#ef4444"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 17l18 18"
        />
        <path
          className="draw-check-mark"
          fill="none"
          stroke="#ef4444"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M35 17l-18 18"
        />
      </svg>
      <p className="mt-3 text-sm font-medium text-red-700">{message}</p>
    </div>
  );
}

function SendSuccessAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-6 animate-fade-in">
      <svg className="w-16 h-16" viewBox="0 0 52 52">
        <circle
          className="draw-check-circle"
          cx="26" cy="26" r="25"
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
        />
        <path
          className="draw-check-mark"
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.1 27.2l7.1 7.2 16.7-16.8"
        />
      </svg>
      <p className="mt-3 text-sm font-medium text-emerald-400">Email sent!</p>
    </div>
  );
}

export function ExpandedReview({
  results,
  currentIndex,
  onClose,
  onSend,
  sendStatuses,
  sendErrors,
  templates,
  defaultTemplateId,
  onTemplateChange,
  isRegenerating,
  autoPersonalize = false,
  limitReached,
  onLimitReached,
  onDraftGenerated,
}: ExpandedReviewProps) {
  const person = results[currentIndex];
  // Start with template - auto-personalization is optional via profile setting
  const [subject, setSubject] = useState(person?.draftSubject || '');
  const [body, setBody] = useState(person?.draftBody || '');
  const [isSending, setIsSending] = useState(false);
  const [internalIndex, setInternalIndex] = useState(currentIndex);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [showResumeDropdown, setShowResumeDropdown] = useState(false);
  const resumeDropdownRef = useRef<HTMLDivElement>(null);

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;

  // const [researchCollapsed, setResearchCollapsed] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId || '');
  const userEditedRef = useRef(false);
  const [originalSubject, setOriginalSubject] = useState(person?.draftSubject || '');
  const [originalBody, setOriginalBody] = useState(person?.draftBody || '');
  const [hasRefined, setHasRefined] = useState(false);

  // Email chat context for sidebar chat integration
  const { openEmailChat, closeEmailChat, currentEmail, updateEmail, fetchInsights } = useEmailChat();

  // Track when we're pushing local changes to context to prevent sync loop
  const isPushingToContextRef = useRef(false);

  // Synchronous state reset when person changes - always use template
  const [prevIndex, setPrevIndex] = useState(internalIndex);
  if (internalIndex !== prevIndex) {
    setPrevIndex(internalIndex);
    const nextPerson = results[internalIndex];
    setSubject(nextPerson?.draftSubject || '');
    setBody(nextPerson?.draftBody || '');
    userEditedRef.current = false;
    setOriginalSubject(nextPerson?.draftSubject || '');
    setOriginalBody(nextPerson?.draftBody || '');
    setHasRefined(false);
    // Reset resume selection when switching person (will be initialized below)
    setSelectedResumeId(nextPerson?.resumeId || null);
  }

  // Fetch resumes on mount
  useEffect(() => {
    getResumesAction().then((result) => {
      if (result.success) {
        setResumes(result.resumes);
      }
    });
  }, []);

  // Initialize selectedResumeId from currentPerson's template setting
  useEffect(() => {
    setSelectedResumeId(currentPerson?.resumeId || null);
  }, [currentPerson?.id]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (resumeDropdownRef.current && !resumeDropdownRef.current.contains(e.target as Node)) {
        setShowResumeDropdown(false);
      }
    };
    if (showResumeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResumeDropdown]);

  // Auto-personalize email with LLM (only if enabled in profile)
  useEffect(() => {
    if (!autoPersonalize) return;
    if (currentPerson && !currentPerson.llmDraftGenerated && currentPerson.userCandidateId) {
      setIsGeneratingDraft(true);
      const personId = currentPerson.id;
      const idx = internalIndex;
      generateLLMDraftAction({
        personId: currentPerson.id,
        userCandidateId: currentPerson.userCandidateId,
      }).then((result) => {
        if (result.success && !userEditedRef.current && personId === results[idx]?.id) {
          setSubject(result.subject);
          setBody(result.body);
          setOriginalSubject(result.subject);
          setOriginalBody(result.body);
          setHasRefined(false);
          onDraftGenerated?.(idx, result.subject, result.body);
        }
      }).catch((err) => {
        console.warn('[Draft] LLM generation failed, using template:', err);
      }).finally(() => {
        setIsGeneratingDraft(false);
      });
    }
  }, [internalIndex, autoPersonalize]);

  // Open email chat when person changes
  useEffect(() => {
    if (currentPerson && subject && body) {
      openEmailChat(currentPerson.id, currentPerson.fullName, subject, body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPerson?.id, openEmailChat]);

  // Fetch person insights when person changes
  useEffect(() => {
    if (currentPerson?.id) {
      fetchInsights(currentPerson.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPerson?.id, fetchInsights]);

  // Keep chat context in sync when user edits subject/body locally
  useEffect(() => {
    if (currentPerson && subject && body) {
      isPushingToContextRef.current = true;
      updateEmail(subject, body);
      // Reset flag after a tick to allow context-initiated updates
      requestAnimationFrame(() => {
        isPushingToContextRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body]);

  // Sync email from chat context to local state (when AI refines the email)
  useEffect(() => {
    // Skip if we just pushed local changes to context (prevents loop)
    if (isPushingToContextRef.current) return;

    if (currentEmail && currentPerson) {
      if (currentEmail.subject !== subject || currentEmail.body !== body) {
        setSubject(currentEmail.subject);
        setBody(currentEmail.body);
        userEditedRef.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmail]);

  // Close email chat when component unmounts
  useEffect(() => {
    return () => {
      closeEmailChat();
    };
  }, [closeEmailChat]);

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
        if (limitReached) {
          onLimitReached?.();
        } else if (currentPerson && !status && !isSending && !showSuccess) {
          handleSend();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScheduleModal, currentPerson, status, isSending, showSuccess, onClose]);


  const handleSend = async () => {
    if (!currentPerson) return;

    // Redirect to sign in if not authenticated
    setIsSending(true);
    const success = await onSend(internalIndex, subject, body, selectedResumeId);
    setIsSending(false);

    if (!success) {
      setShowFailure(true);
      setTimeout(() => setShowFailure(false), 2000);
      return;
    }

    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      // Auto-advance to next unsent person
      const nextIndex = findNextUnsent(internalIndex + 1);
      if (nextIndex !== -1) {
        setInternalIndex(nextIndex);
      } else {
        onClose();
      }
    }, 1200);
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
        resumeId: selectedResumeId ?? undefined,
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

  // const handleUseTalkingPoint = (point: string) => {
  //   const lines = body.split('\n');
  //   const insertIdx = lines.findIndex(l => l.trim() === '') + 1 || 1;
  //   lines.splice(insertIdx, 0, `\nI saw that ${point.charAt(0).toLowerCase() + point.slice(1)} — really cool.\n`);
  //   setBody(lines.join('\n'));
  // };

  if (!currentPerson) {
    return null;
  }

  const canSend = !status && !showSuccess && !limitReached;

  return (
    <div className="fixed inset-0 lg:left-80 bg-[#212121] flex items-center justify-center z-50 p-4 animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLDivElement).dataset.backdropMouseDown = 'true'; }} onMouseUp={(e) => { if (e.target === e.currentTarget && (e.currentTarget as HTMLDivElement).dataset.backdropMouseDown === 'true') onClose(); delete (e.currentTarget as HTMLDivElement).dataset.backdropMouseDown; }} onClick={() => {}}>
      <div className="bg-[#212121] rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-scale-in relative border border-[#333] [&_*]:focus-visible:ring-0 [&_*]:focus-visible:ring-offset-0">
        {/* Success animation overlay */}
        {showSuccess && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#212121]/90 rounded-xl">
            <SendSuccessAnimation />
          </div>
        )}

        {/* Failure animation overlay */}
        {showFailure && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#212121]/90 rounded-xl">
            <SendFailureAnimation message={sendErrors?.get(currentPerson.id) || 'Failed to send email'} />
          </div>
        )}

        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#252525] rounded-t-xl border-b border-[#333]">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium text-white truncate">New Message</h2>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Mobile chat button */}
            <button
              onClick={() => setShowMobileChat(true)}
              className="lg:hidden p-1 hover:bg-[#404040] rounded text-white hover:text-white transition-colors"
              aria-label="Open AI chat"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[#404040] rounded text-white hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto bg-[#212121]">
          {/* To field (read-only, showing recipient) */}
          <div className="flex items-center border-b border-[#333] px-4">
            <span className="text-sm text-white w-10 flex-shrink-0">To</span>
            <span className="flex-1 py-2.5 text-sm text-white">
              {currentPerson.linkedinUrl ? (
                <a
                  href={currentPerson.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#0A66C2] transition-colors"
                >
                  {currentPerson.fullName}
                </a>
              ) : (
                currentPerson.fullName
              )}
              {(currentPerson.role || currentPerson.company) && (
                <span className="text-white ml-2 text-xs">
                  {currentPerson.role ? `${currentPerson.role} at ` : ''}{currentPerson.company}
                </span>
              )}
            </span>
          </div>

          {/* Subject field */}
          <div className="flex items-center border-b border-[#333] px-4">
            <input
              type="text"
              value={subject}
              onChange={(e) => { userEditedRef.current = true; setSubject(e.target.value); }}
              placeholder="Subject"
              className={`flex-1 py-2.5 text-sm text-white bg-transparent outline-none placeholder-[#606060] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isRegenerating || isGeneratingDraft ? 'opacity-50' : ''}`}
            />
            {isGeneratingDraft && (
              <span className="text-xs text-white flex items-center gap-1 flex-shrink-0">
                <LoadingDots className="text-white" /> Personalizing
              </span>
            )}
          </div>

          {/* Body */}
          <div className="px-4 pt-3">
            <textarea
              value={body}
              onChange={(e) => { userEditedRef.current = true; setBody(e.target.value); }}
              rows={12}
              placeholder=""
              className={`w-full text-sm text-white bg-transparent outline-none resize-none leading-relaxed focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isRegenerating || isGeneratingDraft ? 'opacity-50' : ''}`}
            />
          </div>

          {/* Resume attachment chip */}
          {selectedResumeId && (
            <div className="px-4 pb-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#252525] border border-[#404040] rounded-lg">
                <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                </svg>
                <span className="text-xs text-white">
                  {resumes.find(r => r.id === selectedResumeId)?.filename || 'Resume attached'}
                </span>
                <button
                  onClick={() => setSelectedResumeId(null)}
                  className="ml-1 text-white hover:text-white"
                  title="Remove attachment"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Refine hint */}
          <div className="px-4 pb-2 hidden lg:flex items-center gap-2 text-xs text-white">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            <span>Use the sidebar chat to refine with AI</span>
          </div>
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-2 bg-[#252525] border-t border-[#333]">
          {/* Template selector */}
          {templates && templates.length > 0 && onTemplateChange && (
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                onTemplateChange(e.target.value, internalIndex);
              }}
              disabled={!canSend || isRegenerating}
              className="py-1.5 px-2 text-sm text-white bg-[#333] rounded-lg border border-[#404040] outline-none cursor-pointer disabled:opacity-50 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-[#3a3a3a]"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#2a2a2a] text-white">
                  {t.name}{t.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          )}

          {/* Resume attachment toggle */}
          {resumes.length > 0 && (
            <div className="relative" ref={resumeDropdownRef}>
              <button
                onClick={() => setShowResumeDropdown(!showResumeDropdown)}
                disabled={!canSend || isSending}
                className={`p-2 rounded-full transition-colors disabled:opacity-30 ${
                  selectedResumeId
                    ? 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50'
                    : 'text-white hover:bg-[#333] hover:text-white'
                }`}
                title={selectedResumeId ? 'Resume attached (click to change)' : 'Attach resume'}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                </svg>
              </button>

              {/* Dropdown */}
              {showResumeDropdown && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#2a2a2a] rounded-lg shadow-xl border border-[#404040] py-1 z-10">
                  <button
                    onClick={() => {
                      setSelectedResumeId(null);
                      setShowResumeDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#333] ${
                      !selectedResumeId ? 'text-white bg-[#333]' : 'text-white'
                    }`}
                  >
                    No resume
                  </button>
                  {resumes.map((resume) => (
                    <button
                      key={resume.id}
                      onClick={() => {
                        setSelectedResumeId(resume.id);
                        setShowResumeDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-[#333] truncate ${
                        selectedResumeId === resume.id ? 'text-white bg-[#333]' : 'text-white'
                      }`}
                    >
                      {resume.filename}
                      {resume.isActive && <span className="text-emerald-400 ml-1">(Active)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1" />

          {/* Schedule */}
          <button
            onClick={limitReached ? () => onLimitReached?.() : () => setShowScheduleModal(true)}
            disabled={!canSend || isSending}
            className="p-2 rounded-full text-white hover:bg-[#333] hover:text-white transition-colors disabled:opacity-30"
            title="Schedule send"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
            </svg>
          </button>

          {/* Send button */}
          <button
            onClick={limitReached ? () => onLimitReached?.() : handleSend}
            disabled={limitReached ? false : (!canSend || isSending)}
            className="btn-primary text-sm rounded-full px-5 py-2 disabled:opacity-50"
          >
            {isSending ? 'Sending...' : limitReached ? 'Limit reached' : 'Send'}
          </button>
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 lg:left-80 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-[#2a2a2a] rounded-xl shadow-2xl border border-[#404040] max-w-sm w-full p-6">
            <h3 className="text-base font-semibold text-white mb-4">Schedule send</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-white mb-2">
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
              <p className="mt-1 text-xs text-white">
                Minimum: 5 minutes from now
              </p>
            </div>

            {scheduleError && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-lg text-sm">
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

      {/* Mobile Chat Panel - Slide up from bottom */}
      {showMobileChat && (
        <MobileChatPanel onClose={() => setShowMobileChat(false)} />
      )}
    </div>
  );
}

// Mobile chat panel component
function MobileChatPanel({ onClose }: { onClose: () => void }) {
  const {
    currentPersonName,
    currentEmail,
    messages,
    isProcessing,
    sendMessage,
  } = useEmailChat();

  const [inputValue, setInputValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const message = inputValue.trim();
    if (!message || isProcessing) return;

    setInputValue('');
    await sendMessage(message);
  };

  return (
    <div className="lg:hidden fixed inset-0 z-[60] flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-up panel */}
      <div className="mt-auto relative bg-[#181818] rounded-t-2xl border-t border-[#2a2a2a] max-h-[70vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#2a2a2a] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-white">AI Editor</p>
              <p className="text-xs text-white">Email to {currentPersonName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white hover:text-white hover:bg-[#2a2a2a] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current email preview */}
        {currentEmail && (
          <div className="px-4 py-2 border-b border-[#2a2a2a]">
            <p className="text-xs text-white mb-0.5">Subject:</p>
            <p className="text-sm text-white truncate">{currentEmail.subject}</p>
          </div>
        )}

        {/* Person insights checklist */}
        <InsightsSection />

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {/* Welcome message if no messages */}
          {messages.length === 0 && !isProcessing && (
            <div className="text-center py-4">
              <p className="text-sm text-white">How should I refine the email?</p>
              <p className="text-xs text-white mt-1">e.g. &quot;Make it shorter&quot;</p>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  message.role === 'user'
                    ? 'bg-[#404040] text-white'
                    : 'bg-[#1a1a1a] border border-[#2a2a2a] text-white'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2">
                <LoadingDots className="text-white" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div className="p-3 border-t border-[#2a2a2a]">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-[#111111] rounded-lg px-3 py-2">
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="How should I change it?"
                disabled={isProcessing}
                className="flex-1 min-w-0 text-sm bg-transparent border-none text-white placeholder:text-white focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isProcessing}
                className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-white hover:text-white disabled:opacity-40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
