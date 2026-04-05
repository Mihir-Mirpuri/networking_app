'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

export function ProfileDropdown() {
  const { data: session, status } = useSession();
  const [imgFailed, setImgFailed] = useState(false);

  const isLoading = status === 'loading';
  const isAuthenticated = !!session?.user;

  if (!isLoading && !isAuthenticated) return null;

  const userImage = session?.user?.image;
  const userName = session?.user?.name || '';
  const initials = userName
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Link
      href="/profile"
      className="flex items-center justify-center w-6 h-6 rounded-full overflow-hidden focus:outline-none ring-2 ring-transparent hover:ring-[#404040] transition-all"
      aria-label="Profile"
    >
      {userImage && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={userImage}
          alt={userName}
          className="w-6 h-6 rounded-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center text-white text-[10px] font-semibold">
          {initials || '?'}
        </div>
      )}
    </Link>
  );
}
