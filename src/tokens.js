const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("./config");

const ISSUER = "maxgio-ehr";

function issueToken(user) {
  return jwt.sign({ role: user.role }, config.jwt.secret, {
    algorithm: "HS256",
    issuer: ISSUER,
    subject: user.id,
    jwtid: crypto.randomUUID(),
    expiresIn: config.jwt.expiresIn,
  });
}

module.exports = { issueToken, ISSUER };
