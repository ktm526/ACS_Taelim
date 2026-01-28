// server/index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const sequelize = require('./config/db');
const app = express();

// 장치 설정 모델 등록 (sync 전에 로드)
require('./models/DeviceInStocker');
require('./models/DeviceGrinder');
require('./models/DeviceOutStocker');
require('./models/DeviceConveyor');

/* ── ① 공통 미들웨어 ─────────────────────────────── */
app.use(cors({ origin: '*' }));
app.use(express.json());

/* ── ② API 라우트 ───────────────────────────────── */
console.log('Loading mapRoutes...');
app.use('/api/maps', require('./routes/mapRoutes'));
console.log('Loading mapUploadRoutes...');
app.use('/api/maps', require('./routes/mapUploadRoutes'));
console.log('Loading robotRoutes...');
app.use('/api/robots', require('./routes/robotRoutes'));
console.log('Loading taskRoutes...');
app.use('/api/tasks', require('./routes/taskRoutes'));
console.log('Loading plcMapRoutes...');
app.use('/api/plc-maps', require('./routes/plcMapRoutes'));
console.log('Loading settingsRoutes...');
app.use('/api/settings', require('./routes/settingsRoutes'));
console.log('Loading deviceRoutes...');
app.use('/api/devices', require('./routes/deviceRoutes'));
console.log('Loading plcRoutes...');
app.use('/api/plc', require('./routes/plcRoutes'));
console.log('Loading healthRoutes...');
app.use('/api/health', require('./routes/healthRoutes'));
console.log('Loading configRoutes...');
app.use('/api/config', require('./routes/configRoutes'));
console.log('Loading taskLogRoutes...');
app.use('/api/task-logs', require('./routes/taskLogRoutes'));

/* ── ③ 정적 파일 (프런트) ───────────────────────── */
app.use(express.static(path.join(__dirname, 'dist')));

/* ── ④ Bootstrap ───────────────────────────────── */
(async () => {
  try {
    /* 0) 혹시 남아 있을 임시 backup 테이블 정리 ------------ */
    const qi = sequelize.getQueryInterface();
    const backupTables = [
      'Robots_backup', 'Logs_backup',
      'Tasks_backup', 'TaskSteps_backup',
    ];
    for (const t of backupTables) {
      /* 존재하지 않으면 DROP 시 에러가 나므로 try/catch */
      await qi.dropTable(t).catch(() => { });
    }

    /* 0-1) 제거된 기능 테이블 정리 (요청: Logs, TaskExecutionLogs 삭제) */
    const removedTables = ['Logs', 'TaskExecutionLogs'];
    for (const t of removedTables) {
      await qi.dropTable(t).catch(() => { });
    }

    /* 0-2) 기존 Robots 테이블에 컬럼 추가 (sync()는 기본적으로 alter를 하지 않음) */
    const ensureRobotColumns = async () => {
      // home_station
      await qi.addColumn('Robots', 'home_station', {
        type: require('sequelize').DataTypes.STRING,
        allowNull: true,
      }).catch(() => { });
      // charge_station
      await qi.addColumn('Robots', 'charge_station', {
        type: require('sequelize').DataTypes.STRING,
        allowNull: true,
      }).catch(() => { });
      // slots
      await qi.addColumn('Robots', 'slots', {
        type: require('sequelize').DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
      }).catch(() => { });
      // plc_ids
      await qi.addColumn('Robots', 'plc_ids', {
        type: require('sequelize').DataTypes.TEXT,
        allowNull: false,
        defaultValue: '{}',
      }).catch(() => { });
    };
    await ensureRobotColumns();

    /* 0-3) 기존 PLCMaps 테이블에 bypass 컬럼 추가 */
    const ensurePLCMapColumns = async () => {
      await qi.addColumn('PLCMaps', 'bypass', {
        // 숫자 bypass 값을 저장 (SQLite는 타입이 유연)
        type: require('sequelize').DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      }).catch(() => { });
    };
    await ensurePLCMapColumns();

    /* 0-4) 인스토커 설정 테이블에 side_signals 컬럼 추가 */
    const ensureDeviceInStockerColumns = async () => {
      await qi.addColumn('DeviceInStocker', 'side_signals', {
        type: require('sequelize').DataTypes.TEXT,
        allowNull: false,
        defaultValue: '{}',
      }).catch(() => { });
    };
    await ensureDeviceInStockerColumns();

    /* 1) 실제 테이블 자동 생성/변경 ----------------------- */
    //await sequelize.sync({ force: true });
    await sequelize.sync();

    console.log('✅ DB synced');

    /* 2) 서비스 모듈 로드 ------------------------------- */
    console.log('Loading amrMonitorService...');
    require('./services/amrMonitorService');
    console.log('Loading settingsService...');
    require('./services/settingsService');
    console.log('Loading plcMonitorService...');
    require('./services/plcMonitorService');
    //console.log('Loading taskCreateService...');
    //require('./services/taskCreateService');
    console.log('Loading taskExecutorService...');
    require('./services/taskExecutorService');
    console.log('Loading heartbeatService...');
    const heartbeatService = require('./services/heartbeatService');
    heartbeatService.start();
    // dispatcher/taskExecutor/robotJack/robotMotion/robotMap 기능은 제거됨

    /* 3) React Router 지원을 위한 catch-all 라우트 ─── */
    // 정규식을 사용한 catch-all 라우트 (path-to-regexp 오류 회피)
    app.use((req, res, next) => {
      // API 요청이면 next()로 넘김 (404 처리)
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      
      // GET 요청이고 파일 확장자가 없는 경우 (SPA 라우트로 간주)
      if (req.method === 'GET' && !path.extname(req.path)) {
        // 모바일 경로 로깅
        if (req.path.startsWith('/mobile')) {
          console.log(`📱 Mobile route accessed: ${req.path} from ${req.ip}`);
        }
        return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
      }
      
      // 그 외는 404
      res.status(404).send('Not Found');
    });

    /* 4) HTTP 서버 리스닝 ------------------------------- */
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 API ready on :${PORT}`));
  } catch (err) {
    console.error('❌ bootstrap failed:', err);
    process.exit(1);
  }
})();

/* ── graceful shutdown ─────────────────────────── */
process.on('SIGINT', () => { console.log('\nSIGINT'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nSIGTERM'); process.exit(0); });
 