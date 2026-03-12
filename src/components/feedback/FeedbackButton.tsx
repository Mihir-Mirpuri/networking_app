'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';

const PROMPTS = [
  "What's bugging you?",
  "Tell us what annoyed you",
  "Something feel off?",
  "Help us suck less",
  "Vent here, we can take it",
];

export function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  // Pick a random prompt on mount
  const [prompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

  // Hide on landing page, history page, and profile page
  if (pathname === '/' || pathname === '/history' || pathname === '/profile') {
    return null;
  }

  const handleSubmit = async () => {
    if (!feedback.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim(), page: pathname }),
      });

      if (!response.ok) {
        throw new Error('Failed to send feedback');
      }

      setSubmitted(true);
      setFeedback('');

      // Reset after 3 seconds
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
      }, 3000);
    } catch (err) {
      setError('Oops! Something went wrong. Try again?');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-[#2a2a2a] border border-[#404040] text-[#a0a0a0] hover:text-white px-4 py-3 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center gap-2 z-40 group"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span className="text-sm font-medium">Feedback</span>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div
            className="bg-[#212121] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-[#2a2a2a] border-b border-[#404040] px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-lg">{prompt}</h3>
                  <p className="text-[#808080] text-sm mt-0.5">
                    No filter needed. We actually read these.
                  </p>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-[#808080] hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-white mb-1">Thanks for the honesty!</h4>
                  <p className="text-[#808080]">We&apos;ll use this to make things better.</p>
                </div>
              ) : (
                <>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="The more specific, the better. Don't hold back..."
                    rows={4}
                    className="w-full px-4 py-3 bg-[#1a1a1a] border border-[#404040] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#606060] focus:border-transparent resize-none text-white placeholder-[#606060]"
                    autoFocus
                  />

                  {error && (
                    <p className="mt-2 text-sm text-red-600">{error}</p>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-[#606060]">
                      Your email will be included so we can follow up if needed
                    </p>
                    <button
                      onClick={handleSubmit}
                      disabled={!feedback.trim() || isSubmitting}
                      className="px-5 py-2.5 bg-[#404040] text-white font-medium rounded-xl hover:bg-[#505050] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <LoadingSpinner size="sm" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {!submitted && (
              <div className="px-6 py-3 bg-[#1a1a1a] border-t border-[#404040]">
                <p className="text-xs text-[#606060] text-center">
                  Bugs, complaints, feature requests, shower thoughts — all welcome
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
