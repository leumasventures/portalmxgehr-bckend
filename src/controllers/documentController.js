const { z } = require("zod");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

// This stores document *metadata* and a URL. Actual file upload (multipart to disk or S3)
// needs multer or presigned URLs, which are not installed yet.
const schema = z.object({
  patientId: s.optStr,
  name: s.str,
  category: s.optStr, // e.g. LAB_REPORT, INSURANCE, CONSENT, IMAGING, OTHER
  mimeType: s.optStr,
  size: s.optInt,
  url: s.str,
  notes: s.optStr,
});

module.exports = createCrud({
  model: "document",
  entity: "Document",
  createSchema: schema,
  searchFields: ["name", "notes", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "category", "uploadedById"],
  include: { patient: patientBrief, uploadedBy: userBrief },
  defaults: (req) => ({ uploadedById: req.user.id }),
});
