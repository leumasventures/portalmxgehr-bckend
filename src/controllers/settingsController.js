const { z } = require("zod");
const prisma = require("../lib/prisma");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { userSelect } = require("../lib/selects");

const profileSchema = z.object({
  firstName: s.str.optional(),
  lastName: s.str.optional(),
  title: s.optStr,
  phone: s.optStr,
});

const preferencesSchema = z.record(z.string(), z.any());
const clinicSchema = z.record(z.string(), z.any());

// Profile plus saved UI preferences (theme, default calendar view, etc.).
exports.getMine = async (req, res) => {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user.id }, select: userSelect }),
    prisma.userSetting.findUnique({ where: { userId: req.user.id } }),
  ]);
  res.json({ data: { profile: user, preferences: settings?.preferences ?? {} } });
};

exports.updateProfile = async (req, res) => {
  const data = Object.fromEntries(Object.entries(profileSchema.parse(req.body)).filter(([, v]) => v !== undefined));
  const user = await prisma.user.update({ where: { id: req.user.id }, data, select: userSelect });
  await logAudit(req, "UPDATE", "User", req.user.id, { fields: Object.keys(data) });
  res.json({ data: user });
};

// Replaces the user's preference object.
exports.updatePreferences = async (req, res) => {
  const preferences = preferencesSchema.parse(req.body);
  const saved = await prisma.userSetting.upsert({
    where: { userId: req.user.id },
    update: { preferences },
    create: { userId: req.user.id, preferences },
  });
  res.json({ data: saved.preferences });
};

// Clinic-wide settings (name, hours, default appointment length...) stored as key/value pairs.
exports.getClinic = async (req, res) => {
  const rows = await prisma.clinicSetting.findMany();
  res.json({ data: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
};

// Admin only. A null value removes that key.
exports.updateClinic = async (req, res) => {
  const body = clinicSchema.parse(req.body);
  const ops = Object.entries(body).map(([key, value]) =>
    value === null
      ? prisma.clinicSetting.deleteMany({ where: { key } })
      : prisma.clinicSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  );
  await prisma.$transaction(ops);
  await logAudit(req, "UPDATE", "ClinicSetting", null, { keys: Object.keys(body) });
  const rows = await prisma.clinicSetting.findMany();
  res.json({ data: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
};
