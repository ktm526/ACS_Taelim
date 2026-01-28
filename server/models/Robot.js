// models/Robot.js
// TODO: Product 추가 (사용자가 슬롯을 추가할 수 있음, 슬롯 상태는 0: 빈거, 1: 제품 타입 1번, 2: 제품 타입 2번)
// HOME station 추가
// Charge station 추가


const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('Robot', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    ip: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: '대기',
    },
    battery: {                           // 배터리 레벨(%)
        type: DataTypes.FLOAT,
        defaultValue: 0,
    },
    voltage: {                           // 전압(V)
        type: DataTypes.FLOAT,
        defaultValue: 0,
    },
    current_map: {                       // 현재 맵 이름
        type: DataTypes.STRING,
        allowNull: true,
    },
    // ─── 새로 추가 ───────────────────────────────
    location: {                          // current_station
        type: DataTypes.STRING,
        allowNull: true,
    },
    next_location: {                     // 다음 위치 (optional)
        type: DataTypes.STRING,
        allowNull: true,
    },
    destination: {                       // 목적지
        type: DataTypes.STRING,
        allowNull: true,
    },
    task_step: {                         // 현재 작업 단계
        type: DataTypes.STRING,
        allowNull: true,
    },
    // ────────────────────────────────────────────────
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    position: {                          // JSON 문자열: { x, y, angle }
        type: DataTypes.TEXT,
        allowNull: true,
    },
    phase: {
        type: DataTypes.STRING,    // ex. null | 'to_pre' | 'pre_down' | 'to_buf' | 'buf_down' | 'leave_pre' | 'pre_down_after'
        allowNull: true,
      },
      bufferTargetId: {
        type: DataTypes.INTEGER,   // 실제 버퍼 스테이션 ID
        allowNull: true,
      },
    additional_info: {                   // 원본 Push 페이로드 전체
        type: DataTypes.TEXT,
        allowNull: true,
    },

    // ── TODO 반영: HOME/Charge station + 슬롯(제품) ─────────────────
    home_station: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    charge_station: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    // 사용자가 슬롯을 추가할 수 있으므로 JSON 배열로 저장 (예: [0,1,2])
    // 0: 빈거, 1: 제품 타입 1번, 2: 제품 타입 2번 ...
    slots: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '[]',
    },
    plc_ids: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '{}',
    },
}, {
    tableName: 'Robots',
    timestamps: false,
});
