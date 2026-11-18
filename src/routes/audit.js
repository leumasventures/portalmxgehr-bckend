// Admin-only audit log viewer (read-only; there is deliberately no way to edit or delete rows).
//   GET /api/audit?userId=&action=&entityType=&entityId=&from=&to=&limit=&before=
//   action ending in "." matches a prefix, e.g. action=patient. returns patient.read, patient.update...
//   "Who accessed this patient?"  ->  ?entityType=patient&entityId=<patient id>
//   Page backwards in time with before=<nextCursor from the previous response>.
const express = require("express");
const db = require("../db");
const { audit } = require("../audit");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, requireRole("admin"));

const toSql = (iso) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");

function parseDetails(v) {
  if (typeof v !== "string") return v ?? null; // MySQL JSON columns arrive parsed; MariaDB returns text
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

router.get("/", async (req, res) => {
  const where = [];
  const params = [];

  for (const [qs, col] of [["userId", "a.user_id"], ["entityType", "a.entity_type"], ["entityId", "a.entity_id"]]) {
    if (req.query[qs]) {
      where.push(`${col} = ?`);
      params.push(String(req.query[qs]));
    }
  }
  if (req.query.action) {
    const action = String(req.query.action);
    if (action.endsWith(".")) {
      where.push("a.action LIKE ?");
      params.push(`${action.replace(/[\\%_]/g, "\\$&")}%`);
    } else {
      where.push("a.action = ?");
      params.push(action);
    }
  }
  for (const [qs, op] of [["from", ">="], ["to", "<"]]) {
    if (req.query[qs]) {
      const d = new Date(String(req.query[qs]));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `Invalid ${qs} date` });
      where.push(`a.created_at ${op} ?`);
      params.push(toSql(d.toISOString()));
    }
  }
  if (req.query.before) {
    const before = parseInt(req.query.before, 10);
    if (!Number.isInteger(before)) return res.status(400).json({ error: "Invalid before cursor" });
    where.push("a.id < ?");
    params.push(before);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const rows = await db.query(
    `SELECT a.id, a.user_id, u.email AS user_email, a.action, a.entity_type, a.entity_id,
            a.ip_address, a.user_agent, a.details, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.id DESC LIMIT ${limit}`,
    params
  );

  await audit(req, "audit.read", null, null, { count: rows.length });
  res.json({
    data: rows.map((r) => ({
      id: Number(r.id),
      at: r.created_at,
      userId: r.user_id,
      userEmail: r.user_email,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      ip: r.ip_address,
      userAgent: r.user_agent,
      details: parseDetails(r.details),
    })),
    nextCursor: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
  });
});

module.exports = router;
