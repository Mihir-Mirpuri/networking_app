'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { getPendingSuggestionsCountAction } from '@/app/actions/meetingSuggestions';

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const { data: pendingSuggestionsCount, refetch } = usePolling(
    async () => {
      const result = await getPendingSuggestionsCountAction();
      return result.success ? result.data ?? 0 : 0;
    },
    { interval: 30000, enabled: !!session?.user }
  );

  // Refetch when pathname changes (to update after accept/dismiss)
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      refetch();
    }
  }, [pathname, refetch]);

  const tabs = [
    { name: 'Send Emails', href: '/' },
    { name: 'Email History', href: '/history' },
    { name: 'Calendar', href: '/calendar', badge: pendingSuggestionsCount ?? 0 },
    { name: 'Profile', href: '/profile' },
  ];

  const renderNavContent = () => {
    // Show skeleton placeholders while loading
    if (status === 'loading') {
      return (
        <nav className="flex items-center gap-1" aria-label="Loading navigation">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="px-4 py-2 w-24 h-9 bg-gray-200 rounded-md animate-pulse"
              aria-hidden="true"
            />
          ))}
        </nav>
      );
    }

    // Show actual navigation when authenticated
    if (session?.user) {
      return (
        <nav className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = pathname === tab.href;
            const showBadge = 'badge' in tab && tab.badge !== undefined && tab.badge > 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {tab.name}
                {showBadge && (
                  <span
                    className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-xs font-semibold rounded-full ${
                      isActive
                        ? 'bg-white text-blue-600'
                        : 'bg-red-500 text-white'
                    }`}
                  >
                    {tab.badge! > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      );
    }

    return null;
  };

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="text-xl font-bold text-gray-900">
            Lattice
          </Link>
          {renderNavContent()}
        </div>
      </div>
    </header>
  );
}
