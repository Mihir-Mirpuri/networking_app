'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { getPendingSuggestionsCountAction } from '@/app/actions/meetingSuggestions';
import {
  PaperAirplaneIcon,
  ClockIcon,
  CalendarDaysIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

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

  const tabs: { name: string; href: string; icon: typeof PaperAirplaneIcon; badge?: number }[] = [
    { name: 'Send Emails', href: '/', icon: PaperAirplaneIcon },
    { name: 'History', href: '/history', icon: ClockIcon },
    // TEMPORARILY DISABLED: gmail.readonly scope removed — Calendar has no utility without it
    // { name: 'Calendar', href: '/calendar', icon: CalendarDaysIcon, badge: pendingSuggestionsCount ?? 0 },
    { name: 'Profile', href: '/profile', icon: UserCircleIcon },
  ];

  const renderNavContent = () => {
    // Show skeleton placeholders while loading
    if (status === 'loading') {
      return (
        <nav className="flex items-center gap-1" aria-label="Loading navigation">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="px-4 py-2 w-28 h-10 bg-surface-200 rounded-lg animate-pulse"
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
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-md shadow-primary-600/25'
                    : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-surface-500'}`} />
                <span>{tab.name}</span>
                {showBadge && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] flex items-center justify-center text-xs font-bold rounded-full shadow-sm ${
                      isActive
                        ? 'bg-white text-primary-600'
                        : 'bg-accent-500 text-white'
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
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-subtle border-b border-surface-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <span className="text-xl font-bold text-surface-900 group-hover:text-primary-600 transition-colors">
                Signl
              </span>
            </Link>
          </div>
          {renderNavContent()}
        </div>
      </div>
    </header>
  );
}
