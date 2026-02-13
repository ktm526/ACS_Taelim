const os = require("os");
const fs = require("fs");
const { monitorEventLoopDelay } = require("perf_hooks");

const SAMPLE_MS = Number.parseInt(process.env.SYSTEM_METRICS_SAMPLE_MS || "10000", 10);
const RETAIN_HOURS = Number.parseInt(process.env.SYSTEM_METRICS_RETAIN_HOURS || "24", 10);
const MAX_POINTS = Math.max(60, Math.ceil((RETAIN_HOURS * 60 * 60 * 1000) / SAMPLE_MS));

let timer = null;
const history = [];

let prevCpuSnapshot = null;
let prevProcCpu = process.cpuUsage();
let prevProcTs = Date.now();
let prevNet = { rxBytes: 0, txBytes: 0, ts: Date.now() };

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

function readLinuxNetTotals() {
  try {
    const text = fs.readFileSync("/proc/net/dev", "utf8");
    const lines = text.split("\n").slice(2).filter(Boolean);
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of lines) {
      const [ifacePart, dataPart] = line.split(":");
      if (!ifacePart || !dataPart) continue;
      const iface = ifacePart.trim();
      if (!iface || iface === "lo") continue;
      const cols = dataPart.trim().split(/\s+/);
      // /proc/net/dev: rx bytes = col0, tx bytes = col8
      const rx = Number(cols[0]);
      const tx = Number(cols[8]);
      if (Number.isFinite(rx)) rxBytes += rx;
      if (Number.isFinite(tx)) txBytes += tx;
    }
    return { rxBytes, txBytes };
  } catch {
    return null;
  }
}

function snapshotCpuTimes() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    const cpuTotal = t.user + t.nice + t.sys + t.idle + t.irq;
    total += cpuTotal;
    idle += t.idle;
  }
  return { idle, total, cores: cpus.length || 1 };
}

function calcSystemCpuPercent(curr) {
  if (!prevCpuSnapshot) {
    prevCpuSnapshot = curr;
    return null;
  }
  const idleDiff = curr.idle - prevCpuSnapshot.idle;
  const totalDiff = curr.total - prevCpuSnapshot.total;
  prevCpuSnapshot = curr;
  if (totalDiff <= 0) return null;
  const usage = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, usage));
}

function calcProcessCpuPercent(cores) {
  const now = Date.now();
  const elapsedUs = (now - prevProcTs) * 1000;
  const usage = process.cpuUsage(prevProcCpu);
  prevProcCpu = process.cpuUsage();
  prevProcTs = now;
  if (elapsedUs <= 0) return null;
  // process cpu time / wall time / core count
  const usedUs = usage.user + usage.system;
  const percent = (usedUs / elapsedUs) * 100 / Math.max(1, cores);
  return Math.max(0, Math.min(100, percent));
}

function calcNetRates() {
  const now = Date.now();
  const curr = readLinuxNetTotals();
  if (!curr) return { rxBps: null, txBps: null, rxBytes: null, txBytes: null };
  const dt = Math.max(1, (now - prevNet.ts) / 1000);
  const rxDiff = curr.rxBytes - prevNet.rxBytes;
  const txDiff = curr.txBytes - prevNet.txBytes;
  const rxBps = rxDiff >= 0 ? Math.round(rxDiff / dt) : null;
  const txBps = txDiff >= 0 ? Math.round(txDiff / dt) : null;
  prevNet = { ...curr, ts: now };
  return { rxBps, txBps, rxBytes: curr.rxBytes, txBytes: curr.txBytes };
}

function collectOnce() {
  const ts = Date.now();
  const mem = process.memoryUsage();
  const cpuSnap = snapshotCpuTimes();
  const sysCpuPct = calcSystemCpuPercent(cpuSnap);
  const procCpuPct = calcProcessCpuPercent(cpuSnap.cores);
  const net = calcNetRates();

  const loopMeanMs = Number(loopDelay.mean / 1e6).toFixed(2);
  const loopMaxMs = Number(loopDelay.max / 1e6).toFixed(2);
  loopDelay.reset();

  const sample = {
    ts,
    uptimeSec: Math.round(process.uptime()),
    processCpuPct: procCpuPct,
    systemCpuPct: sysCpuPct,
    processMemMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    systemMemUsedPct: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
    load1: Number(os.loadavg()[0].toFixed(2)),
    eventLoopLagMeanMs: Number(loopMeanMs),
    eventLoopLagMaxMs: Number(loopMaxMs),
    activeHandles: typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null,
    activeRequests: typeof process._getActiveRequests === "function" ? process._getActiveRequests().length : null,
    netRxBps: net.rxBps,
    netTxBps: net.txBps,
    netRxBytes: net.rxBytes,
    netTxBytes: net.txBytes,
  };

  history.push(sample);
  if (history.length > MAX_POINTS) {
    history.splice(0, history.length - MAX_POINTS);
  }
}

function start() {
  if (timer) return;
  collectOnce();
  timer = setInterval(collectOnce, SAMPLE_MS);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function getLatest() {
  return history[history.length - 1] || null;
}

function getHistory({ hours = 24 } = {}) {
  const h = Math.min(24, Math.max(1, Number(hours) || 24));
  const from = Date.now() - h * 60 * 60 * 1000;
  return history.filter((x) => x.ts >= from);
}

start();

module.exports = {
  start,
  stop,
  getLatest,
  getHistory,
  SAMPLE_MS,
  RETAIN_HOURS,
};

