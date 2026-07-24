import * as duckdb from '@duckdb/duckdb-wasm';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

interface QueryMetrics {
  sql: string;
  durationMs: number;
  rowCount: number;
  timestamp: number;
}

const queryHistory: QueryMetrics[] = [];

export async function initDuckDB(): Promise<duckdb.AsyncDuckDBConnection> {
  if (conn) return conn;
  if (initPromise) return initPromise;
  initPromise = _init();
  return initPromise;
}

async function _init(): Promise<duckdb.AsyncDuckDBConnection> {
  const t0 = performance.now();

  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: '/duckdb-mvp.wasm',
      mainWorker: '/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: '/duckdb-eh.wasm',
      mainWorker: '/duckdb-browser-eh.worker.js',
    },
  });

  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger();

  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();

  const parquetFiles = [
    { name: 'flood_control', url: '/data/flood_control_cleaned.parquet' },
    { name: 'summary_region', url: '/data/summary_by_region.parquet' },
    { name: 'summary_work_type', url: '/data/summary_by_work_type.parquet' },
    { name: 'summary_year', url: '/data/summary_by_year.parquet' },
    { name: 'summary_contractors', url: '/data/summary_top_contractors.parquet' },
  ];

  for (const file of parquetFiles) {
    const response = await fetch(file.url);
    const buffer = await response.arrayBuffer();
    await db.registerFileBuffer(file.url, new Uint8Array(buffer));
  }

  await conn.query(`CREATE OR REPLACE VIEW flood_control AS SELECT * FROM read_parquet('/data/flood_control_cleaned.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_region AS SELECT * FROM read_parquet('/data/summary_by_region.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_work_type AS SELECT * FROM read_parquet('/data/summary_by_work_type.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_year AS SELECT * FROM read_parquet('/data/summary_by_year.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_contractors AS SELECT * FROM read_parquet('/data/summary_top_contractors.parquet');`);

  console.log(`[DuckDB] Initialized in ${(performance.now() - t0).toFixed(0)}ms`);
  return conn;
}

export async function query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; durationMs: number }> {
  const connection = await initDuckDB();

  const t0 = performance.now();
  const result = await connection.query(sql);
  const durationMs = performance.now() - t0;

  const rows: T[] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const field of result.schema.fields) {
      const column = result.getChild(field.name);
      const value = column?.get(i);
      row[field.name] = typeof value === 'bigint' ? Number(value) : value;
    }
    rows.push(row as T);
  }

  const metrics: QueryMetrics = { sql: sql.trim().slice(0, 100), durationMs, rowCount: rows.length, timestamp: Date.now() };
  queryHistory.push(metrics);
  if (queryHistory.length > 50) queryHistory.shift();

  return { rows, durationMs };
}

export function getQueryHistory(): QueryMetrics[] {
  return [...queryHistory];
}

export function getConnection(): duckdb.AsyncDuckDBConnection | null {
  return conn;
}

export function getDB(): duckdb.AsyncDuckDB | null {
  return db;
}
