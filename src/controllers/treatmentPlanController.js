const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  providerId: s.str.optional(),
  title: s.str,
  goals: s.optStr,
  interventions: s.optStr,
  status: z.enum(["ACTIVE", "COMPLETED", "ON_HOLD", "DISCONTINUED"]).optional(),
  startDate: s.optDate,
  endDate: s.optDate,
  reviewDate: s.optDate,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "treatmentPlan",
  entity: "TreatmentPlan",
  createSchema: schema,
  searchFields: ["title", "goals", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "providerId", "status"],
  include: { patient: patientBrief, provider: userBrief },
  defaults: (req) => ({ providerId: req.user.id }),
  softDelete: { field: "status", value: "DISCONTINUED" },
});
