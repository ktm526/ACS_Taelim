import ModbusRTU from "modbus-serial";

/**
 * Modbus TCP 테스트 프로그램
 * 
 * 사용법:
 * node modbus-test.js [host] [port] [unitId]
 * 
 * 예시:
 * node modbus-test.js 192.168.1.100 502 1
 */

// 기본 설정값
const DEFAULT_HOST = process.env.MODBUS_HOST || "192.168.3.31";
const DEFAULT_PORT = parseInt(process.env.MODBUS_PORT || "502");
const DEFAULT_UNIT_ID = parseInt(process.env.MODBUS_UNIT_ID || "1");

// 명령줄 인자 파싱
const args = process.argv.slice(2);
const host = args[0] || DEFAULT_HOST;
const port = parseInt(args[1]) || DEFAULT_PORT;
const unitId = parseInt(args[2]) || DEFAULT_UNIT_ID;

// 로그 함수들
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  data: (label, value) => console.log(`[DATA] ${new Date().toISOString()} - ${label}:`, value)
};

// 테스트 결과 저장
const testResults = {
  connection: false,
  readCoils: { success: false, error: null },
  readDiscreteInputs: { success: false, error: null },
  readHoldingRegisters: { success: false, error: null },
  readInputRegisters: { success: false, error: null },
  writeSingleCoil: { success: false, error: null },
  writeSingleRegister: { success: false, error: null },
  writeMultipleCoils: { success: false, error: null },
  writeMultipleRegisters: { success: false, error: null }
};

/**
 * 연결 테스트
 */
async function testConnection(client) {
  log.info("=== 연결 테스트 시작 ===");
  try {
    await client.connectTCP(host, { port });
    client.setID(unitId);
    client.setTimeout(5000);
    testResults.connection = true;
    log.success(`Modbus TCP 연결 성공: ${host}:${port}, Unit ID: ${unitId}`);
    return true;
  } catch (error) {
    testResults.connection = false;
    log.error(`연결 실패: ${error.message}`);
    return false;
  }
}

/**
 * Coils 읽기 테스트 (Function Code 01)
 */
