/**
 * React Hooks for DuckDB-WASM
 * ============================
 * 
 * These hooks provide declarative SQL querying from React components.
 * They handle loading states, errors, performance timing, and re-fetching.
 * 
 * DATA ENGINEERING INSIGHT:
 * Reactive queries mean the dashboard re-computes instantly when filters change.
 * No HTTP round-trip, no cache invalidation — just a fresh SQL execution
 * against the local Parquet data in ~5-30ms.
 */

import { useState, useEffect, useCallback } from 'react';
import { query, initDuckDB } from '../lib/duckdb';

interface UseDuckDBResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  durationMs: number | null;
  refetch: () => void;
}

/**
 * Hook to execute a SQL query against DuckDB-WASM.
 * Re-executes when sql string or deps change.
 * 
 * @param sql - The SQL query to execute
 * @param deps - Dependency array (re-runs query when deps change)
 * 
 * Usage:
 *   const { data, loading, durationMs } = useDuckDB<Row>(
 *     `SELECT region, COUNT(*) as n FROM flood_control 
 *      WHERE infra_year = ${year} GROUP BY region`,
 *     [year]
 *   );
 */
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

/**
 * Hook that only initializes DuckDB without running a query.
 */
export function useDuckDBReady(): { ready: boolean; error: Error | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    initDuckDB()
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  return { ready, error };
}
