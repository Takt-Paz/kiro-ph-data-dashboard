/**
 * ============================================================================
 * STAGE 1: DATA INGESTION PIPELINE
 * ============================================================================
 * 
 * PURPOSE:
 * Load raw GeoJSON data (Philippine Flood Control Projects) into DuckDB.
 * This is the first stage of our ETL (Extract, Transform, Load) pipeline.
 * 
 * DATA ENGINEERING CONCEPTS:
 * 
 * 1. INGESTION = getting data from external sources into your analytical system.
 *    Sources can be CSV, JSON, APIs, databases, etc.
 * 
 * 2. SCHEMA-ON-READ vs SCHEMA-ON-WRITE:
 *    - Schema-on-write: You define the table structure BEFORE loading data.
 *    - Schema-on-read: You load data first, and the schema is inferred.
 *    DuckDB's read_json_auto() uses schema-on-read — it detects types automatically.
 * 
 * 3. WHY DuckDB for ingestion?
 *    - Handles large files (GBs) without running out of memory.
 *    - Automatic type detection for CSV/JSON.
 *    - Columnar storage = fast analytical queries later.
 *    - No server setup required.
 * 
 * COMMON INGESTION PROBLEMS:
 * - Incorrect type detection (numbers stored as strings)
 * - Missing columns across different file versions
 * - Unexpected NULL values where data should exist
 * - Encoding issues (UTF-8 vs Latin-1)
 * - Inconsistent schemas between files
 * 
 * We handle all of these below with explicit type casting and validation.
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const { createConnection, runQuery, runStatement, closeConnection, OUTPUT_DIR, DATA_DIR } = require('./db');

async function ingest() {
  console.log('='.repeat(70));
  console.log('STAGE 1: DATA INGESTION');
  console.log('='.repeat(70));
  console.log();

  // -------------------------------------------------------------------------
  // STEP 1: Ensure output directory exists
  // -------------------------------------------------------------------------
  // Production pipelines always create output directories programmatically.
  // Never assume directories exist — another developer or CI system may not have them.
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`[✓] Created output directory: ${OUTPUT_DIR}`);
  }

  // -------------------------------------------------------------------------
  // STEP 2: Connect to DuckDB
  // -------------------------------------------------------------------------
  console.log('[1/6] Connecting to DuckDB...');
  const { db, conn } = await createConnection();
  console.log('[✓] Connected to DuckDB');
  console.log();

  // -------------------------------------------------------------------------
  // STEP 3: Install and load spatial extension (for GeoJSON support)
  // -------------------------------------------------------------------------
  // DuckDB extensions add capabilities like reading spatial data formats.
  // The spatial extension enables reading GeoJSON natively.
  console.log('[2/6] Loading DuckDB extensions...');
  await runStatement(conn, `INSTALL spatial;`);
  await runStatement(conn, `LOAD spatial;`);
  console.log('[✓] Spatial extension loaded');
  console.log();

  // -------------------------------------------------------------------------
  // STEP 4: Ingest raw GeoJSON into DuckDB
  // -------------------------------------------------------------------------
  // 
  // SQL CONCEPT: CREATE TABLE AS SELECT (CTAS)
  // Instead of defining a table schema manually, we let DuckDB infer it
  // from the data source. This is called "schema-on-read".
  //
  // read_json_auto() automatically:
  //   - Detects field names from JSON keys
  //   - Infers data types (string, number, date, etc.)
  //   - Handles nested structures
  //
  // For GeoJSON files, we use ST_Read() from the spatial extension which
  // understands the GeoJSON Feature/FeatureCollection structure.
  // -------------------------------------------------------------------------
  console.log('[3/6] Ingesting raw GeoJSON data...');
  
  const geojsonPath = path.join(DATA_DIR, 'flood_control_projects.geojson').replace(/\\/g, '/');
  
  // Drop table if it exists (idempotent pipeline — can re-run safely)
  await runStatement(conn, `DROP TABLE IF EXISTS raw_flood_control;`);
  
  // Use ST_Read to load the GeoJSON file
  // ST_Read understands GeoJSON FeatureCollections and extracts properties
  const ingestSQL = `
    CREATE TABLE raw_flood_control AS 
    SELECT * FROM ST_Read('${geojsonPath}');
  `;
  
  await runStatement(conn, ingestSQL);
  console.log('[✓] GeoJSON data ingested into table: raw_flood_control');
  console.log();

  // -------------------------------------------------------------------------
  // STEP 5: Schema Inspection
  // -------------------------------------------------------------------------
  // 
  // ALWAYS inspect your schema after ingestion. This catches:
  //   - Columns that were detected as wrong types
  //   - Missing columns you expected
  //   - Extra columns you didn't expect
  //
  // SQL CONCEPT: DESCRIBE
  // Shows column names, types, and nullability for a table.
  // -------------------------------------------------------------------------
  console.log('[4/6] Inspecting schema...');
  console.log('-'.repeat(70));
  
  const schema = await runQuery(conn, `DESCRIBE raw_flood_control;`);
  console.log('TABLE SCHEMA: raw_flood_control');
  console.log('-'.repeat(70));
  console.log(
    'Column'.padEnd(35) + 'Type'.padEnd(25) + 'Nullable'
  );
  console.log('-'.repeat(70));
  
  for (const col of schema) {
    console.log(
      String(col.column_name).padEnd(35) +
      String(col.column_type).padEnd(25) +
      String(col.null)
    );
  }
  console.log();

  // -------------------------------------------------------------------------
  // STEP 6: Initial Dataset Profiling
  // -------------------------------------------------------------------------
  //
  // DATA ENGINEERING INSIGHT:
  // Profiling is your first line of defense against bad data.
  // Before any transformation, you should know:
  //   - How many rows you have
  //   - What percentage of values are NULL
  //   - Value distributions for key columns
  //   - Min/max ranges for numeric fields
  //
  // SQL CONCEPT: COUNT, COUNT(*) vs COUNT(column)
  //   - COUNT(*) counts ALL rows, including NULLs
  //   - COUNT(column) counts only NON-NULL values in that column
  //   - The difference tells you how many NULLs exist
  // -------------------------------------------------------------------------
  console.log('[5/6] Profiling dataset...');
  console.log('-'.repeat(70));

  // Row count
  const rowCount = await runQuery(conn, `SELECT CAST(COUNT(*) AS INTEGER) as total_rows FROM raw_flood_control;`);
  console.log(`Total Rows: ${rowCount[0].total_rows}`);
  console.log();

  // NULL percentage for key columns
  // NOTE: We CAST counts to INTEGER to avoid JavaScript BigInt issues.
  // DuckDB sometimes returns BIGINT for COUNT which JS can't mix with Number.
  const nullProfile = await runQuery(conn, `
    SELECT
      CAST(COUNT(*) AS INTEGER) as total,
      CAST(COUNT(*) - COUNT(InfraYear) AS INTEGER) as null_infra_year,
      CAST(COUNT(*) - COUNT(Region) AS INTEGER) as null_region,
      CAST(COUNT(*) - COUNT(Province) AS INTEGER) as null_province,
      CAST(COUNT(*) - COUNT(Municipality) AS INTEGER) as null_municipality,
      CAST(COUNT(*) - COUNT(TypeofWork) AS INTEGER) as null_type_of_work,
      CAST(COUNT(*) - COUNT(ContractCost) AS INTEGER) as null_contract_cost,
      CAST(COUNT(*) - COUNT(Contractor) AS INTEGER) as null_contractor,
      CAST(COUNT(*) - COUNT(Longitude) AS INTEGER) as null_longitude,
      CAST(COUNT(*) - COUNT(Latitude) AS INTEGER) as null_latitude
    FROM raw_flood_control;
  `);

  console.log('NULL VALUE ANALYSIS:');
  console.log('-'.repeat(70));
  const np = nullProfile[0];
  const total = Number(np.total);
  console.log(`  InfraYear:     ${np.null_infra_year} nulls (${((Number(np.null_infra_year) / total) * 100).toFixed(1)}%)`);
  console.log(`  Region:        ${np.null_region} nulls (${((Number(np.null_region) / total) * 100).toFixed(1)}%)`);
  console.log(`  Province:      ${np.null_province} nulls (${((Number(np.null_province) / total) * 100).toFixed(1)}%)`);
  console.log(`  Municipality:  ${np.null_municipality} nulls (${((Number(np.null_municipality) / total) * 100).toFixed(1)}%)`);
  console.log(`  TypeofWork:    ${np.null_type_of_work} nulls (${((Number(np.null_type_of_work) / total) * 100).toFixed(1)}%)`);
  console.log(`  ContractCost:  ${np.null_contract_cost} nulls (${((Number(np.null_contract_cost) / total) * 100).toFixed(1)}%)`);
  console.log(`  Contractor:    ${np.null_contractor} nulls (${((Number(np.null_contractor) / total) * 100).toFixed(1)}%)`);
  console.log(`  Longitude:     ${np.null_longitude} nulls (${((Number(np.null_longitude) / total) * 100).toFixed(1)}%)`);
  console.log(`  Latitude:      ${np.null_latitude} nulls (${((Number(np.null_latitude) / total) * 100).toFixed(1)}%)`);
  console.log();

  // Value distribution for key categorical column
  const regionDist = await runQuery(conn, `
    SELECT Region, CAST(COUNT(*) AS INTEGER) as project_count
    FROM raw_flood_control
    WHERE Region IS NOT NULL
    GROUP BY Region
    ORDER BY project_count DESC
    LIMIT 10;
  `);

  console.log('TOP 10 REGIONS BY PROJECT COUNT:');
  console.log('-'.repeat(70));
  for (const row of regionDist) {
    const bar = '█'.repeat(Math.round((Number(row.project_count) / total) * 100));
    console.log(`  ${String(row.Region).padEnd(30)} ${String(row.project_count).padStart(6)} ${bar}`);
  }
  console.log();

  // Numeric range check
  const numericProfile = await runQuery(conn, `
    SELECT
      CAST(MIN(InfraYear) AS INTEGER) as min_year,
      CAST(MAX(InfraYear) AS INTEGER) as max_year,
      MIN(ContractCost) as min_cost,
      MAX(ContractCost) as max_cost,
      AVG(ContractCost) as avg_cost,
      MIN(ABC) as min_abc,
      MAX(ABC) as max_abc
    FROM raw_flood_control;
  `);

  console.log('NUMERIC FIELD RANGES:');
  console.log('-'.repeat(70));
  const numP = numericProfile[0];
  console.log(`  InfraYear:    ${numP.min_year} — ${numP.max_year}`);
  console.log(`  ContractCost: ₱${Number(numP.min_cost).toLocaleString()} — ₱${Number(numP.max_cost).toLocaleString()}`);
  console.log(`  Avg Cost:     ₱${Number(numP.avg_cost).toLocaleString()}`);
  console.log(`  ABC Range:    ₱${Number(numP.min_abc).toLocaleString()} — ₱${Number(numP.max_abc).toLocaleString()}`);
  console.log();

  // -------------------------------------------------------------------------
  // STEP 7: Summary
  // -------------------------------------------------------------------------
  console.log('[6/6] Ingestion complete!');
  console.log('='.repeat(70));
  console.log(`  Database: ${path.resolve(OUTPUT_DIR, 'pipeline.duckdb')}`);
  console.log(`  Table:    raw_flood_control`);
  console.log(`  Rows:     ${rowCount[0].total_rows}`);
  console.log(`  Columns:  ${schema.length}`);
  console.log('='.repeat(70));
  console.log();
  
  return { totalRows: rowCount[0].total_rows, columns: schema.length };
}

/**
 * Shared-connection version for use in the full pipeline.
 * Accepts an existing DuckDB connection (avoids file locking issues).
 */
