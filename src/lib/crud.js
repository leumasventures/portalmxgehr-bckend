const prisma = require("./prisma");
const HttpError = require("./httpError");
const { logAudit } = require("./audit");

const stripUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function parseDate(value, name) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid ${name} date`);
  return d;
}

// "patient.lastName" -> { patient: { lastName: leaf } }
const nest = (path, leaf) => path.split(".").reverse().reduce((acc, key) => ({ [key]: acc }), leaf);

/**
 * Builds list/get/create/update/remove handlers for one Prisma model.
 *
 * Options:
 *  model, entity          Prisma delegate name and audit label
 *  createSchema           zod schema (updateSchema defaults to createSchema.partial())
 *  searchFields           fields matched by ?q= (dotted paths reach into relations)
 *  filterFields           fields filterable by exact ?field=value
 *  dateField              field filtered by ?from= and ?to=
 *  include, orderBy       passed straight to Prisma
 *  defaults(req)          values filled in on create when the client omits them
 *  extraWhere(req)        extra Prisma where clause for list
 *  beforeSave(req, data, existing)  may throw or return adjusted data
 *  guard(req, existing, action)     may throw to block update/delete
 *  softDelete {field,value}         DELETE sets a status instead of removing the row
 */
function createCrud(opts) {
  const {
    model,
    entity = model.charAt(0).toUpperCase() + model.slice(1),
    createSchema,
    updateSchema = createSchema.partial(),
    searchFields = [],
    filterFields = [],
    dateField,
    include,
    orderBy = { createdAt: "desc" },
    defaults,
    extraWhere,
    beforeSave,
    guard,
    softDelete,
  } = opts;

  const db = () => prisma[model];

  const findOrThrow = async (id) => {
    const item = await db().findUnique({ where: { id } });
    if (!item) throw new HttpError(404, `${entity} not found`);
    return item;
  };

  const buildWhere = (req) => {
    const where = {};
    for (const field of filterFields) {
      const v = req.query[field];
      if (typeof v === "string" && v !== "") where[field] = v;
    }
    if (dateField && (req.query.from || req.query.to)) {
      where[dateField] = {};
      if (req.query.from) where[dateField].gte = parseDate(req.query.from, "from");
      if (req.query.to) where[dateField].lte = parseDate(req.query.to, "to");
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q && searchFields.length) {
      where.OR = searchFields.map((f) => nest(f, { contains: q, mode: "insensitive" }));
    }
    return extraWhere ? { AND: [where, extraWhere(req)] } : where;
  };

  const list = async (req, res) => {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 25), 100);
    const where = buildWhere(req);
    const [data, total] = await Promise.all([
      db().findMany({ where, include, orderBy, skip: (page - 1) * limit, take: limit }),
      db().count({ where }),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  };

  const get = async (req, res) => {
    const item = await db().findUnique({ where: { id: req.params.id }, include });
    if (!item) throw new HttpError(404, `${entity} not found`);
    await logAudit(req, "READ", entity, item.id);
    res.json({ data: item });
  };

  const create = async (req, res) => {
    let data = stripUndefined(createSchema.parse(req.body));
    if (defaults) data = { ...defaults(req), ...data };
    if (beforeSave) data = (await beforeSave(req, data, null)) ?? data;
    const item = await db().create({ data, include });
    await logAudit(req, "CREATE", entity, item.id);
    res.status(201).json({ data: item });
  };

  const update = async (req, res) => {
    const { id } = req.params;
    let data = stripUndefined(updateSchema.parse(req.body));
    let existing = null;
    if (guard || beforeSave) {
      existing = await findOrThrow(id);
      if (guard) await guard(req, existing, "update");
      if (beforeSave) data = (await beforeSave(req, data, existing)) ?? data;
    }
    const item = await db().update({ where: { id }, data, include });
    await logAudit(req, "UPDATE", entity, id, { fields: Object.keys(data) });
    res.json({ data: item });
  };

  const remove = async (req, res) => {
    const { id } = req.params;
    if (guard) await guard(req, await findOrThrow(id), "delete");
    if (softDelete) {
      await db().update({ where: { id }, data: { [softDelete.field]: softDelete.value } });
    } else {
      await db().delete({ where: { id } });
    }
    await logAudit(req, softDelete ? "ARCHIVE" : "DELETE", entity, id);
    res.status(204).end();
  };

  return { list, get, create, update, remove };
}

module.exports = { createCrud, stripUndefined, toInt, parseDate };
