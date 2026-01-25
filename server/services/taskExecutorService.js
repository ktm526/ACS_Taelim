// services/taskExecutorService.js
const ModbusRTU = require("modbus-serial");
const net = require("net");
const plc = require("./plcMonitorService");
const { Task, TaskStep, TaskLog } = require("../models");
const Robot = require("../models/Robot");
const MapDB = require("../models/Map");
const { sendGotoNav } = require("./navService");

// 로그 기록 함수
async function logTaskEvent(taskId, event, message, options = {}) {
  try {
    await TaskLog.create({
      task_id: taskId,
      robot_id: options.robotId || null,
      robot_name: options.robotName || null,
      step_seq: options.stepSeq ?? null,
      step_type: options.stepType || null,
      event,
      message,
      payload: options.payload ? JSON.stringify(options.payload) : null,
    });
  } catch (err) {
    console.error('[TaskLog] 로그 기록 실패:', err.message);
  }
}

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const WORD_MODE = (process.env.PLC_WORD_MODE || "holding").toLowerCase(); // holding | input
const MANI_CMD_PORT = Number.parseInt(process.env.MANI_CMD_PORT || "19207", 10);
const MANI_CMD_API = Number.parseInt(process.env.MANI_CMD_API || "4021", 10);
const ROBOT_IO_PORT = Number.parseInt(process.env.ROBOT_IO_PORT || "19210", 10);
const ROBOT_DO_API = Number.parseInt(process.env.ROBOT_DO_API || "6001", 10);
const ROBOT_DI_API = Number.parseInt(process.env.ROBOT_DI_API || "6020", 10); // 

const MANI_WORK_TIMEOUT_MS = Number.parseInt(
  process.env.MANI_WORK_TIMEOUT_MS || "3000000",
  10
);
const MANI_WORK_DO_ID = Number.parseInt(
  process.env.MANI_WORK_DO_ID || "4",
  10
);
const MANI_WORK_OK_DI = Number.parseInt(
  process.env.MANI_WORK_OK_DI || "11",
  10
);
const MANI_WORK_ERR_DI = Number.parseInt(
  process.env.MANI_WORK_ERR_DI || "12",
  10
);

const EXECUTE_INTERVAL_MS = 1000;
const robotLocks = new Map();
const inFlightNav = new Set();
const inFlightMani = new Set();
let timer = null;
let maniSerial = 0;

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

async function readRegisterRange(client, start, qty) {
  if (WORD_MODE === "input") {
    const res = await client.readInputRegisters(start, qty);
    return res?.data ?? [];
  }
  const res = await client.readHoldingRegisters(start, qty);
  return res?.data ?? [];
}

async function writePlc(id, value) {
  const parsed = parseId(id);
  if (!parsed) throw new Error(`invalid plc id: ${id}`);
  const client = new ModbusRTU();
  client.setTimeout(2000);
  await client.connectTCP(HOST, { port: PORT });
  client.setID(UNIT_ID);
  try {
    if (parsed.type === "bit") {
      const data = await readRegisterRange(client, parsed.wordAddr, 1);
      const current = Number(data?.[0] ?? 0) & 0xffff;
      const mask = 1 << parsed.bitIndex;
      const next = value ? current | mask : current & ~mask;
      await client.writeRegisters(parsed.wordAddr, [next]);
      return next;
    }
    await client.writeRegisters(parsed.wordAddr, [Number(value) || 0]);
    return Number(value) || 0;
  } finally {
    try {
      client.close(() => {});
    } catch {}
  }
}

