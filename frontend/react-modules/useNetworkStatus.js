import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useNetworkStatus — Industrial-Grade Network Resilience & State Hook
 * 
 * Safeguards:
 * 1. Dual-layer detection: Listens to browser 'online'/'offline' events AND
 *    performs lightweight background heartbeat pings to detect "captive portals" or phantom connections.
 * 2. Flaky Connection Debouncing: Prevents rapid UI toggling during network jitter.
 * 3. Memory leak protection: Cleans up all event listeners and intervals on unmount.
 */
export function useNetworkStatus(options = {}) {
  const {
    pingUrl = '/api/health',
    pingIntervalMs = 30000,
    debounceMs = 1000
  } = options;

  const [isOnline, setIsOnline] = useState(() => 
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isFlaky, setIsFlaky] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState(() => Date.now());

  const debounceTimerRef = useRef(null);

  // Active heartbeat ping to verify true internet reachability
  const checkRealConnection = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // Cache-busted lightweight HEAD/GET request
      const res = await fetch(`${pingUrl}?_t=${Date.now()}`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store'
      });

      clearTimeout(timeoutId);
      const online = res.ok;
      setIsOnline(online);
      if (online) setLastOnlineAt(Date.now());
      setIsFlaky(false);
      return online;
    } catch {
      // Failed ping despite navigator.onLine = true (indicates captive portal or dead gateway)
      setIsOnline(false);
      setIsFlaky(true);
      return false;
    }
  }, [pingUrl]);

  useEffect(() => {
    const handleOnline = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        checkRealConnection();
      }, debounceMs);
    };

    const handleOffline = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic heartbeat check
    const interval = setInterval(checkRealConnection, pingIntervalMs);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [checkRealConnection, debounceMs, pingIntervalMs]);

  return { isOnline, isFlaky, lastOnlineAt, checkRealConnection };
}
