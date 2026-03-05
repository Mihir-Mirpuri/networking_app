'use client';

import { useState, useEffect } from 'react';
import { createCheckoutSession, createCustomerPortalSession } from '@/app/actions/subscription';
import { EMAIL_LIMITS } from '@/lib/constants';

interface PlansModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSubscribed?: boolean;
}

export function PlansModal({ isOpen, onClose, isSubscribed }: PlansModalProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    setIsCheckoutLoading(true);
    try {
      await createCheckoutSession();
    } catch {
      setIsCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setIsPortalLoading(true);
    try {
      await createCustomerPortalSession();
    } catch {
      setIsPortalLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#111111] rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-scale-in border border-[#2a2a2a]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2a2a2a]">
          <h2 className="text-xl font-semibold text-white">Choose Your Plan</h2>
          <p className="text-sm text-[#707070] mt-1">
            {isSubscribed
              ? 'Manage your subscription'
              : 'Upgrade to unlock unlimited outreach'}
          </p>
        </div>

        {/* Plans */}
        <div className="p-6 space-y-4">
          {/* Free Plan */}
          <div
            className={`relative rounded-xl border p-5 transition-all ${
              !isSubscribed
                ? 'border-[#404040] bg-[#1a1a1a]'
                : 'border-[#2a2a2a] bg-[#0a0a0a]'
            }`}
          >
            {!isSubscribed && (
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-[#1a1a1a] text-[#707070] text-xs font-medium rounded">
                Current Plan
              </span>
            )}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Free</h3>
                <p className="text-[#707070] text-sm mt-1">
                  For getting started with networking
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-white">$0</span>
                <span className="text-[#505050] text-sm">/month</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#505050]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {EMAIL_LIMITS.DEFAULT_DAILY_LIMIT} emails per day
              </li>
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#505050]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                AI-powered email personalization
              </li>
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#505050]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Basic contact discovery
              </li>
            </ul>
          </div>

          {/* Pro Plan */}
          <div
            className={`relative rounded-xl border p-5 transition-all ${
              isSubscribed
                ? 'border-[#404040] bg-[#1a1a1a]'
                : 'border-[#3b82f6]/30 bg-gradient-to-br from-[#1a1a1a] to-[#0f172a]'
            }`}
          >
            {isSubscribed && (
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-[#1a1a1a] text-[#3b82f6] text-xs font-medium rounded border border-[#3b82f6]/30">
                Current Plan
              </span>
            )}
            {!isSubscribed && (
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 bg-[#3b82f6] text-white text-xs font-medium rounded">
                Recommended
              </span>
            )}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Pro</h3>
                <p className="text-[#707070] text-sm mt-1">
                  For serious networkers
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-white">$20</span>
                <span className="text-[#505050] text-sm">/month</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#3b82f6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-white font-medium">Unlimited</span> emails
              </li>
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#3b82f6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                AI-powered email personalization
              </li>
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#3b82f6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Priority contact discovery
              </li>
              <li className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                <svg
                  className="w-4 h-4 text-[#3b82f6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Email open tracking
              </li>
            </ul>

            {!isSubscribed && (
              <button
                onClick={handleUpgrade}
                disabled={isCheckoutLoading}
                className="w-full mt-5 py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isCheckoutLoading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Upgrade to Pro
                  </>
                )}
              </button>
            )}

            {isSubscribed && (
              <button
                onClick={handleManageSubscription}
                disabled={isPortalLoading}
                className="w-full mt-5 py-2.5 bg-[#2a2a2a] text-[#c0c0c0] font-medium rounded-lg hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isPortalLoading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Loading...
                  </>
                ) : (
                  'Manage Subscription'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a2a2a] flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium text-[#707070] hover:text-[#a0a0a0] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
