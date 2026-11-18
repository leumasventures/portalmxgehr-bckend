const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  name: s.str,
  dosage: s.optStr,
  route: s.optStr,
  frequency: s.optStr,
  startDate: s.optDate,
  endDate: s.optDate,
  status: z.enum(["ACTIVE", "ON_HOLD", "DISCONTINUED"]).optional(),
  reason: s.optStr,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "medication",
  entity: "Medication",
  createSchema: schema,
  searchFields: ["name", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "status"],
  include: { patient: patientBrief },
  orderBy: [{ status: "asc" }, { name: "asc" }],
  softDelete: { field: "status", value: "DISCONTINUED" },
});
