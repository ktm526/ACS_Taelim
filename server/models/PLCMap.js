// models/PLCMap.js
// PLC 비트(또는 주소) ↔ AMR 스테이션/설비(두산팔 등) 매핑 테이블
// id: plc 비트 값(직접 지정)
// amr_station: amr station name
// mani_id: 두산 팔 id
// class: in, out, 연마기, 컨베이어
// product_type: 제품 타입

const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('PLCMap', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
  },
  amr_station: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mani_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  class: {
    type: DataTypes.ENUM('in', 'out', '연마기', '컨베이어'),
    allowNull: false,
  },
  product_type: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // class === '연마기' 일 때만 의미가 있는 우회(bypass) 플래그
  bypass: {
    // SQLite 특성상 기존 BOOLEAN 컬럼이어도 숫자 저장 가능.
    // 앞으로는 숫자값(0~)을 저장하는 용도로 사용.
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'PLCMaps',
  timestamps: true,
});