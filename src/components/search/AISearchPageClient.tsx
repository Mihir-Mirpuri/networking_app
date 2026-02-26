'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { BulkReview } from './BulkReview';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchLoadingState } from './SearchLoadingState';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { HiddenPeopleBar } from './HiddenPeopleBar';
import { searchPeopleAction, SearchResultWithDraft } from '@/app/actions/search';
import { extractSearchFiltersAction, ParsedFilters, ChatMessage } from '@/app/actions/ai-search';
import { useSearchResults } from '@/hooks/useSearchResults';

interface AISearchPageClientProps {
  initialRemainingDaily: number;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filters?: ParsedFilters;
  isLoading?: boolean;
}

// Storage key for sessionStorage
const AI_STORAGE_KEY = 'signl_aiSearchState';
const AI_STORAGE_VERSION = 1;

interface AISearchPageState {
  version: number;
  messages: DisplayMessage[];
  currentFilters: ParsedFilters;
  results: SearchResultWithDraft[];
  expandedIndex: number | null;
  sendStatuses: Array<[string, 'success' | 'failed' | 'pending']>;
  showBulkReview: boolean;
  generatingStatuses: Array<[string, boolean]>;
  totalLoaded?: number;
  hasMore?: boolean;
  hiddenCount?: number;
  searchParams?: { company?: string; role?: string; university?: string; location?: string; limit: number };
  savedAt: number;
}

const EXAMPLE_QUERIES = [
  'Product managers at Google in Austin',
  'Software engineers at Meta from Stanford',
  'Analysts at Goldman Sachs in New York',
  'Consultants at McKinsey from UT Austin',
];

