import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';

/**
 * Safe local storage reader with TTL & corruption protection
 */
function readStorageCache(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.timestamp || !('data' in parsed)) {
      localStorage.removeItem(key); // Clear corrupted data
      return null;
    }

    if (maxAgeMs && Date.now() - parsed.timestamp > maxAgeMs) {
      // Stale cache (retain but flag)
      return { ...parsed, isStale: true };
    }

    return parsed;
  } catch (err) {
    console.warn(`[OfflineCache] Failed reading key "${key}":`, err);
    try { localStorage.removeItem(key); } catch {}
    return null;
  }
}

/**
 * Safe local storage writer with quota handling
 */
function writeStorageCache(key, data) {
  try {
    const payload = JSON.stringify({
      timestamp: Date.now(),
      data
    });
    localStorage.setItem(key, payload);
  } catch (err) {
    // Handle QuotaExceededError
    console.warn(`[OfflineCache] Storage write failed for "${key}":`, err);
  }
}

/**
 * useOfflineQuery — Bulletproof Data Fetching with Timeout & Offline Fallback
 * 
 * Safeguards:
 * 1. 5-second AbortController timeout prevents infinite skeleton hangs.
 * 2. Instant fallback to validated localStorage cache when network fails.
 * 3. Automatic background re-fetch upon network reconnection.
 * 4. Stale-While-Revalidate pattern: Shows cached content instantly while fetching fresh data.
 */
export function useOfflineQuery(queryKey, fetchFn, options = {}) {
  const {
    timeoutMs = 5000,
    maxAgeMs = 24 * 60 * 60 * 1000, // 24 hours
    staleWhileRevalidate = true,
    enabled = true
  } = options;

  const { isOnline } = useNetworkStatus();

  const [data, setData] = useState(() => {
    if (!staleWhileRevalidate) return null;
    const cached = readStorageCache(`glo_cache_${queryKey}`, maxAgeMs);
    return cached ? cached.data : null;
  });

  const [isFromCache, setIsFromCache] = useState(() => {
    const cached = readStorageCache(`glo_cache_${queryKey}`, maxAgeMs);
    return !!cached;
  });

  const [cachedAt, setCachedAt] = useState(() => {
    const cached = readStorageCache(`glo_cache_${queryKey}`, maxAgeMs);
    return cached ? cached.timestamp : null;
  });

  const [isLoading, setIsLoading] = useState(!data);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);

  const executeFetch = useCallback(async (isManualRetry = false) => {
    if (!enabled) return;

    // Check offline state before initiating request
    if (typeof navigator !== 'undefined' && !navigator.onLine && !isManualRetry) {
      const cached = readStorageCache(`glo_cache_${queryKey}`, maxAgeMs);
      if (cached) {
        setData(cached.data);
        setIsFromCache(true);
        setCachedAt(cached.timestamp);
        setError(null);
        setIsLoading(false);
        return;
      }
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Timeout safeguard: abort after timeoutMs
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    if (!data) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const freshData = await fetchFn({ signal: controller.signal });
      clearTimeout(timeoutTimer);

      setData(freshData);
      setIsFromCache(false);
      setCachedAt(null);
      setError(null);

      // Persist to safe offline cache
      writeStorageCache(`glo_cache_${queryKey}`, freshData);
    } catch (err) {
      clearTimeout(timeoutTimer);

      // Check if we have cached data to fall back on
      const cached = readStorageCache(`glo_cache_${queryKey}`, maxAgeMs);

      if (cached) {
        setData(cached.data);
        setIsFromCache(true);
        setCachedAt(cached.timestamp);
        setError(null); // Silent degradation to cache with offline badge
      } else {
        const errorMsg = err.name === 'AbortError'
          ? 'Network request timed out. Please check your connection and retry.'
          : (err.message || 'An unexpected error occurred.');
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [enabled, fetchFn, maxAgeMs, queryKey, timeoutMs, data]);

  // Initial fetch and auto-retry on reconnect
  useEffect(() => {
    executeFetch();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOnline]);

  return {
    data,
    isLoading,
    isRefreshing,
    isFromCache,
    cachedAt,
    error,
    isOnline,
    refetch: () => executeFetch(true)
  };
}
