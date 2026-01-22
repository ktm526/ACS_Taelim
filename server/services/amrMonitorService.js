//services/amrMonitorService.js

const net = require('net');
const { Op } = require('sequelize');
const Robot = require('../models/Robot');
//const { //logConnChange } = require('./connectionLogger');

// AMR Push Monitoring Service
// - Listens on TCP port for robot push data
// - Updates Robot table and tracks last received timestamp per robot

const PUSH_PORT = 19301;
const sockets = new Map();
const lastRecTime = new Map();
const lastTimeValue = new Map(); // 각 로봇의 마지막 time 값 저장
const lastTimeUpdate = new Map(); // 각 로봇의 마지막 time 값 업데이트 시간

// Log 테이블/모델 제거로 인해 초기 DB 로그 기록은 제거됨

async function markDisconnectedByIp(ip) {
    try {
        await Robot.update(
            { status: '연결 끊김', timestamp: new Date() },
            { where: { ip } }
        );
    } catch (e) {
        console.error('[AMR] markDisconnectedByIp error:', e.message);
    }
}

async function markDisconnectedByName(name) {
    try {
        await Robot.update(
            { status: '연결 끊김', timestamp: new Date() },
            { where: { name } }
        );
    } catch (e) {
        console.error('[AMR] markDisconnectedByName error:', e.message);
    }
}

