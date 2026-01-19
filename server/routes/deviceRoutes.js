const express = require('express');
const router = express.Router();
const c = require('../controllers/deviceController');

router.get('/instocker', c.getInstocker);     // GET /api/devices/instocker
router.put('/instocker', c.updateInstocker);  // PUT /api/devices/instocker

router.get('/grinder', c.getGrinder);         // GET /api/devices/grinder
router.put('/grinder', c.updateGrinder);      // PUT /api/devices/grinder

module.exports = router;
