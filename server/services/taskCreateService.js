// [시나리오]
// 1. in스토커 -> 연마기
//  - in스토커 enable
//  - 인스토커로 이동해서 -> 물건 (최대 6개)를 AMR에 적재하고,
//  - 연마기 input 가능 개수가 ok 될 때 까지 대기 (max 대기시간을 세팅값에서 사용해서, 지나면 alarm)
//  - 연마기(제품 조건에 맞는)에 투입
//  - 복귀

const plc = require("./plcMonitorService");
const DeviceInStocker = require("../models/DeviceInStocker");
const DeviceGrinder = require("../models/DeviceGrinder");
const DeviceOutStocker = require("../models/DeviceOutStocker");
const DeviceConveyor = require("../models/DeviceConveyor");
const Robot = require("../models/Robot");
const { Task, TaskStep } = require("../models");

const SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];
const OUT_SIDES = ["L1", "L2", "R1", "R2"];
const OUT_ROWS = [1, 2, 3, 4, 5, 6];

const CHECK_INTERVAL_MS = 1000;
const CONFIG_TTL_MS = 2000;

const sideLock = { L: false, R: false };
const conveyorLock = new Map();
let configCache = null;
let configFetchedAt = 0;
let checkTimer = null;

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
  console.log(`[TaskCreate] ${side}: createTaskForSide 시작`);
  
  const slots = getSideSlots(config.instockerSlots, side);
  if (slots.length === 0) {
    console.log(`[TaskCreate] ${side}: 슬롯 정보 없음`);
    return;
  }

  const pickupStation = slots[0]?.amr_pos;
  if (!pickupStation) {
    console.warn(`[TaskCreate] ${side}: L/R 1번 칸 AMR pos 없음`);
    return;
  }
  console.log(`[TaskCreate] ${side}: 픽업 스테이션=${pickupStation}`);

  const availableByProduct = buildAvailableGrinderPositions(config.grinders);
  console.log(`[TaskCreate] ${side}: 연마기 투입가능 위치:`, 
    Array.from(availableByProduct.entries()).map(([k, v]) => `제품${k}:${v.length}개`).join(', ') || '없음'
  );

  const slotTargets = [];
  for (const slot of slots) {
    if (!slot.product_type_id || slot.product_type_value === null || !slot.mani_pos) {
      console.warn(`[TaskCreate] ${side}: 슬롯 ${slot.key} 설정 누락 (product_type_id=${slot.product_type_id}, value=${slot.product_type_value}, mani=${slot.mani_pos})`);
      return;
    }
    const productKey = String(slot.product_type_value);
    const list = availableByProduct.get(productKey) || [];
    if (list.length === 0) {
      console.log(`[TaskCreate] ${side}: 제품 ${productKey} 투입 가능 위치 부족 (슬롯 ${slot.key})`);
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
    console.warn("[TaskCreate] M1000 로봇 없음");
    return;
  }
  console.log(`[TaskCreate] ${side}: 로봇=${robot.name}(ID:${robot.id}), 상태=${robot.status}`);

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    console.log(`[TaskCreate] ${side}: M1000 기존 태스크 진행 중 (Task#${existingTask.id}, ${existingTask.status})`);
    return;
  }

  const steps = [];
  steps.push({ type: "NAV", payload: JSON.stringify({ dest: pickupStation }) });

  // 인스토커 -> AMR 적재 (1칸 ~ 6칸 순서)
  slots.forEach((slot) => {
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: slot.index,
        CMD_FROM: slot.mani_pos,
        CMD_TO: slot.index,
        VISION_CHECK: 1,
      }),
    });
  });

  // AMR -> 연마기 투입 (나중에 넣은 제품부터, 6개 순서쌍)
  const slotTargetsDesc = [...slotTargets].sort(
    (a, b) => b.slotIndex - a.slotIndex
  );
  slotTargetsDesc.forEach((target) => {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: target.grinder_station }),
    });
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: target.slotIndex,
        CMD_FROM: target.slotIndex,
        CMD_TO: target.grinder_mani_pos,
        VISION_CHECK: 0,
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
    console.log(`[TaskCreate] ${side}: 기존 태스크와 스테이션/PLC 중복, 생성 스킵`);
    return;
  }

  const task = await Task.create(
    {
      robot_id: robot.id,
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  console.log(
    `[TaskCreate] ${side}: 작업가능=1 → Task#${task.id} 발행 (${steps.length} steps)`
  );
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
      if (jigState === 1 && modelNo !== null && Number(modelNo) === Number(productNo)) {
        rows.push({ side, row, amr_pos: amrPos });
        if (rows.length >= qty) return rows;
      }
    }
  }
  return rows;
}

