const ModbusRTU = require("modbus-serial");
const DeviceInStocker = require("../models/DeviceInStocker");
const DeviceGrinder = require("../models/DeviceGrinder");
const DeviceOutStocker = require("../models/DeviceOutStocker");

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

const SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];
const SIGNAL_KEYS = [
  "input_ready_id",
  "output_ready_id",
  "safe_pos_id",
  "input_in_progress_id",
  "input_done_id",
  "output_in_progress_id",
  "output_done_id",
];

function collectSideTargets(side) {
  if (side === "L" || side === "R") return [side];
  return SIDES;
}

async function collectIds({ side = "ALL" } = {}) {
  const [instocker, grinder, outstocker] = await Promise.all([
    DeviceInStocker.findByPk(1),
    DeviceGrinder.findByPk(1),
    DeviceOutStocker.findByPk(1),
  ]);

  const slots = safeParse(instocker?.slots, {});
  const sideSignals = safeParse(instocker?.side_signals, {});
  const grinders = safeParse(grinder?.grinders, []);
  const sides = collectSideTargets(side);
  const outSides = ["L1", "L2", "R1", "R2"];
  const outRows = [1, 2, 3, 4, 5, 6];

  const ids = [];
  const grinderProductIds = [];

  // 인스토커 측면 신호
  sides.forEach((s) => {
    const sig = sideSignals?.[s] || {};
    ids.push(sig.work_available_id, sig.done_id, sig.error_id, sig.safe_id);
  });

  // 인스토커 슬롯 신호 (작업중/제품정보)
  sides.forEach((s) => {
    SLOT_INDEXES.forEach((idx) => {
      const key = `${s}${idx}`;
      const slot = slots?.[key] || {};
      ids.push(slot.working_id, slot.product_type_id);
    });
  });

  // 연마기 신호/제품정보
  grinders.forEach((gr) => {
    grinderProductIds.push(gr?.product_type_id);
    ids.push(gr?.bypass_id);
    POSITIONS.forEach((pos) => {
      const position = gr?.positions?.[pos] || {};
      SIGNAL_KEYS.forEach((key) => {
        ids.push(position?.[key]);
      });
    });
  });

  // 아웃스토커 신호/제품정보
  const outSidesData = safeParse(outstocker?.sides, {});
  outSides.forEach((sideKey) => {
    const sideData = outSidesData?.[sideKey] || {};
    ids.push(sideData.bypass_id);
    outRows.forEach((row) => {
      const rowData = sideData.rows?.[row] || {};
      ids.push(rowData.load_ready_id, rowData.jig_state_id, rowData.model_no_id);
    });
  });

  const normalizeList = (list) =>
    Array.from(
      new Set(list.map((v) => (v == null ? null : String(v).trim())).filter(Boolean))
    );

  return {
    ids: normalizeList(ids),
    grinderProductIds: normalizeList(grinderProductIds),
  };
}

async function writeSignals({ side = "ALL", value = 1 } = {}) {
  const { ids, grinderProductIds } = await collectIds({ side });
  if (!ids.length && !grinderProductIds.length) {
    return { success: false, message: "PLC ID가 없습니다.", written: [] };
  }

  const parsed = ids.map(parseId).filter(Boolean);
  const grinderParsed = grinderProductIds.map(parseId).filter(Boolean);
  if (!parsed.length && !grinderParsed.length) {
    return { success: false, message: "유효한 PLC ID가 없습니다.", written: [] };
  }

  const client = new ModbusRTU();
  client.setTimeout(5000);
  await client.connectTCP(HOST, { port: PORT });
  client.setID(UNIT_ID);

  try {
    const bitGroups = new Map();
    const wordTargets = new Set();

    parsed.forEach((item) => {
      if (item.type === "bit") {
        const list = bitGroups.get(item.wordAddr) || new Set();
        list.add(item.bitIndex);
        bitGroups.set(item.wordAddr, list);
      } else {
        wordTargets.add(item.wordAddr);
      }
    });

    // 연마기 제품종류는 word로 1(또는 reset 시 0) 고정 기록
    const grinderWordTargets = new Set();
    grinderParsed.forEach((item) => {
      if (item.type !== "word") {
        console.warn(
          `[PLC Trigger] grinder product_type_id is not word: ${item.key}`
        );
        return;
      }
      grinderWordTargets.add(item.wordAddr);
    });

    for (const [wordAddr, bits] of bitGroups.entries()) {
      const readBack = await client.readHoldingRegisters(wordAddr, 1);
      const current = Number(readBack?.data?.[0] ?? 0) & 0xffff;
      let next = current;
      bits.forEach((bitIndex) => {
        const mask = 1 << bitIndex;
        next = value ? next | mask : next & ~mask;
      });
      await client.writeRegisters(wordAddr, [next]);

      // 작성 직후 검증 읽기
      const verify = await client.readHoldingRegisters(wordAddr, 1);
      const after = Number(verify?.data?.[0] ?? 0) & 0xffff;
      const ok = after === next;
      console.log(
        `[PLC Trigger] word ${wordAddr} write=${next} read=${after} ${ok ? "OK" : "FAIL"}`
      );
    }

    for (const wordAddr of wordTargets) {
      await writeWord(client, wordAddr, value);
      // 작성 직후 검증 읽기
      const verify = await client.readHoldingRegisters(wordAddr, 1);
      const after = Number(verify?.data?.[0] ?? 0);
      const ok = after === value;
      console.log(
        `[PLC Trigger] word ${wordAddr} write=${value} read=${after} ${ok ? "OK" : "FAIL"}`
      );
    }

    for (const wordAddr of grinderWordTargets) {
      const writeValue = value ? 1 : 0;
      await writeWord(client, wordAddr, writeValue);
      const verify = await client.readHoldingRegisters(wordAddr, 1);
      const after = Number(verify?.data?.[0] ?? 0);
      const ok = after === writeValue;
      console.log(
        `[PLC Trigger] grinder product word ${wordAddr} write=${writeValue} read=${after} ${
          ok ? "OK" : "FAIL"
        }`
      );
    }
  } finally {
    try {
      client.close(() => {});
    } catch {}
  }

  const allWritten = [
    ...parsed.map((item) => item.key),
    ...grinderParsed.map((item) => item.key),
  ];
  return {
    success: true,
    message: value ? "테스트 신호를 1로 설정했습니다." : "테스트 신호를 0으로 설정했습니다.",
    written: allWritten,
  };
}

module.exports = {
  triggerTaskSignals: (opts = {}) => writeSignals({ ...opts, value: 1 }),
  resetTaskSignals: (opts = {}) => writeSignals({ ...opts, value: 0 }),
};
