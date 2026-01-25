// server/routes/plcRoutes.js
const router = require("express").Router();
const c = require("../controllers/plcController");

router.get("/snapshot", c.getSnapshot); // GET /api/plc/snapshot
router.post("/values", c.getValues); // POST /api/plc/values
router.post("/write", c.writePlc); // POST /api/plc/write
router.post("/task-trigger", c.triggerTask); // POST /api/plc/task-trigger
router.post("/task-reset", c.resetTask); // POST /api/plc/task-reset

// TCP 테스트
router.post("/tcp-test/start", c.startTcpTest);
router.post("/tcp-test/stop", c.stopTcpTest);
router.get("/tcp-test/status", c.getTcpTestStatus);

module.exports = router;

