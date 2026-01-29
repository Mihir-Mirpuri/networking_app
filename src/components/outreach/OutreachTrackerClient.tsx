'use client';

import { useState, useCallback } from 'react';
import { OutreachStatus } from '@prisma/client';
import {
  OutreachTrackerEntry,
  OutreachStats,
  SortField,
  SortDirection,
  getOutreachTrackers,
  deleteOutreachTracker,
} from '@/app/actions/outreach';
import { OutreachTable } from './OutreachTable';
import { OutreachFilters } from './OutreachFilters';

interface OutreachTrackerClientProps {
  initialTrackers: OutreachTrackerEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialStats: OutreachStats;
}

export function OutreachTrackerClient({
  initialTrackers,
  initialCursor,
  initialHasMore,
  initialStats,
}: OutreachTrackerClientProps) {
  const [trackers, setTrackers] = useState<OutreachTrackerEntry[]>(initialTrackers);
  const [stats, setStats] = useState<OutreachStats>(initialStats);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<OutreachStatus[]>([]);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const fetchTrackers = useCallback(
    async (resetCursor = true) => {
      setIsLoading(true);
      try {
        const result = await getOutreachTrackers({
          search: searchQuery || undefined,
          status: statusFilter.length > 0 ? statusFilter : undefined,
          sortField,
          sortDirection,
          cursor: resetCursor ? undefined : cursor || undefined,
        });

        if (result.success) {
          if (resetCursor) {
            setTrackers(result.trackers);
          } else {
            setTrackers((prev) => [...prev, ...result.trackers]);
          }
          setCursor(result.nextCursor);
          setHasMore(result.hasMore);
        }
      } catch (error) {
        console.error('Error fetching trackers:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [searchQuery, statusFilter, sortField, sortDirection, cursor]
  );

  const handleSearch = () => {
    fetchTrackers(true);
  };

  const handleLoadMore = async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await getOutreachTrackers({
        search: searchQuery || undefined,
        status: statusFilter.length > 0 ? statusFilter : undefined,
        sortField,
        sortDirection,
        cursor,
      });

      if (result.success) {
        setTrackers((prev) => [...prev, ...result.trackers]);
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
      }
    } catch (error) {
      console.error('Error loading more trackers:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    // Trigger search with new sort
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleUpdate = (updatedTracker: OutreachTrackerEntry) => {
    setTrackers((prev) =>
      prev.map((t) => (t.id === updatedTracker.id ? updatedTracker : t))
    );
  };

  const handleDelete = async (id: string) => {
    const result = await deleteOutreachTracker(id);
    if (result.success) {
      setTrackers((prev) => prev.filter((t) => t.id !== id));
      setStats((prev) => ({ ...prev, sent: Math.max(0, (prev.sent ?? 0) - 1) }));
    }
  };

  return (
    <div>
      {/* Header with Stats */}
      <div className="mb-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Outreach Tracker</h1>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sent ?? 0}</div>
            <div className="text-sm text-gray-500">Emails Sent</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.waiting ?? 0}</div>
            <div className="text-sm text-gray-500">No Response Yet</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-green-600">{stats.ongoingConversations ?? 0}</div>
            <div className="text-sm text-gray-500">Ongoing Conversations</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-emerald-600">{stats.connected ?? 0}</div>
            <div className="text-sm text-gray-500">Connected</div>
          </div>
        </div>

        {/* Upcoming Reminders Alert */}
        {stats.upcomingReminders > 0 && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-3">
            <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-yellow-800">
              You have <strong>{stats.upcomingReminders}</strong> upcoming reminder
              {stats.upcomingReminders === 1 ? '' : 's'} in the next 7 days
            </span>
          </div>
        )}

        {/* Filters */}
        <OutreachFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearch={handleSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          isLoading={isLoading}
        />
      </div>

      {/* Table */}
      {isLoading && trackers.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <OutreachTable
              trackers={trackers}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          </div>

          {/* Load More Button */}
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
