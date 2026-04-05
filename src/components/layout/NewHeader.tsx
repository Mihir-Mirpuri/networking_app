'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProfileDropdown } from './ProfileDropdown';

function SignalLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="12" fill="white" />
      <path d="M78 56 A30 30 0 0 0 78 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M122 56 A30 30 0 0 1 122 104" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M58 38 A55 55 0 0 0 58 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M142 38 A55 55 0 0 1 142 122" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M38 20 A80 80 0 0 0 38 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M162 20 A80 80 0 0 1 162 140" stroke="white" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}

interface NewHeaderProps {
  onToggleSidebar?: () => void;
  showSidebarToggle?: boolean;
  showLogo?: boolean;
}

export function NewHeader({ onToggleSidebar, showSidebarToggle, showLogo = false }: NewHeaderProps) {
  const pathname = usePathname();

  const tabs = [
    { name: 'Outreach', href: '/app' },
    { name: 'History', href: '/history' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#212121]">
      <div className="px-4 sm:px-6">
        <div className="flex justify-between items-center h-14">
          {/* LEFT: Logo or Mobile sidebar toggle */}
          <div className="flex items-center">
            {showSidebarToggle && (
              <button
                onClick={onToggleSidebar}
                className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-white hover:text-white transition-colors"
                aria-label="Toggle sidebar"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            )}
            {showLogo && (
              <Link href="/" className="flex items-center gap-2 group">
                <SignalLogo className="w-7 h-7" />
                <span className="text-xl font-bold text-white group-hover:text-white transition-colors">
                  Signl
                </span>
              </Link>
            )}
          </div>

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
                        : 'text-white hover:text-white'
                    }`}
                  >
                    {tab.name}
                  </Link>
                );
              })}
            </nav>
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </header>
  );
}
