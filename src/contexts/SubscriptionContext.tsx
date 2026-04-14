'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { getSubscriptionStatus } from '@/app/actions/subscription';

interface SubscriptionState {
  isSubscribed: boolean | null;
  currentPeriodEnd?: Date | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const result = await getSubscriptionStatus();
    setIsSubscribed(result.isSubscribed ?? false);
    setCurrentPeriodEnd(result.currentPeriodEnd ?? null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      refresh();
    } else if (status === 'unauthenticated') {
      setIsSubscribed(false);
      setCurrentPeriodEnd(null);
      setIsLoading(false);
    }
  }, [status, refresh]);

  return (
    <SubscriptionContext.Provider value={{ isSubscribed, currentPeriodEnd, isLoading, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used within SubscriptionProvider');
  }
  return ctx;
}
