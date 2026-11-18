const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const db = require("./db");

const app = express();
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: config.cors.origin, // https://portal.maxgiohealth.com
    credentials: config.cors.credentials,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.global,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (req, res) => {
  const ok = await db.ping();
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "database unreachable" });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/patients", require("./routes/patients"));
app.use("/api/patients", require("./routes/portal")); // /api/patients/:id/portal-account
app.use("/api/appointments", require("./routes/appointments"));
app.use("/api/encounters", require("./routes/encounters"));
app.use("/api/audit", require("./routes/audit"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Express 5 forwards async errors here. Details are logged, never sent to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
  console.error(`${req.method} ${req.path}:`, err.code || "", err.message);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await db.connect();

  const purge = () =>
    db.query("DELETE FROM revoked_tokens WHERE expires_at < NOW()").catch((e) => console.error("purge failed:", e.message));
  purge();
  setInterval(purge, 60 * 60 * 1000).unref();

  const server = app.listen(config.port, () => console.log(`API listening on port ${config.port} (${config.nodeEnv})`));

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(() => process.exit(1));
