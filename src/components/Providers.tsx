'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { useTimezone } from '@/hooks/useTimezone';

/**
 * Component that runs silent background tasks (like timezone sync)
 * Must be inside SessionProvider to access auth state
 */
function BackgroundTasks() {
  useTimezone();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <BackgroundTasks />
      {children}
    </SessionProvider>
  );
}
