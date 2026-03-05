'use client';

import { signIn } from 'next-auth/react';

interface LoginPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export function LoginPromptModal({ isOpen, onClose, title, message }: LoginPromptModalProps) {
  if (!isOpen) return null;

  const handleSignIn = () => {
    signIn('google', { callbackUrl: '/' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-[#1a1a1a] border border-[#303030] rounded-2xl overflow-hidden shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="px-8 py-10 text-center">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-[#6364FF]/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#6364FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-white mb-2">{title}</h2>

          {/* Message */}
          <p className="text-[#808080] mb-8">{message}</p>

          {/* Sign in button */}
          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-3 py-3 px-6 rounded-xl bg-[#6364FF] hover:bg-[#7879ff] text-white font-semibold transition-all hover:shadow-lg hover:shadow-[#6364FF]/25"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>

          {/* Secondary text */}
          <p className="text-sm text-[#505050] mt-4">
            Free to use. No credit card required.
          </p>
        </div>
      </div>
    </div>
  );
}
