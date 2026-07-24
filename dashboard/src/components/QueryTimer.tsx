/**
 * QueryTimer Component
 * =====================
 * 
 * Displays query execution time to demonstrate DuckDB-WASM performance.
 * 
 * DATA ENGINEERING INSIGHT:
 * Showing query timing builds trust with users. When they see "Query: 4ms"
 * they understand why the dashboard feels instant. It also helps developers
 * identify slow queries during development.
 * 
 * PERFORMANCE TIPS FOR DuckDB-WASM:
 * 1. Use pre-aggregated summary tables for common queries (we already do this)
 * 2. Avoid SELECT * — only select columns you need
 * 3. Use CAST(COUNT(*) AS INTEGER) to avoid BigInt overhead in JS
 * 4. Keep Parquet files < 50MB for fast initial load
 * 5. Use WHERE clauses to scan fewer rows
 */

interface QueryTimerProps {
  durationMs: number | null;
  label?: string;
}

export function QueryTimer({ durationMs, label }: QueryTimerProps) {
  if (durationMs === null) return null;

  // Color code: green < 20ms, yellow < 100ms, red > 100ms
  let color = '#16a34a'; // green
  if (durationMs > 100) color = '#dc2626'; // red
  else if (durationMs > 20) color = '#ca8a04'; // yellow

  return (
    <span className="query-timer" style={{ color }}>
      {label && <span className="query-timer-label">{label}: </span>}
      {durationMs.toFixed(1)}ms
    </span>
  );
}
