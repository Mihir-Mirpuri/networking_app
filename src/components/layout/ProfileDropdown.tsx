'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { PlansModal } from '@/components/credits/PlansModal';

interface ProfileDropdownProps {
  isSubscribed?: boolean;
}

export function ProfileDropdown({ isSubscribed }: ProfileDropdownProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowFeedback(false);
        setFeedbackSent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!session?.user) return null;

  const handleFeedbackSubmit = async () => {
    if (!feedback.trim()) return;
    setFeedbackSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim(), page: '/' }),
      });
      if (response.ok) {
        setFeedbackSent(true);
        setFeedback('');
        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackSent(false);
          setOpen(false);
        }, 1500);
      }
    } catch {
      // silently fail
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <>
      <PlansModal
        isOpen={showPlansModal}
        onClose={() => setShowPlansModal(false)}
        isSubscribed={isSubscribed}
      />
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center w-8 h-8 text-[#808080] hover:text-white transition-colors focus:outline-none"
          aria-label="Menu"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#111111] border border-[#2a2a2a] rounded-xl shadow-lg z-50 animate-fade-in">
          {showFeedback ? (
            <div className="p-3">
              {feedbackSent ? (
                <div className="flex items-center gap-2 py-2 text-sm text-green-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Thanks for your feedback!
                </div>
              ) : (
                <>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What's on your mind?"
                    rows={3}
                    autoFocus
                    className="w-full px-3 py-2 text-sm bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[#c0c0c0] placeholder:text-[#505050] focus:outline-none focus:border-[#404040] resize-none"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <button
                      onClick={() => setShowFeedback(false)}
                      className="text-xs text-[#606060] hover:text-[#808080] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleFeedbackSubmit}
                      disabled={!feedback.trim() || feedbackSubmitting}
                      className="px-3 py-1.5 text-xs font-medium bg-[#2a2a2a] text-[#c0c0c0] rounded-lg hover:bg-[#333333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {feedbackSubmitting ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-[#2a2a2a]">
                <p className="text-sm font-medium text-white truncate">{session.user.name}</p>
                <p className="text-xs text-[#707070] truncate">{session.user.email}</p>
              </div>
              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#c0c0c0] hover:bg-[#1a1a1a] transition-colors"
                >
                  <svg className="w-4 h-4 text-[#707070]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                  Profile
                </Link>
                <button
                  onClick={() => setShowFeedback(true)}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#c0c0c0] hover:bg-[#1a1a1a] transition-colors"
                >
                  <svg className="w-4 h-4 text-[#707070]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
                  </svg>
                  Send Feedback
                </button>
                <button
                onClick={() => {
                  setShowPlansModal(true);
                  setOpen(false);
                }}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-[#c0c0c0] hover:bg-[#1a1a1a] transition-colors"
              >
                <svg className="w-4 h-4 text-[#707070]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                </svg>
                Plans
              </button>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-[#1a1a1a] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                  </svg>
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      )}
      </div>
    </>
  );
}
