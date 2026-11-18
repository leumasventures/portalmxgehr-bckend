const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/assessmentController");
const R = require("../lib/roles");

module.exports = crudRouter(c, { read: R.CLINICAL, write: R.CLINICAL, remove: R.ADMIN });
