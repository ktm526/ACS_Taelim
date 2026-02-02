// server/controllers/healthController.js
const { lastRecTime, sockets } = require('../services/amrMonitorService');
const { reconnectAmr } = require('../services/amrMonitorService');
const plc = require('../services/plcMonitorService');
const Robot = require('../models/Robot');
const DeviceInStocker = require('../models/DeviceInStocker');
const DeviceGrinder = require('../models/DeviceGrinder');
const DeviceOutStocker = require('../models/DeviceOutStocker');
const DeviceConveyor = require('../models/DeviceConveyor');

const SLOT_SIDES = ['L', 'R'];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const OUT_SIDES = ['L1', 'L2', 'R1', 'R2'];
const OUT_ROWS = [1, 2, 3, 4, 5, 6];
const POSITIONS = ['L', 'R'];

function safeParseJson(value, fallback) {
    if (typeof value !== 'string') return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function normalizeText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length ? text : null;
}

function resolvePlcValue(id) {
    const key = normalizeText(id);
    if (!key) return null;
    if (key.includes('.')) {
        const on = plc.getBit(key);
        return typeof on === 'boolean' ? (on ? 1 : 0) : null;
    }
    const value = plc.getWord(key);
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

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
        const instockerRow = await DeviceInStocker.findByPk(1);
        const grinderRow = await DeviceGrinder.findByPk(1);
        const outstockerRow = await DeviceOutStocker.findByPk(1);
        const conveyorRow = await DeviceConveyor.findByPk(1);

        const instockerSlots = safeParseJson(instockerRow?.slots, {});
        const instockerSideSignals = safeParseJson(instockerRow?.side_signals, {});
        const grinders = safeParseJson(grinderRow?.grinders, []);
        const outstockerSides = safeParseJson(outstockerRow?.sides, {});
        const conveyors = safeParseJson(conveyorRow?.conveyors, []);

        const instockerWorkAvailable = {};
        SLOT_SIDES.forEach((side) => {
            const id = instockerSideSignals?.[side]?.work_available_id;
            instockerWorkAvailable[side] = resolvePlcValue(id);
        });

        let instockerAvailableCount = 0;
        SLOT_SIDES.forEach((side) => {
            SLOT_INDEXES.forEach((idx) => {
                const slot = instockerSlots?.[`${side}${idx}`] || {};
                const productId = normalizeText(slot.product_type_id);
                const productValue = resolvePlcValue(productId);
                if (!productId || productValue === null) return;
                if (Number(productValue) <= 0) return;
                if (!normalizeText(slot.mani_pos)) return;
                instockerAvailableCount += 1;
            });
        });

        let grinderUsedCount = 0;
        let grinderInputReadyCount = 0;
        let grinderOutputReadyCount = 0;
        (grinders || []).forEach((grinder) => {
            const bypassId = normalizeText(grinder?.bypass_id);
            const bypassOn = bypassId ? resolvePlcValue(bypassId) === 1 : false;
            if (!bypassOn) grinderUsedCount += 1;
            POSITIONS.forEach((pos) => {
                const position = grinder?.positions?.[pos] || {};
                if (bypassOn) return;
                const inputReadyId = normalizeText(position.input_ready_id);
                const outputReadyId = normalizeText(position.output_ready_id);
                if (inputReadyId && resolvePlcValue(inputReadyId) === 1) {
                    grinderInputReadyCount += 1;
                }
                if (outputReadyId && resolvePlcValue(outputReadyId) === 1) {
                    grinderOutputReadyCount += 1;
                }
            });
        });

        let outstockerLoadReadyCount = 0;
        let outstockerUnloadJigCount = 0;
        OUT_SIDES.forEach((side) => {
            const sideData = outstockerSides?.[side] || {};
            const bypassId = normalizeText(sideData.bypass_id);
            const bypassOn = bypassId ? resolvePlcValue(bypassId) === 1 : false;
            if (bypassOn) return;
            for (const row of OUT_ROWS) {
                const rowData = sideData.rows?.[row] || {};
                const jigStateId = normalizeText(rowData.jig_state_id);
                if (jigStateId && resolvePlcValue(jigStateId) === 1) {
                    outstockerUnloadJigCount += 1;
                }
                const loadReadyId = normalizeText(rowData.load_ready_id);
                if (!loadReadyId || resolvePlcValue(loadReadyId) !== 1) break;
                if (!normalizeText(rowData.mani_pos)) break;
                outstockerLoadReadyCount += 1;
            }
        });

        const conveyorCalls = (conveyors || []).map((item) => {
            const qty4Id = normalizeText(item?.input_qty_4_id);
            const qty1Id = normalizeText(item?.input_qty_1_id);
            const qty = qty4Id && resolvePlcValue(qty4Id) === 1
                ? 4
                : qty1Id && resolvePlcValue(qty1Id) === 1
                    ? 1
                    : 0;
            return {
                index: item?.index,
                qty,
            };
        });

        return res.json({
            amr,
            instocker: {
                work_available: instockerWorkAvailable,
                available_count: instockerAvailableCount,
            },
            grinder: {
                used_count: grinderUsedCount,
                input_ready_count: grinderInputReadyCount,
                output_ready_count: grinderOutputReadyCount,
            },
            outstocker: {
                load_ready_count: outstockerLoadReadyCount,
                unload_jig_count: outstockerUnloadJigCount,
            },
            conveyor: {
                calls: conveyorCalls,
            },
        });
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