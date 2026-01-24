// models/TaskLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('TaskLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  robot_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  robot_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  step_seq: {
    type: DataTypes.INTEGER,
    allowNull: true, // null이면 태스크 전체 로그
  },
  step_type: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  event: {
    type: DataTypes.STRING, // TASK_CREATED, TASK_STARTED, TASK_DONE, TASK_FAILED, TASK_CANCELED, STEP_STARTED, STEP_DONE, STEP_FAILED
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  payload: {
    type: DataTypes.TEXT, // JSON string
    allowNull: true,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'TaskLogs',
  timestamps: false,
  indexes: [
    { fields: ['task_id'] },
    { fields: ['robot_id'] },
    { fields: ['event'] },
    { fields: ['created_at'] },
  ],
});
