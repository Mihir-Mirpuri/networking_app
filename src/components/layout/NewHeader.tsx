'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ProfileDropdown } from './ProfileDropdown';

interface NewHeaderProps {
  onToggleSidebar?: () => void;
  showSidebarToggle?: boolean;
  isAuthenticated?: boolean;
}

export function NewHeader({ onToggleSidebar, showSidebarToggle, isAuthenticated = true }: NewHeaderProps) {
  const pathname = usePathname();

  const tabs = [
    { name: 'Outreach', href: '/' },
    { name: 'History', href: '/history' },
  ];

  const handleSignIn = () => {
    signIn('google', { callbackUrl: '/' });
  };

  return (
    <header className="sticky top-0 z-40 bg-[#212121]">
      <div className="px-4 sm:px-6">
        <div className="flex justify-end items-center h-14">
          {/* Mobile sidebar toggle */}
          {showSidebarToggle && (
            <button
              onClick={onToggleSidebar}
              className="lg:hidden absolute left-4 flex items-center justify-center w-8 h-8 rounded-lg text-[#808080] hover:text-white transition-colors"
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}

          {/* RIGHT: Nav tabs + Profile/Sign In */}
          <div className="flex items-center gap-6">
            <nav className="flex items-center gap-6" aria-label="Main navigation">
              {tabs.map((tab) => {
                const isActive = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? 'text-white'
                        : 'text-[#505050] hover:text-[#808080]'
                    }`}
                  >
                    {tab.name}
                  </Link>
                );
              })}
            </nav>
            {isAuthenticated ? (
              <ProfileDropdown />
            ) : (
              <button
                onClick={handleSignIn}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#6364FF] hover:bg-[#7879ff] rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
