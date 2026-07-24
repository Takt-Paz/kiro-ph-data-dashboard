/**
 * ============================================================================
 * FULL DATA ENGINEERING PIPELINE
 * ============================================================================
 * 
 * This orchestrator runs all 4 stages in sequence with a shared connection.
 * 
 *   Raw GeoJSON
 *        ↓
 *   [Stage 1] DuckDB Ingestion
 *        ↓
 *   [Stage 2] SQL Cleaning & Transformation
 *        ↓
 *   [Stage 3] Parquet Export
 *        ↓
 *   [Stage 4] Quality Verification
 *        ↓
 *   Dashboard-Ready Dataset ✓
 * 
 * USAGE:
 *   npm run pipeline        (runs all stages)
 *   npm run ingest          (stage 1 only)
 *   npm run transform       (stage 2 only)
 *   npm run export          (stage 3 only)
 *   npm run verify          (stage 4 only)
 * 
 * DATA ENGINEERING INSIGHT:
 * In production, each stage would be an independent task in a workflow
 * orchestrator (Airflow DAG, Dagster job, Prefect flow).
 * This allows:
 *   - Retrying individual failed stages
 *   - Running stages in parallel where possible
 *   - Monitoring per-stage execution time
 *   - Setting different resource allocations per stage
 * 
 * For this learning project, we share one DuckDB connection across all stages
 * to avoid file locking issues on Windows.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const duckdb = require('duckdb');
const { OUTPUT_DIR, DATA_DIR } = require('./db');

// Import stage functions that accept a connection
const { ingestWithConn } = require('./01_ingest');
const { transformWithConn } = require('./02_transform');
const { exportWithConn } = require('./03_export');
const { verifyWithConn } = require('./04_verify');

function runQuery(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function runStatement(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function runPipeline() {
  const startTime = Date.now();
  
  console.log();
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║          PH FLOOD CONTROL DATA ENGINEERING PIPELINE                 ║');
  console.log('║          Source: bettergov.ph/flood-control-projects                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Pipeline started at: ${new Date().toISOString()}`);
  console.log();

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Create a single shared database connection for all stages
  const DB_PATH = path.join(OUTPUT_DIR, 'pipeline.duckdb');
  const db = new duckdb.Database(DB_PATH);
  const conn = new duckdb.Connection(db);

  try {
    // Stage 1: Ingest raw data into DuckDB
    console.log('>>> Starting Stage 1: INGEST');
    console.log();
    await ingestWithConn(conn);
    console.log();

    // Stage 2: Clean and transform
    console.log('>>> Starting Stage 2: TRANSFORM');
    console.log();
    await transformWithConn(conn);
    console.log();

    // Stage 3: Export to Parquet
    console.log('>>> Starting Stage 3: EXPORT');
    console.log();
    await exportWithConn(conn);
    console.log();

    // Stage 4: Verify data quality
    console.log('>>> Starting Stage 4: VERIFY');
    console.log();
    const { passed, failed, total } = await verifyWithConn(conn);
    console.log();

    // Final summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log();
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                    PIPELINE EXECUTION SUMMARY                       ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log(`║  Duration:       ${elapsed}s`.padEnd(71) + '║');
    console.log(`║  Quality Score:  ${passed}/${total} checks passed`.padEnd(71) + '║');
    console.log(`║  Status:         ${failed === 0 ? '✓ SUCCESS' : '✗ FAILED'}`.padEnd(71) + '║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log('║  Output Files:                                                      ║');
    console.log('║    → output/flood_control_cleaned.parquet  (main dataset)           ║');
    console.log('║    → output/summary_by_region.parquet      (regional aggregates)    ║');
    console.log('║    → output/summary_by_work_type.parquet   (work type aggregates)   ║');
    console.log('║    → output/summary_by_year.parquet        (yearly aggregates)      ║');
    console.log('║    → output/summary_top_contractors.parquet (top contractors)       ║');
    console.log('║    → output/manifest.json                  (metadata)               ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    console.log();

    if (failed > 0) {
      process.exitCode = 1;
    }

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error();
    console.error('╔══════════════════════════════════════════════════════════════════════╗');
    console.error('║                    PIPELINE FAILED                                   ║');
    console.error('╚══════════════════════════════════════════════════════════════════════╝');
    console.error();
    console.error(`  Error: ${err.message}`);
    console.error(`  Duration: ${elapsed}s`);
    console.error();
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Always close the database
    db.close((err) => {
      if (err) console.error('Error closing DB:', err);
    });
  }
}

runPipeline();
