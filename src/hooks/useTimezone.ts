'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { updateTimezoneAction } from '@/app/actions/profile';

/**
 * Hook that silently captures and saves the user's browser timezone.
 * Only updates if the user doesn't already have a timezone set.
 * Should be called once near the root of the app (e.g., in layout or providers).
 */
export function useTimezone() {
  const { data: session, status } = useSession();
  const hasSynced = useRef(false);

  useEffect(() => {
    // Only run once per session, when authenticated
    if (status !== 'authenticated' || hasSynced.current) {
      return;
    }

    const syncTimezone = async () => {
      try {
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!browserTimezone) {
          console.warn('[useTimezone] Could not detect browser timezone');
          return;
        }

        const result = await updateTimezoneAction(browserTimezone);

        if (result.success && result.updated) {
          console.log(`[useTimezone] Saved timezone: ${browserTimezone}`);
        }

        hasSynced.current = true;
      } catch (error) {
        console.error('[useTimezone] Failed to sync timezone:', error);
      }
    };

    syncTimezone();
  }, [status]);
}
