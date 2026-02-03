// [시나리오]
// 1. in스토커 -> 연마기
//  - in스토커 enable
//  - 인스토커로 이동해서 -> 물건 (최대 6개)를 AMR에 적재하고,
//  - 연마기 input 가능 개수가 ok 될 때 까지 대기 (max 대기시간을 세팅값에서 사용해서, 지나면 alarm)
//  - 연마기(제품 조건에 맞는)에 투입
//  - 복귀

const plc = require("./plcMonitorService");
const { sendAndReceive } = require("./tcpTestService");
const DeviceInStocker = require("../models/DeviceInStocker");
const DeviceGrinder = require("../models/DeviceGrinder");
const DeviceOutStocker = require("../models/DeviceOutStocker");
const DeviceConveyor = require("../models/DeviceConveyor");
const Settings = require("../models/Settings");
const Robot = require("../models/Robot");
const { Task, TaskStep, TaskLog } = require("../models");

// 로봇 매니퓰레이터 TASK_STATUS 확인 (0이면 유휴 상태)
const DOOSAN_STATE_API = 4022;
const DOOSAN_STATE_PORT = 19207;
const DOOSAN_STATE_MESSAGE = {
  type: "module",
  relative_path: "doosan_state.py",
};

async function checkRobotTaskStatus(robotIp) {
  try {
    const response = await sendAndReceive(
      robotIp,
      DOOSAN_STATE_PORT,
      DOOSAN_STATE_API,
      DOOSAN_STATE_MESSAGE,
      3000 // 3초 타임아웃
    );
    if (response && response.response) {
      const taskStatus = response.response.TASK_STATUS;
      const isIdle = taskStatus === "0" || taskStatus === 0;
      if (!isIdle) {
        //console.log(`[TaskCreate] 로봇(${robotIp}) TASK_STATUS=${taskStatus} (작업 중) → 태스크 발행 스킵`);
      }
      return isIdle;
    }
    //console.warn(`[TaskCreate] 로봇(${robotIp}) doosan_state 응답 없음`);
    return false;
  } catch (err) {
    console.error(`[TaskCreate] 로봇(${robotIp}) TASK_STATUS 확인 실패:`, err.message);
    return false; // 실패 시 안전하게 발행하지 않음
  }
}

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

// 시나리오별 PLC 상태 수집 함수
function collectPlcStatusForScenario(scenario, config) {
  const status = {};
  
  // 헬퍼: PLC 값 + 주소 함께 기록
  const getBitWithAddr = (addr) => {
    if (!addr) return { addr: null, value: null };
    return { addr, value: plc.getBit(addr) };
  };
  const getWordWithAddr = (addr) => {
    if (!addr) return { addr: null, value: null };
    return { addr, value: plc.getWord(addr) };
  };
  
  if (scenario === 1) {
    // 인스토커 상태 (전체 신호)
    status.instocker = {};
    const sideSignals = safeParse(config.instockerSideSignals, {});
    for (const side of SIDES) {
      const signals = sideSignals[side] || {};
      status.instocker[side] = {
        work_available: getBitWithAddr(signals.work_available_id),
        working: getBitWithAddr(signals.working_id),
        work_done: getBitWithAddr(signals.work_done_id),
      };
    }
    // 인스토커 슬롯 상태 (전체)
    status.instocker_slots = {};
    for (const side of SIDES) {
      const slots = getSideSlots(config.instockerSlots, side);
      status.instocker_slots[side] = slots.slice(0, 6).map(slot => ({
        key: slot.key,
        amr_pos: slot.amr_pos,
        mani_pos: slot.mani_pos,
        product_type: getWordWithAddr(slot.product_type_id),
      }));
    }
    // 연마기 상태 (전체)
    status.grinders = [];
    for (const grinder of (config.grinders || [])) {
      const grinderStatus = {
        index: grinder.index,
        amr_pos: grinder.amr_pos,
        bypass: getBitWithAddr(grinder.bypass_id),
        positions: {},
      };
      for (const pos of POSITIONS) {
        const posData = grinder.positions?.[pos] || {};
        grinderStatus.positions[pos] = {
          mani_pos: posData.mani_pos,
          input_ready: getBitWithAddr(posData.input_ready_id),
          input_working: getBitWithAddr(posData.input_working_id),
          input_done: getBitWithAddr(posData.input_done_id),
        };
      }
      status.grinders.push(grinderStatus);
    }
  } else if (scenario === 2) {
    // 연마기 배출 상태 (전체)
    status.grinders = [];
    for (const grinder of (config.grinders || [])) {
      const grinderStatus = {
        index: grinder.index,
        amr_pos: grinder.amr_pos,
        bypass: getBitWithAddr(grinder.bypass_id),
        positions: {},
      };
      for (const pos of POSITIONS) {
        const posData = grinder.positions?.[pos] || {};
        grinderStatus.positions[pos] = {
          mani_pos: posData.mani_pos,
          output_ready: getBitWithAddr(posData.output_ready_id),
          output_working: getBitWithAddr(posData.output_working_id),
          output_done: getBitWithAddr(posData.output_done_id),
          product_type: getWordWithAddr(posData.product_type_id),
        };
      }
      status.grinders.push(grinderStatus);
    }
    // 아웃스토커 적재 가능 상태 (전체)
    status.outstocker = {};
    const outstockerSides = config.outstockerSides || {};
    for (const side of OUT_SIDES) {
      const sideData = outstockerSides[side] || {};
      status.outstocker[side] = {
        amr_pos: sideData.amr_pos,
        bypass: getBitWithAddr(sideData.bypass_id),
        rows: {},
      };
      for (const row of OUT_ROWS) {
        const rowData = sideData.rows?.[row] || {};
        status.outstocker[side].rows[row] = {
          mani_pos: rowData.mani_pos,
          load_ready: getBitWithAddr(rowData.load_ready_id),
          load_working: getBitWithAddr(rowData.working_id),
          load_done: getBitWithAddr(rowData.load_done_id),
        };
      }
    }
  } else if (scenario === 3) {
    // 아웃스토커 지그 상태 (전체)
    status.outstocker = {};
    const outstockerSides = config.outstockerSides || {};
    for (const side of OUT_SIDES) {
      const sideData = outstockerSides[side] || {};
      status.outstocker[side] = { 
        amr_pos: sideData.amr_pos,
        bypass: getBitWithAddr(sideData.bypass_id),
        rows: {} 
      };
      for (const row of OUT_ROWS) {
        const rowData = sideData.rows?.[row] || {};
        status.outstocker[side].rows[row] = {
          mani_pos: rowData.mani_pos,
          jig_state: getBitWithAddr(rowData.jig_state_id),
          model_no: getWordWithAddr(rowData.model_no_id),
          unload_working: getBitWithAddr(rowData.working_id),
          unload_done: getBitWithAddr(rowData.unload_done_id),
        };
      }
    }
    // 컨베이어 호출 상태 (전체)
    status.conveyors = [];
    for (const conv of (config.conveyors || [])) {
      status.conveyors.push({
        index: conv.index,
        amr_pos: conv.amr_pos,
        call_signal: getBitWithAddr(conv.call_signal_id),
        call_qty: getWordWithAddr(conv.call_qty_id),
        input_qty_1: getBitWithAddr(conv.input_qty_1_id),
        input_qty_4: getBitWithAddr(conv.input_qty_4_id),
        working: getBitWithAddr(conv.working_id),
        work_done: getBitWithAddr(conv.work_done_id),
        product_no: conv.product_no,
      });
    }
  }
  
  return status;
}

const SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];
const OUT_SIDES = ["L1", "L2", "R1", "R2"];
const OUT_ROWS = [1, 2, 3, 4, 5, 6];

const CHECK_INTERVAL_MS = 1000;
const CONFIG_TTL_MS = 2000;
const STATUS_LOG_INTERVAL_MS = 5000; // 5초마다 상태 출력

// 시나리오 테스트용: AMR1(M500-S-01) 비활성화, AMR2(M500-S-02)만 동작
// .env에 TEST_AMR1_DISABLED=1 설정 시 AMR1 태스크 생성 스킵
const TEST_AMR1_DISABLED =
  process.env.TEST_AMR1_DISABLED === "1" ||
  process.env.TEST_AMR1_DISABLED === "true";

