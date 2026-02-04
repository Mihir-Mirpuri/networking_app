'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { BulkReview } from './BulkReview';
import { LoadingSpinner } from './LoadingSpinner';
import { Toast } from '@/components/ui/Toast';
import { searchPeopleAction, SearchResultWithDraft, hidePersonAction, refreshSearchAction } from '@/app/actions/search';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';

// Loading message shown during search
const LOADING_MESSAGE = 'Searching for profiles...';

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
  // NEW: Add search parameters
  searchParams?: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    templateId: string;
  };
  currentPage?: number;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useState<{
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    templateId: string;
  } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
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
          // NEW: Restore search parameters
          if (state.searchParams) {
            setSearchParams(state.searchParams);
          }
          // Restore pagination state
          if (state.currentPage !== undefined) {
            setCurrentPage(state.currentPage);
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
            searchParams: paramsToSave, // Preserve search params
            currentPage,
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
  }, [results, expandedIndex, sendStatuses, showBulkReview, generatingStatuses, remainingDaily, searchParams, currentPage, hasMore]);

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
    // Reset pagination on new search
    setCurrentPage(1);
    setHasMore(true);

    const result = await searchPeopleAction(params);

    if (result.success) {
      setResults(result.results);
      // Save search parameters immediately after successful search
      try {
        const state: SearchPageState = {
          version: STORAGE_VERSION,
          results: result.results,
          expandedIndex: null,
          sendStatuses: [],
          showBulkReview: false,
          generatingStatuses: [],
          remainingDaily,
          searchParams: params, // Save search parameters
          savedAt: Date.now(),
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSearchParams(params); // Also update state
      } catch (error) {
        console.error('Error saving search params to sessionStorage:', error);
      }

      // If cache missed, trigger refresh to discover more people
      if (result.searchMeta.needsRefresh) {
        const hasInitialResults = result.results.length > 0;

        // Only show as "background" refresh if we have results to display
        // Otherwise, keep the main search spinner active
        if (hasInitialResults) {
          setIsSearching(false);
          setIsRefreshing(true);
        }
        // If no results, isSearching stays true until refresh completes

        refreshSearchAction({
          company: params.company,
          role: params.role,
          university: params.university,
          location: params.location,
          limit: params.limit,
        }).then((refreshResult) => {
          if (refreshResult.success) {
            console.log(`[Refresh] Complete: ${refreshResult.newPeopleCount} new, ${refreshResult.emailsGenerated} emails`);
            setHasMore(refreshResult.hasMore);
            // Re-fetch results to include newly discovered people
            searchPeopleAction(params).then((updatedResult) => {
              if (updatedResult.success) {
                setResults(updatedResult.results);
                // Update sessionStorage with new results
                try {
                  const updatedState: SearchPageState = {
                    version: STORAGE_VERSION,
                    results: updatedResult.results,
                    expandedIndex: null,
                    sendStatuses: mapToArray(sendStatuses),
                    showBulkReview: false,
                    generatingStatuses: mapToArray(generatingStatuses),
                    remainingDaily,
                    searchParams: params,
                    savedAt: Date.now(),
                  };
                  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updatedState));
                } catch (e) {
                  console.error('Error updating sessionStorage after refresh:', e);
                }
              }
              setIsSearching(false);
              setIsRefreshing(false);
            });
          } else {
            console.error('[Refresh] Failed:', refreshResult.error);
            setIsSearching(false);
            setIsRefreshing(false);
          }
        }).catch((err) => {
          console.error('[Refresh] Error:', err);
          setIsSearching(false);
          setIsRefreshing(false);
        });
      } else {
        setIsSearching(false);
      }
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
    } else {
      setToast({ message: 'Failed to send email', type: 'error' });
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
    const nextPage = currentPage + 1;
    const pageStart = (nextPage - 1) * 10 + 1; // page 2 → start=11, page 3 → start=21

    try {
      const result = await refreshSearchAction({
        company: searchParams.company,
        role: searchParams.role,
        university: searchParams.university,
        location: searchParams.location,
        pageStart,
      });

      if (result.success) {
        setCurrentPage(nextPage);
        setHasMore(result.hasMore);

        // Re-fetch to get updated results including new people
        const updatedResult = await searchPeopleAction({
          ...searchParams,
          limit: nextPage * 10, // Get all results so far
        });

        if (updatedResult.success) {
          setResults(updatedResult.results);
          // Update sessionStorage with new results
          try {
            const updatedState: SearchPageState = {
              version: STORAGE_VERSION,
              results: updatedResult.results,
              expandedIndex,
              sendStatuses: mapToArray(sendStatuses),
              showBulkReview,
              generatingStatuses: mapToArray(generatingStatuses),
              remainingDaily,
              searchParams,
              currentPage: nextPage,
              hasMore: result.hasMore,
              savedAt: Date.now(),
            };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updatedState));
          } catch (e) {
            console.error('Error updating sessionStorage after load more:', e);
          }
        }
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

      {isRefreshing && !isSearching && expandedIndex === null && !showBulkReview && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm">
          <LoadingSpinner size="sm" />
          <span>Discovering more profiles in background...</span>
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
            remainingDaily={remainingDaily}
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
    </div>
  );
}
