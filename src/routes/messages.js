const router = require("express").Router();
const c = require("../controllers/messageController");

// Static paths must come before /:id.
router.get("/", c.list); // ?box=inbox|sent&unread=true&q=
router.post("/", c.send);
router.get("/unread-count", c.unreadCount);
router.get("/recipients", c.recipients);
router.get("/:id", c.get);
router.get("/:id/thread", c.thread);
router.patch("/:id/read", c.markRead);

module.exports = router;