const sideLock = { L: false, R: false };
let scenario1Lock = false;
const conveyorLock = new Map();
let configCache = null;
let configFetchedAt = 0;
let checkTimer = null;
let lastStatusLogTime = 0;
let grinderOutputLock = false;

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePlcValue(id) {
  const key = normalizeText(id);
  if (!key) return null;
  if (key.includes(".")) {
    const on = plc.getBit(key);
    return typeof on === "boolean" ? (on ? 1 : 0) : null;
  }
  const v = plc.getWord(key);
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function isSignalOn(id) {
  const key = normalizeText(id);
  if (!key) return false;
  if (key.includes(".")) {
    return plc.getBit(key) === true;
  }
  const value = plc.getWord(key);
  return Number(value) === 1;
}

function safeParsePayload(payload) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function collectTaskResources(steps = []) {
  const stations = new Set();
  const plcIds = new Set();
  steps.forEach((step) => {
    if (!step) return;
    const payload = safeParsePayload(step.payload);
    if (!payload) return;
    if (step.type === "NAV") {
      const dest = normalizeText(payload.dest);
      if (dest) stations.add(dest);
    }
    if (step.type === "PLC_WRITE") {
      const id = normalizeText(payload.PLC_BIT);
      if (id) plcIds.add(id);
    }
    if (step.type === "PLC_READ") {
      const id = normalizeText(payload.PLC_ID);
      if (id) plcIds.add(id);
    }
  });
  return { stations, plcIds };
}

function hasResourceOverlap(newStations, newPlcIds, existingTasks = []) {
  for (const task of existingTasks) {
    const { stations, plcIds } = collectTaskResources(task.steps || []);
    for (const s of newStations) {
      if (stations.has(s)) return true;
    }
    for (const p of newPlcIds) {
      if (plcIds.has(p)) return true;
    }
  }
  return false;
}

async function loadConfig() {
  const now = Date.now();
  if (configCache && now - configFetchedAt < CONFIG_TTL_MS) return configCache;

  const [instockerRow, grinderRow, outstockerRow, conveyorRow, settingsRow] = await Promise.all([
    DeviceInStocker.findByPk(1),
    DeviceGrinder.findByPk(1),
    DeviceOutStocker.findByPk(1),
    DeviceConveyor.findByPk(1),
    Settings.findByPk(1),
  ]);

  const instockerSlots = safeParse(instockerRow?.slots, {});
  const sideSignals = safeParse(instockerRow?.side_signals, {});
  const grinders = safeParse(grinderRow?.grinders, []);
  const outstockerSides = safeParse(outstockerRow?.sides, {});
  const conveyors = safeParse(conveyorRow?.conveyors, []);
  const grinder_wait_ms = Number(settingsRow?.grinder_wait_ms ?? 0);
  const charge_complete_percent = Number(settingsRow?.charge_complete_percent ?? 90);

  configCache = {
    instockerSlots,
    sideSignals,
    grinders,
    outstockerSides,
    conveyors,
    grinder_wait_ms,
    charge_complete_percent,
  };
  configFetchedAt = now;
  return configCache;
}

function isChargingBlocked(robot, config) {
  if (!robot) return false;
  const info = safeParse(robot.additional_info, {});
  const charging = info?.charging === true || robot.status === "충전";
  if (!charging) return false;
  const threshold = Number(config?.charge_complete_percent);
  if (!Number.isFinite(threshold)) return false;
  const battery = Number(robot.battery);
  if (!Number.isFinite(battery)) return true;
  return battery < threshold;
}

function getSideSlots(slots, side) {
  return SLOT_INDEXES.map((idx) => {
    const key = `${side}${idx}`;
    const item = slots?.[key] || {};
    const productTypeValue = resolvePlcValue(item.product_type_id);
    return {
      key,
      index: idx,
      product_type_id: normalizeText(item.product_type_id),
      product_type_value: productTypeValue,
      amr_pos: normalizeText(item.amr_pos),
      mani_pos: normalizeText(item.mani_pos),
    };
  });
}

function buildAvailableGrinderPositions(grinders) {
  const byProduct = new Map();
  grinders.forEach((grinder, gIdx) => {
    const bypassId = normalizeText(grinder?.bypass_id);
    if (bypassId && isSignalOn(bypassId)) return;
    const productTypeValue = resolvePlcValue(grinder?.product_type_id);
    if (productTypeValue === null) return;
    const productKey = String(productTypeValue);
    POSITIONS.forEach((pos) => {
      const position = grinder?.positions?.[pos] || {};
      const station = normalizeText(position.amr_pos);
      const maniPos = normalizeText(position.mani_pos);
      if (!station) return;
      if (!maniPos) return;
      const readyId = normalizeText(position.input_ready_id);
      if (!readyId) return;
      if (!isSignalOn(readyId)) return;
      const list = byProduct.get(productKey) || [];
      list.push({
        station,
        mani_pos: maniPos,
        grinderIndex: grinder?.index ?? gIdx + 1,
        position: pos,
        // 연마기 신호 ID들
        safe_pos_id: normalizeText(position.safe_pos_id),
        input_in_progress_id: normalizeText(position.input_in_progress_id),
        input_done_id: normalizeText(position.input_done_id),
      });
      byProduct.set(productKey, list);
    });
  });
  // 투입 우선순위: 연마기 6→1, 각 연마기 L→R
  byProduct.forEach((list) => {
    list.sort((a, b) => {
      if (a.grinderIndex !== b.grinderIndex) return b.grinderIndex - a.grinderIndex;
      return POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position);
    });
  });
  return byProduct;
}

function buildAvailableGrinderOutputPositions(grinders) {
  const outputs = [];
  grinders.forEach((grinder, gIdx) => {
    const bypassId = normalizeText(grinder?.bypass_id);
    if (bypassId && isSignalOn(bypassId)) return;
    const productTypeValue = resolvePlcValue(grinder?.product_type_id);
    if (productTypeValue === null) return;
    POSITIONS.forEach((pos) => {
      const position = grinder?.positions?.[pos] || {};
      const station = normalizeText(position.amr_pos);
      const maniPos = normalizeText(position.mani_pos);
      if (!station || !maniPos) return;
      const outputReadyId = normalizeText(position.output_ready_id);
      if (!outputReadyId) return;
      if (!isSignalOn(outputReadyId)) return;
      outputs.push({
        station,
        mani_pos: maniPos,
        grinderIndex: grinder?.index ?? gIdx + 1,
        position: pos,
        product_type_value: productTypeValue,
        safe_pos_id: normalizeText(position.safe_pos_id),
        output_in_progress_id: normalizeText(position.output_in_progress_id),
        output_done_id: normalizeText(position.output_done_id),
      });
    });
  });
  return outputs;
}

function getAvailableOutstockerLoadRows(outstockerSides) {
  const rows = [];
  for (const side of OUT_SIDES) {
    const sideData = outstockerSides?.[side] || {};
    const amrPos = normalizeText(sideData.amr_pos);
    const bypassId = normalizeText(sideData.bypass_id);
    const bypassOn = bypassId ? isSignalOn(bypassId) : false;
    if (!amrPos || bypassOn) continue;
    // 스택형: 아래(1)부터 연속으로만 적재 가능
    for (const row of OUT_ROWS) {
      const rowData = sideData.rows?.[row] || {};
      const maniPos = normalizeText(rowData.mani_pos);
      const loadReadyId = normalizeText(rowData.load_ready_id);
      const isReady = maniPos && loadReadyId && isSignalOn(loadReadyId);
      if (!isReady) break; // 연속 적재 제한
      rows.push({
        side,
        row,
        amr_pos: amrPos,
        mani_pos: maniPos,
        working_id: normalizeText(rowData.working_id),
        load_done_id: normalizeText(rowData.load_done_id),
      });
    }
  }
  // 같은 위치에서 작업을 몰아서 수행하도록 정렬 (amr_pos → row asc)
  return rows.sort((a, b) => {
    if (a.amr_pos !== b.amr_pos) return String(a.amr_pos).localeCompare(String(b.amr_pos));
    return a.row - b.row;
  });
}

