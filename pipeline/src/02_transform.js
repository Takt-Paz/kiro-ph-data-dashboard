/**
 * ============================================================================
 * STAGE 2: DATA CLEANING & SQL TRANSFORMATION
 * ============================================================================
 * 
 * PURPOSE:
 * Transform the raw ingested table into a clean, analytics-ready dataset.
 * This is the "T" in ETL (Extract, Transform, Load).
 * 
 * DATA ENGINEERING CONCEPTS:
 * 
 * 1. DATA CLEANING = fixing quality issues so data is consistent and reliable.
 *    - Remove duplicates (same project appearing twice)
 *    - Handle NULLs (decide: fill, drop, or flag)
 *    - Standardize text (trim whitespace, consistent casing)
 *    - Fix types (strings that should be numbers or dates)
 * 
 * 2. DATA TRANSFORMATION = reshaping data for analytical use.
 *    - Derive new columns (year from date, cost categories)
 *    - Aggregate metrics (total cost per region)
 *    - Normalize categories (merge similar values)
 *    - Create dimensions for filtering (time periods, size buckets)
 * 
 * 3. WHY CLEAN DATA MATTERS:
 *    Bad data → Wrong charts → Wrong decisions → Wasted money
 *    In government infrastructure, bad data could mean:
 *    - Overlooking flood-prone areas
 *    - Misallocating billions in budget
 *    - Duplicate spending on the same project
 * 
 * SQL CONCEPTS USED:
 * - CASE: Conditional logic (if/else in SQL)
 * - COALESCE: Return first non-NULL value
 * - CAST: Convert between data types
 * - TRIM/UPPER/INITCAP: Text standardization
 * - ROW_NUMBER(): Assign ranks for deduplication
 * - Window Functions: Calculate across groups of rows
 * ============================================================================
 */

const { createConnection, runQuery, runStatement, closeConnection } = require('./db');

