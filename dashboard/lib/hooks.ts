"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api, RolloutSummary, RolloutDetail, MetricPoint, StepInfo, DecisionInfo, SystemHealth } from "./api";

/** Generic polling hook — fetches every `interval` ms, returns data + loading state. */
function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
  deps: unknown[] = []
): { data: T | null; loading: boolean; error: Error | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch, interval]);

  return { data, loading, error, refresh: fetch };
}

/**
 * One-shot fetch with a manual `refresh`, for resources that change only when
 * the user changes them — routing rules, provider keys, webhooks. Polling
 * those would be pointless traffic.
 *
 * The fetcher is held in a ref so callers can pass an inline closure without
 * re-triggering the effect on every render, and the dependency list stays an
 * array literal.
 */
export function useResource<T>(fetcher: () => Promise<T>): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Keep the latest fetcher without making it a dependency. Assigned inside an
  // effect rather than during render — writing a ref while rendering is not
  // safe under concurrent rendering.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useRollouts() {
  return usePolling(() => api.rollouts.list(), 3_000);
}

export function useRollout(id: string) {
  return usePolling(() => api.rollouts.get(id), 3_000, [id]);
}

export function useRolloutMetrics(id: string) {
  return usePolling(() => api.rollouts.metrics(id), 5_000, [id]);
}

export function useRolloutSteps(id: string) {
  return usePolling(() => api.rollouts.steps(id), 5_000, [id]);
}

export function useRolloutDecisions(id: string) {
  return usePolling(() => api.rollouts.decisions(id), 5_000, [id]);
}

export function useSystemHealth() {
  return usePolling(() => api.system.health(), 10_000);
}
