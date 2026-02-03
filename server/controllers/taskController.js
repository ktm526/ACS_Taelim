/* controllers/taskController.js */
const { Op } = require('sequelize');
const { Task, TaskStep, TaskLog } = require('../models');
const Robot = require('../models/Robot');

const TASK_TTL_MS = 10 * 60 * 1000; // 10분
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1분마다 체크

async function cleanupOldTasks() {
  try {
    const cutoff = new Date(Date.now() - TASK_TTL_MS);
    const rows = await Task.findAll({
      attributes: ['id', 'status', 'updatedAt'],
      where: {
        status: { [Op.in]: ['DONE', 'CANCELED', 'FAILED'] },
        updatedAt: { [Op.lt]: cutoff },
      },
    });
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    console.log(`[TaskCleanup] 삭제 대상 ${ids.length}개: ${ids.join(', ')}`);
    await TaskStep.destroy({ where: { task_id: { [Op.in]: ids } } });
    const deleted = await Task.destroy({ where: { id: { [Op.in]: ids } } });
    console.log(`[TaskCleanup] ${deleted}개 태스크 삭제 완료`);
  } catch (err) {
    console.error('[TaskCleanup] error:', err.message);
  }
}

// 즉시 실행 + 주기적 실행
cleanupOldTasks();
setInterval(cleanupOldTasks, CLEANUP_INTERVAL_MS);
console.log('[TaskCleanup] 자동 삭제 스케줄러 시작 (10분 경과 DONE/CANCELED/FAILED 태스크)');

/* POST /api/tasks  ─ Task + Steps 생성 */
exports.create = async (req, res) => {
  const { robot_id, steps = [] } = req.body;
  console.log(`[TaskController] 태스크 생성 요청: robot_id=${robot_id}, steps=${steps.length}개`, steps.map((s, i) => `[${i}] ${s.type}`).join(', '));

  const task = await Task.create(
    {
      robot_id,
      steps: steps.map((s, i) => ({
        ...s,
        seq: i,
        payload: typeof s.payload === 'string' ? s.payload : JSON.stringify(s.payload ?? {}),
      })),
    },
    { include: [{ model: TaskStep, as: 'steps' }] },
  );

  const createdSteps = await TaskStep.findAll({ where: { task_id: task.id } });
  console.log(`[TaskController] 태스크 생성 완료: Task#${task.id}, 실제 생성된 스텝=${createdSteps.length}개`);

  res.status(201).json({ id: task.id });
};

/* PUT /api/tasks/:id/pause */
exports.pause = async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.sendStatus(404);
  
  const robot = task.robot_id ? await Robot.findByPk(task.robot_id) : null;
  await task.update({ status: 'PAUSED' });
  
  // 로그 기록
  await TaskLog.create({
    task_id: task.id,
    robot_id: robot?.id || null,
    robot_name: robot?.name || null,
    event: 'TASK_PAUSED',
    message: '태스크 일시정지',
  });
  console.log(`[TaskController] Task#${task.id} 일시정지`);

  res.json({ success: true });
};

/* PUT /api/tasks/:id/resume */
exports.resume = async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.sendStatus(404);
  if (!['PAUSED', 'FAILED'].includes(task.status))
    return res.status(400).json({ msg: 'not resumable' });
  
  const robot = task.robot_id ? await Robot.findByPk(task.robot_id) : null;
  const prevStatus = task.status;
  await task.update({ status: 'PENDING' });
  
  // 로그 기록
  await TaskLog.create({
    task_id: task.id,
    robot_id: robot?.id || null,
    robot_name: robot?.name || null,
    event: 'TASK_RESUMED',
    message: prevStatus === 'FAILED' ? '실패 태스크 재개' : '태스크 재개',
  });
  console.log(`[TaskController] Task#${task.id} 재개 (이전 상태: ${prevStatus})`);

  res.json({ success: true });
};

/* PUT /api/tasks/:id/restart - DI 입력과 동일한 재시작 동작 */
exports.restart = async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id, {
      include: [{
        model: TaskStep,
        as: 'steps',
        where: { status: 'RUNNING' },
        required: false
      }]
    });
    
    if (!task) return res.sendStatus(404);
    
    const robot = await Robot.findByPk(task.robot_id);
    if (!robot) return res.status(404).json({ msg: 'Robot not found' });
    
    if (!['PAUSED', 'RUNNING'].includes(task.status)) {
      return res.status(400).json({ msg: 'Task is not paused or running' });
    }
    
    // DI 입력의 handleRestartSignal과 동일한 로직
    if (task.status === 'PAUSED') {
      await task.update({ status: 'RUNNING' });
      
      // 로그 기록
      await TaskLog.create({
        task_id: task.id,
        robot_id: robot.id,
        robot_name: robot.name,
        event: 'TASK_RESTARTED',
        message: '태스크 재시작 (PAUSED → RUNNING)',
      });
      console.log(`[API_RESTART] ${robot.name}: 태스크 상태를 PAUSED → RUNNING으로 변경`);
    }
    
    res.json({ success: true, message: 'Task restarted successfully' });
    
  } catch (error) {
    console.error('[API_RESTART] 오류:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/* DELETE /api/tasks/:id  ─ 취소 */
exports.cancel = async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) return res.sendStatus(404);

  // 로봇 정보 조회
  const robot = task.robot_id ? await Robot.findByPk(task.robot_id) : null;

  await task.update({ status: 'CANCELED' });
  await TaskStep.update(
    { status: 'FAILED' },
    { where: { task_id: task.id, status: ['PENDING', 'RUNNING'] } },
  );

  // 로그 기록
  try {
    await TaskLog.create({
      task_id: task.id,
      robot_id: task.robot_id,
      robot_name: robot?.name || null,
      event: 'TASK_CANCELED',
      message: '사용자에 의해 태스크 취소됨',
    });
  } catch (err) {
    console.error('[TaskLog] 취소 로그 기록 실패:', err.message);
  }

  res.json({ success: true });
};

/* GET /api/tasks[/:id]  ─ 목록/단건 */
exports.list = async (req, res) => {
  if (req.params.id) {
    const task = await Task.findByPk(req.params.id, {
      include: [{ model: TaskStep, as: 'steps' }],
    });
    return task ? res.json(task) : res.sendStatus(404);
  }

  const rows = await Task.findAll({ order: [['id', 'DESC']] });
  res.json(rows);
};

/* GET /api/robots/:id/current-task */
exports.currentOfRobot = async (req, res) => {
  const { id: robot_id } = req.params;

  const task = await Task.findOne({
    where: { robot_id, status: ['PENDING', 'RUNNING', 'PAUSED'] },
    order: [['id', 'ASC']],
    include: [{
      model: TaskStep,
      as:   'steps',
      separate: true,
      order: [['seq', 'ASC']],
    }],
  });

  if (!task) return res.sendStatus(204);

  // summary JSON 파싱
  let summary = null;
  if (task.summary) {
    try {
      summary = JSON.parse(task.summary);
    } catch {
      summary = task.summary;
    }
  }

  res.json({
    task_id    : task.id,
    current_seq: task.current_seq,
    scenario   : task.scenario,
    summary    : summary,
    steps      : task.steps.map(s => ({
      seq    : s.seq,
      type   : s.type,
      payload: s.payload,      // string 그대로 반환 (프론트에서 JSON.parse)
      status : s.status,
    })),
    paused   : task.status === 'PAUSED',
  });
};
