'use client';

import { useState } from 'react';
import { getSendLogs, SendLogEntry } from '@/app/actions/sendlog';
import { updateScheduledEmailAction, cancelScheduledEmailAction, sendFollowUpAction } from '@/app/actions/send';
import { generateFollowUpAction } from '@/app/actions/personalize';

interface GroupedLogs {
  [date: string]: SendLogEntry[];
}

interface EmailHistoryClientProps {
  initialLogs: SendLogEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
}

interface FollowUpData {
  sendLogId: string;
  subject: string;
  body: string;
  toEmail: string;
  toName: string | null;
  company: string | null;
  gmailThreadId: string;
  gmailMessageId?: string;
  userCandidateId: string;
}

export function EmailHistoryClient({
  initialLogs,
  initialCursor,
  initialHasMore,
}: EmailHistoryClientProps) {
  const [logs, setLogs] = useState<SendLogEntry[]>(initialLogs);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduledDateTime, setEditScheduledDateTime] = useState('');
  const [editScheduleError, setEditScheduleError] = useState<string | null>(null);
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [isCanceling, setIsCanceling] = useState<string | null>(null);

  // Follow-up state
  const [followUpData, setFollowUpData] = useState<FollowUpData | null>(null);
  const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState<string | null>(null);
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsLoading(true);
    setIsSearchMode(!!searchQuery);
    const result = await getSendLogs(searchQuery || undefined, undefined);
    if (result.success) {
      setLogs(result.logs);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    setIsLoading(false);
  };

  const handleClearSearch = async () => {
    setSearchQuery('');
    setIsLoading(true);
    setIsSearchMode(false);
    const result = await getSendLogs(undefined, undefined);
    if (result.success) {
      setLogs(result.logs);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    setIsLoading(false);
  };

  const handleLoadMore = async () => {
    if (!cursor || isLoadingMore) return;

    setIsLoadingMore(true);
    const result = await getSendLogs(isSearchMode ? searchQuery : undefined, cursor);
    if (result.success) {
      setLogs((prev) => [...prev, ...result.logs]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    setIsLoadingMore(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDateKey = (date: Date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const groupLogsByDay = (logs: SendLogEntry[]): GroupedLogs => {
    return logs.reduce((groups: GroupedLogs, log) => {
      const dateKey = getDateKey(log.sentAt);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(log);
      return groups;
    }, {});
  };

  const formatCountdown = (scheduledFor: Date): string => {
    const now = new Date();
    const diff = scheduledFor.getTime() - now.getTime();

    if (diff <= 0) return 'Sending soon...';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const handleEditSchedule = async (scheduledEmailId: string, currentScheduledFor: Date) => {
    if (!editScheduledDateTime) {
      setEditScheduleError('Please select a date and time');
      return;
    }

    const selectedDate = new Date(editScheduledDateTime);
    const now = new Date();
    const minScheduledTime = new Date(now.getTime() + 5 * 60 * 1000);

    if (selectedDate < minScheduledTime) {
      setEditScheduleError('Scheduled time must be at least 5 minutes in the future');
      return;
    }

    setIsUpdatingSchedule(true);
    setEditScheduleError(null);

    try {
      const result = await updateScheduledEmailAction(scheduledEmailId, selectedDate);
      if (result.success) {
        setEditingScheduleId(null);
        setEditScheduledDateTime('');
        // Refresh logs
        const refreshResult = await getSendLogs(isSearchMode ? searchQuery : undefined, undefined);
        if (refreshResult.success) {
          setLogs(refreshResult.logs);
          setCursor(refreshResult.nextCursor);
          setHasMore(refreshResult.hasMore);
        }
      } else {
        setEditScheduleError(result.error || 'Failed to update scheduled time');
      }
    } catch (error) {
      setEditScheduleError(error instanceof Error ? error.message : 'Failed to update scheduled time');
    } finally {
      setIsUpdatingSchedule(false);
    }
  };

  const handleCancelSchedule = async (scheduledEmailId: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled email?')) {
      return;
    }

    setIsCanceling(scheduledEmailId);
    try {
      const result = await cancelScheduledEmailAction(scheduledEmailId);
      if (result.success) {
        // Refresh logs
        const refreshResult = await getSendLogs(isSearchMode ? searchQuery : undefined, undefined);
        if (refreshResult.success) {
          setLogs(refreshResult.logs);
          setCursor(refreshResult.nextCursor);
          setHasMore(refreshResult.hasMore);
        }
      } else {
        alert(result.error || 'Failed to cancel scheduled email');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to cancel scheduled email');
    } finally {
      setIsCanceling(null);
    }
  };

  const handleGenerateFollowUp = async (sendLogId: string) => {
    setIsGeneratingFollowUp(sendLogId);
    setFollowUpError(null);

    try {
      const result = await generateFollowUpAction(sendLogId);
      if (result.success && result.subject && result.body && result.gmailThreadId && result.userCandidateId) {
        setFollowUpData({
          sendLogId,
          subject: result.subject,
          body: result.body,
          toEmail: result.toEmail || '',
          toName: result.toName || null,
          company: result.company || null,
          gmailThreadId: result.gmailThreadId,
          gmailMessageId: result.gmailMessageId,
          userCandidateId: result.userCandidateId,
        });
      } else {
        setFollowUpError(result.error || 'Failed to generate follow-up');
      }
    } catch (error) {
      setFollowUpError(error instanceof Error ? error.message : 'Failed to generate follow-up');
    } finally {
      setIsGeneratingFollowUp(null);
    }
  };

  const handleSendFollowUp = async () => {
    if (!followUpData) return;

    setIsSendingFollowUp(true);
    setFollowUpError(null);

    try {
      const result = await sendFollowUpAction({
        toEmail: followUpData.toEmail,
        subject: followUpData.subject,
        body: followUpData.body,
        threadId: followUpData.gmailThreadId,
        originalMessageId: followUpData.gmailMessageId,
        userCandidateId: followUpData.userCandidateId,
      });

      if (result.success) {
        setFollowUpData(null);
        // Refresh logs to show the new follow-up
        const refreshResult = await getSendLogs(isSearchMode ? searchQuery : undefined, undefined);
        if (refreshResult.success) {
          setLogs(refreshResult.logs);
          setCursor(refreshResult.nextCursor);
          setHasMore(refreshResult.hasMore);
        }
      } else {
        setFollowUpError(result.error || 'Failed to send follow-up');
      }
    } catch (error) {
      setFollowUpError(error instanceof Error ? error.message : 'Failed to send follow-up');
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  const groupedLogs = groupLogsByDay(logs);
  const sortedDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Email History</h1>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by name, email, company, or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          {isSearchMode && (
            <button
              onClick={handleClearSearch}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">Loading...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">{isSearchMode ? 'No emails found' : 'No emails sent yet'}</p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {sortedDates.map((dateKey) => (
              <div key={dateKey}>
                <h2 className="text-lg font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">
                  {formatDate(new Date(dateKey))}
                </h2>
                <div className="space-y-3">
                  {groupedLogs[dateKey].map((log) => (
                    <div
                      key={log.id}
                      className="bg-white rounded-lg shadow p-4"
                    >
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === log.id ? null : log.id)
                        }
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-900">
                              {log.toName || log.toEmail}
                            </span>
                            {log.isScheduled ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                Scheduled
                              </span>
                            ) : (
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  log.status === 'SUCCESS'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {log.status === 'SUCCESS' ? 'Sent' : 'Failed'}
                              </span>
                            )}
                            {log.isScheduled && log.scheduledFor && (
                              <span className="text-xs text-gray-500">
                                {formatCountdown(log.scheduledFor)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Follow Up button - only show for successfully sent emails (not scheduled) */}
                            {!log.isScheduled && log.status === 'SUCCESS' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGenerateFollowUp(log.id);
                                }}
                                disabled={isGeneratingFollowUp === log.id}
                                className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
                              >
                                {isGeneratingFollowUp === log.id ? 'Generating...' : 'Follow Up'}
                              </button>
                            )}
                            <span className="text-sm text-gray-500">
                              {log.isScheduled && log.scheduledFor
                                ? formatTime(log.scheduledFor)
                                : formatTime(log.sentAt)}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">{log.company}</p>
                        <p className="text-sm text-gray-500 truncate mt-1">
                          Subject: {log.subject}
                        </p>
                      </button>

                      {expandedId === log.id && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <div className="mb-3">
                            <p className="text-xs font-medium text-gray-500 mb-1">To:</p>
                            <p className="text-sm text-gray-900">{log.toEmail}</p>
                          </div>
                          <div className="mb-3">
                            <p className="text-xs font-medium text-gray-500 mb-1">Subject:</p>
                            <p className="text-sm text-gray-900">{log.subject}</p>
                          </div>
                          <div className="mb-3">
                            <p className="text-xs font-medium text-gray-500 mb-1">Body:</p>
                            <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                              {log.body}
                            </p>
                          </div>
                          {log.isScheduled && log.scheduledEmailId && log.status === 'PENDING' && (
                            <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2">
                              <button
                                onClick={() => {
                                  if (log.scheduledFor) {
                                    const localDateTime = new Date(log.scheduledFor.getTime() - log.scheduledFor.getTimezoneOffset() * 60000)
                                      .toISOString()
                                      .slice(0, 16);
                                    setEditScheduledDateTime(localDateTime);
                                    setEditingScheduleId(log.scheduledEmailId!);
                                    setEditScheduleError(null);
                                  }
                                }}
                                className="px-3 py-1.5 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
                              >
                                Edit Time
                              </button>
                              <button
                                onClick={() => log.scheduledEmailId && handleCancelSchedule(log.scheduledEmailId)}
                                disabled={isCanceling === log.scheduledEmailId}
                                className="px-3 py-1.5 text-sm border border-red-600 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50"
                              >
                                {isCanceling === log.scheduledEmailId ? 'Canceling...' : 'Cancel'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Edit Schedule Modal */}
      {editingScheduleId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Edit Scheduled Time</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Date & Time
              </label>
              <input
                type="datetime-local"
                value={editScheduledDateTime}
                onChange={(e) => {
                  setEditScheduledDateTime(e.target.value);
                  setEditScheduleError(null);
                }}
                min={new Date(new Date().getTime() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Minimum: 5 minutes from now
              </p>
            </div>

            {editScheduleError && (
              <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md text-sm">
                {editScheduleError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setEditingScheduleId(null);
                  setEditScheduledDateTime('');
                  setEditScheduleError(null);
                }}
                disabled={isUpdatingSchedule}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => editingScheduleId && handleEditSchedule(editingScheduleId, new Date(editScheduledDateTime))}
                disabled={isUpdatingSchedule || !editScheduledDateTime}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingSchedule ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow Up Modal */}
      {followUpData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Follow Up Email</h3>

            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                To: <span className="font-medium text-gray-900">{followUpData.toName || followUpData.toEmail}</span>
                {followUpData.company && <span className="text-gray-500"> at {followUpData.company}</span>}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Subject
              </label>
              <input
                type="text"
                value={followUpData.subject}
                onChange={(e) => setFollowUpData({ ...followUpData, subject: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message
              </label>
              <textarea
                value={followUpData.body}
                onChange={(e) => setFollowUpData({ ...followUpData, body: e.target.value })}
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>

            {followUpError && (
              <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md text-sm">
                {followUpError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setFollowUpData(null);
                  setFollowUpError(null);
                }}
                disabled={isSendingFollowUp}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendFollowUp}
                disabled={isSendingFollowUp || !followUpData.body.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingFollowUp ? 'Sending...' : 'Send Follow Up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
