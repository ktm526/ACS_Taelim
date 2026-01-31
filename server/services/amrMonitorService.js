//services/amrMonitorService.js

const net = require('net');
const { Op } = require('sequelize');
const ModbusRTU = require("modbus-serial");
const Robot = require('../models/Robot');
const { Task } = require('../models');
const { sendAndReceive } = require('./tcpTestService');
//const { //logConnChange } = require('./connectionLogger');

// PLC 연결 설정
const PLC_HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PLC_PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const PLC_UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);

// PLC 상태 쓰기용 클라이언트
const plcWriteClient = new ModbusRTU();
plcWriteClient.setTimeout(2000);
let plcConnecting = false;
let plcConnected = false;
let lastPlcWriteTime = new Map(); // 로봇별 마지막 PLC 쓰기 시간

async function ensurePlcConnected() {
  if (plcConnected) return true;
  if (plcConnecting) return false;
  plcConnecting = true;
  try {
    // 기존 연결 정리
    try {
      plcWriteClient.close();
    } catch {}
    
    await plcWriteClient.connectTCP(PLC_HOST, { port: PLC_PORT });
    plcWriteClient.setID(PLC_UNIT_ID);
    plcConnected = true;
    console.log(`[AMR-PLC] PLC 연결 성공: ${PLC_HOST}:${PLC_PORT}`);
    return true;
  } catch (e) {
    console.warn(`[AMR-PLC] PLC 연결 실패: ${e.message}`);
    plcConnected = false;
    return false;
  } finally {
    plcConnecting = false;
  }
}

// PLC 연결 상태 주기적 확인 및 재연결
setInterval(async () => {
  if (!plcConnected && !plcConnecting) {
    await ensurePlcConnected();
  }
}, 5000);

// PLC bit 쓰기 함수 (address.bit 형식 지원)
async function writePlcBit(plcId, value, robotName = '') {
  if (!plcId) return;
  
  try {
    const connected = await ensurePlcConnected();
    if (!connected) return;
    
    // address.bit 형식 파싱 (예: "5100.0" → wordAddr=5100, bitIndex=0)
    // bit은 0-15 또는 0-F(16진수) 허용
    const parts = String(plcId).split(".");
    const wordAddr = parseInt(parts[0], 10);
    if (isNaN(wordAddr)) return;
    
    if (parts.length === 2) {
      // bit 쓰기: 현재 레지스터 읽고 bit 변경 후 쓰기
      const bitText = String(parts[1]).trim();
      const bitIndex = /[a-f]/i.test(bitText) ? parseInt(bitText, 16) : parseInt(bitText, 10);
      if (isNaN(bitIndex) || bitIndex < 0 || bitIndex > 15) return;

      const currentData = await plcWriteClient.readHoldingRegisters(wordAddr, 1);
      let nextWord = currentData.data[0];
      const writeValue = value ? 1 : 0;
      if (writeValue) {
        nextWord |= (1 << bitIndex);
      } else {
        nextWord &= ~(1 << bitIndex);
      }

      await plcWriteClient.writeRegister(wordAddr, nextWord);
      console.log(`[AMR-PLC] ${robotName ? robotName + ' ' : ''}쓰기: ${plcId} = ${writeValue}`);
    } else {
      // word 쓰기
      const writeValue = coerceWordValue(value);
      if (writeValue === null) return;
      await plcWriteClient.writeRegister(wordAddr, writeValue);
      console.log(`[AMR-PLC] ${robotName ? robotName + ' ' : ''}쓰기: ${plcId} = ${writeValue}`);
    }
  } catch (e) {
    console.warn(`[AMR-PLC] PLC 쓰기 실패 (${plcId}=${value}): ${e.message}`);
    plcConnected = false; // 재연결 유도
  }
}

// PLC 현재 값 읽기 (bit/word)
async function readPlcValue(plcId) {
  if (!plcId) return null;
  const connected = await ensurePlcConnected();
  if (!connected) return null;

  const parts = String(plcId).split(".");
  const wordAddr = parseInt(parts[0], 10);
  if (isNaN(wordAddr)) return null;

  const currentData = await plcWriteClient.readHoldingRegisters(wordAddr, 1);
  const currentWord = currentData.data[0];

  if (parts.length === 2) {
    const bitText = String(parts[1]).trim();
    const bitIndex = /[a-f]/i.test(bitText) ? parseInt(bitText, 16) : parseInt(bitText, 10);
    if (isNaN(bitIndex) || bitIndex < 0 || bitIndex > 15) return null;
    return (currentWord >> bitIndex) & 1;
  }
  return currentWord;
}

