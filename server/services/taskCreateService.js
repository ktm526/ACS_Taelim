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
        console.log(`[TaskCreate] 로봇(${robotIp}) TASK_STATUS=${taskStatus} (작업 중) → 태스크 발행 스킵`);
      }
      return isIdle;
    }
    console.warn(`[TaskCreate] 로봇(${robotIp}) doosan_state 응답 없음`);
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

const SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];
const OUT_SIDES = ["L1", "L2", "R1", "R2"];
const OUT_ROWS = [1, 2, 3, 4, 5, 6];

const CHECK_INTERVAL_MS = 1000;
const CONFIG_TTL_MS = 2000;
const STATUS_LOG_INTERVAL_MS = 5000; // 5초마다 상태 출력

const sideLock = { L: false, R: false };
const conveyorLock = new Map();
let configCache = null;
let configFetchedAt = 0;
let checkTimer = null;
let lastStatusLogTime = 0;

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

  const [instockerRow, grinderRow, outstockerRow, conveyorRow] = await Promise.all([
    DeviceInStocker.findByPk(1),
    DeviceGrinder.findByPk(1),
    DeviceOutStocker.findByPk(1),
    DeviceConveyor.findByPk(1),
  ]);

  const instockerSlots = safeParse(instockerRow?.slots, {});
  const sideSignals = safeParse(instockerRow?.side_signals, {});
  const grinders = safeParse(grinderRow?.grinders, []);
  const outstockerSides = safeParse(outstockerRow?.sides, {});
  const conveyors = safeParse(conveyorRow?.conveyors, []);

  configCache = { instockerSlots, sideSignals, grinders, outstockerSides, conveyors };
  configFetchedAt = now;
  return configCache;
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
      });
      byProduct.set(productKey, list);
    });
  });
  return byProduct;
}

async function getActiveTasks() {
  return Task.findAll({
    where: { status: ["PENDING", "RUNNING", "PAUSED"] },
    include: [{ model: TaskStep, as: "steps" }],
  });
}

