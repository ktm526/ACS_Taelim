// server/controllers/robotController.js
const Robot = require('../models/Robot');
const Map = require('../models/Map');
const { Task, TaskStep } = require('../models');
const { Op } = require('sequelize');
const { sendGotoNav } = require('../services/navService');

// 헬퍼 함수들
const getCls = (s) => {
    if (Array.isArray(s.class)) return s.class;
    if (Array.isArray(s.classList)) return s.classList;
    if (typeof s.class === 'string') return [s.class];
    return [];
};

const hasClass = (s, c) => getCls(s).includes(c);
const regionOf = s => hasClass(s, 'A') ? 'A' : hasClass(s, 'B') ? 'B' : null;

// 로봇의 기존 태스크 상태 확인
async function checkRobotTaskStatus(robot) {
    const existingTask = await Task.findOne({
        where: {
            robot_id: robot.id,
            status: { [Op.in]: ['PENDING', 'RUNNING', 'PAUSED'] }
        },
        order: [['id', 'DESC']]
    });
    
    if (existingTask) {
        console.log(`[태스크중복방지] 로봇 ${robot.name}에 이미 실행 중인 태스크가 있습니다: 태스크 ID ${existingTask.id}, 상태: ${existingTask.status}`);
        return false; // 태스크 생성 불가
    }
    
    return true; // 태스크 생성 가능
}



exports.getAll = async (req, res) => {
    try {
        const rows = await Robot.findAll();
        res.json(rows);
    } catch (e) {
        console.error('[Robot GetAll] error', e);
        res.status(500).json({ message: e.message });
    }
};

exports.getById = async (req, res) => {
    try {
        const r = await Robot.findByPk(req.params.id);
        if (r) return res.json(r);
        res.sendStatus(404);
    } catch (e) {
        console.error('[Robot GetById] error', e);
        res.status(500).json({ message: e.message });
    }
};

exports.create = async (req, res) => {
    try {
        const r = await Robot.create(req.body);
        res.status(201).json(r);
    } catch (e) {
        console.error('[Robot Create] error', e);
        res.status(400).json({ message: e.message });
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        const robot = await Robot.findByPk(id);
        if (!robot) return res.sendStatus(404);

        const patch = { ...req.body };

        // slots는 TEXT 컬럼이므로 문자열/배열 모두 허용
        if (patch.slots !== undefined) {
            if (typeof patch.slots !== 'string') {
                patch.slots = JSON.stringify(patch.slots);
            }
        }
        // plc_ids는 TEXT 컬럼이므로 문자열/객체 모두 허용
        if (patch.plc_ids !== undefined) {
            if (typeof patch.plc_ids !== 'string') {
                patch.plc_ids = JSON.stringify(patch.plc_ids);
            }
        }

        await robot.update(patch);
        return res.json(robot);
    } catch (e) {
        console.error('[Robot Update] error', e);
        res.status(400).json({ message: e.message });
    }
};

exports.remove = async (req, res) => {
    const id = req.params.id;
    console.log(`[Robot Remove] DELETE /api/robots/${id}`);
    try {
        const count = await Robot.destroy({ where: { id } });
        console.log(`[Robot Remove] destroyed ${count} rows for id=${id}`);
        if (count) {
            return res.sendStatus(204);
        } else {
            return res.status(404).json({ message: `Robot ${id} not found` });
        }
    } catch (e) {
        console.error('[Robot Remove] error', e);
        return res.status(500).json({ message: e.message });
    }
};

exports.removeAll = async (req, res) => {
    //const id = req.params.id;
    //console.log(`[Robot Remove] DELETE /api/robots/${id}`);
    try {
        const count = await Robot.destroy({ where: {} });
        //console.log(`[Robot Remove] destroyed ${count} rows for id=${id}`);
        if (count) {
            return res.sendStatus(204);
        } else {
            return res.status(404).json({ message: 'No robots to delete' });
        }
    } catch (e) {
        console.error('[Robot Remove] error', e);
        return res.status(500).json({ message: e.message });
    }
};

exports.moveToStation = async (req, res) => {
    console.log('move2station')
    try {
        const robotId = req.params.id;
        const { station: stationName } = req.body;
        if (!stationName) {
            return res.status(400).json({ message: 'station name required' });
        }

        // 1) Robot 조회
        const robot = await Robot.findByPk(robotId);
        if (!robot) return res.status(404).json({ message: 'Robot not found' });

        // 2) 현재 맵에서 station 목록 가져오기
        const map = await Map.findOne({ where: { is_current: true } });
        if (!map) return res.status(400).json({ message: 'no current map' });
        const stations = JSON.parse(map.stations || '{}').stations || [];

        // 3) station name → station id 찾기
        const st = stations.find(s => (s.name ?? String(s.id)) === stationName);
        if (!st) return res.status(404).json({ message: 'station not found' });

        // 4) TCP 네비게이션 API 호출
        const taskId = String(Date.now());
        await sendGotoNav(robot.ip, st.id, 'SELF_POSITION', taskId);

        // 5) DB 업데이트
        await Robot.update(
            { destination: st.name, status: '이동', timestamp: new Date() },
            { where: { id: robot.id } }
        );

        return res.json({
            success: true,
            robot: robot.name,
            dest: st.name,
            taskId
        });
    } catch (err) {
        console.error('[Robot.moveToStation] error', err);
        return res.status(500).json({ message: err.message });
    }
};

