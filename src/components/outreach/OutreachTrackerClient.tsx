'use client';

import { useState, useCallback, useRef } from 'react';
import {
  OutreachTrackerEntry,
  OutreachStats,
  HistorySidebarStats,
  ScheduledEmailEntry,
  SavedForLaterEntry,
  HistorySection,
  ActiveFilter,
  getOutreachTrackers,
  getSavedForLaterProfiles,
  deleteOutreachTracker,
  toggleStarOutreachTracker,
  toggleResponseReceived,
  clearAllOutreachTrackers,
} from '@/app/actions/outreach';
import { OutreachTable } from './OutreachTable';
import { ScheduledEmailsSection } from './ScheduledEmailsSection';
import { SavedForLaterSection } from './SavedForLaterSection';
import { ExpandedHistoryReview } from './ExpandedHistoryReview';
import { HistorySidebar } from './HistorySidebar';
import { FilterSearchBar } from './FilterSearchBar';
import { NewHeader } from '@/components/layout/NewHeader';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { useColumnSettings } from './useColumnSettings';
import { EmailChatProvider } from '@/contexts/EmailChatContext';

interface OutreachTrackerClientProps {
  initialTrackers: OutreachTrackerEntry[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialStats: OutreachStats;
  initialScheduledEmails: ScheduledEmailEntry[];
  initialSavedForLater: SavedForLaterEntry[];
  initialSidebarStats: HistorySidebarStats;
}

export function OutreachTrackerClient({
  initialTrackers,
  initialCursor,
  initialHasMore,
  initialStats,
  initialScheduledEmails,
  initialSavedForLater,
  initialSidebarStats,
}: OutreachTrackerClientProps) {
  const [trackers, setTrackers] = useState<OutreachTrackerEntry[]>(initialTrackers);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmailEntry[]>(initialScheduledEmails);
  const [savedForLater, setSavedForLater] = useState<SavedForLaterEntry[]>(initialSavedForLater);
  const [stats, setStats] = useState<OutreachStats>(initialStats);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [activeSection, setActiveSection] = useState<HistorySection>('all');
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedTracker, setSelectedTracker] = useState<OutreachTrackerEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Column settings hook
  const columnSettings = useColumnSettings();

  // Table ref for auto-fit all
  const tableRef = useRef<HTMLDivElement>(null);