// AMR 상태를 PLC에 기록 (500ms 쓰로틀링)
const PLC_WRITE_THROTTLE_MS = 500;
const lastStatusFlags = new Map(); // 로봇별 마지막 상태 플래그
const desiredStatusByRobot = new Map(); // 로봇별 원하는 상태 저장
const desiredInfoByRobot = new Map(); // 로봇별 원하는 info word 저장
const lastInfoValues = new Map(); // 로봇별 마지막 info 값 (비교용)

function coerceWordValue(raw) {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  const num = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < 0) return 0;
  if (rounded > 65535) return 65535;
  return rounded;
}

function parseStationId(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  const digits = text.match(/\d+/g);
  if (!digits) return null;
  return coerceWordValue(Number(digits.join("")));
}

function mapStatusToWord(statusStr) {
  switch (statusStr) {
    case "대기":
      return 0;
    case "이동":
      return 1;
    case "작업 중":
      return 2;
    case "충전":
      return 3;
    case "비상정지":
      return 4;
    case "오류":
      return 5;
    default:
      return 9;
  }
}

function timeToWordMs(raw) {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  return coerceWordValue(raw);
}

async function writeAmrStatusToPlc(robot, statusFlags) {
  if (!robot?.plc_ids) {
    console.warn(`[AMR-PLC] ${robot?.name || "unknown"} plc_ids 없음 → 상태 쓰기 스킵`);
    return;
  }
  
  const robotId = robot.id;
  const now = Date.now();
  
  // 쓰로틀링: 마지막 쓰기 후 일정 시간 미경과 시 스킵
  const lastWrite = lastPlcWriteTime.get(robotId) || 0;
  if (now - lastWrite < PLC_WRITE_THROTTLE_MS) return;
  
  // 이전 상태와 동일하면 스킵
  const lastFlags = lastStatusFlags.get(robotId);
  const flagsKey = JSON.stringify(statusFlags);
  if (lastFlags === flagsKey) return;
  
  let plcIds = robot.plc_ids;
  if (typeof plcIds === 'string') {
    try {
      plcIds = JSON.parse(plcIds);
    } catch {
      console.warn(`[AMR-PLC] ${robot.name} plc_ids 파싱 실패 → 상태 쓰기 스킵`);
      return;
    }
  }
  
  // 최소 하나의 PLC ID가 설정되어 있는지 확인
  const hasAnyPlcId = ['ready_id', 'run_id', 'hold_id', 'manual_id', 'estop_id', 'error_id', 'charging_id']
    .some(key => plcIds[key]);
  if (!hasAnyPlcId) {
    console.warn(`[AMR-PLC] ${robot.name} 상태 PLC ID 미설정 → 상태 쓰기 스킵`);
    return;
  }
  
  // 원하는 상태 저장 (주기적 보정용)
  desiredStatusByRobot.set(robotId, {
    name: robot.name,
    plcIds,
    statusFlags,
  });

  // 상태 필드별 PLC 쓰기
  const statusMapping = [
    { key: 'ready_id', label: 'ready', value: statusFlags.ready },
    { key: 'run_id', label: 'run', value: statusFlags.run },
    { key: 'hold_id', label: 'hold', value: statusFlags.hold },
    { key: 'manual_id', label: 'manual', value: statusFlags.manual },
    { key: 'estop_id', label: 'estop', value: statusFlags.estop },
    { key: 'error_id', label: 'error', value: statusFlags.error },
    { key: 'charging_id', label: 'charging', value: statusFlags.charging },
  ];
  
  // 상태 요약 로그 출력
  const activeStates = statusMapping.filter(s => s.value).map(s => s.label);
  console.log(`[AMR-PLC] ${robot.name} 상태: [${activeStates.join(', ') || '없음'}]`);
  
  for (const { key, label, value } of statusMapping) {
    const plcId = plcIds[key];
    if (plcId) {
      await writePlcBit(plcId, value, robot.name);
    }
  }
  
  // 쓰기 시간 및 상태 기록
  lastPlcWriteTime.set(robotId, now);
  lastStatusFlags.set(robotId, flagsKey);
}