function readPlc(id) {
  const parsed = parseId(id);
  if (!parsed) return null;
  if (parsed.type === "bit") {
    const on = plc.getBit(id);
    return typeof on === "boolean" ? (on ? 1 : 0) : null;
  }
  const value = plc.getWord(parsed.wordAddr);
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function parsePayload(step) {
  try {
    return JSON.parse(step.payload || "{}");
  } catch {
    return {};
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPacket(code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(16);
  head.writeUInt8(0x5a, 0);
  head.writeUInt8(0x01, 1);
  head.writeUInt16BE(++maniSerial & 0xffff, 2);
  head.writeUInt32BE(body.length, 4);
  head.writeUInt16BE(code, 8);
  return Buffer.concat([head, body]);
}

function sendTcpCommand(ip, port, apiCode, payload, logLabel = "") {
  return new Promise((resolve, reject) => {
    console.log(`[TCP] ${logLabel} → ${ip}:${port} API=0x${apiCode.toString(16)} payload=${JSON.stringify(payload)}`);
    const sock = net.createConnection(port, ip);
    const chunks = [];
    let resolved = false;
    
    const finish = (err, response) => {
      if (resolved) return;
      resolved = true;
      try { sock.destroy(); } catch {}
      if (err) {
        console.error(`[TCP] ${logLabel} ✗ 실패: ${err.message}`);
        reject(err);
      } else {
        console.log(`[TCP] ${logLabel} ✓ 완료`);
        resolve(response);
      }
    };
    
    sock.on("data", (chunk) => {
      chunks.push(chunk);
      // 응답 파싱 시도
      const buf = Buffer.concat(chunks);
      if (buf.length >= 16) {
        const bodyLen = buf.readUInt32BE(4);
        if (buf.length >= 16 + bodyLen) {
          const bodyBuf = buf.slice(16, 16 + bodyLen);
          try {
            const respJson = JSON.parse(bodyBuf.toString("utf8"));
            console.log(`[TCP] ${logLabel} ← 응답: ${JSON.stringify(respJson)}`);
            // ret_code가 0이 아니면 에러로 처리
            if (respJson.ret_code !== undefined && respJson.ret_code !== 0) {
              const errMsg = respJson.err_msg || `ret_code: ${respJson.ret_code}`;
              finish(new Error(errMsg), respJson);
            } else {
              finish(null, respJson);
            }
          } catch {
            console.log(`[TCP] ${logLabel} ← 응답(raw): ${bodyBuf.toString("utf8")}`);
            finish(null, bodyBuf.toString("utf8"));
          }
        }
      }
    });
    
    sock.once("connect", () => {
      sock.write(buildPacket(apiCode, payload));
    });
    
    sock.once("error", (e) => finish(e));
    sock.setTimeout(3000, () => {
      if (!resolved) {
        // 타임아웃이지만 데이터가 없으면 에러, 있으면 그냥 완료
        if (chunks.length === 0) {
          finish(new Error("tcp timeout (no response)"));
        } else {
          console.log(`[TCP] ${logLabel} ← 응답 타임아웃 (partial data: ${Buffer.concat(chunks).length} bytes)`);
          finish(null, null);
        }
      }
    });
  });
}

function setRobotDo(ip, doId, status, logLabel = "") {
  const payload = {
    id: Number(doId),
    status: status === true || status === 1, // boolean 타입으로 전송
  };
  return sendTcpCommand(ip, ROBOT_IO_PORT, ROBOT_DO_API, payload, `${logLabel} DO${doId}=${status ? 1 : 0}`);
}

function setRobotDI(ip, diId, status, logLabel = "") {
  const payload = {
    id: Number(diId),
    status: status === true || status === 1, // boolean 타입으로 전송
  };
  return sendTcpCommand(ip, ROBOT_IO_PORT, ROBOT_DI_API, payload, `${logLabel} DI${diId}=${status ? 1 : 0}`);
}

function sendManiCommand(ip, payload, logLabel = "") {
  // API 문서에 따른 형식:
  // {
  //   "type": "module",
  //   "relative_path": "doosan_cmd.py",
  //   "script": "{\"CMD_ID\": \"1\", \"CMD_FROM\": \"11\", \"CMD_TO\": \"21\", \"CMD_STOP\": \"0\"}"
  // }
  const cmdScript = {
    CMD_ID: String(payload.CMD_ID || "0"),
    CMD_FROM: String(payload.CMD_FROM || "0"),
    CMD_TO: String(payload.CMD_TO || "0"),
    CMD_STOP: String(payload.CMD_STOP || "0"),
    VISION_CHECK: String(
      payload.VISION_CHECK === 1 || payload.vision_check === 1 ? 1 : 0
    ),
  };
  const body = {
    type: "module",
    relative_path: "doosan_cmd.py",
    script: JSON.stringify(cmdScript),
  };
  return sendTcpCommand(ip, MANI_CMD_PORT, MANI_CMD_API, body, `${logLabel} MANI_CMD`);
}

function normalizeIoStatus(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return raw === "1" || raw.toLowerCase() === "true";
  return null;
}

function getSensorStatus(list, id) {
  if (!Array.isArray(list)) return null;
  const target = list.find((s) => {
    const sensorId = s?.id ?? s?.no ?? s?.index ?? s?.channel ?? s?.ch;
    return Number(sensorId) === Number(id);
  });
  if (!target) return null;
  const raw = target.status ?? target.value ?? target.state ?? target.on ?? target.active;
  return normalizeIoStatus(raw);
}

function getRobotDiStatus(robot, diId) {
  if (!robot?.additional_info) return null;
  try {
    const info =
      typeof robot.additional_info === "string"
        ? JSON.parse(robot.additional_info)
        : robot.additional_info;
    return getSensorStatus(info?.diSensors, diId);
  } catch {
    return null;
  }
}

async function waitForManiResult(robotId, taskId, logLabel = "") {
  const started = Date.now();
  let pollCount = 0;
  while (Date.now() - started <= MANI_WORK_TIMEOUT_MS) {
    pollCount++;
    const fresh = await Robot.findByPk(robotId);
    const diOk = getRobotDiStatus(fresh, MANI_WORK_OK_DI);
    const diErr = getRobotDiStatus(fresh, MANI_WORK_ERR_DI);
    
    // 5초마다 상태 로그
    if (pollCount % 10 === 1) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`${logLabel}: [DI 폴링 ${elapsed}초] DI${MANI_WORK_OK_DI}=${diOk}, DI${MANI_WORK_ERR_DI}=${diErr}`);
    }
    
    if (diOk === true) {
      console.log(`${logLabel}: DI${MANI_WORK_OK_DI}=1 감지 → false로 재설정 중...`);
      try {
        await setRobotDI(
          fresh.ip,
          0,  // DI 11을 false로 설정
          false,
          logLabel
        );
        // DI가 false로 변경되는 것을 확인
        let resetConfirmed = false;
        const resetStartTime = Date.now();
        const resetTimeout = 5000; // 5초 타임아웃
        while (Date.now() - resetStartTime <= resetTimeout) {
          await delay(200);
          const checkRobot = await Robot.findByPk(robotId);
          const diOkAfterReset = getRobotDiStatus(checkRobot, MANI_WORK_OK_DI);
          if (diOkAfterReset === false) {
            resetConfirmed = true;
            console.log(`${logLabel}: DI${MANI_WORK_OK_DI} false로 재설정 확인됨`);
            break;
          }
        }
        if (resetConfirmed) {
          return "success";
        } else {
          console.warn(`${logLabel}: DI${MANI_WORK_OK_DI} false 재설정 확인 실패 (타임아웃), 계속 진행`);
          return "success"; // 타임아웃이어도 성공으로 처리
        }
      } catch (err) {
        console.error(`${logLabel}: DI${MANI_WORK_OK_DI} 재설정 실패:`, err.message);
        return "success"; // 재설정 실패해도 성공으로 처리
      }
    }
    if (diErr === true) {
      console.log(`${logLabel}: DI${MANI_WORK_ERR_DI}=1 감지 → false로 재설정 후 에러 처리`);
      try {
        await setRobotDI(
          fresh.ip,
          1,  // DI 12를 false로 설정
          false,
          logLabel
        );
        // DI 12가 false로 변경되는 것을 확인
        let resetConfirmed = false;
        const resetStartTime = Date.now();
        const resetTimeout = 5000;
        while (Date.now() - resetStartTime <= resetTimeout) {
          await delay(200);
          const checkRobot = await Robot.findByPk(robotId);
          const diErrAfterReset = getRobotDiStatus(checkRobot, MANI_WORK_ERR_DI);
          if (diErrAfterReset === false) {
            resetConfirmed = true;
            console.log(`${logLabel}: DI${MANI_WORK_ERR_DI} false로 재설정 확인됨`);
            break;
          }
        }
        if (!resetConfirmed) {
          console.warn(`${logLabel}: DI${MANI_WORK_ERR_DI} false 재설정 확인 실패 (타임아웃)`);
        }
      } catch (err) {
        console.error(`${logLabel}: DI${MANI_WORK_ERR_DI} 재설정 실패:`, err.message);
      }
      return "error";
    }
    if (taskId) {
      const t = await Task.findByPk(taskId);
      if (["PAUSED", "CANCELED", "FAILED"].includes(t?.status)) return "canceled";
    }
    await delay(500);
  }
  return "timeout";
}

async function markStepFailed(step, robot, errorMsg) {
  await step.update({ status: "FAILED" });
  await Task.update({ status: "FAILED" }, { where: { id: step.task_id } });
  await logTaskEvent(step.task_id, "STEP_FAILED", errorMsg || `스텝 #${step.seq} (${step.type}) 실패`, {
    robotId: robot?.id,
    robotName: robot?.name,
    stepSeq: step.seq,
    stepType: step.type,
    payload: parsePayload(step),
  });
  await logTaskEvent(step.task_id, "TASK_FAILED", `스텝 #${step.seq} 실패로 태스크 중단`, {
    robotId: robot?.id,
    robotName: robot?.name,
  });
}

async function waitUntil(cond, ms, taskId) {
  const start = Date.now();
  while (Date.now() - start <= ms) {
    const ok = await cond();
    if (ok) return true;
    if (taskId) {
      const t = await Task.findByPk(taskId);
      if (["PAUSED", "CANCELED", "FAILED"].includes(t?.status)) return false;
    }
    await delay(500);
  }
  return false;
}

function resolveStationId(stations, dest) {
  const target = stations.find(
    (s) =>
      String(s.id) === String(dest) ||
      s.name === dest ||
      s.station_name === dest
  );
  if (!target) return null;
  const displayName = target.name ?? target.station_name ?? target.id;
  return { id: target.id, name: displayName };
}

async function executeStep(step, robot) {
  const payload = parsePayload(step);
  const stepLabel = `[Executor] Task#${step.task_id} Step#${step.seq}(${step.type})`;
  
  if (step.type === "NAV") {
    if (!payload.dest) throw new Error("NAV dest missing");
    const mapRow = await MapDB.findOne({ where: { is_current: true } });
    const stations = JSON.parse(mapRow?.stations || "{}").stations || [];
    const target = resolveStationId(stations, payload.dest);
    if (!target) {
      console.error(`${stepLabel}: 스테이션 '${payload.dest}' 찾을 수 없음`);
      throw new Error(`NAV station not found: ${payload.dest}`);
    }

    if (!inFlightNav.has(step.id)) {
      console.log(`${stepLabel}: NAV 명령 전송 → ${target.name}(${target.id})`);
      await Robot.update(
        { destination: target.name },
        { where: { id: robot.id } }
      );
      await sendGotoNav(robot.ip, target.id, "SELF_POSITION", String(Date.now()));
      inFlightNav.add(step.id);
    }

    const ok = await waitUntil(async () => {
      const fresh = await Robot.findByPk(robot.id);
      const arrived = fresh && String(fresh.location) === String(target.id);
      // 10초마다 위치 로깅
      return arrived;
    }, 30 * 60 * 1000, step.task_id);

    if (!ok) {
      console.log(`${stepLabel}: NAV 대기 중 (목적지: ${target.name})`);
      return false;
    }
    console.log(`${stepLabel}: NAV 완료 → ${target.name} 도착`);
    inFlightNav.delete(step.id);
    await delay(5000);
    return true;
  }
  
  if (step.type === "MANI_WORK") {
    const cmdId = payload.CMD_ID;
    const cmdFrom = payload.CMD_FROM;
    const cmdTo = payload.CMD_TO;
    const vision_check = payload.VISION_CHECK;

    if (cmdId === undefined || cmdFrom === undefined || cmdTo === undefined || vision_check == undefined) {
      console.error(`${stepLabel}: MANI_WORK payload 누락 (ID=${cmdId}, FROM=${cmdFrom}, TO=${cmdTo})`);
      await markStepFailed(step, robot, "MANI_WORK payload 누락");
      throw new Error("MANI_WORK payload missing");
    }

    if (!inFlightMani.has(step.id)) {
      console.log(`${stepLabel}: ══════════════════════════════════════════`);
      console.log(`${stepLabel}: MANI_WORK 시작`);
      console.log(`${stepLabel}:   Robot IP: ${robot.ip}`);
      console.log(`${stepLabel}:   CMD_ID: ${cmdId}, CMD_FROM: ${cmdFrom}, CMD_TO: ${cmdTo}`);
      console.log(`${stepLabel}:   DO Port: ${ROBOT_IO_PORT}, DO API: 0x${ROBOT_DO_API.toString(16)}, DO ID: ${MANI_WORK_DO_ID}`);
      console.log(`${stepLabel}:   MANI Port: ${MANI_CMD_PORT}, MANI API: 0x${MANI_CMD_API.toString(16)}`);
      try {
        console.log(`${stepLabel}: [1/2] MANI 명령 전송 중...`);
        await sendManiCommand(robot.ip, payload, stepLabel);
        console.log(`${stepLabel}: [2/2] DO${MANI_WORK_DO_ID}=1 전송 중...`);
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, true, stepLabel);
        inFlightMani.add(step.id);
        console.log(`${stepLabel}: 명령 전송 완료, DI 응답 대기 시작`);
      } catch (err) {
        console.error(`${stepLabel}: MANI_WORK 명령 전송 실패:`, err.message);
        await markStepFailed(step, robot, `MANI_WORK 명령 전송 실패: ${err.message}`);
        throw err;
      }
    }

    console.log(`${stepLabel}: DI${MANI_WORK_OK_DI}(성공) / DI${MANI_WORK_ERR_DI}(에러) 폴링 중...`);
    const result = await waitForManiResult(robot.id, step.task_id, stepLabel);
    
    if (result === "success") {
      console.log(`${stepLabel}: ✓ MANI_WORK 성공 (DI${MANI_WORK_OK_DI}=1 감지)`);
      inFlightMani.delete(step.id);
      try {
        console.log(`${stepLabel}: DO${MANI_WORK_DO_ID}=0 리셋 중...`);
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false, stepLabel);
      } catch (e) {
        console.warn(`${stepLabel}: DO 리셋 실패 (무시): ${e.message}`);
      }
      
      // ═══════════════════════════════════════════════════════════════
      // AMR 슬롯 상태 업데이트
      // ═══════════════════════════════════════════════════════════════
      try {
        const amrSlotNo = payload.AMR_SLOT_NO;
        const productNo = payload.PRODUCT_NO;
        
        if (amrSlotNo !== undefined) {
          // Robot의 slots 배열 파싱
          const currentSlots = JSON.parse(robot.slots || '[]');
          
          // 슬롯 찾기 (slot_no로 매칭)
          const slotIdx = currentSlots.findIndex(
            s => (typeof s === 'object' ? s.slot_no : s) === amrSlotNo
          );
          
          if (slotIdx !== -1) {
            const isLoading = Number(cmdTo) === Number(amrSlotNo); // 적재 (CMD_TO가 슬롯)
            const isUnloading = Number(cmdFrom) === Number(amrSlotNo); // 하역 (CMD_FROM이 슬롯)
            
            if (isLoading && productNo !== undefined) {
              // 적재: 해당 슬롯에 제품 번호 저장
              if (typeof currentSlots[slotIdx] === 'object') {
                currentSlots[slotIdx].product_type = Number(productNo);
              } else {
                currentSlots[slotIdx] = { slot_no: amrSlotNo, product_type: Number(productNo) };
              }
              console.log(`${stepLabel}: 슬롯 ${amrSlotNo} ← 제품 ${productNo} 적재`);
            } else if (isUnloading) {
              // 하역: 해당 슬롯 비우기
              if (typeof currentSlots[slotIdx] === 'object') {
                currentSlots[slotIdx].product_type = 0;
              } else {
                currentSlots[slotIdx] = { slot_no: amrSlotNo, product_type: 0 };
              }
              console.log(`${stepLabel}: 슬롯 ${amrSlotNo} → 비움`);
            }
            
            // DB 업데이트
            await Robot.update(
              { slots: JSON.stringify(currentSlots) },
              { where: { id: robot.id } }
            );
          }
        }
      } catch (slotErr) {
        console.warn(`${stepLabel}: 슬롯 업데이트 실패 (무시): ${slotErr.message}`);
      }
      
      console.log(`${stepLabel}: ══════════════════════════════════════════`);
      return true;
    }
    if (result === "error") {
      console.error(`${stepLabel}: ✗ MANI_WORK 에러 (DI${MANI_WORK_ERR_DI}=1 감지)`);
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false, stepLabel);
      } catch {}
      await markStepFailed(step, robot, `MANI_WORK 에러 (DI${MANI_WORK_ERR_DI}=1 감지)`);
      console.log(`${stepLabel}: ══════════════════════════════════════════`);
      throw new Error("MANI_WORK failed (DI error)");
    }
    if (result === "timeout") {
      console.error(`${stepLabel}: ✗ MANI_WORK 타임아웃 (${MANI_WORK_TIMEOUT_MS / 1000}초 경과)`);
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false, stepLabel);
      } catch {}
      await markStepFailed(step, robot, `MANI_WORK 타임아웃 (${MANI_WORK_TIMEOUT_MS / 1000}초 경과)`);
      console.log(`${stepLabel}: ══════════════════════════════════════════`);
      throw new Error("MANI_WORK timeout");
    }
    if (result === "canceled") {
      console.log(`${stepLabel}: MANI_WORK 취소됨 (태스크 상태 변경)`);
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false, stepLabel);
      } catch {}
      return false;
    }
    return false;
  }
  
  if (step.type === "PLC_WRITE") {
    if (!payload.PLC_BIT) throw new Error("PLC_WRITE id missing");
    console.log(`${stepLabel}: PLC_WRITE ${payload.PLC_BIT}=${payload.PLC_DATA}`);
    await writePlc(payload.PLC_BIT, payload.PLC_DATA);
    console.log(`${stepLabel}: PLC_WRITE 완료`);
    return true;
  }
  
  if (step.type === "PLC_READ") {
    if (!payload.PLC_ID) throw new Error("PLC_READ id missing");
    const current = readPlc(payload.PLC_ID);
    const match = current !== null && Number(current) === Number(payload.EXPECTED);
    if (!match) {
      // 매 호출마다 로그하면 너무 많으므로 조건부로
      // console.log(`${stepLabel}: PLC_READ ${payload.PLC_ID}=${current} (기대값:${payload.EXPECTED}) 대기 중`);
    } else {
      console.log(`${stepLabel}: PLC_READ ${payload.PLC_ID}=${current} ✓`);
    }
    return match;
  }
  
  return true;
}