  const fetchTrackers = useCallback(
    async (resetCursor = true, filtersOverride?: ActiveFilter[], sectionOverride?: HistorySection) => {
      setIsLoading(true);
      const filtersToUse = filtersOverride ?? activeFilters;
      const section = sectionOverride ?? activeSection;
      try {
        const result = await getOutreachTrackers({
          starred: section === 'starred' ? true : undefined,
          hasResponse: section === 'hasResponse' ? true : undefined,
          cursor: resetCursor ? undefined : cursor || undefined,
          filters: filtersToUse.length > 0 ? filtersToUse : undefined,
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
    [activeSection, cursor, activeFilters]
  );

  const handleLoadMore = async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await getOutreachTrackers({
        starred: activeSection === 'starred' ? true : undefined,
        hasResponse: activeSection === 'hasResponse' ? true : undefined,
        cursor,
        filters: activeFilters.length > 0 ? activeFilters : undefined,
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

  const handleSectionChange = async (section: HistorySection) => {
    setActiveSection(section);
    if (section === 'scheduled') {
      // Scheduled emails are already loaded
      return;
    }
    if (section === 'savedForLater') {
      // Fetch fresh saved for later profiles
      setIsLoading(true);
      try {
        const result = await getSavedForLaterProfiles();
        if (result.success) {
          setSavedForLater(result.profiles);
        }
      } catch (error) {
        console.error('Error fetching saved for later:', error);
      } finally {
        setIsLoading(false);
      }
      return;
    }
    // For other sections, fetch trackers with the new section
    fetchTrackers(true, undefined, section);
  };

  const handleAddFilter = (filter: ActiveFilter) => {
    const newFilters = [...activeFilters, filter];
    setActiveFilters(newFilters);
    fetchTrackers(true, newFilters, activeSection);
  };

  const handleRemoveFilter = (index: number) => {
    const newFilters = activeFilters.filter((_, i) => i !== index);
    setActiveFilters(newFilters);
    fetchTrackers(true, newFilters, activeSection);
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

  const handleToggleResponse = async (id: string) => {
    const result = await toggleResponseReceived(id);
    if (result.success) {
      setTrackers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, responseReceivedAt: result.responseReceivedAt } : t))
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

  const handleAutoFitAll = useCallback(() => {
    columnSettings.autoFitAllColumns(tableRef);
  }, [columnSettings]);

  return (
    <div className="flex w-full h-full overflow-hidden">
      <HistorySidebar
        stats={initialSidebarStats}
        filterProps={{
          isLoading,
          activeSection,
          onSectionChange: handleSectionChange,
          columnOrder: columnSettings.columnOrder,
          isColumnVisible: columnSettings.isVisible,
          onToggleColumn: columnSettings.toggleColumn,
          onReorderColumns: columnSettings.reorderColumns,
          getColumnLabel: columnSettings.getColumnLabel,
          onAddCustomColumn: columnSettings.addCustomColumn,
          onRemoveCustomColumn: columnSettings.removeCustomColumn,
          onRenameCustomColumn: columnSettings.renameCustomColumn,
          onAutoFitAll: handleAutoFitAll,
          onResetDefaults: columnSettings.resetToDefaults,
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden bg-[#212121]">
      <NewHeader />
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-4">
      {/* Content area - Scheduled emails, Saved for later, or Outreach table */}
      {activeSection === 'scheduled' ? (
        <ScheduledEmailsSection
          scheduledEmails={scheduledEmails}
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
      ) : activeSection === 'savedForLater' ? (
        isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3 text-white">
              <LoadingSpinner size="md" />
              Loading...
            </div>
          </div>
        ) : (
          <SavedForLaterSection
            profiles={savedForLater}
            onProfileRemoved={(id) => {
              setSavedForLater((prev) => prev.filter((p) => p.id !== id));
            }}
          />
        )
      ) : isLoading && trackers.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-white">
            <LoadingSpinner size="md" />
            Loading...
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <FilterSearchBar
            activeFilters={activeFilters}
            onAddFilter={handleAddFilter}
            onRemoveFilter={handleRemoveFilter}
          />
          <div className="flex-1 flex flex-col min-h-0 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
          <OutreachTable
            trackers={trackers}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onToggleStar={handleToggleStar}
            onToggleResponse={handleToggleResponse}
            onRowClick={setSelectedTracker}
            visibleColumns={columnSettings.visibleColumns}
            columnWidths={columnSettings.widths}
            onStartResize={columnSettings.startResize}
            onAutoFitColumn={columnSettings.autoFitColumn}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            getColumnLabel={columnSettings.getColumnLabel}
            getCustomCellValue={columnSettings.getCustomCellValue}
            onCustomCellChange={columnSettings.setCustomCellValue}
            tableRef={tableRef}
          />
        </div>
        </div>
      )}

      {/* Expanded History Review */}
      {selectedTracker && (
        <EmailChatProvider>
          <ExpandedHistoryReview
            tracker={selectedTracker}
            onClose={() => setSelectedTracker(null)}
          />
        </EmailChatProvider>
      )}
      </div>
      </div>

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[#2a2a2a] rounded-2xl shadow-lg shadow-black/40 max-w-md w-full p-6 animate-scale-in border border-[#3a3a3a]">
            <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-900/30 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-center text-white mb-2">Clear All History</h3>
            <p className="text-white text-center mb-6">
              Are you sure you want to delete all <span className="font-medium text-white">{trackers.length}</span> contacts from your history? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
                className="px-5 py-2.5 text-sm font-medium bg-[#333333] text-white rounded-lg hover:bg-[#3a3a3a] transition-all disabled:opacity-50"
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
