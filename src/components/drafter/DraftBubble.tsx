'use client';

import { useState } from 'react';
import { EmailDraft } from '@/lib/services/drafter';

interface DraftBubbleProps {
  draft: EmailDraft;
  onCopy: () => void;
}

export function DraftBubble({ draft, onCopy }: DraftBubbleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#1a1a1a] border border-[#303030] rounded-lg overflow-hidden">
      {/* Header with copy button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#252525]">
        <span className="text-xs text-white">Draft</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-white hover:text-white hover:bg-[#252525] rounded transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* Email content */}
      <div className="p-3 space-y-3">
        {/* Subject */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white mb-1">
            Subject
          </div>
          <div className="text-sm text-white">{draft.subject}</div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[#252525]" />

        {/* Body */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white mb-1">
            Body
          </div>
          <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">
            {draft.body}
          </div>
        </div>
      </div>
    </div>
  );
}
