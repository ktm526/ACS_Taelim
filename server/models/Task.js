//models/Task.js

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Task = sequelize.define('Task', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    robot_id: { type: DataTypes.INTEGER, allowNull: false },
    status: {
        type: DataTypes.ENUM(
            'PENDING', 'RUNNING', 'PAUSED', 'CANCELED', 'DONE', 'FAILED'),
        defaultValue: 'PENDING'
    },
    current_seq: { type: DataTypes.INTEGER, defaultValue: 0 },
    // 시나리오 번호 (1, 2, 3)
    scenario: { type: DataTypes.INTEGER, allowNull: true },
    // 태스크 요약 정보 (JSON)
    // 예: { source: "인스토커 L", target: "연마기 6-L, 5-R", pickup_count: 2, dropoff_count: 2 }
    summary: { type: DataTypes.TEXT, allowNull: true },
}, {
    tableName: 'Tasks',
    timestamps: true,
});


module.exports = Task;
