const crypto = require("crypto");
const { z } = require("zod");
const db = require("../db");
const { encrypt, decrypt } = require("../crypto");
const { audit } = require("../audit");
const { escapeLike, paging } = require("../utils");

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const patientFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: dateStr,
  sex: z.enum(["female", "male", "other", "unknown"]),
  email: z.string().email().max(255).nullable(),
  phone: z.string().trim().max(40).nullable(),
  address: z.string().max(1000).nullable(),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/, "Invalid SSN").nullable(),
  allergies: z.string().max(5000).nullable(),
  medicalNotes: z.string().max(50000).nullable(),
  primaryProviderId: z.string().uuid().nullable(),
};
const createSchema = z
  .object(patientFields)
  .partial({ sex: true, email: true, phone: true, address: true, ssn: true, allergies: true, medicalNotes: true, primaryProviderId: true })
  .strict();
const updateSchema = z.object(patientFields).partial().strict();

// API field -> [column, optional transform applied before storing]
const COLUMNS = {
  firstName: ["first_name"],
  lastName: ["last_name"],
  dateOfBirth: ["date_of_birth"],
  sex: ["sex"],
  email: ["email"],
  phone: ["phone"],
  address: ["address_enc", encrypt],
  ssn: ["ssn_enc", (v) => encrypt(v && v.replace(/-/g, ""))],
  allergies: ["allergies_enc", encrypt],
  medicalNotes: ["medical_notes_enc", encrypt],
  primaryProviderId: ["primary_provider_id"],
};

const summary = (r) => ({
  id: r.id,
  mrn: r.mrn,
  firstName: r.first_name,
  lastName: r.last_name,
  dateOfBirth: r.date_of_birth instanceof Date ? r.date_of_birth.toISOString().slice(0, 10) : r.date_of_birth,
  sex: r.sex,
  email: r.email,
  phone: r.phone,
  isActive: !!r.is_active,
});

function detail(r) {
  const ssn = decrypt(r.ssn_enc);
  return {
    ...summary(r),
    address: decrypt(r.address_enc),
    ssnLast4: ssn ? ssn.slice(-4) : null, // the full SSN is never returned
    allergies: decrypt(r.allergies_enc),
    medicalNotes: decrypt(r.medical_notes_enc),
    primaryProviderId: r.primary_provider_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const badProvider = (res) => res.status(400).json({ error: "primaryProviderId does not exist" });

// A patient with a portal login can read only their own record.
async function getMine(req, res) {
  const row = await db.queryOne("SELECT * FROM patients WHERE user_id = ? AND is_active = 1", [req.user.id]);
  if (!row) return res.status(404).json({ error: "No patient record linked to this account" });
  await audit(req, "patient.read", "patient", row.id);
  res.json(detail(row));
}

async function list(req, res) {
  const q = String(req.query.q || "").trim();
  const { limit, offset } = paging(req, { limit: 25, max: 100 });

  let where = "is_active = 1";
  const params = [];
  if (q) {
    const like = `${escapeLike(q)}%`; // prefix search
    where += " AND (last_name LIKE ? OR first_name LIKE ? OR mrn LIKE ?)";
    params.push(like, like, like);
  }
  const rows = await db.query(
    `SELECT * FROM patients WHERE ${where} ORDER BY last_name, first_name LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  await audit(req, "patient.list", "patient", null, { count: rows.length, searched: !!q });
  res.json({ data: rows.map(summary), limit, offset });
}

async function get(req, res) {
  const row = await db.queryOne("SELECT * FROM patients WHERE id = ?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Patient not found" });
  await audit(req, "patient.read", "patient", row.id);
  res.json(detail(row));
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid patient data", issues: parsed.error.issues });

  const id = crypto.randomUUID();
  const cols = ["id", "mrn", "created_by"];
  const vals = [id, null, req.user.id];
  for (const [field, value] of Object.entries(parsed.data)) {
    const [col, transform] = COLUMNS[field];
    cols.push(col);
    vals.push(transform ? transform(value) : value);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    vals[1] = `MG-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    try {
      await db.query(`INSERT INTO patients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
      await audit(req, "patient.create", "patient", id);
      return res.status(201).json(detail(await db.queryOne("SELECT * FROM patients WHERE id = ?", [id])));
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY" && attempt < 2) continue; // MRN collision: retry with a new one
      if (err.code === "ER_NO_REFERENCED_ROW_2") return badProvider(res);
      throw err;
    }
  }
}

async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid patient data", issues: parsed.error.issues });
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) return res.status(400).json({ error: "Nothing to update" });

  const sets = [];
  const vals = [];
  for (const [field, value] of entries) {
    const [col, transform] = COLUMNS[field];
    sets.push(`${col} = ?`);
    vals.push(transform ? transform(value) : value);
  }
  vals.push(req.params.id);

  try {
    const result = await db.query(`UPDATE patients SET ${sets.join(", ")} WHERE id = ? AND is_active = 1`, vals);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Patient not found" });
  } catch (err) {
    if (err.code === "ER_NO_REFERENCED_ROW_2") return badProvider(res);
    throw err;
  }
  await audit(req, "patient.update", "patient", req.params.id, { fields: entries.map(([f]) => f) });
  res.json(detail(await db.queryOne("SELECT * FROM patients WHERE id = ?", [req.params.id])));
}

// Records are never hard-deleted; deactivating keeps the history intact.
async function deactivate(req, res) {
  const result = await db.query("UPDATE patients SET is_active = 0 WHERE id = ? AND is_active = 1", [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "Patient not found" });
  await audit(req, "patient.deactivate", "patient", req.params.id);
  res.json({ ok: true });
}

module.exports = { getMine, list, get, create, update, deactivate };
