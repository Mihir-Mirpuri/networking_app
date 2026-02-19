'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchForm } from './SearchForm';
import { ResultsList } from './ResultsList';
import { ExpandedReview } from './ExpandedReview';
import { BulkReview } from './BulkReview';
import { LoadingSpinner } from './LoadingSpinner';
import { SearchLoadingState } from './SearchLoadingState';
import { Toast } from '@/components/ui/Toast';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { searchPeopleAction, SearchResultWithDraft, hidePersonAction, loadMorePeopleAction, getRecentSearchesAction, RecentSearch, regenerateDraftAction } from '@/app/actions/search';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';
import { useSession } from 'next-auth/react';

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
  const { status: sessionStatus } = useSession();
  const [results, setResults] = useState<SearchResultWithDraft[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sendStatuses, setSendStatuses] = useState<Map<string, 'success' | 'failed' | 'pending'>>(
    new Map()
  );
  const [sendErrors, setSendErrors] = useState<Map<string, string>>(new Map());
  const [remainingDaily, setRemainingDaily] = useState(initialRemainingDaily);
  const [showBulkReview, setShowBulkReview] = useState(false);
  const [generatingStatuses, setGeneratingStatuses] = useState<Map<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [searchParams, setSearchParams] = useState<{
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
  } | null>(null);

  // Template state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>(EMAIL_TEMPLATES[0].id);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Pagination state
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

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

  // Cleanup retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  // Fetch recent searches on mount
  useEffect(() => {
    getRecentSearchesAction()
      .then(setRecentSearches)
      .catch(() => {})
      .finally(() => setIsLoadingRecent(false));
  }, []);

  // Load templates when session is ready
  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    const loadTemplates = async () => {
      const result = await getTemplatesAction();
      const hardcoded = EMAIL_TEMPLATES[0];
      if (result.success) {
        const combined: TemplateData[] = [
          ...result.templates,
          { id: hardcoded.id, name: hardcoded.name, subject: hardcoded.subject, body: hardcoded.body, isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() },
        ];
        setTemplates(combined);
        const defaultT = result.templates.find((t) => t.isDefault);
        setDefaultTemplateId(defaultT?.id || result.templates[0]?.id || hardcoded.id);
      } else {
        setTemplates([{ id: hardcoded.id, name: hardcoded.name, subject: hardcoded.subject, body: hardcoded.body, isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() }]);
        setDefaultTemplateId(hardcoded.id);
      }
    };
    loadTemplates();
  }, [sessionStatus]);

  const handleRecentSearchClick = (search: RecentSearch) => {
    setFormPrefill({
      company: search.company || undefined,
      role: search.role || undefined,
      university: search.university || undefined,
      location: search.location || undefined,
    });
  };

  const handleSearch = async (params: {
    company?: string;
    role?: string;
    university?: string;
    location?: string;
    limit: number;
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
    setSendErrors(new Map());
    setTotalLoaded(0);
    setHasMore(true);
    setFormPrefill(null);

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

  const handleSendFromReview = async (index: number, subject: string, body: string): Promise<boolean> => {
    const person = results[index];
    if (!person.userCandidateId) return false;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    const personToSend: PersonToSend = {
      email: person.email || undefined,
      subject,
      body,
      userCandidateId: person.userCandidateId,
      resumeId: person.resumeId ?? undefined,
    };

    const result = await sendSingleEmailAction(personToSend);

    setSendStatuses((prev) =>
      new Map(prev).set(person.id, result.success ? 'success' : 'failed')
    );

    // Update local state with resolved email from send result
    if (result.success && result.email && result.email !== 'unknown') {
      setResults((prev) =>
        prev.map((r) =>
          r.id === person.id ? { ...r, email: result.email, emailStatus: r.emailStatus === 'MISSING' ? 'UNVERIFIED' as const : r.emailStatus } : r
        )
      );
    }

    if (result.success) {
      setRemainingDaily((prev) => Math.max(0, prev - 1));
      dispatchCreditsChanged(); // Update header credits display
      return true;
    } else if (result.error === 'LIMIT_REACHED') {
      setShowLimitModal(true);
      setLimitReached(true);
    } else {
      setSendErrors((prev) => new Map(prev).set(person.id, result.error || 'Failed to send email'));
    }
    return false;
  };

  const handleBulkSend = async (emails: { index: number; subject: string; body: string }[]) => {
    const peopleToSend = emails
      .map(({ index, subject, body }) => {
        const person = results[index];
        if (!person.userCandidateId) return null;
        return {
          email: person.email || undefined,
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
      if (person.userCandidateId && !sendStatuses.has(person.id)) {
        newStatuses.set(person.id, 'pending');
      }
    });
    setSendStatuses(newStatuses);

    const result = await sendEmailsAction(peopleToSend);

    if (result.success) {
      const updatedStatuses = new Map(newStatuses);
      let hitLimit = false;
      result.results.forEach((res) => {
        // Match by email or by index position for people who had no email pre-send
        const person = results.find((r) => r.email === res.email) ||
          results.find((r) => !sendStatuses.has(r.id) && !r.email);
        if (person) {
          updatedStatuses.set(person.id, res.success ? 'success' : 'failed');
        }
        if (!res.success && res.error === 'LIMIT_REACHED') {
          hitLimit = true;
        }
      });
      setSendStatuses(updatedStatuses);

      if (hitLimit) {
        setShowLimitModal(true);
        setLimitReached(true);
      }

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

  const handleTemplateChange = async (templateId: string, personIndex: number) => {
    const person = results[personIndex];
    if (!person?.userCandidateId) return;

    setIsRegenerating(true);
    const result = await regenerateDraftAction({
      userCandidateId: person.userCandidateId,
      templateId,
    });

    if (result.success) {
      setResults((prev) =>
        prev.map((r, i) =>
          i === personIndex
            ? { ...r, draftSubject: result.subject, draftBody: result.body, resumeId: result.resumeId }
            : r
        )
      );
    } else {
      setToast({ message: result.error || 'Failed to regenerate draft', type: 'error' });
    }
    setIsRegenerating(false);
  };

  const handleApplyTemplateToAll = async (templateId: string) => {
    setIsRegenerating(true);
    const sendable = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.userCandidateId && !sendStatuses.has(r.id));

    const promises = sendable.map(({ r }) =>
      regenerateDraftAction({ userCandidateId: r.userCandidateId!, templateId })
    );
    const outcomes = await Promise.all(promises);

    setResults((prev) => {
      const updated = [...prev];
      sendable.forEach(({ i }, idx) => {
        const outcome = outcomes[idx];
        if (outcome.success) {
          updated[i] = { ...updated[i], draftSubject: outcome.subject, draftBody: outcome.body, resumeId: outcome.resumeId };
        }
      });
      return updated;
    });
    setIsRegenerating(false);
  };

  const handleLoadMore = useCallback(async () => {
    if (!searchParams?.company || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    setIsRetrying(false);
    try {
      const result = await loadMorePeopleAction({
        company: searchParams.company,
        role: searchParams.role,
        university: searchParams.university,
        location: searchParams.location,
        limit: searchParams.limit,
        excludePersonIds: results.map(r => r.id),
      });

      if (result.success) {
        if (result.results.length > 0) {
          // Got results — append and reset retry count
          setResults(prev => [...prev, ...result.results]);
          setTotalLoaded(prev => prev + result.results.length);
          setHasMore(result.loadMoreMeta.hasMore);
          retryCountRef.current = 0;
        } else if (result.loadMoreMeta.prescrapeRunning && retryCountRef.current < MAX_RETRIES) {
          // 0 results but prescrape still running — auto-retry after delay
          retryCountRef.current++;
          setIsRetrying(true);
          setIsLoadingMore(false);
          console.log(`[LoadMore] Prescrape running, retrying in 3s (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
          retryTimerRef.current = setTimeout(() => {
            handleLoadMore();
          }, 3000);
          return; // Don't clear isLoadingMore below — the retry will handle it
        } else {
          // No results and prescrape done (or retries exhausted)
          setHasMore(false);
          retryCountRef.current = 0;
        }
      } else {
        setToast({ message: result.error || 'Failed to load more profiles', type: 'error' });
      }
    } catch (err) {
      console.error('[LoadMore] Error:', err);
      setToast({ message: 'Failed to load more profiles', type: 'error' });
    }

    setIsRetrying(false);
    setIsLoadingMore(false);
  }, [searchParams, isLoadingMore, hasMore, results]);

  return (
    <div className="relative">
      <SearchForm
        onSearch={handleSearch}
        isLoading={isSearching}
        initialParams={formPrefill || searchParams}
        disabled={limitReached}
        onDisabledClick={() => setShowLimitModal(true)}
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
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isSearching && <SearchLoadingState />}

      {/* Pre-search empty state */}
      {!isSearching && !error && results.length === 0 && !searchParams && (
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

      {!isSearching && !error && results.length === 0 && searchParams && (
        <div className="flex flex-col items-center justify-center py-16 text-surface-500">
          <svg className="w-12 h-12 mb-4 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <p className="text-base font-medium text-surface-600 mb-1">No profiles found</p>
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
            limitReached={limitReached}
            onLimitReached={() => setShowLimitModal(true)}
          />

          {/* Load More Button */}
          {hasMore && !isSearching && (
            <div className="flex flex-col items-center mt-6 gap-1">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore || isRetrying}
                className="btn-secondary flex items-center gap-2"
              >
                {isLoadingMore || isRetrying ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {isRetrying ? 'Still searching for profiles...' : 'Loading...'}
                  </>
                ) : (
                  'Load More Profiles'
                )}
              </button>
              {isRetrying && (
                <p className="text-sm text-surface-500">
                  Background search is still finding profiles. Retrying automatically...
                </p>
              )}
            </div>
          )}

          {/* No More Results Message */}
          {!hasMore && (
            <p className="text-center text-surface-500 mt-6">
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
          sendErrors={sendErrors}
          templates={templates}
          defaultTemplateId={defaultTemplateId}
          onTemplateChange={handleTemplateChange}
          isRegenerating={isRegenerating}
          limitReached={limitReached}
          onLimitReached={() => setShowLimitModal(true)}
        />
      )}

      {showBulkReview && (
        <BulkReview
          results={results}
          onClose={() => setShowBulkReview(false)}
          onSendAll={handleBulkSend}
          sendStatuses={sendStatuses}
          templates={templates}
          onApplyTemplateToAll={handleApplyTemplateToAll}
          isRegenerating={isRegenerating}
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
          setLimitReached(false);
          setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged(); // Update header credits display
        }}
      />
    </div>
  );
}
