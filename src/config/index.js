// Single source of truth for settings. Loads .env, validates it once at startup,
// and exports typed values so no other file reads process.env directly.
// All application data (users, patients, appointments, sessions, audit logs...)
// lives in the MySQL database on Hostinger: u986504880_maxgioEHR_db.
require("dotenv").config();
const { z } = require("zod");

const boolFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // Set to 1 when running behind a proxy/load balancer (needed for correct client IPs / rate limiting).
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    // ---- Database (Hostinger MySQL) ----
    // Option A (recommended): individual fields. Safe for passwords with special characters.
    DB_HOST: z.string().default("auth-db1919.hstgr.io"), // Hostinger MySQL host
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_USER: z.string().default("u986504880_maxgioEHR_db"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().default("u986504880_maxgioEHR_db"),
    // Option B: a single URL, e.g. mysql://user:pass@host:3306/u986504880_maxgioEHR_db
    // (special characters in the password must be URL-encoded). Overrides option A if set.
    DATABASE_URL: z.string().default(""),

    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    DB_SSL: boolFromString.default("false"),
    DB_TIMEZONE: z.string().default("Z"), // store/read everything as UTC

    // ---- Auth ----
    JWT_SECRET: z.string().min(32, "2d9b5b42de550f1e459c78b5f6889002f242d66c9d8740a92fc4a955323d037b"),
    JWT_EXPIRES_IN: z.string().default("8h"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    // Comma-separated list of allowed frontend origins.
    CORS_ORIGIN: z.string().default("https://portal.maxgiohealth.com"),

    // ---- Rate limiting ----
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600), // requests per 15 min per IP
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10), // failed logins per 15 min per IP

    // Base URL of your video provider; rooms become <base>/<roomId>. Empty = no link generated.
    TELEHEALTH_BASE_URL: z.string().default(""),
  })
  .superRefine((env, ctx) => {
    const hasUrl = env.DATABASE_URL !== "";
    const hasFields = env.DB_HOST && env.DB_USER && env.DB_PASSWORD;
    if (!hasUrl && !hasFields) {
      ctx.addIssue({
        code: "custom",
        path: ["DB_HOST"],
        message: "Set DATABASE_URL, or DB_HOST + DB_USER + DB_PASSWORD (+ DB_NAME)",
      });
    }
    // No local connections anywhere: the app talks only to the hosted database
    // and accepts requests only from the hosted portal.
    const isLocal = (v) => /(^|[/@])(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)(?=[:/]|$)/i.test(v);
    if (isLocal(env.DB_HOST) || isLocal(env.DATABASE_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["DB_HOST"],
        message: "Database host must be the Hostinger MySQL host, not localhost",
      });
    }
    if (isLocal(env.CORS_ORIGIN)) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGIN"],
        message: "CORS_ORIGIN must be the hosted portal URL, not localhost",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
const env = parsed.data;

// Build mysql2 pool options (works with mysql2 / mysql2/promise createPool).
function buildDbConfig() {
  const common = {
    waitForConnections: true,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    queueLimit: 0,
    connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
    timezone: env.DB_TIMEZONE,
    charset: "utf8mb4",
    dateStrings: false,
    decimalNumbers: true,
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  };

  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    return {
      ...common,
      host: url.hostname,
      port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || env.DB_NAME,
    };
  }

  return {
    ...common,
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };
}

module.exports = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,

  // Pass straight to mysql.createPool(config.db)
  db: buildDbConfig(),

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  cors: {
    // Browsers send Origin as scheme://host[:port] with no path or trailing slash,
    // so normalize entries like "https://portal.example.com/" to match exactly.
    origin: env.CORS_ORIGIN.split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    credentials: true,
  },

  bcryptRounds: env.BCRYPT_ROUNDS,

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    global: env.RATE_LIMIT_MAX,
    login: env.LOGIN_RATE_LIMIT_MAX,
  },

  telehealth: {
    baseUrl: env.TELEHEALTH_BASE_URL.replace(/\/$/, ""),
  },
};
