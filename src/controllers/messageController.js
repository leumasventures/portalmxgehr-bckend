const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const HttpError = require("../lib/httpError");
const { toInt } = require("../lib/crud");
const { logAudit } = require("../lib/audit");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const include = { sender: userBrief, recipient: userBrief, patient: patientBrief };

const sendSchema = z.object({
  recipientId: s.str,
  subject: s.str,
  body: s.str,
  patientId: s.optStr, // attach the message to a patient chart
  threadId: s.optStr, // pass the original message's threadId when replying
});

// Users may only see messages they sent or received.
async function loadOwn(req) {
  const message = await prisma.message.findUnique({ where: { id: req.params.id }, include });
  const me = req.user.id;
  if (!message || (message.senderId !== me && message.recipientId !== me)) {
    throw new HttpError(404, "Message not found");
  }
  return message;
}

// GET /messages?box=inbox|sent&unread=true&q=
exports.list = async (req, res) => {
  const me = req.user.id;
  const box = req.query.box === "sent" ? "sent" : "inbox";
  const where = box === "sent" ? { senderId: me } : { recipientId: me };
  if (req.query.unread === "true") where.readAt = null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
    ];
  }

  const page = toInt(req.query.page, 1);
  const limit = Math.min(toInt(req.query.limit, 25), 100);
  const [data, total] = await Promise.all([
    prisma.message.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.message.count({ where }),
  ]);
  res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit), box } });
};

exports.send = async (req, res) => {
  const body = sendSchema.parse(req.body);
  if (body.recipientId === req.user.id) throw new HttpError(400, "You cannot message yourself");

  const recipient = await prisma.user.findUnique({ where: { id: body.recipientId }, select: { active: true } });
  if (!recipient || !recipient.active) throw new HttpError(400, "Recipient not found");

  const id = crypto.randomUUID();
  const message = await prisma.message.create({
    data: { ...body, id, threadId: body.threadId ?? id, senderId: req.user.id },
    include,
  });
  await logAudit(req, "SEND", "Message", message.id);
  res.status(201).json({ data: message });
};

// Opening a message addressed to you marks it read.
exports.get = async (req, res) => {
  const message = await loadOwn(req);
  if (message.recipientId === req.user.id && !message.readAt) {
    message.readAt = (await prisma.message.update({ where: { id: message.id }, data: { readAt: new Date() } })).readAt;
  }
  await logAudit(req, "READ", "Message", message.id);
  res.json({ data: message });
};

exports.thread = async (req, res) => {
  const message = await loadOwn(req);
  const me = req.user.id;
  const where = { threadId: message.threadId, OR: [{ senderId: me }, { recipientId: me }] };
  await prisma.message.updateMany({ where: { ...where, recipientId: me, readAt: null }, data: { readAt: new Date() } });
  const data = await prisma.message.findMany({ where, include, orderBy: { createdAt: "asc" } });
  res.json({ data });
};

exports.markRead = async (req, res) => {
  const message = await loadOwn(req);
  if (message.recipientId !== req.user.id) throw new HttpError(403, "Only the recipient can mark a message read");
  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { readAt: message.readAt ?? new Date() },
    include,
  });
  res.json({ data: updated });
};

exports.unreadCount = async (req, res) => {
  const count = await prisma.message.count({ where: { recipientId: req.user.id, readAt: null } });
  res.json({ data: { count } });
};

// People you can address a message to.
exports.recipients = async (req, res) => {
  const data = await prisma.user.findMany({
    where: { active: true, id: { not: req.user.id } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, title: true, role: true },
  });
  res.json({ data });
};
