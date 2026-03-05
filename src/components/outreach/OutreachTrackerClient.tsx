'use client';

import { useState, useCallback } from 'react';
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
    [searchQuery, sortField, sortDirection, cursor]
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

  const recomputeStats = (trackerList: OutreachTrackerEntry[]) => {
    const total = trackerList.length;
    const sent = trackerList.filter((t) => t.dateEmailed !== null).length;
    const waiting = trackerList.filter(
      (t) => t.dateEmailed !== null && !t.responseReceivedAt && !['RESPONDED', 'SCHEDULED_CALL', 'HAD_CALL', 'CONNECTED'].includes(t.status)
    ).length;
    const ongoingConversations = trackerList.filter(
      (t) => t.responseReceivedAt !== null || ['RESPONDED', 'SCHEDULED_CALL', 'HAD_CALL', 'CONNECTED'].includes(t.status)
    ).length;
    setStats({ total, sent, waiting, ongoingConversations });
  };

  const handleUpdate = (updatedTracker: OutreachTrackerEntry) => {
    setTrackers((prev) => {
      const updated = prev.map((t) => (t.id === updatedTracker.id ? updatedTracker : t));
      recomputeStats(updated);
      return updated;
    });
  };

  const handleDelete = async (id: string) => {
    const result = await deleteOutreachTracker(id);
    if (result.success) {
      setTrackers((prev) => {
        const updated = prev.filter((t) => t.id !== id);
        recomputeStats(updated);
        return updated;
      });
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#E0E0E0] mb-4">History</h1>

        {/* Filters */}
        <OutreachFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearch={handleSearch}
          isLoading={isLoading}
        />
      </div>

      {/* Result count */}
      {trackers.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[#606060]">
            Showing {trackers.length}{stats.total ? ` of ${stats.total}` : ''} contacts
          </p>
        </div>
      )}

      {/* Table */}
      {isLoading && trackers.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-[#707070]">
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
