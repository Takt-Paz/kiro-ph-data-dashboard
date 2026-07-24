interface QueryTimerProps {
  durationMs: number | null;
  label?: string;
}

export function QueryTimer({ durationMs, label }: QueryTimerProps) {
  if (durationMs === null) return null;

  let color = '#16a34a';
  if (durationMs > 100) color = '#dc2626';
  else if (durationMs > 20) color = '#ca8a04';

  return (
    <span className="query-timer" style={{ color }}>
      {label && <span className="query-timer-label">{label}: </span>}
      {durationMs.toFixed(1)}ms
    </span>
  );
}