async function testReadCoils(client) {
  log.info("=== Coils 읽기 테스트 (FC 01) ===");
  try {
    const address = 6000;
    const quantity = 2;
    log.info(`주소 ${address}부터 ${quantity}개의 Coils 읽기 시도...`);
    
    const data = await client.readCoils(address, quantity);
    testResults.readCoils.success = true;
    log.success(`Coils 읽기 성공`);
    log.data("읽은 데이터", data.data[0]);
    log.data("데이터 길이", data.data.length);
    return true;
  } catch (error) {
    testResults.readCoils.success = false;
    testResults.readCoils.error = error.message;
    log.error(`Coils 읽기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Discrete Inputs 읽기 테스트 (Function Code 02)
 */
async function testReadDiscreteInputs(client) {
  log.info("=== Discrete Inputs 읽기 테스트 (FC 02) ===");
  try {
    const address = 5999;
    const quantity = 5;
    log.info(`주소 ${address}부터 ${quantity}개의 Discrete Inputs 읽기 시도...`);
    
    const data = await client.readDiscreteInputs(address, quantity);
    testResults.readDiscreteInputs.success = true;
    log.success(`Discrete Inputs 읽기 성공`);
    log.data("읽은 데이터", data.data);
    log.data("데이터 길이", data.data.length);
    return true;
  } catch (error) {
    testResults.readDiscreteInputs.success = false;
    testResults.readDiscreteInputs.error = error.message;
    log.error(`Discrete Inputs 읽기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Holding Registers 읽기 테스트 (Function Code 03)
 */
async function testReadHoldingRegisters(client) {
  log.info("=== Holding Registers 읽기 테스트 (FC 03) ===");
  try {
    const address = 6000;
    const quantity = 5
    log.info(`주소 ${address}부터 ${quantity}개의 Holding Registers 읽기 시도...`);
    
    const data = await client.readHoldingRegisters(address, quantity);
    testResults.readHoldingRegisters.success = true;
    log.success(`Holding Registers 읽기 성공`);
    log.data("읽은 데이터", data.data);
    log.data("데이터 길이", data.data.length);
    log.data("데이터 값 (10진수)", data.data.map(v => v.toString(10)).join(", "));
    log.data("데이터 값 (16진수)", data.data.map(v => "0x" + v.toString(16).toUpperCase().padStart(4, "0")).join(", "));
    return true;
  } catch (error) {
    testResults.readHoldingRegisters.success = false;
    testResults.readHoldingRegisters.error = error.message;
    log.error(`Holding Registers 읽기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Input Registers 읽기 테스트 (Function Code 04)
 */
async function testReadInputRegisters(client) {
  log.info("=== Input Registers 읽기 테스트 (FC 04) ===");
  try {
    const address = 5999;
    const quantity = 10;
    log.info(`주소 ${address}부터 ${quantity}개의 Input Registers 읽기 시도...`);
    
    const data = await client.readInputRegisters(address, quantity);
    testResults.readInputRegisters.success = true;
    log.success(`Input Registers 읽기 성공`);
    log.data("읽은 데이터", data.data);
    log.data("데이터 길이", data.data.length);
    log.data("데이터 값 (10진수)", data.data.map(v => v.toString(10)).join(", "));
    log.data("데이터 값 (16진수)", data.data.map(v => "0x" + v.toString(16).toUpperCase().padStart(4, "0")).join(", "));
    return true;
  } catch (error) {
    testResults.readInputRegisters.success = false;
    testResults.readInputRegisters.error = error.message;
    log.error(`Input Registers 읽기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Single Coil 쓰기 테스트 (Function Code 05)
 */
async function testWriteSingleCoil(client) {
  log.info("=== Single Coil 쓰기 테스트 (FC 05) ===");
  try {
    const address = 5000;
    const value = 1;
    log.info(`주소 ${address}에 Coil 값 ${value} 쓰기 시도...`);
    
    await client.writeCoil(address, value);
    testResults.writeSingleCoil.success = true;
    log.success(`Single Coil 쓰기 성공`);
    
    // 읽어서 확인
    await new Promise(resolve => setTimeout(resolve, 100));
    const readData = await client.readCoils(address, 1);
    log.data("쓴 후 읽은 값", readData.data[0]);
    return true;
  } catch (error) {
    testResults.writeSingleCoil.success = false;
    testResults.writeSingleCoil.error = error.message;
    log.error(`Single Coil 쓰기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Single Register 쓰기 테스트 (Function Code 06)
 */
async function testWriteSingleRegister(client) {
  log.info("=== Single Register 쓰기 테스트 (FC 06) ===");
  try {
    const address = 0;
    const value = 12345;
    log.info(`주소 ${address}에 Register 값 ${value} 쓰기 시도...`);
    
    await client.writeRegister(address, value);
    testResults.writeSingleRegister.success = true;
    log.success(`Single Register 쓰기 성공`);
    
    // 읽어서 확인
    await new Promise(resolve => setTimeout(resolve, 100));
    const readData = await client.readHoldingRegisters(address, 1);
    log.data("쓴 후 읽은 값", readData.data[0]);
    log.data("예상 값", value);
    return true;
  } catch (error) {
    testResults.writeSingleRegister.success = false;
    testResults.writeSingleRegister.error = error.message;
    log.error(`Single Register 쓰기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Multiple Coils 쓰기 테스트 (Function Code 15)
 */
async function testWriteMultipleCoils(client) {
  log.info("=== Multiple Coils 쓰기 테스트 (FC 15) ===");
  try {
    const address = 0;
    const values = [true, false, true, false, true];
    log.info(`주소 ${address}부터 ${values.length}개의 Coils 쓰기 시도...`);
    log.data("쓸 값", values);
    
    await client.writeCoils(address, values);
    testResults.writeMultipleCoils.success = true;
    log.success(`Multiple Coils 쓰기 성공`);
    
    // 읽어서 확인
    await new Promise(resolve => setTimeout(resolve, 100));
    const readData = await client.readCoils(address, values.length);
    log.data("쓴 후 읽은 값", readData.data);
    return true;
  } catch (error) {
    testResults.writeMultipleCoils.success = false;
    testResults.writeMultipleCoils.error = error.message;
    log.error(`Multiple Coils 쓰기 실패: ${error.message}`);
    return false;
  }
}

/**
 * Multiple Registers 쓰기 테스트 (Function Code 16) Writing 성공  Success //
 */ 

async function testWriteMultipleRegisters(client) {
  log.info("=== Multiple Registers 쓰기 테스트 (FC 16) ===");
  try {
    const address = 4999; // 4999
    const values = [100, 200, 300, 400, 500];
    log.info(`주소 ${address}부터 ${values.length}개의 Registers 쓰기 시도...`);
    log.data("쓸 값", values);
    
    await client.writeRegisters(address, values);
    testResults.writeMultipleRegisters.success = true;
    log.success(`Multiple Registers 쓰기 성공`);
    
    // 읽어서 확인
    await new Promise(resolve => setTimeout(resolve, 100));
    const readData = await client.readHoldingRegisters(address, values.length);
    log.data("쓴 후 읽은 값", readData.data);
    log.data("예상 값", values);
    return true;
  } catch (error) {
    testResults.writeMultipleRegisters.success = false;
    testResults.writeMultipleRegisters.error = error.message;
    log.error(`Multiple Registers 쓰기 실패: ${error.message}`);
    return false;
  }
}

/**
 * 테스트 결과 요약 출력
 */
function printSummary() {
  log.info("=== 테스트 결과 요약 ===");
  console.log("\n" + "=".repeat(60));
  console.log("테스트 항목".padEnd(30) + "결과".padEnd(20) + "에러");
  console.log("=".repeat(60));
  
  const tests = [
    { name: "연결 테스트", result: testResults.connection },
    { name: "Read Coils (FC 01)", result: testResults.readCoils.success, error: testResults.readCoils.error },
    { name: "Read Discrete Inputs (FC 02)", result: testResults.readDiscreteInputs.success, error: testResults.readDiscreteInputs.error },
    { name: "Read Holding Registers (FC 03)", result: testResults.readHoldingRegisters.success, error: testResults.readHoldingRegisters.error },
    { name: "Read Input Registers (FC 04)", result: testResults.readInputRegisters.success, error: testResults.readInputRegisters.error },
    { name: "Write Single Coil (FC 05)", result: testResults.writeSingleCoil.success, error: testResults.writeSingleCoil.error },
    { name: "Write Single Register (FC 06)", result: testResults.writeSingleRegister.success, error: testResults.writeSingleRegister.error },
    { name: "Write Multiple Coils (FC 15)", result: testResults.writeMultipleCoils.success, error: testResults.writeMultipleCoils.error },
    { name: "Write Multiple Registers (FC 16)", result: testResults.writeMultipleRegisters.success, error: testResults.writeMultipleRegisters.error }
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  tests.forEach(test => {
    const status = test.result ? "✓ 성공" : "✗ 실패";
    const errorMsg = test.error ? test.error.substring(0, 20) : "";
    console.log(
      test.name.padEnd(30) + 
      status.padEnd(20) + 
      errorMsg
    );
    if (test.result) successCount++;
    else failCount++;
  });
  
  console.log("=".repeat(60));
  console.log(`총 테스트: ${tests.length}개 | 성공: ${successCount}개 | 실패: ${failCount}개`);
  console.log("=".repeat(60) + "\n");
}

/**
 * 메인 테스트 함수
 */
async function runTests() {
  log.info("========================================");
  log.info("Modbus TCP 테스트 프로그램 시작");
  log.info("========================================");
  log.info(`대상: ${host}:${port}`);
  log.info(`Unit ID: ${unitId}`);
  log.info("");
  
  const client = new ModbusRTU();
  
  try {
    // 연결 테스트
    const connected = await testConnection(client);
    if (!connected) {
      log.error("연결에 실패했습니다. 테스트를 종료합니다.");
      printSummary();
      process.exit(1);
    }
    
    log.info("");
    
    // 읽기 테스트들
    
    await testReadCoils(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testReadDiscreteInputs(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testReadHoldingRegisters(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testReadInputRegisters(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    log.info("");
    
    // 쓰기 테스트들
    await testWriteSingleCoil(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testWriteSingleRegister(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testWriteMultipleCoils(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await testWriteMultipleRegisters(client);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    log.info("");
    
    // 결과 요약
    printSummary();
    
  } catch (error) {
    log.error(`테스트 중 오류 발생: ${error.message}`);
    log.error(error.stack);
  } finally {
    // 연결 종료
    try {
      client.close(() => {
        log.info("연결이 종료되었습니다.");
      });
    } catch (error) {
      // 연결 종료 오류는 무시
    }
  }
}

// 프로그램 실행
runTests().catch(error => {
  log.error(`프로그램 실행 오류: ${error.message}`);
  process.exit(1);
});

