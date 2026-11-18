const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  referringProviderId: s.str.optional(),
  specialty: s.str,
  referredTo: s.optStr,
  reason: s.str,
  priority: s.optStr, // ROUTINE | URGENT
  status: z.enum(["PENDING", "SENT", "SCHEDULED", "COMPLETED", "DECLINED", "CANCELLED"]).optional(),
  referredAt: s.dateMaybe,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "referral",
  entity: "Referral",
  createSchema: schema,
  searchFields: ["specialty", "referredTo", "reason", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "referringProviderId", "status", "priority", "specialty"],
  dateField: "referredAt",
  include: { patient: patientBrief, referringProvider: userBrief },
  orderBy: { referredAt: "desc" },
  defaults: (req) => ({ referringProviderId: req.user.id }),
  softDelete: { field: "status", value: "CANCELLED" },
});
