'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode, useEffect } from 'react';
import { useTimezone } from '@/hooks/useTimezone';
import { DrafterProvider } from '@/contexts/DrafterContext';
import { DrafterPanel } from '@/components/drafter/DrafterPanel';
import { ReferralCapture } from '@/components/ReferralCapture';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

/**
 * Component that runs silent background tasks (like timezone sync)
 * Must be inside SessionProvider to access auth state
 */
function BackgroundTasks() {
  useTimezone();
  return null;
}

function ThemeApplicator() {
  const { isSubscribed } = useSubscription();

  useEffect(() => {
    if (isSubscribed === null) return;
    const theme = isSubscribed ? 'pro' : 'free';
    document.body.setAttribute('data-theme', theme);
  }, [isSubscribed]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SubscriptionProvider>
        <ThemeApplicator />
        <DrafterProvider>
          <BackgroundTasks />
          <ReferralCapture />
          {children}
          <DrafterPanel />
        </DrafterProvider>
      </SubscriptionProvider>
    </SessionProvider>
  );
}