async function writeAmrInfoToPlc(robot, infoValues) {
  if (!robot?.plc_ids) {
    console.warn(`[AMR-PLC] ${robot?.name || "unknown"} plc_ids 없음 → info 쓰기 스킵`);
    return;
  }
  const robotId = robot.id;
  const now = Date.now();
  const lastWrite = lastPlcWriteTime.get(`${robotId}-info`) || 0;
  if (now - lastWrite < 1000) return;

  let plcIds = robot.plc_ids;
  if (typeof plcIds === "string") {
    try {
      plcIds = JSON.parse(plcIds);
    } catch {
      console.warn(`[AMR-PLC] ${robot.name} plc_ids 파싱 실패 → info 쓰기 스킵`);
      return;
    }
  }

  desiredInfoByRobot.set(robotId, {
    name: robot.name,
    plcIds,
    infoValues,
  });

  const mapping = [
    { key: "name_id", label: "name", value: infoValues.name },
    { key: "battery_id", label: "battery", value: infoValues.battery },
    { key: "error_code_id", label: "error_code", value: infoValues.error_code },
    { key: "destination_id", label: "destination", value: infoValues.destination },
    { key: "current_location_id", label: "current_location", value: infoValues.current_location },
    { key: "status_id", label: "status", value: infoValues.status },
    { key: "controller_temperature_id", label: "controller_temp", value: infoValues.controller_temp },
    { key: "x_id", label: "x", value: infoValues.x },
    { key: "y_id", label: "y", value: infoValues.y },
    { key: "angle_id", label: "angle", value: infoValues.angle },
    { key: "battery_temperature_id", label: "battery_temp", value: infoValues.battery_temp },
    { key: "run_time_id", label: "run_time", value: infoValues.run_time },
    { key: "total_run_time_id", label: "total_run_time", value: infoValues.total_run_time },
  ];

  const hasAnyInfoId = [
    "name_id",
    "battery_id",
    "error_code_id",
    "destination_id",
    "current_location_id",
    "status_id",
    "controller_temperature_id",
    "x_id",
    "y_id",
    "angle_id",
    "battery_temperature_id",
    "run_time_id",
    "total_run_time_id",
  ].some((key) => plcIds[key]);
  if (!hasAnyInfoId) {
    console.warn(`[AMR-PLC] ${robot.name} info PLC ID 미설정 → info 쓰기 스킵`);
    return;
  }

  const lastKey = lastInfoValues.get(robotId);
  const nextKey = JSON.stringify(infoValues);
  if (lastKey === nextKey) return;

  for (const { key, label, value } of mapping) {
    const plcId = plcIds[key];
    const wordValue = coerceWordValue(value);
    if (!plcId || wordValue === null) continue;
    await writePlcBit(plcId, wordValue, robot.name);
  }

  lastInfoValues.set(robotId, nextKey);
  lastPlcWriteTime.set(`${robotId}-info`, now);
}

// 주기적으로 PLC 상태와 AMR 상태를 비교 후 불일치 시 보정
const PLC_RECONCILE_INTERVAL_MS = 1000;
setInterval(async () => {
  if (!desiredStatusByRobot.size) return;

  for (const [robotId, desired] of desiredStatusByRobot.entries()) {
    const { name, plcIds, statusFlags } = desired || {};
    if (!plcIds || !statusFlags) continue;

    const statusMapping = [
      { key: 'ready_id', label: 'ready', value: statusFlags.ready },
      { key: 'run_id', label: 'run', value: statusFlags.run },
      { key: 'hold_id', label: 'hold', value: statusFlags.hold },
      { key: 'manual_id', label: 'manual', value: statusFlags.manual },
      { key: 'estop_id', label: 'estop', value: statusFlags.estop },
      { key: 'error_id', label: 'error', value: statusFlags.error },
      { key: 'charging_id', label: 'charging', value: statusFlags.charging },
    ];

    const summaryParts = [];
    for (const { key, label, value } of statusMapping) {
      const plcId = plcIds[key];
      if (!plcId) continue;

      try {
        const current = await readPlcValue(plcId);
        const desiredValue = value ? 1 : 0;
        if (current === null || current === undefined) continue;
        summaryParts.push(`${label}=${Number(current)}`);
        if (Number(current) !== desiredValue) {
          console.log(`[AMR-PLC] ${name} 불일치 감지: ${label} ${plcId} 현재=${current} 목표=${desiredValue} → 보정 쓰기`);
          await writePlcBit(plcId, desiredValue, name);
        } else {
          console.log(`[AMR-PLC] ${name} 일치: ${label} ${plcId} 현재=${current} 목표=${desiredValue}`);
        }
      } catch (e) {
        console.warn(`[AMR-PLC] ${name} PLC 상태 확인 실패 (${plcId}): ${e.message}`);
      }
    }
    if (summaryParts.length) {
      console.log(`[AMR-PLC] ${name} PLC 상태 요약: ${summaryParts.join(", ")}`);
    }

    // info word 보정
    const desiredInfo = desiredInfoByRobot.get(robotId);
    if (desiredInfo?.infoValues) {
      const infoValues = desiredInfo.infoValues;
      const infoMapping = [
        { key: "name_id", label: "name", value: infoValues.name },
        { key: "battery_id", label: "battery", value: infoValues.battery },
        { key: "error_code_id", label: "error_code", value: infoValues.error_code },
        { key: "destination_id", label: "destination", value: infoValues.destination },
        { key: "current_location_id", label: "current_location", value: infoValues.current_location },
        { key: "status_id", label: "status", value: infoValues.status },
        { key: "controller_temperature_id", label: "controller_temp", value: infoValues.controller_temp },
        { key: "x_id", label: "x", value: infoValues.x },
        { key: "y_id", label: "y", value: infoValues.y },
        { key: "angle_id", label: "angle", value: infoValues.angle },
        { key: "battery_temperature_id", label: "battery_temp", value: infoValues.battery_temp },
        { key: "run_time_id", label: "run_time", value: infoValues.run_time },
        { key: "total_run_time_id", label: "total_run_time", value: infoValues.total_run_time },
      ];

      const infoSummary = [];
      for (const { key, label, value } of infoMapping) {
        const plcId = plcIds[key];
        const desiredValue = coerceWordValue(value);
        if (!plcId || desiredValue === null) continue;
        try {
          const current = await readPlcValue(plcId);
          if (current === null || current === undefined) continue;
          infoSummary.push(`${label}=${Number(current)}`);
          if (Number(current) !== desiredValue) {
            console.log(`[AMR-PLC] ${name} 불일치 감지: ${label} ${plcId} 현재=${current} 목표=${desiredValue} → 보정 쓰기`);
            await writePlcBit(plcId, desiredValue, name);
          } else {
            console.log(`[AMR-PLC] ${name} 일치: ${label} ${plcId} 현재=${current} 목표=${desiredValue}`);
          }
        } catch (e) {
          console.warn(`[AMR-PLC] ${name} PLC 상태 확인 실패 (${plcId}): ${e.message}`);
        }
      }
      if (infoSummary.length) {
        console.log(`[AMR-PLC] ${name} PLC info 요약: ${infoSummary.join(", ")}`);
      }
    }
  }
}, PLC_RECONCILE_INTERVAL_MS);


