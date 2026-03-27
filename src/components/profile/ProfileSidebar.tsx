'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';

function MascotSVG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="54" fill="url(#mascotBgProfile)"/>
      <path d="M18 60 Q25 42 32 60 Q39 78 46 60 Q53 42 60 60 Q67 78 74 60 Q81 42 88 60 Q95 78 102 60" stroke="url(#waveGradProfile)" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
      <circle cx="52" cy="52" r="5" fill="#e0e0e0"/><circle cx="68" cy="52" r="5" fill="#e0e0e0"/>
      <circle cx="53.5" cy="53.5" r="2.5" fill="#1a1a1a"/><circle cx="69.5" cy="53.5" r="2.5" fill="#1a1a1a"/>
      <circle cx="54.5" cy="52.5" r="1" fill="white" opacity="0.8"/><circle cx="70.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
      <path d="M52 70 Q60 77 68 70" stroke="#e0e0e0" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <line x1="60" y1="6" x2="60" y2="22" stroke="#808080" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="60" cy="5" r="3.5" fill="#a0a0a0"/>
      <defs>
        <radialGradient id="mascotBgProfile" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stopColor="#3a3a3a"/><stop offset="100%" stopColor="#2a2a2a"/></radialGradient>
        <linearGradient id="waveGradProfile" x1="18" y1="60" x2="102" y2="60"><stop offset="0%" stopColor="#808080"/><stop offset="50%" stopColor="#a0a0a0"/><stop offset="100%" stopColor="#808080"/></linearGradient>
      </defs>
    </svg>
  );
}

const FallbackAvatar = () => (
  <div className="w-20 h-20 rounded-full bg-[#2a2a2a] flex items-center justify-center ring-2 ring-[#303030]">
    <svg className="w-10 h-10 text-[#505050]" fill="currentColor" viewBox="0 0 24 24">
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

export type ProfileTab = 'profile' | 'resumes' | 'templates' | 'billing' | 'settings';

interface ProfileSidebarProps {
  userName: string;
  userEmail: string;
  userImage: string;
  university: string | null;
  classification: string | null;
  major: string | null;
  isSubscribed: boolean;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
}

const NAV_ITEMS: { key: ProfileTab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'profile',
    label: 'Profile',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
      </svg>
    ),
  },
  {
    key: 'resumes',
    label: 'Resumes',
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
  {
    key: 'billing',
    label: 'Billing',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    ),
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
];

export function ProfileSidebar({
  userName,
  userEmail,
  userImage,
  university,
  classification,
  major,
  isSubscribed,
  activeTab,
  onTabChange,
}: ProfileSidebarProps) {
  const details = [major, classification].filter(Boolean).join(' · ');

  return (
    <div className="w-80 shrink-0 bg-[#181818] flex flex-col pb-5 border-r border-[#2a2a2a]">
      {/* Logo header - matches home sidebar */}
      <div className="px-4 py-3 flex items-center">
        <Link href="/app" className="flex items-center gap-2 group">
          <MascotSVG className="w-7 h-7" />
          <span className="text-xl font-bold text-white group-hover:text-[#a0a0a0] transition-colors">
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
        {university && <span className="text-xs text-[#707070]">{university}</span>}
        {details && <span className="text-[11px] text-[#505050]">{details}</span>}
        <span className="text-[10px] text-[#505050]">{userEmail}</span>
      </div>

      {/* Plan badge */}
      <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${
        isSubscribed
          ? 'bg-[#6364FF]/15 text-[#6364FF]'
          : 'bg-[#303030] text-[#808080]'
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
                  : 'text-[#606060] hover:bg-[#252525] hover:text-[#909090]'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-[#606060]'}>{item.icon}</span>
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
