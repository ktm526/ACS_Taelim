import ModbusRTU from "modbus-serial";

/**
 * Modbus TCP: Holding Register 6060~6063에 값 쓰기(FC 16) 전용 스크립트
 *
 * 사용법:
 * node modbus-write-6060.js [host] [port] [unitId]
 *
 * 예시:
 * node modbus-write-6060.js 192.168.1.100 502 1
 *
 * 환경변수(옵션):
 * MODBUS_HOST, MODBUS_PORT, MODBUS_UNIT_ID
 */

// 기본 설정값
const DEFAULT_HOST = process.env.MODBUS_HOST || "192.168.3.31";
const DEFAULT_PORT = parseInt(process.env.MODBUS_PORT || "502", 10);
const DEFAULT_UNIT_ID = parseInt(process.env.MODBUS_UNIT_ID || "1", 10);

// 명령줄 인자 파싱
const args = process.argv.slice(2);
const host = args[0] || DEFAULT_HOST;
const port = Number.parseInt(args[1], 10) || DEFAULT_PORT;
const unitId = Number.parseInt(args[2], 10) || DEFAULT_UNIT_ID;

// 쓰기 대상 (Holding Registers)
const START_ADDRESS = 6060;
const VALUES_TO_WRITE = [3, 30, 20, 60];

// 로그 함수
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  data: (label, value) =>
    console.log(`[DATA] ${new Date().toISOString()} - ${label}:`, value),
};

async function main() {
  log.info("========================================");
  log.info("Modbus TCP Holding Register 쓰기 스크립트");
  log.info("========================================");
  log.info(`대상: ${host}:${port}`);
  log.info(`Unit ID: ${unitId}`);
  log.info(
    `쓰기: HR ${START_ADDRESS}~${
      START_ADDRESS + VALUES_TO_WRITE.length - 1
    } = [${VALUES_TO_WRITE.join(", ")}]`
  );

  const client = new ModbusRTU();
  client.setTimeout(5000);

  try {
    // 연결
    await client.connectTCP(host, { port });
    client.setID(unitId);
    log.success("Modbus TCP 연결 성공");

    // 쓰기 (FC16)
    log.info("FC16 (Write Multiple Registers) 쓰기 시작...");
    await client.writeRegisters(START_ADDRESS, VALUES_TO_WRITE);
    log.success("쓰기 완료");

    // 검증: 읽어서 확인 (FC03)
    await new Promise((r) => setTimeout(r, 100));
    log.info("FC03 (Read Holding Registers)로 검증 읽기...");
    const readBack = await client.readHoldingRegisters(
      START_ADDRESS,
      VALUES_TO_WRITE.length
    );

    log.data("읽은 값", readBack.data);
    log.data("예상 값", VALUES_TO_WRITE);

    const ok =
      Array.isArray(readBack?.data) &&
      readBack.data.length === VALUES_TO_WRITE.length &&
      readBack.data.every((v, i) => v === VALUES_TO_WRITE[i]);

    if (!ok) {
      log.error("검증 실패: 읽은 값이 예상 값과 다릅니다.");
      process.exitCode = 2;
      return;
    }

    log.success("검증 성공: 읽은 값이 예상 값과 일치합니다.");
  } catch (err) {
    log.error(`실행 중 오류: ${err?.message || String(err)}`);
    process.exitCode = 1;
  } finally {
    try {
      client.close(() => log.info("연결이 종료되었습니다."));
    } catch {
      // ignore
    }
  }
}

main();

