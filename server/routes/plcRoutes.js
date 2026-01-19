// server/routes/plcRoutes.js
const router = require("express").Router();
const c = require("../controllers/plcController");

router.get("/snapshot", c.getSnapshot); // GET /api/plc/snapshot
router.post("/values", c.getValues); // POST /api/plc/values

module.exports = router;

