'use client';

import { useSession } from 'next-auth/react';
import { AppShell } from './AppShell';

interface AppWrapperProps {
  initialRemainingDaily: number;
}

export function AppWrapper({ initialRemainingDaily }: AppWrapperProps) {
  const { data: session } = useSession();

  const isAuthenticated = !!session?.user;

  return (
    <AppShell
      initialRemainingDaily={initialRemainingDaily}
      isAuthenticated={isAuthenticated}
    />
  );
}
