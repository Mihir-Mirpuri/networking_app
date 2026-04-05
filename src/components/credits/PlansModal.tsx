'use client';

import { useState, useEffect } from 'react';
import { createCheckoutSession, createUpfrontCheckoutSession, createCustomerPortalSession } from '@/app/actions/subscription';
import { EMAIL_LIMITS, SUBSCRIPTION_PRICING } from '@/lib/constants';

interface PlansModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSubscribed?: boolean;
}

export function PlansModal({ isOpen, onClose, isSubscribed }: PlansModalProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isUpfrontLoading, setIsUpfrontLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState(6);
  const [paymentType, setPaymentType] = useState<'monthly' | 'upfront'>('upfront');

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

  const handleMonthlyUpgrade = async () => {
    setIsCheckoutLoading(true);
    try {
      await createCheckoutSession();
    } catch {
      setIsCheckoutLoading(false);
    }
  };

  const handleUpfrontUpgrade = async () => {
    setIsUpfrontLoading(true);
    try {
      await createUpfrontCheckoutSession(selectedMonths);
    } catch {
      setIsUpfrontLoading(false);
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

  const upfrontTotal = selectedMonths * SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH;
  const monthlySavings = (SUBSCRIPTION_PRICING.MONTHLY_PRICE - SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH) * selectedMonths;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#111111] rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-scale-in border border-[#2a2a2a]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2a2a2a]">
          <h2 className="text-xl font-semibold text-white">Choose Your Plan</h2>
          <p className="text-sm text-white mt-1">
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
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-[#1a1a1a] text-white text-xs font-medium rounded">
                Current Plan
              </span>
            )}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Free Trial</h3>
                <p className="text-white text-sm mt-1">
                  Try the app before committing
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-white">$0</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              <li className="flex items-center gap-2 text-sm text-white">
                <svg
                  className="w-4 h-4 text-white"
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
                {EMAIL_LIMITS.FREE_LIFETIME_LIMIT} emails total
              </li>
              <li className="flex items-center gap-2 text-sm text-white">
                <svg
                  className="w-4 h-4 text-white"
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
          {!isSubscribed && (
            <div className="relative rounded-xl border p-5 transition-all border-[#3b82f6]/30 bg-gradient-to-br from-[#1a1a1a] to-[#0f172a]">
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 bg-[#3b82f6] text-white text-xs font-medium rounded">
                Best Value
              </span>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Pro</h3>
                  <p className="text-white text-sm mt-1">
                    Full access for your recruiting cycle
                  </p>
                </div>
              </div>

              {/* Payment Type Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setPaymentType('upfront')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                    paymentType === 'upfront'
                      ? 'bg-[#3b82f6] text-white'
                      : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                  }`}
                >
                  Pay Upfront (Save 50%)
                </button>
                <button
                  onClick={() => setPaymentType('monthly')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                    paymentType === 'monthly'
                      ? 'bg-[#3b82f6] text-white'
                      : 'bg-[#2a2a2a] text-white hover:bg-[#333333]'
                  }`}
                >
                  Pay Monthly
                </button>
              </div>

              {paymentType === 'upfront' ? (
                <>
                  {/* Month Slider */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-white">Recruiting Cycle Length</span>
                      <span className="text-sm font-medium text-white">{selectedMonths} months</span>
                    </div>
                    <input
                      type="range"
                      min={SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS}
                      max={SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS}
                      value={selectedMonths}
                      onChange={(e) => setSelectedMonths(parseInt(e.target.value))}
                      className="w-full h-2 bg-[#2a2a2a] rounded-lg appearance-none cursor-pointer accent-[#3b82f6]"
                    />
                    <div className="flex justify-between text-xs text-white mt-1">
                      <span>{SUBSCRIPTION_PRICING.MIN_UPFRONT_MONTHS} mo</span>
                      <span>{SUBSCRIPTION_PRICING.MAX_UPFRONT_MONTHS} mo</span>
                    </div>
                  </div>

                  {/* Price Display */}
                  <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-white">
                        ${SUBSCRIPTION_PRICING.UPFRONT_PRICE_PER_MONTH}/mo x {selectedMonths} months
                      </span>
                      <span className="text-2xl font-bold text-white">${upfrontTotal}</span>
                    </div>
                    <div className="text-sm text-green-400 mt-1">
                      You save ${monthlySavings} compared to monthly
                    </div>
                  </div>

                  <button
                    onClick={handleUpfrontUpgrade}
                    disabled={isUpfrontLoading}
                    className="w-full py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {isUpfrontLoading ? (
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
                        Pay ${upfrontTotal} for {selectedMonths} Months
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* Monthly Price Display */}
                  <div className="bg-[#0a0a0a] rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-white">Monthly subscription</span>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-white">${SUBSCRIPTION_PRICING.MONTHLY_PRICE}</span>
                        <span className="text-white text-sm">/month</span>
                      </div>
                    </div>
                    <div className="text-sm text-white mt-1">
                      Cancel anytime
                    </div>
                  </div>

                  <button
                    onClick={handleMonthlyUpgrade}
                    disabled={isCheckoutLoading}
                    className="w-full py-2.5 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
                        Subscribe for ${SUBSCRIPTION_PRICING.MONTHLY_PRICE}/month
                      </>
                    )}
                  </button>
                </>
              )}

              <ul className="mt-4 space-y-2">
                <li className="flex items-center gap-2 text-sm text-white">
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
                <li className="flex items-center gap-2 text-sm text-white">
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
                  <span className="text-white font-medium">Unlimited</span> people search
                </li>
                <li className="flex items-center gap-2 text-sm text-white">
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
                <li className="flex items-center gap-2 text-sm text-white">
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
              </ul>
            </div>
          )}

          {/* Subscribed User - Manage Subscription */}
          {isSubscribed && (
            <div className="relative rounded-xl border p-5 transition-all border-[#404040] bg-[#1a1a1a]">
              <span className="absolute -top-2.5 left-4 px-2 py-0.5 bg-[#1a1a1a] text-[#3b82f6] text-xs font-medium rounded border border-[#3b82f6]/30">
                Current Plan
              </span>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Pro</h3>
                  <p className="text-white text-sm mt-1">
                    Unlimited access
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                <li className="flex items-center gap-2 text-sm text-white">
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
                <li className="flex items-center gap-2 text-sm text-white">
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
                  <span className="text-white font-medium">Unlimited</span> people search
                </li>
              </ul>

              <button
                onClick={handleManageSubscription}
                disabled={isPortalLoading}
                className="w-full mt-5 py-2.5 bg-[#2a2a2a] text-white font-medium rounded-lg hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a2a2a] flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium text-white hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