async function getActiveTasks() {
  return Task.findAll({
    where: { status: ["PENDING", "RUNNING", "PAUSED"] },
    include: [{ model: TaskStep, as: "steps" }],
  });
}

function computeScenario1PickupCount(side, config) {
  const slots = getSideSlots(config.instockerSlots, side);
  if (!slots.length) return 0;
  const availableByProduct = buildAvailableGrinderPositions(config.grinders);
  let count = 0;
  for (const slot of slots) {
    if (count >= 6) break;
    if (!slot.product_type_id || slot.product_type_value === null || !slot.mani_pos) break;
    const productKey = String(slot.product_type_value);
    const list = availableByProduct.get(productKey) || [];
    if (!list.length) break;
    list.shift();
    availableByProduct.set(productKey, list);
    count += 1;
  }
  return count;
}

async function createTaskForSides(sides, config, activeTasks) {
  //console.log(`[TaskCreate] ${sides.join("+")}: createTaskForSides 시작`);
  
  const sideLabel = sides.join("+");
  const slots = sides.flatMap((side) => getSideSlots(config.instockerSlots, side));
  if (slots.length === 0) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 슬롯 정보 없음`);
    return;
  }
  console.log(`[TaskCreate][S1:${sideLabel}] 입력 슬롯: ${slots.map(s => `${s.key}(P${s.product_type_value ?? "?"}, mani:${s.mani_pos}, amr:${s.amr_pos})`).join(", ")}`);

  const pickupStations = Array.from(new Set(slots.map((s) => s.amr_pos).filter(Boolean)));
  const pickupStation = pickupStations[0];
  if (!pickupStation) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: pickupStation 없음`);
    return;
  }
  if (pickupStations.length > 1) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 정보: pickupStation 다중 (${pickupStations.join(", ")})`);
  }
  //console.log(`[TaskCreate] ${side}: 픽업 스테이션=${pickupStation}`);

  const availableByProduct = buildAvailableGrinderPositions(config.grinders);
  // 제품별 투입 가능 연마기 수 (참고 로그)
  const productCounts = Array.from(availableByProduct.entries()).map(([k, v]) => `제품${k}:${v.length}개`).join(", ") || "없음";
  //console.log(`[TaskCreate] ${side}: 연마기 투입가능 위치: ${productCounts}`);
  console.log(`[TaskCreate][S1:${sideLabel}] 연마기 투입가능(제품별): ${productCounts}`);

  // 슬롯 1~6 순서대로, 해당 제품의 투입 가능 연마기 수만큼만 선택(최대 6개)
  const availableCounts = new Map(
    Array.from(availableByProduct.entries()).map(([k, v]) => [k, v.length])
  );
  const slotAssignments = [];
  for (const slot of slots) {
    if (slotAssignments.length >= 6) break;
    if (!slot.product_type_id || slot.product_type_value === null || !slot.mani_pos) break;
    const productKey = String(slot.product_type_value);
    const count = availableCounts.get(productKey) || 0;
    if (count <= 0) break;
    availableCounts.set(productKey, count - 1);
    slotAssignments.push({
      slotIndex: slot.index,
      product_type_id: slot.product_type_id,
      product_type_value: slot.product_type_value,
      instocker_mani_pos: slot.mani_pos,
      instocker_amr_pos: slot.amr_pos,
    });
    console.log(`[TaskCreate] ${sideLabel}: 슬롯 ${slot.key}(제품${productKey}) → AMR 슬롯 후보`);
  }

  if (slotAssignments.length === 0) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 매칭된 슬롯 없음 (연마기 투입가능: ${productCounts})`);
    return;
  }
  console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 픽업 K=${slotAssignments.length}, 연마기 투입가능: ${productCounts}`);
  console.log(`[TaskCreate][S1:${sideLabel}] 슬롯 선택: ${slotAssignments.map(s => `${s.instocker_mani_pos}(P${s.product_type_value})`).join(", ")}`);

  const robot = await Robot.findOne({ where: { name: "M500-S-01" } });
  if (!robot) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: M500-S-01 로봇 없음`);
    return;
  }
  if (isChargingBlocked(robot, config)) {
    return;
  }
  //console.log(`[TaskCreate] ${side}: 로봇=${robot.name}(ID:${robot.id}), 상태=${robot.status}`);

  // Robot의 슬롯 정보 파싱 (slot_no 목록)
  const robotSlots = safeParse(robot.slots, []);
  const slotNos = robotSlots
    .map((s) => (typeof s === "object" ? s.slot_no : s))
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  
  if (slotNos.length < slotAssignments.length) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: AMR 슬롯 부족 (필요 ${slotAssignments.length} / 보유 ${slotNos.length})`);
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // AMR 슬롯 스택 구조 처리
  // 스택1: 21, 22, 23 (하단→상단)
  // 스택2: 31, 32, 33 (하단→상단)
  // 적재: 낮은 연마기 번호 → 스택 하단, 높은 연마기 번호 → 스택 상단
  // 하역: 스택 상단부터 (높은 연마기 번호부터)
  // ═══════════════════════════════════════════════════════════════
  
  // 슬롯을 스택으로 분리 (20번대, 30번대)
  const rawStack1 = slotNos.filter(n => n >= 20 && n < 30).sort((a, b) => a - b); // [21, 22, 23]
  const rawStack2 = slotNos.filter(n => n >= 30 && n < 40).sort((a, b) => a - b); // [31, 32, 33]
  
  // 스택 하단부터 연속으로만 사용 가능하도록 제한
  const limitStackByBottom = (stack, base) => {
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      const slotNo = base + i;
      if (!stack.includes(slotNo)) break;
      out.push(slotNo);
    }
    return out;
  };
  
  const stack1 = limitStackByBottom(rawStack1, 21); // 21 없으면 22/23 사용 불가
  const stack2 = limitStackByBottom(rawStack2, 31); // 31 없으면 32/33 사용 불가
  
  // 스택 interleave 순서로 재배열 (낮은 연마기용부터 배치)
  // [21, 31, 22, 32, 23, 33] - 스택1 하단, 스택2 하단, 스택1 중단, ...
  const interleavedSlotNos = [];
  const maxLen = Math.max(stack1.length, stack2.length);
  for (let i = 0; i < maxLen; i++) {
    if (stack1[i] !== undefined) interleavedSlotNos.push(stack1[i]);
    if (stack2[i] !== undefined) interleavedSlotNos.push(stack2[i]);
  }
  
  // AMR 슬롯 적재 순서: 21,31,22,32,23,33
  const amrLoadOrder = interleavedSlotNos.slice(0, slotAssignments.length);
  slotAssignments.forEach((assignment, idx) => {
    assignment.amrSlotNo = amrLoadOrder[idx];
  });
  console.log(`[TaskCreate][S1:${sideLabel}] AMR 슬롯 배정: ${slotAssignments.map(s => `${s.instocker_mani_pos}→${s.amrSlotNo}`).join(", ")}`);
  
  // AMR 슬롯 → 연마기 매핑 (제품 기준, 바깥쪽 6→1, L→R 우선)
  const grinderMap = new Map(); // amrSlotNo -> target
  const unloadOrder = [...interleavedSlotNos].reverse(); // 33,23,32,22,31,21
  unloadOrder.forEach((amrSlotNo) => {
    const assignment = slotAssignments.find((s) => s.amrSlotNo === amrSlotNo);
    if (!assignment) return;
    const productKey = String(assignment.product_type_value);
    const list = availableByProduct.get(productKey) || [];
    const target = list.shift();
    if (!target) return;
    availableByProduct.set(productKey, list);
    grinderMap.set(amrSlotNo, target);
  });
  if (grinderMap.size !== slotAssignments.length) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 연마기 매칭 부족 (필요 ${slotAssignments.length} / 매칭 ${grinderMap.size})`);
    console.log(`[TaskCreate][S1:${sideLabel}] 연마기 매칭 실패 상세: ${slotAssignments.map(s => `AMR${s.amrSlotNo}:P${s.product_type_value}`).join(", ")}`);
    return;
  }
  console.log(`[TaskCreate][S1:${sideLabel}] AMR→연마기 매핑: ${Array.from(grinderMap.entries()).map(([slotNo, t]) => `${slotNo}→G${t.grinderIndex}-${t.position}`).join(", ")}`);
  console.log(`[TaskCreate][S1:${sideLabel}] 하역 순서: ${unloadOrder.filter(s => grinderMap.has(s)).join(" → ")}`);

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 기존 태스크 진행 중 (Task#${existingTask.id}, ${existingTask.status})`);
    return;
  }

  const steps = [];

  // 인스토커 -> AMR 적재 (인스토커 위→아래 순서 유지)
  // 각 인스토커 슬롯의 제품은 연마기 번호에 맞는 AMR 슬롯에 적재
  // VISION_CHECK: 스테이션 이동 직후 첫 픽업만 1, 이후는 0
  let lastPickupStation = null;
  slotAssignments.forEach((assignment) => {
    const amrSlotNo = assignment.amrSlotNo;
    const currentStation = assignment.instocker_amr_pos;
    if (currentStation && currentStation !== lastPickupStation) {
      steps.push({ type: "NAV", payload: JSON.stringify({ dest: currentStation }) });
    }
    const visionCheck = currentStation !== lastPickupStation ? 1 : 0;
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: Number(assignment.instocker_mani_pos),
        CMD_TO: amrSlotNo,
        VISION_CHECK: visionCheck,
        PRODUCT_NO: assignment.product_type_value,
        AMR_SLOT_NO: amrSlotNo,
      }),
    });
    if (currentStation) lastPickupStation = currentStation;
    const mappedTarget = grinderMap.get(amrSlotNo);
    console.log(`[TaskCreate] ${sideLabel}: 적재 - 인스토커 ${assignment.instocker_mani_pos} → AMR 슬롯 ${amrSlotNo} (연마기 ${mappedTarget?.grinderIndex ?? "?"}용, VISION=${visionCheck})`);
  });

  // AMR -> 연마기 투입 (하역 순서: 33, 23, 32, 22, 31, 21)
  // 제품번호 기준으로 바깥쪽(6→1) 우선 배정되어 있으며,
  // 내측 연마기 방문 후 바깥쪽 작업이 남아 있으면 LM4로 한 번 복귀 후 재개
  const orderedSlots = unloadOrder.filter((slotNo) => grinderMap.has(slotNo));
  const resetStation = "LM3";
  orderedSlots.forEach((amrSlotNo, idx) => {
    const target = grinderMap.get(amrSlotNo);
    if (!target) return;
    
    // 1. 연마기 위치로 이동
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: target.station }),
    });
    
    const gLabel = `연마기 G${target.grinderIndex}-${target.position}`;
    
    // 2. 도착 후 안전위치 = 0
    if (target.safe_pos_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.safe_pos_id, PLC_DATA: 0, desc: `${gLabel} 안전위치=0` }),
      });
    }
    
    // 3. 투입 작업 전: 투입중 = 1, 투입완료 = 0
    if (target.input_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_done_id, PLC_DATA: 0, desc: `${gLabel} 투입완료=0` }),
      });
    }
    if (target.input_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_in_progress_id, PLC_DATA: 1, desc: `${gLabel} 투입중=1` }),
      });
    }
    
    // 4. MANI_WORK (투입)
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: amrSlotNo,
        CMD_TO: Number(target.mani_pos),
        VISION_CHECK: 0,
        PRODUCT_NO: target.product_type_value,
        AMR_SLOT_NO: amrSlotNo,
      }),
    });
    
    // 5. 투입 완료 후: 투입중 = 0, 투입완료 = 1
    if (target.input_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_in_progress_id, PLC_DATA: 0, desc: `${gLabel} 투입중=0` }),
      });
    }
    if (target.input_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_done_id, PLC_DATA: 1, desc: `${gLabel} 투입완료=1` }),
      });
    }
    
    // 6. 다른 위치로 이동 전: 안전위치 = 1, 투입완료 = 0, 투입중 = 0
    if (target.input_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_done_id, PLC_DATA: 0, desc: `${gLabel} 투입완료=0` }),
      });
    }
    if (target.input_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.input_in_progress_id, PLC_DATA: 0, desc: `${gLabel} 투입중=0` }),
      });
    }
    if (target.safe_pos_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: target.safe_pos_id, PLC_DATA: 1, desc: `${gLabel} 안전위치=1` }),
      });
    }
    
    console.log(`[TaskCreate] ${sideLabel}: 하역 - AMR 슬롯 ${amrSlotNo} → 연마기 ${target.grinderIndex}-${target.position}`);

    // 다음 작업이 더 바깥쪽 연마기면 LM4로 한번 이동
    let nextTarget = null;
    for (let i = idx + 1; i < orderedSlots.length; i += 1) {
      const candidate = grinderMap.get(orderedSlots[i]);
      if (candidate) {
        nextTarget = candidate;
        break;
      }
    }
    if (nextTarget && nextTarget.grinderIndex > target.grinderIndex) {
      steps.push({
        type: "NAV",
        payload: JSON.stringify({ dest: resetStation }),
      });
      console.log(`[TaskCreate] ${sideLabel}: 내측 하역 후 ${resetStation} 이동 (다음 바깥쪽 연마기 ${nextTarget.grinderIndex})`);
    }
  });

  if (robot.home_pre_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_pre_station }),
    });
  }
  if (robot.home_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_station }),
    });
  }

  const grinderTargets = Array.from(grinderMap.values());

  // 시나리오 2 태스크가 진행 중이면 발행하지 않음
  const scenario2Task = await Task.findOne({
    where: { scenario: 2, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (scenario2Task) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 시나리오2 진행 중 (Task#${scenario2Task.id}) → 생성 스킵`);
    return;
  }

  // 로봇 매니퓰레이터 TASK_STATUS 확인 (0이어야 발행)
  const robotReady = await checkRobotTaskStatus(robot.ip);
  if (!robotReady) {
    console.log(`[TaskCreate] 시나리오1(${sideLabel}) 조건: 로봇 TASK_STATUS 유휴 아님 → 생성 스킵`);
    return;
  }

  // 요약 정보 생성
  const grinderSummary = Array.from(grinderMap.entries())
    .map(([slotNo, target]) => `G${target.grinderIndex}-${target.position}`)
    .join(", ");
  const summary = {
    source: `인스토커 ${sideLabel}`,
    target: grinderSummary,
    pickup_count: slotAssignments.length,
    dropoff_count: grinderMap.size,
  };

  const task = await Task.create(
    {
      robot_id: robot.id,
      scenario: 1,
      summary: JSON.stringify(summary),
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  console.log(`[TaskCreate] ${sideLabel}: Task#${task.id} 생성 (시나리오1, ${steps.length} 스텝)`);
  const plcStatus = collectPlcStatusForScenario(1, config);
  // 스텝 리스트를 간결하게 변환
  const stepList = steps.map((s, i) => ({
    seq: i,
    type: s.type,
    payload: typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload,
  }));
  await logTaskEvent(task.id, "TASK_CREATED", `인스토커 ${sideLabel} → 연마기 태스크 생성 (${steps.length} 스텝)`, {
    robotId: robot.id,
    robotName: robot.name,
    payload: { sides: sideLabel, stepsCount: steps.length, scenario: 1, summary, plc_status: plcStatus, steps: stepList },
  });
}

/** mani_pos 오름차순 비교 (낮은 순서 먼저) - 아웃스토커 픽업 순서용 */
function compareManiPosAsc(a, b) {
  const maniA = Number(a.mani_pos) || 0;
  const maniB = Number(b.mani_pos) || 0;
  return maniA - maniB;
}

/** 아웃스토커 rows 정렬: amr_pos 그룹 후 mani_pos 오름차순 */
function sortOutstockerRowsByAmrPosAndManiPos(rows) {
  return rows.sort((a, b) => {
    if (a.amr_pos !== b.amr_pos) return String(a.amr_pos).localeCompare(String(b.amr_pos));
    return compareManiPosAsc(a, b);
  });
}

function getAvailableOutstockerRows(outstockerSides, qty) {
  const rows = [];
  for (const side of OUT_SIDES) {
    const sideData = outstockerSides?.[side] || {};
    const amrPos = normalizeText(sideData.amr_pos);
    if (!amrPos) continue;
    for (const row of OUT_ROWS) {
      const rowData = sideData.rows?.[row] || {};
      const jigState = resolvePlcValue(rowData.jig_state_id);
      const maniPos = normalizeText(rowData.mani_pos);
      const workingId = normalizeText(rowData.working_id);
      const unloadDoneId = normalizeText(rowData.unload_done_id);
      
      // mani_pos가 없으면 사용할 수 없으므로 스킵
      if (!maniPos) continue;
      
      if (jigState === 1) {
        rows.push({ 
          side, 
          row, 
          amr_pos: amrPos, 
          mani_pos: maniPos,
          working_id: workingId,
          unload_done_id: unloadDoneId,
          model_no_value: resolvePlcValue(rowData.model_no_id),
        });
      }
    }
  }
  // 전체 수집 후 mani_pos 오름차순 정렬 → qty개만 반환 (61→62→63→64→65→66 순)
  const sorted = sortOutstockerRowsByAmrPosAndManiPos(rows);
  return sorted.slice(0, qty);
}

/** 아웃스토커 공지그 제품별 가용 수량 합산 (jig_state=1, model_no 기준) */
function getOutstockerProductCounts(outstockerSides) {
  const counts = new Map();
  
  // 디버깅: 전체 구조 확인
  if (!outstockerSides || Object.keys(outstockerSides).length === 0) {
    //console.log(`[TaskCreate] getOutstockerProductCounts: outstockerSides가 비어있음`);
    return counts;
  }
  
  for (const side of OUT_SIDES) {
    const sideData = outstockerSides?.[side] || {};
    const rowsData = sideData.rows;
    
    // 디버깅: rows 구조 확인
    if (!rowsData || typeof rowsData !== 'object') {
      //console.log(`[TaskCreate] ${side}: rows 데이터 없음 또는 객체 아님 (type: ${typeof rowsData})`);
      continue;
    }
    
    // amrPos 체크 제거 - rows는 amrPos와 무관하게 체크 가능
    let sideJigOk = 0;
    for (const row of OUT_ROWS) {
      const rowData = rowsData[row] || {};
      const jigStateId = normalizeText(rowData.jig_state_id);
      const modelNoId = normalizeText(rowData.model_no_id);
      
      const jigState = jigStateId ? resolvePlcValue(jigStateId) : null;
      const modelNo = modelNoId ? resolvePlcValue(modelNoId) : null;
      
      if (jigState === 1 && modelNo !== null && !Number.isNaN(Number(modelNo))) {
        const key = String(Number(modelNo));
        counts.set(key, (counts.get(key) || 0) + 1);
        sideJigOk++;
      }
    }
    // 디버깅: L1/L2/R1/R2 각 측면별 row 1 샘플 + 해당 측면 jig_state=1 개수
    const row1 = rowsData[1] || {};
    const j1 = normalizeText(row1.jig_state_id);
    const m1 = normalizeText(row1.model_no_id);
    const v1 = j1 ? resolvePlcValue(j1) : null;
    const v2 = m1 ? resolvePlcValue(m1) : null;
    //console.log(`[TaskCreate] ${side} row1: jig_state_id=${j1}→${v1}, model_no_id=${m1}→${v2} | 측면 jig_ok=${sideJigOk}`);
  }
  return counts;
}

// 통합 컨베이어 태스크 생성 (여러 컨베이어 요청을 하나의 태스크로 처리)
async function createTaskForConveyors(conveyorRequests, config, activeTasks) {
  // conveyorRequests: [{ item, qty, productNo }, ...]
  
  if (!conveyorRequests.length) return;
  
  //console.log(`[TaskCreate] 컨베이어 요청: ${conveyorRequests.map(r => `C${r.item.index}(제품${r.productNo}, ${r.qty}개)`).join(' + ')}`);
  
  // 로봇 확인
  const robot = await Robot.findOne({ where: { name: "M500-S-02" } });
  if (!robot) {
    //console.warn("[TaskCreate] M500-S-02 로봇 없음");
    return;
  }
  if (isChargingBlocked(robot, config)) {
    return;
  }

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    //console.log(`[TaskCreate] 컨베이어 통합: M500-S-02 기존 태스크 진행 중`);
    return;
  }

  // Robot의 슬롯 정보 파싱
  const robotSlots = safeParse(robot.slots, []);
  const slotNos = robotSlots
    .map((s) => (typeof s === "object" ? s.slot_no : s))
    .filter((n) => n != null)
    .sort((a, b) => a - b);

  // ═══════════════════════════════════════════════════════════════
  // 각 컨베이어별로 공지그 확인 → 충족 가능한 것만 필터링
  // ═══════════════════════════════════════════════════════════════
  const validRequests = [];
  
  for (const req of conveyorRequests) {
    // 컨베이어 설정 확인
    const amrPos = normalizeText(req.item.amr_pos);
    const maniPos = normalizeText(req.item.mani_pos);
    if (!amrPos) {
      //console.warn(`[TaskCreate] conveyor${req.item.index}: AMR pos 없음 → 스킵`);
      continue;
    }
    if (!maniPos) {
      //console.warn(`[TaskCreate] conveyor${req.item.index}: Mani Pos 없음 → 스킵`);
      continue;
    }
    
    validRequests.push({ ...req });
  }
  
  if (!validRequests.length) {
  //console.log(`[TaskCreate] 컨베이어 통합: 처리 가능한 요청 없음`);
    return;
  }
  
  // 처리 가능한 요청만으로 진행
  const totalQty = validRequests.reduce((sum, r) => sum + r.qty, 0);
  //console.log(`[TaskCreate] 컨베이어 통합: 처리 가능 ${validRequests.map(r => `C${r.item.index}(${r.qty}개)`).join(' + ')} = 총 ${totalQty}개`);
  
  if (slotNos.length < totalQty) {
    //console.warn(`[TaskCreate] 컨베이어 통합: AMR 슬롯 부족 (필요: ${totalQty}, 보유: ${slotNos.length})`);
    return;
  }

  // 아웃스토커 상단(큰 row)부터 수량만큼 픽업
  const rows = getAvailableOutstockerRows(config.outstockerSides, totalQty);
  if (rows.length < totalQty) {
    //console.log(`[TaskCreate] 컨베이어 통합: 아웃스토커 공지그 부족 (${rows.length}/${totalQty}) → 스킵`);
    return;
  }

  // 각 컨베이어별로 필요한 아웃스토커 row 배정 (제품 번호 무시)
  const pickupInfos = []; // { rowInfo, conveyorItem, productNo, slotIndex, amrSlotNo }
  let slotIndex = 0;
  let rowIndex = 0;

  for (const req of validRequests) {
    for (let i = 0; i < req.qty; i++) {
      const amrSlotNo = slotNos[slotIndex];
      const rowInfo = rows[rowIndex];
      if (!rowInfo) break;
      pickupInfos.push({
        rowInfo,
        conveyorItem: req.item,
        productNo: rowInfo.model_no_value ?? req.productNo ?? null,
        slotIndex: slotIndex,
        amrSlotNo: amrSlotNo, // 실제 할당된 AMR 슬롯 번호
      });
      slotIndex++;
      rowIndex++;
    }
  }
  
  //console.log(`[TaskCreate] 컨베이어 통합: 아웃스토커 픽업 ${pickupInfos.length}개 예정`);
  pickupInfos.forEach((p, i) => {
    //console.log(`  [${i+1}] ${p.rowInfo.side}-${p.rowInfo.row} → AMR슬롯${p.amrSlotNo} → C${p.conveyorItem.index}용 (제품${p.productNo})`);
  });

  const steps = [];
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: 아웃스토커에서 모든 지그 픽업
  // VISION_CHECK: 새로운 위치(amr_pos)로 이동할 때마다 첫 픽업은 1, 같은 위치에서 연속 픽업은 0
  // ═══════════════════════════════════════════════════════════════
  let lastOutstockerAmrPos = null;
  for (const info of pickupInfos) {
    const amrSlotNo = info.amrSlotNo;
    const currentAmrPos = info.rowInfo.amr_pos;
    
    // 새로운 위치로 이동하면 VISION_CHECK = 1
    const visionCheck = (currentAmrPos !== lastOutstockerAmrPos) ? 1 : 0;
    lastOutstockerAmrPos = currentAmrPos;
    
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: currentAmrPos }),
    });
    
    const outLabel = `아웃스토커 ${info.rowInfo.side}-R${info.rowInfo.row}`;
    
    // 꺼내기 직전: 작업중 신호 ON
    if (info.rowInfo.working_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: info.rowInfo.working_id, PLC_DATA: 1, desc: `${outLabel} 작업중=1` }),
      });
    }
    
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: Number(info.rowInfo.mani_pos),
        CMD_TO: amrSlotNo,
        VISION_CHECK: visionCheck,
        PRODUCT_NO: info.productNo, // 제품 번호 (슬롯 적재용)
        AMR_SLOT_NO: amrSlotNo, // AMR 슬롯 번호 (업데이트 대상)
      }),
    });
    
    // 꺼낸 후: 작업중 신호 OFF, 배출완료 신호 ON
    if (info.rowInfo.working_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: info.rowInfo.working_id, PLC_DATA: 0, desc: `${outLabel} 작업중=0` }),
      });
    }
    if (info.rowInfo.unload_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: info.rowInfo.unload_done_id, PLC_DATA: 1, desc: `${outLabel} 배출완료=1` }),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1.5: 컨베이어 이동 전 모든 배출완료 신호 리셋
  // ═══════════════════════════════════════════════════════════════
  for (const info of pickupInfos) {
    if (info.rowInfo.unload_done_id) {
      const outLabel = `아웃스토커 ${info.rowInfo.side}-R${info.rowInfo.row}`;
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: info.rowInfo.unload_done_id, PLC_DATA: 0, desc: `${outLabel} 배출완료=0` }),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: 스택 하역 순서에 맞게 컨베이어에 투입
  // 하역 순서: 23, 22, 21, 33, 32, 31 (스택1 위→아래, 그 다음 스택2 위→아래)
  // ═══════════════════════════════════════════════════════════════
  
  // 스택 하역 순서로 정렬: 스택1(20번대) 먼저 내림차순, 그 다음 스택2(30번대) 내림차순
  const sortedForUnload = [...pickupInfos].sort((a, b) => {
    const aStack = a.amrSlotNo < 30 ? 1 : 2;
    const bStack = b.amrSlotNo < 30 ? 1 : 2;
    if (aStack !== bStack) return aStack - bStack; // 스택1 먼저
    return b.amrSlotNo - a.amrSlotNo; // 같은 스택 내에서 내림차순 (위부터)
  });
  
  //console.log(`[TaskCreate] 컨베이어 하역 순서:`);
  sortedForUnload.forEach((p, i) => {
    //console.log(`  [${i+1}] AMR슬롯${p.amrSlotNo} → C${p.conveyorItem.index} (제품${p.productNo})`);
  });
  
  // 정렬된 순서대로 하역 (각 아이템의 컨베이어로 이동 후 하역)
  let lastConveyorAmrPos = null;
  let lastConveyorVisionKey = null;
  for (const info of sortedForUnload) {
    const conveyorItem = info.conveyorItem;
    const amrPos = normalizeText(conveyorItem.amr_pos);
    const conveyorManiPos = normalizeText(conveyorItem.mani_pos);
    const amrSlotNo = info.amrSlotNo;
    
    // 이전과 다른 컨베이어면 이동
    if (amrPos !== lastConveyorAmrPos) {
      steps.push({
        type: "NAV",
        payload: JSON.stringify({ dest: amrPos }),
      });
      lastConveyorAmrPos = amrPos;
    }
    
    const cLabel = `컨베이어 C${conveyorItem.index}`;
    
    // 정지 요청: 투입중=0, 투입완료=0 후 정지요청=1
    if (conveyorItem.input_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_in_progress_id, PLC_DATA: 0, desc: `${cLabel} 투입중=0` }),
      });
    }
    if (conveyorItem.input_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_done_id, PLC_DATA: 0, desc: `${cLabel} 투입완료=0` }),
      });
    }
    steps.push({
      type: "PLC_WRITE",
      payload: JSON.stringify({ PLC_BIT: conveyorItem.stop_request_id, PLC_DATA: 1, desc: `${cLabel} 정지요청=1` }),
    });
    
    steps.push({
      type: "PLC_READ",
      payload: JSON.stringify({ PLC_ID: conveyorItem.stop_id, EXPECTED: 1, desc: `${cLabel} 정지중==1 대기` }),
    });
    steps.push({
      type: "PLC_READ",
      payload: JSON.stringify({ PLC_ID: conveyorItem.input_ready_id, EXPECTED: 1, desc: `${cLabel} 투입가능==1 대기` }),
    });
    
    // 투입중: 투입완료=0 후 투입중=1
    if (conveyorItem.input_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_done_id, PLC_DATA: 0, desc: `${cLabel} 투입완료=0` }),
      });
    }
    steps.push({
      type: "PLC_WRITE",
      payload: JSON.stringify({ PLC_BIT: conveyorItem.input_in_progress_id, PLC_DATA: 1, desc: `${cLabel} 투입중=1` }),
    });
    
    const visionKey = `${conveyorItem.index ?? ""}|${conveyorManiPos ?? ""}`;
    const visionCheck = visionKey && visionKey !== lastConveyorVisionKey ? 1 : 0;
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: amrSlotNo,
        CMD_TO: Number(conveyorManiPos),
        VISION_CHECK: visionCheck,
        PRODUCT_NO: info.productNo, // 제품 번호 (로그용)
        AMR_SLOT_NO: amrSlotNo, // AMR 슬롯 번호 (비우기 대상)
      }),
    });
    if (visionKey) lastConveyorVisionKey = visionKey;
    
    // 투입완료: 투입중=0, 정지요청=0 후 투입완료=1
    if (conveyorItem.input_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_in_progress_id, PLC_DATA: 0, desc: `${cLabel} 투입중=0` }),
      });
    }
    if (conveyorItem.stop_request_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.stop_request_id, PLC_DATA: 0, desc: `${cLabel} 정지요청=0` }),
      });
    }
    steps.push({
      type: "PLC_WRITE",
      payload: JSON.stringify({ PLC_BIT: conveyorItem.input_done_id, PLC_DATA: 1, desc: `${cLabel} 투입완료=1` }),
    });
  }

  // 홈 스테이션으로 복귀 (pre → home)
  if (robot.home_pre_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_pre_station }),
    });
  }
  if (robot.home_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_station }),
    });
  }

  // 시나리오 2 태스크가 진행 중이면 발행하지 않음
  const scenario2Task = await Task.findOne({
    where: { scenario: 2, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (scenario2Task) {
    //console.log(`[TaskCreate] 시나리오3: 시나리오2 진행 중 (Task#${scenario2Task.id}) → 생성 스킵`);
    return;
  }

  // 로봇 매니퓰레이터 TASK_STATUS 확인
  const robotReady = await checkRobotTaskStatus(robot.ip);
  if (!robotReady) {
    return;
  }

  // 요약 정보 생성
  const outstockerSummary = [...new Set(pickupInfos.map((p) => `${p.rowInfo.side}`))].join(", ");
  const conveyorSummary = validRequests.map((r) => `C${r.item.index}:${r.qty}`).join("+");
  const summary = {
    source: `아웃스토커 ${outstockerSummary}`,
    target: `컨베이어 ${conveyorSummary}`,
    pickup_count: pickupInfos.length,
    dropoff_count: pickupInfos.length,
  };

  const task = await Task.create(
    {
      robot_id: robot.id,
      scenario: 3,
      summary: JSON.stringify(summary),
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  const summaryStr = validRequests.map(r => `C${r.item.index}:${r.qty}`).join('+');
  //console.log(
  //  `[TaskCreate] 컨베이어 통합(${summaryStr}): Task#${task.id} 발행 (시나리오3, ${steps.length} steps)`
  //);
  const plcStatus = collectPlcStatusForScenario(3, config);
  const stepList = steps.map((s, i) => ({
    seq: i,
    type: s.type,
    payload: typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload,
  }));
  await logTaskEvent(task.id, "TASK_CREATED", `아웃스토커 → 컨베이어 통합 태스크 (${summaryStr}, ${steps.length} 스텝)`, {
    robotId: robot.id,
    robotName: robot.name,
    payload: { conveyors: validRequests.map(r => ({ index: r.item.index, qty: r.qty })), stepsCount: steps.length, scenario: 3, summary, plc_status: plcStatus, steps: stepList },
  });
}

async function createTaskForGrinderOutput(config, activeTasks) {
  const robot = await Robot.findOne({ where: { name: "M500-S-02" } });
  if (!robot) return;
  if (isChargingBlocked(robot, config)) return;

  let tasks = activeTasks || (await getActiveTasks());
  if (tasks.length) return;

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) return;

  const initialOutputs = buildAvailableGrinderOutputPositions(config.grinders || []);
  const initialOutRows = getAvailableOutstockerLoadRows(config.outstockerSides || {});
  if (!initialOutputs.length || !initialOutRows.length) return;

  const waitMs = Math.max(0, Number(config.grinder_wait_ms ?? 0));
  if (waitMs > 0) {
    //console.log(`[TaskCreate] 시나리오2: 연마기 배출 대기 ${waitMs}ms`);
    await sleep(waitMs);
  }
  if (isChargingBlocked(robot, config)) return;

  tasks = await getActiveTasks();
  if (tasks.length) return;

  const latestConfig = await loadConfig();
  const grinderOutputs = buildAvailableGrinderOutputPositions(latestConfig.grinders || []);
  const outRows = getAvailableOutstockerLoadRows(latestConfig.outstockerSides || {});
  const nonBypassGrinderCount = (latestConfig.grinders || []).filter((g) => {
    const bypassId = normalizeText(g?.bypass_id);
    return !bypassId || !isSignalOn(bypassId);
  }).length;
  const maxCount = Math.min(6, grinderOutputs.length, outRows.length, nonBypassGrinderCount);
  if (!maxCount) return;

  const robotSlots = safeParse(robot.slots, []);
  const slotNos = robotSlots
    .map((s) => (typeof s === "object" ? s.slot_no : s))
    .filter((n) => n != null)
    .sort((a, b) => a - b);

  if (slotNos.length < maxCount) {
    //console.warn(`[TaskCreate] 시나리오2: AMR 슬롯 부족 (필요: ${maxCount}, 보유: ${slotNos.length})`);
    return;
  }

  const stack1 = slotNos.filter((n) => n >= 20 && n < 30).sort((a, b) => a - b);
  const stack2 = slotNos.filter((n) => n >= 30 && n < 40).sort((a, b) => a - b);
  const interleavedSlotNos = [];
  const maxLen = Math.max(stack1.length, stack2.length);
  for (let i = 0; i < maxLen; i++) {
    if (stack1[i] !== undefined) interleavedSlotNos.push(stack1[i]);
    if (stack2[i] !== undefined) interleavedSlotNos.push(stack2[i]);
  }

  const outputsSorted = [...grinderOutputs].sort((a, b) => {
    if (a.grinderIndex !== b.grinderIndex) return b.grinderIndex - a.grinderIndex; // 위에서부터(높은 번호)
    return POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position);
  });

  const selectedOutputs = outputsSorted.slice(0, maxCount);
  const selectedOutRows = outRows.slice(0, maxCount);

  const pairs = selectedOutputs.map((output, idx) => ({
    output,
    amrSlotNo: interleavedSlotNos[idx],
  }));

  const steps = [];

  // PHASE 1: 연마기에서 배출 (낮은 번호 → 높은 번호, 같은 위치는 묶음)
  let lastGrinderStation = null;
  for (const pair of pairs) {
    const { output, amrSlotNo } = pair;
    const gLabel = `연마기 G${output.grinderIndex}-${output.position}`;
    
    if (output.station !== lastGrinderStation) {
      steps.push({
        type: "NAV",
        payload: JSON.stringify({ dest: output.station }),
      });
      lastGrinderStation = output.station;
    }

    if (output.output_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.output_in_progress_id, PLC_DATA: 1, desc: `${gLabel} 배출중=1` }),
      });
    }
    if (output.safe_pos_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.safe_pos_id, PLC_DATA: 0, desc: `${gLabel} 안전위치=0` }),
      });
    }

    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: Number(output.mani_pos),
        CMD_TO: amrSlotNo,
        VISION_CHECK: 0,
        PRODUCT_NO: output.product_type_value,
        AMR_SLOT_NO: amrSlotNo,
      }),
    });

    if (output.output_in_progress_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.output_in_progress_id, PLC_DATA: 0, desc: `${gLabel} 배출중=0` }),
      });
    }
    if (output.safe_pos_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.safe_pos_id, PLC_DATA: 1, desc: `${gLabel} 안전위치=1` }),
      });
    }
    if (output.output_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.output_done_id, PLC_DATA: 1, desc: `${gLabel} 배출완료=1` }),
      });
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: output.output_done_id, PLC_DATA: 0, desc: `${gLabel} 배출완료=0` }),
      });
    }
  }

  // PHASE 2: 아웃스토커 적재 (AMR 스택 상단부터 하역)
  const sortedForUnload = [...pairs].sort((a, b) => {
    const aStack = a.amrSlotNo < 30 ? 1 : 2;
    const bStack = b.amrSlotNo < 30 ? 1 : 2;
    if (aStack !== bStack) return aStack - bStack;
    return b.amrSlotNo - a.amrSlotNo;
  });

  // 아웃스토커는 스택형 → 아래부터 적재 (정렬된 outRow를 하역 순서에 매핑)
  sortedForUnload.forEach((pair, idx) => {
    pair.outRow = selectedOutRows[idx];
  });

  let lastOutAmrPos = null;
  let lastOutVisionAmrPos = null;
  for (const pair of sortedForUnload) {
    const { outRow, amrSlotNo, output } = pair;
    const outLabel = `아웃스토커 ${outRow.side}-R${outRow.row}`;

    if (outRow.amr_pos !== lastOutAmrPos) {
      steps.push({
        type: "NAV",
        payload: JSON.stringify({ dest: outRow.amr_pos }),
      });
      lastOutAmrPos = outRow.amr_pos;
    }

    if (outRow.working_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: outRow.working_id, PLC_DATA: 1, desc: `${outLabel} 작업중=1` }),
      });
    }

    const visionCheck = outRow.amr_pos !== lastOutVisionAmrPos ? 1 : 0;
    lastOutVisionAmrPos = outRow.amr_pos;
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: amrSlotNo,
        CMD_TO: Number(outRow.mani_pos),
        VISION_CHECK: visionCheck,
        PRODUCT_NO: output.product_type_value,
        AMR_SLOT_NO: amrSlotNo,
      }),
    });

    if (outRow.working_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: outRow.working_id, PLC_DATA: 0, desc: `${outLabel} 작업중=0` }),
      });
    }
    if (outRow.load_done_id) {
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: outRow.load_done_id, PLC_DATA: 1, desc: `${outLabel} 적재완료=1` }),
      });
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: outRow.load_done_id, PLC_DATA: 0, desc: `${outLabel} 적재완료=0` }),
      });
    }
  }

  if (robot.home_pre_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_pre_station }),
    });
  }
  if (robot.home_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_station }),
    });
  }

  const newStations = new Set([
    ...pairs.map((p) => p.output.station),
    ...pairs.map((p) => p.outRow.amr_pos),
    robot.home_pre_station,
    robot.home_station,
  ].filter(Boolean));

  const newPlcIds = new Set(
    pairs.flatMap((p) => [
      p.output.safe_pos_id,
      p.output.output_in_progress_id,
      p.output.output_done_id,
      p.outRow.working_id,
      p.outRow.load_done_id,
    ]).filter(Boolean)
  );

  if (hasResourceOverlap(newStations, newPlcIds, tasks)) {
    //console.log("[TaskCreate] 시나리오2: 기존 태스크와 리소스 중복, 생성 스킵");
    return;
  }

  const robotReady = await checkRobotTaskStatus(robot.ip);
  if (!robotReady) return;

  // 요약 정보 생성
  const grinderSummary = selectedOutputs.map((o) => `G${o.grinderIndex}-${o.position}`).join(", ");
  const outstockerSummary = [...new Set(sortedForUnload.map((p) => `${p.outRow.side}`))].join(", ");
  const summary = {
    source: `연마기 ${grinderSummary}`,
    target: `아웃스토커 ${outstockerSummary}`,
    pickup_count: selectedOutputs.length,
    dropoff_count: selectedOutRows.length,
  };

  const task = await Task.create(
    {
      robot_id: robot.id,
      scenario: 2,
      summary: JSON.stringify(summary),
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  //console.log(`[TaskCreate] 연마기 → 아웃스토커: Task#${task.id} 발행 (시나리오2, ${steps.length} steps)`);
  const plcStatus = collectPlcStatusForScenario(2, config);
  const stepList = steps.map((s, i) => ({
    seq: i,
    type: s.type,
    payload: typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload,
  }));
  await logTaskEvent(task.id, "TASK_CREATED", `연마기 → 아웃스토커 태스크 (${maxCount}개, ${steps.length} 스텝)`, {
    robotId: robot.id,
    robotName: robot.name,
    payload: { count: maxCount, stepsCount: steps.length, scenario: 2, summary, plc_status: plcStatus, steps: stepList },
  });
}

async function logTaskCreateStatus(config) {
  const now = Date.now();
  if (now - lastStatusLogTime < STATUS_LOG_INTERVAL_MS) return;
  lastStatusLogTime = now;

  const pad = (s, n) => String(s).padEnd(n, " ");
  const sep = "  ";
  const lines = [];
  lines.push("");
  lines.push("┌─────────────────────────────────────────────────────────────");
  lines.push("│ [TaskCreate] 시나리오 3번 (아웃스토커 → 컨베이어) 조건 상태");
  lines.push("├─────────────────────────────────────────────────────────────");

  const robotM500 = await Robot.findOne({ where: { name: "M500-S-02" } });
  const existingM500Task = robotM500
    ? await Task.findOne({
        where: { robot_id: robotM500.id, status: ["PENDING", "RUNNING", "PAUSED"] },
      })
    : null;

  lines.push("│ ■ AMR (M500-S-02)");
  if (robotM500) {
    lines.push(`│   ${sep}상태       ${pad(robotM500.status ?? "-", 10)}│`);
    lines.push(`│   ${sep}기존태스크 ${pad(existingM500Task ? `Task#${existingM500Task.id} (${existingM500Task.status})` : "없음", 28)}│`);
  } else {
    lines.push(`│   ${sep}미등록`);
  }
  lines.push("├─────────────────────────────────────────────────────────────");
  lines.push("│ ■ 컨베이어 (투입수량 · 제품번호)");

  (config.conveyors || []).forEach((item) => {
    const idx = item.index;
    const qty4Id = normalizeText(item.input_qty_4_id);
    const qty1Id = normalizeText(item.input_qty_1_id);
    const qty4On = qty4Id && isSignalOn(qty4Id);
    const qty1On = qty1Id && isSignalOn(qty1Id);
    const qty = qty4On ? 4 : qty1On ? 1 : 0;
    const productNo = item.product_no != null && String(item.product_no).trim() !== "" ? String(item.product_no) : "-";
    const amrPos = normalizeText(item.amr_pos) || "-";
    lines.push(`│   컨베이어 ${idx}  투입수량1=${qty1On ? "1" : "0"}  투입수량4=${qty4On ? "1" : "0"}  → 요청수량 ${qty}개`);
    lines.push(`│            제품번호 ${pad(productNo, 6)}  AMR pos ${amrPos}`);
  });

  const outCounts = getOutstockerProductCounts(config.outstockerSides);
  const sortedProducts = [...outCounts.keys()].sort((a, b) => Number(a) - Number(b));

  lines.push("├─────────────────────────────────────────────────────────────");
  lines.push("│ ■ 아웃스토커 공지그 (제품별 가용 수량 합산, jig_state=1)");
  if (sortedProducts.length === 0) {
    lines.push("│   (가용 공지그 없음)");
  } else {
    sortedProducts.forEach((key) => {
      const cnt = outCounts.get(key);
      lines.push(`│   제품 ${pad(key, 4)}  ${String(cnt).padStart(3)}개`);
    });
  }

  lines.push("└─────────────────────────────────────────────────────────────");
  lines.push("");
  //console.log(lines.join("\n"));
}

async function checkScenario1(config, activeTasks) {
  if (scenario1Lock) return;
  if (TEST_AMR1_DISABLED) return; // 시나리오 테스트: AMR1(M500-S-01) 비활성화
  scenario1Lock = true;
  try {
    const cfg = config || (await loadConfig());
    const activeSides = SIDES.filter((side) => {
      const workId = normalizeText(cfg.sideSignals?.[side]?.work_available_id);
      return workId && isSignalOn(workId);
    });
    if (!activeSides.length) return;
    if (activeSides.length === 1) {
      await createTaskForSides(activeSides, cfg, activeTasks);
      return;
    }
    // L/R 둘 다 ON인 경우: L 우선
    console.log(`[TaskCreate] 시나리오1(L/R) 조건: L/R 모두 ON → L 선택`);
    await createTaskForSides(["L"], cfg, activeTasks);
  } catch (err) {
    //console.error(`[TaskCreate] 시나리오1 체크 오류:`, err?.message || err);
  } finally {
    scenario1Lock = false;
  }
}

async function checkGrinderOutput(config, activeTasks) {
  if (grinderOutputLock) return;
  grinderOutputLock = true;
  try {
    const cfg = config || (await loadConfig());
    await createTaskForGrinderOutput(cfg, activeTasks);
  } catch (err) {
    console.error("[TaskCreate] 시나리오2 체크 오류:", err?.message || err);
  } finally {
    grinderOutputLock = false;
  }
}

async function checkConveyors(config, activeTasks) {
  // 모든 컨베이어의 요청을 수집
  const conveyorRequests = [];
  
  for (const item of config.conveyors || []) {
    const index = item.index;
    if (conveyorLock.get(index)) continue;
    
    const qty4 = normalizeText(item.input_qty_4_id);
    const qty1 = normalizeText(item.input_qty_1_id);
    const qty = qty4 && isSignalOn(qty4) ? 4 : qty1 && isSignalOn(qty1) ? 1 : 0;
    
    if (!qty) continue;
    
    const rawProductNo = item.product_no;
    const productNo =
      rawProductNo != null && String(rawProductNo).trim() !== ""
        ? Number(rawProductNo)
        : null;
    
    if (productNo === null || Number.isNaN(productNo)) {
      //console.warn(`[TaskCreate] conveyor${index}: 제품 번호 없음`);
      continue;
    }
    
    conveyorRequests.push({ item, qty, productNo });
  }
  
  if (!conveyorRequests.length) return;
  
  // 모든 관련 컨베이어 락 설정
  for (const req of conveyorRequests) {
    conveyorLock.set(req.item.index, true);
  }
  
  try {
    //console.log(`[TaskCreate] 컨베이어 요청 감지: ${conveyorRequests.map(r => `C${r.item.index}(제품${r.productNo}, ${r.qty}개)`).join(', ')}`);
    await createTaskForConveyors(conveyorRequests, config, activeTasks);
  } catch (err) {
    console.error(`[TaskCreate] 컨베이어 통합 체크 오류:`, err?.message || err);
  } finally {
    // 모든 컨베이어 락 해제
    for (const req of conveyorRequests) {
      conveyorLock.set(req.item.index, false);
    }
  }
}

function start() {
  if (checkTimer) return;
  checkTimer = setInterval(async () => {
    try {
      const config = await loadConfig();
      const activeTasks = await getActiveTasks();
      await logTaskCreateStatus(config);
      
      await checkScenario1(config, activeTasks);
      await checkGrinderOutput(config, activeTasks);
      await checkConveyors(config, activeTasks);
    } catch (err) {
      console.error("[TaskCreate] loop error:", err?.message || err);
    }
  }, CHECK_INTERVAL_MS);
  // 즉시 1회 실행
  (async () => {
    try {
      const config = await loadConfig();
      const activeTasks = await getActiveTasks();
      await logTaskCreateStatus(config);
      
      await checkScenario1(config, activeTasks);
      await checkGrinderOutput(config, activeTasks);
      await checkConveyors(config, activeTasks);
    } catch (err) {
      console.error("[TaskCreate] loop error:", err?.message || err);
    }
  })();
  //console.log("[TaskCreate] service started");
}

start();
