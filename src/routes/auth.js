const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const config = require("../config");
const db = require("../db");
const { audit } = require("../audit");
const { issueToken } = require("../token");
const { hashPassword, nowSeconds } = require("../password");
const { authenticateAllowPasswordChange: authenticate } = require("../middleware/auth");

const router = express.Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", config.bcryptRounds);

const failedAttemptLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.login,
  skipSuccessfulRequests: true, // only failed attempts count
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many failed attempts. Try again later." },
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  firstName: u.first_name,
  lastName: u.last_name,
  mustChangePassword: !!u.must_change_password,
});

router.post("/login", failedAttemptLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });
  const email = parsed.data.email.toLowerCase();

  const user = await db.queryOne(
    "SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users WHERE email = ?",
    [email]
  );
  const passwordOk = await bcrypt.compare(parsed.data.password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordOk || !user.is_active || user.is_locked) {
    if (user) {
      // locked_until is assigned first: MySQL evaluates SET left to right.
      await db.query(
        `UPDATE users
            SET locked_until = IF(failed_logins + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), locked_until),
                failed_logins = failed_logins + 1
          WHERE id = ?`,
        [MAX_FAILED, LOCK_MINUTES, user.id]
      );
    }
    await audit(req, user?.is_locked ? "login.locked" : "login.failed", "user", user?.id ?? null, null, user?.id ?? null);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?", [user.id]);
  await audit(req, "login.success", "user", user.id, null, user.id);
  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.post("/logout", authenticate, async (req, res) => {
  await db.query("INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))", [
    req.token.jti,
    req.user.id,
    req.token.exp,
  ]);
  await audit(req, "logout", "user", req.user.id);
  res.json({ ok: true });
});

router.get("/me", authenticate, (req, res) => res.json(publicUser(req.user)));

const changeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12, "Password must be at least 12 characters").max(128),
  })
  .strict();

// Also the way out of a temporary password. Signs out every other session and returns a fresh token.
router.post("/change-password", authenticate, failedAttemptLimiter, async (req, res) => {
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid password", issues: parsed.error.issues });
  const { currentPassword, newPassword } = parsed.data;

  const row = await db.queryOne("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
    await audit(req, "password.change_failed", "user", req.user.id);
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from the current one" });
  }

  await db.query(
    "UPDATE users SET password_hash = ?, must_change_password = 0, tokens_valid_after = FROM_UNIXTIME(?) WHERE id = ?",
    [await hashPassword(newPassword), nowSeconds(), req.user.id]
  );
  await audit(req, "password.change", "user", req.user.id);
  res.json({ token: issueToken(req.user), user: publicUser({ ...req.user, must_change_password: 0 }) });
});

module.exports = router;
