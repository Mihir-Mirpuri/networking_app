'use client';

import { useSession } from 'next-auth/react';
import { ComposeButton } from './ComposeButton';

export function AuthenticatedComposeButton() {
  const { data: session, status } = useSession();

  // Show loading placeholder while session is loading
  if (status === 'loading') {
    return (
      <div
        className="fixed bottom-6 right-6 w-14 h-14 bg-gray-300 rounded-full shadow-lg z-40 animate-pulse"
        aria-hidden="true"
      />
    );
  }

  // Don't show button if not authenticated
  if (status !== 'authenticated' || !session?.user) {
    return null;
  }

  return <ComposeButton />;
}
