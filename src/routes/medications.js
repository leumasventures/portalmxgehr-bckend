const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/medicationController");
const R = require("../lib/roles");

// DELETE discontinues the medication.
module.exports = crudRouter(c, { read: R.CLINICAL, write: R.CLINICAL, remove: R.CLINICAL });
