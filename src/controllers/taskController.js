const { z } = require("zod");
const HttpError = require("../lib/httpError");
const { createCrud } = require("../lib/crud");
const s = require("../lib/schemas");
const { patientBrief, userBrief } = require("../lib/selects");

const schema = z.object({
  title: s.str,
  description: s.optStr,
  assigneeId: s.optStr, // omit to assign to yourself, send null/"" to leave unassigned
  patientId: s.optStr,
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  dueDate: s.optDate,
});

module.exports = createCrud({
  model: "task",
  entity: "Task",
  createSchema: schema,
  searchFields: ["title", "description", "patient.lastName"],
  filterFields: ["status", "priority", "assigneeId", "patientId"],
  include: { assignee: userBrief, createdBy: userBrief, patient: patientBrief },
  orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  defaults: (req) => ({ createdById: req.user.id, assigneeId: req.user.id }),
  // ?mine=true limits the list to the signed-in user's tasks.
  extraWhere: (req) => (req.query.mine === "true" ? { assigneeId: req.user.id } : {}),
  // Only the creator, the assignee or an admin can delete a task.
  guard: async (req, existing, action) => {
    const me = req.user;
    if (action === "delete" && me.role !== "ADMIN" && existing.createdById !== me.id && existing.assigneeId !== me.id) {
      throw new HttpError(403, "Only the task's creator, assignee or an admin can delete it");
    }
  },
  beforeSave: async (req, data) => {
    if (data.status === "DONE") data.completedAt = new Date();
    else if (data.status) data.completedAt = null;
    return data;
  },
});
