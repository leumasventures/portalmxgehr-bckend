const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/claimController");
const R = require("../lib/roles");

module.exports = crudRouter(c, {
  read: ["ADMIN", "BILLING", "PROVIDER"],
  write: R.BILLING,
  remove: R.BILLING, // draft claims only
});
