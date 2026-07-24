import { useCallback, useState } from 'react';
import { query } from '../lib/duckdb';

interface ExportButtonProps {
  sql: string;
  filename?: string;
}

export function ExportButton({ sql, filename = 'flood_control_export.csv' }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { rows } = await query<Record<string, unknown>>(sql);
      if (rows.length === 0) return;

      const headers = Object.keys(rows[0]);
      const csvRows = [
        headers.join(','),
        ...rows.map((row) =>
          headers.map((h) => {
            const val = row[h];
            if (val == null) return '';
            const str = String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          }).join(',')
        ),
      ];

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [sql, filename]);

  return (
    <button
      type="button"
      className="export-btn"
      onClick={handleExport}
      disabled={exporting}
    >
      {exporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}
