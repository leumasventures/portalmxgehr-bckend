// Database access layer. The ONLY place that creates a connection to the
// Hostinger MySQL database; every other file imports { query, withTransaction }.
const mysql = require("mysql2/promise");
const config = require("../config");

const pool = mysql.createPool(config.db);

// Force every connection to UTC so CURRENT_TIMESTAMP / NOW() match the UTC values the app stores.
pool.on("connection", (conn) => conn.query("SET time_zone = '+00:00'"));

// Parameterized query. Always pass values via `params`, never string-concatenate.
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Runs fn(conn) in a transaction; commits on success, rolls back on any error.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn({
      query: async (sql, params = []) => (await conn.execute(sql, params))[0],
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Call once at startup: fails fast with a readable reason if the DB is unreachable.
async function connect() {
  const { host, port, database, user } = config.db;
  try {
    await pool.query("SELECT 1");
    console.log(`Database connected: ${user}@${host}:${port}/${database}`);
  } catch (err) {
    const hint =
      err.code === "ER_ACCESS_DENIED_ERROR"
        ? "wrong DB_USER / DB_PASSWORD"
        : err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED"
          ? "server IP is probably not whitelisted under hPanel > Databases > Remote MySQL"
          : err.code === "ENOTFOUND"
            ? "check DB_HOST"
            : "see error above";
    console.error(`Database connection failed (${err.code || err.message}): ${hint}`);
    throw err;
  }
}

async function close() {
  await pool.end();
}

// Lightweight check for a /health endpoint.
async function ping() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

module.exports = { pool, query, queryOne, withTransaction, connect, close, ping };
