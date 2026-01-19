// [시나리오]
// 1. in스토커 -> 연마기
//  - in스토커 enable
//     - 적재 sorting 고민 필요
//  - 인스토커로 이동해서 -> 물건 (최대 6개)를 AMR에 적재하고, 
//  - 연마기 input 가능 개수가 ok 될 때 까지 대기 (max 대기시간을 세팅값에서 사용해서, 지나면 alarm)
//  - 연마기(제품 조건에 맞는)에 투입
//  - 복귀

//  2. 연마기 -> out스토커
//  - out스토커 신호가 enable = 1인 경우, 작업 위치 = 1 && 끝단 위치 0인 스토커 수 && 기준연마기에 꺼낼 수 있는 제품이 있는지 확인하고 
//  - 일정시간(설정 가능) 동안 기다렸다가
//  - 연마기에서 꺼낼 수 있는 제품을 최대한 꺼내와서
//  - out스토커에 순차적으로(왼쪽 위 임시) 투입
//  - 컨베이어 enable 신호 확인 후, out스토커에서 최대한 많은 공지그를 꺼내서 운송

//  3. out스토커 -> 컨베이어
//  - 컨베이어 enable 신호 확인 후, out스토커에서 최대한 많은 공지그를 꺼내서 운송


//  * 필요한 Step  
// - 이동 (amr이 특정 스테이션으로 이동)
// - 작업 (팔 from - to)
// - 대기 (max 시간, 조건용 함수)
// - plc 쓰기 (쓸 address, bit/word, value)

// * 필요 function
// - 연마기 인풋 가능 리스트 체크 ("814:[1L, 2R, 3R], 219:[4L]")
// - 연마기 아웃풋 가능 리스트 체크 ("814:[1L, 2R, 3R], 219:[4L]")
// - out스토커 가능 위치 리스트 체크 ("[L-1-3, R-1-3]")
// //- (보류) 컨베이어 작업 가능 리스트 체크 ("814:[L], 219:[R]")




const plc = require("./plcMonitorService");

// 1. 연마기 인풋 가능 리스트 체크 -------
const NUMBER_OF_GRINDERS = 6;
const GRINDER_INPUT_ADDRESS = 6007;

const GRINDER_PRESET_START = 6090;
const PRODUCT_814 = "p814";
const PRODUCT_219 = "p219";
const PRODUCT_BY_REGISTER = new Map([
  [1, PRODUCT_814],
  [2, PRODUCT_219],
]);

// D6090~D6095: register 값이 1이면 product 814, 2이면 product 219
function getPresetProductIdFromRegister(value) {
  const v = Number(value);
  return PRODUCT_BY_REGISTER.has(v) ? PRODUCT_BY_REGISTER.get(v) : null;
}

// 각 연마기(1~6)의 preset 제품 종류 을 읽어오는 함수
function readGrinderPresetProducts() {
  const result = {};
  for (let i = 0; i < NUMBER_OF_GRINDERS; i++) {
    const grinderNo = i + 1;
    const addr = GRINDER_PRESET_START + i;
    const regValue = plc.getWord(addr);
    result[grinderNo] = getPresetProductIdFromRegister(regValue);
  }
  return result;
}

// test 코드
//const grinderPresetProducts = readGrinderPresetProducts();
//console.log(grinderPresetProducts);

// read register from D6007.0, D6007.2 to D6012.0, D6012.2
// 각 레지스터 bit0 = L, bit2 = R (ON이면 투입구 Ready)
// - 연마기 인풋 가능 리스트 체크 ("814:[1L, 2R, 3R], 219:[4L]")
function readGrinderInputReady() {
  const presetByGrinder = readGrinderPresetProducts();
  const result = {
    [PRODUCT_814]: [],
    [PRODUCT_219]: [],
  };
  for (let i = 0; i < NUMBER_OF_GRINDERS; i++) {
    const grinderNo = i + 1;
    const addr = GRINDER_INPUT_ADDRESS + i;
    const lReady = Boolean(plc.getBit(`${addr}.0`));
    const rReady = Boolean(plc.getBit(`${addr}.2`));
    const productType = presetByGrinder[grinderNo];
    // 추후 bypass 처리도 추가>?
    if (!productType || !result[productType]) continue;
    if (lReady) result[productType].push(`${grinderNo}L`);
    if (rReady) result[productType].push(`${grinderNo}R`);
  }
  return result;
}

// --- 2. grinder output Ready ---
// - 연마기 아웃풋 가능 리스트 체크 ("814:[1L, 2R, 3R], 219:[4L]")
function readGrinderOutputReady() {
  const presetByGrinder = readGrinderPresetProducts();
  const result = {
    [PRODUCT_814]: [],
    [PRODUCT_219]: [],
  };
  for (let i = 0; i < NUMBER_OF_GRINDERS; i++) {
    const grinderNo = i + 1;
    const addr = GRINDER_INPUT_ADDRESS + i;
    const lReady = Boolean(plc.getBit(`${addr}.1`));
    const rReady = Boolean(plc.getBit(`${addr}.3`));
    const productType = presetByGrinder[grinderNo];
    // 추후 bypass 처리도 추가>?
    if (!productType || !result[productType]) continue;
    if (lReady) result[productType].push(`${grinderNo}L`);
    if (rReady) result[productType].push(`${grinderNo}R`);
  }
  return result;
}

// Read Out Stoker Ready
// - out스토커 가능 위치 리스트 체크 ("[L-1-3, R-1-3]")
// 아웃스토커 어떤곳에 어떤 제품이 있는지 읽어오는 것

function readOutStokerReady() {
}


// reg 

module.exports = {
  readGrinderPresetProducts,
  readGrinderInputReady,
};