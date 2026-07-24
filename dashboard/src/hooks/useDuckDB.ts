import { useState, useEffect, useCallback } from 'react';
import { query, initDuckDB } from '../lib/duckdb';

interface UseDuckDBResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  durationMs: number | null;
  refetch: () => void;
}

export function useDuckDB<T = Record<string, unknown>>(
  sql: string,
  deps: unknown[] = []
): UseDuckDBResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        await initDuckDB();
        const result = await query<T>(sql);
        if (!cancelled) {
          setData(result.rows);
          setDurationMs(result.durationMs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, trigger, ...deps]);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  return { data, loading, error, durationMs, refetch };
}
