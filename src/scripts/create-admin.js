// Creates the first admin user directly in the database.
// Usage (password via env so it doesn't land in shell history via argv):
//   ADMIN_PASSWORD='a long passphrase' npm run create-admin -- you@example.com First Last
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("../config");
const db = require("../db");

(async () => {
  const [email, firstName, lastName] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !firstName || !lastName || !password) {
    console.error("Usage: ADMIN_PASSWORD='...' npm run create-admin -- <email> <firstName> <lastName>");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("ADMIN_PASSWORD must be at least 12 characters");
    process.exit(1);
  }
  try {
    await db.connect();
    const hash = await bcrypt.hash(password, config.bcryptRounds);
    await db.query(
      "INSERT INTO users (id, email, password_hash, role, first_name, last_name) VALUES (?, ?, ?, 'admin', ?, ?)",
      [crypto.randomUUID(), email.toLowerCase(), hash, firstName, lastName]
    );
    console.log(`Admin created: ${email.toLowerCase()}`);
    await db.close();
  } catch (err) {
    console.error(err.code === "ER_DUP_ENTRY" ? "A user with that email already exists" : `Failed: ${err.message}`);
    process.exit(1);
  }
})();
