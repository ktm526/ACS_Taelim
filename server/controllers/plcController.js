// server/controllers/plcController.js
const ModbusRTU = require("modbus-serial");
const plc = require("../services/plcMonitorService");
const {
  triggerTaskSignals,
  resetTaskSignals,
} = require("../services/plcTaskTriggerService");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const WORD_MODE = (process.env.PLC_WORD_MODE || "holding").toLowerCase(); // holding | input

function parseBitIndex(rawBit) {
  if (rawBit === null || rawBit === undefined) return null;
  const bitText = String(rawBit).trim();
  if (!bitText.length) return null;
  if (/^\d+$/.test(bitText)) {
    const parsed = Number(bitText);
    return parsed >= 0 && parsed <= 15 ? parsed : null;
  }
  const parsed = Number.parseInt(bitText, 16);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 15 ? parsed : null;
}

function parseId(rawId) {
  if (rawId === null || rawId === undefined) return null;
  const idText = String(rawId).trim();
  if (!idText.length) return null;
  if (idText.includes(".")) {
    const [wordText, bitText] = idText.split(".");
    const wordAddr = Number(wordText);
    const bitIndex = parseBitIndex(bitText);
    if (!Number.isFinite(wordAddr) || bitIndex === null) return null;
    return { type: "bit", wordAddr, bitIndex, key: idText };
  }
  const wordAddr = Number(idText);
  if (!Number.isFinite(wordAddr)) return null;
  return { type: "word", wordAddr, key: idText };
}

function groupRanges(addresses, maxQty = 120) {
  const ranges = [];
  const sorted = Array.from(new Set(addresses)).sort((a, b) => a - b);
  let start = null;
  let prev = null;
  for (const addr of sorted) {
    if (start === null) {
      start = addr;
      prev = addr;
      continue;
    }
    const isContiguous = addr === prev + 1;
    const length = addr - start + 1;
    if (isContiguous && length <= maxQty) {
      prev = addr;
      continue;
    }
    ranges.push({ start, end: prev });
    start = addr;
    prev = addr;
  }
  if (start !== null) ranges.push({ start, end: prev });
  return ranges;
}

async function readRegisterRange(client, start, qty) {
  if (WORD_MODE === "input") {
    const res = await client.readInputRegisters(start, qty);
    return res?.data ?? [];
  }
  const res = await client.readHoldingRegisters(start, qty);
  return res?.data ?? [];
}

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

/**
 * POST /api/plc/values
 * - body: { ids: ["2224.1", "2223"] }
 */
exports.getValues = async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const parsed = ids.map(parseId).filter(Boolean);
  const wordAddrs = parsed.map((item) => item.wordAddr);

  const values = {};
  if (!parsed.length) {
    return res.json({ success: true, data: values });
  }

  const client = new ModbusRTU();
  client.setTimeout(2000);

  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);

    const ranges = groupRanges(wordAddrs);
    const wordMap = new Map();
    for (const range of ranges) {
      const qty = range.end - range.start + 1;
      const data = await readRegisterRange(client, range.start, qty);
      for (let i = 0; i < qty; i++) {
        wordMap.set(range.start + i, Number(data?.[i]));
      }
    }

    for (const item of parsed) {
      const wordValue = wordMap.get(item.wordAddr);
      if (wordValue === undefined || wordValue === null || Number.isNaN(wordValue)) {
        values[item.key] = null;
        continue;
      }
      if (item.type === "bit") {
        values[item.key] = (Number(wordValue) & (1 << item.bitIndex)) !== 0 ? 1 : 0;
      } else {
        values[item.key] = wordValue;
      }
    }

    return res.json({ success: true, data: values });
  } catch (e) {
    console.error("[PLC.getValues]", e);
    return res.status(500).json({ success: false, message: e.message });
  } finally {
    try {
      client.close(() => {});
    } catch {}
  }
};

/**
 * POST /api/plc/task-trigger
 * - body: { side: "L"|"R"|"ALL" }
 */
exports.triggerTask = async (req, res) => {
  try {
    const sideRaw = String(req.body?.side || "ALL").toUpperCase();
    const side = sideRaw === "L" || sideRaw === "R" ? sideRaw : "ALL";
    const result = await triggerTaskSignals({ side });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error("[PLC.triggerTask]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * POST /api/plc/task-reset
 * - body: { side: "L"|"R"|"ALL" }
 */
exports.resetTask = async (req, res) => {
  try {
    const sideRaw = String(req.body?.side || "ALL").toUpperCase();
    const side = sideRaw === "L" || sideRaw === "R" ? sideRaw : "ALL";
    const result = await resetTaskSignals({ side });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error("[PLC.resetTask]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PLC 쓰기 (범용)
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/plc/write
 * - body: { id: "6000.1" or "6030", value: 0 or 1 }
 * - bit 형식(6000.1): 해당 비트만 변경
 * - word 형식(6030): 전체 워드 값 변경
 */
exports.writePlc = async (req, res) => {
  const writeClient = new ModbusRTU();
  writeClient.setTimeout(3000);
  
  try {
    const { id, value } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: "id 필요" });
    }
    
    const parsed = parseId(id);
    if (!parsed) {
      return res.status(400).json({ success: false, message: `잘못된 ID 형식: ${id}` });
    }
    
    const writeValue = Number(value) || 0;
    
    await writeClient.connectTCP(HOST, { port: PORT });
    writeClient.setID(UNIT_ID);
    
    if (parsed.type === "bit") {
      // 비트 쓰기: 현재 워드 읽고, 해당 비트만 변경 후 쓰기
      const currentData = await writeClient.readHoldingRegisters(parsed.wordAddr, 1);
      let wordValue = currentData.data[0];
      
      if (writeValue) {
        wordValue |= (1 << parsed.bitIndex); // 비트 ON
      } else {
        wordValue &= ~(1 << parsed.bitIndex); // 비트 OFF
      }
      
      await writeClient.writeRegister(parsed.wordAddr, wordValue);
      console.log(`[PLC.write] ${id} = ${writeValue} (word ${parsed.wordAddr} → ${wordValue})`);
    } else {
      // 워드 쓰기
      await writeClient.writeRegister(parsed.wordAddr, writeValue);
      console.log(`[PLC.write] ${id} = ${writeValue}`);
    }
    
    writeClient.close();
    return res.json({ success: true, id, value: writeValue });
  } catch (e) {
    console.error("[PLC.write]", e);
    try { writeClient.close(); } catch (_) {}
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────
// TCP 테스트 관련
// ─────────────────────────────────────────────────────────────
const tcpTest = require("../services/tcpTestService");

/**
 * POST /api/plc/tcp-test/start
 * body: { host?, port?, message?, intervalMs? }
 */
exports.startTcpTest = (req, res) => {
  try {
    const config = req.body || {};
    const result = tcpTest.start(config);
    return res.json(result);
  } catch (e) {
    console.error("[TCP Test.start]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * POST /api/plc/tcp-test/stop
 */
exports.stopTcpTest = (req, res) => {
  try {
    const result = tcpTest.stop();
    return res.json(result);
  } catch (e) {
    console.error("[TCP Test.stop]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/plc/tcp-test/status
 */
exports.getTcpTestStatus = (req, res) => {
  try {
    const status = tcpTest.getStatus();
    return res.json({ success: true, data: status });
  } catch (e) {
    console.error("[TCP Test.status]", e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

