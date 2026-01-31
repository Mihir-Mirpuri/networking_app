'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export default function SignInPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-50 to-primary-50">
        <div className="flex items-center gap-3 text-surface-600">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  if (status === 'authenticated') {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-50 via-white to-primary-50/30 px-4">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="card p-8 animate-fade-in-up">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-glow mb-6">
              <span className="text-white font-bold text-2xl">L</span>
            </div>
            <h1 className="text-2xl font-bold text-surface-900">Welcome to Lattice</h1>
            <p className="mt-2 text-surface-500">
              Finance & consulting recruiting outreach tool
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <p className="font-semibold flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Authentication failed
              </p>
              <p className="mt-1 text-red-600">
                {error === 'OAuthCallback' && 'There was a problem with the Google sign-in. Please try again.'}
                {error === 'OAuthAccountNotLinked' && 'This email is already linked to another account.'}
                {error === 'AccessDenied' && 'Access was denied. Please grant the required permissions.'}
                {!['OAuthCallback', 'OAuthAccountNotLinked', 'AccessDenied'].includes(error) && `Error: ${error}`}
              </p>
            </div>
          )}

          {/* Sign In Button */}
          <button
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 border border-surface-300 rounded-xl shadow-soft bg-white hover:bg-surface-50 hover:border-surface-400 hover:shadow-soft-lg transition-all"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="text-surface-800 font-medium">Sign in with Google</span>
          </button>

          {/* Info Text */}
          <p className="mt-5 text-center text-sm text-surface-500">
            Gmail access is required to send outreach emails on your behalf.
          </p>
        </div>

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm text-surface-400">
          <a href="/privacy" className="hover:text-surface-600 transition-colors">Privacy Policy</a>
          <span className="mx-3">·</span>
          <a href="/terms" className="hover:text-surface-600 transition-colors">Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