// 로봇 매니퓰레이터 TASK_STATUS 확인
const DOOSAN_STATE_API = 4022;
const DOOSAN_STATE_PORT = 19207;
const DOOSAN_STATE_MESSAGE = {
  type: "module",
  relative_path: "doosan_state.py",
};

async function checkRobotDoosanTaskStatus(robotIp) {
  try {
    const response = await sendAndReceive(
      robotIp,
      DOOSAN_STATE_PORT,
      DOOSAN_STATE_API,
      DOOSAN_STATE_MESSAGE,
      2000 // 2초 타임아웃
    );
    if (response && response.response) {
      const taskStatus = response.response.TASK_STATUS;
      return taskStatus !== "0" && taskStatus !== 0;
    }
    return false;
  } catch {
    return false; // 실패 시 false
  }
}

// AMR Push Monitoring Service
// - Listens on TCP port for robot push data
// - Updates Robot table and tracks last received timestamp per robot

const PUSH_PORT = 19301;
const sockets = new Map();
const lastRecTime = new Map();
const lastTimeValue = new Map(); // 각 로봇의 마지막 time 값 저장
const lastTimeUpdate = new Map(); // 각 로봇의 마지막 time 값 업데이트 시간

// Log 테이블/모델 제거로 인해 초기 DB 로그 기록은 제거됨

async function markDisconnectedByIp(ip) {
    try {
        await Robot.update(
            { status: '연결 끊김', timestamp: new Date() },
            { where: { ip } }
        );
    } catch (e) {
        console.error('[AMR] markDisconnectedByIp error:', e.message);
    }
}

async function markDisconnectedByName(name) {
    try {
        await Robot.update(
            { status: '연결 끊김', timestamp: new Date() },
            { where: { name } }
        );
    } catch (e) {
        console.error('[AMR] markDisconnectedByName error:', e.message);
    }
}

