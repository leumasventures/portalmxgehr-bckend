// Field-level encryption (AES-256-GCM) for sensitive patient data.
// Stored format: base64( iv(12) | authTag(16) | ciphertext ).
const crypto = require("crypto");
const config = require("./config");

const key = Buffer.from(config.encryptionKey, "base64");

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

function decrypt(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
