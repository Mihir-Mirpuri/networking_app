'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { BulkReview } from './BulkReview';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchLoadingState } from './SearchLoadingState';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { searchPeopleAction, SearchResultWithDraft, getRecentSearchesAction, RecentSearch } from '@/app/actions/search';
import { HiddenPeopleBar } from './HiddenPeopleBar';
import { useSearchResults, SearchParams } from '@/hooks/useSearchResults';

interface SearchPageClientProps {
  initialRemainingDaily: number;
}

// Storage key for sessionStorage
const STORAGE_KEY = 'signl_searchState';
const STORAGE_VERSION = 1;

// State structure for persistence
interface SearchPageState {
  version: number;
  results: SearchResultWithDraft[];
  expandedIndex: number | null;
  sendStatuses: Array<[string, 'success' | 'failed' | 'pending']>;
  showBulkReview: boolean;
  generatingStatuses: Array<[string, boolean]>;
  remainingDaily?: number;
  searchParams?: SearchParams;
  totalLoaded?: number;
  hasMore?: boolean;
  hiddenCount?: number;
  savedAt: number;
}

// Helper functions for Map serialization
function mapToArray<T>(map: Map<string, T>): Array<[string, T]> {
  return Array.from(map.entries());
}

function arrayToMap<T>(array: Array<[string, T]>): Map<string, T> {
  return new Map(array);
}

