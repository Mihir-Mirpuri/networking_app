'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';

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

const FallbackAvatar = () => (
  <div className="w-20 h-20 rounded-full bg-[#2a2a2a] flex items-center justify-center ring-2 ring-[#303030]">
    <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  </div>
);

function AvatarWithFallback({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <FallbackAvatar />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-20 h-20 rounded-full ring-2 ring-[#303030]"
      onError={() => setFailed(true)}
    />
  );
}

export type ProfileTab = 'account' | 'resumes' | 'templates';

interface ProfileSidebarProps {
  userName: string;
  userEmail: string;
  userImage: string;
  university: string | null;
  isSubscribed: boolean;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
}

const NAV_ITEMS: { key: ProfileTab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'account',
    label: 'Account',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
      </svg>
    ),
  },
  {
    key: 'resumes',
    label: 'Attachments',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
  },
  {
    key: 'templates',
    label: 'Templates',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
  },
];

export function ProfileSidebar({
  userName,
  userEmail,
  userImage,
  university,
  isSubscribed,
  activeTab,
  onTabChange,
}: ProfileSidebarProps) {

  return (
    <div className="w-80 shrink-0 bg-[#181818] flex flex-col pb-5 border-r border-[#2a2a2a]">
      {/* Logo header - matches home sidebar */}
      <div className="px-4 py-3 flex items-center">
        <Link href="/app" className="flex items-center gap-2 group">
          <SignalLogo className="w-7 h-7" />
          <span className="text-xl font-bold text-white group-hover:text-white transition-colors">
            Signl
          </span>
        </Link>
      </div>

      {/* Profile info */}
      <div className="flex flex-col items-center px-5 pt-4 gap-6">
      {/* Avatar */}
      <AvatarWithFallback src={userImage} alt={userName} />

      {/* Info */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg font-bold text-white">{userName || 'User'}</span>
        {university && <span className="text-xs text-white">{university}</span>}
        <span className="text-[10px] text-white">{userEmail}</span>
      </div>

      {/* Plan badge */}
      <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${
        isSubscribed
          ? 'bg-[#6364FF]/15 text-[#6364FF]'
          : 'bg-[#303030] text-white'
      }`}>
        {isSubscribed ? 'PRO Plan' : 'Free Plan'}
      </span>

      {/* Divider */}
      <div className="w-full h-px bg-[#252525]" />

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 w-full">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left transition-colors ${
                isActive
                  ? 'bg-[#2a2a2a] text-white'
                  : 'text-white hover:bg-[#252525] hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-white'}>{item.icon}</span>
              <span className="text-[13px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sign Out */}
      <div className="px-5">
        <button
          onClick={() => signOut({ callbackUrl: '/app' })}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
