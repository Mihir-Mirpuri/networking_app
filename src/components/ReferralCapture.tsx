'use client';

import { useEffect, useRef } from 'react';
import { processReferralAction } from '@/app/actions/referral';

export function ReferralCapture() {
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;

    const match = document.cookie.match(/(?:^|;\s*)signl_ref=([^;]+)/);
    if (!match) return;

    processed.current = true;
    const code = decodeURIComponent(match[1]);

    // Clear the cookie
    document.cookie = 'signl_ref=; path=/; max-age=0';

    processReferralAction(code).catch(() => {});
  }, []);

  return null;
}
