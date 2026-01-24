// controllers/taskLogController.js
const { TaskLog } = require('../models');
const { Op } = require('sequelize');

// 로그 목록 조회 (페이지네이션 + 필터)
exports.getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      task_id,
      robot_id,
      robot_name,
      event,
      start_date,
      end_date,
    } = req.query;

    const where = {};

    if (task_id) where.task_id = task_id;
    if (robot_id) where.robot_id = robot_id;
    if (robot_name) where.robot_name = { [Op.like]: `%${robot_name}%` };
    if (event) where.event = event;

    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) where.created_at[Op.gte] = new Date(start_date);
      if (end_date) where.created_at[Op.lte] = new Date(end_date);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await TaskLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      logs: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / parseInt(limit)),
    });
  } catch (error) {
    console.error('[TaskLogController] getLogs error:', error);
    res.status(500).json({ error: error.message });
  }
};

// 특정 태스크의 로그 조회
exports.getLogsByTaskId = async (req, res) => {
  try {
    const { taskId } = req.params;
    const logs = await TaskLog.findAll({
      where: { task_id: taskId },
      order: [['created_at', 'ASC']],
    });
    res.json(logs);
  } catch (error) {
    console.error('[TaskLogController] getLogsByTaskId error:', error);
    res.status(500).json({ error: error.message });
  }
};

// 로그 통계
exports.getStats = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const where = {};
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) where.created_at[Op.gte] = new Date(start_date);
      if (end_date) where.created_at[Op.lte] = new Date(end_date);
    }

    const total = await TaskLog.count({ where });

    // 이벤트별 카운트
    const eventCounts = await TaskLog.findAll({
      where,
      attributes: [
        'event',
        [require('sequelize').fn('COUNT', require('sequelize').col('event')), 'count']
      ],
      group: ['event'],
      raw: true,
    });

    // 로봇별 카운트
    const robotCounts = await TaskLog.findAll({
      where: { ...where, robot_name: { [Op.ne]: null } },
      attributes: [
        'robot_name',
        [require('sequelize').fn('COUNT', require('sequelize').col('robot_name')), 'count']
      ],
      group: ['robot_name'],
      raw: true,
    });

    res.json({
      total,
      byEvent: eventCounts.reduce((acc, r) => ({ ...acc, [r.event]: parseInt(r.count) }), {}),
      byRobot: robotCounts.reduce((acc, r) => ({ ...acc, [r.robot_name]: parseInt(r.count) }), {}),
    });
  } catch (error) {
    console.error('[TaskLogController] getStats error:', error);
    res.status(500).json({ error: error.message });
  }
};

// 오래된 로그 삭제 (관리용)
exports.deleteLogs = async (req, res) => {
  try {
    const { days_old = 30 } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days_old));

    const deleted = await TaskLog.destroy({
      where: {
        created_at: { [Op.lt]: cutoffDate },
      },
    });

    res.json({ deleted, message: `${deleted}개의 로그가 삭제되었습니다.` });
  } catch (error) {
    console.error('[TaskLogController] deleteLogs error:', error);
    res.status(500).json({ error: error.message });
  }
};
