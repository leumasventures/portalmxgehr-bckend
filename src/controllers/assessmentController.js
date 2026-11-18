const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  assessorId: s.str.optional(),
  type: s.str, // e.g. PHQ-9, GAD-7, fall risk
  score: s.optInt,
  responses: s.optJson,
  interpretation: s.optStr,
  notes: s.optStr,
  assessedAt: s.dateMaybe,
});

module.exports = createCrud({
  model: "assessment",
  entity: "Assessment",
  createSchema: schema,
  searchFields: ["type", "interpretation", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "assessorId", "type"],
  dateField: "assessedAt",
  include: { patient: patientBrief, assessor: userBrief },
  orderBy: { assessedAt: "desc" },
  defaults: (req) => ({ assessorId: req.user.id }),
});
