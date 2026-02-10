'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { BulkReview } from './BulkReview';
import { LoadingSpinner } from './LoadingSpinner';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { searchPeopleAction, SearchResultWithDraft, hidePersonAction } from '@/app/actions/search';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';

// Loading message shown during search
const LOADING_MESSAGE = 'Searching for profiles — this can take up to 30 seconds...';

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
  searchParams?: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
    templateId: string;
  };
  totalLoaded?: number;
  hasMore?: boolean;
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
  const [results, setResults] = useState<SearchResultWithDraft[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sendStatuses, setSendStatuses] = useState<Map<string, 'success' | 'failed' | 'pending'>>(
    new Map()
  );
  const [remainingDaily, setRemainingDaily] = useState(initialRemainingDaily);
  const [showBulkReview, setShowBulkReview] = useState(false);
  const [generatingStatuses, setGeneratingStatuses] = useState<Map<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [searchParams, setSearchParams] = useState<{
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
    templateId: string;
  } | null>(null);

  // Pagination state
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Restore state from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);

      if (stored) {
        const state: SearchPageState = JSON.parse(stored);

        // Check version compatibility
        if (state.version === STORAGE_VERSION) {
          if (state.results && state.results.length > 0) {
            setResults(state.results);
          }
          if (state.expandedIndex !== undefined) {
            setExpandedIndex(state.expandedIndex);
          }
          if (state.sendStatuses) {
            setSendStatuses(arrayToMap(state.sendStatuses));
          }
          if (state.showBulkReview !== undefined) {
            setShowBulkReview(state.showBulkReview);
          }
          if (state.generatingStatuses) {
            setGeneratingStatuses(arrayToMap(state.generatingStatuses));
          }
          if (state.searchParams) {
            setSearchParams(state.searchParams);
          }
          // Restore pagination state
          if (state.totalLoaded !== undefined) {
            setTotalLoaded(state.totalLoaded);
          }
          if (state.hasMore !== undefined) {
            setHasMore(state.hasMore);
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
  }, []);

  // Debounced save to sessionStorage
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (results.length > 0) {
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
          const paramsToSave = searchParams || existingSearchParams;

          const state: SearchPageState = {
            version: STORAGE_VERSION,
            results,
            expandedIndex,
            sendStatuses: mapToArray(sendStatuses),
            showBulkReview,
            generatingStatuses: mapToArray(generatingStatuses),
            remainingDaily,
            searchParams: paramsToSave,
            totalLoaded,
            hasMore,
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
  }, [results, expandedIndex, sendStatuses, showBulkReview, generatingStatuses, remainingDaily, searchParams, totalLoaded, hasMore]);

  const handleSearch = async (params: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
    templateId: string;
  }) => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing sessionStorage:', error);
    }

    setIsSearching(true);
    setError(null);
    setResults([]);
    setSendStatuses(new Map());
    setTotalLoaded(0);
    setHasMore(true);

    const result = await searchPeopleAction({ ...params });

    if (result.success) {
      setResults(result.results);
      setTotalLoaded(result.results.length);
      setHasMore(result.searchMeta.hasMore);
      setSearchParams(params);
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
          remainingDaily,
          searchParams: params,
          totalLoaded: result.results.length,
          hasMore: result.searchMeta.hasMore,
          savedAt: Date.now(),
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('Error saving search params to sessionStorage:', e);
      }

      // Fire-and-forget via API route (not server action) so it doesn't
      // block subsequent server action calls like searchPeopleAction.
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
    } else {
      setError(result.error);
      setIsSearching(false);
    }
  };

  const handleSendFromReview = async (index: number, subject: string, body: string) => {
    const person = results[index];
    if (!person.email || !person.userCandidateId) return;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      email: person.email,
      subject,
      body,
      userCandidateId: person.userCandidateId,
      resumeId: person.resumeId ?? undefined,
    };

    const result = await sendSingleEmailAction(personToSend);

    setSendStatuses((prev) =>
      new Map(prev).set(person.id, result.success ? 'success' : 'failed')
    );

    if (result.success) {
      setRemainingDaily((prev) => Math.max(0, prev - 1));
      setToast({ message: 'Email sent successfully!', type: 'success' });
      dispatchCreditsChanged(); // Update header credits display
    } else if (result.error === 'LIMIT_REACHED') {
      setShowLimitModal(true);
    } else {
      setToast({ message: result.error || 'Failed to send email', type: 'error' });
    }
  };

  const handleBulkSend = async (emails: { index: number; subject: string; body: string }[]) => {
    const peopleToSend = emails
      .map(({ index, subject, body }) => {
        const person = results[index];
        if (!person.email || !person.userCandidateId) return null;
        return {
          email: person.email,
          subject,
          body,
          userCandidateId: person.userCandidateId,
          resumeId: person.resumeId ?? undefined,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (peopleToSend.length === 0) return;

    setIsSending(true);

    const newStatuses = new Map(sendStatuses);
    emails.forEach(({ index }) => {
      const person = results[index];
      if (person.email && person.userCandidateId && !sendStatuses.has(person.id)) {
        newStatuses.set(person.id, 'pending');
      }
    });
    setSendStatuses(newStatuses);

    const result = await sendEmailsAction(peopleToSend);

    if (result.success) {
      const updatedStatuses = new Map(newStatuses);
      result.results.forEach((res) => {
        const person = results.find((r) => r.email === res.email);
        if (person) {
          updatedStatuses.set(person.id, res.success ? 'success' : 'failed');
        }
      });
      setSendStatuses(updatedStatuses);

      const successCount = result.results.filter((r) => r.success).length;
      setRemainingDaily((prev) => Math.max(0, prev - successCount));
      if (successCount > 0) {
        dispatchCreditsChanged(); // Update header credits display
      }
    }

    setIsSending(false);
  };

  const handleHidePerson = async (userCandidateId: string) => {
    const result = await hidePersonAction(userCandidateId);

    if (result.success) {
      setResults((prev) => prev.filter((r) => r.userCandidateId !== userCandidateId));
    } else {
      setError(result.error || 'Failed to hide person');
    }
  };

  const handleLoadMore = async () => {
    if (!searchParams?.company || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const result = await searchPeopleAction({
        ...searchParams,
        excludePersonIds: results.map(r => r.id),
      });

      if (result.success) {
        // Append new results
        setResults(prev => [...prev, ...result.results]);
        setTotalLoaded(prev => prev + result.results.length);
        setHasMore(result.searchMeta.hasMore);
      } else {
        setToast({ message: result.error || 'Failed to load more profiles', type: 'error' });
      }
    } catch (err) {
      console.error('[LoadMore] Error:', err);
      setToast({ message: 'Failed to load more profiles', type: 'error' });
    }

    setIsLoadingMore(false);
  };

  return (
    <div className="relative">
      <SearchForm 
        onSearch={handleSearch} 
        isLoading={isSearching}
        initialParams={searchParams}
      />

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isSearching && (
        <div className="flex items-center gap-3 py-8 text-gray-600">
          <LoadingSpinner size="md" />
          <span className="text-base">{LOADING_MESSAGE}</span>
        </div>
      )}

      {!isSearching && !error && results.length === 0 && searchParams && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <p className="text-base font-medium text-gray-600 mb-1">No profiles found</p>
          <p className="text-sm">Try adjusting your search filters or broadening your criteria.</p>
        </div>
      )}

      {results.length > 0 && expandedIndex === null && !showBulkReview && (
        <>
          <ResultsList
            results={results}
            onReviewAndSend={() => setShowBulkReview(true)}
            onExpand={setExpandedIndex}
            onHide={handleHidePerson}
            isSending={isSending}
            sendingIndex={undefined}
            sendStatuses={sendStatuses}
          />

          {/* Load More Button */}
          {hasMore && !isSearching && (
            <div className="flex justify-center mt-6">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isLoadingMore ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Loading...
                  </>
                ) : (
                  'Load More Profiles'
                )}
              </button>
            </div>
          )}

          {/* No More Results Message */}
          {!hasMore && (
            <p className="text-center text-gray-500 mt-6">
              No more profiles available
            </p>
          )}
        </>
      )}

      {expandedIndex !== null && (
        <ExpandedReview
          results={results}
          currentIndex={expandedIndex}
          onClose={() => setExpandedIndex(null)}
          onSend={handleSendFromReview}
          sendStatuses={sendStatuses}
        />
      )}

      {showBulkReview && (
        <BulkReview
          results={results}
          onClose={() => setShowBulkReview(false)}
          onSendAll={handleBulkSend}
          sendStatuses={sendStatuses}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          setRemainingDaily((prev) => prev + credits);
          setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged(); // Update header credits display
        }}
      />
    </div>
  );
}
