const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/diagnosisController");
const R = require("../lib/roles");

module.exports = crudRouter(c, { read: R.CLINICAL, write: R.PROVIDERS, remove: R.PROVIDERS });
