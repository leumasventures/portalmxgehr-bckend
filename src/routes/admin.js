const router = require("express").Router();
const { authorize } = require("../middleware/auth");
const c = require("../controllers/adminController");
const R = require("../lib/roles");

router.use(authorize(...R.ADMIN));

router.get("/stats", c.stats);
router.get("/audit-logs", c.listAuditLogs);

router.get("/users", c.listUsers);
router.post("/users", c.createUser);
router.get("/users/:id", c.getUser);
router.patch("/users/:id", c.updateUser);
router.put("/users/:id", c.updateUser);
router.delete("/users/:id", c.deactivateUser); // deactivates, never deletes

module.exports = router;
