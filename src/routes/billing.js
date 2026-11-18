const { crudRouter } = require("../lib/crudRouter");
const { authorize } = require("../middleware/auth");
const c = require("../controllers/billingController");
const R = require("../lib/roles");

module.exports = crudRouter(c, {
  read: R.BILLING_FRONT,
  write: R.BILLING_FRONT,
  remove: R.BILLING, // draft invoices only
  extra: (r) => {
    r.get("/summary", authorize(...R.BILLING_FRONT), c.summary);
    r.post("/:id/payments", authorize(...R.BILLING_FRONT), c.addPayment);
  },
});
