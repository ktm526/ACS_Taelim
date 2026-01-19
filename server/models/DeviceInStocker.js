const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('DeviceInStocker', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    defaultValue: 1,
  },
  work_available_signal_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  slots: {
    // 슬롯별 작업중/작업완료 신호 id JSON 저장
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '{}',
  },
}, {
  tableName: 'DeviceInStocker',
  timestamps: true,
});
