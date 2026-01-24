/**
 * plcMonitorService
 * - PLC(Modbus TCP) 값을 1초 주기로 폴링해서 메모리에 유지
 * - 다른 서비스에서 require 후 현재값 조회/구독 가능
 *
 * 요구사항:
 * - 6000~6021: word(16bit)로 읽고, 6000.0~6000.F 형태로 bit 분해해서 사용
 * - 6030~6099: word 타입 (기본: Holding Registers / FC03)
 *
 * 환경변수:
 * - MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID
 * - PLC_POLL_MS (default: 1000)
 * - PLC_BIT_MODE: "word_holding" | "word_input" | "coils" | "discrete_inputs" (default: word_holding)
 * - PLC_WORD_MODE: "holding" | "input" (default: holding)
 */

const ModbusRTU = require("modbus-serial");
const { EventEmitter } = require("events");

const HOST = process.env.MODBUS_HOST || "192.168.3.31";
const PORT = Number.parseInt(process.env.MODBUS_PORT || "502", 10);
const UNIT_ID = Number.parseInt(process.env.MODBUS_UNIT_ID || "1", 10);
const POLL_MS = Number.parseInt(process.env.PLC_POLL_MS || "1000", 10);

const BIT_MODE = (process.env.PLC_BIT_MODE || "word_holding").toLowerCase(); // word_holding | word_input | coils | discrete_inputs
const WORD_MODE = (process.env.PLC_WORD_MODE || "holding").toLowerCase(); // holding | input

const BIT_START = 6000;
const BIT_END = 6029;  // 6023까지 사용하므로 여유있게 확장
const BIT_QTY = BIT_END - BIT_START + 1;

const WORD_START = 6030;
const WORD_END = 6149;  // 6120까지 사용하므로 여유있게 확장
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
  bitWords: new Map(), // addr(6000~6021) -> 0..65535
  words: new Map(), // addr -> number
};

function snapshot() {
  // 6000~6021: word -> (0~F bit) 분해
  const bitBlocks = [];
  const bitDot = {};
  for (let addr = BIT_START; addr <= BIT_END; addr++) {
    const value = Number(state.bitWords.get(addr) ?? 0);
    const v16 = Number.isFinite(value) ? (value & 0xffff) : 0;
    const bits = [];
    for (let b = 0; b < 16; b++) {
      const on = (v16 & (1 << b)) !== 0 ? 1 : 0; // .0 = LSB, .F = MSB
      bits.push(on);
      bitDot[`${addr}.${b.toString(16).toUpperCase()}`] = on;
    }
    bitBlocks.push({
      addr,
      value: v16,
      hex: "0x" + v16.toString(16).toUpperCase().padStart(4, "0"),
      bits, // index 0..15 => .0..F
    });
  }

  return {
    connected: state.connected,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    bitWords: Object.fromEntries(state.bitWords.entries()),
    words: Object.fromEntries(state.words.entries()),
    bitBlocks,
    bitDot,
  };
}

function setBitWordsFromArray(arr) {
  for (let i = 0; i < BIT_QTY; i++) {
    const addr = BIT_START + i;
    const v = arr?.[i];
    state.bitWords.set(addr, typeof v === "number" ? v : Number(v));
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

async function readBitWords() {
  if (BIT_MODE === "word_input") {
    const r = await client.readInputRegisters(BIT_START, BIT_QTY);
    return r?.data ?? [];
  }
  if (BIT_MODE === "coils") {
    const r = await client.readCoils(BIT_START, BIT_QTY);
    // coils로 읽는 경우, true/false를 0/1로 저장 (호환)
    return (r?.data ?? []).map((b) => (b ? 1 : 0));
  }
  if (BIT_MODE === "discrete_inputs") {
    const r = await client.readDiscreteInputs(BIT_START, BIT_QTY);
    return (r?.data ?? []).map((b) => (b ? 1 : 0));
  }
  // default: word_holding
  const r = await client.readHoldingRegisters(BIT_START, BIT_QTY);
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

  const prevBitWords = new Map(state.bitWords);
  const prevWords = new Map(state.words);

  try {
    const ok = await ensureConnected();
    if (!ok) return;

    const bitWordsArr = await readBitWords();
    const wordsArr = await readWords();

    setBitWordsFromArray(bitWordsArr);
    setWordsFromArray(wordsArr);

    state.lastPollAt = new Date();
    state.lastError = null;

    const changedBits = diffMaps(prevBitWords, state.bitWords);
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
  // "6000.A" 형태 지원
  if (typeof addr === "string" && addr.includes(".")) {
    const [w, b] = addr.split(".");
    const wa = Number(w);
    const bi = Number.parseInt(b, 16);
    const v = Number(state.bitWords.get(wa) ?? 0) & 0xffff;
    return ((v & (1 << bi)) !== 0);
  }
  // addr만 주면 word 값을 반환 (6000~6021)
  return state.bitWords.get(Number(addr));
}
function getWord(addr) {
  return state.words.get(Number(addr));
}
function getBits() {
  // 6000~6021의 word 값 반환
  return Object.fromEntries(state.bitWords.entries());
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
