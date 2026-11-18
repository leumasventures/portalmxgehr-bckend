const { crudRouter } = require("../lib/crudRouter");
const c = require("../controllers/taskController");
const R = require("../lib/roles");

// Every signed-in role works with tasks. ?mine=true lists your own.
module.exports = crudRouter(c, { read: R.ANY, write: R.ANY, remove: R.ANY });
