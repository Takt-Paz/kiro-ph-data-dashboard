/**
 * ============================================================================
 * STAGE 4: DATA VERIFICATION & QUALITY ASSURANCE
 * ============================================================================
 * 
 * PURPOSE:
 * Validate the exported Parquet data before it reaches the dashboard.
 * This is the quality gate — if checks fail, the pipeline should NOT deploy.
 * 
 * DATA ENGINEERING CONCEPTS:
 * 
 * 1. WHY VERIFICATION MATTERS:
 *    Without automated checks, bad data silently reaches production:
 *    - A transformation bug drops 90% of rows → dashboard shows wrong totals
 *    - A type cast fails → costs show as NULL → budget chart is empty
 *    - Duplicates slip through → inflated project counts → misleading reports
 * 
 * 2. TYPES OF DATA QUALITY CHECKS:
 * 
 *    a) COMPLETENESS: Are all expected rows and columns present?
 *       - Row count within expected range
 *       - Critical columns have zero NULLs
 * 
 *    b) ACCURACY: Are values reasonable and correct?
 *       - Costs are positive numbers
 *       - Years are within valid range
 *       - Coordinates are within Philippines bounds
 * 
 *    c) CONSISTENCY: Does data follow expected patterns?
 *       - No duplicate project IDs
 *       - Known categories only (no typos)
 *       - Relationships between fields make sense
 * 
 *    d) TIMELINESS: Is the data fresh enough?
 *       - Contains expected recent records
 *       - Processing timestamp is current
 * 
 * 3. ASSERTION PATTERN:
 *    Each check either PASSES or FAILS with a clear message.
 *    In production, failed checks would:
 *    - Block deployment
 *    - Send alerts (Slack, PagerDuty, email)
 *    - Log to a data quality monitoring system (Monte Carlo, Great Expectations)
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const { createConnection, runQuery, runStatement, closeConnection, OUTPUT_DIR } = require('./db');

// Track test results
const results = [];

/**
 * Helper: Run a quality check and record the result.
 * 
 * @param {string} name - Description of the check
 * @param {boolean} passed - Whether the check passed
 * @param {string} detail - Additional context
 */
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const icon = passed ? '✓' : '✗';
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${status}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function verify() {
  console.log('='.repeat(70));
  console.log('STAGE 4: DATA VERIFICATION & QUALITY ASSURANCE');
  console.log('='.repeat(70));
  console.log();

  const { db, conn } = await createConnection();

  // =========================================================================
  // CHECK GROUP 1: COMPLETENESS
  // =========================================================================
  console.log('─── COMPLETENESS CHECKS ───');
  console.log();

  // Check 1.1: Row count is within expected range
  // The source has ~9,855 projects. After deduplication and filtering,
  // we expect at least 9,000 rows (allowing for some removals).
  const rowCount = await runQuery(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control;`);
  const rows = Number(rowCount[0].n);
  check(
    'Row count within expected range (9000-10000)',
    rows >= 9000 && rows <= 10000,
    `Actual: ${rows}`
  );

  // Check 1.2: Critical columns have zero NULLs
  // These columns MUST be present for every record — they're used in
  // dashboard filters and aggregations.
  const nullChecks = await runQuery(conn, `
    SELECT
      CAST(SUM(CASE WHEN project_component_id IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_id,
      CAST(SUM(CASE WHEN region IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_region,
      CAST(SUM(CASE WHEN infra_year IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_year
    FROM clean_flood_control;
  `);

  const nc = nullChecks[0];
  check('project_component_id has zero NULLs', Number(nc.null_id) === 0, `NULLs: ${nc.null_id}`);
  check('region has zero NULLs', Number(nc.null_region) === 0, `NULLs: ${nc.null_region}`);
  check('infra_year has zero NULLs', Number(nc.null_year) === 0, `NULLs: ${nc.null_year}`);

  // Check 1.3: All expected columns exist
  const schema = await runQuery(conn, `DESCRIBE clean_flood_control;`);
  const columnNames = schema.map(c => c.column_name);
  const requiredColumns = [
    'project_id', 'region', 'province', 'contract_cost',
    'approved_budget', 'infra_year', 'type_of_work', 'longitude', 'latitude'
  ];

  for (const col of requiredColumns) {
    check(`Column '${col}' exists`, columnNames.includes(col));
  }

  console.log();

  // =========================================================================
  // CHECK GROUP 2: ACCURACY
  // =========================================================================
  console.log('─── ACCURACY CHECKS ───');
  console.log();

  // Check 2.1: No negative costs
  // Contract costs should never be negative — that would indicate a data error.
  const negativeCosts = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control 
    WHERE contract_cost < 0 OR approved_budget < 0;
  `);
  check('No negative cost values', Number(negativeCosts[0].n) === 0, `Found: ${negativeCosts[0].n}`);

  // Check 2.2: Infrastructure year within valid range
  // The program started around 2018, so years should be 2018-2026.
  const yearRange = await runQuery(conn, `
    SELECT CAST(MIN(infra_year) AS INTEGER) as min_y, CAST(MAX(infra_year) AS INTEGER) as max_y 
    FROM clean_flood_control 
    WHERE infra_year IS NOT NULL;
  `);
  const yr = yearRange[0];
  check(
    'InfraYear within 2015-2026 range',
    yr.min_y >= 2015 && yr.max_y <= 2026,
    `Range: ${yr.min_y}-${yr.max_y}`
  );

  // Check 2.3: Coordinates within Philippines bounds
  // Philippines bounding box: lat 4.5-21.5, lon 116-127
  const outOfBounds = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control
    WHERE is_valid_coordinates = FALSE
      AND longitude IS NOT NULL 
      AND latitude IS NOT NULL;
  `);
  const totalWithCoords = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control
    WHERE longitude IS NOT NULL AND latitude IS NOT NULL;
  `);
  const oobPct = Number(totalWithCoords[0].n) > 0
    ? ((Number(outOfBounds[0].n) / Number(totalWithCoords[0].n)) * 100).toFixed(2)
    : 0;
  check(
    'Less than 5% coordinates out of PH bounds',
    parseFloat(oobPct) < 5,
    `Out of bounds: ${outOfBounds[0].n} (${oobPct}%)`
  );

  // Check 2.4: Cost efficiency ratio is reasonable
  // Most projects should be within 0.5x - 1.5x of approved budget
  const extremeEfficiency = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control
    WHERE cost_efficiency_ratio IS NOT NULL
      AND (cost_efficiency_ratio > 2.0 OR cost_efficiency_ratio < 0.1);
  `);
  const totalWithRatio = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control
    WHERE cost_efficiency_ratio IS NOT NULL;
  `);
  const extremePct = Number(totalWithRatio[0].n) > 0
    ? ((Number(extremeEfficiency[0].n) / Number(totalWithRatio[0].n)) * 100).toFixed(2)
    : 0;
  check(
    'Less than 10% have extreme cost efficiency (<0.1 or >2.0)',
    parseFloat(extremePct) < 10,
    `Extreme: ${extremeEfficiency[0].n} (${extremePct}%)`
  );

  console.log();

  // =========================================================================
  // CHECK GROUP 3: CONSISTENCY
  // =========================================================================
  console.log('─── CONSISTENCY CHECKS ───');
  console.log();

  // Check 3.1: No duplicate project_component_ids
  // After our deduplication step, each ID should appear exactly once.
  const duplicateIds = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM (
      SELECT project_component_id, COUNT(*) as cnt
      FROM clean_flood_control
      GROUP BY project_component_id
      HAVING cnt > 1
    );
  `);
  check('No duplicate project_component_ids', Number(duplicateIds[0].n) === 0, `Duplicates: ${duplicateIds[0].n}`);

  // Check 3.2: Known regions only (no garbage data)
  // The Philippines has 17 regions. We expect all values to be real regions.
  const regionCount = await runQuery(conn, `
    SELECT CAST(COUNT(DISTINCT region) AS INTEGER) as n FROM clean_flood_control;
  `);
  check(
    'Number of distinct regions is reasonable (5-20)',
    Number(regionCount[0].n) >= 5 && Number(regionCount[0].n) <= 20,
    `Found: ${regionCount[0].n} distinct regions`
  );

  // Check 3.3: contract_cost <= approved_budget (mostly)
  // In normal procurement, contract cost shouldn't exceed approved budget.
  // Some variation is acceptable (change orders), but >50% over budget is suspicious.
  const overBudget = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control
    WHERE contract_cost > approved_budget * 1.5
      AND approved_budget > 0;
  `);
  const totalWithBudget = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE approved_budget > 0;
  `);
  const overBudgetPct = Number(totalWithBudget[0].n) > 0
    ? ((Number(overBudget[0].n) / Number(totalWithBudget[0].n)) * 100).toFixed(2)
    : 0;
  check(
    'Less than 5% projects are >50% over budget',
    parseFloat(overBudgetPct) < 5,
    `Over budget: ${overBudget[0].n} (${overBudgetPct}%)`
  );

  console.log();

  // =========================================================================
  // CHECK GROUP 4: FILE INTEGRITY
  // =========================================================================
  console.log('─── FILE INTEGRITY CHECKS ───');
  console.log();

  // Check 4.1: All expected Parquet files exist
  const expectedFiles = [
    'flood_control_cleaned.parquet',
    'summary_by_region.parquet',
    'summary_by_work_type.parquet',
    'summary_by_year.parquet',
    'summary_top_contractors.parquet',
    'manifest.json'
  ];

  for (const file of expectedFiles) {
    const filePath = path.join(OUTPUT_DIR, file);
    const exists = fs.existsSync(filePath);
    check(`File exists: ${file}`, exists);
  }

  // Check 4.2: Parquet files are non-empty (> 1KB)
  const mainParquet = path.join(OUTPUT_DIR, 'flood_control_cleaned.parquet');
  if (fs.existsSync(mainParquet)) {
    const size = fs.statSync(mainParquet).size;
    check('Main parquet file > 1MB', size > 1024 * 1024, `Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  }

  // Check 4.3: Can read back the Parquet file (round-trip validation)
  // This confirms the file isn't corrupted.
  const parquetPath = mainParquet.replace(/\\/g, '/');
  try {
    const parquetRows = await runQuery(conn, `
      SELECT CAST(COUNT(*) AS INTEGER) as n FROM read_parquet('${parquetPath}');
    `);
    check(
      'Parquet file is readable (not corrupted)',
      Number(parquetRows[0].n) === rows,
      `Parquet rows: ${parquetRows[0].n}, Table rows: ${rows}`
    );
  } catch (err) {
    check('Parquet file is readable', false, err.message);
  }

  console.log();

  // =========================================================================
  // CHECK GROUP 5: CROSS-TABLE CONSISTENCY
  // =========================================================================
  console.log('─── CROSS-TABLE CONSISTENCY ───');
  console.log();

  // Check 5.1: Summary table totals match main table
  const summaryRegionTotal = await runQuery(conn, `
    SELECT CAST(SUM(total_projects) AS INTEGER) as n FROM summary_by_region;
  `);
  check(
    'Regional summary total matches main table',
    Number(summaryRegionTotal[0].n) === rows,
    `Summary: ${summaryRegionTotal[0].n}, Main: ${rows}`
  );

  // Check 5.2: Year summary covers all years in main table
  const mainYears = await runQuery(conn, `
    SELECT CAST(COUNT(DISTINCT infra_year) AS INTEGER) as n FROM clean_flood_control WHERE infra_year IS NOT NULL;
  `);
  const summaryYears = await runQuery(conn, `
    SELECT CAST(COUNT(*) AS INTEGER) as n FROM summary_by_year;
  `);
  check(
    'Year summary covers all infrastructure years',
    Number(summaryYears[0].n) === Number(mainYears[0].n),
    `Summary years: ${summaryYears[0].n}, Main years: ${mainYears[0].n}`
  );

  console.log();

  // =========================================================================
  // FINAL REPORT
  // =========================================================================
  console.log('='.repeat(70));
  console.log('QUALITY ASSURANCE REPORT');
  console.log('='.repeat(70));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log();
  console.log(`  Total checks: ${total}`);
  console.log(`  Passed:       ${passed} ✓`);
  console.log(`  Failed:       ${failed} ✗`);
  console.log(`  Score:        ${((passed / total) * 100).toFixed(1)}%`);
  console.log();

  if (failed > 0) {
    console.log('  FAILED CHECKS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    }
    console.log();
    console.log('  ⚠️  DATA QUALITY ISSUES DETECTED');
    console.log('  In production, this would BLOCK deployment to the dashboard.');
    console.log('  Review the failed checks above and fix the pipeline.');
  } else {
    console.log('  ✓ ALL CHECKS PASSED');
    console.log('  Data is verified and ready for dashboard consumption.');
  }

  console.log();
  console.log('='.repeat(70));

  await closeConnection(db);

  // Exit with error code if checks failed (useful for CI/CD)
  if (failed > 0) {
    process.exitCode = 1;
  }

  return { passed, failed, total };
}

/**
 * Shared-connection version for use in the full pipeline.
 */
async function verifyWithConn(conn) {
  const { runQuery: rq, OUTPUT_DIR: outDir } = require('./db');

  // Reset results for this run
  results.length = 0;

  console.log('='.repeat(70));
  console.log('STAGE 4: DATA VERIFICATION & QUALITY ASSURANCE');
  console.log('='.repeat(70));
  console.log();

  // COMPLETENESS
  console.log('─── COMPLETENESS CHECKS ───');
  console.log();

  const rowCount = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control;`);
  const rows = Number(rowCount[0].n);
  check('Row count within expected range (9000-10000)', rows >= 9000 && rows <= 10000, `Actual: ${rows}`);

  const nullChecks = await rq(conn, `
    SELECT CAST(SUM(CASE WHEN project_component_id IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_id,
      CAST(SUM(CASE WHEN region IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_region,
      CAST(SUM(CASE WHEN infra_year IS NULL THEN 1 ELSE 0 END) AS INTEGER) as null_year
    FROM clean_flood_control;
  `);
  const nc = nullChecks[0];
  check('project_component_id has zero NULLs', Number(nc.null_id) === 0, `NULLs: ${nc.null_id}`);
  check('region has zero NULLs', Number(nc.null_region) === 0, `NULLs: ${nc.null_region}`);
  check('infra_year has zero NULLs', Number(nc.null_year) === 0, `NULLs: ${nc.null_year}`);

  const schema = await rq(conn, `DESCRIBE clean_flood_control;`);
  const columnNames = schema.map(c => c.column_name);
  const requiredColumns = [
    'project_id', 'region', 'province', 'contract_cost',
    'approved_budget', 'infra_year', 'type_of_work', 'longitude', 'latitude'
  ];
  for (const col of requiredColumns) {
    check(`Column '${col}' exists`, columnNames.includes(col));
  }
  console.log();

  // ACCURACY
  console.log('─── ACCURACY CHECKS ───');
  console.log();

  const negativeCosts = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE contract_cost < 0 OR approved_budget < 0;`);
  check('No negative cost values', Number(negativeCosts[0].n) === 0, `Found: ${negativeCosts[0].n}`);

  const yearRange = await rq(conn, `SELECT CAST(MIN(infra_year) AS INTEGER) as min_y, CAST(MAX(infra_year) AS INTEGER) as max_y FROM clean_flood_control WHERE infra_year IS NOT NULL;`);
  const yr = yearRange[0];
  check('InfraYear within 2015-2026 range', yr.min_y >= 2015 && yr.max_y <= 2026, `Range: ${yr.min_y}-${yr.max_y}`);

  const outOfBounds = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE is_valid_coordinates = FALSE AND longitude IS NOT NULL AND latitude IS NOT NULL;`);
  const totalWithCoords = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE longitude IS NOT NULL AND latitude IS NOT NULL;`);
  const oobPct = Number(totalWithCoords[0].n) > 0 ? ((Number(outOfBounds[0].n) / Number(totalWithCoords[0].n)) * 100).toFixed(2) : 0;
  check('Less than 5% coordinates out of PH bounds', parseFloat(oobPct) < 5, `Out of bounds: ${outOfBounds[0].n} (${oobPct}%)`);

  const extremeEfficiency = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE cost_efficiency_ratio IS NOT NULL AND (cost_efficiency_ratio > 2.0 OR cost_efficiency_ratio < 0.1);`);
  const totalWithRatio = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE cost_efficiency_ratio IS NOT NULL;`);
  const extremePct = Number(totalWithRatio[0].n) > 0 ? ((Number(extremeEfficiency[0].n) / Number(totalWithRatio[0].n)) * 100).toFixed(2) : 0;
  check('Less than 10% have extreme cost efficiency (<0.1 or >2.0)', parseFloat(extremePct) < 10, `Extreme: ${extremeEfficiency[0].n} (${extremePct}%)`);
  console.log();

  // CONSISTENCY
  console.log('─── CONSISTENCY CHECKS ───');
  console.log();

  const duplicateIds = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM (SELECT project_component_id, COUNT(*) as cnt FROM clean_flood_control GROUP BY project_component_id HAVING cnt > 1);`);
  check('No duplicate project_component_ids', Number(duplicateIds[0].n) === 0, `Duplicates: ${duplicateIds[0].n}`);

  const regionCount = await rq(conn, `SELECT CAST(COUNT(DISTINCT region) AS INTEGER) as n FROM clean_flood_control;`);
  check('Number of distinct regions is reasonable (5-20)', Number(regionCount[0].n) >= 5 && Number(regionCount[0].n) <= 20, `Found: ${regionCount[0].n} distinct regions`);

  const overBudget = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE contract_cost > approved_budget * 1.5 AND approved_budget > 0;`);
  const totalWithBudget = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM clean_flood_control WHERE approved_budget > 0;`);
  const overBudgetPct = Number(totalWithBudget[0].n) > 0 ? ((Number(overBudget[0].n) / Number(totalWithBudget[0].n)) * 100).toFixed(2) : 0;
  check('Less than 5% projects are >50% over budget', parseFloat(overBudgetPct) < 5, `Over budget: ${overBudget[0].n} (${overBudgetPct}%)`);
  console.log();

  // FILE INTEGRITY
  console.log('─── FILE INTEGRITY CHECKS ───');
  console.log();

  const expectedFiles = [
    'flood_control_cleaned.parquet', 'summary_by_region.parquet',
    'summary_by_work_type.parquet', 'summary_by_year.parquet',
    'summary_top_contractors.parquet', 'manifest.json'
  ];
  for (const file of expectedFiles) {
    check(`File exists: ${file}`, fs.existsSync(path.join(outDir, file)));
  }

  const mainParquet = path.join(outDir, 'flood_control_cleaned.parquet');
  if (fs.existsSync(mainParquet)) {
    const size = fs.statSync(mainParquet).size;
    check('Main parquet file > 1MB', size > 1024 * 1024, `Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  }

  const parquetPath = mainParquet.replace(/\\/g, '/');
  try {
    const parquetRows = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM read_parquet('${parquetPath}');`);
    check('Parquet file is readable (not corrupted)', Number(parquetRows[0].n) === rows, `Parquet rows: ${parquetRows[0].n}, Table rows: ${rows}`);
  } catch (err) {
    check('Parquet file is readable', false, err.message);
  }
  console.log();

  // CROSS-TABLE
  console.log('─── CROSS-TABLE CONSISTENCY ───');
  console.log();

  const summaryRegionTotal = await rq(conn, `SELECT CAST(SUM(total_projects) AS INTEGER) as n FROM summary_by_region;`);
  check('Regional summary total matches main table', Number(summaryRegionTotal[0].n) === rows, `Summary: ${summaryRegionTotal[0].n}, Main: ${rows}`);

  const mainYears = await rq(conn, `SELECT CAST(COUNT(DISTINCT infra_year) AS INTEGER) as n FROM clean_flood_control WHERE infra_year IS NOT NULL;`);
  const summaryYears = await rq(conn, `SELECT CAST(COUNT(*) AS INTEGER) as n FROM summary_by_year;`);
  check('Year summary covers all infrastructure years', Number(summaryYears[0].n) === Number(mainYears[0].n), `Summary years: ${summaryYears[0].n}, Main years: ${mainYears[0].n}`);
  console.log();

  // FINAL REPORT
  console.log('='.repeat(70));
  console.log('QUALITY ASSURANCE REPORT');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log();
  console.log(`  Total checks: ${total}`);
  console.log(`  Passed:       ${passed} ✓`);
  console.log(`  Failed:       ${failed} ✗`);
  console.log(`  Score:        ${((passed / total) * 100).toFixed(1)}%`);
  console.log();

  if (failed > 0) {
    console.log('  FAILED CHECKS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    }
    console.log();
    console.log('  ⚠️  DATA QUALITY ISSUES DETECTED');
  } else {
    console.log('  ✓ ALL CHECKS PASSED');
    console.log('  Data is verified and ready for dashboard consumption.');
  }

  console.log();
  console.log('='.repeat(70));

  return { passed, failed, total };
}

// Run if executed directly
if (require.main === module) {
  verify().catch((err) => {
    console.error('[ERROR] Verification failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { verify, verifyWithConn };
