/**
 * ============================================================================
 * PHILIPPINE FLOOD CONTROL DASHBOARD
 * ============================================================================
 * 
 * Architecture:
 *   Parquet Files (public/data/)
 *       ↓
 *   DuckDB-WASM (in-browser SQL engine)
 *       ↓
 *   React State (query results)
 *       ↓
 *   Chart.js Visualizations + Data Tables
 * 
 * All queries execute client-side. No backend API. No server costs.
 * Data loads from Parquet in ~1-2s on first visit, then queries run in 5-30ms.
 * ============================================================================
 */

import { useState, useMemo } from 'react'
import { useDuckDB } from './hooks/useDuckDB'
import { Filters, buildWhereClause, type FilterState } from './components/filters/Filters'
import { BarChart, LineChart, DoughnutChart } from './components/charts'
import { QueryTimer } from './components/QueryTimer'
import './App.css'

// ─── Type Definitions ────────────────────────────────────────────────────────

interface SummaryStats {
  total_projects: number
  total_cost: number
  avg_cost: number
  unique_contractors: number
  regions: number
}

interface RegionRow {
  region: string
  projects: number
  total_cost: number
}

interface YearRow {
  infra_year: number
  projects: number
  total_cost: number
}

interface WorkTypeRow {
  type_of_work: string
  projects: number
  total_cost: number
}

interface CostCategoryRow {
  cost_category: string
  projects: number
  total_cost: number
}

interface TopContractorRow {
  contractor: string
  projects: number
  total_value: number
}

// ─── App Component ───────────────────────────────────────────────────────────

