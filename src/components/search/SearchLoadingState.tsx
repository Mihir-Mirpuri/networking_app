'use client';

import { useState, useEffect } from 'react';

const STATUS_MESSAGES = [
  "Scanning the airwaves...",
  "Tuning frequencies...",
  "Picking up signals...",
  "Locking onto targets...",
  "Sweeping the spectrum...",
  "Decoding transmissions...",
  "Triangulating positions...",
  "Filtering static...",
  "Amplifying signals...",
  "Calibrating receivers...",
  "Boosting reception...",
  "Analyzing waveforms...",
  "Establishing uplink...",
  "Intercepting data...",
  "Mapping the network...",
  "Locating profiles...",
  "Tracking down leads...",
  "Identifying targets...",
  "Cross-referencing sources...",
  "Matching signatures...",
  "Detecting candidates...",
  "Zeroing in on matches...",
  "Running facial recognition...",
  "Extracting contact data...",
  "Decrypting inboxes...",
  "Tracing email routes...",
  "Pinging mail servers...",
  "Verifying addresses...",
  "Resolving endpoints...",
  "Querying directories...",
  "Unlocking channels...",
];

function SignalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Center dot */}
      <circle cx="100" cy="80" r="12" fill="white" />
      {/* Inner arcs */}
      <path className="animate-signal-arc-1" d="M78 56 A30 30 0 0 0 78 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-1" d="M122 56 A30 30 0 0 1 122 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      {/* Middle arcs */}
      <path className="animate-signal-arc-2" d="M58 38 A55 55 0 0 0 58 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-2" d="M142 38 A55 55 0 0 1 142 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      {/* Outer arcs */}
      <path className="animate-signal-arc-3" d="M38 20 A80 80 0 0 0 38 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path className="animate-signal-arc-3" d="M162 20 A80 80 0 0 1 162 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

interface SearchLoadingStateProps {
  onCancel?: () => void;
}

export function SearchLoadingState({ onCancel }: SearchLoadingStateProps) {
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * STATUS_MESSAGES.length)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div>
        <SignalIcon className="w-96 h-96" />
      </div>
      <p className="text-lg text-[#999] font-medium tracking-wide animate-pulse">
        {STATUS_MESSAGES[messageIndex]}
      </p>
      {onCancel && (
        <button
          onClick={() => {
            console.log('[UI] Cancel button clicked');
            onCancel();
          }}
          className="mt-6 px-5 py-2.5 text-sm font-medium text-[#999] bg-[#2a2a2a] border border-[#555] rounded-lg hover:bg-[#333] hover:text-white transition-colors"
        >
          Cancel Search
        </button>
      )}
    </div>
  );
}