async function transform() {
  console.log('='.repeat(70));
  console.log('STAGE 2: DATA CLEANING & TRANSFORMATION');
  console.log('='.repeat(70));
  console.log();

  const { db, conn } = await createConnection();

  // -------------------------------------------------------------------------
  // STEP 1: DUPLICATE DETECTION
  // -------------------------------------------------------------------------
  //
  // SQL CONCEPT: ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)
  //
  // ROW_NUMBER() assigns a sequential number to each row within a "partition".
  // A partition is a group of rows that share the same values.
  //
  // Example: If 3 rows have the same ProjectID:
  //   Row 1 → row_num = 1 (keep this one)
  //   Row 2 → row_num = 2 (duplicate!)
  //   Row 3 → row_num = 3 (duplicate!)
  //
  // We keep only row_num = 1, effectively deduplicating.
  // -------------------------------------------------------------------------
  console.log('[1/5] Detecting duplicates...');
  
  const dupeCheck = await runQuery(conn, `
    SELECT 
      CAST(COUNT(*) AS INTEGER) as total_rows,
      CAST(COUNT(DISTINCT ProjectComponentID) AS INTEGER) as unique_projects
    FROM raw_flood_control;
  `);
  
  const totalRows = dupeCheck[0].total_rows;
  const uniqueProjects = dupeCheck[0].unique_projects;
  const duplicates = totalRows - uniqueProjects;
  
  console.log(`  Total rows:       ${totalRows}`);
  console.log(`  Unique projects:  ${uniqueProjects}`);
  console.log(`  Duplicates:       ${duplicates}`);
  console.log();

  // -------------------------------------------------------------------------
  // STEP 2: CREATE CLEANED TABLE
  // -------------------------------------------------------------------------
  //
  // This single SQL query performs ALL cleaning and transformation in one pass.
  // 
  // WHY ONE BIG QUERY?
  // - DuckDB optimizes the entire query as a unit (query planning)
  // - Avoids creating intermediate temp tables (less I/O)
  // - Easier to reason about: one input → one output
  //
  // In production, this would typically be a dbt model or a SQL file
  // managed by a workflow orchestrator (Airflow, Dagster, etc.)
  // -------------------------------------------------------------------------
  console.log('[2/5] Creating cleaned & transformed table...');
  
  await runStatement(conn, `DROP TABLE IF EXISTS clean_flood_control;`);
  
  const transformSQL = `
    CREATE TABLE clean_flood_control AS
    WITH deduplicated AS (
      -- =====================================================================
      -- DEDUPLICATION using ROW_NUMBER()
      -- =====================================================================
      -- Assign a row number within each group of same ProjectComponentID.
      -- We keep only the first row (most recent edit date) per project.
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY ProjectComponentID 
          ORDER BY EditDate DESC NULLS LAST
        ) as row_num
      FROM raw_flood_control
    ),
    filtered AS (
      -- Keep only the first (most recent) row per project
      SELECT * FROM deduplicated WHERE row_num = 1
    )
    SELECT
      -- =================================================================
      -- IDENTIFIERS (kept as-is, just trimmed)
      -- =================================================================
      TRIM(ProjectID) as project_id,
      TRIM(ProjectComponentID) as project_component_id,
      TRIM(ContractID) as contract_id,
      TRIM(GlobalID) as global_id,

      -- =================================================================
      -- TEXT CLEANING: TRIM() + INITCAP()
      -- =================================================================
      -- TRIM() removes leading/trailing whitespace
      -- TRIM() removes leading/trailing whitespace
      -- Removes extra spaces from region/province/municipality names
      TRIM(Region) as region,
      TRIM(Province) as province,
      TRIM(Municipality) as municipality,
      TRIM(LegislativeDistrict) as legislative_district,

      -- =================================================================
      -- PROJECT DETAILS (standardized)
      -- =================================================================
      TRIM(ProjectDescription) as project_description,
      TRIM(ProjectComponentDescription) as project_component_description,
      TRIM(TypeofWork) as type_of_work,
      TRIM(infra_type) as infra_type,
      TRIM(Program) as program,

      -- =================================================================
      -- ADMINISTRATIVE
      -- =================================================================
      TRIM(ImplementingOffice) as implementing_office,
      TRIM(DistrictEngineeringOffice) as district_engineering_office,
      TRIM(Contractor) as contractor,

      -- =================================================================
      -- FINANCIAL DATA: CAST to proper numeric types
      -- =================================================================
      -- CAST() converts data from one type to another.
      -- COALESCE() returns the first non-NULL value.
      -- We use COALESCE(..., 0) to replace NULL costs with 0.
      CAST(COALESCE(ABC, 0) AS DOUBLE) as approved_budget,
      CAST(COALESCE(ContractCost, 0) AS DOUBLE) as contract_cost,

      -- =================================================================
      -- DERIVED FINANCIAL METRICS
      -- =================================================================
      -- Cost variance: how much the contract differs from approved budget
      -- Negative = under budget, Positive = over budget
      CAST(COALESCE(ContractCost, 0) - COALESCE(ABC, 0) AS DOUBLE) as cost_variance,
      
      -- Cost efficiency ratio: contract_cost / approved_budget
      -- Values < 1 mean under budget, > 1 means over budget
      CASE 
        WHEN ABC > 0 THEN ROUND(CAST(ContractCost AS DOUBLE) / CAST(ABC AS DOUBLE), 4)
        ELSE NULL
      END as cost_efficiency_ratio,

      -- =================================================================
      -- COST CATEGORY: CASE statement for bucketing
      -- =================================================================
      -- CASE works like if/else: check conditions top to bottom,
      -- return the value for the first TRUE condition.
      CASE
        WHEN ContractCost IS NULL OR ContractCost = 0 THEN 'Unknown'
        WHEN ContractCost < 1000000 THEN 'Small (<₱1M)'
        WHEN ContractCost < 10000000 THEN 'Medium (₱1M-₱10M)'
        WHEN ContractCost < 50000000 THEN 'Large (₱10M-₱50M)'
        WHEN ContractCost < 100000000 THEN 'Very Large (₱50M-₱100M)'
        ELSE 'Mega (₱100M+)'
      END as cost_category,

      -- =================================================================
      -- TIME DIMENSIONS
      -- =================================================================
      -- Breaking dates into components enables time-based filtering
      -- in dashboards (filter by year, compare months, etc.)
      CAST(InfraYear AS INTEGER) as infra_year,
      TRIM(FundingYear) as funding_year,
      CAST(CompletionYear AS INTEGER) as completion_year,

      -- Parse dates from strings into proper DATE type
      -- TRY_CAST returns NULL instead of error if parsing fails
      TRY_CAST(StartDate AS DATE) as start_date,
      TRY_CAST(CompletionDateActual AS DATE) as actual_completion_date,

      -- Duration in days (if both dates available)
      CASE
        WHEN TRY_CAST(CompletionDateActual AS DATE) IS NOT NULL 
             AND TRY_CAST(StartDate AS DATE) IS NOT NULL
        THEN DATEDIFF('day', TRY_CAST(StartDate AS DATE), TRY_CAST(CompletionDateActual AS DATE))
        ELSE NULL
      END as duration_days,

      -- =================================================================
      -- GEOGRAPHIC DATA
      -- =================================================================
      CAST(Longitude AS DOUBLE) as longitude,
      CAST(Latitude AS DOUBLE) as latitude,

      -- Geographic validation flag
      -- Philippines bounding box: lat 4.5-21.5, lon 116-127
      CASE
        WHEN Latitude BETWEEN 4.5 AND 21.5 
             AND Longitude BETWEEN 116.0 AND 127.0 THEN TRUE
        ELSE FALSE
      END as is_valid_coordinates,

      -- =================================================================
      -- DATA QUALITY FLAGS
      -- =================================================================
      -- These boolean flags help dashboards filter out incomplete records
      CASE WHEN ContractCost IS NOT NULL AND ContractCost > 0 THEN TRUE ELSE FALSE END as has_cost_data,
      CASE WHEN Contractor IS NOT NULL AND TRIM(Contractor) != '' THEN TRUE ELSE FALSE END as has_contractor,
      CASE WHEN TRY_CAST(StartDate AS DATE) IS NOT NULL THEN TRUE ELSE FALSE END as has_start_date,
      CASE WHEN TRY_CAST(CompletionDateActual AS DATE) IS NOT NULL THEN TRUE ELSE FALSE END as has_completion_date

    FROM filtered
    -- Filter out rows where essential fields are completely empty
    WHERE ProjectComponentID IS NOT NULL
      AND Region IS NOT NULL;
  `;

  await runStatement(conn, transformSQL);
  console.log('[✓] Table clean_flood_control created');
  console.log();

  // -------------------------------------------------------------------------
  // STEP 3: VERIFY TRANSFORMATION
  // -------------------------------------------------------------------------
  console.log('[3/5] Verifying transformation...');
  
  const cleanCount = await runQuery(conn, `SELECT CAST(COUNT(*) AS INTEGER) as rows FROM clean_flood_control;`);
  console.log(`  Rows after cleaning: ${cleanCount[0].rows}`);
  console.log(`  Rows removed:        ${totalRows - cleanCount[0].rows}`);
  console.log();

  // -------------------------------------------------------------------------
  // STEP 4: PROFILE CLEANED DATA
  // -------------------------------------------------------------------------
  console.log('[4/5] Profiling cleaned data...');
  console.log('-'.repeat(70));

  // Cost category distribution
  const costDist = await runQuery(conn, `
    SELECT cost_category, CAST(COUNT(*) AS INTEGER) as count,
           ROUND(SUM(contract_cost) / 1e9, 2) as total_cost_billions
    FROM clean_flood_control
    GROUP BY cost_category
    ORDER BY total_cost_billions DESC;
  `);

  console.log('COST CATEGORY DISTRIBUTION:');
  for (const row of costDist) {
    console.log(`  ${String(row.cost_category).padEnd(25)} ${String(row.count).padStart(6)} projects  ₱${row.total_cost_billions}B`);
  }
  console.log();

  // Year distribution
  const yearDist = await runQuery(conn, `
    SELECT infra_year, CAST(COUNT(*) AS INTEGER) as projects, 
           ROUND(SUM(contract_cost) / 1e9, 2) as total_cost_billions
    FROM clean_flood_control
    WHERE infra_year IS NOT NULL
    GROUP BY infra_year
    ORDER BY infra_year;
  `);

  console.log('PROJECTS BY INFRASTRUCTURE YEAR:');
  for (const row of yearDist) {
    const bar = '█'.repeat(Math.round(row.projects / 100));
    console.log(`  ${row.infra_year}  ${String(row.projects).padStart(5)} projects  ₱${String(row.total_cost_billions).padStart(7)}B  ${bar}`);
  }
  console.log();

  // Data quality summary
  const qualityCheck = await runQuery(conn, `
    SELECT
      CAST(COUNT(*) AS INTEGER) as total,
      CAST(SUM(CASE WHEN has_cost_data THEN 1 ELSE 0 END) AS INTEGER) as with_cost,
      CAST(SUM(CASE WHEN has_contractor THEN 1 ELSE 0 END) AS INTEGER) as with_contractor,
      CAST(SUM(CASE WHEN has_start_date THEN 1 ELSE 0 END) AS INTEGER) as with_start_date,
      CAST(SUM(CASE WHEN has_completion_date THEN 1 ELSE 0 END) AS INTEGER) as with_completion,
      CAST(SUM(CASE WHEN is_valid_coordinates THEN 1 ELSE 0 END) AS INTEGER) as valid_coords
    FROM clean_flood_control;
  `);

  const q = qualityCheck[0];
  console.log('DATA COMPLETENESS:');
  console.log('-'.repeat(70));
  console.log(`  Has cost data:       ${q.with_cost}/${q.total} (${((q.with_cost / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has contractor:      ${q.with_contractor}/${q.total} (${((q.with_contractor / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has start date:      ${q.with_start_date}/${q.total} (${((q.with_start_date / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has completion date: ${q.with_completion}/${q.total} (${((q.with_completion / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Valid coordinates:   ${q.valid_coords}/${q.total} (${((q.valid_coords / q.total) * 100).toFixed(1)}%)`);
  console.log();

  // -------------------------------------------------------------------------
  // STEP 5: CREATE SUMMARY/AGGREGATION TABLES
  // -------------------------------------------------------------------------
  //
  // DATA ENGINEERING INSIGHT:
  // Pre-aggregated tables dramatically speed up dashboard queries.
  // Instead of aggregating 10K rows every time someone views a chart,
  // we pre-compute the summary once during the pipeline.
  // -------------------------------------------------------------------------
  console.log('[5/5] Creating summary tables for dashboard...');

  // Regional summary
  await runStatement(conn, `DROP TABLE IF EXISTS summary_by_region;`);
  await runStatement(conn, `
    CREATE TABLE summary_by_region AS
    SELECT
      region,
      COUNT(*) as total_projects,
      COUNT(DISTINCT contractor) as unique_contractors,
      ROUND(SUM(contract_cost), 2) as total_contract_cost,
      ROUND(AVG(contract_cost), 2) as avg_contract_cost,
      ROUND(SUM(approved_budget), 2) as total_approved_budget,
      MIN(infra_year) as earliest_year,
      MAX(infra_year) as latest_year
    FROM clean_flood_control
    GROUP BY region
    ORDER BY total_contract_cost DESC;
  `);

  // Type of work summary
  await runStatement(conn, `DROP TABLE IF EXISTS summary_by_work_type;`);
  await runStatement(conn, `
    CREATE TABLE summary_by_work_type AS
    SELECT
      type_of_work,
      COUNT(*) as total_projects,
      ROUND(SUM(contract_cost), 2) as total_cost,
      ROUND(AVG(contract_cost), 2) as avg_cost,
      ROUND(AVG(cost_efficiency_ratio), 4) as avg_efficiency
    FROM clean_flood_control
    GROUP BY type_of_work
    ORDER BY total_projects DESC;
  `);

  // Yearly summary
  await runStatement(conn, `DROP TABLE IF EXISTS summary_by_year;`);
  await runStatement(conn, `
    CREATE TABLE summary_by_year AS
    SELECT
      infra_year,
      COUNT(*) as total_projects,
      COUNT(DISTINCT region) as regions_covered,
      COUNT(DISTINCT contractor) as unique_contractors,
      ROUND(SUM(contract_cost), 2) as total_cost,
      ROUND(AVG(contract_cost), 2) as avg_cost,
      ROUND(AVG(duration_days), 0) as avg_duration_days
    FROM clean_flood_control
    WHERE infra_year IS NOT NULL
    GROUP BY infra_year
    ORDER BY infra_year;
  `);

  // Top contractors
  await runStatement(conn, `DROP TABLE IF EXISTS summary_top_contractors;`);
  await runStatement(conn, `
    CREATE TABLE summary_top_contractors AS
    SELECT
      contractor,
      COUNT(*) as total_projects,
      COUNT(DISTINCT region) as regions_active,
      ROUND(SUM(contract_cost), 2) as total_contract_value,
      ROUND(AVG(contract_cost), 2) as avg_contract_value,
      MIN(infra_year) as first_year,
      MAX(infra_year) as last_year
    FROM clean_flood_control
    WHERE has_contractor = TRUE
    GROUP BY contractor
    ORDER BY total_projects DESC
    LIMIT 100;
  `);

  console.log('[✓] Summary tables created:');
  console.log('    - summary_by_region');
  console.log('    - summary_by_work_type');
  console.log('    - summary_by_year');
  console.log('    - summary_top_contractors');
  console.log();

  console.log('='.repeat(70));
  console.log('STAGE 2 COMPLETE: Data cleaned and transformed');
  console.log('='.repeat(70));

  await closeConnection(db);
}

