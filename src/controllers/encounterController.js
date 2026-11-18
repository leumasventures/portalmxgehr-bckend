// Clinical notes. The note body is encrypted at rest.
const crypto = require("crypto");
const { z } = require("zod");
const db = require("../db");
const { encrypt, decrypt } = require("../crypto");
const { audit } = require("../audit");
const { toSql, ownPatientId, paging } = require("../utils");

const isoDate = z.string().datetime({ offset: true });

const createSchema = z
  .object({
    patientId: z.string().uuid(),
    appointmentId: z.string().uuid().nullable().optional(),
    encounterAt: isoDate,
    summary: z.string().trim().max(500).nullable().optional(),
    note: z.string().max(100000).nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    encounterAt: isoDate,
    summary: z.string().trim().max(500).nullable(),
    note: z.string().max(100000).nullable(),
  })
  .partial()
  .strict();

const SELECT = `SELECT e.*, u.first_name AS provider_first, u.last_name AS provider_last
                  FROM encounters e JOIN users u ON u.id = e.provider_id`;

const summary = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  providerId: r.provider_id,
  providerName: `${r.provider_first} ${r.provider_last}`,
  appointmentId: r.appointment_id,
  encounterAt: new Date(r.encounter_at).toISOString(),
  summary: r.summary,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const detail = (r) => ({ ...summary(r), note: decrypt(r.note_enc) });

// Admin/provider pass a patientId; a patient is always pinned to their own record.
async function list(req, res) {
  let patientId = req.query.patientId ? String(req.query.patientId) : null;
  if (req.user.role === "patient") {
    patientId = await ownPatientId(req.user.id);
    if (!patientId) return res.json({ data: [] });
  } else if (!patientId) {
    return res.status(400).json({ error: "patientId is required" });
  }
  const { limit, offset } = paging(req, { limit: 50, max: 200 });
  const rows = await db.query(
    `${SELECT} WHERE e.patient_id = ? ORDER BY e.encounter_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [patientId]
  );
  await audit(req, "encounter.list", "patient", patientId, { count: rows.length });
  res.json({ data: rows.map(summary), limit, offset }); // summaries only; open one to read the note
}

async function get(req, res) {
  const row = await db.queryOne(`${SELECT} WHERE e.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Encounter not found" });
  if (req.user.role === "patient" && row.patient_id !== (await ownPatientId(req.user.id))) {
    return res.status(404).json({ error: "Encounter not found" }); // don't reveal that it exists
  }
  await audit(req, "encounter.read", "encounter", row.id, { patientId: row.patient_id });
  res.json(detail(row));
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid encounter", issues: parsed.error.issues });
  const d = parsed.data;

  const patient = await db.queryOne("SELECT id FROM patients WHERE id = ? AND is_active = 1", [d.patientId]);
  if (!patient) return res.status(400).json({ error: "Patient not found" });
  if (d.appointmentId) {
    const appt = await db.queryOne("SELECT id FROM appointments WHERE id = ? AND patient_id = ?", [d.appointmentId, d.patientId]);
    if (!appt) return res.status(400).json({ error: "Appointment not found for this patient" });
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO encounters (id, patient_id, provider_id, appointment_id, encounter_at, summary, note_enc)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, d.patientId, req.user.id, d.appointmentId ?? null, toSql(d.encounterAt), d.summary ?? null, encrypt(d.note)]
  );
  await audit(req, "encounter.create", "encounter", id, { patientId: d.patientId });
  res.status(201).json(detail(await db.queryOne(`${SELECT} WHERE e.id = ?`, [id])));
}

async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update", issues: parsed.error.issues });
  const d = parsed.data;
  if (Object.keys(d).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const existing = await db.queryOne("SELECT id, provider_id FROM encounters WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Encounter not found" });
  if (existing.provider_id !== req.user.id) return res.status(403).json({ error: "Only the author can edit this note" });

  const sets = [];
  const vals = [];
  if (d.encounterAt !== undefined) (sets.push("encounter_at = ?"), vals.push(toSql(d.encounterAt)));
  if (d.summary !== undefined) (sets.push("summary = ?"), vals.push(d.summary));
  if (d.note !== undefined) (sets.push("note_enc = ?"), vals.push(encrypt(d.note)));
  vals.push(existing.id);
  await db.query(`UPDATE encounters SET ${sets.join(", ")} WHERE id = ?`, vals);

  await audit(req, "encounter.update", "encounter", existing.id, { fields: Object.keys(d) });
  res.json(detail(await db.queryOne(`${SELECT} WHERE e.id = ?`, [existing.id])));
}

module.exports = { list, get, create, update };
