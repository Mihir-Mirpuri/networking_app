'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ResultsList } from '@/components/search/ResultsList';

function IdleAnimation() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-120px)]">
      <p className="text-xl text-white font-medium">
        Type a search in the sidebar to get started
      </p>
    </div>
  );
}
import { ExpandedReview } from '@/components/search/ExpandedReview';
import { BulkReview } from '@/components/search/BulkReview';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { SearchLoadingState } from '@/components/search/SearchLoadingState';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { HiddenPeopleBar } from '@/components/search/HiddenPeopleBar';
import { searchPeopleV2Action, lookupPersonAction, SearchResultWithDraft } from '@/app/actions/search';
import { extractSearchFiltersAction, ParsedFilters, ChatMessage, Selectable } from '@/app/actions/ai-search';
import { useSearchResults } from '@/hooks/useSearchResults';
import { LoginPromptModal } from '@/components/auth/LoginPromptModal';
import type { LinkedInFilters } from '@/lib/types/linkedin-filters';

const GUEST_QUERY_LIMIT = 5;
const GUEST_QUERY_KEY = 'signl_guest_queries';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filters?: ParsedFilters;
  isLoading?: boolean;
  selectables?: Selectable[];
  allSelectables?: Selectable[];
  selectablesPage?: number;
}

interface MainSearchViewProps {
  initialRemainingDaily: number;
  pendingQuery: string | null;
  pendingFilters: ParsedFilters | null;
  onQueryProcessed: () => void;
  aiMode?: boolean;
  isAuthenticated?: boolean;
  // Lifted state from AppShell
  messages: DisplayMessage[];
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>;
  currentFilters: ParsedFilters;
  setCurrentFilters: React.Dispatch<React.SetStateAction<ParsedFilters>>;
  isExtracting: boolean;
  setIsExtracting: React.Dispatch<React.SetStateAction<boolean>>;
  isSearching: boolean;
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
}

const STORAGE_KEY = 'signl_mainSearchState';
const STORAGE_VERSION = 2; // Bumped: added allSelectables for Perplexity pagination

