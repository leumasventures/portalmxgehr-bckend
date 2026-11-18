// Audit trail. Fails closed: if the audit row can't be written, the request errors
// instead of silently allowing unlogged access to patient data.
// Never pass PHI values in `details` (IDs, field names and counts only).
const db = require("./db");

async function audit(req, action, entityType = null, entityId = null, details = null, userId = null) {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId ?? req.user?.id ?? null,
      action,
      entityType,
      entityId,
      req.ip ?? null,
      (req.get("user-agent") || "").slice(0, 255) || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

module.exports = { audit };
