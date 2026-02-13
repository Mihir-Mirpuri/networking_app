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
import { ThreadPanel } from './ThreadPanel';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

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
  const [selectedTracker, setSelectedTracker] = useState<OutreachTrackerEntry | null>(null);

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
      <div className="mb-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-surface-900">Outreach Tracker</h1>
          <p className="text-surface-500 mt-1">Track and manage your networking outreach</p>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card p-5 group hover:shadow-soft-lg transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary-600">{stats.sent ?? 0}</div>
                <div className="text-sm text-surface-500">Emails Sent</div>
              </div>
            </div>
          </div>
          <div className="card p-5 group hover:shadow-soft-lg transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{stats.waiting ?? 0}</div>
                <div className="text-sm text-surface-500">No Response Yet</div>
              </div>
            </div>
          </div>
          <div className="card p-5 group hover:shadow-soft-lg transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-600">{stats.ongoingConversations ?? 0}</div>
                <div className="text-sm text-surface-500">Ongoing Conversations</div>
              </div>
            </div>
          </div>
        </div>

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
          <div className="flex items-center gap-3 text-surface-500">
            <LoadingSpinner size="md" />
            Loading...
          </div>
        </div>
      ) : (
        <>
          <OutreachTable
            trackers={trackers}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onRowClick={setSelectedTracker}
          />

          {/* Load More Button */}
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="btn-secondary"
              >
                {isLoadingMore ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner size="sm" />
                    Loading...
                  </span>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Thread Panel */}
      {selectedTracker && (
        <ThreadPanel
          tracker={selectedTracker}
          isOpen={!!selectedTracker}
          onClose={() => setSelectedTracker(null)}
        />
      )}
    </div>
  );
}
