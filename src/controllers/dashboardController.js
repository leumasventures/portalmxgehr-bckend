const prisma = require("../lib/prisma");
const { patientBrief, userBrief } = require("../lib/selects");

exports.getDashboard = async (req, res) => {
  const me = req.user;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const live = { notIn: ["CANCELLED", "NO_SHOW"] };
  // Providers see their own schedule; everyone else sees the whole clinic.
  const scope = me.role === "PROVIDER" ? { providerId: me.id } : {};
  const canSeeBilling = ["ADMIN", "BILLING"].includes(me.role);
  const openTask = { assigneeId: me.id, status: { in: ["OPEN", "IN_PROGRESS"] } };

  const [
    activePatients,
    appointmentsToday,
    upcomingWeek,
    todaysAppointments,
    pendingLabs,
    unsignedNotes,
    openTasks,
    overdueTasks,
    unreadMessages,
    outstanding,
    recentPatients,
  ] = await Promise.all([
    prisma.patient.count({ where: { status: "ACTIVE" } }),
    prisma.appointment.count({ where: { ...scope, startsAt: { gte: start, lt: end }, status: live } }),
    prisma.appointment.count({ where: { ...scope, startsAt: { gte: end, lt: weekEnd }, status: live } }),
    prisma.appointment.findMany({
      where: { ...scope, startsAt: { gte: start, lt: end }, status: live },
      orderBy: { startsAt: "asc" },
      take: 25,
      include: { patient: patientBrief, provider: userBrief },
    }),
    prisma.lab.count({ where: { status: { in: ["ORDERED", "COLLECTED"] } } }),
    prisma.note.count({ where: { status: "DRAFT", ...(me.role === "PROVIDER" ? { authorId: me.id } : {}) } }),
    prisma.task.count({ where: openTask }),
    prisma.task.count({ where: { ...openTask, dueDate: { lt: new Date() } } }),
    prisma.message.count({ where: { recipientId: me.id, readAt: null } }),
    canSeeBilling
      ? prisma.invoice.aggregate({
          where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
          _sum: { amount: true, amountPaid: true },
        })
      : null,
    prisma.patient.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, mrn: true, firstName: true, lastName: true, createdAt: true },
    }),
  ]);

  res.json({
    data: {
      stats: {
        activePatients,
        appointmentsToday,
        upcomingWeek,
        pendingLabs,
        unsignedNotes,
        openTasks,
        overdueTasks,
        unreadMessages,
        outstandingBalance: outstanding
          ? Number(outstanding._sum.amount ?? 0) - Number(outstanding._sum.amountPaid ?? 0)
          : null,
      },
      todaysAppointments,
      recentPatients,
    },
  });
};
