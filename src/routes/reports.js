const router = require("express").Router();
const { authorize } = require("../middleware/auth");
const c = require("../controllers/reportController");
const R = require("../lib/roles");

// All accept ?from=&to= (ISO dates, default last 30 days).
router.get("/overview", authorize(...R.REPORTING), c.overview);
router.get("/appointments", authorize(...R.REPORTING), c.appointments);
router.get("/patients", authorize(...R.REPORTING), c.patients);
router.get("/financial", authorize(...R.BILLING), c.financial);

module.exports = router;
