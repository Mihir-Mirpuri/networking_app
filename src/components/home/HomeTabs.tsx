'use client';

import { useState } from 'react';
import { SearchPageClient } from '@/components/search/SearchPageClient';
import { PersonLookup } from '@/components/search/PersonLookup';
import { ComposeEmailModal } from '@/components/compose/ComposeEmailModal';
import { Toast } from '@/components/ui/Toast';
import { AISearchPageClient } from '@/components/search/AISearchPageClient';
import { MagnifyingGlassIcon, UserIcon, PaperAirplaneIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

type HomeTabId = 'find' | 'ai' | 'lookup' | 'quick';

interface HomeTabsProps {
  initialRemainingDaily: number;
}

const TABS: { id: HomeTabId; label: string; icon: typeof MagnifyingGlassIcon }[] = [
  { id: 'find', label: 'Find Connections', icon: MagnifyingGlassIcon },
  { id: 'ai', label: 'AI Search', icon: ChatBubbleLeftRightIcon },
  { id: 'lookup', label: 'Look Up', icon: UserIcon },
  { id: 'quick', label: 'Direct Send', icon: PaperAirplaneIcon },
];

export function HomeTabs({ initialRemainingDaily }: HomeTabsProps) {
  const [activeTab, setActiveTab] = useState<HomeTabId>('find');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleQuickSendSuccess = () => {
    setToast({ message: 'Email sent successfully!', type: 'success' });
  };

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-8">
        <nav className="inline-flex p-1 bg-surface-100 rounded-xl" aria-label="Tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-surface-100 text-primary-700 shadow-soft'
                    : 'text-surface-600 hover:text-surface-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'find' && (
        <div className="animate-fade-in">
          <SearchPageClient initialRemainingDaily={initialRemainingDaily} />
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="animate-fade-in">
          <AISearchPageClient initialRemainingDaily={initialRemainingDaily} />
        </div>
      )}

      {activeTab === 'lookup' && (
        <div className="animate-fade-in">
          <PersonLookup />
        </div>
      )}

      {activeTab === 'quick' && (
        <div className="flex justify-center animate-fade-in">
          <ComposeEmailModal
            isOpen
            onClose={() => {}}
            onSuccess={handleQuickSendSuccess}
            variant="embedded"
          />
        </div>
      )}

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
