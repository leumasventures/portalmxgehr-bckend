const express = require("express");
const { authorize } = require("../middleware/auth");

/**
 * Standard REST routes for a createCrud() controller:
 *   GET /  POST /  GET /:id  PUT|PATCH /:id  DELETE /:id
 * `extra(router)` runs first so custom routes like /summary win over /:id.
 */
function crudRouter(c, { read = [], write = [], remove = ["ADMIN"], extra } = {}) {
  const router = express.Router();
  if (extra) extra(router);
  router.route("/").get(authorize(...read), c.list).post(authorize(...write), c.create);
  router
    .route("/:id")
    .get(authorize(...read), c.get)
    .put(authorize(...write), c.update)
    .patch(authorize(...write), c.update)
    .delete(authorize(...remove), c.remove);
  return router;
}

module.exports = { crudRouter };
