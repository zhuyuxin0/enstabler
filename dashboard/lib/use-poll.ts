"use client";

import { useEffect, useRef, useState } from "react";

// Lightweight polling hook. Re-fetches every `intervalMs`. Pauses when the tab
// is hidden so we don't burn API quota in background tabs.
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs = 3000,
): { data: T | null; error: Error | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const next = await fetcherRef.current();
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled && document.visibilityState === "visible") {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return { data, error, loading };
}
