'use client';

import { useState } from 'react';
import { getSendLogs, SendLogEntry } from '@/app/actions/sendlog';

interface GroupedLogs {
  [date: string]: SendLogEntry[];
}

interface EmailHistoryClientProps {
  initialLogs: SendLogEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
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
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                log.status === 'SUCCESS'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {log.status === 'SUCCESS' ? 'Sent' : 'Failed'}
                            </span>
                          </div>
                          <span className="text-sm text-gray-500">
                            {formatTime(log.sentAt)}
                          </span>
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
                          <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">Body:</p>
                            <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                              {log.body}
                            </p>
                          </div>
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
    </div>
  );
}