export function AISearchPageClient({ initialRemainingDaily }: AISearchPageClientProps) {
  const hook = useSearchResults({ initialRemainingDaily });

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [currentFilters, setCurrentFilters] = useState<ParsedFilters>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(AI_STORAGE_KEY);
      if (stored) {
        const state: AISearchPageState = JSON.parse(stored);
        if (state.version === AI_STORAGE_VERSION) {
          if (state.messages) setMessages(state.messages.filter(m => !m.isLoading));
          if (state.currentFilters) setCurrentFilters(state.currentFilters);
          if (state.results && state.results.length > 0) hook.setResults(state.results);
          if (state.expandedIndex !== undefined) hook.setExpandedIndex(state.expandedIndex);
          if (state.sendStatuses) hook.setSendStatuses(new Map(state.sendStatuses));
          if (state.showBulkReview !== undefined) hook.setShowBulkReview(state.showBulkReview);
          if (state.generatingStatuses) hook.setGeneratingStatuses(new Map(state.generatingStatuses));
          if (state.searchParams) hook.setSearchParams(state.searchParams);
          if (state.totalLoaded !== undefined) hook.setTotalLoaded(state.totalLoaded);
          if (state.hasMore !== undefined) hook.setHasMore(state.hasMore);
          if (state.hiddenCount !== undefined) hook.setHiddenCount(state.hiddenCount);
        } else {
          sessionStorage.removeItem(AI_STORAGE_KEY);
        }
      }
    } catch {
      try { sessionStorage.removeItem(AI_STORAGE_KEY); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save to sessionStorage
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (messages.length > 0 || hook.results.length > 0) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        try {
          const state: AISearchPageState = {
            version: AI_STORAGE_VERSION,
            messages: messages.filter(m => !m.isLoading),
            currentFilters,
            results: hook.results,
            expandedIndex: hook.expandedIndex,
            sendStatuses: Array.from(hook.sendStatuses.entries()),
            showBulkReview: hook.showBulkReview,
            generatingStatuses: Array.from(hook.generatingStatuses.entries()),
            totalLoaded: hook.totalLoaded,
            hasMore: hook.hasMore,
            hiddenCount: hook.hiddenCount,
            searchParams: hook.searchParams ?? undefined,
            savedAt: Date.now(),
          };
          sessionStorage.setItem(AI_STORAGE_KEY, JSON.stringify(state));
        } catch {}
      }, 300);
    }
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [messages, currentFilters, hook.results, hook.expandedIndex, hook.sendStatuses, hook.showBulkReview, hook.generatingStatuses, hook.totalLoaded, hook.hasMore, hook.hiddenCount, hook.searchParams]);

  const runSearch = useCallback(async (filters: ParsedFilters) => {
    if (!filters.company) return;

    setIsSearching(true);
    hook.resetResults();

    const params = {
      company: filters.company,
      role: filters.role,
      university: filters.university,
      location: filters.location,
      limit: 6,
    };

    const result = await searchPeopleAction(params);

    if (result.success) {
      hook.applySearchResults(result.results, result.searchMeta, result.hiddenCount, params);

      // Fire-and-forget prescrape. Server-side dedup (findOrCreateScrapeProgress)
      // handles the case where a prescrape already ran or is running for these params.
      fetch('/api/prescrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: filters.company,
          role: filters.role,
          university: filters.university,
          location: filters.location,
        }),
      }).catch(err => console.error('[Prescrape] Error:', err));
    }

    setIsSearching(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendMessage = async (text?: string) => {
    const message = text || inputValue.trim();
    if (!message || isExtracting || isSearching) return;

    setInputValue('');

    // Add user message
    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: message },
      { id: assistantMsgId, role: 'assistant', content: '', isLoading: true },
    ]);

    setIsExtracting(true);

    // Build conversation history for the LLM
    const conversationHistory: ChatMessage[] = messages
      .filter(m => !m.isLoading)
      .map(m => ({ role: m.role, content: m.content, filters: m.filters }));

    const extractResult = await extractSearchFiltersAction({
      message,
      conversationHistory,
      currentFilters,
    });

    if (!extractResult.success) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: extractResult.error, isLoading: false }
            : m
        )
      );
      setIsExtracting(false);
      return;
    }

    const { filters, assistantMessage } = extractResult;

    // If no company, ask the user to specify one
    if (!filters.company) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: assistantMessage, filters, isLoading: false }
            : m
        )
      );
      setCurrentFilters(filters);
      setIsExtracting(false);
      return;
    }

    // Update filters and run search
    setCurrentFilters(filters);
    setMessages(prev =>
      prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: assistantMessage, filters, isLoading: false }
          : m
      )
    );
    setIsExtracting(false);

    await runSearch(filters);
  };

  const handleRemoveFilter = async (key: keyof ParsedFilters) => {
    const updated = { ...currentFilters };
    delete updated[key];
    setCurrentFilters(updated);

    if (key === 'company') {
      // Can't search without company — clear results
      hook.resetResults();
      setMessages(prev => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content: 'Company filter removed. Please specify a company to search.' },
      ]);
    } else {
      // Re-run search with updated filters
      setMessages(prev => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content: `Removed ${key} filter. Updating results...` },
      ]);
      await runSearch(updated);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const activeFilterEntries = Object.entries(currentFilters).filter(([, v]) => v) as [string, string][];
  const hasResults = hook.results.length > 0;
  const showChat = hook.expandedIndex === null && !hook.showBulkReview;

  return (
    <div className="relative">
      {/* Filter Chips */}
      {activeFilterEntries.length > 0 && showChat && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilterEntries.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-full"
            >
              <span className="text-xs text-primary-400 capitalize">{key}:</span>
              {value}
              <button
                onClick={() => handleRemoveFilter(key as keyof ParsedFilters)}
                className="ml-0.5 text-primary-400 hover:text-primary-600 transition-colors"
                aria-label={`Remove ${key} filter`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {showChat && (
        <>
          {/* Chat Area */}
          <div className="mb-4 max-h-80 overflow-y-auto rounded-xl border border-surface-200 bg-surface-50 p-4">
            {messages.length === 0 ? (
              /* Empty State */
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-surface-800 mb-1">
                  Describe who you&apos;re looking for
                </h3>
                <p className="text-sm text-surface-500 text-center mb-4">
                  Type a natural language query and I&apos;ll find matching professionals.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_QUERIES.map((query) => (
                    <button
                      key={query}
                      onClick={() => handleSendMessage(query)}
                      className="px-3 py-1.5 text-xs font-medium text-surface-600 bg-white border border-surface-200 rounded-full hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 transition-colors"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Messages */
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.role === 'user'
                          ? 'bg-primary-600 text-white rounded-br-md'
                          : 'bg-white text-surface-700 border border-surface-200 rounded-bl-md'
                      }`}
                    >
                      {msg.isLoading ? (
                        <div className="flex items-center gap-1.5 py-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="relative mb-6">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe who you're looking for..."
              disabled={isExtracting || isSearching}
              className="w-full pl-4 pr-12 py-3 text-sm border border-surface-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isExtracting || isSearching}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-primary-600 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* Loading state for search */}
      {isSearching && <SearchLoadingState />}

      {/* Results */}
      {hasResults && hook.expandedIndex === null && !hook.showBulkReview && (
        <>
          <HiddenPeopleBar
            hiddenCount={hook.hiddenCount}
            onCountChange={(delta) => hook.setHiddenCount((prev) => prev + delta)}
            onUnhide={(person) => hook.setResults((prev) => [...prev, person])}
          />
          <ResultsList
            results={hook.results}
            onReviewAndSend={() => hook.setShowBulkReview(true)}
            onExpand={hook.setExpandedIndex}
            onHide={hook.handleHidePerson}
            isSending={hook.isSending}
            sendingIndex={undefined}
            sendStatuses={hook.sendStatuses}
            limitReached={hook.limitReached}
            onLimitReached={() => hook.setShowLimitModal(true)}
          />

          {/* Load More Button */}
          {hook.hasMore && !isSearching && (
            <div className="flex flex-col items-center mt-6 gap-1">
              <button
                onClick={hook.handleLoadMore}
                disabled={hook.isLoadingMore || hook.isRetrying}
                className="btn-secondary flex items-center gap-2"
              >
                {hook.isLoadingMore || hook.isRetrying ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {hook.isRetrying ? 'Still searching for profiles...' : 'Loading...'}
                  </>
                ) : (
                  'Load More Profiles'
                )}
              </button>
              {hook.isRetrying && (
                <p className="text-sm text-surface-500">
                  Background search is still finding profiles. Retrying automatically...
                </p>
              )}
            </div>
          )}

          {/* No More Results */}
          {!hook.hasMore && (
            <p className="text-center text-surface-500 mt-6">
              No more profiles available
            </p>
          )}
        </>
      )}

      {hook.expandedIndex !== null && (
        <ExpandedReview
          results={hook.results}
          currentIndex={hook.expandedIndex}
          onClose={() => hook.setExpandedIndex(null)}
          onSend={hook.handleSendFromReview}
          sendStatuses={hook.sendStatuses}
          sendErrors={hook.sendErrors}
          templates={hook.templates}
          defaultTemplateId={hook.defaultTemplateId}
          onTemplateChange={hook.handleTemplateChange}
          isRegenerating={hook.isRegenerating}
          limitReached={hook.limitReached}
          onLimitReached={() => hook.setShowLimitModal(true)}
          onDraftGenerated={(idx, subject, body) => {
            hook.setResults((prev) => prev.map((r, i) =>
              i === idx ? { ...r, draftSubject: subject, draftBody: body, llmDraftGenerated: true } : r
            ));
          }}
        />
      )}

      {hook.showBulkReview && (
        <BulkReview
          results={hook.results}
          onClose={() => hook.setShowBulkReview(false)}
          onSendAll={hook.handleBulkSend}
          sendStatuses={hook.sendStatuses}
          templates={hook.templates}
          onApplyTemplateToAll={hook.handleApplyTemplateToAll}
          isRegenerating={hook.isRegenerating}
        />
      )}

      {hook.toast && (
        <Toast
          message={hook.toast.message}
          type={hook.toast.type}
          onClose={() => hook.setToast(null)}
        />
      )}

      <LimitReachedModal
        isOpen={hook.showLimitModal}
        onClose={() => hook.setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          hook.setRemainingDaily((prev) => prev + credits);
          hook.setLimitReached(false);
          hook.setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged();
        }}
      />
    </div>
  );
}
