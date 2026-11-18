const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/labController");
const R = require("../lib/roles");

// DELETE cancels the lab order. PATCH with a "result" marks it RESULTED.
module.exports = crudRouter(c, { read: R.CLINICAL, write: R.CLINICAL, remove: R.PROVIDERS });
