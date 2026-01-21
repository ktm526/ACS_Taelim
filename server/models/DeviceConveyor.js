const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

module.exports = sequelize.define(
  "DeviceConveyor",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      defaultValue: 1,
    },
    conveyors: {
      // 컨베이어 설정 JSON 저장
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "[]",
    },
  },
  {
    tableName: "DeviceConveyor",
    timestamps: true,
  }
);
