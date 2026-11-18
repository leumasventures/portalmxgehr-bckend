const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const config = require("../config");
const db = require("../db");
const { audit } = require("../audit");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
const STAFF = ["admin", "provider", "staff"];

router.use(authenticate);

const toSql = (iso) => new Date(iso).toISOString().slice(0, 19).replace("T", " "); // UTC DATETIME
const isoDate = z.string().datetime({ offset: true });

const createSchema = z
  .object({
    patientId: z.string().uuid(),
    providerId: z.string().uuid(),
    startsAt: isoDate,
    endsAt: isoDate,
    type: z.enum(["in_person", "telehealth"]).default("in_person"),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] });

const updateSchema = z
  .object({
    status: z.enum(["scheduled", "checked_in", "completed", "cancelled", "no_show"]),
    reason: z.string().max(500).nullable(),
  })
  .partial()
  .strict();

function shape(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    providerId: r.provider_id,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    type: r.type,
    status: r.status,
    reason: r.reason,
    telehealthUrl:
      r.telehealth_room_id && config.telehealth.baseUrl ? `${config.telehealth.baseUrl}/${r.telehealth_room_id}` : null,
  };
}

async function ownPatientId(userId) {
  const p = await db.queryOne("SELECT id FROM patients WHERE user_id = ? AND is_active = 1", [userId]);
  return p?.id ?? null;
}

router.get("/", async (req, res) => {
  const where = [];
  const params = [];

  if (req.user.role === "patient") {
    const pid = await ownPatientId(req.user.id);
    if (!pid) return res.json({ data: [] });
    where.push("patient_id = ?");
    params.push(pid);
  } else {
    for (const [qs, col] of [["patientId", "patient_id"], ["providerId", "provider_id"], ["status", "status"]]) {
      if (req.query[qs]) {
        where.push(`${col} = ?`);
        params.push(String(req.query[qs]));
      }
    }
  }
  for (const [qs, op] of [["from", ">="], ["to", "<"]]) {
    if (req.query[qs]) {
      const d = new Date(String(req.query[qs]));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `Invalid ${qs} date` });
      where.push(`starts_at ${op} ?`);
      params.push(toSql(d.toISOString()));
    }
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const rows = await db.query(
    `SELECT * FROM appointments ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY starts_at LIMIT ${limit}`,
    params
  );
  await audit(req, "appointment.list", "appointment", null, { count: rows.length });
  res.json({ data: rows.map(shape) });
});

router.post("/", requireRole(...STAFF), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid appointment", issues: parsed.error.issues });
  const d = parsed.data;

  const id = crypto.randomUUID();
  const room = d.type === "telehealth" ? crypto.randomBytes(16).toString("hex") : null;

  const outcome = await db.withTransaction(async (tx) => {
    const patient = await tx.query("SELECT id FROM patients WHERE id = ? AND is_active = 1", [d.patientId]);
    if (patient.length === 0) return { status: 400, error: "Patient not found" };
    const provider = await tx.query(
      "SELECT id FROM users WHERE id = ? AND is_active = 1 AND role IN ('provider','admin')",
      [d.providerId]
    );
    if (provider.length === 0) return { status: 400, error: "Provider not found" };

    // Lock the provider's overlapping slots so two requests can't double-book.
    const clash = await tx.query(
      `SELECT id FROM appointments
        WHERE provider_id = ? AND status IN ('scheduled','checked_in')
          AND starts_at < ? AND ends_at > ? FOR UPDATE`,
      [d.providerId, toSql(d.endsAt), toSql(d.startsAt)]
    );
    if (clash.length > 0) return { status: 409, error: "Provider already has an appointment in that time slot" };

    await tx.query(
      `INSERT INTO appointments (id, patient_id, provider_id, starts_at, ends_at, type, reason, telehealth_room_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.patientId, d.providerId, toSql(d.startsAt), toSql(d.endsAt), d.type, d.reason ?? null, room, req.user.id]
    );
    return { status: 201 };
  });

  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  await audit(req, "appointment.create", "appointment", id, { patientId: d.patientId });
  res.status(201).json(shape(await db.queryOne("SELECT * FROM appointments WHERE id = ?", [id])));
});

// Status / reason only. To reschedule: cancel and book a new slot (keeps the conflict check in one place).
router.patch("/:id", requireRole(...STAFF), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update", issues: parsed.error.issues });
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) return res.status(400).json({ error: "Nothing to update" });

  const result = await db.query(
    `UPDATE appointments SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...entries.map(([, v]) => v), req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: "Appointment not found" });
  await audit(req, "appointment.update", "appointment", req.params.id, { fields: entries.map(([k]) => k) });
  res.json(shape(await db.queryOne("SELECT * FROM appointments WHERE id = ?", [req.params.id])));
});

module.exports = router;
