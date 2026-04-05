'use client';

import { useState, useEffect } from 'react';
import { createCheckoutSession } from '@/app/actions/subscription';
import { EMAIL_LIMITS } from '@/lib/constants';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

interface LimitReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreditsAwarded?: (creditsAwarded: number) => void;
}

export function LimitReachedModal({ isOpen, onClose }: LimitReachedModalProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubscribe = async () => {
    setIsCheckoutLoading(true);
    setError(null);
    try {
      await createCheckoutSession();
    } catch (err) {
      setError('Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="bg-surface-100 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-5 border-b border-amber-100">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-surface-900">Free Limit Reached</h3>
              <p className="text-sm text-surface-600 mt-1">
                You&apos;ve used all {EMAIL_LIMITS.FREE_LIFETIME_LIMIT} of your free email sends.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Subscribe Option */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900">Unlimited emails with Pro</p>
                <p className="text-sm text-blue-700 mt-0.5">Send unlimited outreach emails for $20/month</p>
              </div>
            </div>
            <button
              onClick={handleSubscribe}
              disabled={isCheckoutLoading}
              className="w-full mt-3 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isCheckoutLoading ? (
                <>
                  <LoadingSpinner size="sm" />
                  Loading...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Upgrade to Pro - $20/month
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="p-3 mt-4 bg-red-900/20 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-50 border-t flex justify-between items-center">
          <p className="text-xs text-surface-500">Upgrade to Pro for unlimited emails and searches</p>
          <button
            onClick={handleClose}
            className="text-sm font-medium text-surface-600 hover:text-surface-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
