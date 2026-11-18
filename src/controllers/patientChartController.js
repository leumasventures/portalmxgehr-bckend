const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { logAudit } = require("../lib/audit");
const { userBrief } = require("../lib/selects");

// One call that returns everything the Patient Chart page needs.
// Clinical sections are only included for clinical roles; billing only for billing roles.
exports.getChart = async (req, res) => {
  const patientId = req.params.patientId;
  const role = req.user.role;
  const clinical = ["ADMIN", "PROVIDER", "NURSE"].includes(role);
  const billing = ["ADMIN", "BILLING"].includes(role);

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { primaryProvider: userBrief },
  });
  if (!patient) throw new HttpError(404, "Patient not found");

  const now = new Date();
  const none = Promise.resolve([]);
  const byPatient = { patientId };
  const recent = (n) => ({ take: n, orderBy: { createdAt: "desc" } });

  const [
    upcoming,
    recentAppointments,
    documents,
    tasks,
    encounters,
    notes,
    medications,
    prescriptions,
    labs,
    diagnoses,
    assessments,
    treatmentPlans,
    referrals,
    invoices,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { ...byPatient, startsAt: { gte: now }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      orderBy: { startsAt: "asc" },
      take: 5,
      include: { provider: userBrief },
    }),
    prisma.appointment.findMany({
      where: { ...byPatient, startsAt: { lt: now } },
      orderBy: { startsAt: "desc" },
      take: 5,
      include: { provider: userBrief },
    }),
    prisma.document.findMany({ where: byPatient, ...recent(10) }),
    prisma.task.findMany({
      where: { ...byPatient, status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { dueDate: { sort: "asc", nulls: "last" } },
      take: 10,
    }),
    clinical
      ? prisma.encounter.findMany({ where: byPatient, orderBy: { startedAt: "desc" }, take: 10, include: { provider: userBrief } })
      : none,
    clinical
      ? prisma.note.findMany({ where: byPatient, ...recent(10), include: { author: userBrief } })
      : none,
    clinical
      ? prisma.medication.findMany({ where: { ...byPatient, status: "ACTIVE" }, orderBy: { name: "asc" } })
      : none,
    clinical
      ? prisma.prescription.findMany({ where: byPatient, orderBy: { prescribedAt: "desc" }, take: 10, include: { prescriber: userBrief } })
      : none,
    clinical
      ? prisma.lab.findMany({ where: byPatient, orderBy: { orderedAt: "desc" }, take: 10 })
      : none,
    clinical
      ? prisma.diagnosis.findMany({ where: { ...byPatient, status: "ACTIVE" }, orderBy: { createdAt: "desc" } })
      : none,
    clinical
      ? prisma.assessment.findMany({ where: byPatient, orderBy: { assessedAt: "desc" }, take: 10 })
      : none,
    clinical
      ? prisma.treatmentPlan.findMany({ where: { ...byPatient, status: "ACTIVE" }, orderBy: { createdAt: "desc" } })
      : none,
    clinical
      ? prisma.referral.findMany({ where: byPatient, orderBy: { referredAt: "desc" }, take: 10 })
      : none,
    billing
      ? prisma.invoice.findMany({ where: byPatient, orderBy: { issuedAt: "desc" }, take: 10 })
      : none,
  ]);

  await logAudit(req, "VIEW_CHART", "Patient", patientId);

  res.json({
    data: {
      patient,
      appointments: { upcoming, recent: recentAppointments },
      documents,
      tasks,
      encounters,
      notes,
      medications,
      prescriptions,
      labs,
      diagnoses,
      assessments,
      treatmentPlans,
      referrals,
      invoices,
    },
  });
};
