// Patient portal accounts: link a patient record to a login (role "patient").
// Mounted under /api/patients, so the paths are /api/patients/:id/portal-account...
// The login uses the patient's email on file. A patient with a login can only ever see their own
// record, appointments and notes (enforced in those routes via patients.user_id).
const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { audit } = require("../audit");
const { hashPassword, generateTempPassword, resetPassword, nowSeconds } = require("../passwords");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

const MANAGERS = ["admin", "staff"];
const sensitive = (res) => res.set("Cache-Control", "no-store");

router.get("/:id/portal-account", requireRole(...MANAGERS), async (req, res) => {
  const row = await db.queryOne(
    `SELECT p.id, u.email, u.is_active, u.must_change_password, u.last_login_at
       FROM patients p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: "Patient not found" });
  res.json({
    linked: !!row.email,
    email: row.email ?? null,
    isActive: row.email ? !!row.is_active : null,
    mustChangePassword: row.email ? !!row.must_change_password : null,
    lastLoginAt: row.last_login_at ?? null,
  });
});

// Create the login, or re-enable one that was disabled. Returns a one-time temporary password.
router.post("/:id/portal-account", requireRole(...MANAGERS), async (req, res) => {
  let outcome;
  try {
    outcome = await db.withTransaction(async (tx) => {
      const [patient] = await tx.query(
        "SELECT id, email, first_name, last_name, user_id FROM patients WHERE id = ? AND is_active = 1 FOR UPDATE",
        [req.params.id]
      );
      if (!patient) return { status: 404, error: "Patient not found" };

      if (patient.user_id) {
        const [user] = await tx.query("SELECT id, is_active FROM users WHERE id = ?", [patient.user_id]);
        if (user.is_active) return { status: 409, error: "This patient already has an active portal account" };
        await tx.query("UPDATE users SET is_active = 1 WHERE id = ?", [user.id]); // re-enable
        return { status: 200, userId: user.id, tempPassword: await resetPassword(tx, user.id), reenabled: true };
      }

      if (!patient.email) return { status: 400, error: "Add an email address to the patient record first" };
      const userId = crypto.randomUUID();
      const tempPassword = generateTempPassword();
      await tx.query(
        `INSERT INTO users (id, email, password_hash, role, first_name, last_name, must_change_password)
         VALUES (?, ?, ?, 'patient', ?, ?, 1)`,
        [userId, patient.email.toLowerCase(), await hashPassword(tempPassword), patient.first_name, patient.last_name]
      );
      await tx.query("UPDATE patients SET user_id = ? WHERE id = ?", [userId, patient.id]);
      return { status: 201, userId, tempPassword };
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A user with that email already exists" });
    throw err;
  }

  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  await audit(req, outcome.reenabled ? "portal.reenable" : "portal.create", "patient", req.params.id);
  sensitive(res).status(outcome.status).json({ tempPassword: outcome.tempPassword, mustChangePassword: true });
});

router.post("/:id/portal-account/reset-password", requireRole(...MANAGERS), async (req, res) => {
  const patient = await db.queryOne("SELECT user_id FROM patients WHERE id = ?", [req.params.id]);
  if (!patient?.user_id) return res.status(404).json({ error: "This patient has no portal account" });
  const tempPassword = await resetPassword(db, patient.user_id);
  await audit(req, "portal.reset_password", "patient", req.params.id);
  sensitive(res).json({ tempPassword, mustChangePassword: true });
});

// Disables the login (keeps the link so it can be re-enabled) and signs the patient out everywhere.
router.delete("/:id/portal-account", requireRole("admin"), async (req, res) => {
  const patient = await db.queryOne("SELECT user_id FROM patients WHERE id = ?", [req.params.id]);
  if (!patient?.user_id) return res.status(404).json({ error: "This patient has no portal account" });
  await db.query("UPDATE users SET is_active = 0, tokens_valid_after = FROM_UNIXTIME(?) WHERE id = ?", [
    nowSeconds(),
    patient.user_id,
  ]);
  await audit(req, "portal.disable", "patient", req.params.id);
  res.json({ ok: true });
});

module.exports = router;
