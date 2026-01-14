// server/controllers/healthController.js
const { lastRecTime, sockets } = require('../services/amrMonitorService');
const { reconnectAmr } = require('../services/amrMonitorService');
const Robot = require('../models/Robot');

const THRESHOLD = 2_000; // 5초

/**
 * GET /api/health/signals
 * Returns per-device signal status for RIO, AMR, Door (open/closed/disconnected), and global Alarm
 */
exports.getSignals = async (req, res) => {
    try {
        const now = Date.now();

        // AMR signals
        const robots = await Robot.findAll({ attributes: ['name'], raw: true });
        const amr = {};
        robots.forEach(({ name }) => {
            const last = lastRecTime.get(name) || 0;
            amr[name] = (now - last) < THRESHOLD;
        });
        // dispatcherService 제거로 인해 RIO/Door/Alarm 신호는 제공하지 않음 (키 자체 제거)
        return res.json({ amr });
    } catch (err) {
        console.error('[Health.getSignals]', err);
        return res.status(500).json({ message: '시그널 조회 중 오류가 발생했습니다.' });
    }
};

/**
 * GET /api/health/signals/:type/:key
 * Returns detailed status for a specific signal type and key
 */
exports.getSignalDetail = async (req, res) => {
    const { type, key } = req.params;
    const now = Date.now();

    try {
        switch (type) {
            case 'amr': {
                const ts = lastRecTime.get(key) || null;
                const robot = await Robot.findOne({ where: { name: key } });
                if (!robot) return res.status(404).json({ message: 'AMR not found' });
                return res.json({
                    name: key,
                    status: robot.status,
                    battery: robot.battery,
                    lastSignal: ts,
                });
            }
            case 'rio':
            case 'door':
            case 'alarm':
                return res.status(501).json({ message: `${type} 신호 기능은 제거되었습니다.` });

            default:
                return res.status(400).json({ message: 'Invalid type' });
        }
    } catch (e) {
        console.error('[Health.getSignalDetail]', e);
        return res.status(500).json({ message: '서버 오류' });
    }
};

exports.reconnectSignal = async (req, res) => {
    const { type, key } = req.params;
    try {
        if (type === 'amr') {
            await reconnectAmr(key);
        } else {
            return res.status(400).json({ message: '재연결 불가 항목' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: '재연결 실패' });
    }
};