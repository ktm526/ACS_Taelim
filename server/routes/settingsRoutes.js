const express = require('express');
const router = express.Router();
const c = require('../controllers/settingsController');

router.get('/', c.get);      // GET /api/settings
router.put('/', c.update);   // PUT /api/settings

module.exports = router;

