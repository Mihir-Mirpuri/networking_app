'use client';

import { useState } from 'react';
import { SearchPageClient } from '@/components/search/SearchPageClient';
import { ComposeEmailModal } from '@/components/compose/ComposeEmailModal';
import { Toast } from '@/components/ui/Toast';

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
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <button
            type="button"
            onClick={() => setActiveTab('find')}
            className={`border-b-2 py-2 text-sm font-medium transition-colors ${
              activeTab === 'find'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Find Connections
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`border-b-2 py-2 text-sm font-medium transition-colors ${
              activeTab === 'quick'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Quick Send
          </button>
        </nav>
      </div>

      {activeTab === 'find' && (
        <SearchPageClient initialRemainingDaily={initialRemainingDaily} />
      )}

      {activeTab === 'quick' && (
        <div className="flex justify-center">
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
