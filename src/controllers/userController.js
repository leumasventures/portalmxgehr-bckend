// Admin user management. Passwords are never chosen by an admin: the server generates a
// temporary one, returns it once, and the user must change it at first login.
const crypto = require("crypto");
const { z } = require("zod");
const db = require("../db");
const { audit } = require("../audit");
const { resetPassword, hashPassword, generateTempPassword, nowSeconds } = require("../passwords");
const { escapeLike, paging, noStore } = require("../utils");

// Patient logins are created from the patient record (see portalController), not here.
const STAFF_ROLES = ["admin", "provider", "staff"];

const createSchema = z
  .object({
    email: z.string().email().max(255),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: z.enum(STAFF_ROLES),
  })
  .strict();

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: z.enum(STAFF_ROLES),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

const COLUMNS = { firstName: "first_name", lastName: "last_name", role: "role", isActive: "is_active" };

const SELECT = `SELECT id, email, role, first_name, last_name, is_active, must_change_password, last_login_at, created_at,
                       (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users`;

const shape = (r) => ({
  id: r.id,
  email: r.email,
  role: r.role,
  firstName: r.first_name,
  lastName: r.last_name,
  isActive: !!r.is_active,
  isLocked: !!r.is_locked,
  mustChangePassword: !!r.must_change_password,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

async function list(req, res) {
  const where = [];
  const params = [];
  if (req.query.role) {
    where.push("role = ?");
    params.push(String(req.query.role));
  }
  if (req.query.isActive !== undefined) {
    where.push("is_active = ?");
    params.push(req.query.isActive === "false" ? 0 : 1);
  }
  const q = String(req.query.q || "").trim();
  if (q) {
    const like = `${escapeLike(q)}%`;
    where.push("(email LIKE ? OR last_name LIKE ? OR first_name LIKE ?)");
    params.push(like, like, like);
  }
  const { limit, offset } = paging(req, { limit: 50, max: 200 });
  const rows = await db.query(
    `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_name, first_name LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ data: rows.map(shape), limit, offset });
}

async function get(req, res) {
  const row = await db.queryOne(`${SELECT} WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "User not found" });
  res.json(shape(row));
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid user", issues: parsed.error.issues });
  const d = parsed.data;

  const id = crypto.randomUUID();
  const tempPassword = generateTempPassword();
  try {
    await db.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, d.email.toLowerCase(), await hashPassword(tempPassword), d.role, d.firstName, d.lastName]
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A user with that email already exists" });
    throw err;
  }
  await audit(req, "user.create", "user", id, { role: d.role });
  noStore(res)
    .status(201)
    .json({ user: shape(await db.queryOne(`${SELECT} WHERE id = ?`, [id])), tempPassword });
}

async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update", issues: parsed.error.issues });
  const d = parsed.data;
  if (Object.keys(d).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const target = await db.queryOne("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found" });

  if (d.role !== undefined && target.role === "patient") {
    return res.status(400).json({ error: "Patient logins can't be given a staff role" });
  }
  if (target.id === req.user.id && (d.isActive === false || (d.role !== undefined && d.role !== target.role))) {
    return res.status(400).json({ error: "You can't deactivate or change the role of your own account" });
  }
  const losingAdmin = target.role === "admin" && (d.isActive === false || (d.role !== undefined && d.role !== "admin"));
  if (losingAdmin) {
    const others = await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [target.id]);
    if (Number(others.c) === 0) return res.status(400).json({ error: "At least one active admin is required" });
  }

  const sets = [];
  const vals = [];
  for (const [field, value] of Object.entries(d)) {
    sets.push(`${COLUMNS[field]} = ?`);
    vals.push(field === "isActive" ? (value ? 1 : 0) : value);
  }
  if (d.isActive === false) {
    sets.push("tokens_valid_after = FROM_UNIXTIME(?)"); // sign out everywhere immediately
    vals.push(nowSeconds());
  }
  vals.push(target.id);
  await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);

  await audit(req, "user.update", "user", target.id, { fields: Object.keys(d) });
  res.json(shape(await db.queryOne(`${SELECT} WHERE id = ?`, [target.id])));
}

async function resetUserPassword(req, res) {
  const target = await db.queryOne("SELECT id FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "User not found" });
  const tempPassword = await resetPassword(db, target.id);
  await audit(req, "user.reset_password", "user", target.id);
  noStore(res).json({ tempPassword, mustChangePassword: true });
}

async function unlock(req, res) {
  const result = await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "User not found" });
  await audit(req, "user.unlock", "user", req.params.id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, resetUserPassword, unlock };
