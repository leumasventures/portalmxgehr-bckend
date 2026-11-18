const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/documentController");
const R = require("../lib/roles");

module.exports = crudRouter(c, { read: R.ANY, write: R.CLINICAL_FRONT, remove: R.ADMIN });
