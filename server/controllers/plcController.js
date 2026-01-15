// server/controllers/plcController.js
const plc = require("../services/plcMonitorService");

/**
 * GET /api/plc/snapshot
 * - plcMonitorService가 읽어온 전체 데이터를 반환
 */
exports.getSnapshot = (req, res) => {
  try {
    return res.json({ success: true, data: plc.snapshot() });
  } catch (e) {
    console.error("[PLC.getSnapshot]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

