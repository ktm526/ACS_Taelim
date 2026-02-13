// routes/healthRoutes.js
const router = require('express').Router();
const hc = require('../controllers/healthController');

router.get('/signals', hc.getSignals);
router.get('/signals/:type/:key', hc.getSignalDetail);
router.post('/signals/:type/:key/reconnect', hc.reconnectSignal);
router.get('/system-metrics/latest', hc.getSystemMetricsLatest);
router.get('/system-metrics', hc.getSystemMetricsHistory);

module.exports = router;

