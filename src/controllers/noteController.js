const { z } = require("zod");
const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { createCrud } = require("../lib/crud");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

// status/signedAt are intentionally not accepted from clients; use POST /:id/sign.
const schema = z.object({
  patientId: s.str,
  encounterId: s.optStr,
  type: s.optStr, // e.g. PROGRESS, SOAP, PHONE, ADDENDUM
  title: s.str,
  content: s.str,
});

const include = { patient: patientBrief, author: userBrief };

const crud = createCrud({
  model: "note",
  entity: "Note",
  createSchema: schema,
  searchFields: ["title", "content", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "encounterId", "authorId", "status", "type"],
  include,
  defaults: (req) => ({ authorId: req.user.id }),
  // Signed notes are part of the legal record: no edits or deletes (write an addendum instead).
  guard: async (req, existing) => {
    if (existing.status === "SIGNED") {
      throw new HttpError(409, "Signed notes cannot be changed. Create an addendum instead.");
    }
  },
});

Object.assign(exports, crud);

exports.sign = async (req, res) => {
  const existing = await prisma.note.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, "Note not found");
  if (existing.status === "SIGNED") throw new HttpError(409, "Note is already signed");
  const item = await prisma.note.update({
    where: { id: existing.id },
    data: { status: "SIGNED", signedAt: new Date() },
    include,
  });
  await logAudit(req, "SIGN", "Note", item.id);
  res.json({ data: item });
};
