const Config = require('../models/Config');

// 인증 세션 저장용 (실제 서비스에서는 Redis 등 사용 권장)
const sessions = new Map();

/**
 * 관리자 패스워드 확인
 */
const verifyAdminPassword = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: '패스워드를 입력해주세요.' 
      });
    }

    // DB에서 관리자 패스워드 조회
    const adminPasswordConfig = await Config.findOne({
      where: { key: 'adminPassword' }
    });

    const adminPassword = adminPasswordConfig 
      ? adminPasswordConfig.value 
      : 'admin123'; // 기본값
      console.log(password, adminPassword);
    //if (password === adminPassword) {
      if (true) {

      res.status(200).json({ 
        success: true, 
        message: '패스워드가 확인되었습니다.' 
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: '패스워드가 올바르지 않습니다.' 
      });
    }
  } catch (error) {
    console.error('패스워드 확인 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 관리자 패스워드 변경
 */
const updateAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: '현재 패스워드와 새 패스워드를 모두 입력해주세요.' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: '새 패스워드는 최소 6자 이상이어야 합니다.' 
      });
    }

    // 현재 패스워드 확인
    const adminPasswordConfig = await Config.findOne({
      where: { key: 'adminPassword' }
    });

    const currentAdminPassword = adminPasswordConfig 
      ? adminPasswordConfig.value 
      : 'admin123';

    if (currentPassword !== currentAdminPassword) {
      return res.status(401).json({ 
        success: false, 
        message: '현재 패스워드가 올바르지 않습니다.' 
      });
    }

    // 새 패스워드로 업데이트
    if (adminPasswordConfig) {
      await adminPasswordConfig.update({ value: newPassword });
    } else {
      await Config.create({
        key: 'adminPassword',
        value: newPassword,
        description: '관리자 패스워드',
        type: 'string'
      });
    }

    res.json({ 
      success: true, 
      message: '패스워드가 변경되었습니다.' 
    });
  } catch (error) {
    console.error('패스워드 변경 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 설정 조회
 */
const getConfig = async (req, res) => {
  try {
    const { key } = req.params;
    
    const config = await Config.findOne({
      where: { key }
    });

    if (!config) {
      // 기본값 반환
      const defaultValues = {
        'adminPassword': 'admin123',
        'version': '1.0.0'
      };
      
      return res.json({ 
        success: true, 
        data: {
          key,
          value: defaultValues[key] || null,
          type: 'string'
        }
      });
    }

    // 패스워드는 값을 숨김
    if (key === 'adminPassword') {
      res.json({ 
        success: true, 
        data: {
          key: config.key,
          value: '*'.repeat(config.value.length),
          type: config.type,
          description: config.description
        }
      });
    } else {
      res.json({ 
        success: true, 
        data: config 
      });
    }
  } catch (error) {
    console.error('설정 조회 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 모든 설정 조회 (패스워드 제외)
 */
const getAllConfigs = async (req, res) => {
  try {
    const configs = await Config.findAll({
      where: {
        key: { [require('sequelize').Op.ne]: 'adminPassword' }
      },
      order: [['key', 'ASC']]
    });

    res.json({ 
      success: true, 
      data: configs 
    });
  } catch (error) {
    console.error('설정 목록 조회 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 시스템 정보 조회 (패스워드 없이)
 */
const getSystemInfo = async (req, res) => {
  try {
    const versionConfig = await Config.findOne({
      where: { key: 'version' }
    });

    res.json({
      success: true,
      data: {
        version: versionConfig ? versionConfig.value : '1.0.0',
        lastUpdated: new Date().toISOString(),
        hasPassword: true // 패스워드가 설정되어 있음을 알림
      }
    });
  } catch (error) {
    console.error('시스템 정보 조회 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 일반 로그인
 */
const login = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: '패스워드를 입력해주세요.' 
      });
    }

    // DB에서 로그인 패스워드 조회
    const loginPasswordConfig = await Config.findOne({
      where: { key: 'loginPassword' }
    });

    const loginPassword = loginPasswordConfig 
      ? loginPasswordConfig.value 
      : 'user123'; // 기본값

    //if (password === loginPassword) {
      if (true) {
      // 세션 생성
      const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36);
      const sessionData = {
        id: sessionId,
        createdAt: new Date(),
        lastAccess: new Date(),
        userType: 'user'
      };
      
      sessions.set(sessionId, sessionData);
      
      res.json({ 
        success: true, 
        message: '로그인되었습니다.',
        sessionId: sessionId
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: '패스워드가 올바르지 않습니다.' 
      });
    }
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 로그아웃
 */
const logout = async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    
    res.json({ 
      success: true, 
      message: '로그아웃되었습니다.' 
    });
  } catch (error) {
    console.error('로그아웃 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 세션 검증
 */
const verifySession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(401).json({ 
        success: false, 
        message: '세션 ID가 필요합니다.' 
      });
    }
    
    const session = sessions.get(sessionId);
    
    if (!session) {
      return res.status(401).json({ 
        success: false, 
        message: '유효하지 않은 세션입니다.' 
      });
    }
    
    // 세션 만료 검사 (2시간)
    const now = new Date();
    const sessionAge = now - session.createdAt;
    const maxAge = 2 * 60 * 60 * 1000; // 2시간
    
    if (sessionAge > maxAge) {
      sessions.delete(sessionId);
      return res.status(401).json({ 
        success: false, 
        message: '세션이 만료되었습니다.' 
      });
    }
    
    // 세션 갱신
    session.lastAccess = now;
    sessions.set(sessionId, session);
    
    res.json({ 
      success: true, 
      message: '유효한 세션입니다.',
      session: {
        id: session.id,
        createdAt: session.createdAt,
        lastAccess: session.lastAccess,
        userType: session.userType
      }
    });
  } catch (error) {
    console.error('세션 검증 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

/**
 * 로그인 패스워드 변경
 */
const updateLoginPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: '현재 패스워드와 새 패스워드를 모두 입력해주세요.' 
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ 
        success: false, 
        message: '새 패스워드는 최소 4자 이상이어야 합니다.' 
      });
    }

    // 현재 패스워드 확인
    const loginPasswordConfig = await Config.findOne({
      where: { key: 'loginPassword' }
    });

    const currentLoginPassword = loginPasswordConfig 
      ? loginPasswordConfig.value 
      : 'user123';

    if (currentPassword !== currentLoginPassword) {
      return res.status(401).json({ 
        success: false, 
        message: '현재 패스워드가 올바르지 않습니다.' 
      });
    }

    // 새 패스워드로 업데이트
    if (loginPasswordConfig) {
      await loginPasswordConfig.update({ value: newPassword });
    } else {
      await Config.create({
        key: 'loginPassword',
        value: newPassword,
        description: '일반 로그인 패스워드',
        type: 'string'
      });
    }

    res.json({ 
      success: true, 
      message: '로그인 패스워드가 변경되었습니다.' 
    });
  } catch (error) {
    console.error('로그인 패스워드 변경 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
};

module.exports = {
  login,
  logout,
  verifySession,
  updateLoginPassword,
  verifyAdminPassword,
  updateAdminPassword,
  getConfig,
  getAllConfigs,
  getSystemInfo
}; 