const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { stripUndefined, toInt, parseDate } = require("../lib/crud");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { userSelect, userBrief } = require("../lib/selects");

const ROLES = ["ADMIN", "PROVIDER", "NURSE", "FRONT_DESK", "BILLING"];

const createSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters"),
  firstName: s.str,
  lastName: s.str,
  role: z.enum(ROLES).optional(),
  title: s.optStr,
  phone: s.optStr,
  npi: s.optStr,
  active: z.boolean().optional(),
});
const updateSchema = createSchema.partial(); // password here acts as an admin reset

exports.listUsers = async (req, res) => {
  const where = {};
  if (ROLES.includes(req.query.role)) where.role = req.query.role;
  if (req.query.active === "true") where.active = true;
  if (req.query.active === "false") where.active = false;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    where.OR = ["firstName", "lastName", "email"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } }));
  }

  const page = toInt(req.query.page, 1);
  const limit = Math.min(toInt(req.query.limit, 25), 100);
  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
};

exports.getUser = async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ data: user });
};

exports.createUser = async (req, res) => {
  const { password, ...rest } = createSchema.parse(req.body);
  const user = await prisma.user.create({
    data: { ...stripUndefined(rest), passwordHash: await bcrypt.hash(password, 12) },
    select: userSelect,
  });
  await logAudit(req, "CREATE", "User", user.id, { role: user.role });
  res.status(201).json({ data: user });
};

exports.updateUser = async (req, res) => {
  const { password, ...rest } = updateSchema.parse(req.body);
  const data = stripUndefined(rest);

  if (req.params.id === req.user.id && (data.active === false || (data.role && data.role !== req.user.role))) {
    throw new HttpError(400, "You cannot deactivate or change the role of your own account");
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({ where: { id: req.params.id }, data, select: userSelect });
  await logAudit(req, "UPDATE", "User", user.id, { fields: Object.keys(data).filter((k) => k !== "passwordHash"), passwordReset: Boolean(password) });
  res.json({ data: user });
};

// Users are never hard-deleted (their records stay attributed). DELETE deactivates the account.
exports.deactivateUser = async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, "You cannot deactivate your own account");
  await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
  await logAudit(req, "DEACTIVATE", "User", req.params.id);
  res.status(204).end();
};

// GET /admin/audit-logs?userId=&entity=&action=&entityId=&from=&to=
exports.listAuditLogs = async (req, res) => {
  const where = {};
  for (const f of ["userId", "entity", "action", "entityId"]) {
    if (typeof req.query[f] === "string" && req.query[f]) where[f] = req.query[f];
  }
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = parseDate(req.query.from, "from");
    if (req.query.to) where.createdAt.lte = parseDate(req.query.to, "to");
  }

  const page = toInt(req.query.page, 1);
  const limit = Math.min(toInt(req.query.limit, 50), 200);
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: userBrief },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
};

exports.stats = async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [usersByRole, activeUsers, patients, auditEvents24h, failedLogins24h] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.patient.count(),
    prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "LOGIN_FAILED", createdAt: { gte: since } } }),
  ]);
  res.json({
    data: {
      usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])),
      activeUsers,
      patients,
      auditEvents24h,
      failedLogins24h,
    },
  });
};
