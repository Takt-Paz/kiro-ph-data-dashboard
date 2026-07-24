/**
 * Dashboard Filters Component
 * =============================
 * 
 * Provides interactive filter controls that dynamically update SQL queries.
 * 
 * HOW DYNAMIC FILTERS WORK:
 * 1. User selects a filter value (e.g., Region = "Region III")
 * 2. The filter state updates via React setState
 * 3. SQL queries that depend on filters re-execute automatically
 * 4. Charts update with fresh data in ~5-30ms
 * 
 * DATA ENGINEERING INSIGHT:
 * Because DuckDB-WASM runs locally, filter interactions feel instant.
 * There's no network request — just a SQL re-execution against cached Parquet data.
 * This is called "zero-latency interactivity" and it's why client-side analytics
 * creates a dramatically better user experience vs traditional server-based dashboards.
 */

import { useDuckDB } from '../../hooks/useDuckDB';

export interface FilterState {
  region: string;
  year: string;
  workType: string;
  costCategory: string;
}

interface FiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

export function Filters({ filters, onChange }: FiltersProps) {
  // Fetch distinct values for each filter dropdown
  // These queries run once on mount and populate the dropdown options
  const { data: regions } = useDuckDB<{ region: string }>(`
    SELECT DISTINCT region FROM flood_control ORDER BY region
  `);

  const { data: years } = useDuckDB<{ infra_year: number }>(`
    SELECT DISTINCT infra_year FROM flood_control 
    WHERE infra_year IS NOT NULL ORDER BY infra_year DESC
  `);

  const { data: workTypes } = useDuckDB<{ type_of_work: string }>(`
    SELECT DISTINCT type_of_work FROM flood_control 
    WHERE type_of_work IS NOT NULL ORDER BY type_of_work
  `);

  const { data: costCategories } = useDuckDB<{ cost_category: string }>(`
    SELECT DISTINCT cost_category FROM flood_control ORDER BY cost_category
  `);

  return (
    <div className="filters">
      <div className="filter-group">
        <label htmlFor="filter-region">Region</label>
        <select
          id="filter-region"
          value={filters.region}
          onChange={(e) => onChange({ ...filters, region: e.target.value })}
        >
          <option value="">All Regions</option>
          {regions.map((r) => (
            <option key={r.region} value={r.region}>{r.region}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-year">Year</label>
        <select
          id="filter-year"
          value={filters.year}
          onChange={(e) => onChange({ ...filters, year: e.target.value })}
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y.infra_year} value={String(y.infra_year)}>{y.infra_year}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-work-type">Work Type</label>
        <select
          id="filter-work-type"
          value={filters.workType}
          onChange={(e) => onChange({ ...filters, workType: e.target.value })}
        >
          <option value="">All Types</option>
          {workTypes.map((w) => (
            <option key={w.type_of_work} value={w.type_of_work}>{w.type_of_work}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-cost">Cost Category</label>
        <select
          id="filter-cost"
          value={filters.costCategory}
          onChange={(e) => onChange({ ...filters, costCategory: e.target.value })}
        >
          <option value="">All Categories</option>
          {costCategories.map((c) => (
            <option key={c.cost_category} value={c.cost_category}>{c.cost_category}</option>
          ))}
        </select>
      </div>

      {/* Reset button */}
      {(filters.region || filters.year || filters.workType || filters.costCategory) && (
        <button
          className="filter-reset"
          onClick={() => onChange({ region: '', year: '', workType: '', costCategory: '' })}
          type="button"
        >
          Reset Filters
        </button>
      )}
    </div>
  );
}

/**
 * Utility: Build a WHERE clause from active filters.
 * Returns empty string if no filters active, or " WHERE ..." clause.
 * 
 * IMPORTANT: In production, use parameterized queries to prevent SQL injection.
 * Since our filter values come from DuckDB itself (not user text input),
 * this is safe for this use case. For free-text inputs, always sanitize.
 */
export function buildWhereClause(filters: FilterState): string {
  const conditions: string[] = [];

  if (filters.region) {
    conditions.push(`region = '${filters.region.replace(/'/g, "''")}'`);
  }
  if (filters.year) {
    conditions.push(`infra_year = ${parseInt(filters.year, 10)}`);
  }
  if (filters.workType) {
    conditions.push(`type_of_work = '${filters.workType.replace(/'/g, "''")}'`);
  }
  if (filters.costCategory) {
    conditions.push(`cost_category = '${filters.costCategory.replace(/'/g, "''")}'`);
  }

  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
}
