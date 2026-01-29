import { useState, useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  interval: number;        // Polling interval in ms
  enabled?: boolean;       // Enable/disable polling (default: true)
  immediate?: boolean;     // Fetch immediately on mount (default: true)
}

interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  isPolling: boolean;
  refetch: () => Promise<void>;
}

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  options: UsePollingOptions
): UsePollingResult<T> {
  const { interval, enabled = true, immediate = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Use refs to avoid stale closures and track in-progress fetches
  const fetchInProgressRef = useRef(false);
  const fetchFnRef = useRef(fetchFn);
  const mountedRef = useRef(true);

  // Keep fetchFn ref up to date
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const doFetch = useCallback(async () => {
    // Skip if fetch already in progress
    if (fetchInProgressRef.current) {
      return;
    }

    fetchInProgressRef.current = true;
    setIsPolling(true);

    try {
      const result = await fetchFnRef.current();
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      fetchInProgressRef.current = false;
      if (mountedRef.current) {
        setIsPolling(false);
      }
    }
  }, []);

  // Handle immediate fetch on mount
  useEffect(() => {
    if (enabled && immediate) {
      doFetch();
    }
  }, [enabled, immediate, doFetch]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const intervalId = setInterval(() => {
      doFetch();
    }, interval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, interval, doFetch]);

  return {
    data,
    error,
    isPolling,
    refetch: doFetch,
  };
}
