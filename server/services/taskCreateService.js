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
const Robot = require("../models/Robot");
const { Task, TaskStep } = require("../models");

const SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];

const CHECK_THROTTLE_MS = 300;
const CONFIG_TTL_MS = 2000;

const lastSideState = { L: 0, R: 0 };
const sideLock = { L: false, R: false };
let lastCheckAt = 0;
let configCache = null;
let configFetchedAt = 0;

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

async function loadConfig() {
  const now = Date.now();
  if (configCache && now - configFetchedAt < CONFIG_TTL_MS) return configCache;

  const [instockerRow, grinderRow] = await Promise.all([
    DeviceInStocker.findByPk(1),
    DeviceGrinder.findByPk(1),
  ]);

  const instockerSlots = safeParse(instockerRow?.slots, {});
  const sideSignals = safeParse(instockerRow?.side_signals, {});
  const grinders = safeParse(grinderRow?.grinders, []);

  configCache = { instockerSlots, sideSignals, grinders };
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

async function createTaskForSide(side, config) {
  const slots = getSideSlots(config.instockerSlots, side);
  if (slots.length === 0) return;

  const pickupStation = slots[0]?.amr_pos;
  if (!pickupStation) {
    console.warn(`[TaskCreate] ${side}: L/R 1번 칸 AMR pos 없음`);
    return;
  }

  const availableByProduct = buildAvailableGrinderPositions(config.grinders);
  const slotTargets = [];
  for (const slot of slots) {
    if (!slot.product_type_id || slot.product_type_value === null || !slot.mani_pos) {
      console.warn(`[TaskCreate] ${side}: 슬롯 ${slot.key} 설정 누락`);
      return;
    }
    const productKey = String(slot.product_type_value);
    const list = availableByProduct.get(productKey) || [];
    if (list.length === 0) {
      console.log(
        `[TaskCreate] ${side}: 제품 ${productKey} 투입 가능 위치 부족`
      );
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
    console.log(`[TaskCreate] M1000 기존 태스크 진행 중: ${existingTask.id}`);
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
      }),
    });
  });

  if (robot.home_station) {
    steps.push({
      type: "NAV",
      payload: JSON.stringify({ dest: robot.home_station }),
    });
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

async function checkSide(side) {
  if (sideLock[side]) return;
  sideLock[side] = true;
  try {
    const config = await loadConfig();
    const workId = normalizeText(config.sideSignals?.[side]?.work_available_id);
    if (!workId) return;

    const current = isSignalOn(workId) ? 1 : 0;
    const prev = lastSideState[side];
    if (current !== prev) lastSideState[side] = current;
    if (current === 1 && prev !== 1) {
      await createTaskForSide(side, config);
    }
  } catch (err) {
    console.error(`[TaskCreate] ${side} 체크 오류:`, err?.message || err);
  } finally {
    sideLock[side] = false;
  }
}

function onPlcUpdate() {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;
  SIDES.forEach((side) => {
    checkSide(side);
  });
}

function start() {
  plc.events.on("update", onPlcUpdate);
  console.log("[TaskCreate] service started");
}

start();
