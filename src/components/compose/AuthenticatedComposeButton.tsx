'use client';

import { useSession } from 'next-auth/react';
import { ComposeButton } from './ComposeButton';

export function AuthenticatedComposeButton() {
  const { data: session, status } = useSession();

  // Only show the compose button when authenticated
  if (status !== 'authenticated' || !session?.user) {
    return null;
  }

  return <ComposeButton />;
}