exports.sendToCharge = async (req, res) => {
    console.log('[Robot.sendToCharge] 충전 명령 시작');
    try {
        const robotId = req.params.id;
        const { robotId: bodyRobotId } = req.body;
        
        // robotId 검증 (URL 파라미터와 body 일치 확인)
        if (bodyRobotId && bodyRobotId !== robotId) {
            return res.status(400).json({ message: 'Robot ID mismatch' });
        }

        // 1) Robot 조회
        const robot = await Robot.findByPk(robotId);
        if (!robot) {
            return res.status(404).json({ message: 'Robot not found' });
        }

        console.log(`[Robot.sendToCharge] ${robot.name}: 충전 조건 확인 중...`);

        // 2) 현재 맵과 스테이션 정보 가져오기
        const map = await Map.findOne({ where: { is_current: true } });
        if (!map) {
            return res.status(400).json({ message: 'No current map found' });
        }
        
        const stations = JSON.parse(map.stations || '{}').stations || [];
        
        // 3) AMR의 현재 위치 확인
        if (!robot.location) {
            return res.status(400).json({ message: 'Robot location is unknown' });
        }

        const currentStation = stations.find(s => String(s.id) === String(robot.location));
        if (!currentStation) {
            return res.status(400).json({ message: 'Current station not found in map' });
        }

        // 4) AMR이 B지역 버퍼에 있는지 확인
        const region = regionOf(currentStation);
        const isBuffer = hasClass(currentStation, '버퍼');
        
        console.log(`[Robot.sendToCharge] ${robot.name}: 현재 위치 ${currentStation.name || currentStation.id}, 지역: ${region}, 버퍼: ${isBuffer}`);
        
        if (region !== 'B' || !isBuffer) {
            return res.status(400).json({ 
                message: 'AMR이 B지역 버퍼에 위치하고 있지 않습니다',
                currentLocation: currentStation.name || currentStation.id,
                region: region,
                isBuffer: isBuffer
            });
        }

        // 5) AMR에 현재 태스크가 없는지 확인
        const canCreateTask = await checkRobotTaskStatus(robot);
        if (!canCreateTask) {
            return res.status(400).json({ message: 'AMR에 이미 실행 중인 태스크가 있습니다' });
        }

        // 6) 빈 B지역 충전 스테이션 찾기
        const robots = await Robot.findAll();
        const bChargeStations = stations.filter(s => 
            regionOf(s) === 'B' && hasClass(s, '충전')
        );

        if (bChargeStations.length === 0) {
            return res.status(400).json({ message: 'B지역에 충전 스테이션이 없습니다' });
        }

        let emptyChargeStation = null;
        for (const chargeSt of bChargeStations) {
            const robotAtCharge = robots.find(r => String(r.location) === String(chargeSt.id));
            if (!robotAtCharge) {
                emptyChargeStation = chargeSt;
                break;
            }
        }

        if (!emptyChargeStation) {
            return res.status(400).json({ message: '모든 B지역 충전 스테이션이 사용 중입니다' });
        }

        // 7) 충전 스테이션의 PRE 스테이션 찾기
        const chargePreStation = stations.find(s => 
            s.name === `${emptyChargeStation.name}_PRE`
        );

        if (!chargePreStation) {
            return res.status(400).json({ 
                message: `충전 스테이션 ${emptyChargeStation.name}의 PRE 스테이션을 찾을 수 없습니다` 
            });
        }

        // 8) B동 충전 태스크 생성 (JACK_DOWN → 충전소PRE → 충전소)
        const taskSteps = [
            {
                seq: 0,
                type: 'JACK_DOWN',
                payload: JSON.stringify({ height: 0.0 }),
                status: 'PENDING',
            },
            {
                seq: 1,
                type: 'NAV',
                payload: JSON.stringify({ dest: chargePreStation.id }),
                status: 'PENDING',
            },
            {
                seq: 2,
                type: 'NAV',
                payload: JSON.stringify({ dest: emptyChargeStation.id }),
                status: 'PENDING',
            }
        ];

        const task = await Task.create(
            {
                robot_id: robot.id,
                steps: taskSteps,
            },
            { include: [{ model: TaskStep, as: 'steps' }] }
        );

        console.log(`[Robot.sendToCharge] ${robot.name}: 충전 태스크 생성 완료 (태스크 ID: ${task.id}, 목표: ${emptyChargeStation.name})`);

        // 10) 성공 응답
        return res.json({
            success: true,
            message: '충전 명령이 성공적으로 전송되었습니다',
            robot: robot.name,
            taskId: task.id,
            currentLocation: currentStation.name || currentStation.id,
            targetChargeStation: emptyChargeStation.name,
            chargePreStation: chargePreStation.name
        });

    } catch (err) {
        console.error('[Robot.sendToCharge] error:', err);
        return res.status(500).json({ message: err.message });
    }
};