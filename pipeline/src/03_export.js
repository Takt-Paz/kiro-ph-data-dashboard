/**
 * ============================================================================
 * STAGE 3: EXPORT CLEAN DATASET TO PARQUET
 * ============================================================================
 * 
 * PURPOSE:
 * Export the cleaned DuckDB tables into Parquet format files that can be
 * consumed by the frontend dashboard (via DuckDB-WASM) or other analytics tools.
 * 
 * DATA ENGINEERING CONCEPTS:
 * 
 * 1. WHY PARQUET OVER CSV?
 * 
 *    CSV (Row-based):                    Parquet (Column-based):
 *    ┌───────────────────────┐           ┌───────────────────────┐
 *    │ id, name, cost, year  │           │ Column: id            │
 *    │ 1, "Project A", 5M   │           │ [1, 2, 3, 4, 5...]    │
 *    │ 2, "Project B", 3M   │           │                       │
 *    │ 3, "Project C", 8M   │           │ Column: name          │
 *    │ ...                   │           │ ["A", "B", "C"...]    │
 *    └───────────────────────┘           │                       │
 *                                        │ Column: cost          │
 *    Read ALL columns always             │ [5M, 3M, 8M...]      │
 *    Slow for analytics                  └───────────────────────┘
 *    Large file size                     
 *    No type info                        Read ONLY needed columns
 *                                        10-100x faster for analytics
 *                                        50-90% smaller file size
 *                                        Embedded schema & types
 * 
 * 2. PARQUET ADVANTAGES:
 *    - Columnar storage: Dashboard showing only cost & region? Only those
 *      columns are read from disk. CSV must read entire rows.
 *    - Compression: Similar values in a column compress extremely well.
 *      SNAPPY codec gives ~70% compression with fast decompression.
 *    - Type preservation: INT, DOUBLE, DATE, BOOLEAN are stored natively.
 *      No more "is this string actually a number?" problems.
 *    - Predicate pushdown: "WHERE year = 2024" skips entire row groups
 *      without reading them. CSV must scan every row.
 *    - Compatible with: DuckDB-WASM, Apache Spark, Pandas, Polars, BigQuery,
 *      Snowflake, Athena, and virtually all modern analytics tools.
 * 
 * 3. COMPRESSION OPTIONS:
 *    - SNAPPY: Fast compression/decompression, good ratio. Best default.
 *    - ZSTD: Better compression ratio, slightly slower. Good for cold storage.
 *    - GZIP: Widely compatible but slower than SNAPPY.
 *    - NONE: No compression. Only use for debugging.
 * 
 * 4. FILE NAMING CONVENTIONS:
 *    Production pipelines use predictable naming:
 *    - flood_control_cleaned.parquet (main dataset)
 *    - summary_by_region.parquet (pre-aggregated)
 *    - Include timestamps for versioned exports: data_20240724.parquet
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const { createConnection, runQuery, runStatement, closeConnection, OUTPUT_DIR } = require('./db');

async function exportParquet() {
  console.log('='.repeat(70));
  console.log('STAGE 3: EXPORT TO PARQUET');
  console.log('='.repeat(70));
  console.log();

  const { db, conn } = await createConnection();

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // EXPORT 1: Main cleaned dataset
  // -------------------------------------------------------------------------
  //
  // SQL CONCEPT: COPY ... TO ... (FORMAT PARQUET)
  //
  // COPY exports query results directly to a file.
  // - No intermediate memory allocation for the full dataset
  // - Streams data row-by-row into the Parquet writer
  // - Handles compression on-the-fly
  //
  // CODEC 'SNAPPY':
  // - Snappy is optimized for speed over compression ratio
  // - Decompression is nearly instant (important for dashboards)
  // - Still achieves ~50-70% size reduction vs uncompressed
  // -------------------------------------------------------------------------
  console.log('[1/5] Exporting main dataset...');
  
  const mainParquet = path.join(OUTPUT_DIR, 'flood_control_cleaned.parquet').replace(/\\/g, '/');
  
  await runStatement(conn, `
    COPY (
      SELECT * FROM clean_flood_control
    ) TO '${mainParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');
  `);

  const mainSize = fs.statSync(mainParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] flood_control_cleaned.parquet (${(mainSize / 1024 / 1024).toFixed(2)} MB)`);

  // -------------------------------------------------------------------------
  // EXPORT 2: Regional summary (pre-aggregated for fast dashboard loading)
  // -------------------------------------------------------------------------
  console.log('[2/5] Exporting regional summary...');
  
  const regionParquet = path.join(OUTPUT_DIR, 'summary_by_region.parquet').replace(/\\/g, '/');
  
  await runStatement(conn, `
    COPY (
      SELECT * FROM summary_by_region
    ) TO '${regionParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');
  `);
  
  const regionSize = fs.statSync(regionParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_region.parquet (${(regionSize / 1024).toFixed(1)} KB)`);

  // -------------------------------------------------------------------------
  // EXPORT 3: Work type summary
  // -------------------------------------------------------------------------
  console.log('[3/5] Exporting work type summary...');
  
  const workTypeParquet = path.join(OUTPUT_DIR, 'summary_by_work_type.parquet').replace(/\\/g, '/');
  
  await runStatement(conn, `
    COPY (
      SELECT * FROM summary_by_work_type
    ) TO '${workTypeParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');
  `);

  const workSize = fs.statSync(workTypeParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_work_type.parquet (${(workSize / 1024).toFixed(1)} KB)`);

  // -------------------------------------------------------------------------
  // EXPORT 4: Yearly summary
  // -------------------------------------------------------------------------
  console.log('[4/5] Exporting yearly summary...');
  
  const yearParquet = path.join(OUTPUT_DIR, 'summary_by_year.parquet').replace(/\\/g, '/');
  
  await runStatement(conn, `
    COPY (
      SELECT * FROM summary_by_year
    ) TO '${yearParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');
  `);

  const yearSize = fs.statSync(yearParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_year.parquet (${(yearSize / 1024).toFixed(1)} KB)`);

  // -------------------------------------------------------------------------
  // EXPORT 5: Top contractors
  // -------------------------------------------------------------------------
  console.log('[5/5] Exporting top contractors...');
  
  const contractorParquet = path.join(OUTPUT_DIR, 'summary_top_contractors.parquet').replace(/\\/g, '/');
  
  await runStatement(conn, `
    COPY (
      SELECT * FROM summary_top_contractors
    ) TO '${contractorParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');
  `);

  const contractorSize = fs.statSync(contractorParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_top_contractors.parquet (${(contractorSize / 1024).toFixed(1)} KB)`);
  console.log();

  // -------------------------------------------------------------------------
  // SIZE COMPARISON: Parquet vs JSON
  // -------------------------------------------------------------------------
  const geojsonPath = path.join(OUTPUT_DIR, '..', 'flood_control_projects.geojson');
  let geojsonSize = 0;
  if (fs.existsSync(geojsonPath)) {
    geojsonSize = fs.statSync(geojsonPath).size;
  }

  const totalParquetSize = mainSize + regionSize + workSize + yearSize + contractorSize;

  console.log('='.repeat(70));
  console.log('FILE SIZE COMPARISON:');
  console.log('-'.repeat(70));
  if (geojsonSize > 0) {
    console.log(`  Original GeoJSON:     ${(geojsonSize / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log(`  All Parquet files:    ${(totalParquetSize / 1024 / 1024).toFixed(2)} MB`);
  if (geojsonSize > 0) {
    const ratio = ((1 - totalParquetSize / geojsonSize) * 100).toFixed(1);
    console.log(`  Compression ratio:    ${ratio}% smaller`);
  }
  console.log();
  console.log('  WHY THIS MATTERS:');
  console.log('  → Faster network transfers (smaller files)');
  console.log('  → Faster queries (columnar + compressed)');
  console.log('  → DuckDB-WASM in browser can read these directly');
  console.log('  → Type-safe: no more parsing strings as numbers');
  console.log('='.repeat(70));
  console.log();

  // -------------------------------------------------------------------------
  // EXPORT MANIFEST (metadata file for the dashboard to discover datasets)
  // -------------------------------------------------------------------------
  const manifest = {
    generated_at: new Date().toISOString(),
    pipeline_version: '1.0.0',
    source: 'bettergov.ph/flood-control-projects',
    files: [
      { name: 'flood_control_cleaned.parquet', rows: null, description: 'Full cleaned dataset' },
      { name: 'summary_by_region.parquet', description: 'Aggregated by region' },
      { name: 'summary_by_work_type.parquet', description: 'Aggregated by work type' },
      { name: 'summary_by_year.parquet', description: 'Aggregated by infrastructure year' },
      { name: 'summary_top_contractors.parquet', description: 'Top 100 contractors by project count' }
    ]
  };

  // Get row count for manifest
  const rowCount = await runQuery(conn, `SELECT CAST(COUNT(*) AS INTEGER) as rows FROM clean_flood_control;`);
  manifest.files[0].rows = rowCount[0].rows;

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[✓] Manifest written: ${manifestPath}`);
  console.log();

  console.log('STAGE 3 COMPLETE: All Parquet files exported');
  console.log('='.repeat(70));

  await closeConnection(db);
}

/**
 * Shared-connection version for use in the full pipeline.
 */
