'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  OutreachTrackerEntry,
  OutreachStats,
  ScheduledEmailEntry,
  DraftEntry,
  SortField,
  SortDirection,
  OutreachFilterOptions,
  getOutreachTrackers,
  getOutreachFilterOptions,
  getDrafts,
  deleteOutreachTracker,
  toggleStarOutreachTracker,
  clearAllOutreachTrackers,
} from '@/app/actions/outreach';
import { OutreachTable } from './OutreachTable';
import { OutreachFilters, ColumnKey } from './OutreachFilters';
import { ScheduledEmailsSection } from './ScheduledEmailsSection';
import { DraftsSection } from './DraftsSection';
import { ThreadPanel } from './ThreadPanel';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { useColumnSettings, COLUMN_LABELS } from './useColumnSettings';

interface OutreachTrackerClientProps {
  initialTrackers: OutreachTrackerEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialStats: OutreachStats;
  initialScheduledEmails: ScheduledEmailEntry[];
  initialDrafts: DraftEntry[];
}

export function OutreachTrackerClient({
  initialTrackers,
  initialCursor,
  initialHasMore,
  initialStats,
  initialScheduledEmails,
  initialDrafts,
}: OutreachTrackerClientProps) {
  const [trackers, setTrackers] = useState<OutreachTrackerEntry[]>(initialTrackers);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmailEntry[]>(initialScheduledEmails);
  const [drafts, setDrafts] = useState<DraftEntry[]>(initialDrafts);
  const [stats, setStats] = useState<OutreachStats>(initialStats);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [starredFilter, setStarredFilter] = useState<boolean | undefined>(undefined);
  const [scheduledFilter, setScheduledFilter] = useState<boolean | undefined>(undefined);
  const [draftsFilter, setDraftsFilter] = useState<boolean | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedTracker, setSelectedTracker] = useState<OutreachTrackerEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Multi-select filter state
  const [filterOptions, setFilterOptions] = useState<OutreachFilterOptions | null>(null);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [selectedFirms, setSelectedFirms] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);

  // Column settings hook
  const columnSettings = useColumnSettings();

  // Fetch filter options on mount
  useEffect(() => {
    const loadFilterOptions = async () => {
      setFilterOptionsLoading(true);
      try {
        const result = await getOutreachFilterOptions();
        if (result.success) {
          setFilterOptions(result.options);
        }
      } catch (error) {
        console.error('Error fetching filter options:', error);
      } finally {
        setFilterOptionsLoading(false);
      }
    };
    loadFilterOptions();
  }, []);

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
          firms: selectedFirms.length > 0 ? selectedFirms : undefined,
          roles: selectedRoles.length > 0 ? selectedRoles : undefined,
          groups: selectedGroups.length > 0 ? selectedGroups : undefined,
          connections: selectedConnections.length > 0 ? selectedConnections : undefined,
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
    [searchQuery, sortField, sortDirection, starredFilter, cursor, selectedFirms, selectedRoles, selectedGroups, selectedConnections]
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
        firms: selectedFirms.length > 0 ? selectedFirms : undefined,
        roles: selectedRoles.length > 0 ? selectedRoles : undefined,
        groups: selectedGroups.length > 0 ? selectedGroups : undefined,
        connections: selectedConnections.length > 0 ? selectedConnections : undefined,
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
    if (starred === true) {
      setScheduledFilter(undefined);
      setDraftsFilter(undefined);
    }
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleScheduledFilterChange = (scheduled: boolean | undefined) => {
    setScheduledFilter(scheduled);
    if (scheduled === true) {
      setStarredFilter(undefined);
      setDraftsFilter(undefined);
    }
  };

  const handleDraftsFilterChange = async (draftsActive: boolean | undefined) => {
    setDraftsFilter(draftsActive);
    if (draftsActive === true) {
      setStarredFilter(undefined);
      setScheduledFilter(undefined);
      // Refresh drafts when filter is activated
      const result = await getDrafts(searchQuery || undefined);
      if (result.success) {
        setDrafts(result.drafts);
      }
    }
  };

  const handleFirmsChange = (firms: string[]) => {
    setSelectedFirms(firms);
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleRolesChange = (roles: string[]) => {
    setSelectedRoles(roles);
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleGroupsChange = (groups: string[]) => {
    setSelectedGroups(groups);
    setTimeout(() => fetchTrackers(true), 0);
  };

  const handleConnectionsChange = (connections: string[]) => {
    setSelectedConnections(connections);
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
          scheduledFilter={scheduledFilter}
          onScheduledFilterChange={handleScheduledFilterChange}
          draftsFilter={draftsFilter}
          onDraftsFilterChange={handleDraftsFilterChange}
          draftsCount={drafts.length}
          columnOrder={columnSettings.columnOrder}
          isColumnVisible={columnSettings.isVisible}
          onToggleColumn={columnSettings.toggleColumn}
          onReorderColumns={columnSettings.reorderColumns}
          columnLabels={COLUMN_LABELS}
          showClearAll={trackers.length > 0}
          onClearAll={() => setShowClearConfirm(true)}
          filterOptions={filterOptions}
          filterOptionsLoading={filterOptionsLoading}
          selectedFirms={selectedFirms}
          selectedRoles={selectedRoles}
          selectedGroups={selectedGroups}
          selectedConnections={selectedConnections}
          onFirmsChange={handleFirmsChange}
          onRolesChange={handleRolesChange}
          onGroupsChange={handleGroupsChange}
          onConnectionsChange={handleConnectionsChange}
        />
      </div>

      {/* Content area - Drafts, Scheduled emails, or Outreach table */}
      {draftsFilter === true ? (
        <DraftsSection
          drafts={searchQuery
            ? drafts.filter((d) => {
                const q = searchQuery.toLowerCase();
                return (
                  d.contactName.toLowerCase().includes(q) ||
                  (d.contactEmail && d.contactEmail.toLowerCase().includes(q)) ||
                  d.company.toLowerCase().includes(q) ||
                  d.subject.toLowerCase().includes(q)
                );
              })
            : drafts}
          onDraftDeleted={(id) => {
            setDrafts((prev) => prev.filter((d) => d.id !== id));
          }}
        />
      ) : scheduledFilter === true ? (
        <ScheduledEmailsSection
          scheduledEmails={searchQuery
            ? scheduledEmails.filter((e) => {
                const q = searchQuery.toLowerCase();
                return (
                  (e.contactName && e.contactName.toLowerCase().includes(q)) ||
                  e.toEmail.toLowerCase().includes(q) ||
                  (e.company && e.company.toLowerCase().includes(q)) ||
                  e.subject.toLowerCase().includes(q)
                );
              })
            : scheduledEmails}
          onEmailCancelled={(id) => {
            setScheduledEmails((prev) => prev.filter((e) => e.id !== id));
          }}
          onEmailUpdated={(id, newScheduledFor) => {
            setScheduledEmails((prev) =>
              prev
                .map((e) => (e.id === id ? { ...e, scheduledFor: newScheduledFor } : e))
                .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
            );
          }}
        />
      ) : isLoading && trackers.length === 0 ? (
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
          visibleColumns={columnSettings.visibleColumns}
          columnWidths={columnSettings.widths}
          onStartResize={columnSettings.startResize}
          onAutoFitColumn={columnSettings.autoFitColumn}
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
