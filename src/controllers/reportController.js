const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { parseDate } = require("../lib/crud");

const DAY = 24 * 60 * 60 * 1000;

// ?from=&to= (ISO dates). Defaults to the last 30 days, capped at 366 days.
function getRange(req) {
  const to = req.query.to ? parseDate(req.query.to, "to") : new Date();
  const from = req.query.from ? parseDate(req.query.from, "from") : new Date(to.getTime() - 30 * DAY);
  if (from > to) throw new HttpError(400, "'from' must be before 'to'");
  if (to - from > 366 * DAY) throw new HttpError(400, "Date range cannot exceed 366 days");
  return { from, to };
}

const countMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key] ?? "UNSPECIFIED", r._count._all]));
const num = (v) => Number(v ?? 0);

exports.overview = async (req, res) => {
  const { from, to } = getRange(req);
  const inRange = { gte: from, lte: to };
  const canSeeMoney = ["ADMIN", "BILLING"].includes(req.user.role);

  const [appointments, newPatients, encounters, labs, prescriptions, collected] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: { startsAt: inRange }, _count: { _all: true } }),
    prisma.patient.count({ where: { createdAt: inRange } }),
    prisma.encounter.count({ where: { startedAt: inRange } }),
    prisma.lab.groupBy({ by: ["status"], where: { orderedAt: inRange }, _count: { _all: true } }),
    prisma.prescription.count({ where: { prescribedAt: inRange } }),
    canSeeMoney ? prisma.payment.aggregate({ where: { paidAt: inRange }, _sum: { amount: true } }) : null,
  ]);

  const byStatus = countMap(appointments, "status");
  res.json({
    data: {
      range: { from, to },
      appointments: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      newPatients,
      encounters,
      labs: countMap(labs, "status"),
      prescriptions,
      collected: collected ? num(collected._sum.amount) : null,
    },
  });
};

exports.appointments = async (req, res) => {
  const { from, to } = getRange(req);
  const where = { startsAt: { gte: from, lte: to } };

  const [byStatus, byType, byProvider, days] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["type"], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["providerId"], where, _count: { _all: true } }),
    prisma.appointment.findMany({ where, select: { startsAt: true } }),
  ]);

  const providers = await prisma.user.findMany({
    where: { id: { in: byProvider.map((p) => p.providerId) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameOf = Object.fromEntries(providers.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

  // Bucketed by UTC calendar day.
  const perDay = {};
  for (const { startsAt } of days) {
    const key = startsAt.toISOString().slice(0, 10);
    perDay[key] = (perDay[key] ?? 0) + 1;
  }

  res.json({
    data: {
      range: { from, to },
      byStatus: countMap(byStatus, "status"),
      byType: countMap(byType, "type"),
      byProvider: byProvider.map((p) => ({
        providerId: p.providerId,
        provider: nameOf[p.providerId] ?? "Unknown",
        count: p._count._all,
      })),
      byDay: Object.entries(perDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    },
  });
};

exports.financial = async (req, res) => {
  const { from, to } = getRange(req);
  const inRange = { gte: from, lte: to };

  const [invoiced, collected, outstanding, claims] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: { not: "VOID" }, issuedAt: inRange },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({ where: { paidAt: inRange }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      _sum: { amount: true, amountPaid: true },
    }),
    prisma.claim.groupBy({
      by: ["status"],
      where: { createdAt: inRange },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  res.json({
    data: {
      range: { from, to },
      invoiced: { count: invoiced._count._all, total: num(invoiced._sum.amount) },
      collected: { count: collected._count._all, total: num(collected._sum.amount) },
      outstandingBalance: num(outstanding._sum.amount) - num(outstanding._sum.amountPaid),
      claims: Object.fromEntries(claims.map((c) => [c.status, { count: c._count._all, amount: num(c._sum.amount) }])),
    },
  });
};

exports.patients = async (req, res) => {
  const { from, to } = getRange(req);

  const [total, newPatients, byStatus, bySex] = await Promise.all([
    prisma.patient.count({ where: { status: "ACTIVE" } }),
    prisma.patient.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.patient.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["sex"], where: { status: "ACTIVE" }, _count: { _all: true } }),
  ]);

  res.json({
    data: { range: { from, to }, activePatients: total, newPatients, byStatus: countMap(byStatus, "status"), bySex: countMap(bySex, "sex") },
  });
};
