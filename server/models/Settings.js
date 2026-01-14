// models/Settings.js
// TODO 기반 Settings 테이블(단일 row 권장)
// - 기준이 될 연마기 정보
// - AMR이 충전하러 갈 전력량 기준
// - 기준 연마기 on일 때 기다릴 시간값
// - 충전 완료 기준 %

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('Settings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: false,
    defaultValue: 1,
  },

  // 기준 연마기(이름/ID/스테이션 등 문자열로 저장)
  reference_grinder: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  // AMR 충전하러 갈 배터리 기준(%)
  charge_threshold_percent: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 20,
  },

  // 연마기 on일 때 기다릴 시간(ms)
  grinder_wait_ms: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  // 충전 완료 기준(%)
  charge_complete_percent: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 90,
  },
}, {
  tableName: 'Settings',
  timestamps: true,
});