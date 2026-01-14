/**
 * settingsService
 * - PLC(Modbus TCP) Holding Register 6060~6063을 1초 주기로 읽어서
 * - Settings 테이블(단일 row, id=1)을 자동 업데이트
 *
 * 레지스터 매핑(기본):
 * - 6060: reference_grinder (문자열로 저장)
 * - 6061: grinder_wait_ms (기본: "초"로 가정하여 1000 곱 → ms 저장)
 * - 6062: charge_threshold_percent
 * - 6063: charge_complete_percent
 *
 * 환경변수:
 * - MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID
 * - SETTINGS_PLC_POLL_MS (default: 1000)
 * - PLC_GRINDER_WAIT_MULTIPLIER (default: 1000) // 6061 값을 ms로 바꾸기 위한 배수
 */

const ModbusRTU = require("modbus-serial");
const Settings = require("../models/Settings");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);

const POLL_MS = Number.parseInt(process.env.SETTINGS_PLC_POLL_MS || "1000", 10);
const WAIT_MULTIPLIER = Number.parseInt(process.env.PLC_GRINDER_WAIT_MULTIPLIER || "1000", 10);

const START_ADDRESS = 6060;
const QUANTITY = 4;

const client = new ModbusRTU();
client.setTimeout(2000);

let pollTimer = null;
let connecting = false;
let inFlight = false;
let lastValues = null; // [6060,6061,6062,6063]

async function ensureSingleton() {
  const [row] = await Settings.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

async function ensureConnected() {
  // modbus-serial은 연결 여부를 외부로 명확히 노출하지 않아서,
  // 단순히 connect를 시도하고 실패 시 재시도하는 방식으로 운영.
  if (connecting) return false;
  connecting = true;
  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);
    return true;
  } catch (e) {
    return false;
  } finally {
    connecting = false;
  }
}

function valuesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function pollOnce() {
  if (inFlight) return;
  inFlight = true;

  try {
    // 연결이 끊겼으면 재연결 시도
    // (read에서 에러나도 다음 tick에서 재연결하게 됨)
    await ensureConnected();

    const res = await client.readHoldingRegisters(START_ADDRESS, QUANTITY);
    const regs = res?.data;
    if (!Array.isArray(regs) || regs.length < QUANTITY) return;

    // 6060~6063
    const v6060 = Number(regs[0]);
    const v6061 = Number(regs[1]);
    const v6062 = Number(regs[2]);
    const v6063 = Number(regs[3]);

    const current = [v6060, v6061, v6062, v6063];
    if (valuesEqual(lastValues, current)) return;

    const row = await ensureSingleton();
    const patch = {
      reference_grinder: Number.isFinite(v6060) ? String(v6060) : null,
      grinder_wait_ms: Number.isFinite(v6061) ? Math.max(0, Math.trunc(v6061 * WAIT_MULTIPLIER)) : row.grinder_wait_ms,
      charge_threshold_percent: Number.isFinite(v6062) ? v6062 : row.charge_threshold_percent,
      charge_complete_percent: Number.isFinite(v6063) ? v6063 : row.charge_complete_percent,
    };

    await row.update(patch);
    lastValues = current;

    console.log(
      `[SettingsService] PLC HR6060~6063=${current.join(", ")} -> Settings 업데이트 완료`
    );
  } catch (e) {
    // read/DB 에러는 서비스 전체를 죽이지 않고 다음 tick에서 재시도
    console.warn("[SettingsService] poll error:", e?.message || e);
    try {
      client.close(() => {});
    } catch {}
  } finally {
    inFlight = false;
  }
}

function start() {
  if (pollTimer) return;
  pollTimer = setInterval(pollOnce, POLL_MS);
  // 첫 실행은 즉시 한 번
  pollOnce();
  console.log(
    `[SettingsService] started (host=${HOST}:${PORT}, unitId=${UNIT_ID}, pollMs=${POLL_MS})`
  );
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  try {
    client.close(() => {});
  } catch {}
  console.log("[SettingsService] stopped");
}

// 서비스는 require 시 자동 시작
start();

module.exports = { start, stop };

