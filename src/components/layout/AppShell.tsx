'use client';

import { useState, useCallback } from 'react';
import { SearchSidebar } from './SearchSidebar';
import { MainSearchView } from './MainSearchView';
import { NewHeader } from './NewHeader';
import { ParsedFilters } from '@/app/actions/ai-search';
import { EmailChatProvider } from '@/contexts/EmailChatContext';

interface AppShellProps {
  initialRemainingDaily: number;
  isAuthenticated?: boolean;
}

export function AppShell({ initialRemainingDaily, isAuthenticated = true }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [pendingFilters, setPendingFilters] = useState<ParsedFilters | null>(null);
  const [aiMode, setAiMode] = useState(false);

  const handleSearchSubmit = useCallback((query: string) => {
    setPendingQuery(query);
    setSidebarOpen(false); // close mobile sidebar
  }, []);

  const handleFilterSubmit = useCallback((filters: { company?: string; role?: string; university?: string; location?: string }) => {
    setPendingFilters(filters as ParsedFilters);
    setSidebarOpen(false);
  }, []);

  const handleQueryProcessed = useCallback(() => {
    setPendingQuery(null);
    setPendingFilters(null);
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
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <NewHeader
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            showSidebarToggle
            isAuthenticated={isAuthenticated}
          />
          <main className="flex-1 overflow-hidden">
            <MainSearchView
              initialRemainingDaily={initialRemainingDaily}
              pendingQuery={pendingQuery}
              pendingFilters={pendingFilters}
              onQueryProcessed={handleQueryProcessed}
              aiMode={aiMode}
              isAuthenticated={isAuthenticated}
            />
          </main>
        </div>
      </div>
    </EmailChatProvider>
  );
}
