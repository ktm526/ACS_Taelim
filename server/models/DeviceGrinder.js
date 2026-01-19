const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('DeviceGrinder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    defaultValue: 1,
  },
  grinders: {
    // 연마기 1~6 설정 JSON 저장
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '[]',
  },
}, {
  tableName: 'DeviceGrinder',
  timestamps: true,
});
