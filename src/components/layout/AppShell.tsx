'use client';

import { useState, useCallback } from 'react';
import { SearchSidebar } from './SearchSidebar';
import { MainSearchView, DisplayMessage } from './MainSearchView';
import { NewHeader } from './NewHeader';
import { ParsedFilters, Selectable, SuggestedAlternative, SuggestedSearch } from '@/app/actions/ai-search';
import type { LinkedInFilters } from '@/lib/types/linkedin-filters';
import { EmailChatProvider } from '@/contexts/EmailChatContext';

interface AppShellProps {
  initialRemainingDaily: number;
  isSubscribed: boolean;
}

export function AppShell({ initialRemainingDaily, isSubscribed }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [pendingFilters, setPendingFilters] = useState<ParsedFilters | null>(null);
  const [pendingLinkedInFilters, setPendingLinkedInFilters] = useState<LinkedInFilters | null>(null);
  const [aiMode, setAiMode] = useState(true);

  // Chat state lifted from MainSearchView
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentFilters, setCurrentFilters] = useState<ParsedFilters>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const handleSelectableClick = useCallback((selectable: Selectable) => {
    // Add user message for the selection
    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: selectable.label },
    ]);

    // Merge selection into current filters
    const updated = { ...currentFilters, [selectable.filterKey]: selectable.filterValue };
    setCurrentFilters(updated);

    // If company is set, trigger search via pending filters
    if (updated.company) {
      setPendingFilters(updated);
    } else {
      // Still missing company — send as query
      setPendingQuery(selectable.label);
    }
  }, [currentFilters]);

  const handleShowMoreSelectables = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId || !m.allSelectables) return m;
      const nextPage = (m.selectablesPage || 0) + 1;
      const nextBatch = m.allSelectables.slice(nextPage * 5, nextPage * 5 + 5);
      if (nextBatch.length === 0) return m;
      return { ...m, selectables: nextBatch, selectablesPage: nextPage };
    }));
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setCurrentFilters({});
  }, []);

  const handleSearchSubmit = useCallback((query: string) => {
    setPendingQuery(query);
    setSidebarOpen(false); // close mobile sidebar
  }, []);

  const handleFilterSubmit = useCallback((filters: { company?: string; role?: string; university?: string; location?: string }) => {
    setPendingFilters(filters as ParsedFilters);
    setSidebarOpen(false);
  }, []);

  const handleSuggestedAlternativeClick = useCallback((alt: SuggestedAlternative) => {
    // Add a user message showing what they clicked
    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: alt.label },
    ]);
    setCurrentFilters(alt.filters);
    setPendingLinkedInFilters(alt.linkedInFilters);
    setPendingFilters(alt.filters);
  }, []);

  const handleSuggestedSearchClick = useCallback((search: SuggestedSearch) => {
    // Add a user message showing what they clicked
    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: search.label },
    ]);
    setCurrentFilters(search.filters);
    // No pendingLinkedInFilters needed — runSearch builds minimal LI filters from ParsedFilters
    setPendingFilters(search.filters);
  }, []);

  const handleQueryProcessed = useCallback(() => {
    setPendingQuery(null);
    setPendingFilters(null);
    setPendingLinkedInFilters(null);
  }, []);

  return (
    <EmailChatProvider>
      <div className="h-screen flex bg-black">
        <SearchSidebar
          onSearchSubmit={handleSearchSubmit}
          onFilterSubmit={handleFilterSubmit}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          aiMode={aiMode}
          onAiModeChange={setAiMode}
          messages={messages}
          isExtracting={isExtracting}
          isSearching={isSearching}
          onSelectableClick={handleSelectableClick}
          onShowMoreSelectables={handleShowMoreSelectables}
          onSuggestedAlternativeClick={handleSuggestedAlternativeClick}
          onSuggestedSearchClick={handleSuggestedSearchClick}
          onClearChat={handleClearChat}
          isSubscribed={isSubscribed}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <NewHeader
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            showSidebarToggle
          />
          <main className="flex-1 overflow-hidden">
            <MainSearchView
              initialRemainingDaily={initialRemainingDaily}
              pendingQuery={pendingQuery}
              pendingFilters={pendingFilters}
              pendingLinkedInFilters={pendingLinkedInFilters}
              onQueryProcessed={handleQueryProcessed}
              aiMode={aiMode}
              messages={messages}
              setMessages={setMessages}
              currentFilters={currentFilters}
              setCurrentFilters={setCurrentFilters}
              isExtracting={isExtracting}
              setIsExtracting={setIsExtracting}
              isSearching={isSearching}
              setIsSearching={setIsSearching}
            />
          </main>
        </div>
      </div>
    </EmailChatProvider>
  );
}