/**
 * Shared-connection version for use in the full pipeline.
 */
async function transformWithConn(conn) {
  const { runQuery: rq, runStatement: rs } = require('./db');

  console.log('='.repeat(70));
  console.log('STAGE 2: DATA CLEANING & TRANSFORMATION');
  console.log('='.repeat(70));
  console.log();

  console.log('[1/5] Detecting duplicates...');
  const dupeCheck = await rq(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as total_rows,
           CAST(COUNT(DISTINCT ProjectComponentID) AS INTEGER) as unique_projects
    FROM raw_flood_control;
  `);
  const totalRows = dupeCheck[0].total_rows;
  const uniqueProjects = dupeCheck[0].unique_projects;
  console.log(`  Total rows:       ${totalRows}`);
  console.log(`  Unique projects:  ${uniqueProjects}`);
  console.log(`  Duplicates:       ${totalRows - uniqueProjects}`);
  console.log();

  console.log('[2/5] Creating cleaned & transformed table...');
  await rs(conn, `DROP TABLE IF EXISTS clean_flood_control;`);

  const transformSQL = `
    CREATE TABLE clean_flood_control AS
    WITH deduplicated AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY ProjectComponentID 
          ORDER BY EditDate DESC NULLS LAST
        ) as row_num
      FROM raw_flood_control
    ),
    filtered AS (
      SELECT * FROM deduplicated WHERE row_num = 1
    )
    SELECT
      TRIM(ProjectID) as project_id,
      TRIM(ProjectComponentID) as project_component_id,
      TRIM(ContractID) as contract_id,
      TRIM(GlobalID) as global_id,
      TRIM(Region) as region,
      TRIM(Province) as province,
      TRIM(Municipality) as municipality,
      TRIM(LegislativeDistrict) as legislative_district,
      TRIM(ProjectDescription) as project_description,
      TRIM(ProjectComponentDescription) as project_component_description,
      TRIM(TypeofWork) as type_of_work,
      TRIM(infra_type) as infra_type,
      TRIM(Program) as program,
      TRIM(ImplementingOffice) as implementing_office,
      TRIM(DistrictEngineeringOffice) as district_engineering_office,
      TRIM(Contractor) as contractor,
      CAST(COALESCE(ABC, 0) AS DOUBLE) as approved_budget,
      CAST(COALESCE(ContractCost, 0) AS DOUBLE) as contract_cost,
      CAST(COALESCE(ContractCost, 0) - COALESCE(ABC, 0) AS DOUBLE) as cost_variance,
      CASE 
        WHEN ABC > 0 THEN ROUND(CAST(ContractCost AS DOUBLE) / CAST(ABC AS DOUBLE), 4)
        ELSE NULL
      END as cost_efficiency_ratio,
      CASE
        WHEN ContractCost IS NULL OR ContractCost = 0 THEN 'Unknown'
        WHEN ContractCost < 1000000 THEN 'Small (<₱1M)'
        WHEN ContractCost < 10000000 THEN 'Medium (₱1M-₱10M)'
        WHEN ContractCost < 50000000 THEN 'Large (₱10M-₱50M)'
        WHEN ContractCost < 100000000 THEN 'Very Large (₱50M-₱100M)'
        ELSE 'Mega (₱100M+)'
      END as cost_category,
      CAST(InfraYear AS INTEGER) as infra_year,
      TRIM(FundingYear) as funding_year,
      CAST(CompletionYear AS INTEGER) as completion_year,
      TRY_CAST(StartDate AS DATE) as start_date,
      TRY_CAST(CompletionDateActual AS DATE) as actual_completion_date,
      CASE
        WHEN TRY_CAST(CompletionDateActual AS DATE) IS NOT NULL 
             AND TRY_CAST(StartDate AS DATE) IS NOT NULL
        THEN DATEDIFF('day', TRY_CAST(StartDate AS DATE), TRY_CAST(CompletionDateActual AS DATE))
        ELSE NULL
      END as duration_days,
      CAST(Longitude AS DOUBLE) as longitude,
      CAST(Latitude AS DOUBLE) as latitude,
      CASE
        WHEN Latitude BETWEEN 4.5 AND 21.5 
             AND Longitude BETWEEN 116.0 AND 127.0 THEN TRUE
        ELSE FALSE
      END as is_valid_coordinates,
      CASE WHEN ContractCost IS NOT NULL AND ContractCost > 0 THEN TRUE ELSE FALSE END as has_cost_data,
      CASE WHEN Contractor IS NOT NULL AND TRIM(Contractor) != '' THEN TRUE ELSE FALSE END as has_contractor,
      CASE WHEN TRY_CAST(StartDate AS DATE) IS NOT NULL THEN TRUE ELSE FALSE END as has_start_date,
      CASE WHEN TRY_CAST(CompletionDateActual AS DATE) IS NOT NULL THEN TRUE ELSE FALSE END as has_completion_date
    FROM filtered
    WHERE ProjectComponentID IS NOT NULL AND Region IS NOT NULL;
  `;
  await rs(conn, transformSQL);
  console.log('[✓] Table clean_flood_control created');
  console.log();

  console.log('[3/5] Verifying transformation...');
  const cleanCount = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as rows FROM clean_flood_control;`);
  console.log(`  Rows after cleaning: ${cleanCount[0].rows}`);
  console.log(`  Rows removed:        ${totalRows - cleanCount[0].rows}`);
  console.log();

  console.log('[4/5] Profiling cleaned data...');
  console.log('-'.repeat(70));

  const costDist = await rq(conn, `
    SELECT cost_category, CAST(COUNT(*) AS INTEGER) as count,
           ROUND(SUM(contract_cost) / 1e9, 2) as total_cost_billions
    FROM clean_flood_control GROUP BY cost_category ORDER BY total_cost_billions DESC;
  `);
  console.log('COST CATEGORY DISTRIBUTION:');
  for (const row of costDist) {
    console.log(`  ${String(row.cost_category).padEnd(25)} ${String(row.count).padStart(6)} projects  ₱${row.total_cost_billions}B`);
  }
  console.log();

  const yearDist = await rq(conn, `
    SELECT infra_year, CAST(COUNT(*) AS INTEGER) as projects,
           ROUND(SUM(contract_cost) / 1e9, 2) as total_cost_billions
    FROM clean_flood_control WHERE infra_year IS NOT NULL
    GROUP BY infra_year ORDER BY infra_year;
  `);
  console.log('PROJECTS BY INFRASTRUCTURE YEAR:');
  for (const row of yearDist) {
    const bar = '█'.repeat(Math.round(row.projects / 100));
    console.log(`  ${row.infra_year}  ${String(row.projects).padStart(5)} projects  ₱${String(row.total_cost_billions).padStart(7)}B  ${bar}`);
  }
  console.log();

  const qualityCheck = await rq(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as total,
      CAST(SUM(CASE WHEN has_cost_data THEN 1 ELSE 0 END) AS INTEGER) as with_cost,
      CAST(SUM(CASE WHEN has_contractor THEN 1 ELSE 0 END) AS INTEGER) as with_contractor,
      CAST(SUM(CASE WHEN has_start_date THEN 1 ELSE 0 END) AS INTEGER) as with_start_date,
      CAST(SUM(CASE WHEN has_completion_date THEN 1 ELSE 0 END) AS INTEGER) as with_completion,
      CAST(SUM(CASE WHEN is_valid_coordinates THEN 1 ELSE 0 END) AS INTEGER) as valid_coords
    FROM clean_flood_control;
  `);
  const q = qualityCheck[0];
  console.log('DATA COMPLETENESS:');
  console.log('-'.repeat(70));
  console.log(`  Has cost data:       ${q.with_cost}/${q.total} (${((q.with_cost / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has contractor:      ${q.with_contractor}/${q.total} (${((q.with_contractor / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has start date:      ${q.with_start_date}/${q.total} (${((q.with_start_date / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Has completion date: ${q.with_completion}/${q.total} (${((q.with_completion / q.total) * 100).toFixed(1)}%)`);
  console.log(`  Valid coordinates:   ${q.valid_coords}/${q.total} (${((q.valid_coords / q.total) * 100).toFixed(1)}%)`);
  console.log();

  console.log('[5/5] Creating summary tables for dashboard...');

  await rs(conn, `DROP TABLE IF EXISTS summary_by_region;`);
  await rs(conn, `
    CREATE TABLE summary_by_region AS
    SELECT region, CAST(COUNT(*) AS INTEGER) as total_projects,
      CAST(COUNT(DISTINCT contractor) AS INTEGER) as unique_contractors,
      ROUND(SUM(contract_cost), 2) as total_contract_cost,
      ROUND(AVG(contract_cost), 2) as avg_contract_cost,
      ROUND(SUM(approved_budget), 2) as total_approved_budget,
      MIN(infra_year) as earliest_year, MAX(infra_year) as latest_year
    FROM clean_flood_control GROUP BY region ORDER BY total_contract_cost DESC;
  `);

  await rs(conn, `DROP TABLE IF EXISTS summary_by_work_type;`);
  await rs(conn, `
    CREATE TABLE summary_by_work_type AS
    SELECT type_of_work, CAST(COUNT(*) AS INTEGER) as total_projects,
      ROUND(SUM(contract_cost), 2) as total_cost,
      ROUND(AVG(contract_cost), 2) as avg_cost,
      ROUND(AVG(cost_efficiency_ratio), 4) as avg_efficiency
    FROM clean_flood_control GROUP BY type_of_work ORDER BY total_projects DESC;
  `);

  await rs(conn, `DROP TABLE IF EXISTS summary_by_year;`);
  await rs(conn, `
    CREATE TABLE summary_by_year AS
    SELECT infra_year, CAST(COUNT(*) AS INTEGER) as total_projects,
      CAST(COUNT(DISTINCT region) AS INTEGER) as regions_covered,
      CAST(COUNT(DISTINCT contractor) AS INTEGER) as unique_contractors,
      ROUND(SUM(contract_cost), 2) as total_cost,
      ROUND(AVG(contract_cost), 2) as avg_cost,
      ROUND(AVG(duration_days), 0) as avg_duration_days
    FROM clean_flood_control WHERE infra_year IS NOT NULL
    GROUP BY infra_year ORDER BY infra_year;
  `);

  await rs(conn, `DROP TABLE IF EXISTS summary_top_contractors;`);
  await rs(conn, `
    CREATE TABLE summary_top_contractors AS
    SELECT contractor, CAST(COUNT(*) AS INTEGER) as total_projects,
      CAST(COUNT(DISTINCT region) AS INTEGER) as regions_active,
      ROUND(SUM(contract_cost), 2) as total_contract_value,
      ROUND(AVG(contract_cost), 2) as avg_contract_value,
      MIN(infra_year) as first_year, MAX(infra_year) as last_year
    FROM clean_flood_control WHERE has_contractor = TRUE
    GROUP BY contractor ORDER BY total_projects DESC LIMIT 100;
  `);

  console.log('[✓] Summary tables created');
  console.log();
  console.log('='.repeat(70));
  console.log('STAGE 2 COMPLETE: Data cleaned and transformed');
  console.log('='.repeat(70));
}

// Run if executed directly
if (require.main === module) {
  transform().catch((err) => {
    console.error('[ERROR] Transformation failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { transform, transformWithConn };
