'use client';

import { useState } from 'react';
import { SearchPageClient } from '@/components/search/SearchPageClient';
import { ComposeEmailModal } from '@/components/compose/ComposeEmailModal';
import { Toast } from '@/components/ui/Toast';
import { MagnifyingGlassIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';

type HomeTabId = 'find' | 'quick';

interface HomeTabsProps {
  initialRemainingDaily: number;
}

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
          <button
            type="button"
            onClick={() => setActiveTab('find')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'find'
                ? 'bg-white text-primary-700 shadow-soft'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            Find Connections
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'quick'
                ? 'bg-white text-primary-700 shadow-soft'
                : 'text-surface-600 hover:text-surface-900'
            }`}
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            Quick Send
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'find' && (
        <div className="animate-fade-in">
          <SearchPageClient initialRemainingDaily={initialRemainingDaily} />
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
