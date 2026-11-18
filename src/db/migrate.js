// Applies schema.sql to the Hostinger database. Safe to re-run.
// Usage: npm run migrate
const fs = require("fs");
const path = require("path");
const db = require("./index");

// Split on semicolons that end a statement (schema.sql has no procedures/triggers).
function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureColumn(table, column, definition) {
  const found = await db.query(
    "SELECT 1 AS x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  if (found.length === 0) {
    await db.pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  ok: added ${table}.${column}`);
  }
}

(async () => {
  try {
    await db.connect();
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      const name = /CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i.exec(stmt)?.[1] || "statement";
      await db.pool.query(stmt);
      console.log(`  ok: ${name}`);
    }
    // Columns added after the first release: CREATE TABLE IF NOT EXISTS won't add them to a table
    // that already exists, so add any that are missing.
    await ensureColumn("users", "must_change_password", "TINYINT(1) NOT NULL DEFAULT 0");
    await ensureColumn("users", "tokens_valid_after", "DATETIME NULL");
    console.log(`Migration complete (${statements.length} statements).`);
    await db.close();
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
})();
