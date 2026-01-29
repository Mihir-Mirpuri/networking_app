'use client';

import { useState, useEffect } from 'react';
import { MeetingSuggestionCard } from '@/components/calendar/MeetingSuggestionCard';
import {
  getPendingSuggestionsAction,
  acceptSuggestionAction,
  dismissSuggestionAction,
} from '@/app/actions/meetingSuggestions';
import { MeetingSuggestionWithMessage } from '@/lib/types/meetingSuggestion';
import { CreateEventInput } from '@/components/calendar/types';
import Link from 'next/link';
import { usePolling } from '@/hooks/usePolling';

export function SuggestionsClient() {
  const [suggestions, setSuggestions] = useState<MeetingSuggestionWithMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const { data: fetchedSuggestions, error: fetchError } = usePolling(
    async () => {
      const result = await getPendingSuggestionsAction();
      if (result.success && result.data) {
        return result.data;
      }
      throw new Error(result.error || 'Failed to load suggestions');
    },
    { interval: 30000, enabled: true }
  );

  // Sync fetched data to local state for optimistic updates
  useEffect(() => {
    if (fetchedSuggestions) {
      setSuggestions(fetchedSuggestions);
      setInitialLoading(false);
      setError(null);
    }
  }, [fetchedSuggestions]);

  // Handle fetch errors
  useEffect(() => {
    if (fetchError) {
      setError(fetchError.message);
      setInitialLoading(false);
    }
  }, [fetchError]);

  async function handleAccept(suggestionId: string, eventData: CreateEventInput) {
    setActionInProgress(suggestionId);
    setError(null);

    const result = await acceptSuggestionAction(suggestionId, eventData);

    if (result.success) {
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } else if (result.requiresReauth) {
      setError('Calendar access expired. Please reconnect your calendar.');
    } else {
      setError(result.error || 'Failed to create event');
    }

    setActionInProgress(null);
  }

  async function handleDismiss(suggestionId: string) {
    setActionInProgress(suggestionId);
    setError(null);

    const result = await dismissSuggestionAction(suggestionId);

    if (result.success) {
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } else {
      setError(result.error || 'Failed to dismiss suggestion');
    }

    setActionInProgress(null);
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Loading suggestions...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meeting Suggestions</h1>
          <p className="text-gray-600 mt-1">
            AI-detected meetings from your emails
          </p>
        </div>
        <Link
          href="/calendar"
          className="text-blue-600 hover:text-blue-700 text-sm font-medium"
        >
          ← Back to Calendar
        </Link>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {suggestions.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No pending suggestions</h3>
          <p className="mt-2 text-gray-500">
            When we detect meetings in your emails, they&apos;ll appear here.
          </p>
          <Link
            href="/calendar"
            className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
          >
            View Calendar
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {suggestions.map((suggestion) => (
            <MeetingSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
              isLoading={actionInProgress === suggestion.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
