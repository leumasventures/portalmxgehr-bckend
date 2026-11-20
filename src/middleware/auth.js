const jwt = require("jsonwebtoken");
const config = require("../config");
const db = require("../db");
const { ISSUER } = require("../tokens");

function build(allowPasswordChange) {
  return async function authenticate(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: ["HS256"], issuer: ISSUER });
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const revoked = await db.queryOne("SELECT 1 AS x FROM revoked_tokens WHERE jti = ?", [payload.jti]);
    if (revoked) return res.status(401).json({ error: "Token has been revoked" });

    // Always re-check the user so deactivation / role changes take effect immediately.
    const user = await db.queryOne(
      `SELECT id, email, role, first_name, last_name, is_active, must_change_password,
              UNIX_TIMESTAMP(tokens_valid_after) AS valid_after
         FROM users WHERE id = ?`,
      [payload.sub]
    );
    if (!user || !user.is_active) return res.status(401).json({ error: "Account is not active" });
    // Password reset/change signs out every session issued before it.
    if (user.valid_after !== null && payload.iat < Number(user.valid_after)) {
      return res.status(401).json({ error: "Session expired, please sign in again" });
    }
    if (user.must_change_password && !allowPasswordChange) {
      return res.status(403).json({ error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" });
    }

    req.user = user;
    req.token = payload;
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

module.exports = {
  authenticate: build(false),
  // For the few endpoints a user with a temporary password may call (change password, me, logout).
  authenticateAllowPasswordChange: build(true),
  requireRole,
};
