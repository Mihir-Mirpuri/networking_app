'use client';

import { useState, useEffect } from 'react';
import { createCheckoutSession, createUpfrontCheckoutSession } from '@/app/actions/subscription';
import { EMAIL_LIMITS, SUBSCRIPTION_PRICING } from '@/lib/constants';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

interface LimitReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreditsAwarded?: (creditsAwarded: number) => void;
}

export function LimitReachedModal({ isOpen, onClose }: LimitReachedModalProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isUpfrontLoading, setIsUpfrontLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonths, setSelectedMonths] = useState(6);
  const [paymentType, setPaymentType] = useState<'monthly' | 'upfront'>('upfront');

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

  const handleMonthlySubscribe = async () => {
    setIsCheckoutLoading(true);
    setError(null);
    try {
      await createCheckoutSession();
    } catch (err) {
      setError('Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

  const handleUpfrontSubscribe = async () => {
    setIsUpfrontLoading(true);
    setError(null);
    try {
      await createUpfrontCheckoutSession(selectedMonths);
    } catch (err) {
      setError('Failed to start checkout. Please try again.');
      setIsUpfrontLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const upfrontTotal = selectedMonths * SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH;
  const monthlySavings = (SUBSCRIPTION_PRICING.MONTHLY_PRICE - SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH) * selectedMonths;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div data-theme="pro" className="bg-[#111111] rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-scale-in border border-[#2a2a2a]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-900/20 to-orange-900/20 px-6 py-5 border-b border-[#2a2a2a]">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-900/30 rounded-full flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-amber-500"
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
              <h3 className="text-lg font-semibold text-white">Free Trial Ended</h3>
              <p className="text-sm text-white mt-1">
                You&apos;ve used all {EMAIL_LIMITS.FREE_LIFETIME_LIMIT} free emails. Upgrade to continue.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Subscribe Option */}
          <div className="bg-gradient-to-r from-[#1a1a1a] to-[#0f172a] rounded-lg p-4 border border-[var(--accent-border)]">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 bg-[var(--accent-badge-bg)] rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-[var(--accent-text)]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Upgrade to Pro</p>
                <p className="text-sm text-white mt-0.5">Unlimited emails and people search</p>
              </div>
            </div>

            {/* Payment Type Toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setPaymentType('upfront')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                  paymentType === 'upfront'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                }`}
              >
                Pay Upfront (Save 50%)
              </button>
              <button
                onClick={() => setPaymentType('monthly')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                  paymentType === 'monthly'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                }`}
              >
                Pay Monthly
              </button>
            </div>

            {paymentType === 'upfront' ? (
              <>
                {/* Month Slider */}
                <div className="mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-white">Recruiting Cycle</span>
                    <span className="text-xs font-medium text-white">{selectedMonths} months</span>
                  </div>
                  <input
                    type="range"
                    min={SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS}
                    max={SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS}
                    value={selectedMonths}
                    onChange={(e) => setSelectedMonths(parseInt(e.target.value))}
                    className="w-full h-2 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                  />
                  <div className="flex justify-between text-xs text-white mt-1">
                    <span>{SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS} mo</span>
                    <span>{SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS} mo</span>
                  </div>
                </div>

                {/* Price Display */}
                <div className="bg-[#0a0a0a] rounded-lg p-3 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">
                      ${SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH}/mo x {selectedMonths} mo
                    </span>
                    <span className="text-xl font-bold text-white">${upfrontTotal}</span>
                  </div>
                  <div className="text-xs text-[var(--accent-text)] mt-1">
                    Save ${monthlySavings} vs monthly
                  </div>
                </div>

                <button
                  onClick={handleUpfrontSubscribe}
                  disabled={isUpfrontLoading}
                  className="w-full py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {isUpfrontLoading ? (
                    <>
                      <LoadingSpinner size="sm" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Pay ${upfrontTotal} for {selectedMonths} Months
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                {/* Monthly Price Display */}
                <div className="bg-[#0a0a0a] rounded-lg p-3 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white">Monthly subscription</span>
                    <div className="text-right">
                      <span className="text-xl font-bold text-white">${SUBSCRIPTION_PRICING.MONTHLY_PRICE}</span>
                      <span className="text-white text-xs">/mo</span>
                    </div>
                  </div>
                  <div className="text-xs text-white mt-1">
                    Cancel anytime
                  </div>
                </div>

                <button
                  onClick={handleMonthlySubscribe}
                  disabled={isCheckoutLoading}
                  className="w-full py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
                      Subscribe for ${SUBSCRIPTION_PRICING.MONTHLY_PRICE}/month
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0a0a0a] border-t border-[#2a2a2a] flex justify-end">
          <button
            onClick={handleClose}
            className="text-sm font-medium text-white hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
