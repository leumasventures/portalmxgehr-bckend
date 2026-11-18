const crypto = require("crypto");
const { z } = require("zod");
const HttpError = require("../lib/httpError");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief } = require("../lib/selects");

const schema = z.object({
  patientId: s.str,
  invoiceId: s.optStr,
  payer: s.str,
  amount: s.money,
  status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "PAID", "DENIED", "APPEALED"]).optional(),
  cptCodes: z.array(z.string().trim().min(1)).optional(),
  icd10Codes: z.array(z.string().trim().min(1)).optional(),
  denialReason: s.optStr,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "claim",
  entity: "Claim",
  createSchema: schema,
  searchFields: ["claimNumber", "payer", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "invoiceId", "status", "payer"],
  include: { patient: patientBrief, invoice: { select: { id: true, invoiceNumber: true } } },
  defaults: () => ({ claimNumber: `CLM-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}` }),
  guard: async (req, existing, action) => {
    if (action === "delete" && existing.status !== "DRAFT") {
      throw new HttpError(409, "Only draft claims can be deleted");
    }
  },
  // Stamp submission/payment dates when the status moves forward.
  beforeSave: async (req, data, existing) => {
    if (data.status === "SUBMITTED" && !existing?.submittedAt) data.submittedAt = new Date();
    if (data.status === "PAID" && !existing?.paidAt) data.paidAt = new Date();
    return data;
  },
});
