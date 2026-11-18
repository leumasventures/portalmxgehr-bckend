const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { createCrud } = require("../lib/crud");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  providerId: s.str.optional(),
  appointmentId: s.optStr,
  scheduledAt: s.date,
  status: z.enum(["SCHEDULED", "WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  notes: s.optStr,
});

const include = { patient: patientBrief, provider: userBrief };

const crud = createCrud({
  model: "telehealthSession",
  entity: "TelehealthSession",
  createSchema: schema,
  searchFields: ["patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "providerId", "status"],
  dateField: "scheduledAt",
  include,
  orderBy: { scheduledAt: "desc" },
  defaults: (req) => {
    // The room link points at your video provider (Twilio, Daily, Zoom, Jitsi...).
    const roomId = crypto.randomUUID();
    const base = process.env.TELEHEALTH_BASE_URL;
    return { providerId: req.user.id, roomId, roomUrl: base ? `${base.replace(/\/$/, "")}/${roomId}` : null };
  },
  softDelete: { field: "status", value: "CANCELLED" },
});

Object.assign(exports, crud);

const transition = (action, data, blockedFrom) => async (req, res) => {
  const existing = await prisma.telehealthSession.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, "Session not found");
  if (blockedFrom.includes(existing.status)) {
    throw new HttpError(409, `A ${existing.status.toLowerCase()} session cannot be changed this way`);
  }
  const item = await prisma.telehealthSession.update({
    where: { id: existing.id },
    data: typeof data === "function" ? data(existing) : data,
    include,
  });
  await logAudit(req, action, "TelehealthSession", item.id);
  res.json({ data: item });
};

exports.start = transition("START", () => ({ status: "IN_PROGRESS", startedAt: new Date() }), ["COMPLETED", "CANCELLED"]);
exports.end = transition("END", () => ({ status: "COMPLETED", endedAt: new Date() }), ["COMPLETED", "CANCELLED"]);