async function ingestWithConn(conn) {
  // Reuse the core logic but with external connection
  const { runQuery: rq, runStatement: rs, OUTPUT_DIR: outDir, DATA_DIR: dataDir } = require('./db');

  console.log('='.repeat(70));
  console.log('STAGE 1: DATA INGESTION');
  console.log('='.repeat(70));
  console.log();

  console.log('[1/6] Connecting to DuckDB...');
  console.log('[✓] Connected to DuckDB (shared connection)');
  console.log();

  console.log('[2/6] Loading DuckDB extensions...');
  await rq(conn, `INSTALL spatial;`);
  await rq(conn, `LOAD spatial;`);
  console.log('[✓] Spatial extension loaded');
  console.log();

  console.log('[3/6] Ingesting raw GeoJSON data...');
  const geojsonPath = path.join(dataDir, 'flood_control_projects.geojson').replace(/\\/g, '/');
  await rs(conn, `DROP TABLE IF EXISTS raw_flood_control;`);
  await rs(conn, `CREATE TABLE raw_flood_control AS SELECT * FROM ST_Read('${geojsonPath}');`);
  console.log('[✓] GeoJSON data ingested into table: raw_flood_control');
  console.log();

  console.log('[4/6] Inspecting schema...');
  console.log('-'.repeat(70));
  const schema = await rq(conn, `DESCRIBE raw_flood_control;`);
  console.log('TABLE SCHEMA: raw_flood_control');
  console.log('-'.repeat(70));
  console.log('Column'.padEnd(35) + 'Type'.padEnd(25) + 'Nullable');
  console.log('-'.repeat(70));
  for (const col of schema) {
    console.log(
      String(col.column_name).padEnd(35) +
      String(col.column_type).padEnd(25) +
      String(col.null)
    );
  }
  console.log();

  console.log('[5/6] Profiling dataset...');
  console.log('-'.repeat(70));

  const rowCount = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as total_rows FROM raw_flood_control;`);
  console.log(`Total Rows: ${rowCount[0].total_rows}`);
  console.log();

  const nullProfile = await rq(conn, `
    SELECT
      CAST(COUNT(*) AS INTEGER) as total,
      CAST(COUNT(*) - COUNT(InfraYear) AS INTEGER) as null_infra_year,
      CAST(COUNT(*) - COUNT(Region) AS INTEGER) as null_region,
      CAST(COUNT(*) - COUNT(Province) AS INTEGER) as null_province,
      CAST(COUNT(*) - COUNT(Municipality) AS INTEGER) as null_municipality,
      CAST(COUNT(*) - COUNT(TypeofWork) AS INTEGER) as null_type_of_work,
      CAST(COUNT(*) - COUNT(ContractCost) AS INTEGER) as null_contract_cost,
      CAST(COUNT(*) - COUNT(Contractor) AS INTEGER) as null_contractor,
      CAST(COUNT(*) - COUNT(Longitude) AS INTEGER) as null_longitude,
      CAST(COUNT(*) - COUNT(Latitude) AS INTEGER) as null_latitude
    FROM raw_flood_control;
  `);

  console.log('NULL VALUE ANALYSIS:');
  console.log('-'.repeat(70));
  const np = nullProfile[0];
  const total = Number(np.total);
  console.log(`  InfraYear:     ${np.null_infra_year} nulls (${((Number(np.null_infra_year) / total) * 100).toFixed(1)}%)`);
  console.log(`  Region:        ${np.null_region} nulls (${((Number(np.null_region) / total) * 100).toFixed(1)}%)`);
  console.log(`  Province:      ${np.null_province} nulls (${((Number(np.null_province) / total) * 100).toFixed(1)}%)`);
  console.log(`  Municipality:  ${np.null_municipality} nulls (${((Number(np.null_municipality) / total) * 100).toFixed(1)}%)`);
  console.log(`  TypeofWork:    ${np.null_type_of_work} nulls (${((Number(np.null_type_of_work) / total) * 100).toFixed(1)}%)`);
  console.log(`  ContractCost:  ${np.null_contract_cost} nulls (${((Number(np.null_contract_cost) / total) * 100).toFixed(1)}%)`);
  console.log(`  Contractor:    ${np.null_contractor} nulls (${((Number(np.null_contractor) / total) * 100).toFixed(1)}%)`);
  console.log(`  Longitude:     ${np.null_longitude} nulls (${((Number(np.null_longitude) / total) * 100).toFixed(1)}%)`);
  console.log(`  Latitude:      ${np.null_latitude} nulls (${((Number(np.null_latitude) / total) * 100).toFixed(1)}%)`);
  console.log();

  const regionDist = await rq(conn, `
    SELECT Region, CAST(COUNT(*) AS INTEGER) as project_count
    FROM raw_flood_control WHERE Region IS NOT NULL
    GROUP BY Region ORDER BY project_count DESC LIMIT 10;
  `);
  console.log('TOP 10 REGIONS BY PROJECT COUNT:');
  console.log('-'.repeat(70));
  for (const row of regionDist) {
    const bar = '█'.repeat(Math.round((Number(row.project_count) / total) * 100));
    console.log(`  ${String(row.Region).padEnd(30)} ${String(row.project_count).padStart(6)} ${bar}`);
  }
  console.log();

  const numericProfile = await rq(conn, `
    SELECT CAST(MIN(InfraYear) AS INTEGER) as min_year, CAST(MAX(InfraYear) AS INTEGER) as max_year,
           MIN(ContractCost) as min_cost, MAX(ContractCost) as max_cost, AVG(ContractCost) as avg_cost,
           MIN(ABC) as min_abc, MAX(ABC) as max_abc
    FROM raw_flood_control;
  `);
  console.log('NUMERIC FIELD RANGES:');
  console.log('-'.repeat(70));
  const numP = numericProfile[0];
  console.log(`  InfraYear:    ${numP.min_year} — ${numP.max_year}`);
  console.log(`  ContractCost: ₱${Number(numP.min_cost).toLocaleString()} — ₱${Number(numP.max_cost).toLocaleString()}`);
  console.log(`  Avg Cost:     ₱${Number(numP.avg_cost).toLocaleString()}`);
  console.log(`  ABC Range:    ₱${Number(numP.min_abc).toLocaleString()} — ₱${Number(numP.max_abc).toLocaleString()}`);
  console.log();

  console.log('[6/6] Ingestion complete!');
  console.log('='.repeat(70));
  console.log(`  Table:    raw_flood_control`);
  console.log(`  Rows:     ${rowCount[0].total_rows}`);
  console.log(`  Columns:  ${schema.length}`);
  console.log('='.repeat(70));
  console.log();
}

// Run if executed directly
if (require.main === module) {
  ingest().catch((err) => {
    console.error('[ERROR] Ingestion failed:', err.message);
    process.exit(1);
  });
}

module.exports = { ingest, ingestWithConn };