function handlePush(sock, ip) {
    let buf = Buffer.alloc(0);

    sock.on('data', async chunk => {
        buf = Buffer.concat([buf, chunk]);
        //console.log('ip====', ip)

        while (buf.length >= 16) {
            if (buf.readUInt8(0) !== 0x5A) {
                buf = Buffer.alloc(0);
                break;
            }
            const len = buf.readUInt32BE(4);
            if (buf.length < 16 + len) break;

            const payload = buf.slice(16, 16 + len).toString();
            buf = buf.slice(16 + len);

            let json;
            try {
                json = JSON.parse(payload);
                //console.log(ip, json.vehicle_id)
            }
            catch (err) { continue;}//console.log('failed to json', ip, err, payload); continue; }

            const name = json.vehicle_id || json.robot_id;
            if (!name) continue;

            // 로봇 푸시 데이터에서 특정 필드 출력
            //console.log(`[AMR ${name}] time: ${json.time}, current_station: ${json.current_station}, errors: ${JSON.stringify(json.errors)}`);

            // time 값 비교 및 저장
            const currentTime = json.time;
            const lastTime = lastTimeValue.get(name);
            const now = Date.now();
            
            if (lastTime !== currentTime) {
                // time 값이 변했으면 업데이트
                lastTimeValue.set(name, currentTime);
                lastTimeUpdate.set(name, now);
            }

            // Map task_status → Korean
            const tsRaw = typeof json.task_status === 'number'
                ? json.task_status
                : typeof json.taskStatus === 'number'
                    ? json.taskStatus
                    : null;
            let statusStr;
            if (tsRaw === 2) statusStr = '이동';
            else if ([0, 1, 4].includes(tsRaw)) statusStr = '대기';
            else if ([5, 6].includes(tsRaw)) statusStr = '오류';
            else statusStr = 'unknown';

            // extract other fields...
            const location = json.current_station || json.currentStation ||
                (Array.isArray(json.finished_path)
                    ? json.finished_path.slice(-1)[0]
                    : null
                );
            
            // 수정된 필드 추출 로직
            const battery = (typeof json.battery_level === 'number')
                ? Math.round(json.battery_level * 100) // 0.97 → 97%
                : null;
            
            const voltage = (typeof json.voltage === 'number')
                ? json.voltage
                : null;
            
            const current_map = json.current_map || null;
            
            // AMR 위치 정보
            const pos = {
                x: json.x ?? json.position?.x ?? 0,
                y: json.y ?? json.position?.y ?? 0,
                angle: json.angle ?? json.position?.yaw ?? 0,
                qw: json.qw ?? 0,
                qx: json.qx ?? 0,
                qy: json.qy ?? 0,
                qz: json.qz ?? 0,
                roll: json.roll ?? 0,
                pitch: json.pitch ?? 0,
                yaw: json.yaw ?? json.angle ?? 0,
                block_x: json.block_x ?? 0,
                block_y: json.block_y ?? 0,
            };
            
            // Jack 정보
            const jackInfo = json.jack || {};
            const jackHeight = jackInfo.jack_height ?? 0;
            const jackState = jackInfo.jack_state ?? 0;
            const jackEnabled = jackInfo.jack_enable ?? false;
            
            // 기타 정보
            const current = (typeof json.current === 'number') ? json.current : null;
            const isCharging = json.charging === true;
            const isEmergency = json.emergency === true;
            
            // 속도 정보
            const vx = json.vx ?? 0;
            const vy = json.vy ?? 0;
            const w = json.w ?? 0;
            
            // 로봇 상태 정보 
            const batteryTemp = json.battery_temp ?? 0;
            const taskStatus = json.task_status ?? 0;
            const runningStatus = json.running_status ?? 0;
            const blocked = json.blocked === true;
            const slowed = json.slowed === true;
            const confidence = json.confidence ?? 0;
            
            // DI/DO 센서 정보 추출 (실제 로봇 JSON 구조에 맞춤)
            const diSensors = json.DI || json.dI || json.di || json.digitalInputs || json.digital_inputs || [];
            const doSensors = json.DO || json.dO || json.do || json.digitalOutputs || json.digital_outputs || [];
            
            // 모터 정보 추출
            const motorInfo = json.motor_info || [];
            
            // 추가 센서/상태 정보
            const imuData = {
                acc_x: json.acc_x ?? 0,
                acc_y: json.acc_y ?? 0,
                acc_z: json.acc_z ?? 0,
                pitch: json.pitch ?? 0,
                roll: json.roll ?? 0,
                yaw: json.yaw ?? 0
            };
            
            const controllerInfo = {
                temp: json.controller_temp ?? 0,
                humidity: json.controller_humi ?? 0,
                voltage: json.controller_voltage ?? 0
            };
            
            const next_location = json.next_station || json.nextStation || 
                                  (json.target_id ? json.target_id : null);

            const payloadForDb = {
                name,
                status: statusStr,
                location,
                next_location: next_location,
                task_step: json.task_step || json.taskStep || null,
                battery, 
                voltage, 
                current_map: current_map,
                position: JSON.stringify(pos),
                additional_info: JSON.stringify({
                    // 핵심 상태 정보
                    jackHeight,
                    jackState,
                    jackEnabled,
                    jackError: jackInfo.jack_error_code ?? 0,
                    current,
                    charging: isCharging,
                    emergency: isEmergency,
                    batteryTemp,
                    
                    // 이동 정보
                    vx,
                    vy,
                    w,
                    odo: json.odo ?? 0,
                    blocked,
                    slowed,
                    confidence,
                    
                    // 작업 정보
                    runningStatus,
                    taskStatus,
                    targetId: json.target_id,
                    targetLabel: json.target_label,
                    
                    // 장치 정보
                    rollerInfo: json.roller,
                    hookInfo: json.hook,
                    nearestObstacles: json.nearest_obstacles,
                    errors: json.errors,
                    warnings: json.warnings,
                    
                    // DI/DO 센서 정보 (실제 로봇 구조)
                    diSensors: diSensors,
                    doSensors: doSensors,
                    
                    // 모터 정보
                    motorInfo: motorInfo,
                    
                    // IMU 센서 정보
                    imuData: imuData,
                    
                    // 컨트롤러 정보
                    controllerInfo: controllerInfo,
                    
                    // 기타 상태 정보
                    autoCharge: json.auto_charge ?? false,
                    manualCharge: json.manual_charge ?? false,
                    electric: json.electric ?? false,
                    brake: json.brake ?? false,
                    isStop: json.is_stop ?? false,
                    inForbiddenArea: json.in_forbidden_area ?? false,
                    
                    // 위치/맵 관련
                    currentMapMd5: json.current_map_md5,
                    locMethod: json.loc_method ?? 0,
                    locState: json.loc_state ?? 0,
                    similarity: json.similarity ?? 0,
                    
                    // 시간 정보
                    todayOdo: json.today_odo ?? 0,
                    todayTime: json.today_time ?? 0,
                    totalTime: json.total_time ?? 0,
                    
                    // 버전 정보
                    version: json.version,
                    model: json.model,
                    dspVersion: json.dsp_version,
                    gyroVersion: json.gyro_version,
                }),
                timestamp: new Date(),
            };

            try {
                const existing = await Robot.findOne({ where: { ip } });
                if (existing) {
                    await existing.update(payloadForDb);
                }
                lastRecTime.set(name, Date.now());
            } catch (e) {
                console.error('[AMR Push] DB save error:', e.message);
            }
        }
    });

    sock.on('error', async err => {
        console.warn(`[AMR] socket error on ${ip}:`, err.message);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });

    sock.on('close', () => {
        console.warn(`[AMR] connection closed ${ip}`);
        sockets.delete(ip);
        markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });
}

