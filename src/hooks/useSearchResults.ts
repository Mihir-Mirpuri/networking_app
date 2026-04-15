'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchResultWithDraft, regenerateDraftAction, loadMoreV2Action } from '@/app/actions/search';
import { sendSingleEmailAction, sendEmailsAction, PersonToSend } from '@/app/actions/send';
import { getTemplatesAction, getAutoPersonalizeAction, TemplateData } from '@/app/actions/profile';
import { hidePersonAction, toggleSavedForLaterAction } from '@/app/actions/search';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import { dispatchCreditsChanged } from '@/components/credits';
import { useSession } from 'next-auth/react';
import type { LinkedInFilters, DBFilters } from '@/lib/types/linkedin-filters';

export interface SearchParams {
  company?: string;
  role?: string;
  university?: string;
  location?: string;
  limit: number;
  skipLocationInSearch?: boolean;
  companyNameAmbiguous?: boolean;
}

export interface SearchResultsMeta {
  hasMore: boolean;
}

export interface UseSearchResultsOptions {
  initialRemainingDaily: number;
}

export function useSearchResults({ initialRemainingDaily }: UseSearchResultsOptions) {
  const { status: sessionStatus } = useSession();

  // Results state
  const [results, setResults] = useState<SearchResultWithDraft[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sendStatuses, setSendStatuses] = useState<Map<string, 'success' | 'failed' | 'pending'>>(new Map());
  const [sendErrors, setSendErrors] = useState<Map<string, string>>(new Map());
  const [remainingDaily, setRemainingDaily] = useState(initialRemainingDaily);
  const [showBulkReview, setShowBulkReview] = useState(false);
  const [generatingStatuses, setGeneratingStatuses] = useState<Map<string, boolean>>(new Map());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams | null>(null);

  // Template state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>(EMAIL_TEMPLATES[0].id);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [autoPersonalize, setAutoPersonalize] = useState(false);

  // Pagination state
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);


  // V2 unified pagination state:
  //   allBatchResults = every profile fetched so far (initial search + all
  //     subsequent Load More pages). The visible slice is results[0..visibleCount].
  //   serverHasMore   = does the server still have more pages for this filter set?
  //                     Updated from the initial search and every Load More response.
  const [allBatchResults, setAllBatchResults] = useState<SearchResultWithDraft[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [linkedInFilters, setLinkedInFilters] = useState<LinkedInFilters | null>(null);
  const [dbFilters, setDbFilters] = useState<DBFilters | null>(null);
  const PAGE_SIZE = 6;

  // Cleanup retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  // Cancel all retry timers and reset retry state
  const cancelRetries = useCallback(() => {
    if (retryTimerRef.current) {
      console.log('[CancelSearch] Clearing Load More retry timer');
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    setIsRetrying(false);
    setIsLoadingMore(false);
  }, []);

  // Load templates and user preferences when session is ready
  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    const loadTemplatesAndPrefs = async () => {
      // Load templates
      const result = await getTemplatesAction();
      // Convert all hardcoded templates to TemplateData format
      const hardcodedTemplates: TemplateData[] = EMAIL_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        subject: t.subject,
        body: t.body,
        isDefault: false,
        attachResume: false,
        resumeId: null,
        createdAt: new Date(),
      }));
      if (result.success) {
        const combined: TemplateData[] = [
          ...result.templates,
          ...hardcodedTemplates,
        ];
        setTemplates(combined);
        const defaultT = result.templates.find((t) => t.isDefault);
        setDefaultTemplateId(defaultT?.id || result.templates[0]?.id || EMAIL_TEMPLATES[0].id);
      } else {
        setTemplates(hardcodedTemplates);
        setDefaultTemplateId(EMAIL_TEMPLATES[0].id);
      }
      // Load autoPersonalize preference
      const autoPersonalizePref = await getAutoPersonalizeAction();
      setAutoPersonalize(autoPersonalizePref);
    };
    loadTemplatesAndPrefs();
  }, [sessionStatus]);

  // Reset all results state for a new search
  const resetResults = useCallback(() => {
    setResults([]);
    setSendStatuses(new Map());
    setSendErrors(new Map());
    setExpandedIndex(null);
    setShowBulkReview(false);
    setGeneratingStatuses(new Map());
    setTotalLoaded(0);
    setHasMore(true);
    setHiddenCount(0);
    // Reset V2 unified pagination state
    setAllBatchResults([]);
    setVisibleCount(0);
    setServerHasMore(false);
    setLinkedInFilters(null);
    setDbFilters(null);
  }, []);

  // Apply search results after a search completes.
  //
  // Unified pagination: every search (simple or advanced) caches the full
  // returned batch in allBatchResults and reveals PAGE_SIZE at a time.
  // hasMore is true if the cache still has unshown items OR the server has
  // more pages for this filter set.
  const applySearchResults = useCallback((
    newResults: SearchResultWithDraft[],
    meta: SearchResultsMeta,
    newHiddenCount: number,
    params: SearchParams,
    v2Meta?: {
      linkedInFilters: LinkedInFilters;
      dbFilters: DBFilters;
    }
  ) => {
    setHiddenCount(newHiddenCount);
    setSearchParams(params);

    if (v2Meta) {
      setLinkedInFilters(v2Meta.linkedInFilters);
      setDbFilters(v2Meta.dbFilters);
    }

    setAllBatchResults(newResults);
    const initialVisible = Math.min(PAGE_SIZE, newResults.length);
    setVisibleCount(initialVisible);
    setResults(newResults.slice(0, initialVisible));
    setTotalLoaded(initialVisible);
    setServerHasMore(meta.hasMore);
    setHasMore(initialVisible < newResults.length || meta.hasMore);
  }, []);

  const handleSendFromReview = async (index: number, subject: string, body: string, resumeIdOverride?: string | null): Promise<boolean> => {
    const person = results[index];
    if (!person.userCandidateId) return false;

    setSendStatuses((prev) => new Map(prev).set(person.id, 'pending'));

    // Use override if provided (including null to remove), otherwise fall back to template's resumeId
    const resumeId = resumeIdOverride !== undefined ? resumeIdOverride : person.resumeId;

    const personToSend: PersonToSend = {
      email: person.email || undefined,
      subject,
      body,
      userCandidateId: person.userCandidateId,
      resumeId: resumeId ?? undefined,
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
      dispatchCreditsChanged();
      return true;
    } else if (result.error === 'LIMIT_REACHED') {
      setShowLimitModal(true);
      setLimitReached(true);
    } else if (result.error === 'Not authenticated') {
      // Don't show error for unauthenticated users - they should be redirected to sign in
      return false;
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
        dispatchCreditsChanged();
      }
    }

    setIsSending(false);
  };

  const handleHidePerson = async (userCandidateId: string) => {
    const result = await hidePersonAction(userCandidateId);

    if (result.success) {
      setResults((prev) => prev.filter((r) => r.userCandidateId !== userCandidateId));
      setHiddenCount((prev) => prev + 1);
    } else if (result.error !== 'Not authenticated') {
      // Don't show error for unauthenticated users
      setToast({ message: result.error || 'Failed to hide person', type: 'error' });
    }
  };

  const handleToggleSaveForLater = async (userCandidateId: string) => {
    const result = await toggleSavedForLaterAction(userCandidateId);

    if (result.success) {
      setResults((prev) =>
        prev.map((r) =>
          r.userCandidateId === userCandidateId ? { ...r, savedForLater: result.savedForLater } : r
        )
      );
    } else if (result.error !== 'Not authenticated') {
      setToast({ message: result.error || 'Failed to update', type: 'error' });
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
    } else if (result.error !== 'Not authenticated') {
      // Don't show error for unauthenticated users
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

  // Unified Load More — works for both simple and advanced queries.
  //
  //   Tier 1: reveal the next PAGE_SIZE from the local cache (no API call)
  //   Tier 2: if the cache is drained and the server still has more, fetch
  //           the next Apify page, append to cache, reveal next slice.
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    // ── Tier 1: reveal from cache ─────────────────────────────────────
    const nextVisible = visibleCount + PAGE_SIZE;
    if (nextVisible <= allBatchResults.length) {
      const newVisible = Math.min(nextVisible, allBatchResults.length);
      setVisibleCount(newVisible);
      setResults(allBatchResults.slice(0, newVisible));
      setTotalLoaded(newVisible);
      setHasMore(newVisible < allBatchResults.length || serverHasMore);
      return;
    }

    // ── Tier 2: fetch next Apify page from the server ─────────────────
    if (!serverHasMore || !linkedInFilters || !dbFilters) {
      setHasMore(false);
      return;
    }

    setIsLoadingMore(true);
    try {
      const result = await loadMoreV2Action({
        linkedInFilters,
        dbFilters,
        excludePersonIds: allBatchResults.map(r => r.id),
      });

      if (result.success) {
        if (result.results.length > 0) {
          const newBatch = [...allBatchResults, ...result.results];
          setAllBatchResults(newBatch);
          const newVisible = Math.min(visibleCount + PAGE_SIZE, newBatch.length);
          setVisibleCount(newVisible);
          setResults(newBatch.slice(0, newVisible));
          setTotalLoaded(newVisible);
          setServerHasMore(result.hasMore);
          setHasMore(newVisible < newBatch.length || result.hasMore);
        } else {
          // Server says nothing new (exhausted or all dedup'd) — stop.
          setServerHasMore(false);
          setHasMore(false);
        }
      } else if (result.error !== 'Not authenticated') {
        setToast({ message: result.error || 'Failed to load more profiles', type: 'error' });
      }
    } catch (err) {
      console.error('[LoadMore] Error:', err);
      setToast({ message: 'Failed to load more profiles', type: 'error' });
    }

    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore, visibleCount, allBatchResults, serverHasMore, linkedInFilters, dbFilters]);

  return {
    // State
    results,
    setResults,
    isSending,
    expandedIndex,
    setExpandedIndex,
    sendStatuses,
    setSendStatuses,
    sendErrors,
    remainingDaily,
    setRemainingDaily,
    showBulkReview,
    setShowBulkReview,
    generatingStatuses,
    setGeneratingStatuses,
    toast,
    setToast,
    showLimitModal,
    setShowLimitModal,
    limitReached,
    setLimitReached,
    searchParams,
    setSearchParams,
    templates,
    defaultTemplateId,
    isRegenerating,
    autoPersonalize,
    totalLoaded,
    setTotalLoaded,
    hasMore,
    setHasMore,
    isLoadingMore,
    isRetrying,
    hiddenCount,
    setHiddenCount,

    // Actions
    cancelRetries,
    resetResults,
    applySearchResults,
    handleSendFromReview,
    handleBulkSend,
    handleHidePerson,
    handleToggleSaveForLater,
    handleTemplateChange,
    handleApplyTemplateToAll,
    handleLoadMore,
  };
}