function handlePush(sock, ip) {
    let buf = Buffer.alloc(0);

    sock.on('data', async chunk => {
        buf = Buffer.concat([buf, chunk]);
        //console.log('ip====', ip)

        while (buf.length >= 16) {
            if (buf.readUInt8(0) !== 0x5A) {
                buf = Buffer.alloc(0);
                break;
            }
            const len = buf.readUInt32BE(4);
            if (buf.length < 16 + len) break;

            const payload = buf.slice(16, 16 + len).toString();
            buf = buf.slice(16 + len);

            let json;
            try {
                json = JSON.parse(payload);
                //console.log(ip, json.vehicle_id)
            }
            catch (err) { continue;}//console.log('failed to json', ip, err, payload); continue; }

            const name = json.vehicle_id || json.robot_id;
            if (!name) continue;

            // 로봇 푸시 데이터에서 특정 필드 출력
            //console.log(`[AMR ${name}] time: ${json.time}, current_station: ${json.current_station}, errors: ${JSON.stringify(json.errors)}`);

            // time 값 비교 및 저장
            const currentTime = json.time;
            const lastTime = lastTimeValue.get(name);
            const now = Date.now();
            
            if (lastTime !== currentTime) {
                // time 값이 변했으면 업데이트
                lastTimeValue.set(name, currentTime);
                lastTimeUpdate.set(name, now);
            }

            // Map task_status → Korean
            const tsRaw = typeof json.task_status === 'number'
                ? json.task_status
                : typeof json.taskStatus === 'number'
                    ? json.taskStatus
                    : null;
            
            // 충전/비상 상태 우선 체크
            const isChargingNow = json.charging === true;
            const isEmergencyNow = json.emergency === true;
            const hasErrors = Array.isArray(json.errors) && json.errors.length > 0;
            
            let statusStr;
            if (isEmergencyNow) {
                statusStr = '비상정지';
                // 비상정지 시 해당 로봇의 RUNNING 태스크를 PAUSED로 변경
                try {
                    const robot = await Robot.findOne({ where: { name } });
                    if (robot) {
                        const runningTask = await Task.findOne({
                            where: { robot_id: robot.id, status: 'RUNNING' },
                        });
                        if (runningTask) {
                            await runningTask.update({ status: 'PAUSED' });
                            console.log(`[AMR] 비상정지 감지 → Task#${runningTask.id} 일시정지`);
                        }
                    }
                } catch (e) {
                    console.error('[AMR] 비상정지 태스크 일시정지 오류:', e.message);
                }
            } else if (hasErrors || [5, 6].includes(tsRaw)) {
                statusStr = '오류';
            } else if (isChargingNow) {
                statusStr = '충전';
            } else if (tsRaw === 2) {
                statusStr = '이동';
            } else if ([0, 1, 4].includes(tsRaw)) {
                statusStr = '대기';
            } else {
                statusStr = 'unknown';
            }
            // 태스크 상태 확인을 위해 로봇 조회
            let robotForStatus = null;
            let hasRunningTask = false;
            let hasPausedTask = false;
            
            if (statusStr === '이동' || statusStr === '대기') {
                robotForStatus = await Robot.findOne({ where: { name } });
                if (robotForStatus) {
                    // DB에서 태스크 확인
                    const assigned = await Task.findOne({
                        where: { robot_id: robotForStatus.id, status: ['PENDING', 'RUNNING', 'PAUSED'] },
                    });
                    if (assigned) {
                        statusStr = '작업 중';
                        hasRunningTask = assigned.status === 'RUNNING';
                        hasPausedTask = assigned.status === 'PAUSED';
                    } else {
                        // 로봇 매니퓰레이터 TASK_STATUS 확인 (0이 아니면 작업 중)
                        const doosanBusy = await checkRobotDoosanTaskStatus(robotForStatus.ip);
                        if (doosanBusy) {
                            statusStr = '작업 중';
                            hasRunningTask = true;
                        }
                    }
                }
            } else if (!robotForStatus) {
                robotForStatus = await Robot.findOne({ where: { name } });
                if (robotForStatus) {
                    const pausedTask = await Task.findOne({
                        where: { robot_id: robotForStatus.id, status: 'PAUSED' },
                    });
                    hasPausedTask = !!pausedTask;
                }
            }
            
            // runningStatus로 수동 모드 판단 (1 = 수동 모드)
            const rsRaw = typeof json.running_status === 'number'
                ? json.running_status
                : typeof json.runningStatus === 'number'
                    ? json.runningStatus
                    : 0;
            const isManualMode = rsRaw === 1;
            
            // AMR 상태 플래그 계산
            const statusFlags = {
                // ready: 대기 상태 (비상정지X, 에러X, 충전X, 수동X, 태스크 실행X)
                ready: !isEmergencyNow && !hasErrors && !isChargingNow && !isManualMode && !hasRunningTask && !hasPausedTask && [0, 1, 4].includes(tsRaw),
                // run: 태스크 실행 중
                run: hasRunningTask || tsRaw === 2,
                // hold: 태스크 일시정지 중
                hold: hasPausedTask,
                // manual: 수동 모드
                manual: isManualMode,
                // estop: 비상정지
                estop: isEmergencyNow,
                // error: 에러 상태
                error: hasErrors || [5, 6].includes(tsRaw),
                // charging: 충전 중
                charging: isChargingNow,
            };
            
            // 상태 계산 디버그 로그
            console.log(`[AMR-PLC][DEBUG] ${name} raw=emergency:${isEmergencyNow} charging:${isChargingNow} errors:${hasErrors} taskStatus:${tsRaw} runningStatus:${rsRaw} hasRunning:${hasRunningTask} hasPaused:${hasPausedTask}`);
            console.log(`[AMR-PLC][DEBUG] ${name} flags=ready:${statusFlags.ready} run:${statusFlags.run} hold:${statusFlags.hold} manual:${statusFlags.manual} estop:${statusFlags.estop} error:${statusFlags.error} charging:${statusFlags.charging}`);

            // AMR 실시간 정보 → PLC word 값 계산
            const nameWord = parseStationId(json.vehicle_id || json.robot_id || name);
            const batteryWord = typeof json.battery === "number"
              ? coerceWordValue(json.battery)
              : typeof json.battery_level === "number"
              ? coerceWordValue(Math.round(json.battery_level * 100))
              : null;
            const errorCodeWord = Array.isArray(json.errors) && json.errors.length
              ? coerceWordValue(json.errors[0].code ?? json.errors[0].error_code ?? 1)
              : 0;
            const destWord = parseStationId(json.targetId || json.target_id || json.targetLabel);
            const currentWord = parseStationId(json.current_station || json.currentStation);
            const statusWord = mapStatusToWord(statusStr);
            const controllerTempWord = coerceWordValue(
              json.controllerInfo?.temp ?? json.controller_temp ?? json.controllerInfo?.temperature
            );
            const xRaw = json.x ?? json.position?.x ?? null;
            const yRaw = json.y ?? json.position?.y ?? null;
            const angleRaw = json.angle ?? json.position?.yaw ?? null;
            const POSITION_SCALE = 1000; // m -> mm
            const xWord = xRaw != null ? coerceWordValue(Number(xRaw) * POSITION_SCALE) : null;
            const yWord = yRaw != null ? coerceWordValue(Number(yRaw) * POSITION_SCALE) : null;
            const angleWord = angleRaw != null ? coerceWordValue(Number(angleRaw)) : null; // rad 그대로
            const batteryTempWord = coerceWordValue(json.batteryTemp ?? json.battery_temp);
            const runTimeWord = timeToWordMs(json.todayTime ?? json.today_time ?? json.run_time);
            const totalRunTimeWord = timeToWordMs(json.totalTime ?? json.total_time ?? json.total_run_time);
            const infoValues = {
              name: nameWord,
              battery: batteryWord,
              error_code: errorCodeWord,
              destination: destWord,
              current_location: currentWord,
              status: statusWord,
              controller_temp: controllerTempWord,
              x: xWord,
              y: yWord,
              angle: angleWord,
              battery_temp: batteryTempWord,
              run_time: runTimeWord,
              total_run_time: totalRunTimeWord,
            };
            
            // PLC에 상태 기록
            if (robotForStatus) {
                writeAmrStatusToPlc(robotForStatus, statusFlags).catch(() => {});
                writeAmrInfoToPlc(robotForStatus, infoValues).catch(() => {});
            }

            // extract other fields...
            const location = json.current_station || json.currentStation ||
                (Array.isArray(json.finished_path)
                    ? json.finished_path.slice(-1)[0]
                    : null
                );
            
            // 수정된 필드 추출 로직
            const battery = (typeof json.battery_level === 'number')
                ? Math.round(json.battery_level * 100) // 0.97 → 97%
                : null;
            
            const voltage = (typeof json.voltage === 'number')
                ? json.voltage
                : null;
            
            const current_map = json.current_map || null;
            
            // AMR 위치 정보
            const pos = {
                x: json.x ?? json.position?.x ?? 0,
                y: json.y ?? json.position?.y ?? 0,
                angle: json.angle ?? json.position?.yaw ?? 0,
                qw: json.qw ?? 0,
                qx: json.qx ?? 0,
                qy: json.qy ?? 0,
                qz: json.qz ?? 0,
                roll: json.roll ?? 0,
                pitch: json.pitch ?? 0,
                yaw: json.yaw ?? json.angle ?? 0,
                block_x: json.block_x ?? 0,
                block_y: json.block_y ?? 0,
            };
            
            // Jack 정보
            const jackInfo = json.jack || {};
            const jackHeight = jackInfo.jack_height ?? 0;
            const jackState = jackInfo.jack_state ?? 0;
            const jackEnabled = jackInfo.jack_enable ?? false;
            
            // 기타 정보
            const current = (typeof json.current === 'number') ? json.current : null;
            const isCharging = json.charging === true;
            const isEmergency = json.emergency === true;
            
            // 속도 정보
            const vx = json.vx ?? 0;
            const vy = json.vy ?? 0;
            const w = json.w ?? 0;
            
            // 로봇 상태 정보 
            const batteryTemp = json.battery_temp ?? 0;
            const taskStatus = json.task_status ?? 0;
            const runningStatus = json.running_status ?? 0;
            const blocked = json.blocked === true;
            const slowed = json.slowed === true;
            const confidence = json.confidence ?? 0;
            
            // DI/DO 센서 정보 추출 (실제 로봇 JSON 구조에 맞춤)
            const diSensors = json.DI || json.dI || json.di || json.digitalInputs || json.digital_inputs || [];
            const doSensors = json.DO || json.dO || json.do || json.digitalOutputs || json.digital_outputs || [];
            
            // 모터 정보 추출
            const motorInfo = json.motor_info || [];
            
            // 추가 센서/상태 정보
            const imuData = {
                acc_x: json.acc_x ?? 0,
                acc_y: json.acc_y ?? 0,
                acc_z: json.acc_z ?? 0,
                pitch: json.pitch ?? 0,
                roll: json.roll ?? 0,
                yaw: json.yaw ?? 0
            };
            
            const controllerInfo = {
                temp: json.controller_temp ?? 0,
                humidity: json.controller_humi ?? 0,
                voltage: json.controller_voltage ?? 0
            };
            
            const next_location = json.next_station || json.nextStation || 
                                  (json.target_id ? json.target_id : null);

            const payloadForDb = {
                name,
                status: statusStr,
                location,
                next_location: next_location,
                task_step: json.task_step || json.taskStep || null,
                battery, 
                voltage, 
                current_map: current_map,
                position: JSON.stringify(pos),
                additional_info: JSON.stringify({
                    // 핵심 상태 정보
                    jackHeight,
                    jackState,
                    jackEnabled,
                    jackError: jackInfo.jack_error_code ?? 0,
                    current,
                    charging: isCharging,
                    emergency: isEmergency,
                    batteryTemp,
                    
                    // 이동 정보
                    vx,
                    vy,
                    w,
                    odo: json.odo ?? 0,
                    blocked,
                    slowed,
                    confidence,
                    
                    // 작업 정보
                    runningStatus,
                    taskStatus,
                    targetId: json.target_id,
                    targetLabel: json.target_label,
                    
                    // 장치 정보
                    rollerInfo: json.roller,
                    hookInfo: json.hook,
                    nearestObstacles: json.nearest_obstacles,
                    errors: json.errors,
                    warnings: json.warnings,
                    
                    // DI/DO 센서 정보 (실제 로봇 구조)
                    diSensors: diSensors,
                    doSensors: doSensors,
                    
                    // 모터 정보
                    motorInfo: motorInfo,
                    
                    // IMU 센서 정보
                    imuData: imuData,
                    
                    // 컨트롤러 정보
                    controllerInfo: controllerInfo,
                    
                    // 기타 상태 정보
                    autoCharge: json.auto_charge ?? false,
                    manualCharge: json.manual_charge ?? false,
                    electric: json.electric ?? false,
                    brake: json.brake ?? false,
                    isStop: json.is_stop ?? false,
                    inForbiddenArea: json.in_forbidden_area ?? false,
                    
                    // 위치/맵 관련
                    currentMapMd5: json.current_map_md5,
                    locMethod: json.loc_method ?? 0,
                    locState: json.loc_state ?? 0,
                    similarity: json.similarity ?? 0,
                    
                    // 시간 정보
                    todayOdo: json.today_odo ?? 0,
                    todayTime: json.today_time ?? 0,
                    totalTime: json.total_time ?? 0,
                    
                    // 버전 정보
                    version: json.version,
                    model: json.model,
                    dspVersion: json.dsp_version,
                    gyroVersion: json.gyro_version,
                }),
                timestamp: new Date(),
            };

            try {
                let existing = await Robot.findOne({ where: { ip } });
                if (!existing) {
                    // IP 매칭 실패 시 이름으로 재시도
                    existing = await Robot.findOne({ where: { name } });
                    if (existing) {
                        console.warn(`[AMR Push] IP(${ip})로 로봇 미조회 → name(${name})로 업데이트`);
                    } else {
                        console.warn(`[AMR Push] 로봇 미조회 (ip=${ip}, name=${name}) → 상태 업데이트 스킵`);
                    }
                }
                if (existing) {
                    await existing.update(payloadForDb);
                }
                lastRecTime.set(name, Date.now());
            } catch (e) {
                console.error('[AMR Push] DB save error:', e.message);
            }
        }
    });

    sock.on('error', async err => {
        console.warn(`[AMR] socket error on ${ip}:`, err.message);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });

    sock.on('close', () => {
        console.warn(`[AMR] connection closed ${ip}`);
        sockets.delete(ip);
        markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });
}

