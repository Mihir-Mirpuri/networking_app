'use client';

import { useSession } from 'next-auth/react';
import { AppShell } from './AppShell';
import { WelcomeModal, useWelcomeModal } from '@/components/landing/WelcomeModal';

interface AppWrapperProps {
  initialRemainingDaily: number;
}

export function AppWrapper({ initialRemainingDaily }: AppWrapperProps) {
  const { data: session, status } = useSession();
  const { showModal, closeModal } = useWelcomeModal();

  const isAuthenticated = !!session?.user;
  const isLoading = status === 'loading';

  // Show welcome modal for unauthenticated first-time visitors
  const shouldShowWelcome = !isAuthenticated && !isLoading && showModal;

  return (
    <>
      <AppShell
        initialRemainingDaily={initialRemainingDaily}
        isAuthenticated={isAuthenticated}
      />
      {shouldShowWelcome && <WelcomeModal onClose={closeModal} />}
    </>
  );
}
