const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  orderedById: s.str.optional(),
  testName: s.str,
  testCode: s.optStr,
  priority: s.optStr, // ROUTINE | URGENT | STAT
  status: z.enum(["ORDERED", "COLLECTED", "RESULTED", "CANCELLED"]).optional(),
  collectedAt: s.optDate,
  resultedAt: s.optDate,
  result: s.optStr,
  unit: s.optStr,
  referenceRange: s.optStr,
  abnormalFlag: s.optStr,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "lab",
  entity: "Lab",
  createSchema: schema,
  searchFields: ["testName", "testCode", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "status", "priority", "orderedById"],
  dateField: "orderedAt",
  include: { patient: patientBrief, orderedBy: userBrief },
  orderBy: { orderedAt: "desc" },
  defaults: (req) => ({ orderedById: req.user.id }),
  softDelete: { field: "status", value: "CANCELLED" },
  // Entering a result without a status marks the lab as resulted.
  beforeSave: async (req, data, existing) => {
    if (data.result && !data.status && existing?.status !== "RESULTED") {
      data.status = "RESULTED";
      data.resultedAt = data.resultedAt ?? new Date();
    }
    return data;
  },
});
