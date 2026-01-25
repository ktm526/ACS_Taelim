/**
 * heartbeatService
 * - PLC에 주기적으로 heartbeat 신호 전송
 * - 1. 5000.1 레지스터에 항상 1 값 (heartbeat)
 * - 2. 로봇 상태 확인 후 5000.0 레지스터에 상태값 (정상:1, 비정상:0)
 */

const ModbusRTU = require("modbus-serial");
const { Robot } = require("../models");

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

const state = {
  connected: false,
  lastWriteAt: null,
  lastError: null,
  robotStatusOk: true, // 로봇 상태 정상 여부
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
 * 로봇 상태 확인
 * - 연결 끊김: status가 '미연결', null, undefined
 * - 에러 상태: status가 '오류', '비상정지'
 * @returns {boolean} 모든 로봇이 정상이면 true, 하나라도 비정상이면 false
 */
async function checkRobotStatus() {
  try {
    const robots = await Robot.findAll();
    
    if (robots.length === 0) {
      // 로봇이 없으면 정상 처리
      return true;
    }

    const errorStatuses = ["미연결", "오류", "비상정지"];
    
    for (const robot of robots) {
      const status = robot.status;
      
      // status가 null, undefined, 빈 문자열이면 비정상
      if (!status) {
        console.log(`[Heartbeat] 로봇 ${robot.name || robot.id}: 상태 없음 (비정상)`);
        return false;
      }
      
      // 에러 상태면 비정상
      if (errorStatuses.includes(status)) {
        console.log(`[Heartbeat] 로봇 ${robot.name || robot.id}: ${status} (비정상)`);
        return false;
      }
    }
    
    return true;
  } catch (err) {
    console.error(`[Heartbeat] 로봇 상태 확인 실패: ${err.message}`);
    return false; // DB 조회 실패시 안전을 위해 비정상 처리
  }
}

/**
 * Heartbeat 레지스터 쓰기
 * - bit 0: 로봇 상태 (1=정상, 0=비정상)
 * - bit 1: heartbeat (항상 1)
 * 
 * 레지스터 값:
 * - 정상: 0b11 = 3
 * - 비정상: 0b10 = 2
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

    // 로봇 상태 확인
    const robotOk = await checkRobotStatus();
    state.robotStatusOk = robotOk;

    // bit 1 = 1 (heartbeat), bit 0 = robotOk ? 1 : 0
    const bit0 = robotOk ? 1 : 0;
    const bit1 = 1; // 항상 1
    const registerValue = (bit1 << 1) | bit0;

    // 레지스터에 쓰기
    await client.writeRegister(HEARTBEAT_REGISTER, registerValue);
    
    state.lastWriteAt = new Date().toISOString();
    state.lastError = null;

    // 상태 변경시에만 로그 출력
    const statusLabel = robotOk ? "정상" : "비정상";
    // console.log(`[Heartbeat] 5000 레지스터 = ${registerValue} (0b${registerValue.toString(2).padStart(2, '0')}) - 로봇: ${statusLabel}`);

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
  };
}

module.exports = {
  start,
  stop,
  getState,
};
