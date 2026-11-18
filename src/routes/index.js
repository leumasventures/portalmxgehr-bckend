const router = require("express").Router();
const { authenticate } = require("../middleware/auth");

// Public
router.use("/auth", require("./auth"));

// Everything below requires a valid Bearer token.
router.use(authenticate);

router.use("/dashboard", require("./dashboard"));
router.use("/patients", require("./patients"));
router.use("/appointments", require("./appointments"));
router.use("/calendar", require("./calendar"));
router.use("/encounters", require("./encounters"));
router.use("/notes", require("./notes"));
router.use("/medications", require("./medications"));
router.use("/prescriptions", require("./prescriptions"));
router.use("/labs", require("./labs"));
router.use("/diagnoses", require("./diagnoses"));
router.use("/assessments", require("./assessments"));
router.use("/treatment-plans", require("./treatmentPlans"));
router.use("/telehealth", require("./telehealth"));
router.use("/messages", require("./messages"));
router.use("/referrals", require("./referrals"));
router.use("/documents", require("./documents"));
router.use("/billing", require("./billing"));
router.use("/claims", require("./claims"));
router.use("/tasks", require("./tasks"));
router.use("/reports", require("./reports"));
router.use("/settings", require("./settings"));
router.use("/admin", require("./admin"));

module.exports = router;
