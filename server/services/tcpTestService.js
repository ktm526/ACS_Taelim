/**
 * tcpTestService.js
 * - TCP 클라이언트로 특정 서버에 메시지를 보내고 응답/시간을 기록
 * - 중단할 때까지 반복
 */

const net = require("net");

const DEFAULT_HOST = "192.168.4.22";
const DEFAULT_PORT = 19207;
const DEFAULT_MESSAGE = {
  type: "module",
  relative_path: "doosan_state.py",
};
const DEFAULT_API_NO = 4022;

let isRunning = false;
let currentSocket = null;
let testResults = [];
let testConfig = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  message: DEFAULT_MESSAGE,
  apiNo: DEFAULT_API_NO,
  intervalMs: 1000,
};

let serial = 0;
function buildPacket(code, jsonData) {
  const payloadStr = JSON.stringify(jsonData);
  const payloadBuf = Buffer.from(payloadStr, "utf8");

  // Robokit NetProtocol: 헤더(16바이트) + payload
  // byte 0: 0x5A
  // byte 1: 0x01
  // bytes 2-3: serial
  // bytes 4-7: body length
  // bytes 8-9: api code
  // bytes 10-15: 0
  const header = Buffer.alloc(16);
  header.writeUInt8(0x5a, 0); // magic byte
  header.writeUInt8(0x01, 1); // version/flag
  header.writeUInt16BE(++serial & 0xffff, 2); // serial
  header.writeUInt32BE(payloadBuf.length, 4); // payload length
  header.writeUInt16BE(code & 0xffff, 8); // api code

  return Buffer.concat([header, payloadBuf]);
}

function parseResponse(buffer) {
  if (buffer.length < 16) return null;
  if (buffer.readUInt8(0) !== 0x5a) return null;

  const len = buffer.readUInt32BE(4);
  if (buffer.length < 16 + len) return null;

  const payload = buffer.slice(16, 16 + len).toString("utf8");
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

async function sendAndReceive(host, port, apiNo, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let responseBuffer = Buffer.alloc(0);
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout"));
    }, timeoutMs);

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      const packet = buildPacket(apiNo, message);
      socket.write(packet);
    });

    socket.on("data", (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const parsed = parseResponse(responseBuffer);
      if (parsed !== null) {
        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;
        cleanup();
        resolve({ response: parsed, elapsedMs: elapsed });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    socket.on("timeout", () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Socket timeout"));
    });
  });
}

async function runTestLoop() {
  while (isRunning) {
    const timestamp = new Date().toISOString();
    try {
      const result = await sendAndReceive(
        testConfig.host,
        testConfig.port,
        testConfig.apiNo,
        testConfig.message,
        5000
      );
      const entry = {
        timestamp,
        success: true,
        elapsedMs: result.elapsedMs,
        response: result.response,
      };
      testResults.push(entry);
      console.log(
        `[TCP Test] OK ${result.elapsedMs}ms - ${JSON.stringify(result.response).slice(0, 100)}`
      );
    } catch (err) {
      const entry = {
        timestamp,
        success: false,
        elapsedMs: null,
        error: err.message,
      };
      testResults.push(entry);
      console.log(`[TCP Test] FAIL - ${err.message}`);
    }

    // 최근 100개만 유지
    if (testResults.length > 100) {
      testResults = testResults.slice(-100);
    }

    // 다음 요청까지 대기
    if (isRunning) {
      await new Promise((r) => setTimeout(r, testConfig.intervalMs));
    }
  }
}

function start(config = {}) {
  if (isRunning) {
    return { success: false, message: "이미 실행 중입니다." };
  }

  testConfig = {
    host: config.host || DEFAULT_HOST,
    port: config.port || DEFAULT_PORT,
    message: config.message || DEFAULT_MESSAGE,
    apiNo: Number(config.apiNo || DEFAULT_API_NO),
    intervalMs: config.intervalMs || 1000,
  };
  testResults = [];
  isRunning = true;

  console.log(
    `[TCP Test] Starting: ${testConfig.host}:${testConfig.port}, interval=${testConfig.intervalMs}ms`
  );
  runTestLoop();

  return { success: true, message: "테스트 시작됨" };
}

function stop() {
  if (!isRunning) {
    return { success: false, message: "실행 중이 아닙니다." };
  }

  isRunning = false;
  if (currentSocket) {
    currentSocket.destroy();
    currentSocket = null;
  }

  console.log("[TCP Test] Stopped");
  return { success: true, message: "테스트 중지됨" };
}

function getStatus() {
  return {
    isRunning,
    config: testConfig,
    resultCount: testResults.length,
    results: testResults.slice(-20), // 최근 20개만 반환
  };
}

function getResults(limit = 50) {
  return testResults.slice(-limit);
}

module.exports = {
  start,
  stop,
  getStatus,
  getResults,
};