async function exportWithConn(conn) {
  const { runQuery: rq, runStatement: rs, OUTPUT_DIR: outDir, DATA_DIR: dataDir } = require('./db');

  console.log('='.repeat(70));
  console.log('STAGE 3: EXPORT TO PARQUET');
  console.log('='.repeat(70));
  console.log();

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('[1/5] Exporting main dataset...');
  const mainParquet = path.join(outDir, 'flood_control_cleaned.parquet').replace(/\\/g, '/');
  await rs(conn, `COPY (SELECT * FROM clean_flood_control) TO '${mainParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');`);
  const mainSize = fs.statSync(mainParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] flood_control_cleaned.parquet (${(mainSize / 1024 / 1024).toFixed(2)} MB)`);

  console.log('[2/5] Exporting regional summary...');
  const regionParquet = path.join(outDir, 'summary_by_region.parquet').replace(/\\/g, '/');
  await rs(conn, `COPY (SELECT * FROM summary_by_region) TO '${regionParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');`);
  const regionSize = fs.statSync(regionParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_region.parquet (${(regionSize / 1024).toFixed(1)} KB)`);

  console.log('[3/5] Exporting work type summary...');
  const workTypeParquet = path.join(outDir, 'summary_by_work_type.parquet').replace(/\\/g, '/');
  await rs(conn, `COPY (SELECT * FROM summary_by_work_type) TO '${workTypeParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');`);
  const workSize = fs.statSync(workTypeParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_work_type.parquet (${(workSize / 1024).toFixed(1)} KB)`);

  console.log('[4/5] Exporting yearly summary...');
  const yearParquet = path.join(outDir, 'summary_by_year.parquet').replace(/\\/g, '/');
  await rs(conn, `COPY (SELECT * FROM summary_by_year) TO '${yearParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');`);
  const yearSize = fs.statSync(yearParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_by_year.parquet (${(yearSize / 1024).toFixed(1)} KB)`);

  console.log('[5/5] Exporting top contractors...');
  const contractorParquet = path.join(outDir, 'summary_top_contractors.parquet').replace(/\\/g, '/');
  await rs(conn, `COPY (SELECT * FROM summary_top_contractors) TO '${contractorParquet}' (FORMAT PARQUET, CODEC 'SNAPPY');`);
  const contractorSize = fs.statSync(contractorParquet.replace(/\//g, path.sep)).size;
  console.log(`[✓] summary_top_contractors.parquet (${(contractorSize / 1024).toFixed(1)} KB)`);
  console.log();

  const geojsonPath = path.join(outDir, '..', 'flood_control_projects.geojson');
  let geojsonSize = 0;
  if (fs.existsSync(geojsonPath)) {
    geojsonSize = fs.statSync(geojsonPath).size;
  }
  const totalParquetSize = mainSize + regionSize + workSize + yearSize + contractorSize;

  console.log('='.repeat(70));
  console.log('FILE SIZE COMPARISON:');
  console.log('-'.repeat(70));
  if (geojsonSize > 0) {
    console.log(`  Original GeoJSON:     ${(geojsonSize / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log(`  All Parquet files:    ${(totalParquetSize / 1024 / 1024).toFixed(2)} MB`);
  if (geojsonSize > 0) {
    const ratio = ((1 - totalParquetSize / geojsonSize) * 100).toFixed(1);
    console.log(`  Compression ratio:    ${ratio}% smaller`);
  }
  console.log();
  console.log('  WHY THIS MATTERS:');
  console.log('  → Faster network transfers (smaller files)');
  console.log('  → Faster queries (columnar + compressed)');
  console.log('  → DuckDB-WASM in browser can read these directly');
  console.log('  → Type-safe: no more parsing strings as numbers');
  console.log('='.repeat(70));
  console.log();

  const manifest = {
    generated_at: new Date().toISOString(),
    pipeline_version: '1.0.0',
    source: 'bettergov.ph/flood-control-projects',
    files: [
      { name: 'flood_control_cleaned.parquet', rows: null, description: 'Full cleaned dataset' },
      { name: 'summary_by_region.parquet', description: 'Aggregated by region' },
      { name: 'summary_by_work_type.parquet', description: 'Aggregated by work type' },
      { name: 'summary_by_year.parquet', description: 'Aggregated by infrastructure year' },
      { name: 'summary_top_contractors.parquet', description: 'Top 100 contractors by project count' }
    ]
  };
  const rowCount = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as rows FROM clean_flood_control;`);
  manifest.files[0].rows = rowCount[0].rows;
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[✓] Manifest written: ${manifestPath}`);
  console.log();
  console.log('STAGE 3 COMPLETE: All Parquet files exported');
  console.log('='.repeat(70));
}

// Run if executed directly
if (require.main === module) {
  exportParquet().catch((err) => {
    console.error('[ERROR] Export failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { exportParquet, exportWithConn };
