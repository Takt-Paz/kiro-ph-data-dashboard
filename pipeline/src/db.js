/**
 * db.js - DuckDB Connection Manager
 * ==================================
 * 
 * DATA ENGINEERING INSIGHT:
 * In production pipelines, database connections are managed centrally.
 * This avoids connection leaks and ensures consistent configuration
 * across all pipeline stages.
 * 
 * DuckDB is an embedded analytical database (like SQLite for analytics).
 * It runs inside your process — no separate server needed.
 * This makes it perfect for data pipelines and local analytics.
 */

const duckdb = require('duckdb');
const path = require('path');

// Store the database file in the pipeline's output directory
const DB_PATH = path.join(__dirname, '..', 'output', 'pipeline.duckdb');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DATA_DIR = path.join(__dirname, '..');

/**
 * Creates a DuckDB database connection.
 * 
 * Why a persistent database file (not :memory:)?
 * - Allows inspection between pipeline stages
 * - Enables restarting from a specific stage without re-running everything
 * - Provides an audit trail of transformations
 */
function createConnection() {
  return new Promise((resolve, reject) => {
    try {
      const db = new duckdb.Database(DB_PATH);
      const conn = new duckdb.Connection(db);
      resolve({ db, conn });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Executes a SQL query and returns all rows.
 * 
 * This is a convenience wrapper that handles DuckDB's callback API
 * and converts it into modern async/await style.
 */
function runQuery(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * Executes a SQL statement that doesn't return rows (CREATE, INSERT, COPY, etc.)
 */
function runStatement(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Closes the database connection gracefully.
 * 
 * Always close connections in production to prevent:
 * - File locks on the database
 * - Memory leaks
 * - Corrupted write-ahead logs
 */
function closeConnection(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  DB_PATH,
  OUTPUT_DIR,
  DATA_DIR,
  createConnection,
  runQuery,
  runStatement,
  closeConnection
};