async function connect(ip) {
    if (sockets.has(ip)) return;
    const sock = net.createConnection({ port: PUSH_PORT, host: ip });
    sock.setTimeout(2000);

    sock.on('error', async err => {
        console.warn(`[AMR] connect error ${ip}:`, err.message);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
    });

    sock.on('connect', async () => {
        // IP로 AMR 이름 찾기
        let amrName = 'unknown';
        try {
            const robot = await Robot.findOne({ where: { ip } });
            if (robot) {
                amrName = robot.name;
            }
        } catch (e) {
            console.error(`[AMR] error finding robot name for IP ${ip}:`, e.message);
        }
        
        const localPort = sock.localPort;
        console.log(`[AMR] connected to ${ip} (AMR: ${amrName}, local port: ${localPort})`);
        sockets.set(ip, sock);
        sock.setTimeout(0);
        //logConnChange(`AMR:${ip}`, true);
        handlePush(sock, ip);
    });

    sock.on('timeout', async () => {
        console.warn(`[AMR] timeout on ${ip}`);
        sock.destroy();
        sockets.delete(ip);
        await markDisconnectedByIp(ip);
        //logConnChange(`AMR:${ip}`, false);
    });
}

// reconnect loop
let connecting = false;
setInterval(async () => {
    if (connecting) return;
    connecting = true;
    try {
        const rows = await Robot.findAll({
            where: { ip: { [Op.not]: null } },
            attributes: ['ip'],
            raw: true,
        });
        for (const { ip } of rows) {
            await connect(ip);
        }
    } catch (e) {
        console.error('[AMR] connect loop error:', e.message);
    } finally {
        connecting = false;
    }
}, 2000);

// stale‐entry cleanup
setInterval(async () => {
    const now = Date.now();
    for (const [name, ts] of lastRecTime.entries()) {
        if (now - ts > 2000) {
            console.warn(`[AMR] stale entry expired for ${name}`);
            lastRecTime.delete(name);
            lastTimeValue.delete(name); // time 값 맵도 정리
            lastTimeUpdate.delete(name); // time 업데이트 시간 맵도 정리
            // DB 상태 업데이트
            await markDisconnectedByName(name);
            //logConnChange(`AMR:${name}`, false, { robot_name: name });

            // 해당 로봇의 IP로 소켓도 강제 종료 → 재접속 유도
            try {
                const robot = await Robot.findOne({ where: { name } });
                if (robot && robot.ip && sockets.has(robot.ip)) {
                    sockets.get(robot.ip).destroy();
                    sockets.delete(robot.ip);
                    console.log(`[AMR] socket destroyed for ${name} (${robot.ip})`);
                }
            } catch (e) {
                console.error(`[AMR] error destroying socket for ${name}:`, e.message);
            }
        }
    }
}, 1000);

// time 값 변화 확인 및 재접속 로직
setInterval(async () => {
    const now = Date.now();
    for (const [name, lastUpdate] of lastTimeUpdate.entries()) {
        if (now - lastUpdate > 10000) { // 10초 동안 time 값이 변하지 않음
            console.warn(`[AMR] time value not changed for ${name} for 10 seconds, attempting reconnect...`);
            
            try {
                await reconnectAmr(name);
                console.log(`[AMR] reconnected successfully for ${name} due to stale time value`);
                
                // 재접속 후 타이머 초기화
                lastTimeUpdate.set(name, now);
            } catch (e) {
                console.error(`[AMR] failed to reconnect ${name}:`, e.message);
            }
        }
    }
}, 5000); // 5초마다 체크

async function reconnectAmr(name) {
    const robot = await Robot.findOne({ where: { name } });
    if (!robot || !robot.ip) throw new Error('AMR not found');
    const ip = robot.ip;
    
    console.log(`[AMR] initiating reconnect for ${name} (${ip})`);
    
    if (sockets.has(ip)) {
        sockets.get(ip).destroy();
        sockets.delete(ip);
        console.log(`[AMR] existing socket destroyed for ${name} (${ip})`);
    }
    
    await connect(ip);
    console.log(`[AMR] reconnect attempt completed for ${name} (${ip})`);
}

console.log('🔧 AMR Monitor Service started');
module.exports = {
    lastRecTime, sockets,
    reconnectAmr,
};
