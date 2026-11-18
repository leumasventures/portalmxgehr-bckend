const prisma = require("../lib/prisma");
const { parseDate } = require("../lib/crud");
const { patientBrief, userBrief } = require("../lib/selects");

// GET /api/calendar?start=<iso>&end=<iso>&providerId=<id>
// Returns appointments as flat calendar events. Defaults to the current month.
exports.getEvents = async (req, res) => {
  const now = new Date();
  const start = req.query.start
    ? parseDate(req.query.start, "start")
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = req.query.end
    ? parseDate(req.query.end, "end")
    : new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const appointments = await prisma.appointment.findMany({
    where: {
      startsAt: { gte: start, lt: end },
      ...(typeof req.query.providerId === "string" && req.query.providerId
        ? { providerId: req.query.providerId }
        : {}),
    },
    orderBy: { startsAt: "asc" },
    take: 1000,
    include: { patient: patientBrief, provider: userBrief },
  });

  const events = appointments.map((a) => ({
    id: a.id,
    title: `${a.patient.firstName} ${a.patient.lastName}`,
    start: a.startsAt,
    end: a.endsAt,
    status: a.status,
    type: a.type,
    reason: a.reason,
    isTelehealth: a.isTelehealth,
    patientId: a.patientId,
    providerId: a.providerId,
    provider: a.provider,
  }));

  res.json({ data: events, meta: { start, end, count: events.length } });
};
