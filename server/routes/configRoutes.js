const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');

// 일반 로그인
router.post('/login', configController.login);

// 로그아웃
router.post('/logout', configController.logout);

// 세션 검증
router.post('/verify-session', configController.verifySession);

// 로그인 패스워드 변경
router.put('/login-password', configController.updateLoginPassword);

// 관리자 패스워드 확인
router.post('/verify-password', configController.verifyAdminPassword);

// 관리자 패스워드 변경
router.put('/admin-password', configController.updateAdminPassword);

// 특정 설정 조회
router.get('/:key', configController.getConfig);

// 모든 설정 조회 (패스워드 제외)
router.get('/', configController.getAllConfigs);

// 시스템 정보 조회
router.get('/system/info', configController.getSystemInfo);

module.exports = router; 