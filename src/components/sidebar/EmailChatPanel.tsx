'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useEmailChat } from '@/contexts/EmailChatContext';
import type { PersonInsightResponse } from '@/app/actions/person-insights';

// ─── Source badge colors ──────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  linkedin: { bg: 'bg-[#0A66C2]/20', text: 'text-[#4A9FE5]' },
  google: { bg: 'bg-[#4285f4]/20', text: 'text-[#7EB1F7]' },
  website: { bg: 'bg-[#808080]/20', text: 'text-white' },
  database: { bg: 'bg-[#10b981]/20', text: 'text-[#34d399]' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[#252525] animate-pulse flex-shrink-0" />
          <div className="flex-1 h-4 rounded bg-[#252525] animate-pulse" style={{ width: `${60 + i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

// ─── Insight Row Component ─────────────────────────────────────────────────────

interface InsightRowProps {
  insight: PersonInsightResponse;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}

function InsightRow({ insight, isSelected, isExpanded, onToggleSelect, onToggleExpand }: InsightRowProps) {
  const [isRowHovered, setIsRowHovered] = useState(false);
  const [isTitleHovered, setIsTitleHovered] = useState(false);
  const showDetail = isExpanded || isRowHovered;
  const hasLink = !!insight.sourceUrl;

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking the title link
    if ((e.target as HTMLElement).closest('[data-title-link]')) {
      return;
    }
    onToggleSelect();
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    if (hasLink && insight.sourceUrl) {
      e.stopPropagation();
      window.open(insight.sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className={`flex items-start gap-2 cursor-pointer rounded-md transition-colors hover:bg-[#1a1a1a]/50 ${
        isSelected ? 'bg-[#1a1a1a]' : ''
      }`}
      onClick={handleRowClick}
      onMouseEnter={() => setIsRowHovered(true)}
      onMouseLeave={() => setIsRowHovered(false)}
    >
      {/* Checkbox */}
      <div className="flex-shrink-0 mt-1.5 ml-2">
        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          isSelected
            ? 'bg-[#0b57d0] border-[#0b57d0]'
            : 'border-[#404040] hover:border-[#606060]'
        }`}>
          {isSelected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 px-1 py-1">
        {/* Title row with confidence dot */}
        <div className="flex items-center gap-1.5">
          {/* Title + link icon as one clickable unit */}
          {hasLink ? (
            <button
              data-title-link
              onClick={handleTitleClick}
              onMouseEnter={() => setIsTitleHovered(true)}
              onMouseLeave={() => setIsTitleHovered(false)}
              className="flex items-center gap-1 text-left"
            >
              <span className={`text-xs leading-relaxed transition-all ${
                isSelected ? 'text-white' : 'text-white'
              } ${isTitleHovered ? 'underline text-white' : ''}`}>
                {insight.label}
              </span>
              <svg className={`w-3 h-3 flex-shrink-0 transition-colors ${isTitleHovered ? 'text-white' : 'text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </button>
          ) : (
            <span className={`text-xs leading-relaxed ${isSelected ? 'text-white' : 'text-white'}`}>
              {insight.label}
            </span>
          )}
        </div>

        {/* Detail - shown on hover of the row */}
        {showDetail && (
          <p className="text-[11px] text-white leading-relaxed mt-0.5">{insight.detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Collapsible Section Component ─────────────────────────────────────────────

interface InsightSectionGroupProps {
  title: string;
  icon: React.ReactNode;
  insights: PersonInsightResponse[];
  selectedInsightIds: Set<string>;
  expandedInsightIds: Set<string>;
  onToggleInsight: (id: string) => void;
  onToggleExpand: (id: string) => void;
  defaultOpen?: boolean;
}

function InsightSectionGroup({
  title,
  icon,
  insights,
  selectedInsightIds,
  expandedInsightIds,
  onToggleInsight,
  onToggleExpand,
  defaultOpen = true,
}: InsightSectionGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (insights.length === 0) return null;

  return (
    <div className="border-b border-[#1a1a1a] last:border-b-0">
      {/* Section header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1a1a]/30 transition-colors"
      >
        {icon}
        <span className="text-xs font-medium text-white">{title}</span>
        <span className="text-[10px] text-white">({insights.length})</span>
        <svg
          className={`w-3 h-3 text-white ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Section content */}
      {isOpen && (
        <div className="space-y-0.5 pb-2">
          {insights.map((insight) => (
            <InsightRow
              key={insight.id}
              insight={insight}
              isSelected={selectedInsightIds.has(insight.id)}
              isExpanded={expandedInsightIds.has(insight.id)}
              onToggleSelect={() => onToggleInsight(insight.id)}
              onToggleExpand={() => onToggleExpand(insight.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Insights Section ─────────────────────────────────────────────────────

export function InsightsSection() {
  const {
    insights,
    selectedInsightIds,
    insightsLoading,
    insightsError,
    toggleInsight,
    sendMessage,
    isProcessing,
    fetchInsights,
    currentPersonId,
    currentPersonName,
  } = useEmailChat();

  const [expandedInsightIds, setExpandedInsightIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedInsightIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Group insights by source
  const { linkedinInsights, googleInsights } = useMemo(() => {
    const linkedin: PersonInsightResponse[] = [];
    const google: PersonInsightResponse[] = [];

    for (const insight of insights) {
      if (insight.source === 'linkedin' || insight.source === 'database') {
        linkedin.push(insight);
      } else {
        // google, website go here
        google.push(insight);
      }
    }

    return { linkedinInsights: linkedin, googleInsights: google };
  }, [insights]);

  const selectedCount = selectedInsightIds.size;
  const firstName = currentPersonName?.split(' ')[0] || 'them';

  const handleApply = () => {
    if (selectedCount === 0 || isProcessing) return;
    sendMessage('Incorporate the selected insights naturally into the email');
  };

  // LinkedIn icon
  const linkedinIcon = (
    <svg className="w-3.5 h-3.5 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );

  // Google icon
  const googleIcon = (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );

  return (
    <div className="border-b border-[#252525]">
      {/* Header */}
      <div className="flex items-center justify-center gap-2 px-3 py-3">
        <span className="text-sm font-semibold text-white">About {firstName}</span>
        {selectedCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#0b57d0]/20 text-[#7EB1F7] rounded-full">
            {selectedCount}
          </span>
        )}
        {insightsLoading && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-[#404040] rounded-full animate-pulse" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="pb-2">
        {insightsLoading && insights.length === 0 ? (
          <InsightsSkeleton />
        ) : insightsError ? (
          <div className="px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-[#666]">{insightsError}</span>
            {currentPersonId && (
              <button
                onClick={() => fetchInsights(currentPersonId)}
                className="text-xs text-[#7EB1F7] hover:text-[#4A9FE5] transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        ) : insights.length === 0 ? (
          <div className="px-3 py-2">
            <span className="text-xs text-white">No additional info found</span>
          </div>
        ) : (
          <>
            {/* LinkedIn section */}
            <InsightSectionGroup
              title="From LinkedIn"
              icon={linkedinIcon}
              insights={linkedinInsights}
              selectedInsightIds={selectedInsightIds}
              expandedInsightIds={expandedInsightIds}
              onToggleInsight={toggleInsight}
              onToggleExpand={toggleExpand}
              defaultOpen={true}
            />

            {/* Google section */}
            <InsightSectionGroup
              title="From Google"
              icon={googleIcon}
              insights={googleInsights}
              selectedInsightIds={selectedInsightIds}
              expandedInsightIds={expandedInsightIds}
              onToggleInsight={toggleInsight}
              onToggleExpand={toggleExpand}
              defaultOpen={true}
            />

            {/* Apply button */}
            {selectedCount > 0 && (
              <div className="px-3 pt-2">
                <button
                  onClick={handleApply}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0b57d0]/15 text-[#7EB1F7] rounded-md hover:bg-[#0b57d0]/25 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  Apply {selectedCount} insight{selectedCount !== 1 ? 's' : ''} to email
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function EmailChatPanel() {
  const {
    messages,
    isProcessing,
    sendMessage,
  } = useEmailChat();

  const [inputValue, setInputValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const message = inputValue.trim();
    if (!message || isProcessing) return;

    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#141414]">
      {/* Insights section */}
      <InsightsSection />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-white mb-2">How can I help with this email?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {['Make it shorter', 'More professional', 'Add a hook'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 text-xs text-white border border-[#303030] rounded-full hover:border-[#404040] hover:text-white transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.length > 0 && (
          <div className="px-4 py-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === 'user' ? (
                  // User message - minimal, right-aligned text
                  <div className="flex justify-end">
                    <div className="max-w-[90%] text-right">
                      <p className="text-sm text-white whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  // AI message - left-aligned with subtle styling
                  <div className="flex gap-2">
                    <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                </div>
                <TypingIndicator />
              </div>
            )}

            {/* Auto-scroll anchor */}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area - Cursor style */}
      <div className="p-3 border-t border-[#252525]">
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              disabled={isProcessing}
              rows={1}
              className="w-full px-3 py-2.5 pr-10 text-sm bg-[#1a1a1a] border border-[#303030] rounded-lg text-white placeholder:text-[#404040] focus:outline-none focus:ring-0 focus:border-[#303030] disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[#404040] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
