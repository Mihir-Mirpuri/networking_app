'use client';

import { useState, useEffect } from 'react';

const SEARCH_STEPS = [
  'Scanning profiles...',
  'Matching your criteria...',
  'Finding contact details...',
  'Verifying email addresses...',
  'Drafting personalized emails...',
];

export function SearchLoadingState() {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % SEARCH_STEPS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="py-8">
      {/* Header with ripple animation */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative flex items-center justify-center mb-4" style={{ width: 80, height: 80 }}>
          <div className="absolute w-12 h-12 rounded-full border-2 border-primary-400/30 animate-ripple" />
          <div className="absolute w-12 h-12 rounded-full border-[1.5px] border-primary-300/20 animate-ripple [animation-delay:0.7s]" />
          <div className="relative w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
        </div>

        <p className="text-base font-medium text-surface-800 mb-1">Discovering people</p>
        <p className="text-sm text-surface-500">{SEARCH_STEPS[stepIndex]}</p>

        {/* Step indicators - active one expands into a pill */}
        <div className="flex items-center gap-1.5 mt-3">
          {SEARCH_STEPS.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-500 ${
                i === stepIndex
                  ? 'w-5 h-1.5 bg-primary-500'
                  : 'w-1.5 h-1.5 bg-surface-200'
              }`}
            />
          ))}
        </div>

        <p className="text-xs text-surface-400 mt-3">This can take up to 30 seconds</p>
      </div>

      {/* Skeleton cards matching PersonCard layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonPersonCard key={i} delay={i * 0.15} />
        ))}
      </div>
    </div>
  );
}

function SkeletonPersonCard({ delay }: { delay: number }) {
  return (
    <div
      className="card p-5 flex flex-col items-center animate-pulse"
      style={{ animationDelay: `${delay}s` }}
    >
      {/* Avatar */}
      <div className="w-16 h-16 rounded-full bg-surface-200 mb-4" />
      {/* Name */}
      <div className="h-4 bg-surface-200 rounded-md w-32 mb-2" />
      {/* Role */}
      <div className="h-3 bg-surface-100 rounded-md w-24 mb-4" />
      {/* Info rows */}
      <div className="w-full space-y-2.5 text-left mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-surface-100 flex-shrink-0" />
          <div className="h-3 bg-surface-100 rounded-md w-3/4" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-surface-100 flex-shrink-0" />
          <div className="h-3 bg-surface-100 rounded-md w-1/2" />
        </div>
      </div>
      {/* Button placeholder */}
      <div className="w-full h-9 bg-surface-200 rounded-lg mt-auto" />
    </div>
  );
}
