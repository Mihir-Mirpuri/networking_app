'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useEmailChat } from '@/contexts/EmailChatContext';
import type { PersonInsightResponse } from '@/app/actions/person-insights';
import { getSubscriptionStatus } from '@/app/actions/subscription';

// Signal logo component
function SignalLogo({ className }: { className?: string }) {
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

// ─── Initial Greeting Component ───────────────────────────────────────────────

function InitialGreeting({ isSubscribed }: { isSubscribed: boolean | null }) {
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
  const [linkedinOpen, setLinkedinOpen] = useState(true);
  const [googleOpen, setGoogleOpen] = useState(true);

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

  // Show loading state - when actively loading OR when no insights yet (initial state)
  if (insightsLoading || (insights.length === 0 && !insightsError)) {
    return (
      <div className="px-3 py-4">
        <div className="flex gap-2 w-fit">
          <div className="w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
            <SignalLogo className="w-3 h-3 text-white" />
          </div>
          <div className={`w-fit rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
            <TypingIndicator />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-4">
      <div className="flex gap-2">
        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
          <SignalLogo className="w-3 h-3 text-white" />
        </div>
        <div className={`flex-1 rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
          <p className="mb-2">Here&apos;s what I found on {firstName}:</p>

          {/* Insights content */}
          {insightsError ? (
            <div className="flex items-center gap-2 py-1">
              <span className="text-xs text-white/70">{insightsError}</span>
              {currentPersonId && (
                <button
                  onClick={() => fetchInsights(currentPersonId)}
                  className="text-xs text-white/90 hover:text-white underline transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          ) : insights.length === 0 ? (
            <p className="text-xs text-white/70 py-1">No additional info found</p>
          ) : (
            <div className="space-y-1">
              {/* LinkedIn section */}
              {linkedinInsights.length > 0 && (
                <div className="rounded-lg bg-black/20 overflow-hidden">
                  <button
                    onClick={() => setLinkedinOpen(!linkedinOpen)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-black/10 transition-colors"
                  >
                    {linkedinIcon}
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
                    <div className="px-2 pb-2 space-y-0.5">
                      {linkedinInsights.map((insight) => (
                        <div
                          key={insight.id}
                          onClick={() => toggleInsight(insight.id)}
                          className={`flex items-start gap-2 px-2 py-1 rounded cursor-pointer transition-colors hover:bg-black/20 ${
                            selectedInsightIds.has(insight.id) ? 'bg-black/30' : ''
                          }`}
                        >
                          <div className={`flex-shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                            selectedInsightIds.has(insight.id)
                              ? 'bg-white border-white'
                              : 'border-white/50 hover:border-white'
                          }`}>
                            {selectedInsightIds.has(insight.id) && (
                              <svg className="w-2.5 h-2.5 text-[#2563EB]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                          <span className="text-xs text-white/90 leading-relaxed">{insight.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Google section */}
              {googleInsights.length > 0 && (
                <div className="rounded-lg bg-black/20 overflow-hidden">
                  <button
                    onClick={() => setGoogleOpen(!googleOpen)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-black/10 transition-colors"
                  >
                    {googleIcon}
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
                    <div className="px-2 pb-2 space-y-0.5">
                      {googleInsights.map((insight) => (
                        <div
                          key={insight.id}
                          onClick={() => toggleInsight(insight.id)}
                          className={`flex items-start gap-2 px-2 py-1 rounded cursor-pointer transition-colors hover:bg-black/20 ${
                            selectedInsightIds.has(insight.id) ? 'bg-black/30' : ''
                          }`}
                        >
                          <div className={`flex-shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                            selectedInsightIds.has(insight.id)
                              ? 'bg-white border-white'
                              : 'border-white/50 hover:border-white'
                          }`}>
                            {selectedInsightIds.has(insight.id) && (
                              <svg className="w-2.5 h-2.5 text-[#22C55E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                          <span className="text-xs text-white/90 leading-relaxed">{insight.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Apply button */}
              {selectedCount > 0 && (
                <button
                  onClick={handleApply}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 mt-2 text-xs font-medium bg-white/20 text-white rounded-lg hover:bg-white/30 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  Apply {selectedCount} insight{selectedCount !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function EmailChatPanel() {
  const { data: session } = useSession();
  const {
    messages,
    isProcessing,
    sendMessage,
    clearMessages,
  } = useEmailChat();

  const [inputValue, setInputValue] = useState('');
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);

  // Fetch subscription status
  useEffect(() => {
    getSubscriptionStatus().then((status) => {
      setIsSubscribed(status.isSubscribed ?? false);
    });
  }, []);
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

  // Auto-resize textarea based on content
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
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
      {/* New session button */}
      {messages.length > 0 && (
        <div className="flex justify-end px-3 pt-2">
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
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {/* Initial greeting with insights - always shown at top */}
        <InitialGreeting isSubscribed={isSubscribed} />

        {/* Chat messages */}
        {messages.length > 0 && (
          <div className="px-3 py-4 space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'user' ? (
                  // User message - right-aligned with bubble and profile image
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="rounded-2xl px-3 py-2 bg-[#2a2a2a] text-white rounded-br-md">
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1 overflow-hidden">
                      {session?.user?.image ? (
                        <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                      )}
                    </div>
                  </div>
                ) : (
                  // AI message - left-aligned with bubble and Signal logo
                  // Blue for premium (like iMessage), green for free (like SMS), neutral while loading
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
                      <SignalLogo className="w-3 h-3 text-white" />
                    </div>
                    <div className={`rounded-2xl px-3 py-2 text-white rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
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
                    <SignalLogo className="w-3 h-3 text-white" />
                  </div>
                  <div className={`rounded-2xl px-3 py-2 rounded-bl-md ${isSubscribed === null ? 'bg-[#2a2a2a]' : isSubscribed ? 'bg-[#2563EB]' : 'bg-[#22C55E]'}`}>
                    <TypingIndicator />
                  </div>
                </div>
              </div>
            )}

            {/* Auto-scroll anchor */}
            <div ref={chatEndRef} />
          </div>
        )}

      </div>

      {/* Input area */}
      <div className="p-3 border-t border-[#1a1a1a]">
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
            rows={1}
            className="w-full px-3 pr-10 py-2.5 text-sm bg-transparent border-none text-white placeholder-[#505050] focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
            style={{ maxHeight: '80px' }}
          />
          <button
            onClick={handleSubmit}
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