async function createTaskForConveyor(conveyorItem, config, qty, activeTasks) {
  const conveyorIndex = conveyorItem.index;
  const amrPos = normalizeText(conveyorItem.amr_pos);
  if (!amrPos) {
    console.warn(`[TaskCreate] conveyor${conveyorIndex}: AMR pos 없음`);
    return;
  }

  const productNo = resolvePlcValue(conveyorItem.product_no_id);
  if (productNo === null) {
    console.warn(`[TaskCreate] conveyor${conveyorIndex}: 제품 번호 없음`);
    return;
  }

  const rows = getAvailableOutstockerRows(config.outstockerSides, productNo, qty);
  if (rows.length < qty) {
    console.log(`[TaskCreate] conveyor${conveyorIndex}: 공지그 수량 부족 (${rows.length}/${qty})`);
    return;
  }

  const robot = await Robot.findOne({ where: { name: "M1000" } });
  if (!robot) {
    console.warn("[TaskCreate] M1000 로봇 없음");
    return;
  }

  const existingTask = await Task.findOne({
    where: { robot_id: robot.id, status: ["PENDING", "RUNNING", "PAUSED"] },
  });
  if (existingTask) {
    console.log(`[TaskCreate] conveyor${conveyorIndex}: M1000 기존 태스크 진행 중`);
    return;
  }

  const steps = [];
  // (AMR 이동 - MANI WORK) * qty  (아웃스토커 픽업)
  rows.slice(0, qty).forEach((rowInfo, idx) => {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: rowInfo.amr_pos }),
    });
    steps.push({
      type: "MANI_WORK",
      payload: JSON.stringify({
        CMD_ID: idx + 1,
        CMD_FROM: rowInfo.row,
        CMD_TO: idx + 1,
        VISION_CHECK: 1,
      }),
    });
  });

  // 컨베이어로 이동
  steps.push({
    type: "NAV",
    payload: JSON.stringify({ dest: amrPos }),
  });

  // (컨베이어 시퀀스) * qty
  for (let i = 0; i < qty; i += 1) {
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
        CMD_ID: i + 1,
        CMD_FROM: i + 1,
        CMD_TO: conveyorIndex,
        VISION_CHECK: 0,
      }),
    });
    steps.push({
      type: "PLC_WRITE",
      payload: JSON.stringify({ PLC_BIT: conveyorItem.input_done_id, PLC_DATA: 1 }),
    });
  }

  const tasks = activeTasks || (await getActiveTasks());
  const newStations = new Set([amrPos, ...rows.map((r) => r.amr_pos)]);
  const newPlcIds = new Set(
    [
      conveyorItem.stop_request_id,
      conveyorItem.stop_id,
      conveyorItem.input_ready_id,
      conveyorItem.input_in_progress_id,
      conveyorItem.input_done_id,
    ]
      .map(normalizeText)
      .filter(Boolean)
  );
  if (hasResourceOverlap(newStations, newPlcIds, tasks)) {
    console.log(`[TaskCreate] conveyor${conveyorIndex}: 기존 태스크와 중복, 생성 스킵`);
    return;
  }

  const task = await Task.create(
    {
      robot_id: robot.id,
      steps: steps.map((s, i) => ({ ...s, seq: i })),
    },
    { include: [{ model: TaskStep, as: "steps" }] }
  );

  console.log(
    `[TaskCreate] conveyor${conveyorIndex}: 투입수량 ${qty} → Task#${task.id} 발행 (${steps.length} steps)`
  );
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
      console.log(`[TaskCreate] ${side}: 작업가능 신호 ON (${workId}=1) → 태스크 생성 시도`);
      await createTaskForSide(side, cfg, activeTasks);
    }
  } catch (err) {
    console.error(`[TaskCreate] ${side} 체크 오류:`, err?.message || err);
  } finally {
    sideLock[side] = false;
  }
}

async function checkConveyors(config, activeTasks) {
  for (const item of config.conveyors || []) {
    const index = item.index;
    if (conveyorLock.get(index)) continue;
    conveyorLock.set(index, true);
    try {
      const qty4 = normalizeText(item.input_qty_4_id);
      const qty1 = normalizeText(item.input_qty_1_id);
      const qty =
        qty4 && isSignalOn(qty4) ? 4 : qty1 && isSignalOn(qty1) ? 1 : 0;
      if (!qty) continue;
      console.log(`[TaskCreate] Conveyor${index}: 투입수량 신호 감지 (qty=${qty}) → 태스크 생성 시도`);
      await createTaskForConveyor(item, config, qty, activeTasks);
    } catch (err) {
      console.error(`[TaskCreate] conveyor${item.index} 체크 오류:`, err?.message || err);
    } finally {
      conveyorLock.set(index, false);
    }
  }
}

function start() {
  if (checkTimer) return;
  checkTimer = setInterval(async () => {
    try {
      const config = await loadConfig();
      const activeTasks = await getActiveTasks();
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
