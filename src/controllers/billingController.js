const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { createCrud } = require("../lib/crud");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { patientBrief } = require("../lib/selects");

const round2 = (n) => Math.round(n * 100) / 100;

// amountPaid and status "PAID"/"PARTIAL" are managed by recording payments, not set directly.
const schema = z.object({
  patientId: s.str,
  encounterId: s.optStr,
  amount: s.money,
  status: z.enum(["DRAFT", "PENDING", "OVERDUE", "VOID"]).optional(),
  issuedAt: s.dateMaybe,
  dueDate: s.optDate,
  lineItems: z.array(z.record(z.string(), z.any())).optional(),
  notes: s.optStr,
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  method: s.str, // CARD, CASH, CHECK, INSURANCE, ...
  reference: s.optStr,
  paidAt: s.dateMaybe,
});

const crud = createCrud({
  model: "invoice",
  entity: "Invoice",
  createSchema: schema,
  searchFields: ["invoiceNumber", "patient.firstName", "patient.lastName", "patient.mrn"],
  filterFields: ["patientId", "status", "encounterId"],
  dateField: "issuedAt",
  include: { patient: patientBrief, payments: { orderBy: { paidAt: "desc" } } },
  orderBy: { issuedAt: "desc" },
  defaults: () => ({ invoiceNumber: `INV-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}` }),
  guard: async (req, existing, action) => {
    if (action === "delete" && existing.status !== "DRAFT") {
      throw new HttpError(409, "Only draft invoices can be deleted. Void the invoice instead.");
    }
  },
});

Object.assign(exports, crud);

exports.addPayment = async (req, res) => {
  const body = paymentSchema.parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (invoice.status === "VOID") throw new HttpError(409, "Cannot take payment on a void invoice");

    const total = Number(invoice.amount);
    const paid = round2(Number(invoice.amountPaid) + body.amount);
    if (paid > total) throw new HttpError(400, "Payment exceeds the remaining balance");

    const payment = await tx.payment.create({ data: { ...body, invoiceId: invoice.id } });
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: paid, status: paid >= total ? "PAID" : "PARTIAL" },
    });
    return { payment, invoice: updated };
  });

  await logAudit(req, "PAYMENT", "Invoice", req.params.id, { amount: body.amount, method: body.method });
  res.status(201).json({ data: result });
};

// GET /billing/summary: totals for the top of the Billing page.
exports.summary = async (req, res) => {
  const rows = await prisma.invoice.groupBy({
    by: ["status"],
    where: { status: { not: "VOID" } },
    _count: { _all: true },
    _sum: { amount: true, amountPaid: true },
  });

  const byStatus = {};
  let billed = 0;
  let collected = 0;
  for (const r of rows) {
    const amount = Number(r._sum.amount ?? 0);
    const paid = Number(r._sum.amountPaid ?? 0);
    byStatus[r.status] = { count: r._count._all, amount, paid };
    billed += amount;
    collected += paid;
  }
  res.json({ data: { billed, collected, outstanding: round2(billed - collected), byStatus } });
};