export function SearchPageClient({ initialRemainingDaily }: SearchPageClientProps) {
  const hook = useSearchResults({ initialRemainingDaily });

  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recent searches state
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [formPrefill, setFormPrefill] = useState<{
    company?: string;
    role?: string;
    university?: string;
    location?: string;
  } | null>(null);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);

      if (stored) {
        const state: SearchPageState = JSON.parse(stored);

        // Check version compatibility
        if (state.version === STORAGE_VERSION) {
          if (state.results && state.results.length > 0) {
            hook.setResults(state.results);
          }
          if (state.expandedIndex !== undefined) {
            hook.setExpandedIndex(state.expandedIndex);
          }
          if (state.sendStatuses) {
            hook.setSendStatuses(arrayToMap(state.sendStatuses));
          }
          if (state.showBulkReview !== undefined) {
            hook.setShowBulkReview(state.showBulkReview);
          }
          if (state.generatingStatuses) {
            hook.setGeneratingStatuses(arrayToMap(state.generatingStatuses));
          }
          if (state.searchParams) {
            hook.setSearchParams(state.searchParams);
          }
          // Restore pagination state
          if (state.totalLoaded !== undefined) {
            hook.setTotalLoaded(state.totalLoaded);
          }
          if (state.hasMore !== undefined) {
            hook.setHasMore(state.hasMore);
          }
          if (state.hiddenCount !== undefined) {
            hook.setHiddenCount(state.hiddenCount);
          }
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (error) {
      console.error('Error restoring state from sessionStorage:', error);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        // Ignore errors clearing
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save to sessionStorage
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (hook.results.length > 0) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        try {
          // Retrieve existing searchParams from sessionStorage to preserve them
          const existing = sessionStorage.getItem(STORAGE_KEY);
          let existingSearchParams = undefined;
          if (existing) {
            try {
              const existingState: SearchPageState = JSON.parse(existing);
              existingSearchParams = existingState.searchParams;
            } catch (e) {
              // Ignore parse errors
            }
          }
          // Use current searchParams state if available, otherwise use existing from storage
          const paramsToSave = hook.searchParams || existingSearchParams;

          const state: SearchPageState = {
            version: STORAGE_VERSION,
            results: hook.results,
            expandedIndex: hook.expandedIndex,
            sendStatuses: mapToArray(hook.sendStatuses),
            showBulkReview: hook.showBulkReview,
            generatingStatuses: mapToArray(hook.generatingStatuses),
            remainingDaily: hook.remainingDaily,
            searchParams: paramsToSave,
            totalLoaded: hook.totalLoaded,
            hasMore: hook.hasMore,
            hiddenCount: hook.hiddenCount,
            savedAt: Date.now(),
          };
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
          console.error('Error saving state to sessionStorage:', error);
        }
      }, 300);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hook.results, hook.expandedIndex, hook.sendStatuses, hook.showBulkReview, hook.generatingStatuses, hook.remainingDaily, hook.searchParams, hook.totalLoaded, hook.hasMore, hook.hiddenCount]);

  // Fetch recent searches on mount
  useEffect(() => {
    getRecentSearchesAction()
      .then(setRecentSearches)
      .catch(() => {})
      .finally(() => setIsLoadingRecent(false));
  }, []);

  const handleRecentSearchClick = (search: RecentSearch) => {
    setFormPrefill({
      company: search.company || undefined,
      role: search.role || undefined,
      university: search.university || undefined,
      location: search.location || undefined,
    });
  };

  const handleSearch = async (params: SearchParams) => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing sessionStorage:', error);
    }

    setIsSearching(true);
    setError(null);
    hook.resetResults();
    setFormPrefill(null);

    const result = await searchPeopleAction({ ...params });

    if (result.success) {
      hook.applySearchResults(result.results, result.searchMeta, result.hiddenCount, params);
      setIsSearching(false);

      // Save to sessionStorage
      try {
        const state: SearchPageState = {
          version: STORAGE_VERSION,
          results: result.results,
          expandedIndex: null,
          sendStatuses: [],
          showBulkReview: false,
          generatingStatuses: [],
          remainingDaily: hook.remainingDaily,
          searchParams: params,
          totalLoaded: result.results.length,
          hasMore: result.searchMeta.hasMore,
          hiddenCount: result.hiddenCount,
          savedAt: Date.now(),
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('Error saving search params to sessionStorage:', e);
      }

      // Fire-and-forget prescrape — only if we got results
      // (if page 1 returned nothing, pages 2–5 won't be better)
      if (result.results.length > 0) {
        fetch('/api/prescrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: params.company!,
            role: params.role,
            university: params.university,
            location: params.location,
          }),
        }).catch(err => console.error('[Prescrape] Error:', err));
      }
    } else {
      setError(result.error);
      setIsSearching(false);
    }
  };

  return (
    <div className="relative">
      <SearchForm
        onSearch={handleSearch}
        isLoading={isSearching}
        initialParams={formPrefill || hook.searchParams}
        disabled={hook.limitReached}
        onDisabledClick={() => hook.setShowLimitModal(true)}
      />

      {/* Recent searches — always visible below the form for quick re-runs */}
      {!isLoadingRecent && recentSearches.length > 0 && !isSearching && (
        <div className="mb-4 -mt-2">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-xs font-medium text-surface-400">Recent</span>
          </div>
          <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
            {recentSearches.map((search, i) => {
              const label = [search.company, search.role, search.university, search.location]
                .filter(Boolean)
                .join(' \u00b7 ');
              return (
                <button
                  key={i}
                  onClick={() => handleRecentSearchClick(search)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-600 bg-surface-100 border border-surface-200 rounded-full hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200 transition-colors cursor-pointer"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-400/50 text-red-400 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isSearching && <SearchLoadingState />}

      {/* Pre-search empty state */}
      {!isSearching && !error && hook.results.length === 0 && !hook.searchParams && (
        <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
          {/* Illustration: three connected profile nodes */}
          <div className="relative w-40 h-32 mb-6">
            {/* Center node */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            {/* Left node */}
            <div className="absolute left-2 bottom-0 w-11 h-11 rounded-full bg-gradient-to-br from-accent-300 to-accent-500 flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            {/* Right node */}
            <div className="absolute right-2 bottom-0 w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            {/* Connecting lines */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 160 128" fill="none">
              <line x1="80" y1="50" x2="30" y2="88" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-surface-300" />
              <line x1="80" y1="50" x2="130" y2="88" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-surface-300" />
            </svg>
          </div>

          <h3 className="text-lg font-semibold text-surface-800 mb-2">
            Discover people to connect with
          </h3>
          <p className="text-sm text-surface-500 text-center max-w-md mb-5">
            Search by company, role, or university to find professionals and send personalized emails — all in one click.
          </p>

          {/* Hint chips */}
          <div className="flex flex-wrap justify-center gap-2">
            {['Company', 'Role', 'University', 'Location'].map((filter) => (
              <span
                key={filter}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-surface-500 bg-surface-100 rounded-full"
              >
                <svg className="w-3 h-3 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
                {filter}
              </span>
            ))}
          </div>

          {/* Subtle upward arrow pointing to the form */}
          <div className="mt-6 animate-pulse-soft">
            <svg className="w-5 h-5 text-surface-300 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </div>
      )}

      {!isSearching && !error && hook.results.length === 0 && hook.searchParams && (
        <div className="flex flex-col items-center justify-center py-16 text-surface-500">
          <svg className="w-12 h-12 mb-4 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <p className="text-base font-medium text-surface-600 mb-1">No profiles found</p>
          <p className="text-sm">Try adjusting your search filters or broadening your criteria.</p>
        </div>
      )}

      {hook.results.length > 0 && hook.expandedIndex === null && !hook.showBulkReview && (
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

          {/* No More Results Message */}
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
