'use client';

import { useEffect, useState, useCallback } from 'react';
import { getCreditStatusAction } from '@/app/actions/invitations';

// Custom event name for credit updates
export const CREDITS_CHANGED_EVENT = 'signl:credits-changed';

// Helper function to dispatch credit change event
export function dispatchCreditsChanged() {
  window.dispatchEvent(new CustomEvent(CREDITS_CHANGED_EVENT));
}

interface CreditStatus {
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  totalRemaining: number;
}

interface CreditsDisplayProps {
  onStatusChange?: (status: CreditStatus) => void;
  refreshTrigger?: number;
}

export function CreditsDisplay({ onStatusChange, refreshTrigger }: CreditsDisplayProps) {
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    const result = await getCreditStatusAction();
    if (result.success) {
      const newStatus = {
        dailyUsed: result.dailyUsed,
        dailyLimit: result.dailyLimit,
        bonusCredits: result.bonusCredits,
        totalRemaining: result.totalRemaining,
      };
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    }
    setIsLoading(false);
  }, [onStatusChange]);

  // Listen for credit change events
  useEffect(() => {
    const handleCreditsChanged = () => {
      loadStatus();
    };

    window.addEventListener(CREDITS_CHANGED_EVENT, handleCreditsChanged);
    return () => {
      window.removeEventListener(CREDITS_CHANGED_EVENT, handleCreditsChanged);
    };
  }, [loadStatus]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, refreshTrigger]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <div className="w-16 h-4 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!status) return null;

  const dailyRemaining = status.dailyLimit - status.dailyUsed;
  const isLow = status.totalRemaining <= 3;
  const isEmpty = status.totalRemaining === 0;

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        <svg
          className={`w-4 h-4 ${isEmpty ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
        <span className="text-gray-500">Emails:</span>
        <span
          className={`font-medium ${
            isEmpty ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-900'
          }`}
        >
          {dailyRemaining}/{status.dailyLimit}
        </span>
      </div>
      {status.bonusCredits > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary-50 rounded-full">
          <svg className="w-3.5 h-3.5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium text-primary-700">{status.bonusCredits}</span>
        </div>
      )}
    </div>
  );
}
