'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Header() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const tabs = [
    { name: 'Send Emails', href: '/' },
    { name: 'Email History', href: '/history' },
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
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {tab.name}
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
