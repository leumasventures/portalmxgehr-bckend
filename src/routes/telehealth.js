const { crudRouter } = require("../lib/crudRouter");
const { authorize } = require("../middleware/auth");
const c = require("../controllers/telehealthController");
const R = require("../lib/roles");

module.exports = crudRouter(c, {
  read: R.CLINICAL_FRONT,
  write: R.CLINICAL_FRONT,
  remove: R.CLINICAL_FRONT, // cancels the session
  extra: (r) => {
    r.post("/:id/start", authorize(...R.CLINICAL), c.start);
    r.post("/:id/end", authorize(...R.CLINICAL), c.end);
  },
});
