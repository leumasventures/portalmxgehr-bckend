const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("./config");

// No look-alike characters (0/O, 1/l/I) so a temporary password is easy to read out or type.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateTempPassword(length = 16) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);

// Seconds from the API server's clock. Used for "sessions valid after" so it is compared
// against the JWT's iat (same clock) and never against the remote database's clock.
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Sets a new temporary password, forces a change at next login, unlocks the account and
// signs out every existing session. `exec` is `db` or a transaction handle (both have .query).
async function resetPassword(exec, userId) {
  const temp = generateTempPassword();
  await exec.query(
    `UPDATE users
        SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL,
            tokens_valid_after = FROM_UNIXTIME(?)
      WHERE id = ?`,
    [await hashPassword(temp), nowSeconds(), userId]
  );
  return temp;
}

module.exports = { generateTempPassword, hashPassword, nowSeconds, resetPassword };
