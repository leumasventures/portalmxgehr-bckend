const { ZodError } = require("zod");
const HttpError = require("../lib/httpError");

function notFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

// Express 5 forwards rejected promises here, so controllers can simply throw.
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError || err.name === "ZodError") {
    return res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  // Prisma error codes
  if (err.code === "P2002") return res.status(409).json({ error: "A record with that value already exists" });
  if (err.code === "P2025") return res.status(404).json({ error: "Record not found" });
  if (err.code === "P2003") return res.status(400).json({ error: "A referenced record does not exist" });

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

module.exports = { notFound, errorHandler };
