const { crudRouter } = require("../lib/crudRouter");
const { authorize } = require("../middleware/auth");
const c = require("../controllers/noteController");
const R = require("../lib/roles");

// Drafts can be edited/deleted; POST /:id/sign locks a note (providers only).
module.exports = crudRouter(c, {
  read: R.CLINICAL,
  write: R.CLINICAL,
  remove: R.PROVIDERS,
  extra: (r) => r.post("/:id/sign", authorize(...R.PROVIDERS), c.sign),
});