interface MainSearchState {
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

export function MainSearchView({
  initialRemainingDaily,
  pendingQuery,
  pendingFilters,
  onQueryProcessed,
  aiMode,
  isAuthenticated = true,
  messages,
  setMessages,
  currentFilters,
  setCurrentFilters,
  isExtracting,
  setIsExtracting,
  isSearching,
  setIsSearching,
}: MainSearchViewProps) {
  const hook = useSearchResults({ initialRemainingDaily });

  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState<'query_limit' | 'send_email'>('query_limit');
  const [isHydrated, setIsHydrated] = useState(false);

  const lastProcessedQueryRef = useRef<string | null>(null);
  const lastProcessedFiltersRef = useRef<string | null>(null);
  const searchIdRef = useRef(0);

  // Guest query counter
  const getGuestQueryCount = useCallback(() => {
    if (isAuthenticated) return 0;
    try {
      return parseInt(sessionStorage.getItem(GUEST_QUERY_KEY) || '0', 10);
    } catch {
      return 0;
    }
  }, [isAuthenticated]);

  const incrementGuestQueryCount = useCallback(() => {
    if (isAuthenticated) return 0;
    try {
      const current = parseInt(sessionStorage.getItem(GUEST_QUERY_KEY) || '0', 10);
      const newCount = current + 1;
      sessionStorage.setItem(GUEST_QUERY_KEY, String(newCount));
      return newCount;
    } catch {
      return 0;
    }
  }, [isAuthenticated]);

  const checkGuestQueryLimit = useCallback(() => {
    if (isAuthenticated) return false;
    const count = getGuestQueryCount();
    if (count >= GUEST_QUERY_LIMIT) {
      setLoginPromptReason('query_limit');
      setShowLoginPrompt(true);
      return true;
    }
    return false;
  }, [isAuthenticated, getGuestQueryCount]);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: MainSearchState = JSON.parse(stored);
        if (state.version === STORAGE_VERSION) {
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
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
      // Clean up old storage keys
      try { sessionStorage.removeItem('signl_aiSearchState'); } catch {}
      try { sessionStorage.removeItem('signl_searchState'); } catch {}
    } catch {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    }
    setIsHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save to sessionStorage
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (messages.length > 0 || hook.results.length > 0) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        try {
          const state: MainSearchState = {
            version: STORAGE_VERSION,
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
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {}
      }, 300);
    }
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [messages, currentFilters, hook.results, hook.expandedIndex, hook.sendStatuses, hook.showBulkReview, hook.generatingStatuses, hook.totalLoaded, hook.hasMore, hook.hiddenCount, hook.searchParams]);

  const cancelSearch = useCallback(() => {
    const cancelledId = searchIdRef.current;
    console.log(`[CancelSearch] Cancelling search #${cancelledId}`);

    searchIdRef.current += 1;
    console.log(`[CancelSearch] Search generation bumped to #${searchIdRef.current}`);

    setIsExtracting(false);
    setIsSearching(false);

    // Remove any loading assistant bubbles
    setMessages(prev => prev.filter(m => !m.isLoading));

    // Clear Load More retry timers
    hook.cancelRetries();

    console.log(`[CancelSearch] Cleanup complete for search #${cancelledId}. Ready for new search.`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hook]);

  const runSearch = useCallback(async (filters: ParsedFilters, liFilters?: LinkedInFilters, originalQuery?: string) => {
    // Check guest query limit before searching
    if (checkGuestQueryLimit()) {
      setIsSearching(false);
      return;
    }

    const thisSearchId = searchIdRef.current;

    // Build query string and LinkedIn filters for V2
    const query = originalQuery || [filters.role, filters.company, filters.university, filters.location].filter(Boolean).join(' at ');
    const effectiveLiFilters: LinkedInFilters = liFilters || {
      searchQuery: [filters.role, filters.company].filter(Boolean).join(' '),
      locations: filters.location ? [filters.location] : undefined,
    };
    const effectiveDbFilters = {
      company: filters.company,
      role: filters.role,
      location: filters.location,
      university: filters.university,
      roleSpecificity: filters.roleSpecificity,
    };

    console.log(`[Search] Starting V2 search #${thisSearchId} query="${query}"`);
    setIsSearching(true);
    hook.resetResults();

    const result = await searchPeopleV2Action({
      query,
      linkedInFilters: effectiveLiFilters,
      dbFilters: effectiveDbFilters,
      limit: 25,
    });

    if (searchIdRef.current !== thisSearchId) {
      console.log(`[Search] Discarding stale V2 result from search #${thisSearchId}`);
      return;
    }

    if (result.success) {
      console.log(`[Search] V2 search #${thisSearchId} returned ${result.results.length} results, advanced=${result.searchMeta.isAdvancedQuery}`);
      incrementGuestQueryCount();

      hook.applySearchResults(
        result.results,
        result.searchMeta,
        result.hiddenCount,
        {
          company: filters.company,
          role: filters.role,
          university: filters.university,
          location: filters.location,
          limit: 25,
        },
        {
          linkedInFilters: effectiveLiFilters,
          dbFilters: effectiveDbFilters,
        }
      );
    } else {
      console.log(`[Search] V2 search #${thisSearchId} failed:`, result.error);
    }

    setIsSearching(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text || isExtracting || isSearching) return;

    // Start a new search generation
    searchIdRef.current += 1;
    const thisSearchId = searchIdRef.current;
    console.log(`[SendMessage] Starting search #${thisSearchId} with message: "${text}"`);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: assistantMsgId, role: 'assistant', content: '', isLoading: true },
    ]);

    setIsExtracting(true);

    const conversationHistory: ChatMessage[] = messages
      .filter(m => !m.isLoading)
      .map(m => ({ role: m.role, content: m.content, filters: m.filters }));

    const extractResult = await extractSearchFiltersAction({
      message: text,
      conversationHistory,
      currentFilters,
    });

    // Stale check after LLM extraction
    if (searchIdRef.current !== thisSearchId) {
      console.log(`[SendMessage] Discarding stale extraction result from search #${thisSearchId} (current is #${searchIdRef.current})`);
      return;
    }

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

    // Handle person lookup before accessing filters (person_lookup doesn't have filters)
    if (extractResult.status === 'person_lookup') {
      const { assistantMessage } = extractResult;
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: assistantMessage, isLoading: false }
            : m
        )
      );
      setIsExtracting(false);
      setIsSearching(true);
      hook.resetResults();

      const lookupResult = await lookupPersonAction({
        name: extractResult.personName,
        company: extractResult.personCompany,
      });

      if (searchIdRef.current !== thisSearchId) return;

      if (lookupResult.success) {
        hook.setResults(lookupResult.results);
        hook.setHasMore(false);
        hook.setTotalLoaded(lookupResult.results.length);
      } else {
        setMessages(prev => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: 'assistant', content: lookupResult.error || 'Could not find that person.' },
        ]);
      }
      setIsSearching(false);
      return;
    }

    // Handle blocked users (no filters property)
    if (extractResult.status === 'blocked') {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: extractResult.assistantMessage, isLoading: false }
            : m
        )
      );
      setIsExtracting(false);
      return;
    }

    const { filters, assistantMessage } = extractResult;
    setCurrentFilters(filters);

    if (extractResult.status === 'off_topic') {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: assistantMessage, filters, isLoading: false }
            : m
        )
      );
      setIsExtracting(false);
      return;
    }

    if (extractResult.status === 'needs_selection') {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: assistantMessage,
                filters,
                selectables: extractResult.selectables,
                allSelectables: extractResult.allSelectables,
                selectablesPage: 0,
                isLoading: false,
              }
            : m
        )
      );
      setIsExtracting(false);
      return;
    }

    // status === 'ready' — set isSearching in the same batch as the message
    // so the main UI loading state stays in sync with the chat message
    setMessages(prev =>
      prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: assistantMessage, filters, isLoading: false }
          : m
      )
    );
    setIsExtracting(false);
    setIsSearching(true);
    hook.resetResults();

    await runSearch(filters, extractResult.linkedInFilters, text);
  }, [isExtracting, isSearching, messages, currentFilters, runSearch]);


  // Process pending query from sidebar
  useEffect(() => {
    if (pendingQuery && pendingQuery !== lastProcessedQueryRef.current) {
      lastProcessedQueryRef.current = pendingQuery;
      handleSendMessage(pendingQuery);
      onQueryProcessed();
    }
  }, [pendingQuery, handleSendMessage, onQueryProcessed]);

  // Process pending filters from sidebar filter popover or recent search
  useEffect(() => {
    if (pendingFilters) {
      const key = JSON.stringify(pendingFilters);
      if (key !== lastProcessedFiltersRef.current) {
        lastProcessedFiltersRef.current = key;
        setCurrentFilters(pendingFilters);

        const label = [pendingFilters.company, pendingFilters.role, pendingFilters.university, pendingFilters.location]
          .filter(Boolean).join(' at ');
        setMessages(prev => [...prev, {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `Searching for ${label}...`,
        }]);
        setIsSearching(true);
        hook.resetResults();

        runSearch(pendingFilters);
        onQueryProcessed();
      }
    }
  }, [pendingFilters, runSearch, onQueryProcessed]);

  const handleRemoveFilter = async (key: keyof ParsedFilters) => {
    const updated = { ...currentFilters };
    delete updated[key];
    setCurrentFilters(updated);

    if (key === 'company') {
      hook.resetResults();
      setMessages(prev => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content: 'Company filter removed. Please specify a company to search.' },
      ]);
    } else {
      setMessages(prev => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content: `Removed ${key} filter. Updating results...` },
      ]);
      setIsSearching(true);
      hook.resetResults();
      await runSearch(updated);
    }
  };

  const activeFilterEntries = Object.entries(currentFilters).filter(([, v]) => v) as [string, string][];
  const hasResults = hook.results.length > 0;
  const showChat = hook.expandedIndex === null && !hook.showBulkReview;

  return (
    <div className="h-full overflow-y-auto bg-[#212121]">
      <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-10 pt-2 pb-6">
        {/* No results state - centered */}
        {activeFilterEntries.length > 0 && showChat && !isSearching && !hasResults && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <p className="text-3xl font-medium text-white">No results</p>
          </div>
        )}

        {showChat && messages.length === 0 && !hasResults && activeFilterEntries.length === 0 && isHydrated && (
          <IdleAnimation />
        )}

        {/* Chat messages moved to SearchSidebar */}

        {/* Loading state for search */}
        {isSearching && <SearchLoadingState onCancel={cancelSearch} />}

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
              onToggleSaveForLater={hook.handleToggleSaveForLater}
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
            autoPersonalize={hook.autoPersonalize}
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

        {/* Login prompt for guests */}
        <LoginPromptModal
          isOpen={showLoginPrompt}
          onClose={() => setShowLoginPrompt(false)}
          title={loginPromptReason === 'query_limit' ? 'Sign in to continue' : 'Sign in to send emails'}
          message={
            loginPromptReason === 'query_limit'
              ? "You've used your 5 free searches. Sign in to unlock unlimited searches and start sending emails."
              : 'Sign in with Google to send personalized emails directly from your Gmail account.'
          }
        />
      </div>
    </div>
  );
}
