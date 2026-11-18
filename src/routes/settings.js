const router = require("express").Router();
const { authorize } = require("../middleware/auth");
const c = require("../controllers/settingsController");
const auth = require("../controllers/authController");
const R = require("../lib/roles");

router.get("/me", c.getMine);
router.patch("/profile", c.updateProfile);
router.put("/preferences", c.updatePreferences);
router.post("/password", auth.changePassword);

router.get("/clinic", c.getClinic);
router.put("/clinic", authorize(...R.ADMIN), c.updateClinic);
router.patch("/clinic", authorize(...R.ADMIN), c.updateClinic);

module.exports = router;