async function createTaskForSide(side, config, activeTasks) {
  //console.log(`[TaskCreate] ${side}: createTaskForSide 시작`);
  
  const slots = getSideSlots(config.instockerSlots, side);
  if (slots.length === 0) {
    //console.log(`[TaskCreate] ${side}: 슬롯 정보 없음`);
    return;
  }

  const pickupStation = slots[0]?.amr_pos;
  if (!pickupStation) {
    //console.warn(`[TaskCreate] ${side}: L/R 1번 칸 AMR pos 없음`);
    return;
  }
  //console.log(`[TaskCreate] ${side}: 픽업 스테이션=${pickupStation}`);

  const availableByProduct = buildAvailableGrinderPositions(config.grinders);
  //console.log(`[TaskCreate] ${side}: 연마기 투입가능 위치:`, 
  //  Array.from(availableByProduct.entries()).map(([k, v]) => `제품${k}:${v.length}개`).join(', ') || '없음'
//  );

  const slotTargets = [];
  for (const slot of slots) {
    if (!slot.product_type_id || slot.product_type_value === null || !slot.mani_pos) {
      //console.warn(`[TaskCreate] ${side}: 슬롯 ${slot.key} 설정 누락 (product_type_id=${slot.product_type_id}, value=${slot.product_type_value}, mani=${slot.mani_pos})`);
      return;
    }
    const productKey = String(slot.product_type_value);
    const list = availableByProduct.get(productKey) || [];
    if (list.length === 0) {
      //console.log(`[TaskCreate] ${side}: 제품 ${productKey} 투입 가능 위치 부족 (슬롯 ${slot.key})`);
      return;
    }
    const next = list.shift();
    slotTargets.push({
      slotIndex: slot.index,
      product_type_id: slot.product_type_id,
      instocker_mani_pos: slot.mani_pos,
      grinder_station: next.station,
      grinder_mani_pos: next.mani_pos,
    });
    availableByProduct.set(slot.product_type_id, list);
    console.log(`[TaskCreate] ${side}: 슬롯 ${slot.key}(제품${productKey}) → 연마기 ${next.grinderIndex}-${next.position}`);
  }

  const robot = await Robot.findOne({ where: { name: "M1000" } });
  if (!robot) {
    //console.warn("[TaskCreate] M1000 로봇 없음");
    return;
  }
  //console.log(`[TaskCreate] ${side}: 로봇=${robot.name}(ID:${robot.id}), 상태=${robot.status}`);

  // Robot의 슬롯 정보 파싱 (slot_no 목록)
  const robotSlots = safeParse(robot.slots, []);
  const slotNos = robotSlots
    .map((s) => (typeof s === "object" ? s.slot_no : s))
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  
  if (slotNos.length < slots.length) {
    console.warn(`[TaskCreate] ${side}: AMR 슬롯 부족 (필요: ${slots.length}, 보유: ${slotNos.length})`);
    return;
  }

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    //console.log(`[TaskCreate] ${side}: M1000 기존 태스크 진행 중 (Task#${existingTask.id}, ${existingTask.status})`);
    return;
  }

  const steps = [];
  steps.push({ type: "NAV", payload: JSON.stringify({ dest: pickupStation }) });

  // 인스토커 -> AMR 적재 (1칸 ~ 6칸 순서)
  // CMD_ID는 항상 1, CMD_FROM=인스토커 mani_pos, CMD_TO=AMR 슬롯(slot_no)
  slots.forEach((slot, idx) => {
    const amrSlotNo = slotNos[idx]; // Robot에 설정된 slot_no 사용
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1, // 항상 1
        CMD_FROM: Number(slot.mani_pos), // 인스토커 mani_pos
        CMD_TO: amrSlotNo, // AMR slot_no
        VISION_CHECK: 1, // 인스토커에서 픽업할 때는 1
      }),
    });
  });

  // AMR -> 연마기 투입 (나중에 넣은 제품부터, 6개 순서쌍)
  // CMD_ID는 항상 1, CMD_FROM=AMR 슬롯(slot_no), CMD_TO=연마기 mani_pos
  // slotTargets의 slotIndex(1~6)를 slotNos로 매핑
  const slotTargetsDesc = [...slotTargets].sort(
    (a, b) => b.slotIndex - a.slotIndex
  );
  slotTargetsDesc.forEach((target) => {
    const amrSlotNo = slotNos[target.slotIndex - 1]; // slotIndex는 1부터 시작
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: target.grinder_station }),
    });
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1, // 항상 1
        CMD_FROM: amrSlotNo, // AMR slot_no
        CMD_TO: Number(target.grinder_mani_pos), // 연마기 mani_pos
        VISION_CHECK: 0, // 연마기에 놓을 때는 0
      }),
    });
  });

  if (robot.home_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_station }),
    });
  }

  const tasks = activeTasks || (await getActiveTasks());
  const newStations = new Set([pickupStation, ...slotTargets.map((t) => t.grinder_station)]);
  const newPlcIds = new Set();
  if (hasResourceOverlap(newStations, newPlcIds, tasks)) {
    //console.log(`[TaskCreate] ${side}: 기존 태스크와 스테이션/PLC 중복, 생성 스킵`);
    return;
  }

  // 로봇 매니퓰레이터 TASK_STATUS 확인 (0이어야 발행)
  const robotReady = await checkRobotTaskStatus(robot.ip);
  if (!robotReady) {
    return;
  }

  const task = await Task.create(
    {
      robot_id: robot.id,
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  console.log(`[TaskCreate] ${side}: Task#${task.id} 생성 (${steps.length} 스텝)`);
  await logTaskEvent(task.id, "TASK_CREATED", `인스토커 ${side} → 연마기 태스크 생성 (${steps.length} 스텝)`, {
    robotId: robot.id,
    robotName: robot.name,
    payload: { side, stepsCount: steps.length },
  });
}

function getAvailableOutstockerRows(outstockerSides, productNo, qty) {
  const rows = [];
  for (const side of OUT_SIDES) {
    const sideData = outstockerSides?.[side] || {};
    const amrPos = normalizeText(sideData.amr_pos);
    if (!amrPos) continue;
    for (const row of OUT_ROWS) {
      const rowData = sideData.rows?.[row] || {};
      const jigState = resolvePlcValue(rowData.jig_state_id);
      const modelNo = resolvePlcValue(rowData.model_no_id);
      const maniPos = normalizeText(rowData.mani_pos);
      
      // mani_pos가 없으면 사용할 수 없으므로 스킵
      if (!maniPos) continue;
      
      if (jigState === 1 && modelNo !== null && Number(modelNo) === Number(productNo)) {
        rows.push({ side, row, amr_pos: amrPos, mani_pos: maniPos });
        if (rows.length >= qty) return rows;
      }
    }
  }
  return rows;
}

/** 아웃스토커 공지그 제품별 가용 수량 합산 (jig_state=1, model_no 기준) */
function getOutstockerProductCounts(outstockerSides) {
  const counts = new Map();
  
  // 디버깅: 전체 구조 확인
  if (!outstockerSides || Object.keys(outstockerSides).length === 0) {
    console.log(`[TaskCreate] getOutstockerProductCounts: outstockerSides가 비어있음`);
    return counts;
  }
  
  for (const side of OUT_SIDES) {
    const sideData = outstockerSides?.[side] || {};
    const rowsData = sideData.rows;
    
    // 디버깅: rows 구조 확인
    if (!rowsData || typeof rowsData !== 'object') {
      console.log(`[TaskCreate] ${side}: rows 데이터 없음 또는 객체 아님 (type: ${typeof rowsData})`);
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
    console.log(`[TaskCreate] ${side} row1: jig_state_id=${j1}→${v1}, model_no_id=${m1}→${v2} | 측면 jig_ok=${sideJigOk}`);
  }
  return counts;
}

// 통합 컨베이어 태스크 생성 (여러 컨베이어 요청을 하나의 태스크로 처리)
async function createTaskForConveyors(conveyorRequests, config, activeTasks) {
  // conveyorRequests: [{ item, qty, productNo }, ...]
  
  if (!conveyorRequests.length) return;
  
  console.log(`[TaskCreate] 컨베이어 요청: ${conveyorRequests.map(r => `C${r.item.index}(제품${r.productNo}, ${r.qty}개)`).join(' + ')}`);
  
  // 로봇 확인
  const robot = await Robot.findOne({ where: { name: "M500-S-02" } });
  if (!robot) {
    console.warn("[TaskCreate] M500-S-02 로봇 없음");
    return;
  }

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    console.log(`[TaskCreate] 컨베이어 통합: M500-S-02 기존 태스크 진행 중`);
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
      console.warn(`[TaskCreate] conveyor${req.item.index}: AMR pos 없음 → 스킵`);
      continue;
    }
    if (!maniPos) {
      console.warn(`[TaskCreate] conveyor${req.item.index}: Mani Pos 없음 → 스킵`);
      continue;
    }
    
    // 아웃스토커 공지그 확인
    const rows = getAvailableOutstockerRows(config.outstockerSides, req.productNo, req.qty);
    if (rows.length < req.qty) {
      console.log(`[TaskCreate] 컨베이어${req.item.index}: 제품${req.productNo} 공지그 부족 (${rows.length}/${req.qty}) → 스킵`);
      continue;
    }
    
    validRequests.push({ ...req, rows });
  }
  
  if (!validRequests.length) {
    console.log(`[TaskCreate] 컨베이어 통합: 처리 가능한 요청 없음`);
    return;
  }
  
  // 처리 가능한 요청만으로 진행
  const totalQty = validRequests.reduce((sum, r) => sum + r.qty, 0);
  console.log(`[TaskCreate] 컨베이어 통합: 처리 가능 ${validRequests.map(r => `C${r.item.index}(${r.qty}개)`).join(' + ')} = 총 ${totalQty}개`);
  
  if (slotNos.length < totalQty) {
    console.warn(`[TaskCreate] 컨베이어 통합: AMR 슬롯 부족 (필요: ${totalQty}, 보유: ${slotNos.length})`);
    return;
  }

  // 각 컨베이어별로 필요한 아웃스토커 row 수집
  const pickupInfos = []; // { rowInfo, conveyorItem, productNo, slotIndex }
  let slotIndex = 0;
  
  for (const req of validRequests) {
    for (let i = 0; i < req.qty; i++) {
      pickupInfos.push({
        rowInfo: req.rows[i],
        conveyorItem: req.item,
        productNo: req.productNo,
        slotIndex: slotIndex,
      });
      slotIndex++;
    }
  }
  
  console.log(`[TaskCreate] 컨베이어 통합: 아웃스토커 픽업 ${pickupInfos.length}개 예정`);
  pickupInfos.forEach((p, i) => {
    console.log(`  [${i+1}] ${p.rowInfo.side}-${p.rowInfo.row} → C${p.conveyorItem.index}용 (제품${p.productNo})`);
  });

  const steps = [];
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: 아웃스토커에서 모든 지그 픽업
  // ═══════════════════════════════════════════════════════════════
  for (let idx = 0; idx < pickupInfos.length; idx++) {
    const info = pickupInfos[idx];
    const amrSlotNo = slotNos[idx];
    
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: info.rowInfo.amr_pos }),
    });
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: 1,
        CMD_FROM: Number(info.rowInfo.mani_pos),
        CMD_TO: amrSlotNo,
        VISION_CHECK: 1,
      }),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: 각 컨베이어에 순차적으로 투입
  // ═══════════════════════════════════════════════════════════════
  for (const req of validRequests) {
    const conveyorItem = req.item;
    const amrPos = normalizeText(conveyorItem.amr_pos);
    const conveyorManiPos = normalizeText(conveyorItem.mani_pos);
    
    // 해당 컨베이어로 이동
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: amrPos }),
    });
    
    // 해당 컨베이어에 투입할 지그들 찾기
    const itemsForThisConveyor = pickupInfos.filter(
      p => p.conveyorItem.index === conveyorItem.index
    );
    
    // 각 지그 투입 시퀀스
    for (const info of itemsForThisConveyor) {
      const amrSlotNo = slotNos[info.slotIndex];
      
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.stop_request_id, PLC_DATA: 1 }),
      });
      steps.push({
        type: "PLC_READ",
        payload: JSON.stringify({ PLC_ID: conveyorItem.stop_id, EXPECTED: 1 }),
      });
      steps.push({
        type: "PLC_READ",
        payload: JSON.stringify({ PLC_ID: conveyorItem.input_ready_id, EXPECTED: 1 }),
      });
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_in_progress_id, PLC_DATA: 1 }),
      });
      steps.push({
        type: "MANI_WORK",
        payload: JSON.stringify({
          CMD_ID: 1,
          CMD_FROM: amrSlotNo,
          CMD_TO: Number(conveyorManiPos),
          VISION_CHECK: 0,
        }),
      });
      steps.push({
        type: "PLC_WRITE",
        payload: JSON.stringify({ PLC_BIT: conveyorItem.input_done_id, PLC_DATA: 1 }),
      });
    }
  }

  // 리소스 중복 체크
  const tasks = activeTasks || (await getActiveTasks());
  const newStations = new Set([
    ...validRequests.map(r => normalizeText(r.item.amr_pos)),
    ...pickupInfos.map(p => p.rowInfo.amr_pos),
  ].filter(Boolean));
  
  const newPlcIds = new Set(
    validRequests.flatMap(r => [
      r.item.stop_request_id,
      r.item.stop_id,
      r.item.input_ready_id,
      r.item.input_in_progress_id,
      r.item.input_done_id,
    ])
      .map(normalizeText)
      .filter(Boolean)
  );
  
  if (hasResourceOverlap(newStations, newPlcIds, tasks)) {
    console.log(`[TaskCreate] 컨베이어 통합: 기존 태스크와 중복, 생성 스킵`);
    return;
  }

  // 로봇 매니퓰레이터 TASK_STATUS 확인
  const robotReady = await checkRobotTaskStatus(robot.ip);
  if (!robotReady) {
    return;
  }

  const task = await Task.create(
    {
      robot_id: robot.id,
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  const summary = validRequests.map(r => `C${r.item.index}:${r.qty}`).join('+');
  console.log(
    `[TaskCreate] 컨베이어 통합(${summary}): Task#${task.id} 발행 (${steps.length} steps)`
  );
  await logTaskEvent(task.id, "TASK_CREATED", `아웃스토커 → 컨베이어 통합 태스크 (${summary}, ${steps.length} 스텝)`, {
    robotId: robot.id,
    robotName: robot.name,
    payload: { conveyors: validRequests.map(r => ({ index: r.item.index, qty: r.qty })), stepsCount: steps.length },
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
  lines.push("│ [TaskCreate] 시나리오 3번 (컨베이어 → 아웃스토커) 조건 상태");
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
  console.log(lines.join("\n"));
}

async function checkSide(side, config, activeTasks) {
  if (sideLock[side]) return;
  sideLock[side] = true;
  try {
    const cfg = config || (await loadConfig());
    const workId = normalizeText(config.sideSignals?.[side]?.work_available_id);
    if (!workId) {
      // console.log(`[TaskCreate] ${side}: work_available_id 설정 없음`);
      return;
    }

    const current = isSignalOn(workId) ? 1 : 0;
    if (current === 1) {
     // console.log(`[TaskCreate] ${side}: 작업가능 신호 ON (${workId}=1) → 태스크 생성 시도`);
      await createTaskForSide(side, cfg, activeTasks);
    }
  } catch (err) {
    //console.error(`[TaskCreate] ${side} 체크 오류:`, err?.message || err);
  } finally {
    sideLock[side] = false;
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
      console.warn(`[TaskCreate] conveyor${index}: 제품 번호 없음`);
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
    console.log(`[TaskCreate] 컨베이어 요청 감지: ${conveyorRequests.map(r => `C${r.item.index}(제품${r.productNo}, ${r.qty}개)`).join(', ')}`);
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
      
      // 기존 활성 태스크가 있으면 새 작업 발행하지 않음
      if (activeTasks.length > 0) {
        return;
      }
      
      SIDES.forEach((side) => {
        checkSide(side, config, activeTasks);
      });
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
      
      // 기존 활성 태스크가 있으면 새 작업 발행하지 않음
      if (activeTasks.length > 0) {
        return;
      }
      
      SIDES.forEach((side) => {
        checkSide(side, config, activeTasks);
      });
      await checkConveyors(config, activeTasks);
    } catch (err) {
      console.error("[TaskCreate] loop error:", err?.message || err);
    }
  })();
  console.log("[TaskCreate] service started");
}

start();
