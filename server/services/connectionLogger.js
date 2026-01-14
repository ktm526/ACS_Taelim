/**
 * 통합 연결 상태 로거
 *  ───────────────────────────────
 *  key         : 'AMR:192.168.0.3' | 'AMR:ELLO-01' | 'RIO:192.168.0.5'
 *  connected   : boolean (true=conn, false=disconn)
 *  meta        : { robot_name, detail … }  // Log 모델 필드 그대로 전달 가능
 */
const _prev = new Map();      // key → lastConnected(true/false)

async function logConnChange(key, connected, meta = {}) {
    //!!!", key, connected)
    const last = _prev.get(key);
    if (last === undefined) {                // 첫 호출이면 상태만 기억
        _prev.set(key, connected);
        return;
    }
    if (last !== connected) {                // 상태 변동 시에만 기록
        _prev.set(key, connected);
        const status = connected ? 'conn' : 'disconn';
        // Log 테이블/모델 제거로 인해 DB 기록은 하지 않고 콘솔 로그만 남김
        if (meta && meta.robot_name) {
            console.log(`[ConnLog] ${status}: ${key} (robot_name=${meta.robot_name})`);
        } else {
            console.log(`[ConnLog] ${status}: ${key}`);
        }
    }
}

module.exports = { logConnChange };
