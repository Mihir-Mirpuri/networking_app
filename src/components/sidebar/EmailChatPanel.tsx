'use client';

import { useState, useRef, useEffect } from 'react';
import { useEmailChat } from '@/contexts/EmailChatContext';

// ─── Source badge colors ──────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  linkedin: { bg: 'bg-[#0A66C2]/20', text: 'text-[#4A9FE5]' },
  google: { bg: 'bg-[#4285f4]/20', text: 'text-[#7EB1F7]' },
  website: { bg: 'bg-[#808080]/20', text: 'text-[#909090]' },
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

  const [collapsed, setCollapsed] = useState(false);

  const selectedCount = selectedInsightIds.size;

  // Don't render if no insights and not loading
  if (!insightsLoading && insights.length === 0 && !insightsError) {
    return null;
  }

  const firstName = currentPersonName?.split(' ')[0] || 'them';

  const handleApply = () => {
    if (selectedCount === 0 || isProcessing) return;
    sendMessage('Incorporate the selected insights naturally into the email');
  };

  return (
    <div className="border-b border-[#252525]">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#1a1a1a] transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 text-[#606060] transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-xs font-medium text-[#808080]">About {firstName}</span>
          {selectedCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#0b57d0]/20 text-[#7EB1F7] rounded-full">
              {selectedCount}
            </span>
          )}
        </div>
        {insightsLoading && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-[#404040] rounded-full animate-pulse" />
            <span className="text-[10px] text-[#404040]">loading</span>
          </div>
        )}
      </button>

      {/* Content */}
      {!collapsed && (
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
          ) : (
            <>
              {/* Insight rows */}
              <div className="space-y-0.5 px-1">
                {insights.map((insight) => {
                  const isSelected = selectedInsightIds.has(insight.id);
                  const sourceStyle = SOURCE_COLORS[insight.source] || SOURCE_COLORS.database;

                  return (
                    <div key={insight.id} className="flex items-start gap-2">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleInsight(insight.id)}
                        className="flex-shrink-0 mt-2 ml-2"
                      >
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
                      </button>

                      {/* Clickable content — links to source URL or just toggles selection */}
                      {insight.sourceUrl ? (
                        <a
                          href={insight.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex-1 min-w-0 px-1 py-1.5 rounded-md text-left transition-colors hover:bg-[#1a1a1a]/50 ${
                            isSelected ? 'bg-[#1a1a1a]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs leading-relaxed ${isSelected ? 'text-[#c0c0c0]' : 'text-[#808080]'}`}>
                              {insight.label}
                            </span>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              insight.confidence === 'high' ? 'bg-emerald-500' : 'bg-yellow-500'
                            }`} />
                          </div>
                          <p className="text-[11px] text-[#505050] leading-relaxed mt-0.5">{insight.detail}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`px-1.5 py-0.5 text-[9px] rounded ${sourceStyle.bg} ${sourceStyle.text}`}>
                              {insight.source}
                            </span>
                            <svg className="w-3 h-3 text-[#505050]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </div>
                        </a>
                      ) : (
                        <button
                          onClick={() => toggleInsight(insight.id)}
                          className={`flex-1 min-w-0 px-1 py-1.5 rounded-md text-left transition-colors hover:bg-[#1a1a1a]/50 ${
                            isSelected ? 'bg-[#1a1a1a]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs leading-relaxed ${isSelected ? 'text-[#c0c0c0]' : 'text-[#808080]'}`}>
                              {insight.label}
                            </span>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              insight.confidence === 'high' ? 'bg-emerald-500' : 'bg-yellow-500'
                            }`} />
                          </div>
                          <p className="text-[11px] text-[#505050] leading-relaxed mt-0.5">{insight.detail}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`px-1.5 py-0.5 text-[9px] rounded ${sourceStyle.bg} ${sourceStyle.text}`}>
                              {insight.source}
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

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
      )}
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
            <p className="text-sm text-[#606060] mb-2">How can I help with this email?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {['Make it shorter', 'More professional', 'Add a hook'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 text-xs text-[#606060] border border-[#303030] rounded-full hover:border-[#404040] hover:text-[#808080] transition-colors"
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
                      <p className="text-sm text-[#c0c0c0] whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  // AI message - left-aligned with subtle styling
                  <div className="flex gap-2">
                    <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-[#606060]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#909090] whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                  <svg className="w-3 h-3 text-[#606060]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              className="w-full px-3 py-2.5 pr-10 text-sm bg-[#1a1a1a] border border-[#303030] rounded-lg text-[#c0c0c0] placeholder:text-[#404040] focus:outline-none focus:ring-0 focus:border-[#303030] disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[#404040] hover:text-[#808080] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