async function connect(ip) {
    if (sockets.has(ip)) return;
    const sock = net.createConnection({ port: PUSH_PORT, host: ip });
    sock.setTimeout(2000);

    sock.on('error', async err => {
        console.warn(`[AMR] connect error ${ip}:`, err.message);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
    });

    sock.on('connect', async () => {
        // IP로 AMR 이름 찾기
        let amrName = 'unknown';
        try {
            const robot = await Robot.findOne({ where: { ip } });
            if (robot) {
                amrName = robot.name;
            }
        } catch (e) {
            console.error(`[AMR] error finding robot name for IP ${ip}:`, e.message);
        }
        
        const localPort = sock.localPort;
        console.log(`[AMR] connected to ${ip} (AMR: ${amrName}, local port: ${localPort})`);
        sockets.set(ip, sock);
        sock.setTimeout(0);
        //logConnChange(`AMR:${ip}`, true);
        handlePush(sock, ip);
    });

    sock.on('timeout', async () => {
        console.warn(`[AMR] timeout on ${ip}`);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });
}

// reconnect loop
let connecting = false;
setInterval(async () => {
    if (connecting) return;
    connecting = true;
    try {
        const rows = await Robot.findAll({
            where: { ip: { [Op.not]: null } },
            attributes: ['ip'],
            raw: true,
        });
        for (const { ip } of rows) {
            await connect(ip);
        }
    } catch (e) {
        console.error('[AMR] connect loop error:', e.message);
    } finally {
        connecting = false;
    }
}, 2000);

