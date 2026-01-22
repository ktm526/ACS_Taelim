// services/taskExecutorService.js
const ModbusRTU = require("modbus-serial");
const net = require("net");
const plc = require("./plcMonitorService");
const { Task, TaskStep } = require("../models");
const Robot = require("../models/Robot");
const MapDB = require("../models/Map");
const { sendGotoNav } = require("./navService");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const WORD_MODE = (process.env.PLC_WORD_MODE || "holding").toLowerCase(); // holding | input
const MANI_CMD_PORT = Number.parseInt(process.env.MANI_CMD_PORT || "19207", 10);
const MANI_CMD_API = Number.parseInt(process.env.MANI_CMD_API || "3054", 10);
const ROBOT_IO_PORT = Number.parseInt(process.env.ROBOT_IO_PORT || "19210", 10);
const ROBOT_DO_API = Number.parseInt(process.env.ROBOT_DO_API || "6021", 10);
const MANI_WORK_TIMEOUT_MS = Number.parseInt(
  process.env.MANI_WORK_TIMEOUT_MS || "300000",
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

function sendTcpCommand(ip, port, apiCode, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, ip);
    const done = (err) => {
      try {
        sock.destroy();
      } catch {}
      if (err) reject(err);
      else resolve();
    };
    sock.once("connect", () => {
      sock.write(buildPacket(apiCode, payload), () => done());
    });
    sock.once("error", (e) => done(e));
    sock.setTimeout(2000, () => done(new Error("tcp timeout")));
  });
}

function setRobotDo(ip, doId, status) {
  return sendTcpCommand(ip, ROBOT_IO_PORT, ROBOT_DO_API, {
    id: Number(doId),
    status: status ? 1 : 0,
  });
}

function sendManiCommand(ip, payload) {
  const body = {
    CMD_ID: Number(payload.CMD_ID) || 0,
    CMD_FROM: Number(payload.CMD_FROM) || 0,
    CMD_TO: Number(payload.CMD_TO) || 0,
  };
  return sendTcpCommand(ip, MANI_CMD_PORT, MANI_CMD_API, body);
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

async function waitForManiResult(robotId, taskId) {
  const started = Date.now();
  while (Date.now() - started <= MANI_WORK_TIMEOUT_MS) {
    const fresh = await Robot.findByPk(robotId);
    const diOk = getRobotDiStatus(fresh, MANI_WORK_OK_DI);
    const diErr = getRobotDiStatus(fresh, MANI_WORK_ERR_DI);
    if (diOk === true) return "success";
    if (diErr === true) return "error";
    if (taskId) {
      const t = await Task.findByPk(taskId);
      if (["PAUSED", "CANCELED", "FAILED"].includes(t?.status)) return "canceled";
    }
    await delay(500);
  }
  return "timeout";
}

async function markStepFailed(step) {
  await step.update({ status: "FAILED" });
  await Task.update({ status: "FAILED" }, { where: { id: step.task_id } });
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
  if (step.type === "NAV") {
    if (!payload.dest) throw new Error("NAV dest missing");
    const mapRow = await MapDB.findOne({ where: { is_current: true } });
    const stations = JSON.parse(mapRow?.stations || "{}").stations || [];
    const target = resolveStationId(stations, payload.dest);
    if (!target) throw new Error("NAV station not found");

    if (!inFlightNav.has(step.id)) {
      await Robot.update(
        { destination: target.name },
        { where: { id: robot.id } }
      );
      await sendGotoNav(robot.ip, target.id, "SELF_POSITION", String(Date.now()));
      inFlightNav.add(step.id);
    }

    const ok = await waitUntil(async () => {
      const fresh = await Robot.findByPk(robot.id);
      return fresh && String(fresh.location) === String(target.id);
    }, 30 * 60 * 1000, step.task_id);

    if (!ok) return false;
    inFlightNav.delete(step.id);
    await delay(5000);
    return true;
  }
  if (step.type === "MANI_WORK") {
    const cmdId = payload.CMD_ID;
    const cmdFrom = payload.CMD_FROM;
    const cmdTo = payload.CMD_TO;
    if (cmdId === undefined || cmdFrom === undefined || cmdTo === undefined) {
      await markStepFailed(step);
      throw new Error("MANI_WORK payload missing");
    }

    if (!inFlightMani.has(step.id)) {
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, true);
        await sendManiCommand(robot.ip, payload);
        inFlightMani.add(step.id);
      } catch (err) {
        await markStepFailed(step);
        throw err;
      }
    }

    const result = await waitForManiResult(robot.id, step.task_id);
    if (result === "success") {
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false);
      } catch {}
      return true;
    }
    if (result === "error") {
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false);
      } catch {}
      await markStepFailed(step);
      throw new Error("MANI_WORK failed (DI error)");
    }
    if (result === "timeout") {
      inFlightMani.delete(step.id);
      try {
        await setRobotDo(robot.ip, MANI_WORK_DO_ID, false);
      } catch {}
      await markStepFailed(step);
      throw new Error("MANI_WORK timeout");
    }
    return false;
  }
  if (step.type === "PLC_WRITE") {
    if (!payload.PLC_BIT) throw new Error("PLC_WRITE id missing");
    await writePlc(payload.PLC_BIT, payload.PLC_DATA);
    return true;
  }
  if (step.type === "PLC_READ") {
    if (!payload.PLC_ID) throw new Error("PLC_READ id missing");
    const current = readPlc(payload.PLC_ID);
    if (current === null) return false;
    return Number(current) === Number(payload.EXPECTED);
  }
  return true;
}

async function progressTask(task, robot) {
  const steps = (task.steps || []).slice().sort((a, b) => a.seq - b.seq);
  if (!steps.length) {
    await task.update({ status: "DONE" });
    return;
  }
  let seq = Number(task.current_seq ?? 0);
  const step = steps.find((s) => s.seq === seq);
  if (!step) {
    await task.update({ status: "DONE" });
    return;
  }

  if (step.status === "DONE") {
    await task.update({ current_seq: seq + 1 });
    return;
  }

  if (step.status !== "RUNNING") {
    await step.update({ status: "RUNNING" });
  }

  const ok = await executeStep(step, robot);
  if (step.type === "PLC_READ" && !ok) {
    // 조건 미충족이면 대기
    await step.update({ status: "PENDING" });
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

  await step.update({ status: "DONE" });
  await task.update({ current_seq: seq + 1 });

  const lastSeq = steps[steps.length - 1]?.seq;
  if (seq + 1 > lastSeq) {
    await task.update({ status: "DONE" });
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

    if (pendingTask && robot.status === "대기") {
      await pendingTask.update({ status: "RUNNING", current_seq: 0 });
      await progressTask(pendingTask, robot);
    }
  } catch (err) {
    console.error(`[TaskExecutor] robot ${robot.id} error:`, err?.message || err);
  } finally {
    robotLocks.set(robot.id, false);
  }
}

async function tick() {
  const robots = await Robot.findAll();
  const tasks = await Task.findAll({
    where: { status: ["PENDING", "RUNNING"] },
    include: [{ model: TaskStep, as: "steps" }],
    order: [["id", "ASC"]],
  });

  const tasksByRobot = new Map();
  tasks.forEach((task) => {
    const list = tasksByRobot.get(task.robot_id) || [];
    list.push(task);
    tasksByRobot.set(task.robot_id, list);
  });

  for (const robot of robots) {
    if (["연결 끊김", "오류"].includes(robot.status)) continue;
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