'use client';

import { useState, useEffect, useRef } from 'react';
import { OutreachTrackerEntry, ThreadMessage, getThreadMessages } from '@/app/actions/outreach';
import { generateFollowUpFromThreadAction } from '@/app/actions/personalize';
import { sendFollowUpAction } from '@/app/actions/send';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { useEmailChat } from '@/contexts/EmailChatContext';
import type { PersonInsightResponse } from '@/app/actions/person-insights';
import { getSubscriptionStatus } from '@/app/actions/subscription';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';

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

// ─── Toolbar Helpers ─────────────────────────────────────────────────────────

function ToolbarButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
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
  isSubscribed: boolean | null;
  selectedInsightIds: Set<string>;
  onSelectInsight: (insight: PersonInsightResponse) => void;
}

function InsightsChatMessage({ insights, personName, isSubscribed, selectedInsightIds, onSelectInsight }: InsightsChatMessageProps) {
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
      <div className={`min-w-0 rounded-2xl px-3 py-2 rounded-bl-md space-y-2.5 text-sm text-white ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}`}>
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

        <p className="text-sm text-white leading-relaxed">How would you like to edit the follow-up?</p>
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
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [selectedInsights, setSelectedInsights] = useState<PersonInsightResponse[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedInsightIds = new Set(selectedInsights.map(i => i.id));

  useEffect(() => {
    getSubscriptionStatus().then((status) => {
      setIsSubscribed(status.isSubscribed ?? false);
    });
  }, []);

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
          <div className="flex gap-2 w-full">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
              <SignalLogoSmall className="w-3 h-3 text-white" />
            </div>
            <div className={`flex-1 rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}`}>
              <TypingIndicator />
            </div>
          </div>
        ) : insights.length > 0 && currentPersonName ? (
          <InsightsChatMessage
            insights={insights}
            personName={currentPersonName}
            isSubscribed={isSubscribed}
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
                <div className={`rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}`}>
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
              <div className={`rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#3b66f5]' : 'bg-[#22C55E]'}`}>
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
                className="flex items-start gap-1 px-2 py-1 bg-[#3b66f5] rounded-lg text-xs text-white"
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
            placeholder="Ask me to edit this follow-up..."
            disabled={isProcessing}
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

// ─── Thread Message Component ────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  }
  return email[0].toUpperCase();
}

interface ThreadMessageItemProps {
  message: ThreadMessage;
  isExpanded: boolean;
  onToggle: () => void;
  contactName: string | null;
  contactEmail: string;
}

function ThreadMessageItem({ message, isExpanded, onToggle, contactName, contactEmail }: ThreadMessageItemProps) {
  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const formatSender = (sender: string) => {
    const match = sender.match(/^(.+?)\s*<(.+)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    return { name: sender, email: sender };
  };

  const sender = formatSender(message.sender);
  const isYou = message.direction === 'SENT';
  const initials = isYou ? 'Y' : getInitials(sender.name, sender.email);

  return (
    <div className="border-b border-[#2a2a2a] last:border-b-0">
      {/* Collapsed header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
        onClick={onToggle}
      >
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
          isYou ? 'bg-[#2563EB] text-white' : 'bg-[#505050] text-white'
        }`}>
          {initials}
        </div>

        {/* Sender info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {isYou ? 'me' : sender.name}
            </span>
            {!isExpanded && (
              <span className="text-xs text-[#888] truncate flex-1">
                — {(message.bodyText || '').slice(0, 60)}...
              </span>
            )}
          </div>
        </div>

        {/* Date */}
        <span className="text-xs text-[#888] flex-shrink-0">
          {formatDate(message.receivedAt)}
        </span>

        {/* Expand/collapse */}
        <svg
          className={`w-4 h-4 text-[#505050] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-3 pl-[60px]">
          <p className="text-xs text-[#888] mb-2">
            to {isYou ? contactName || contactEmail : 'me'}
          </p>
          {message.bodyHtml ? (
            <div
              className="text-sm text-white prose prose-sm prose-invert max-w-none leading-relaxed"
              dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
            />
          ) : (
            <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
              {message.bodyText || '(No content)'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ExpandedHistoryReviewProps {
  tracker: OutreachTrackerEntry;
  onClose: () => void;
}

export function ExpandedHistoryReview({
  tracker,
  onClose,
}: ExpandedHistoryReviewProps) {
  // Thread state
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  // Follow-up compose state
  const [followUpSubject, setFollowUpSubject] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Other state
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [showResumeDropdown, setShowResumeDropdown] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const resumeDropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  const userEditedRef = useRef(false);
  const { openEmailChat, closeEmailChat, currentEmail, updateEmail } = useEmailChat();
  const isPushingToContextRef = useRef(false);

  // Fetch thread messages
  useEffect(() => {
    if (tracker.gmailThreadId) {
      setIsLoadingThread(true);
      setThreadError(null);
      getThreadMessages(tracker.gmailThreadId).then((result) => {
        if (result.success) {
          setThreadMessages(result.messages);
          // Collapse all messages by default
          setExpandedMessages(new Set());
        } else {
          setThreadError(result.error);
        }
        setIsLoadingThread(false);
      });
    }
  }, [tracker.gmailThreadId]);

  // Auto-generate follow-up when thread loads
  useEffect(() => {
    if (tracker.gmailThreadId && threadMessages.length > 0 && !followUpBody && !isGenerating) {
      handleGenerateFollowUp();
    }
  }, [tracker.gmailThreadId, threadMessages.length]);

  // Fetch subscription status
  useEffect(() => {
    getSubscriptionStatus().then((status) => {
      setIsSubscribed(status.isSubscribed ?? false);
    });
  }, []);

  // Fetch resumes on mount
  useEffect(() => {
    getResumesAction().then((result) => {
      if (result.success) setResumes(result.resumes);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (resumeDropdownRef.current && !resumeDropdownRef.current.contains(e.target as Node)) {
        setShowResumeDropdown(false);
      }
    };
    if (showResumeDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResumeDropdown]);

  // Open email chat when component mounts
  useEffect(() => {
    if (tracker) {
      openEmailChat(tracker.id, tracker.contactName || tracker.contactEmail, followUpSubject, followUpBody);
    }
  }, [tracker.id, openEmailChat]);

  // Sync local edits → context
  useEffect(() => {
    if (tracker && followUpSubject && followUpBody) {
      isPushingToContextRef.current = true;
      updateEmail(followUpSubject, followUpBody);
      requestAnimationFrame(() => { isPushingToContextRef.current = false; });
    }
  }, [followUpSubject, followUpBody]);

  // Sync context → local (when AI refines)
  useEffect(() => {
    if (isPushingToContextRef.current) return;
    if (currentEmail && tracker) {
      if (currentEmail.subject !== followUpSubject || currentEmail.body !== followUpBody) {
        setFollowUpSubject(currentEmail.subject);
        setFollowUpBody(currentEmail.body);
        userEditedRef.current = true;
      }
    }
  }, [currentEmail]);

  useEffect(() => {
    return () => { closeEmailChat(); };
  }, [closeEmailChat]);

  // Sync body state into the contentEditable editor
  const editorBodyRef = useRef(followUpBody);
  useEffect(() => {
    if (editorRef.current && followUpBody !== editorBodyRef.current) {
      editorRef.current.innerHTML = followUpBody.replace(/\n/g, '<br>');
      editorBodyRef.current = followUpBody;
    }
  }, [followUpBody]);

  // Keep editorBodyRef in sync when the user types
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handler = () => {
      editorBodyRef.current = editor.innerText;
    };
    editor.addEventListener('input', handler);
    return () => editor.removeEventListener('input', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isSending && followUpBody.trim()) {
          handleSendFollowUp();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSending, followUpBody]);

  const handleGenerateFollowUp = async () => {
    if (!tracker.gmailThreadId) return;

    setIsGenerating(true);
    setSendError(null);

    try {
      const result = await generateFollowUpFromThreadAction(tracker.gmailThreadId);
      if (result.success && result.subject && result.body) {
        setFollowUpSubject(result.subject);
        setFollowUpBody(result.body);
      } else {
        setSendError(result.error || 'Failed to generate follow-up');
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to generate follow-up');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendFollowUp = async () => {
    if (!tracker.gmailThreadId || !followUpBody.trim()) return;

    setIsSending(true);
    setSendError(null);

    try {
      const result = await sendFollowUpAction({
        toEmail: tracker.contactEmail,
        subject: followUpSubject,
        body: followUpBody,
        threadId: tracker.gmailThreadId,
        userCandidateId: tracker.userCandidateId || '',
        resumeId: selectedResumeId || undefined,
      });

      if (result.success) {
        dispatchCreditsChanged();
        setSendSuccess(true);
        // Refresh thread messages
        const threadResult = await getThreadMessages(tracker.gmailThreadId);
        if (threadResult.success) {
          setThreadMessages(threadResult.messages);
        }
        // Clear compose area
        setFollowUpSubject('');
        setFollowUpBody('');
        // Auto-close after a delay
        setTimeout(() => {
          onClose();
        }, 1500);
      } else if (result.error === 'LIMIT_REACHED') {
        setShowLimitModal(true);
      } else {
        setSendError(result.error || 'Failed to send follow-up');
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send follow-up');
    } finally {
      setIsSending(false);
    }
  };

  const toggleMessage = (messageId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const insertLink = () => {
    if (!linkUrl) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
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
    if (editor) setFollowUpBody(editor.innerText);
    setShowLinkModal(false);
    setLinkUrl('');
    setLinkText('');
    savedSelectionRef.current = null;
  };

  const accentColor = isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]';
  const accentHover = isSubscribed === null ? 'hover:bg-[#333]' : isSubscribed ? 'hover:bg-[#1d4ed8]' : 'hover:bg-[#16a34a]';

  return (
    <div className="fixed inset-0 z-50 flex bg-[#181818] animate-fade-in">
      {/* ── Left: Chat Sidebar ── */}
      <div className="hidden lg:block flex-shrink-0">
        <ChatSidebar />
      </div>

      {/* ── Right: Main area with floating compose card ── */}
      <div className="flex-1 flex items-center justify-center bg-[#212121] relative" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* Compose modal card */}
        <div className="w-full max-w-[680px] max-h-[720px] h-[85vh] bg-[#141414] rounded-xl border border-[#2a2a2a] shadow-2xl flex flex-col overflow-hidden">

          {/* Success overlay */}
          {sendSuccess && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#141414]/90 rounded-xl">
              <div className="flex flex-col items-center justify-center py-6 animate-fade-in">
                <svg className="w-16 h-16" viewBox="0 0 52 52">
                  <circle className="draw-check-circle" cx="26" cy="26" r="25" fill="none" stroke="#10b981" strokeWidth="2" />
                  <path className="draw-check-mark" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                </svg>
                <p className="mt-3 text-sm font-medium text-emerald-400">Follow-up sent!</p>
              </div>
            </div>
          )}

          {/* ── Header ── */}
          <div className="flex items-center px-5 bg-[#1a1a1a] flex-shrink-0">
            <span className={`px-4 py-2.5 text-xs font-semibold text-white ${accentColor} rounded-t-lg`}>
              Follow Up
            </span>
            <span className="px-3 py-2.5 text-xs text-[#888]">
              {threadMessages.length} {threadMessages.length === 1 ? 'message' : 'messages'} in thread
            </span>

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
              {tracker.contactName || tracker.contactEmail}
            </span>
            {(tracker.role || tracker.company) && (
              <span className="text-xs text-[#888] ml-2">
                {tracker.role ? `${tracker.role} at ` : ''}{tracker.company}
              </span>
            )}
          </div>

          {/* ── Thread Messages (collapsed) ── */}
          {isLoadingThread ? (
            <div className="flex items-center justify-center py-6 border-b border-[#2a2a2a]">
              <LoadingSpinner size="sm" />
              <span className="ml-2 text-sm text-[#888]">Loading conversation...</span>
            </div>
          ) : threadError ? (
            <div className="px-5 py-4 border-b border-[#2a2a2a]">
              <p className="text-sm text-red-400">{threadError}</p>
            </div>
          ) : threadMessages.length > 0 ? (
            <div className="border-b border-[#2a2a2a] max-h-[200px] overflow-y-auto bg-[#0f0f0f]">
              {threadMessages.map((message) => (
                <ThreadMessageItem
                  key={message.messageId}
                  message={message}
                  isExpanded={expandedMessages.has(message.messageId)}
                  onToggle={() => toggleMessage(message.messageId)}
                  contactName={tracker.contactName}
                  contactEmail={tracker.contactEmail}
                />
              ))}
            </div>
          ) : null}

          {/* ── Subject field ── */}
          <div className="flex items-center px-5 py-2.5 border-b border-[#2a2a2a] flex-shrink-0">
            <span className="text-[13px] text-[#888] w-14 flex-shrink-0">Subject</span>
            <input
              type="text"
              value={followUpSubject}
              onChange={(e) => { userEditedRef.current = true; setFollowUpSubject(e.target.value); }}
              placeholder="Re: ..."
              className={`flex-1 text-[13px] text-white bg-transparent outline-none placeholder-[#3a3a3a] focus:ring-0 ${isGenerating ? 'opacity-50' : ''}`}
            />
            {isGenerating && (
              <span className="text-[11px] text-[#888] flex items-center gap-1 flex-shrink-0">
                <LoadingSpinner size="sm" /> Generating...
              </span>
            )}
          </div>

          {/* ── Follow-up body (contentEditable) ── */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                userEditedRef.current = true;
                if (editorRef.current) setFollowUpBody(editorRef.current.innerText);
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
              }}
              className={`w-full min-h-[150px] text-sm text-white bg-transparent outline-none leading-[1.7] focus:ring-0 [&_a]:text-[#6364FF] [&_a]:underline ${isGenerating ? 'opacity-50' : ''}`}
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            />
          </div>

          {/* Error message */}
          {sendError && (
            <div className="px-5 py-2 bg-red-900/20 border-t border-red-900/30">
              <p className="text-sm text-red-400">{sendError}</p>
            </div>
          )}

          {/* ── Attachment (Gmail style) ── */}
          {selectedResumeId && (
            <div className="px-5 py-2 flex-shrink-0 border-t border-[#2a2a2a]">
              <div className="flex items-center gap-1">
                <span className="text-[13px] text-[#6364FF]">
                  {resumes.find(r => r.id === selectedResumeId)?.filename || 'Resume attached'}
                </span>
                <div className="flex-1" />
                <button onClick={() => setSelectedResumeId(null)} className="text-[#888] hover:text-white transition-colors">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ── Bottom bar ── */}
          <div className="flex items-center gap-1.5 px-5 py-2.5 bg-[#1a1a1a] border-t border-[#2a2a2a] flex-shrink-0">
            {/* Regenerate */}
            <ToolbarButton title="Regenerate follow-up" onClick={handleGenerateFollowUp}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </ToolbarButton>

            {/* Attach file / resume */}
            <div className="relative" ref={resumeDropdownRef}>
              <ToolbarButton
                title={selectedResumeId ? 'Change attachment' : 'Attach file'}
                onClick={() => setShowResumeDropdown(!showResumeDropdown)}
                active={!!selectedResumeId}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" /></svg>
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
                      {resume.isActive && <span className="text-[#6364FF] ml-1">(Active)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Formatting tools */}
            <ToolbarButton title="Bold (Ctrl+B)" onClick={() => document.execCommand('bold')}>
              <span className="text-xs font-bold">B</span>
            </ToolbarButton>
            <ToolbarButton title="Italic (Ctrl+I)" onClick={() => document.execCommand('italic')}>
              <span className="text-xs italic">I</span>
            </ToolbarButton>
            <ToolbarButton title="Underline (Ctrl+U)" onClick={() => document.execCommand('underline')}>
              <span className="text-xs underline">U</span>
            </ToolbarButton>
            <ToolbarButton title="Insert link (Ctrl+K)" onClick={() => {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
                setLinkText(sel.toString());
              }
              setShowLinkModal(true);
            }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
            </ToolbarButton>

            <div className="flex-1" />

            {/* Send Follow-Up button */}
            <button
              onClick={handleSendFollowUp}
              disabled={isSending || isGenerating || !followUpBody.trim()}
              className={`px-5 py-2 rounded-full ${accentColor} ${accentHover} text-white text-xs font-semibold disabled:opacity-50 transition-colors flex items-center gap-2`}
            >
              {isSending ? (
                <>
                  <LoadingSpinner size="sm" />
                  Sending...
                </>
              ) : (
                'Send Follow-Up'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Insert Link Modal ── */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-[#1a1a1a] rounded-xl shadow-2xl border border-[#333] max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Insert link</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#888] mb-1">Text to display</label>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="Link text"
                  className="w-full px-3 py-2 text-sm bg-[#141414] border border-[#333] rounded-lg text-white outline-none focus:ring-0 focus:border-[#6364FF] placeholder-[#555]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#888] mb-1">URL</label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://"
                  autoFocus
                  className="w-full px-3 py-2 text-sm bg-[#141414] border border-[#333] rounded-lg text-white outline-none focus:ring-0 focus:border-[#6364FF] placeholder-[#555]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      insertLink();
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => { setShowLinkModal(false); setLinkUrl(''); setLinkText(''); }}
                className="px-4 py-2 text-sm text-[#aaa] border border-[#333] rounded-lg hover:bg-[#252525] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={insertLink}
                disabled={!linkUrl}
                className="px-4 py-2 text-sm text-white bg-[#6364FF] rounded-lg hover:bg-[#5354EE] disabled:opacity-50 transition-colors"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Limit Reached Modal */}
      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={() => {
          setShowLimitModal(false);
          dispatchCreditsChanged();
        }}
      />
    </div>
  );
}
