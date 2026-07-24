const duckdb = require('duckdb');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'output', 'pipeline.duckdb');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DATA_DIR = path.join(__dirname, '..');

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

function closeConnection(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { DB_PATH, OUTPUT_DIR, DATA_DIR, createConnection, runQuery, runStatement, closeConnection };