async function progressTask(task, robot) {
  const steps = (task.steps || []).slice().sort((a, b) => a.seq - b.seq);
  if (!steps.length) {
    console.log(`[Executor] Task#${task.id}: 스텝 없음 → DONE`);
    await task.update({ status: "DONE" });
    await logTaskEvent(task.id, "TASK_DONE", "스텝 없음으로 완료", {
      robotId: robot.id,
      robotName: robot.name,
    });
    return;
  }
  let seq = Number(task.current_seq ?? 0);
  const step = steps.find((s) => s.seq === seq);
  if (!step) {
    console.log(`[Executor] Task#${task.id}: 모든 스텝 완료 → DONE`);
    await task.update({ status: "DONE" });
    await logTaskEvent(task.id, "TASK_DONE", `모든 ${steps.length}개 스텝 완료`, {
      robotId: robot.id,
      robotName: robot.name,
    });
    return;
  }

  if (step.status === "DONE") {
    await task.update({ current_seq: seq + 1 });
    return;
  }

  if (step.status !== "RUNNING") {
    console.log(`[Executor] Task#${task.id} Step#${seq}(${step.type}): 시작`);
    await step.update({ status: "RUNNING" });
    await logTaskEvent(task.id, "STEP_STARTED", `스텝 #${seq} (${step.type}) 시작`, {
      robotId: robot.id,
      robotName: robot.name,
      stepSeq: seq,
      stepType: step.type,
      payload: parsePayload(step),
    });
  }

  const ok = await executeStep(step, robot);
  if (step.type === "PLC_READ" && !ok) {
    // 조건 미충족이면 RUNNING 상태로 대기 (PENDING으로 돌리면 STEP_STARTED 무한 반복)
    return;
  }
  if (step.type === "NAV" && !ok) {
    // 이동 완료 전 대기
    await step.update({ status: "RUNNING" });
    return;
  }
  if (step.type === "MANI_WORK" && !ok) {
    await step.update({ status: "RUNNING" });
    return;
  }

  console.log(`[Executor] Task#${task.id} Step#${seq}(${step.type}): 완료 ✓`);
  await step.update({ status: "DONE" });
  await logTaskEvent(task.id, "STEP_DONE", `스텝 #${seq} (${step.type}) 완료`, {
    robotId: robot.id,
    robotName: robot.name,
    stepSeq: seq,
    stepType: step.type,
  });
  await task.update({ current_seq: seq + 1 });

  const lastSeq = steps[steps.length - 1]?.seq;
  if (seq + 1 > lastSeq) {
    console.log(`[Executor] Task#${task.id}: 모든 스텝 완료 → DONE`);
    await task.update({ status: "DONE" });
    await logTaskEvent(task.id, "TASK_DONE", `모든 ${steps.length}개 스텝 완료`, {
      robotId: robot.id,
      robotName: robot.name,
    });
  }
}

