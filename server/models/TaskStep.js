//models/TaskStep.js

// TODO: TaskStep update
// type: 매니퓰레이터 작업, 모바일 이동
// 
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const Task = require('./Task');           // 순환참조 아님


const TaskStep = sequelize.define('TaskStep', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    task_id: { type: DataTypes.INTEGER, allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false },
    type: {
        type: DataTypes.ENUM(
            'NAV', 'MANI_WORK', 'PLC_WRITE', 'PLC_READ'),
        allowNull: false
    },
    payload: { type: DataTypes.TEXT, allowNull: false },         
    // JSON string 
    // NAV: { dest: 'A4' }
    // MANI_WORK: { CMD_ID: 1, CMD_FROM: 33, CMD_TO: 43 }
    // PLC_WRITE: { PLC_BIT: B5001, PLC_DATA: 1 }
    // PLC_READ: { PLC_ID: "2224.1", EXPECTED: 1 }
    status: {
        type: DataTypes.ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED'),
        defaultValue: 'PENDING'
    },
}, {
    tableName: 'TaskSteps',
    timestamps: false,
});

module.exports = TaskStep;
