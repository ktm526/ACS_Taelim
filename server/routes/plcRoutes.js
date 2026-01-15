// server/routes/plcRoutes.js
const router = require("express").Router();
const c = require("../controllers/plcController");

router.get("/snapshot", c.getSnapshot); // GET /api/plc/snapshot

module.exports = router;

