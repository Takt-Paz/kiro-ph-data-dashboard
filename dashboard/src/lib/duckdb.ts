/**
 * DuckDB-WASM Browser Initialization & Query Engine
 * ===================================================
 *
 * HOW IT WORKS:
 * 1. DuckDB-WASM downloads a WebAssembly binary (the database engine)
 * 2. A Web Worker runs the engine in a background thread (non-blocking UI)
 * 3. We register Parquet files from public/data/ as virtual tables
 * 4. The app runs SQL queries directly in the browser — no server needed
 *
 * DATA ENGINEERING INSIGHT:
 * Client-side analytics eliminates API latency entirely. Traditional dashboards:
 *   Browser → API Server → Database → API Server → Browser (200-2000ms)
 * DuckDB-WASM:
 *   Browser → DuckDB-WASM (1-50ms)
 */

import * as duckdb from '@duckdb/duckdb-wasm';

// Singleton instances
let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

// Performance tracking
interface QueryMetrics {
  sql: string;
  durationMs: number;
  rowCount: number;
  timestamp: number;
}

const queryHistory: QueryMetrics[] = [];

/**
 * Initialize DuckDB-WASM and load all Parquet datasets.
 * Idempotent — safe to call multiple times.
 */
export async function initDuckDB(): Promise<duckdb.AsyncDuckDBConnection> {
  if (conn) return conn;
  if (initPromise) return initPromise;
  initPromise = _init();
  return initPromise;
}

async function _init(): Promise<duckdb.AsyncDuckDBConnection> {
  const t0 = performance.now();

  // Use static files from public/ folder for maximum reliability.
  // These are served as-is by Vite without any bundler transformation.
  const DUCKDB_BUNDLES = await duckdb.selectBundle({
    mvp: {
      mainModule: '/duckdb-mvp.wasm',
      mainWorker: '/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: '/duckdb-eh.wasm',
      mainWorker: '/duckdb-browser-eh.worker.js',
    },
  });

  // Create a Web Worker for the database engine
  const worker = new Worker(DUCKDB_BUNDLES.mainWorker!);
  const logger = new duckdb.ConsoleLogger();

  // Instantiate database in Web Worker
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(DUCKDB_BUNDLES.mainModule, DUCKDB_BUNDLES.pthreadWorker);
  conn = await db.connect();

  // Register all Parquet files from public/data/
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

  // Create views for clean table names
  await conn.query(`CREATE OR REPLACE VIEW flood_control AS SELECT * FROM read_parquet('/data/flood_control_cleaned.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_region AS SELECT * FROM read_parquet('/data/summary_by_region.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_work_type AS SELECT * FROM read_parquet('/data/summary_by_work_type.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_year AS SELECT * FROM read_parquet('/data/summary_by_year.parquet');`);
  await conn.query(`CREATE OR REPLACE VIEW summary_contractors AS SELECT * FROM read_parquet('/data/summary_top_contractors.parquet');`);

  const elapsed = performance.now() - t0;
  console.log(`[DuckDB] Initialized in ${elapsed.toFixed(0)}ms`);

  return conn;
}

/**
 * Execute a SQL query with performance timing.
 * Returns results as an array of plain JS objects.
 */
export async function query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; durationMs: number }> {
  const connection = await initDuckDB();

  const t0 = performance.now();
  const result = await connection.query(sql);
  const durationMs = performance.now() - t0;

  // Convert Apache Arrow table to plain JS objects
  const rows: T[] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const field of result.schema.fields) {
      const column = result.getChild(field.name);
      const value = column?.get(i);
      // Convert BigInt to Number for JSON compatibility
      row[field.name] = typeof value === 'bigint' ? Number(value) : value;
    }
    rows.push(row as T);
  }

  // Track metrics
  const metrics: QueryMetrics = { sql: sql.trim().slice(0, 100), durationMs, rowCount: rows.length, timestamp: Date.now() };
  queryHistory.push(metrics);
  if (queryHistory.length > 50) queryHistory.shift();

  return { rows, durationMs };
}

/**
 * Simple query that just returns rows (convenience wrapper).
 */
export async function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { rows } = await query<T>(sql);
  return rows;
}

/**
 * Get query performance history.
 */
export function getQueryHistory(): QueryMetrics[] {
  return [...queryHistory];
}

export function getConnection(): duckdb.AsyncDuckDBConnection | null {
  return conn;
}

export function getDB(): duckdb.AsyncDuckDB | null {
  return db;
}
