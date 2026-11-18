const prisma = require("./prisma");

// Records who did what to which record. Never blocks the request if logging fails.
async function logAudit(req, action, entity, entityId, metadata) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        ip: req.ip,
        metadata: metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}

module.exports = { logAudit };
