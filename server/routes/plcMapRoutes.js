const express = require('express');
const router = express.Router();
const c = require('../controllers/plcMapController');

router.get('/', c.list);       // GET    /api/plc-maps
router.get('/:id', c.getById); // GET    /api/plc-maps/:id
router.post('/', c.create);    // POST   /api/plc-maps
router.put('/:id', c.update);  // PUT    /api/plc-maps/:id
router.delete('/:id', c.remove); // DELETE /api/plc-maps/:id

module.exports = router;

