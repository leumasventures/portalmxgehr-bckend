const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/referralController");
const R = require("../lib/roles");

module.exports = crudRouter(c, { read: R.CLINICAL_FRONT, write: R.CLINICAL_FRONT, remove: R.PROVIDERS });