function App() {
  // Filter state — controls all queries dynamically
  const [filters, setFilters] = useState<FilterState>({
    region: '',
    year: '',
    workType: '',
    costCategory: '',
  });

  // Build the WHERE clause from active filters
  // useMemo avoids rebuilding the string on every render
  const whereClause = useMemo(() => buildWhereClause(filters), [filters]);

  // ─── QUERIES (all react to filter changes automatically) ─────────────────

  // KPI Summary
  const { data: stats, loading: statsLoading, durationMs: statsDuration } = useDuckDB<SummaryStats>(`
    SELECT 
      CAST(COUNT(*) AS INTEGER) as total_projects,
      ROUND(SUM(contract_cost), 0) as total_cost,
      ROUND(AVG(contract_cost), 0) as avg_cost,
      CAST(COUNT(DISTINCT contractor) AS INTEGER) as unique_contractors,
      CAST(COUNT(DISTINCT region) AS INTEGER) as regions
    FROM flood_control${whereClause}
  `, [whereClause]);

  // Projects by Region (bar chart)
  const { data: regionData, durationMs: regionDuration } = useDuckDB<RegionRow>(`
    SELECT 
      region,
      CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY region
    ORDER BY projects DESC
    LIMIT 12
  `, [whereClause]);

  // Projects by Year (line chart)
  const { data: yearData, durationMs: yearDuration } = useDuckDB<YearRow>(`
    SELECT 
      infra_year,
      CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}${whereClause ? ' AND' : ' WHERE'} infra_year IS NOT NULL
    GROUP BY infra_year
    ORDER BY infra_year
  `, [whereClause]);

  // Work Type Distribution (doughnut chart)
  const { data: workTypeData, durationMs: workTypeDuration } = useDuckDB<WorkTypeRow>(`
    SELECT 
      type_of_work,
      CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY type_of_work
    ORDER BY projects DESC
    LIMIT 8
  `, [whereClause]);

  // Cost Category Distribution (doughnut)
  const { data: costCatData } = useDuckDB<CostCategoryRow>(`
    SELECT 
      cost_category,
      CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY cost_category
    ORDER BY total_cost DESC
  `, [whereClause]);

  // Top Contractors (bar chart — drill-down)
  const { data: contractorData, durationMs: contractorDuration } = useDuckDB<TopContractorRow>(`
    SELECT 
      contractor,
      CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_value
    FROM flood_control${whereClause}
    GROUP BY contractor
    ORDER BY projects DESC
    LIMIT 10
  `, [whereClause]);

  // ─── LOADING STATE ───────────────────────────────────────────────────────

  if (statsLoading && stats.length === 0) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Initializing DuckDB-WASM and loading Parquet data...</p>
        <p className="loading-detail">
          This downloads the SQL engine (~9MB) and dataset (~2MB) to your browser.
          <br />Subsequent visits will be faster due to browser caching.
        </p>
      </div>
    )
  }

  const summary = stats[0];

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <h1>Philippine Flood Control Projects</h1>
        <p className="subtitle">
          Infrastructure analytics dashboard — powered by <strong>DuckDB-WASM</strong> and <strong>Parquet</strong>
        </p>
      </header>

      {/* Filters */}
      <Filters filters={filters} onChange={setFilters} />

      {/* KPI Cards */}
      {summary && (
        <section className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-value">{summary.total_projects.toLocaleString()}</span>
            <span className="kpi-label">Total Projects</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-value">₱{(Number(summary.total_cost) / 1e9).toFixed(1)}B</span>
            <span className="kpi-label">Total Contract Cost</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-value">₱{(Number(summary.avg_cost) / 1e6).toFixed(1)}M</span>
            <span className="kpi-label">Avg Project Cost</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-value">{summary.unique_contractors.toLocaleString()}</span>
            <span className="kpi-label">Contractors</span>
          </div>
          <QueryTimer durationMs={statsDuration} label="Query" />
        </section>
      )}

      {/* Charts Grid */}
      <div className="charts-grid">
        {/* Projects by Year — Line Chart */}
        <section className="card">
          <div className="card-header">
            <h2>Projects & Cost by Year</h2>
            <QueryTimer durationMs={yearDuration} />
          </div>
          {yearData.length > 0 && (
            <LineChart
              labels={yearData.map((r) => String(r.infra_year))}
              datasets={[
                {
                  label: 'Projects',
                  data: yearData.map((r) => r.projects),
                  color: '#1f2937',
                  fill: true,
                },
                {
                  label: 'Cost (₱B)',
                  data: yearData.map((r) => Number(r.total_cost) / 1e9),
                  color: '#9ca3af',
                },
              ]}
              formatValue={(v) => v >= 1 ? `${v.toFixed(1)}` : v.toLocaleString()}
            />
          )}
        </section>

        {/* Projects by Region — Bar Chart */}
        <section className="card">
          <div className="card-header">
            <h2>Projects by Region</h2>
            <QueryTimer durationMs={regionDuration} />
          </div>
          {regionData.length > 0 && (
            <BarChart
              labels={regionData.map((r) => r.region)}
              data={regionData.map((r) => r.projects)}
              label="Projects"
              color="#1f2937"
              horizontal
            />
          )}
        </section>

        {/* Work Type — Doughnut Chart */}
        <section className="card">
          <div className="card-header">
            <h2>By Work Type</h2>
            <QueryTimer durationMs={workTypeDuration} />
          </div>
          {workTypeData.length > 0 && (
            <DoughnutChart
              labels={workTypeData.map((r) => r.type_of_work)}
              data={workTypeData.map((r) => r.projects)}
              formatValue={(v) => `${v.toLocaleString()} projects`}
            />
          )}
        </section>

        {/* Cost Category — Doughnut Chart */}
        <section className="card">
          <div className="card-header">
            <h2>By Cost Category</h2>
          </div>
          {costCatData.length > 0 && (
            <DoughnutChart
              labels={costCatData.map((r) => r.cost_category)}
              data={costCatData.map((r) => Number(r.total_cost))}
              formatValue={(v) => `₱${(v / 1e9).toFixed(1)}B`}
            />
          )}
        </section>

        {/* Top Contractors — Bar Chart */}
        <section className="card card-full">
          <div className="card-header">
            <h2>Top 10 Contractors</h2>
            <QueryTimer durationMs={contractorDuration} />
          </div>
          {contractorData.length > 0 && (
            <BarChart
              labels={contractorData.map((r) => 
                r.contractor.length > 30 ? r.contractor.slice(0, 30) + '…' : r.contractor
              )}
              data={contractorData.map((r) => r.projects)}
              label="Projects Awarded"
              color="#4b5563"
              horizontal
              formatValue={(v) => `${v} projects`}
            />
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="dashboard-footer">
        <p>
          Source: <a href="https://bettergov.ph/flood-control-projects" target="_blank" rel="noreferrer">bettergov.ph</a>
          {' '}| Stack: React + Chart.js + DuckDB-WASM + Parquet
          {' '}| No backend server required
        </p>
      </footer>
    </div>
  )
}

export default App