// stale‐entry cleanup
setInterval(async () => {
    const now = Date.now();
    for (const [name, ts] of lastRecTime.entries()) {
        if (now - ts > 2000) {
            console.warn(`[AMR] stale entry expired for ${name}`);
            lastRecTime.delete(name);
            lastTimeValue.delete(name); // time 값 맵도 정리
            lastTimeUpdate.delete(name); // time 업데이트 시간 맵도 정리
            // DB 상태 업데이트
            await markDisconnectedByName(name);
            //logConnChange(`AMR:${name}`, false, { robot_name: name });

            // 해당 로봇의 IP로 소켓도 강제 종료 → 재접속 유도
            try {
                const robot = await Robot.findOne({ where: { name } });
                if (robot && robot.ip && sockets.has(robot.ip)) {
                    sockets.get(robot.ip).destroy();
                    sockets.delete(robot.ip);
                    console.log(`[AMR] socket destroyed for ${name} (${robot.ip})`);
                }
            } catch (e) {
                console.error(`[AMR] error destroying socket for ${name}:`, e.message);
            }
        }
    }
}, 1000);

// time 값 변화 확인 및 재접속 로직
setInterval(async () => {
    const now = Date.now();
    for (const [name, lastUpdate] of lastTimeUpdate.entries()) {
        if (now - lastUpdate > 10000) { // 10초 동안 time 값이 변하지 않음
            console.warn(`[AMR] time value not changed for ${name} for 10 seconds, attempting reconnect...`);
            
            try {
                await reconnectAmr(name);
                console.log(`[AMR] reconnected successfully for ${name} due to stale time value`);
                
                // 재접속 후 타이머 초기화
                lastTimeUpdate.set(name, now);
            } catch (e) {
                console.error(`[AMR] failed to reconnect ${name}:`, e.message);
            }
        }
    }
}, 5000); // 5초마다 체크

async function reconnectAmr(name) {
    const robot = await Robot.findOne({ where: { name } });
    if (!robot || !robot.ip) throw new Error('AMR not found');
    const ip = robot.ip;
    
    console.log(`[AMR] initiating reconnect for ${name} (${ip})`);
    
    if (sockets.has(ip)) {
        sockets.get(ip).destroy();
        sockets.delete(ip);
        console.log(`[AMR] existing socket destroyed for ${name} (${ip})`);
    }
    
    await connect(ip);
    console.log(`[AMR] reconnect attempt completed for ${name} (${ip})`);
}

console.log('🔧 AMR Monitor Service started');
module.exports = {
    lastRecTime, sockets,
    reconnectAmr,
};
