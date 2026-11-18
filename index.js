// Loads and validates .env first; the process exits here if anything required is missing.
const config = require("./src/config");

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const routes = require("./src/routes");
const { notFound, errorHandler } = require("./src/middleware/errorHandler");

const app = express();

app.use(helmet());
app.use(cors(config.cors));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.global }));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
