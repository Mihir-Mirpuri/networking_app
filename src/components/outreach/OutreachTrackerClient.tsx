'use client';

import { useState, useCallback } from 'react';
import {
  OutreachTrackerEntry,
  OutreachStats,
  SortField,
  SortDirection,
  getOutreachTrackers,
  deleteOutreachTracker,
  toggleStarOutreachTracker,
  clearAllOutreachTrackers,
} from '@/app/actions/outreach';
import { OutreachTable } from './OutreachTable';
import { OutreachFilters, ColumnKey } from './OutreachFilters';
import { ThreadPanel } from './ThreadPanel';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

interface OutreachTrackerClientProps {
  initialTrackers: OutreachTrackerEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialStats: OutreachStats;
}

const DEFAULT_COLUMNS: ColumnKey[] = ['name', 'company', 'role', 'location', 'subject', 'date'];

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
  const [starredFilter, setStarredFilter] = useState<boolean | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedTracker, setSelectedTracker] = useState<OutreachTrackerEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);

  const fetchTrackers = useCallback(
    async (resetCursor = true) => {
      setIsLoading(true);
      try {
        const result = await getOutreachTrackers({
          search: searchQuery || undefined,
          sortField,
          sortDirection,
          starred: starredFilter,
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
    [searchQuery, sortField, sortDirection, starredFilter, cursor]
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
        starred: starredFilter,
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
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleStarredFilterChange = (starred: boolean | undefined) => {
    setStarredFilter(starred);
    // Trigger refetch
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleToggleColumn = (column: ColumnKey) => {
    setVisibleColumns((prev) => {
      if (prev.includes(column)) {
        // Don't allow removing all columns
        if (prev.length <= 1) return prev;
        return prev.filter((c) => c !== column);
      }
      // Add in default order
      const ordered = DEFAULT_COLUMNS.filter((c) => prev.includes(c) || c === column);
      return ordered;
    });
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

  const handleToggleStar = async (id: string) => {
    const result = await toggleStarOutreachTracker(id);
    if (result.success) {
      setTrackers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, starred: result.starred } : t))
      );
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      const result = await clearAllOutreachTrackers();
      if (result.success) {
        setTrackers([]);
        setStats({ total: 0, sent: 0, waiting: 0, ongoingConversations: 0 });
        setCursor(null);
        setHasMore(false);
        setShowClearConfirm(false);
      }
    } catch (error) {
      console.error('Error clearing history:', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters - Fixed at top */}
      <div className="flex-shrink-0 pb-4">
        <OutreachFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearch={handleSearch}
          isLoading={isLoading}
          starredFilter={starredFilter}
          onStarredFilterChange={handleStarredFilterChange}
          visibleColumns={visibleColumns}
          onToggleColumn={handleToggleColumn}
          showClearAll={trackers.length > 0}
          onClearAll={() => setShowClearConfirm(true)}
        />
      </div>

      {/* Table - Scrollable */}
      {isLoading && trackers.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-[#707070]">
            <LoadingSpinner size="md" />
            Loading...
          </div>
        </div>
      ) : (
        <OutreachTable
          trackers={trackers}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onToggleStar={handleToggleStar}
          onRowClick={setSelectedTracker}
          visibleColumns={visibleColumns}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
        />
      )}

      {/* Thread Panel */}
      {selectedTracker && (
        <ThreadPanel
          tracker={selectedTracker}
          isOpen={!!selectedTracker}
          onClose={() => setSelectedTracker(null)}
        />
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#2a2a2a] rounded-2xl shadow-lg shadow-black/40 max-w-md w-full p-6 animate-scale-in border border-[#3a3a3a]">
            <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-900/30 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-center text-[#E0E0E0] mb-2">Clear All History</h3>
            <p className="text-[#808080] text-center mb-6">
              Are you sure you want to delete all <span className="font-medium text-[#E0E0E0]">{trackers.length}</span> contacts from your history? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
                className="px-5 py-2.5 text-sm font-medium bg-[#333333] text-[#c0c0c0] rounded-lg hover:bg-[#3a3a3a] transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                disabled={isClearing}
                className="px-5 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isClearing ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Clearing...
                  </>
                ) : (
                  'Clear All'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
