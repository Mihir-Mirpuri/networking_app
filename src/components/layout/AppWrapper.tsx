'use client';

import { AppShell } from './AppShell';

interface AppWrapperProps {
  initialRemainingDaily: number;
}

export function AppWrapper({ initialRemainingDaily }: AppWrapperProps) {
  return (
    <AppShell initialRemainingDaily={initialRemainingDaily} />
  );
}