async function handleRobot(robot, tasks) {
  if (robotLocks.get(robot.id)) return;
  robotLocks.set(robot.id, true);
  try {
    const runningTask = tasks.find((t) => t.status === "RUNNING");
    const pendingTask = tasks.find((t) => t.status === "PENDING");

    if (runningTask) {
      await progressTask(runningTask, robot);
      return;
    }

    if (pendingTask) {
      // '대기' 또는 '작업 중' 상태일 때 태스크 시작 허용
      // (amrMonitorService에서 PENDING 태스크가 있으면 '작업 중'으로 변경하므로)
      if (robot.status === "대기" || robot.status === "작업 중") {
        console.log(`[Executor] Robot ${robot.name}: Task#${pendingTask.id} 시작 (${pendingTask.steps?.length || 0} steps, 로봇상태: ${robot.status})`);
        await pendingTask.update({ status: "RUNNING", current_seq: 0 });
        await logTaskEvent(pendingTask.id, "TASK_STARTED", `태스크 시작 (${pendingTask.steps?.length || 0} 스텝)`, {
          robotId: robot.id,
          robotName: robot.name,
        });
        await progressTask(pendingTask, robot);
      } else {
        // 로봇이 대기/작업 중 상태가 아니면 대기
        console.log(`[Executor] Robot ${robot.name}: Task#${pendingTask.id} 대기 중 (로봇 상태: "${robot.status}" ≠ "대기/작업 중")`);
      }
    }
  } catch (err) {
    console.error(`[Executor] Robot ${robot.name}(${robot.id}) 오류:`, err?.message || err);
  } finally {
    robotLocks.set(robot.id, false);
  }
}

