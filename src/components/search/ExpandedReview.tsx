'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SearchResultWithDraft, generateLLMDraftAction, regenerateDraftAction } from '@/app/actions/search';
import { scheduleEmailAction } from '@/app/actions/send';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
import { LoadingDots } from './LoadingSpinner';
import { TemplateData } from '@/app/actions/profile';
import { useEmailChat } from '@/contexts/EmailChatContext';
import type { PersonInsightResponse } from '@/app/actions/person-insights';
import { useSubscription } from '@/contexts/SubscriptionContext';
// SearchableCombobox removed — no longer used in this layout

// ─── Icons ───────────────────────────────────────────────────────────────────

function SignalLogoSmall({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="12" fill="currentColor" />
      <path d="M78 56 A30 30 0 0 0 78 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M122 56 A30 30 0 0 1 122 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M58 38 A55 55 0 0 0 58 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M142 38 A55 55 0 0 1 142 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M38 20 A80 80 0 0 0 38 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M162 20 A80 80 0 0 1 162 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── Typing Indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// ─── Send Animations ─────────────────────────────────────────────────────────

function SendSuccessAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-6 animate-fade-in">
      <svg className="w-16 h-16" viewBox="0 0 52 52">
        <circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="var(--accent)" strokeWidth="2" />
        <path className="draw-check-mark" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
      </svg>
      <p className="mt-3 text-sm font-medium text-[var(--accent-text)]">Email sent!</p>
    </div>
  );
}

function SendFailureAnimation({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 animate-fade-in">
      <svg className="w-16 h-16" viewBox="0 0 52 52">
        <circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="#ef4444" strokeWidth="2" />
        <path className="draw-check-mark" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M17 17l18 18" />
        <path className="draw-check-mark" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M35 17l-18 18" />
      </svg>
      <p className="mt-3 text-sm font-medium text-red-700">{message}</p>
    </div>
  );
}

// ─── Toolbar Helpers ─────────────────────────────────────────────────────────

function ToolbarButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // prevent stealing focus from editor
      onClick={onClick}
      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
        active ? 'text-white bg-[#333]' : 'text-[#888] hover:text-white hover:bg-[#333]'
      }`}
    >
      {children}
    </button>
  );
}



// ─── Insights as Chat Message ────────────────────────────────────────────────

interface InsightsChatMessageProps {
  insights: PersonInsightResponse[];
  personName: string;
  selectedInsightIds: Set<string>;
  onSelectInsight: (insight: PersonInsightResponse) => void;
}

function InsightsChatMessage({ insights, personName, selectedInsightIds, onSelectInsight }: InsightsChatMessageProps) {
  const linkedinInsights = insights.filter(i => i.source === 'linkedin' || i.source === 'database');
  const googleInsights = insights.filter(i => i.source !== 'linkedin' && i.source !== 'database');
  const firstName = personName.split(' ')[0];
  const [linkedinOpen, setLinkedinOpen] = useState(true);
  const [googleOpen, setGoogleOpen] = useState(true);
  const [linkedinShowAll, setLinkedinShowAll] = useState(false);
  const [googleShowAll, setGoogleShowAll] = useState(false);

  const handleLinkClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderInsightChip = (insight: PersonInsightResponse) => {
    const isSelected = selectedInsightIds.has(insight.id);
    return (
      <button
        key={insight.id}
        onClick={() => onSelectInsight(insight)}
        className={`group flex items-start gap-1.5 px-2 py-1 rounded-lg text-xs text-left font-medium text-white backdrop-blur-md transition-all ${
          isSelected
            ? 'bg-white/30'
            : 'bg-white/10 hover:bg-white/20'
        }`}
      >
        <span>{insight.label}</span>
        {insight.sourceUrl && (
          <span
            onClick={(e) => handleLinkClick(e, insight.sourceUrl!)}
            className="flex-shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors cursor-pointer mt-0.5"
            title="Open source"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex gap-2 max-w-[85%]">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
        <SignalLogoSmall className="w-3 h-3 text-white" />
      </div>
      <div className={`min-w-0 rounded-2xl px-3 py-2 rounded-bl-md space-y-2.5 text-sm text-white bg-[var(--accent)]`}>
        <p className="text-sm text-white leading-relaxed">Here&apos;s what I found on {firstName}:</p>

        {linkedinInsights.length > 0 && (
          <div className="overflow-hidden">
            <button
              onClick={() => setLinkedinOpen(!linkedinOpen)}
              className="w-full flex items-center gap-1.5 py-1.5 hover:opacity-80 transition-opacity"
            >
              <div className="w-3.5 h-3.5 rounded bg-[#0A66C2] flex items-center justify-center">
                <span className="text-[7px] font-bold text-white">in</span>
              </div>
              <span className="text-xs font-medium text-white">LinkedIn</span>
              <span className="text-[10px] text-white/70">({linkedinInsights.length})</span>
              <svg
                className={`w-3 h-3 text-white/70 ml-auto transition-transform ${linkedinOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {linkedinOpen && (
              <div className="pt-1 pb-2 flex flex-wrap gap-1.5">
                {(linkedinShowAll ? linkedinInsights : linkedinInsights.slice(0, 3)).map(renderInsightChip)}
                {!linkedinShowAll && linkedinInsights.length > 3 && (
                  <button
                    onClick={() => setLinkedinShowAll(true)}
                    className="flex items-center px-2 py-1 rounded-full text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all"
                    title={`Show ${linkedinInsights.length - 3} more`}
                  >
                    ...
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {googleInsights.length > 0 && (
          <div className="overflow-hidden">
            <button
              onClick={() => setGoogleOpen(!googleOpen)}
              className="w-full flex items-center gap-1.5 py-1.5 hover:opacity-80 transition-opacity"
            >
              <span className="text-xs font-bold text-[#4285F4]">G</span>
              <span className="text-xs font-medium text-white">Google</span>
              <span className="text-[10px] text-white/70">({googleInsights.length})</span>
              <svg
                className={`w-3 h-3 text-white/70 ml-auto transition-transform ${googleOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {googleOpen && (
              <div className="pt-1 pb-2 flex flex-wrap gap-1.5">
                {(googleShowAll ? googleInsights : googleInsights.slice(0, 3)).map(renderInsightChip)}
                {!googleShowAll && googleInsights.length > 3 && (
                  <button
                    onClick={() => setGoogleShowAll(true)}
                    className="flex items-center px-2 py-1 rounded-full text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all"
                    title={`Show ${googleInsights.length - 3} more`}
                  >
                    ...
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-white leading-relaxed">How would you like to edit the email?</p>
      </div>
    </div>
  );
}

// ─── Chat Sidebar ────────────────────────────────────────────────────────────

function ChatSidebar() {
  const {
    messages,
    isProcessing,
    sendMessage,
    clearMessages,
    insights,
    insightsLoading,
    currentPersonName,
  } = useEmailChat();

  const [inputValue, setInputValue] = useState('');
  const { isSubscribed } = useSubscription();
  const [selectedInsights, setSelectedInsights] = useState<PersonInsightResponse[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedInsightIds = new Set(selectedInsights.map(i => i.id));

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
  }, [inputValue]);

  const handleSelectInsight = (insight: PersonInsightResponse) => {
    setSelectedInsights(prev => {
      const exists = prev.some(i => i.id === insight.id);
      if (exists) {
        return prev.filter(i => i.id !== insight.id);
      }
      return [...prev, insight];
    });
  };

  const handleRemoveInsight = (insightId: string) => {
    setSelectedInsights(prev => prev.filter(i => i.id !== insightId));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const message = inputValue.trim();
    if (!message || isProcessing) return;

    // Build message with selected insights context
    let fullMessage = message;
    if (selectedInsights.length > 0) {
      const insightLabels = selectedInsights.map(i => i.label).join(', ');
      fullMessage = `${message}\n\n[Include these insights: ${insightLabels}]`;
    }

    setInputValue('');
    setSelectedInsights([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    await sendMessage(fullMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full w-80 bg-[#141414] border-r border-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <SignalLogoSmall className="w-7 h-7 text-white" />
        <span className="text-xl font-bold text-white">Signl</span>
        <div className="flex-1" />
        <button
          onClick={clearMessages}
          className="text-[#888] hover:text-white transition-colors"
          title="New session"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c0-4.97 4.03-9 9-9h2c4.97 0 9 4.03 9 9 0 4.97-4.03 9-9 9H9l-4.5 3V18.5C2.9 16.8 2 14.5 2 12Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v8M8 12h8" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {/* Person insights as AI first message */}
        {insightsLoading && insights.length === 0 ? (
          <div className="flex gap-2">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
              <SignalLogoSmall className="w-3 h-3 text-white" />
            </div>
            <div className={`rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : 'bg-[var(--accent)]'}`}>
              <TypingIndicator />
            </div>
          </div>
        ) : insights.length > 0 && currentPersonName ? (
          <InsightsChatMessage
            insights={insights}
            personName={currentPersonName}
            selectedInsightIds={selectedInsightIds}
            onSelectInsight={handleSelectInsight}
          />
        ) : null}

        {/* Chat messages */}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.role === 'user' ? (
              <div className="flex gap-2 max-w-[85%]">
                <div className="rounded-2xl px-3 py-2 bg-[#2a2a2a] text-white rounded-br-md">
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 max-w-[85%]">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
                  <SignalLogoSmall className="w-3 h-3 text-white" />
                </div>
                <div className={`rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md bg-[var(--accent)]`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="flex gap-2 max-w-[85%]">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
                <SignalLogoSmall className="w-3 h-3 text-white" />
              </div>
              <div className={`rounded-2xl px-3 py-2 rounded-bl-md bg-[var(--accent)]`}>
                <TypingIndicator />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-3">
        {/* Selected insights chips */}
        {selectedInsights.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selectedInsights.map(insight => (
              <div
                key={insight.id}
                className="flex items-start gap-1 px-2 py-1 bg-[var(--accent)] rounded-lg text-xs text-white"
              >
                <span>{insight.label}</span>
                <button
                  onClick={() => handleRemoveInsight(insight.id)}
                  className="flex-shrink-0 p-0.5 rounded-full hover:bg-white/20 transition-colors mt-0.5"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className="relative bg-[#111111] rounded-lg cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me to edit this email..."
            disabled={isProcessing}
            maxLength={1000}
            rows={1}
            className="w-full px-3 pr-10 py-2.5 text-sm bg-transparent border-none text-white placeholder-[#505050] focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
            style={{ maxHeight: '80px' }}
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!inputValue.trim() || isProcessing}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white disabled:text-[#404040] disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

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
  console.log('[ExpandedReview] Component rendered, currentIndex:', currentIndex);
  const router = useRouter();
  const person = results[currentIndex];
  const [subject, setSubject] = useState(person?.draftSubject || '');
  const [body, setBody] = useState(person?.draftBody || '');
  // Bumped only for EXTERNAL body updates (person switch, AI refine, context sync, etc).
  // Used to drive a useEffect that resyncs the contentEditable's innerHTML.
  // User typing updates `body` via onInput but does NOT bump this — that way the
  // DOM-sync effect never runs during typing and the caret/selection is preserved.
  const [bodyVersion, setBodyVersion] = useState(0);
  const setBodyAndSyncDom = (newBody: string) => {
    setBody(newBody);
    setBodyVersion((v) => v + 1);
  };
  const [isSending, setIsSending] = useState(false);
  const [internalIndex, setInternalIndex] = useState(currentIndex);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [showResumeDropdown, setShowResumeDropdown] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkPopoverPos, setLinkPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [showSaveAttachmentPrompt, setShowSaveAttachmentPrompt] = useState(false);
  const [newlyUploadedResumeId, setNewlyUploadedResumeId] = useState<string | null>(null);
  const resumeDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const linkPopoverRef = useRef<HTMLDivElement>(null);

  const currentPerson = results[internalIndex];
  const status = currentPerson ? sendStatuses.get(currentPerson.id) : undefined;

  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId || '');
  const userEditedRef = useRef(false);
  const awaitingTemplateRegenRef = useRef(false);

  const { openEmailChat, closeEmailChat, currentEmail, updateEmail, fetchInsights } = useEmailChat();
  const isPushingToContextRef = useRef(false);

  // Synchronous state reset when person changes
  const [prevIndex, setPrevIndex] = useState(internalIndex);
  if (internalIndex !== prevIndex) {
    setPrevIndex(internalIndex);
    const nextPerson = results[internalIndex];
    setSubject(nextPerson?.draftSubject || '');
    setBodyAndSyncDom(nextPerson?.draftBody || '');
    userEditedRef.current = false;
    setSelectedResumeId(nextPerson?.resumeId || null);
  }

  // Fetch resumes on mount
  useEffect(() => {
    getResumesAction().then((result) => {
      if (result.success) setResumes(result.resumes);
    });
  }, []);

  useEffect(() => {
    setSelectedResumeId(currentPerson?.resumeId || null);
  }, [currentPerson?.id]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (resumeDropdownRef.current && !resumeDropdownRef.current.contains(e.target as Node)) {
        setShowResumeDropdown(false);
      }
    };
    if (showResumeDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResumeDropdown]);

  // Click outside handler for link popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (linkPopoverRef.current && !linkPopoverRef.current.contains(e.target as Node)) {
        setShowLinkModal(false);
        setLinkPopoverPos(null);
        setLinkUrl('');
        setLinkText('');
      }
    };
    if (showLinkModal) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLinkModal]);

  // Auto-personalize
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
          setBodyAndSyncDom(result.body);
          onDraftGenerated?.(idx, result.subject, result.body);
        }
      }).catch((err) => {
        console.warn('[Draft] LLM generation failed, using template:', err);
      }).finally(() => {
        setIsGeneratingDraft(false);
      });
    }
  }, [internalIndex, autoPersonalize]);

  // Regenerate draft if body is empty (fixes stale/empty drafts in DB)
  useEffect(() => {
    const templateId = selectedTemplateId || defaultTemplateId || templates?.[0]?.id;
    console.log('[Draft] Checking if regeneration needed:', { body: body?.substring(0, 50), templateId, userCandidateId: currentPerson?.userCandidateId, isGeneratingDraft });
    if (!body.trim() && currentPerson?.userCandidateId && templateId && !isGeneratingDraft) {
      console.log('[Draft] Regenerating draft with templateId:', templateId);
      setIsGeneratingDraft(true);
      const personId = currentPerson.id;
      const idx = internalIndex;
      regenerateDraftAction({
        userCandidateId: currentPerson.userCandidateId,
        templateId: templateId,
        useLLM: false, // Fast template-based generation
      }).then((result) => {
        console.log('[Draft] Regeneration result:', result);
        if (result.success && !userEditedRef.current && personId === results[idx]?.id) {
          setSubject(result.subject);
          setBodyAndSyncDom(result.body);
        }
      }).catch((err) => {
        console.warn('[Draft] Template regeneration failed:', err);
      }).finally(() => {
        setIsGeneratingDraft(false);
      });
    }
  }, [currentPerson?.id, selectedTemplateId, defaultTemplateId, templates]);

  // Open email chat when person changes
  useEffect(() => {
    if (currentPerson && subject && body) {
      openEmailChat(currentPerson.id, currentPerson.fullName, subject, body);
    }
  }, [currentPerson?.id, openEmailChat]);

  // Fetch insights when person changes
  useEffect(() => {
    if (currentPerson?.id) fetchInsights(currentPerson.id);
  }, [currentPerson?.id, fetchInsights]);

  // Sync local edits → context
  useEffect(() => {
    if (currentPerson && subject && body) {
      isPushingToContextRef.current = true;
      updateEmail(subject, body);
      requestAnimationFrame(() => { isPushingToContextRef.current = false; });
    }
  }, [subject, body]);

  // Sync local body/subject when a template switch finishes regenerating the draft
  useEffect(() => {
    if (!awaitingTemplateRegenRef.current) return;
    if (!currentPerson) return;
    awaitingTemplateRegenRef.current = false;
    userEditedRef.current = false;
    setSubject(currentPerson.draftSubject || '');
    setBodyAndSyncDom(currentPerson.draftBody || '');
  }, [currentPerson?.draftBody, currentPerson?.draftSubject]);

  // Sync context → local (when AI refines)
  useEffect(() => {
    if (isPushingToContextRef.current) return;
    if (currentEmail && currentPerson) {
      if (currentEmail.subject !== subject || currentEmail.body !== body) {
        setSubject(currentEmail.subject);
        setBodyAndSyncDom(currentEmail.body);
        userEditedRef.current = true;
      }
    }
  }, [currentEmail]);

  useEffect(() => {
    return () => { closeEmailChat(); };
  }, [closeEmailChat]);

  // Sync body state into the contentEditable editor.
  // This effect ONLY runs when bodyVersion changes (i.e., for external updates
  // via setBodyAndSyncDom). It does NOT run when the user types — that path
  // calls plain setBody, which leaves bodyVersion alone, so the DOM is left
  // untouched and the caret/selection is preserved.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = body.replace(/\n/g, '<br>');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyVersion]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLinkModal) {
          setShowLinkModal(false);
          setLinkPopoverPos(null);
          setLinkUrl('');
          setLinkText('');
        } else if (showScheduleModal) {
          setShowScheduleModal(false);
          setScheduledDateTime('');
          setScheduleError(null);
        } else {
          onClose();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (limitReached) onLimitReached?.();
        else if (currentPerson && !status && !isSending && !showSuccess) handleSend();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showScheduleModal, currentPerson, status, isSending, showSuccess, onClose]);

  const insertLink = () => {
    if (!linkUrl) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    // Restore saved selection
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      }
    }
    const displayText = linkText || linkUrl;
    const anchor = `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${displayText}</a>`;
    document.execCommand('insertHTML', false, anchor);
    userEditedRef.current = true;
    setBody(editor.innerText);
    setShowLinkModal(false);
    setLinkPopoverPos(null);
    setLinkUrl('');
    setLinkText('');
    savedSelectionRef.current = null;
  };

  const toggleBulletList = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      editor.focus();
      document.execCommand('insertHTML', false, '<ul><li>&nbsp;</li></ul>');
      userEditedRef.current = true;
      setBody(editor.innerText);
      return;
    }

    // Check if cursor is inside a list item - if so, remove the bullet
    const anchorNode = sel.anchorNode;
    const li = anchorNode?.parentElement?.closest('li');
    if (li) {
      const ul = li.closest('ul');
      const text = li.textContent || '';

      // Create a text node with the content
      const textNode = document.createTextNode(text.trim() || '\u00A0');

      // If this is the only item in the list, replace the whole ul
      if (ul && ul.children.length === 1) {
        ul.parentNode?.replaceChild(textNode, ul);
      } else {
        // Multiple items - just replace this li with text + br
        const br = document.createElement('br');
        li.parentNode?.insertBefore(textNode, li);
        li.parentNode?.insertBefore(br, li);
        li.remove();
      }

      // Place cursor at the text
      const newRange = document.createRange();
      newRange.setStart(textNode, textNode.length);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      userEditedRef.current = true;
      setBody(editor.innerText);
      return;
    }

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString();

    if (selectedText.trim()) {
      // Has selected text - convert each line to a bullet point
      const lines = selectedText.split('\n').filter(line => line.trim());
      const listItems = lines.map(line => `<li>${line.trim()}</li>`).join('');
      const bulletList = `<ul>${listItems}</ul>`;

      range.deleteContents();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = bulletList;
      const frag = document.createDocumentFragment();
      while (tempDiv.firstChild) {
        frag.appendChild(tempDiv.firstChild);
      }
      range.insertNode(frag);
      sel.removeAllRanges();
    } else {
      // Cursor on a line but no text selected - wrap current line in bullet
      if (anchorNode && anchorNode.nodeType === Node.TEXT_NODE && anchorNode.textContent?.trim()) {
        const textNode = anchorNode as Text;
        const text = textNode.textContent || '';

        // Create the bullet list with this line's content
        const ul = document.createElement('ul');
        const li = document.createElement('li');
        li.textContent = text.trim();
        ul.appendChild(li);

        // Replace the text node with the list
        textNode.parentNode?.replaceChild(ul, textNode);

        // Place cursor at end of the list item
        const newRange = document.createRange();
        newRange.selectNodeContents(li);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      } else {
        // Empty line or non-text node - insert new bullet
        editor.focus();
        document.execCommand('insertHTML', false, '<ul><li>&nbsp;</li></ul>');
      }
    }

    userEditedRef.current = true;
    setBody(editor.innerText);
  };

  const handleSend = async () => {
    if (!currentPerson) return;
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
      const nextIndex = findNextUnsent(internalIndex + 1);
      if (nextIndex !== -1) setInternalIndex(nextIndex);
      else onClose();
    }, 1200);
  };

  const findNextUnsent = (startIndex: number): number => {
    for (let i = startIndex; i < results.length; i++) {
      if (!sendStatuses.has(results[i].id)) return i;
    }
    return -1;
  };

  const handleSchedule = async () => {
    if (!currentPerson?.userCandidateId) return;
    if (!scheduledDateTime) { setScheduleError('Please select a date and time'); return; }
    const selectedDate = new Date(scheduledDateTime);
    const now = new Date();
    if (selectedDate < new Date(now.getTime() + 5 * 60 * 1000)) {
      setScheduleError('Scheduled time must be at least 5 minutes in the future');
      return;
    }
    setIsScheduling(true);
    setScheduleError(null);
    try {
      const result = await scheduleEmailAction({
        email: currentPerson.email || undefined,
        subject, body,
        userCandidateId: currentPerson.userCandidateId,
        resumeId: selectedResumeId ?? undefined,
        scheduledFor: selectedDate,
      });
      if (result.success) {
        setShowScheduleModal(false);
        setScheduledDateTime('');
        const nextIndex = findNextUnsent(internalIndex + 1);
        if (nextIndex !== -1) setInternalIndex(nextIndex);
        else onClose();
      } else {
        setScheduleError(result.error || 'Failed to schedule email');
      }
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'Failed to schedule email');
    } finally {
      setIsScheduling(false);
    }
  };

  useEffect(() => {
    if (showScheduleModal && !scheduledDateTime) {
      const defaultTime = new Date();
      defaultTime.setHours(defaultTime.getHours() + 1);
      defaultTime.setMinutes(0);
      defaultTime.setSeconds(0);
      const localDateTime = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16);
      setScheduledDateTime(localDateTime);
    }
  }, [showScheduleModal, scheduledDateTime]);

  const handleUploadResume = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingResume(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/resume/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success && data.resume) {
        // Add the new resume to the list and select it
        setResumes(prev => [...prev, data.resume]);
        setSelectedResumeId(data.resume.id);
        setShowResumeDropdown(false);
        // Show prompt to save to attachments
        setNewlyUploadedResumeId(data.resume.id);
        setShowSaveAttachmentPrompt(true);
      }
    } catch (error) {
      console.error('Failed to upload resume:', error);
    } finally {
      setIsUploadingResume(false);
      // Reset the file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveAttachment = () => {
    // Keep it saved (do nothing, it's already in DB)
    setShowSaveAttachmentPrompt(false);
    setNewlyUploadedResumeId(null);
  };

  const handleDontSaveAttachment = async () => {
    // Delete from DB but keep attached for this email session
    if (newlyUploadedResumeId) {
      try {
        await fetch(`/api/resume/delete?id=${newlyUploadedResumeId}`, {
          method: 'DELETE',
        });
        // Remove from the resumes list but keep selectedResumeId for this session
        setResumes(prev => prev.filter(r => r.id !== newlyUploadedResumeId));
      } catch (error) {
        console.error('Failed to delete resume:', error);
      }
    }
    setShowSaveAttachmentPrompt(false);
    setNewlyUploadedResumeId(null);
  };

  const handleAttachmentClick = () => {
    // Always show dropdown with saved attachments + upload option
    setShowResumeDropdown(!showResumeDropdown);
  };

  if (!currentPerson) return null;

  const canSend = !status && !showSuccess && !limitReached;
  const accentColor = 'bg-[var(--accent)]';
  const accentHover = 'hover:bg-[var(--accent-hover)]';

  return (
    <div className="fixed inset-0 z-50 flex bg-[#181818] animate-fade-in">
      {/* ── Left: Chat Sidebar ── */}
      <div className="hidden lg:block flex-shrink-0">
        <ChatSidebar />
      </div>

      {/* ── Right: Main area with floating compose card ── */}
      <div className="flex-1 flex items-center justify-center bg-[#212121] relative" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* Compose modal card */}
        <div className="w-full max-w-[680px] max-h-[720px] h-[85vh] bg-[#141414] rounded-xl border border-[#2a2a2a] shadow-2xl flex flex-col overflow-hidden">
          {/* Success/Failure overlays */}
          {showSuccess && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#141414]/90 rounded-xl">
              <SendSuccessAnimation />
            </div>
          )}
          {showFailure && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#141414]/90 rounded-xl">
              <SendFailureAnimation message={sendErrors?.get(currentPerson.id) || 'Failed to send email'} />
            </div>
          )}

          {/* ── Folder Tabs ── */}
          <div className="flex items-center px-5 bg-[#1a1a1a] flex-shrink-0">
            {templates && templates.length > 0 && onTemplateChange ? (
              templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedTemplateId(t.id);
                    awaitingTemplateRegenRef.current = true;
                    onTemplateChange(t.id, internalIndex);
                  }}
                  disabled={!canSend || isRegenerating}
                  className={`px-4 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 rounded-t-lg ${
                    selectedTemplateId === t.id
                      ? `${accentColor} text-white`
                      : 'bg-[#252525] text-[#888] hover:text-white hover:bg-[#303030]'
                  }`}
                >
                  {t.name}
                </button>
              ))
            ) : (
              <span className={`px-4 py-2.5 text-xs font-semibold text-white ${accentColor} rounded-t-lg`}>Default Template</span>
            )}

            <button
              onClick={() => router.push('/profile?tab=templates')}
              className="px-3 py-1.5 ml-1 text-xs font-medium text-[#aaa] hover:text-white hover:bg-[#252525] rounded-md transition-colors flex items-center gap-1"
              title="Add a new template"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add template
            </button>

            <div className="flex-1" />

            <button onClick={onClose} className="p-1 text-[#888] hover:text-white transition-colors" aria-label="Close">
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── To field ── */}
          <div className="flex items-center px-5 py-2.5 border-b border-[#2a2a2a] flex-shrink-0">
            <span className="text-[13px] text-[#888] w-14 flex-shrink-0">To</span>
            <span className="text-[13px] font-semibold text-white">
              {currentPerson.fullName}
            </span>
            {(currentPerson.role || currentPerson.company) && (
              <span className="text-xs text-[#888] ml-2">
                {currentPerson.role ? `${currentPerson.role} at ` : ''}{currentPerson.company}
              </span>
            )}
          </div>

          {/* ── Subject field ── */}
          <div className="flex items-center px-5 py-2.5 border-b border-[#2a2a2a] flex-shrink-0">
            <span className="text-[13px] text-[#888] w-14 flex-shrink-0">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => { userEditedRef.current = true; setSubject(e.target.value); }}
              placeholder="Enter subject..."
              className={`flex-1 text-[13px] text-white bg-transparent outline-none placeholder-[#3a3a3a] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none ${isRegenerating || isGeneratingDraft ? 'opacity-50' : ''}`}
            />
            {isGeneratingDraft && (
              <span className="text-[11px] text-[#888] flex items-center gap-1 flex-shrink-0">
                <LoadingDots className="text-[#888]" /> Personalizing
              </span>
            )}
          </div>

          {/* ── Email body (contentEditable) ── */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                if (!editorRef.current) return;
                userEditedRef.current = true;
                setBody(editorRef.current.innerText);
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text/plain');
                // Convert plain-text newlines to <br> elements so the editor's
                // DOM uses a single line-break primitive. Mixing raw \n text
                // chars (rendered via white-space: pre-wrap) with <br>s inserted
                // by Enter creates invisible cursor positions between adjacent
                // breaks — first Enter appears to "do nothing".
                const html = text
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\r\n/g, '\n')
                  .replace(/\n/g, '<br>');
                document.execCommand('insertHTML', false, html);
              }}
              className={`w-full min-h-[300px] text-sm text-white bg-transparent outline-none leading-[1.7] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&_a]:text-[var(--accent-text)] [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_li]:pl-1 ${isRegenerating || isGeneratingDraft ? 'opacity-50' : ''}`}
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            />
          </div>


          {/* ── Attachment (Gmail style chip) ── */}
          {selectedResumeId && (
            <div className="px-5 py-2 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center gap-2 px-3 py-2 bg-[#252525] border border-[#333] rounded-2xl hover:bg-[#2a2a2a] transition-colors group">
                  {/* File icon */}
                  <div className="w-8 h-8 rounded bg-[#ea4335] flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                    </svg>
                  </div>
                  {/* Filename */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] text-white truncate max-w-[200px]">
                      {resumes.find(r => r.id === selectedResumeId)?.filename || 'Resume attached'}
                    </span>
                  </div>
                  {/* Remove button */}
                  <button
                    onClick={() => { setSelectedResumeId(null); setShowSaveAttachmentPrompt(false); }}
                    className="p-1 text-[#888] hover:text-white hover:bg-[#333] rounded-full transition-colors ml-1"
                    title="Remove attachment"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Save to attachments prompt */}
                {showSaveAttachmentPrompt && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#888]">Save to attachments?</span>
                    <button
                      onClick={handleSaveAttachment}
                      className="px-2 py-1 text-white bg-[#333] hover:bg-[#404040] rounded transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleDontSaveAttachment}
                      className="px-2 py-1 text-[#888] hover:text-white transition-colors"
                    >
                      Just this once
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Bottom bar ── */}
          <div className="flex items-center gap-1.5 px-5 py-2.5 bg-[#1a1a1a] border-t border-[#2a2a2a] flex-shrink-0">
            {/* Hidden file input for resume upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleUploadResume}
              disabled={isUploadingResume}
              className="hidden"
            />

            {/* Attach file / resume */}
            <div className="relative" ref={resumeDropdownRef}>
              <ToolbarButton
                title={selectedResumeId ? 'Change attachment' : 'Attach file'}
                onClick={handleAttachmentClick}
                active={!!selectedResumeId}
              >
                {isUploadingResume ? (
                  <LoadingDots className="text-[#888]" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" /></svg>
                )}
              </ToolbarButton>

              {showResumeDropdown && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#1a1a1a] rounded-xl shadow-xl border border-[#333] py-1 z-10">
                  <button
                    onClick={() => { setSelectedResumeId(null); setShowResumeDropdown(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[#252525] ${!selectedResumeId ? 'text-white bg-[#252525]' : 'text-[#aaa]'}`}
                  >
                    No attachment
                  </button>
                  {resumes.map((resume) => (
                    <button
                      key={resume.id}
                      onClick={() => { setSelectedResumeId(resume.id); setShowResumeDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-[#252525] truncate ${
                        selectedResumeId === resume.id ? 'text-white bg-[#252525]' : 'text-[#aaa]'
                      }`}
                    >
                      {resume.filename}
                    </button>
                  ))}
                  <div className="border-t border-[#333] mt-1 pt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      disabled={isUploadingResume}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--accent-text)] hover:bg-[#252525] flex items-center gap-2 disabled:opacity-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {isUploadingResume ? 'Uploading...' : 'Upload new file'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Formatting tools inline */}
            <ToolbarButton title="Bold (Ctrl+B)" onClick={() => { editorRef.current?.focus(); document.execCommand('bold'); }}>
              <span className="text-xs font-bold">B</span>
            </ToolbarButton>
            <ToolbarButton title="Italic (Ctrl+I)" onClick={() => { editorRef.current?.focus(); document.execCommand('italic'); }}>
              <span className="text-xs italic">I</span>
            </ToolbarButton>
            <ToolbarButton title="Underline (Ctrl+U)" onClick={() => { editorRef.current?.focus(); document.execCommand('underline'); }}>
              <span className="text-xs underline">U</span>
            </ToolbarButton>
            <ToolbarButton title="Bulleted list" onClick={toggleBulletList}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
            </ToolbarButton>
            <div className="relative">
              <ToolbarButton title="Insert link (Ctrl+K)" onClick={() => {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
                  setLinkText(sel.toString());
                  // Get position for inline popover
                  const range = sel.getRangeAt(0);
                  const rect = range.getBoundingClientRect();
                  // Position above the selection, centered
                  setLinkPopoverPos({
                    top: rect.top - 8,
                    left: rect.left + rect.width / 2,
                  });
                } else {
                  // No selection, position near the link button
                  setLinkPopoverPos({ top: 0, left: 0 });
                }
                setShowLinkModal(true);
              }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
              </ToolbarButton>

              {/* Gmail-style inline link popover */}
              {showLinkModal && linkPopoverPos && (
                <div
                  ref={linkPopoverRef}
                  className="fixed z-[70] bg-[#1a1a1a] rounded-lg shadow-2xl border border-[#333] p-3 w-72"
                  style={{
                    top: linkPopoverPos.top,
                    left: linkPopoverPos.left,
                    transform: 'translate(-50%, -100%)',
                  }}
                >
                  <div className="space-y-2">
                    {!linkText && (
                      <input
                        type="text"
                        value={linkText}
                        onChange={(e) => setLinkText(e.target.value)}
                        placeholder="Text to display"
                        className="w-full px-2.5 py-1.5 text-xs bg-[#141414] border border-[#333] rounded text-white outline-none focus:border-[var(--accent)] placeholder-[#555]"
                      />
                    )}
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="Paste or type a link"
                        autoFocus
                        className="flex-1 px-2.5 py-1.5 text-xs bg-[#141414] border border-[#333] rounded text-white outline-none focus:border-[var(--accent)] placeholder-[#555]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            insertLink();
                            setLinkPopoverPos(null);
                          }
                          if (e.key === 'Escape') {
                            setShowLinkModal(false);
                            setLinkPopoverPos(null);
                            setLinkUrl('');
                            setLinkText('');
                          }
                        }}
                      />
                      <button
                        onClick={() => { insertLink(); setLinkPopoverPos(null); }}
                        disabled={!linkUrl}
                        className="px-3 py-1.5 text-xs text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Schedule send */}
            <ToolbarButton title="Schedule send" onClick={limitReached ? () => onLimitReached?.() : () => setShowScheduleModal(true)}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            </ToolbarButton>

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
      </div>

      {/* ── Schedule Modal ── */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-[#1A1A1A] rounded-xl shadow-2xl border border-[#252525] max-w-sm w-full p-6">
            <h3 className="text-base font-semibold text-white mb-4">Schedule send</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-white mb-2">Date & Time</label>
              <input
                type="datetime-local"
                value={scheduledDateTime}
                onChange={(e) => { setScheduledDateTime(e.target.value); setScheduleError(null); }}
                min={new Date(new Date().getTime() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                className="w-full px-3 py-2 text-sm bg-[#141414] border border-[#252525] rounded-lg text-white outline-none focus:ring-0"
              />
              <p className="mt-1 text-xs text-[#888]">Minimum: 5 minutes from now</p>
            </div>
            {scheduleError && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-lg text-sm">{scheduleError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowScheduleModal(false); setScheduledDateTime(''); setScheduleError(null); }}
                disabled={isScheduling}
                className="px-4 py-2 text-sm text-[#aaa] border border-[#252525] rounded-lg hover:bg-[#252525] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={isScheduling || !scheduledDateTime}
                className="px-4 py-2 text-sm text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
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
