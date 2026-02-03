const express = require('express');
const c = require('../controllers/robotController');
const router = express.Router();
const tc = require('../controllers/taskController');   // ★ 추가

router.get('/', c.getAll);
router.get('/:id', c.getById);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/', c.removeAll);
router.delete('/:id', c.remove);
router.post('/:id/move', c.moveToStation);

router.get('/:id/current-task', tc.currentOfRobot);           // <<<  추가
router.post('/:id/sendtocharge', c.sendToCharge);                // <<<  충전 명령 추가
router.get('/:id/arm-state', c.getArmState);                     // <<<  로봇 팔 상태 조회


module.exports = router;
 