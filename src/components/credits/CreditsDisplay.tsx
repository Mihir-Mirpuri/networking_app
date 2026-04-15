'use client';

import { useEffect, useState, useCallback } from 'react';
import { getCreditStatusAction } from '@/app/actions/invitations';
import { EMAIL_LIMITS } from '@/lib/constants';

// Custom event name for credit updates
export const CREDITS_CHANGED_EVENT = 'signl:credits-changed';

// Helper function to dispatch credit change event
export function dispatchCreditsChanged() {
  window.dispatchEvent(new CustomEvent(CREDITS_CHANGED_EVENT));
}

interface CreditStatus {
  totalSent: number;
  lifetimeLimit: number;
  totalRemaining: number;
  isSubscribed: boolean;
  isBlocked: boolean;
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
        totalSent: result.totalSent,
        lifetimeLimit: result.lifetimeLimit,
        totalRemaining: result.totalRemaining,
        isSubscribed: result.isSubscribed,
        isBlocked: result.isBlocked,
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
      <div className="flex items-center gap-2 text-sm text-white">
        <div className="w-16 h-4 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!status) return null;

  // Show Pro badge for subscribers
  if (status.isSubscribed) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--accent)] rounded-full">
          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" />
          </svg>
          <span className="font-semibold text-white">Pro</span>
        </div>
        <span className="text-white">Unlimited emails</span>
      </div>
    );
  }

  const isBlocked = status.isBlocked;

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        <svg
          className={`w-4 h-4 ${isBlocked ? 'text-red-500' : 'text-white'}`}
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
        <span className="text-white">Free emails:</span>
        <span
          className={`font-medium ${isBlocked ? 'text-red-500' : 'text-white'}`}
        >
          {status.totalSent}/{EMAIL_LIMITS.FREE_LIFETIME_LIMIT}
        </span>
        {isBlocked && (
          <span className="text-red-500 text-xs ml-1">(Upgrade to continue)</span>
        )}
      </div>
    </div>
  );
}
