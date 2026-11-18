const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/prescriptionController");
const R = require("../lib/roles");

// Nurses can view prescriptions; only providers/admins can write or cancel them.
module.exports = crudRouter(c, { read: R.CLINICAL, write: R.PROVIDERS, remove: R.PROVIDERS });