let tickCount = 0;

async function tick() {
  tickCount++;
  const robots = await Robot.findAll();
  const tasks = await Task.findAll({
    where: { status: ["PENDING", "RUNNING"] },
    include: [{ model: TaskStep, as: "steps" }],
    order: [["id", "ASC"]],
  });

  // 전체 RUNNING 태스크가 있는지 확인 (어떤 로봇이든)
  const hasGlobalRunningTask = tasks.some((t) => t.status === "RUNNING");

  // 10초마다 상태 요약 출력
  if (tickCount % 10 === 1) {
    const taskSummary = tasks.length ? tasks.map(t => `#${t.id}(${t.status})`).join(', ') : '없음';
    console.log(`[Executor] tick#${tickCount}: 로봇 ${robots.length}대, 활성 태스크: ${taskSummary}, 글로벌 RUNNING: ${hasGlobalRunningTask}`);
  }

  const tasksByRobot = new Map();
  tasks.forEach((task) => {
    const list = tasksByRobot.get(task.robot_id) || [];
    list.push(task);
    tasksByRobot.set(task.robot_id, list);
  });

  for (const robot of robots) {
    if (["연결 끊김", "오류"].includes(robot.status)) {
      // 스킵되는 로봇 로그 (너무 자주 나오면 주석 처리)
      // console.log(`[Executor] Robot ${robot.name} 스킵 (상태: ${robot.status})`);
      continue;
    }
    const list = tasksByRobot.get(robot.id) || [];
    if (!list.length) continue;
    await handleRobot(robot, list);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) =>
      console.error("[TaskExecutor] tick error:", err?.message || err)
    );
  }, EXECUTE_INTERVAL_MS);
  tick().catch((err) =>
    console.error("[TaskExecutor] tick error:", err?.message || err)
  );
  console.log("[TaskExecutor] service started");
}

start();

module.exports = { start };