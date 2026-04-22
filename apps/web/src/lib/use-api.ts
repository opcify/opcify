"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback((showLoading: boolean) => {
    if (showLoading) setLoading(true);
    setError(null);
    fetcherRef.current()
      .then((d) => {
        if (mountedRef.current) setData(d);
      })
      .catch((e) => {
        if (mountedRef.current) setError(e.message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    load(true);
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const refetch = useCallback(() => {
    // Refetch silently — don't show loading skeleton, just update data in place
    load(false);
  }, [load]);

  return { data, loading, error, refetch };
}
