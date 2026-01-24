// routes/taskLogRoutes.js
const express = require('express');
const router = express.Router();
const taskLogController = require('../controllers/taskLogController');

// GET /api/task-logs - 로그 목록 (페이지네이션 + 필터)
router.get('/', taskLogController.getLogs);

// GET /api/task-logs/stats - 로그 통계
router.get('/stats', taskLogController.getStats);

// GET /api/task-logs/task/:taskId - 특정 태스크의 로그
router.get('/task/:taskId', taskLogController.getLogsByTaskId);

// DELETE /api/task-logs - 오래된 로그 삭제
router.delete('/', taskLogController.deleteLogs);

module.exports = router;
