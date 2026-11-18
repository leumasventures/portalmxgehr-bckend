const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  providerId: s.str.optional(),
  encounterId: s.optStr,
  icd10Code: s.str,
  description: s.str,
  status: z.enum(["ACTIVE", "RESOLVED", "INACTIVE", "RULE_OUT"]).optional(),
  isPrimary: z.boolean().optional(),
  onsetDate: s.optDate,
  resolvedDate: s.optDate,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "diagnosis",
  entity: "Diagnosis",
  createSchema: schema,
  searchFields: ["icd10Code", "description", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "providerId", "encounterId", "status"],
  include: { patient: patientBrief, provider: userBrief },
  defaults: (req) => ({ providerId: req.user.id }),
  softDelete: { field: "status", value: "INACTIVE" },
});
