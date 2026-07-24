import { useState, useMemo } from 'react'
import { useDuckDB } from './hooks/useDuckDB'
import { Filters, buildWhereClause, type FilterState } from './components/filters/Filters'
import { BarChart, LineChart, DoughnutChart } from './components/charts'
import { DataTable } from './components/DataTable'
import { SearchBar } from './components/SearchBar'
import { ExportButton } from './components/ExportButton'
import { Tabs } from './components/Tabs'
import './App.css'

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface ProvinceRow {
  province: string
  projects: number
  total_cost: number
  contractors: number
}

interface ProjectRow {
  project_id: string
  project_description: string
  region: string
  province: string
  contractor: string
  contract_cost: number
  infra_year: number
  type_of_work: string
  cost_category: string
}

// ─── App ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'regions', label: 'Regions' },
  { id: 'contractors', label: 'Contractors' },
  { id: 'explorer', label: 'Data Explorer' },
]

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [filters, setFilters] = useState<FilterState>({
    region: '',
    year: '',
    workType: '',
    costCategory: '',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');

  const whereClause = useMemo(() => buildWhereClause(filters), [filters]);

  // Search clause for data explorer
  const searchClause = useMemo(() => {
    if (!searchTerm) return '';
    const escaped = searchTerm.replace(/'/g, "''");
    const base = whereClause ? ' AND' : ' WHERE';
    return `${base} (project_description ILIKE '%${escaped}%' OR contractor ILIKE '%${escaped}%' OR province ILIKE '%${escaped}%')`;
  }, [searchTerm, whereClause]);

  // ─── Overview Queries ────────────────────────────────────────────────────

  const { data: stats, loading: statsLoading } = useDuckDB<SummaryStats>(`
    SELECT 
      CAST(COUNT(*) AS INTEGER) as total_projects,
      ROUND(SUM(contract_cost), 0) as total_cost,
      ROUND(AVG(contract_cost), 0) as avg_cost,
      CAST(COUNT(DISTINCT contractor) AS INTEGER) as unique_contractors,
      CAST(COUNT(DISTINCT region) AS INTEGER) as regions
    FROM flood_control${whereClause}
  `, [whereClause]);

  const { data: yearData } = useDuckDB<YearRow>(`
    SELECT infra_year, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}${whereClause ? ' AND' : ' WHERE'} infra_year IS NOT NULL
    GROUP BY infra_year ORDER BY infra_year
  `, [whereClause]);

  const { data: workTypeData } = useDuckDB<WorkTypeRow>(`
    SELECT type_of_work, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY type_of_work ORDER BY projects DESC LIMIT 8
  `, [whereClause]);

  const { data: costCatData } = useDuckDB<CostCategoryRow>(`
    SELECT cost_category, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY cost_category ORDER BY total_cost DESC
  `, [whereClause]);

  // ─── Region Queries ──────────────────────────────────────────────────────

  const { data: regionData } = useDuckDB<RegionRow>(`
    SELECT region, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost
    FROM flood_control${whereClause}
    GROUP BY region ORDER BY projects DESC
  `, [whereClause]);

  const provinceWhere = selectedRegion
    ? `${whereClause}${whereClause ? ' AND' : ' WHERE'} region = '${selectedRegion.replace(/'/g, "''")}'`
    : whereClause;

  const { data: provinceData } = useDuckDB<ProvinceRow>(`
    SELECT province, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_cost,
      CAST(COUNT(DISTINCT contractor) AS INTEGER) as contractors
    FROM flood_control${provinceWhere}
    GROUP BY province ORDER BY projects DESC LIMIT 20
  `, [provinceWhere]);

  // ─── Contractor Queries ──────────────────────────────────────────────────

  const { data: contractorData } = useDuckDB<TopContractorRow>(`
    SELECT contractor, CAST(COUNT(*) AS INTEGER) as projects,
      ROUND(SUM(contract_cost), 0) as total_value
    FROM flood_control${whereClause}
    GROUP BY contractor ORDER BY projects DESC LIMIT 25
  `, [whereClause]);

  // ─── Data Explorer Query ─────────────────────────────────────────────────

  const explorerSQL = `
    SELECT project_id, project_description, region, province, contractor,
      contract_cost, infra_year, type_of_work, cost_category
    FROM flood_control${whereClause}${searchClause}
    ORDER BY contract_cost DESC LIMIT 500
  `;

  const { data: explorerData } = useDuckDB<ProjectRow>(
    explorerSQL, [whereClause, searchClause]
  );

  // ─── Loading ─────────────────────────────────────────────────────────────

  if (statsLoading && stats.length === 0) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Initializing DuckDB-WASM...</p>
        <p className="loading-detail">
          Loading SQL engine and dataset into your browser.
        </p>
      </div>
    )
  }

  const summary = stats[0];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Philippine Flood Control Projects</h1>
        <p className="subtitle">
          Infrastructure analytics — {summary?.total_projects.toLocaleString()} projects across {summary?.regions} regions
        </p>
      </header>

      <Filters filters={filters} onChange={setFilters} />
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* ─── OVERVIEW TAB ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {summary && (
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-value">{summary.total_projects.toLocaleString()}</span>
                <span className="kpi-label">Total Projects</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">₱{(Number(summary.total_cost) / 1e9).toFixed(1)}B</span>
                <span className="kpi-label">Total Cost</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">₱{(Number(summary.avg_cost) / 1e6).toFixed(1)}M</span>
                <span className="kpi-label">Avg Cost</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">{summary.unique_contractors.toLocaleString()}</span>
                <span className="kpi-label">Contractors</span>
              </div>
              
            </section>
          )}

          <div className="charts-grid">
            <section className="card">
              <div className="card-header">
                <h2>Projects & Cost by Year</h2>
                
              </div>
              {yearData.length > 0 && (
                <LineChart
                  labels={yearData.map((r) => String(r.infra_year))}
                  datasets={[
                    { label: 'Projects', data: yearData.map((r) => r.projects), color: '#1f2937', fill: true },
                    { label: 'Cost (₱B)', data: yearData.map((r) => Number(r.total_cost) / 1e9), color: '#9ca3af' },
                  ]}
                  formatValue={(v) => v >= 1 ? `${v.toFixed(1)}` : v.toLocaleString()}
                />
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <h2>By Work Type</h2>
                
              </div>
              {workTypeData.length > 0 && (
                <DoughnutChart
                  labels={workTypeData.map((r) => r.type_of_work)}
                  data={workTypeData.map((r) => r.projects)}
                  formatValue={(v) => `${v.toLocaleString()} projects`}
                />
              )}
            </section>

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
          </div>
        </>
      )}

      {/* ─── REGIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === 'regions' && (
        <>
          <div className="charts-grid">
            <section className="card">
              <div className="card-header">
                <h2>All Regions</h2>
                
              </div>
              {regionData.length > 0 && (
                <BarChart
                  labels={regionData.map((r) => r.region)}
                  data={regionData.map((r) => r.projects)}
                  label="Projects"
                  horizontal
                />
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <h2>
                  {selectedRegion ? `Provinces in ${selectedRegion}` : 'Select a region to drill down'}
                </h2>
                {selectedRegion && (
                  <button type="button" className="filter-reset" onClick={() => setSelectedRegion('')}>
                    Clear
                  </button>
                )}
              </div>
              {provinceData.length > 0 && selectedRegion && (
                <BarChart
                  labels={provinceData.map((r) => r.province)}
                  data={provinceData.map((r) => r.projects)}
                  label="Projects"
                  color="#0369a1"
                  horizontal
                />
              )}
              {!selectedRegion && (
                <p className="empty-state">Click a region below to see province breakdown.</p>
              )}
            </section>
          </div>

          <section className="card" style={{ marginTop: '1rem' }}>
            <div className="card-header">
              <h2>Region Details</h2>
              <ExportButton
                sql={`SELECT region, CAST(COUNT(*) AS INTEGER) as projects, ROUND(SUM(contract_cost),0) as total_cost FROM flood_control${whereClause} GROUP BY region ORDER BY total_cost DESC`}
                filename="regions_export.csv"
              />
            </div>
            <DataTable
              data={regionData}
              columns={[
                { key: 'region', label: 'Region' },
                { key: 'projects', label: 'Projects', align: 'right', format: (v) => Number(v).toLocaleString() },
                { key: 'total_cost', label: 'Total Cost', align: 'right', format: (v) => `₱${(Number(v) / 1e9).toFixed(2)}B` },
              ]}
            />
            <div className="region-select-hint">
              <p>Click a row to drill down into provinces:</p>
              <div className="region-chips">
                {regionData.map((r) => (
                  <button
                    key={r.region}
                    type="button"
                    className={`chip ${selectedRegion === r.region ? 'chip-active' : ''}`}
                    onClick={() => setSelectedRegion(selectedRegion === r.region ? '' : r.region)}
                  >
                    {r.region}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ─── CONTRACTORS TAB ──────────────────────────────────────────── */}
      {activeTab === 'contractors' && (
        <>
          <section className="card">
            <div className="card-header">
              <h2>Top 25 Contractors by Project Count</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                
                <ExportButton
                  sql={`SELECT contractor, CAST(COUNT(*) AS INTEGER) as projects, ROUND(SUM(contract_cost),0) as total_value FROM flood_control${whereClause} GROUP BY contractor ORDER BY projects DESC LIMIT 100`}
                  filename="contractors_export.csv"
                />
              </div>
            </div>
            {contractorData.length > 0 && (
              <BarChart
                labels={contractorData.map((r) =>
                  r.contractor.length > 35 ? r.contractor.slice(0, 35) + '…' : r.contractor
                )}
                data={contractorData.map((r) => r.projects)}
                label="Projects"
                color="#4b5563"
                horizontal
                formatValue={(v) => `${v} projects`}
              />
            )}
          </section>

          <section className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>Contractor Details</h2>
            <DataTable
              data={contractorData}
              columns={[
                { key: 'contractor', label: 'Contractor' },
                { key: 'projects', label: 'Projects', align: 'right', format: (v) => Number(v).toLocaleString() },
                { key: 'total_value', label: 'Total Value', align: 'right', format: (v) => `₱${(Number(v) / 1e6).toFixed(1)}M` },
              ]}
              pageSize={25}
            />
          </section>
        </>
      )}

      {/* ─── DATA EXPLORER TAB ────────────────────────────────────────── */}
      {activeTab === 'explorer' && (
        <>
          <section className="card">
            <div className="card-header">
              <h2>Project Explorer</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                
                <ExportButton sql={explorerSQL} filename="projects_export.csv" />
              </div>
            </div>

            <SearchBar onSearch={setSearchTerm} placeholder="Search projects, contractors, or provinces..." />

            <div style={{ marginTop: '1rem' }}>
              <DataTable
                data={explorerData}
                columns={[
                  { key: 'project_description', label: 'Project', format: (v) => {
                    const s = String(v);
                    return s.length > 60 ? s.slice(0, 60) + '…' : s;
                  }},
                  { key: 'region', label: 'Region' },
                  { key: 'province', label: 'Province' },
                  { key: 'contractor', label: 'Contractor', format: (v) => {
                    const s = String(v);
                    return s.length > 25 ? s.slice(0, 25) + '…' : s;
                  }},
                  { key: 'contract_cost', label: 'Cost', align: 'right', format: (v) => `₱${(Number(v) / 1e6).toFixed(1)}M` },
                  { key: 'infra_year', label: 'Year', align: 'right', format: (v) => String(v) },
                  { key: 'type_of_work', label: 'Type', format: (v) => {
                    const s = String(v);
                    return s.length > 20 ? s.slice(0, 20) + '…' : s;
                  }},
                ]}
                pageSize={15}
              />
            </div>
          </section>
        </>
      )}

      <footer className="dashboard-footer">
        <p>
          Source: <a href="https://bettergov.ph/flood-control-projects" target="_blank" rel="noreferrer">bettergov.ph</a>
          {' '}| React + Chart.js + DuckDB-WASM + Parquet | Zero backend
        </p>
      </footer>
    </div>
  )
}

export default App
