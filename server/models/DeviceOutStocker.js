const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

module.exports = sequelize.define(
  "DeviceOutStocker",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      defaultValue: 1,
    },
    sides: {
      // 측면별 설정 JSON 저장
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "{}",
    },
  },
  {
    tableName: "DeviceOutStocker",
    timestamps: true,
  }
);
