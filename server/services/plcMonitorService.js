/**
 * plcMonitorService
 * - PLC(Modbus TCP) 값을 1초 주기로 폴링해서 메모리에 유지
 * - 다른 서비스에서 require 후 현재값 조회/구독 가능
 *
 * 요구사항:
 * - 6000~6021: bit 타입 (기본: Coils / FC01)
 * - 6030~6099: word 타입 (기본: Holding Registers / FC03)
 *
 * 환경변수:
 * - MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID
 * - PLC_POLL_MS (default: 1000)
 * - PLC_BIT_MODE: "coils" | "discrete_inputs" (default: coils)
 * - PLC_WORD_MODE: "holding" | "input" (default: holding)
 */

const ModbusRTU = require("modbus-serial");
const { EventEmitter } = require("events");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const POLL_MS = Number.parseInt(process.env.PLC_POLL_MS || "1000", 10);

const BIT_MODE = (process.env.PLC_BIT_MODE || "coils").toLowerCase(); // coils | discrete_inputs
const WORD_MODE = (process.env.PLC_WORD_MODE || "holding").toLowerCase(); // holding | input

const BIT_START = 6000;
const BIT_END = 6021;
const BIT_QTY = BIT_END - BIT_START + 1;

const WORD_START = 6030;
const WORD_END = 6099;
const WORD_QTY = WORD_END - WORD_START + 1;

const client = new ModbusRTU();
client.setTimeout(2000);

const events = new EventEmitter();
events.setMaxListeners(50);

let pollTimer = null;
let connecting = false;
let inFlight = false;

const state = {
  connected: false,
  lastPollAt: null,
  lastError: null,
  bits: new Map(), // addr -> boolean
  words: new Map(), // addr -> number
};

function snapshot() {
  return {
    connected: state.connected,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    bits: Object.fromEntries(state.bits.entries()),
    words: Object.fromEntries(state.words.entries()),
  };
}

function setBitsFromArray(arr) {
  for (let i = 0; i < BIT_QTY; i++) {
    const addr = BIT_START + i;
    state.bits.set(addr, Boolean(arr?.[i]));
  }
}

function setWordsFromArray(arr) {
  for (let i = 0; i < WORD_QTY; i++) {
    const addr = WORD_START + i;
    const v = arr?.[i];
    state.words.set(addr, typeof v === "number" ? v : Number(v));
  }
}

function diffMaps(prevMap, nextMap) {
  const changed = [];
  for (const [k, v] of nextMap.entries()) {
    if (prevMap.get(k) !== v) changed.push({ addr: k, value: v });
  }
  return changed;
}

async function ensureConnected() {
  if (state.connected) return true;
  if (connecting) return false;
  connecting = true;
  try {
    await client.connectTCP(HOST, { port: PORT });
    client.setID(UNIT_ID);
    state.connected = true;
    state.lastError = null;
    events.emit("connection", { connected: true });
    console.log(`[PLC] connected ${HOST}:${PORT} (unitId=${UNIT_ID})`);
    return true;
  } catch (e) {
    state.connected = false;
    state.lastError = e?.message || String(e);
    return false;
  } finally {
    connecting = false;
  }
}

async function readBits() {
  if (BIT_MODE === "discrete_inputs") {
    const r = await client.readDiscreteInputs(BIT_START, BIT_QTY);
    return r?.data ?? [];
  }
  // default coils
  const r = await client.readCoils(BIT_START, BIT_QTY);
  return r?.data ?? [];
}

async function readWords() {
  if (WORD_MODE === "input") {
    const r = await client.readInputRegisters(WORD_START, WORD_QTY);
    return r?.data ?? [];
  }
  // default holding
  const r = await client.readHoldingRegisters(WORD_START, WORD_QTY);
  return r?.data ?? [];
}

async function pollOnce() {
  if (inFlight) return;
  inFlight = true;

  const prevBits = new Map(state.bits);
  const prevWords = new Map(state.words);

  try {
    const ok = await ensureConnected();
    if (!ok) return;

    const bitsArr = await readBits();
    const wordsArr = await readWords();

    setBitsFromArray(bitsArr);
    setWordsFromArray(wordsArr);

    state.lastPollAt = new Date();
    state.lastError = null;

    const changedBits = diffMaps(prevBits, state.bits);
    const changedWords = diffMaps(prevWords, state.words);
    if (changedBits.length || changedWords.length) {
      events.emit("change", { bits: changedBits, words: changedWords, at: state.lastPollAt });
    }
    events.emit("update", snapshot());
  } catch (e) {
    state.lastError = e?.message || String(e);
    state.connected = false;
    events.emit("connection", { connected: false, error: state.lastError });
    console.warn("[PLC] poll error:", state.lastError);
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
  pollOnce();
  console.log(
    `[PLC] monitor started (pollMs=${POLL_MS}, bit=${BIT_MODE} ${BIT_START}-${BIT_END}, word=${WORD_MODE} ${WORD_START}-${WORD_END})`
  );
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  try {
    client.close(() => {});
  } catch {}
  state.connected = false;
  console.log("[PLC] monitor stopped");
}

// getters (다른 서비스에서 활용)
function getBit(addr) {
  return state.bits.get(Number(addr));
}
function getWord(addr) {
  return state.words.get(Number(addr));
}
function getBits() {
  return Object.fromEntries(state.bits.entries());
}
function getWords() {
  return Object.fromEntries(state.words.entries());
}
function getRange(start, end) {
  const s = Number(start);
  const e = Number(end);
  const out = {};
  for (let a = s; a <= e; a++) {
    if (a >= BIT_START && a <= BIT_END) out[a] = state.bits.get(a);
    else if (a >= WORD_START && a <= WORD_END) out[a] = state.words.get(a);
  }
  return out;
}

// require 시 자동 시작
start();

module.exports = {
  start,
  stop,
  events, // events.on('update'|'change'|'connection', handler)
  snapshot,
  getBit,
  getWord,
  getBits,
  getWords,
  getRange,
  BIT_START,
  BIT_END,
  WORD_START,
  WORD_END,
};
