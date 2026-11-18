const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  prescriberId: s.str.optional(), // defaults to the signed-in provider
  medicationName: s.str,
  dosage: s.str,
  route: s.optStr,
  frequency: s.str,
  quantity: s.optInt,
  refills: s.intMaybe,
  instructions: s.optStr,
  pharmacy: s.optStr,
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"]).optional(),
  prescribedAt: s.dateMaybe,
});

module.exports = createCrud({
  model: "prescription",
  entity: "Prescription",
  createSchema: schema,
  searchFields: ["medicationName", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "prescriberId", "status"],
  dateField: "prescribedAt",
  include: { patient: patientBrief, prescriber: userBrief },
  orderBy: { prescribedAt: "desc" },
  defaults: (req) => ({ prescriberId: req.user.id }),
  softDelete: { field: "status", value: "CANCELLED" },
});
