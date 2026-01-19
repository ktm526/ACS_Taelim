const ModbusRTU = require("modbus-serial");
const DeviceInStocker = require("../models/DeviceInStocker");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);

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

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeBit(client, wordAddr, bitIndex, value) {
  const readBack = await client.readHoldingRegisters(wordAddr, 1);
  const current = Number(readBack?.data?.[0] ?? 0) & 0xffff;
  const mask = 1 << bitIndex;
  const next = value ? current | mask : current & ~mask;
  await client.writeRegisters(wordAddr, [next]);
}

async function writeWord(client, wordAddr, value) {
  await client.writeRegisters(wordAddr, [value]);
}

async function loadWorkAvailableIds(side) {
  const instocker = await DeviceInStocker.findByPk(1);
  const signals = safeParse(instocker?.side_signals, {});
  if (side === "L" || side === "R") {
    return [signals?.[side]?.work_available_id].filter(Boolean);
  }
  return [
    signals?.L?.work_available_id,
    signals?.R?.work_available_id,
  ].filter(Boolean);
}

async function triggerInstockerWorkAvailable({ side = "ALL", resetMs = 500 } = {}) {
  const ids = await loadWorkAvailableIds(side);
  if (!ids.length) {
    return { success: false, message: "작업가능 신호 ID가 없습니다.", written: [] };
  }

  const parsed = ids.map(parseId).filter(Boolean);
  if (!parsed.length) {
    return { success: false, message: "유효한 PLC ID가 없습니다.", written: [] };
  }

  const client = new ModbusRTU();
  client.setTimeout(5000);
  await client.connectTCP(HOST, { port: PORT });
  client.setID(UNIT_ID);

  try {
    for (const item of parsed) {
      if (item.type === "bit") {
        await writeBit(client, item.wordAddr, item.bitIndex, 1);
      } else {
        await writeWord(client, item.wordAddr, 1);
      }
    }
  } finally {
    try {
      client.close(() => {});
    } catch {}
  }

  if (resetMs && resetMs > 0) {
    setTimeout(async () => {
      const resetClient = new ModbusRTU();
      resetClient.setTimeout(5000);
      try {
        await resetClient.connectTCP(HOST, { port: PORT });
        resetClient.setID(UNIT_ID);
        for (const item of parsed) {
          if (item.type === "bit") {
            await writeBit(resetClient, item.wordAddr, item.bitIndex, 0);
          } else {
            await writeWord(resetClient, item.wordAddr, 0);
          }
        }
      } catch (err) {
        console.error("[PLC Trigger] reset error:", err?.message || err);
      } finally {
        try {
          resetClient.close(() => {});
        } catch {}
      }
    }, resetMs);
  }

  return {
    success: true,
    message: "작업가능 신호를 1로 설정했습니다.",
    written: parsed.map((item) => item.key),
  };
}

module.exports = {
  triggerInstockerWorkAvailable,
};
