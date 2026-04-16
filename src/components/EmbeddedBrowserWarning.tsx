'use client';

import { useEffect, useState } from 'react';
import { isEmbeddedBrowser } from '@/lib/browser-detection';

export function EmbeddedBrowserWarning() {
  const [showWarning, setShowWarning] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setShowWarning(isEmbeddedBrowser(navigator.userAgent));
    }
  }, []);

  if (!showWarning) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = currentUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
          <svg
            className="h-8 w-8 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-xl font-semibold text-gray-900">
          Open in Browser
        </h2>

        <p className="mb-6 text-gray-600">
          Google sign-in doesn&apos;t work in the LinkedIn app browser. Please open this link in Safari or Chrome.
        </p>

        <div className="space-y-3">
          <button
            onClick={handleCopy}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>

          <p className="text-sm text-gray-500">
            Then paste it in Safari or Chrome
          </p>
        </div>

        <div className="mt-6 rounded-lg bg-gray-50 p-4 text-left">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            On iPhone/iPad
          </p>
          <p className="text-sm text-gray-600">
            Tap <strong>•••</strong> in the top right → <strong>Open in Safari</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
