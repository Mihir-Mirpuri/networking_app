'use client';

import { useState, useEffect } from 'react';
import { getSendLogs, SendLogEntry } from '@/app/actions/sendlog';
import { updateScheduledEmailAction, cancelScheduledEmailAction, sendFollowUpAction } from '@/app/actions/send';
import { generateFollowUpAction } from '@/app/actions/personalize';
import { Toast } from '@/components/ui/Toast';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';

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

type TabType = 'all' | 'ongoing' | 'no-response';

type TimeFilter = 'all' | 'custom' | number; // number represents days

const TIME_FILTER_PRESETS: { value: TimeFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 1, label: 'Last 24 hours' },
  { value: 3, label: 'Last 3 days' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 'custom', label: 'Custom...' },
];

export function EmailHistoryClient({
  initialLogs,
  initialCursor,
  initialHasMore,
}: EmailHistoryClientProps) {
  const [logs, setLogs] = useState<SendLogEntry[]>(initialLogs);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [customDays, setCustomDays] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState(false);
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

  // ESC to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (followUpData) {
          setFollowUpData(null);
          setFollowUpError(null);
        } else if (editingScheduleId) {
          setEditingScheduleId(null);
          setEditScheduledDateTime('');
          setEditScheduleError(null);
        }
      }
    };
    if (followUpData || editingScheduleId) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [followUpData, editingScheduleId]);

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

  // Filter logs by time range
  const filterByTime = (logs: SendLogEntry[]): SendLogEntry[] => {
    if (timeFilter === 'all') return logs;
    if (timeFilter === 'custom') return logs; // Custom without valid input shows all

    const days = typeof timeFilter === 'number' ? timeFilter : 0;
    if (days <= 0) return logs;

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return logs.filter((log) => {
      const sentDate = new Date(log.sentAt);
      return sentDate >= cutoffDate;
    });
  };

  // Get display label for current time filter
  const getTimeFilterLabel = (): string => {
    if (timeFilter === 'all') return 'All time';
    if (timeFilter === 'custom') return 'Custom';
    const preset = TIME_FILTER_PRESETS.find((p) => p.value === timeFilter);
    if (preset) return preset.label;
    return `Last ${timeFilter} days`;
  };

  // Filter logs based on active tab
  const getFilteredLogs = (logs: SendLogEntry[]): SendLogEntry[] => {
    switch (activeTab) {
      case 'ongoing':
        // Show only emails with responses (ongoing conversations)
        return logs.filter((log) => log.hasResponse === true);
      case 'no-response':
        // Show sent emails without responses (excluding scheduled/failed)
        return logs.filter(
          (log) => log.status === 'SUCCESS' && !log.isScheduled && log.hasResponse === false
        );
      case 'all':
      default:
        return logs;
    }
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
        setToast({ message: result.error || 'Failed to cancel scheduled email', type: 'error' });
      }
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Failed to cancel scheduled email', type: 'error' });
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
      } else if (result.error === 'LIMIT_REACHED') {
        setShowLimitModal(true);
        setLimitReached(true);
        setFollowUpError(null);
      } else {
        setFollowUpError(result.error || 'Failed to send follow-up');
      }
    } catch (error) {
      setFollowUpError(error instanceof Error ? error.message : 'Failed to send follow-up');
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  // Apply time filter first, then tab filter
  const timeFilteredLogs = filterByTime(logs);
  const filteredLogs = getFilteredLogs(timeFilteredLogs);
  const groupedLogs = groupLogsByDay(filteredLogs);
  const sortedDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a));

  // Count for tab badges (based on time-filtered logs)
  const ongoingCount = timeFilteredLogs.filter((log) => log.hasResponse === true).length;
  const noResponseCount = timeFilteredLogs.filter(
    (log) => log.status === 'SUCCESS' && !log.isScheduled && log.hasResponse === false
  ).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-900 mb-4">Email History</h1>

        {/* Tabs */}
        <nav className="inline-flex p-1 bg-surface-100 rounded-xl mb-4" aria-label="Email history tabs">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'all'
                ? 'bg-surface-100 text-primary-700 shadow-soft'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            Sent
            <span className={`px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'all' ? 'bg-primary-100 text-primary-700' : 'bg-surface-200 text-surface-600'
            }`}>
              {timeFilteredLogs.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('ongoing')}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'ongoing'
                ? 'bg-surface-100 text-primary-700 shadow-soft'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            Ongoing
            {ongoingCount > 0 && (
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                activeTab === 'ongoing' ? 'bg-green-900/30 text-green-400' : 'bg-surface-200 text-surface-600'
              }`}>
                {ongoingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('no-response')}
            className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'no-response'
                ? 'bg-surface-100 text-primary-700 shadow-soft'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            No Response
            {noResponseCount > 0 && (
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                activeTab === 'no-response' ? 'bg-orange-100 text-orange-700' : 'bg-surface-200 text-surface-600'
              }`}>
                {noResponseCount}
              </span>
            )}
          </button>
        </nav>

        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search by name, email, company, or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="input flex-1 min-w-[200px]"
          />
          <div className="flex gap-2">
            {showCustomInput ? (
              <div className="flex items-center gap-1">
                <span className="text-sm text-surface-600">Last</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customDays) {
                      const days = parseInt(customDays, 10);
                      if (days > 0) {
                        setTimeFilter(days);
                        setShowCustomInput(false);
                      }
                    }
                    if (e.key === 'Escape') {
                      setShowCustomInput(false);
                      setCustomDays('');
                    }
                  }}
                  placeholder="days"
                  className="input w-20"
                  autoFocus
                />
                <span className="text-sm text-surface-600">days</span>
                <button
                  onClick={() => {
                    const days = parseInt(customDays, 10);
                    if (days > 0) {
                      setTimeFilter(days);
                      setShowCustomInput(false);
                    }
                  }}
                  disabled={!customDays || parseInt(customDays, 10) <= 0}
                  className="btn-primary text-sm px-2"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomDays('');
                  }}
                  className="px-2 py-2 text-sm text-surface-600 hover:text-surface-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <select
                value={typeof timeFilter === 'number' && !TIME_FILTER_PRESETS.some(p => p.value === timeFilter) ? 'custom' : timeFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setShowCustomInput(true);
                    setCustomDays('');
                  } else if (val === 'all') {
                    setTimeFilter('all');
                  } else {
                    setTimeFilter(parseInt(val, 10));
                  }
                }}
                className="input cursor-pointer"
              >
                {TIME_FILTER_PRESETS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
                {/* Show custom value if it's not a preset */}
                {typeof timeFilter === 'number' && !TIME_FILTER_PRESETS.some(p => p.value === timeFilter) && (
                  <option value={timeFilter}>Last {timeFilter} days</option>
                )}
              </select>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="btn-primary text-sm"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          {isSearchMode && (
            <button
              onClick={handleClearSearch}
              disabled={isLoading}
              className="btn-secondary text-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-surface-500">Loading email history...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          {isSearchMode ? (
            <>
              <svg className="w-12 h-12 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-base font-medium text-surface-600">No matching emails</p>
              <p className="text-sm text-surface-500">Try a different search term or clear the filter</p>
            </>
          ) : timeFilter !== 'all' ? (
            <>
              <svg className="w-12 h-12 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-base font-medium text-surface-600">No emails in this period</p>
              <p className="text-sm text-surface-500">No emails found in the {getTimeFilterLabel().toLowerCase()}</p>
            </>
          ) : activeTab === 'ongoing' ? (
            <>
              <svg className="w-12 h-12 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
              <p className="text-base font-medium text-surface-600">No ongoing conversations yet</p>
              <p className="text-sm text-surface-500">Conversations will appear here when contacts reply</p>
            </>
          ) : activeTab === 'no-response' ? (
            <>
              <svg className="w-12 h-12 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <p className="text-base font-medium text-surface-600">No emails awaiting response</p>
              <p className="text-sm text-surface-500">All sent emails have been responded to</p>
            </>
          ) : (
            <div className="border border-surface-300 rounded-md overflow-hidden">
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1fr_2fr_auto_auto] gap-4 px-4 py-2.5 bg-surface-100 border-b border-surface-300 text-xs font-semibold text-surface-500 uppercase tracking-wide">
                <span>Recipient</span>
                <span>Company</span>
                <span>Subject</span>
                <span>Status</span>
                <span className="text-right">Sent</span>
              </div>
              {/* Placeholder rows */}
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`grid grid-cols-[1fr_1fr_2fr_auto_auto] gap-4 px-4 py-3.5 ${i < 3 ? 'border-b border-surface-200' : ''}`}>
                  <div className="h-3 w-24 bg-surface-100 rounded" />
                  <div className="h-3 w-20 bg-surface-100 rounded" />
                  <div className="h-3 w-40 bg-surface-100 rounded" />
                  <div className="h-5 w-12 bg-surface-100 rounded-full" />
                  <div className="h-3 w-14 bg-surface-100 rounded ml-auto" />
                </div>
              ))}
              {/* Empty state message overlay */}
              <div className="flex flex-col items-center justify-center py-8 -mt-[180px] mb-4 relative z-10">
                <svg className="w-10 h-10 text-surface-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                <p className="text-base font-medium text-surface-600">No emails sent yet</p>
                <p className="text-sm text-surface-500">Start by finding contacts and sending your first outreach</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="border border-surface-300 rounded-md overflow-hidden">
            {sortedDates.map((dateKey, dateIndex) => (
              <div key={dateKey}>
                <h2 className={`text-sm font-semibold text-surface-700 px-4 py-2 bg-surface-100 border-b border-surface-300 ${dateIndex > 0 ? 'border-t border-surface-300' : ''}`}>
                  {formatDate(new Date(dateKey))}
                </h2>
                <div className="divide-y divide-surface-200">
                  {groupedLogs[dateKey].map((log) => (
                    <div
                      key={log.id}
                      className="bg-surface-100 px-4 py-3 hover:bg-surface-50"
                    >
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === log.id ? null : log.id)
                        }
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-[#e0e0e0]">
                              {log.toName || log.toEmail}
                            </span>
                            {log.isDirectSend && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                                Direct
                              </span>
                            )}
                            {log.isScheduled ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary-100 text-primary-800">
                                Scheduled
                              </span>
                            ) : (
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  log.status === 'SUCCESS'
                                    ? 'bg-green-900/30 text-green-400'
                                    : 'bg-red-900/30 text-red-400'
                                }`}
                              >
                                {log.status === 'SUCCESS' ? 'Sent' : 'Failed'}
                              </span>
                            )}
                            {log.isScheduled && log.scheduledFor && (
                              <span className="text-xs text-surface-500">
                                {formatCountdown(log.scheduledFor)}
                              </span>
                            )}
                            {/* Response status indicator */}
                            {!log.isScheduled && log.status === 'SUCCESS' && (
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  log.hasResponse
                                    ? 'bg-green-900/30 text-green-400'
                                    : 'bg-orange-100 text-orange-800'
                                }`}
                              >
                                {log.hasResponse ? 'Replied' : 'Awaiting'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Follow Up button - only show for successfully sent emails (not scheduled) */}
                            {!log.isScheduled && log.status === 'SUCCESS' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (limitReached) {
                                    setShowLimitModal(true);
                                  } else {
                                    handleGenerateFollowUp(log.id);
                                  }
                                }}
                                disabled={isGeneratingFollowUp === log.id}
                                className={`px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50${limitReached ? ' opacity-50 cursor-not-allowed' : ''}`}
                              >
                                {isGeneratingFollowUp === log.id ? 'Generating...' : limitReached ? 'Limit reached' : 'Follow Up'}
                              </button>
                            )}
                            <span className="text-sm text-surface-500">
                              {log.isScheduled && log.scheduledFor
                                ? formatTime(log.scheduledFor)
                                : formatTime(log.sentAt)}
                            </span>
                          </div>
                        </div>
                        {log.company && <p className="text-sm text-surface-600">{log.company}</p>}
                        <p className="text-sm text-surface-500 truncate mt-1">
                          Subject: {log.subject}
                        </p>
                      </button>

                      {expandedId === log.id && (
                        <div className="mt-3 pt-3 border-t border-surface-300">
                          <div className="mb-3">
                            <p className="text-xs font-medium text-surface-500 mb-1">To:</p>
                            <p className="text-sm text-surface-900">{log.toEmail}</p>
                          </div>
                          <div className="mb-3">
                            <p className="text-xs font-medium text-surface-500 mb-1">Subject:</p>
                            <p className="text-sm text-surface-900">{log.subject}</p>
                          </div>
                          <div className="mb-3">
                            <p className="text-xs font-medium text-surface-500 mb-1">Body:</p>
                            <p className="text-sm text-surface-900 whitespace-pre-wrap bg-surface-50 p-3 border border-surface-300">
                              {log.body}
                            </p>
                          </div>
                          {log.isScheduled && log.scheduledEmailId && log.status === 'PENDING' && (
                            <div className="mt-3 pt-3 border-t border-surface-300 flex gap-2">
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
                                className="px-3 py-1.5 text-sm border border-primary-600 text-primary-600 rounded-md hover:bg-primary-500/10"
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
                className="btn-secondary"
              >
                {isLoadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Edit Schedule Modal */}
      {editingScheduleId && (
        <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) { setEditingScheduleId(null); setEditScheduledDateTime(''); setEditScheduleError(null); } }}>
          <div className="bg-surface-100 rounded-lg shadow-soft-xl max-w-md w-full p-6 animate-scale-in">
            <h3 className="text-lg font-semibold mb-4">Edit Scheduled Time</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-700 mb-2">
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
                className="input"
              />
              <p className="mt-1 text-xs text-surface-500">
                Minimum: 5 minutes from now
              </p>
            </div>

            {editScheduleError && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
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
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => editingScheduleId && handleEditSchedule(editingScheduleId, new Date(editScheduledDateTime))}
                disabled={isUpdatingSchedule || !editScheduledDateTime}
                className="btn-primary text-sm"
              >
                {isUpdatingSchedule ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow Up Modal */}
      {followUpData && (
        <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) { setFollowUpData(null); setFollowUpError(null); } }}>
          <div className="bg-surface-100 rounded-lg shadow-soft-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto animate-scale-in">
            <h3 className="text-lg font-semibold mb-4">Follow Up Email</h3>

            <div className="mb-4">
              <p className="text-sm text-surface-600 mb-2">
                To: <span className="font-medium text-surface-900">{followUpData.toName || followUpData.toEmail}</span>
                {followUpData.company && <span className="text-surface-500"> at {followUpData.company}</span>}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-700 mb-2">
                Subject
              </label>
              <input
                type="text"
                value={followUpData.subject}
                onChange={(e) => setFollowUpData({ ...followUpData, subject: e.target.value })}
                className="input"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-surface-700 mb-2">
                Message
              </label>
              <textarea
                value={followUpData.body}
                onChange={(e) => setFollowUpData({ ...followUpData, body: e.target.value })}
                rows={8}
                className="input resize-y"
              />
            </div>

            {followUpError && (
              <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
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
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={limitReached ? () => setShowLimitModal(true) : handleSendFollowUp}
                disabled={limitReached ? false : (isSendingFollowUp || !followUpData.body.trim())}
                className={`btn-primary text-sm${limitReached ? ' opacity-50 cursor-not-allowed' : ''}`}
              >
                {isSendingFollowUp ? 'Sending...' : limitReached ? 'Daily limit reached' : 'Send Follow Up'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          setLimitReached(false);
          setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged();
        }}
      />

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
