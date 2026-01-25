/**
 * heartbeatService
 * - PLC에 주기적으로 heartbeat 신호 전송
 * - 5000.0: 1초 주기로 0, 1 번갈아 토글
 * - 5000.1: 항상 1
 */

const ModbusRTU = require("modbus-serial");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const HEARTBEAT_MS = Number.parseInt(process.env.HEARTBEAT_MS || "1000", 10);

const HEARTBEAT_REGISTER = 5000; // 레지스터 주소

const client = new ModbusRTU();
client.setTimeout(2000);

let heartbeatTimer = null;
let connecting = false;
let inFlight = false;
let toggleBit = 0; // 0, 1 토글용

const state = {
  connected: false,
  lastWriteAt: null,
  lastError: null,
  currentValue: 0,
};

/**
 * Modbus TCP 연결
 */
async function ensureConnected() {
  if (client.isOpen) {
    state.connected = true;
    return true;
  }
  if (connecting) return false;

  connecting = true;
  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);
    state.connected = true;
    state.lastError = null;
    console.log(`[Heartbeat] PLC 연결됨 (${HOST}:${PORT})`);
    return true;
  } catch (err) {
    state.connected = false;
    state.lastError = err.message;
    console.error(`[Heartbeat] PLC 연결 실패: ${err.message}`);
    return false;
  } finally {
    connecting = false;
  }
}

/**
 * Heartbeat 레지스터 쓰기
 * - bit 0: 0, 1 토글 (1초 주기)
 * - bit 1: 항상 1
 * 
 * 레지스터 값:
 * - 토글 0: 0b10 = 2
 * - 토글 1: 0b11 = 3
 */
async function writeHeartbeat() {
  if (inFlight) return;
  inFlight = true;

  try {
    const connected = await ensureConnected();
    if (!connected) {
      inFlight = false;
      return;
    }

    // bit 0 = 토글 (0 또는 1), bit 1 = 항상 1
    const bit0 = toggleBit;
    const bit1 = 1;
    const registerValue = (bit1 << 1) | bit0;

    // 레지스터에 쓰기
    await client.writeRegister(HEARTBEAT_REGISTER, registerValue);
    
    state.lastWriteAt = new Date().toISOString();
    state.lastError = null;
    state.currentValue = registerValue;

    // 토글
    toggleBit = toggleBit === 0 ? 1 : 0;

  } catch (err) {
    state.lastError = err.message;
    state.connected = false;
    
    // 연결 끊김 처리
    try {
      client.close();
    } catch (closeErr) {
      // ignore
    }
    
    console.error(`[Heartbeat] 쓰기 실패: ${err.message}`);
  } finally {
    inFlight = false;
  }
}

/**
 * Heartbeat 서비스 시작
 */
function start() {
  if (heartbeatTimer) {
    console.log("[Heartbeat] 이미 실행 중");
    return;
  }

  console.log(`[Heartbeat] 시작 (주기: ${HEARTBEAT_MS}ms, 레지스터: ${HEARTBEAT_REGISTER})`);
  
  // 즉시 1회 실행
  writeHeartbeat();
  
  // 주기적 실행
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_MS);
}

/**
 * Heartbeat 서비스 중지
 */
function stop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[Heartbeat] 중지됨");
  }
  
  try {
    if (client.isOpen) {
      client.close();
    }
  } catch (err) {
    // ignore
  }
  
  state.connected = false;
}

/**
 * 현재 상태 조회
 */
function getState() {
  return {
    ...state,
    running: heartbeatTimer !== null,
    toggleBit,
  };
}

module.exports = {
  start,
  stop,
  getState,
};
