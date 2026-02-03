// src/pages/Home/AMRStatus.jsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  Space,
  Divider,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Badge,
  Tag,
  Typography,
  Descriptions,
  Tabs,
  theme,
  message,
  Empty,
  Progress,
  Tooltip,
} from "antd";
import {
  PlusOutlined, 
  DeleteOutlined,
  SaveOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CarOutlined,
  ToolOutlined,
  HourglassOutlined,
  AimOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  UpOutlined,
  DownOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { robotsQueryAtom, selectedMapAtom } from "@/state/atoms";
import PasswordConfirm from "@/components/PasswordConfirm";
import usePasswordConfirm from "@/hooks/usePasswordConfirm";

const { Text, Paragraph } = Typography;
const API = import.meta.env.VITE_CORE_BASE_URL;

// 상태 문자열 ↔ Badge.status, Tag.color 매핑
const STATUS_BADGE = {
  이동: "processing",
  "작업 중": "processing",
  대기: "success",
  충전: "warning",
  수동: "default",
  오류: "error",
  비상정지: "error",
  "연결 끊김": "default",
  unknown: "default",
};
const STATUS_TAG_COLOR = {
  이동: "blue",
  "작업 중": "cyan",
  대기: "green",
  충전: "orange",
  수동: "purple",
  오류: "red",
  비상정지: "magenta",
  "연결 끊김": "default",
  unknown: "default",
};

// 안전한 JSON 파싱 함수 추가
function safeParse(raw, fallback = {}) {
  if (raw == null) return fallback;
  let v = raw;
  try {
    if (typeof v === "string") v = JSON.parse(v);
    if (typeof v === "string") v = JSON.parse(v);
  } catch {
    return fallback;
  }
  return v ?? fallback;
}

// ──────────────────────────────────────────────────────────────
// 개별 스텝 아이템 - 완전히 독립된 메모이제이션
const StepItem = React.memo(({ 
  step, 
  isCurrentStep, 
  isCompleted, 
  isLast,
  initialExpanded,
  onExpandChange,
}) => {
  // 확장 상태를 로컬로 관리 (부모 리렌더링에 영향 안 받음)
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    setIsExpanded(prev => {
      const newState = !prev;
      onExpandChange?.(step.seq, newState);
      return newState;
    });
  }, [step.seq, onExpandChange]);
  
  // 스텝 아이콘
  const stepIcon = useMemo(() => {
    switch (step.type) {
      case 'NAV':
      case 'NAV_PRE':
        return <CarOutlined />;
      case 'MANI_WORK':
        return <ToolOutlined />;
      case 'PLC_WRITE':
      case 'PLC_READ':
        return <ThunderboltOutlined />;
      case 'JACK_UP':
      case 'JACK_DOWN':
      case 'JACK':
        return <ToolOutlined />;
      case 'WAIT_FREE_PATH':
        return <HourglassOutlined />;
      default:
        return <ClockCircleOutlined />;
    }
  }, [step.type]);
  
  // 스텝 요약
  const stepSummary = useMemo(() => {
    try {
      const p = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload || {};
      switch (step.type) {
        case 'NAV':
        case 'NAV_PRE':
          return `→ ${p.dest || '?'}`;
        case 'MANI_WORK':
          return p.desc_from && p.desc_to 
            ? `${p.desc_from} → ${p.desc_to}` 
            : `매니 ${p.CMD_FROM}→${p.CMD_TO}`;
        case 'PLC_WRITE':
          return p.desc || `PLC ${p.PLC_BIT}=${p.PLC_DATA}`;
        case 'PLC_READ':
          return p.desc || `PLC ${p.PLC_ID}==${p.EXPECTED}`;
        case 'JACK_UP':
          return "잭 올리기";
        case 'JACK_DOWN':
          return "잭 내리기";
        default:
          return step.type;
      }
    } catch {
      return step.type;
    }
  }, [step.type, step.payload]);
  
  // 스텝 상세 payload
  const detailPayload = useMemo(() => {
    try {
      const p = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload || {};
      return JSON.stringify(p, null, 2);
    } catch {
      return step.payload || "{}";
    }
  }, [step.payload]);

  return (
    <div style={{ marginBottom: isLast ? 0 : 8 }}>
      <div 
        onClick={handleClick}
        style={{ 
          display: 'flex',
          alignItems: 'center',
          padding: '8px 10px',
          background: isCurrentStep ? '#e6f7ff' : isCompleted ? '#f6ffed' : '#fafafa',
          border: `1px solid ${isCurrentStep ? '#91d5ff' : isCompleted ? '#b7eb8f' : '#e8e8e8'}`,
          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isCompleted ? '#52c41a' : isCurrentStep ? '#1890ff' : '#d9d9d9',
            color: 'white',
            fontSize: 11,
            marginRight: 10,
            flexShrink: 0,
          }}
        >
          {isCompleted ? <CheckCircleOutlined /> :
           isCurrentStep ? <LoadingOutlined /> :
           <span style={{ fontSize: 10 }}>{step.seq + 1}</span>}
        </div>
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            {stepIcon}
            <Text 
              strong={isCurrentStep}
              style={{ 
                fontSize: 12,
                color: isCurrentStep ? '#1890ff' : 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {stepSummary}
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tag 
              style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px', margin: 0 }} 
              color={
                step.status === 'DONE' ? 'green' :
                step.status === 'RUNNING' ? 'blue' :
                step.status === 'PAUSED' ? 'orange' :
                step.status === 'FAILED' ? 'red' : 'default'
              }
            >
              {step.status}
            </Tag>
            <Text type="secondary" style={{ fontSize: 10 }}>{step.type}</Text>
          </div>
        </div>
        
        <div style={{ marginLeft: 8, color: '#999' }}>
          {isExpanded ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
        </div>
      </div>
      
      {isExpanded && (
        <div 
          style={{ 
            padding: 10,
            background: '#1a1a2e',
            borderRadius: '0 0 6px 6px',
            border: '1px solid #333',
            borderTop: 'none',
          }}
        >
          <Text style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 4 }}>
            Payload:
          </Text>
          <pre style={{ 
            margin: 0, 
            color: '#a9b7c6', 
            fontSize: 11, 
            lineHeight: 1.5,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {detailPayload}
          </pre>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 커스텀 비교 함수: 실제로 변경된 경우만 리렌더링
  return (
    prevProps.step.seq === nextProps.step.seq &&
    prevProps.step.status === nextProps.step.status &&
    prevProps.step.payload === nextProps.step.payload &&
    prevProps.isCurrentStep === nextProps.isCurrentStep &&
    prevProps.isCompleted === nextProps.isCompleted &&
    prevProps.isLast === nextProps.isLast
    // initialExpanded는 최초 마운트에만 사용되므로 비교하지 않음
  );
});

// ──────────────────────────────────────────────────────────────
// TaskSteps 컴포넌트 - 자동 폴링 (UI 상태 유지)
const POLL_INTERVAL_MS = 2000; // 2초마다 폴링

const CurrentTaskSteps = React.memo(({ amrId, amrName, passwordConfirm }) => {
  // 상태: 데이터 + 로딩
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const expandedStepsRef = useRef(new Set());
  const containerRef = useRef(null);
  const taskIdRef = useRef(null); // 현재 task_id 추적
  const lastDataHashRef = useRef(null); // 데이터 변경 감지용
  
  // 데이터 해시 생성 (변경 감지용)
  const getDataHash = useCallback((taskData) => {
    if (!taskData) return null;
    return JSON.stringify({
      task_id: taskData.task_id,
      status: taskData.status,
      paused: taskData.paused,
      current_seq: taskData.current_seq,
      steps: taskData.steps?.map(s => ({ seq: s.seq, status: s.status }))
    });
  }, []);
  
  // 백그라운드 폴링용 fetch (로딩 표시 없음, 변경 시에만 업데이트)
  const fetchTaskSilent = useCallback(async () => {
    if (!amrId) return;
    try {
      const r = await fetch(`${API}/api/robots/${amrId}/current-task`);
      if (r.status === 204 || r.status === 404) {
        if (lastDataHashRef.current !== null) {
          setData(null);
          taskIdRef.current = null;
          lastDataHashRef.current = null;
        }
        return;
      }
      if (!r.ok) return;
      const taskData = await r.json();
      if (!taskData?.steps?.length) {
        if (lastDataHashRef.current !== null) {
          setData(null);
          taskIdRef.current = null;
          lastDataHashRef.current = null;
        }
        return;
      }
      // 데이터가 실제로 변경된 경우에만 setState
      const newHash = getDataHash(taskData);
      if (newHash !== lastDataHashRef.current) {
        taskIdRef.current = taskData.task_id;
        lastDataHashRef.current = newHash;
        setData(taskData);
      }
    } catch {
      // 에러 시 무시 (기존 데이터 유지)
    }
  }, [amrId, getDataHash]);
  
  // 수동 새로고침용 fetch (로딩 표시 있음)
  const fetchTask = useCallback(async () => {
    if (!amrId) return;
    setIsLoading(true);
    try {
      const r = await fetch(`${API}/api/robots/${amrId}/current-task`);
      if (r.status === 204 || r.status === 404) {
        setData(null);
        taskIdRef.current = null;
        lastDataHashRef.current = null;
        return;
      }
      if (!r.ok) throw new Error(`status: ${r.status}`);
      const taskData = await r.json();
      if (!taskData?.steps?.length) {
        setData(null);
        taskIdRef.current = null;
        lastDataHashRef.current = null;
        return;
      }
      taskIdRef.current = taskData.task_id;
      lastDataHashRef.current = getDataHash(taskData);
      setData(taskData);
    } catch {
      setData(null);
      taskIdRef.current = null;
      lastDataHashRef.current = null;
    } finally {
      setIsLoading(false);
    }
  }, [amrId, getDataHash]);
  
  // 초기 로드 + 자동 폴링
  useEffect(() => {
    fetchTask(); // 초기 로드 (로딩 표시)
    const interval = setInterval(fetchTaskSilent, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTask, fetchTaskSilent]);
  
  const handleExpandChange = useCallback((seq, expanded) => {
    if (expanded) {
      expandedStepsRef.current.add(seq);
    } else {
      expandedStepsRef.current.delete(seq);
    }
  }, []);
  
  const handlePause = useCallback(async () => {
    if (!taskIdRef.current) return;
    try {
      await fetch(`${API}/api/tasks/${taskIdRef.current}/pause`, { method: "PUT" });
      message.success("일시정지");
      fetchTask();
    } catch {
      message.error("일시정지 실패");
    }
  }, [fetchTask]);
  
  const handleRestart = useCallback(async () => {
    if (!taskIdRef.current) return;
    try {
      await fetch(`${API}/api/tasks/${taskIdRef.current}/restart`, { method: "PUT" });
      message.success("재시작");
      fetchTask();
    } catch {
      message.error("재시작 실패");
    }
  }, [fetchTask]);
  
  const handleCancel = useCallback(async () => {
    if (!taskIdRef.current) return;
    try {
      await fetch(`${API}/api/tasks/${taskIdRef.current}`, { method: "DELETE" });
      message.success("취소");
      setData(null);
      taskIdRef.current = null;
    } catch {
      message.error("취소 실패");
    }
  }, []);

  const handleCancelWithPassword = useCallback(() => {
    passwordConfirm.showPasswordConfirm(
      () => handleCancel(),
      {
        title: "태스크 취소 확인",
        description: `관리자 비밀번호가 필요합니다.\n\nAMR "${amrName || "-"}"의 태스크를 취소하시겠습니까?`
      }
    );
  }, [amrName, handleCancel, passwordConfirm]);

  return (
    <Card
      size="small"
      bordered
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>현재 태스크</span>
          {data && (
            <Tag 
              color={data.paused ? 'orange' : 'blue'} 
              icon={data.paused ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              style={{ fontSize: '11px' }}
            >
              {data.paused ? '일시정지' : '실행중'}
            </Tag>
          )}
        </div>
      }
      extra={
        <Tooltip title="새로고침">
          <Button
            size="small"
            icon={<ReloadOutlined spin={isLoading} />}
            onClick={fetchTask}
            disabled={isLoading}
          />
        </Tooltip>
      }
      bodyStyle={{ padding: 12, height: 'calc(100% - 46px)', display: 'flex', flexDirection: 'column' }}
      style={{ width: '100%', height: '100%' }}
    >
      {data?.steps?.length > 0 ? (
        <>
          <div style={{ 
            marginBottom: 12, 
            padding: 10, 
            background: '#f5f5f5', 
            borderRadius: 6,
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text strong>Task #{data.task_id}</Text>
                {data.scenario && (
                  <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
                    시나리오 {data.scenario}
                  </Tag>
                )}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {data.current_seq + 1} / {data.steps.length} 스텝
              </Text>
            </div>
            {data.summary && (
              <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                <div>
                  <span style={{ color: '#999' }}>출발:</span> {data.summary.source || '-'}
                </div>
                <div>
                  <span style={{ color: '#999' }}>도착:</span> {data.summary.target || '-'}
                </div>
                <div>
                  <span style={{ color: '#999' }}>수량:</span> 픽업 {data.summary.pickup_count ?? 0}개 → 하역 {data.summary.dropoff_count ?? 0}개
                </div>
              </div>
            )}
            <Progress 
              percent={Math.round(((data.current_seq + 1) / data.steps.length) * 100)} 
              size="small" 
              status={data.paused ? 'exception' : 'active'}
              showInfo={false}
            />
          </div>

          <div 
            ref={containerRef}
            style={{ 
              flex: 1, 
              overflowY: 'auto', 
              overflowX: 'hidden',
              marginBottom: 12,
              paddingRight: 4,
            }}
          >
            {data.steps.map((step, index) => (
              <StepItem
                key={`${data.task_id}-${step.seq}`}
                step={step}
                isCurrentStep={step.seq === data.current_seq}
                isCompleted={step.seq < data.current_seq}
                isLast={index === data.steps.length - 1}
                initialExpanded={expandedStepsRef.current.has(step.seq)}
                onExpandChange={handleExpandChange}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {data.paused ? (
              <Button
                size="small"
                type="primary"
                onClick={handleRestart}
                icon={<ReloadOutlined />}
                style={{ flex: 1, fontSize: '12px' }}
              >
                재시작
              </Button>
            ) : (
              <Button
                size="small"
                onClick={handlePause}
                icon={<PauseCircleOutlined />}
                style={{ flex: 1, fontSize: '12px' }}
              >
                일시정지
              </Button>
            )}
            <Button
              danger
              size="small"
              onClick={handleCancelWithPassword}
              icon={<StopOutlined />}
              style={{ flex: 1, fontSize: '12px' }}
            >
              취소
            </Button>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="현재 태스크 없음" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}
    </Card>
  );
}, (prevProps, nextProps) => prevProps.amrId === nextProps.amrId);

export default function AMRStatus() {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [addVisible, setAddVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedAmr, setSelectedAmr] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [form] = Form.useForm();
  const [robotSettingsForm] = Form.useForm();
  const [armState, setArmState] = useState(null);
  const [armStateLoading, setArmStateLoading] = useState(false);
  
  // 패스워드 확인 훅 추가
  const passwordConfirm = usePasswordConfirm();
  
  // 선택된 지도 정보
  const selectedMap = useAtomValue(selectedMapAtom);

  // AMR 상태 결정 함수 (메모이제이션)
  const getAmrStatus = useCallback((amr) => {
    // 연결 끊김 상태를 최우선으로 확인
    if (amr.status === '연결 끊김') {
      return '연결 끊김';
    }
    
    // additional_info에서 상태 확인
    let additionalInfo = {};
    try {
      additionalInfo = typeof amr.additional_info === 'string' 
        ? JSON.parse(amr.additional_info) 
        : amr.additional_info || {};
    } catch (e) {
      // JSON 파싱 실패 시 빈 객체 사용
    }
    
    // 비상정지 상태 (최우선)
    if (additionalInfo.emergency === true) {
      return '비상정지';
    }
    
    // 에러가 있는 경우
    if (Array.isArray(additionalInfo.errors) && additionalInfo.errors.length > 0) {
      return '오류';
    }
    
    // DI 센서 11번이 true이면 '수동' 상태로 표시
    const diSensors = additionalInfo.diSensors || [];
    const sensor11 = diSensors.find(s => s.id === 11);
    if (sensor11?.status === true) {
      return '수동';
    }
    
    // charging이 true이면 '충전' 상태로 표시
    if (additionalInfo.charging === true) {
      return '충전';
    }
    
    // 기존 상태 반환
    return amr.status || 'unknown';
  }, []);

  // AMR 리스트 (robotsQueryAtom 사용)
  const robotsQuery = useAtomValue(robotsQueryAtom);
  const amrs = robotsQuery.data ?? [];
  const isLoading = robotsQuery.isLoading;

  // 모달이 열려있을 때 selectedAmr 실시간 업데이트
  useEffect(() => {
    if (detailVisible && selectedAmr && amrs.length > 0) {
      const updatedAmr = amrs.find(amr => amr.id === selectedAmr.id);
      if (updatedAmr) {
        setSelectedAmr(updatedAmr);
        
        // AMR 상태가 '대기'로 변경되었다면 현재 태스크 쿼리 캐시를 null로 설정하고 무효화
        const currentStatus = getAmrStatus(updatedAmr);
        const previousStatus = getAmrStatus(selectedAmr);
        if (previousStatus !== '대기' && currentStatus === '대기') {
          console.log(`[AMRStatus] ${updatedAmr.name}: 상태가 '대기'로 변경됨, 태스크 캐시 초기화`);
          // 즉시 캐시를 null로 설정
          qc.setQueryData(["currentTask", updatedAmr.id], null);
          qc.invalidateQueries(["currentTask", updatedAmr.id]);
          // 연속으로 무효화하여 확실히 처리
          setTimeout(() => {
            qc.setQueryData(["currentTask", updatedAmr.id], null);
            qc.invalidateQueries(["currentTask", updatedAmr.id]);
          }, 200);
          setTimeout(() => {
            qc.invalidateQueries(["currentTask", updatedAmr.id]);
          }, 500);
        }
      }
    }
  }, [amrs, detailVisible, selectedAmr?.id, getAmrStatus, qc]);

  // 로봇 팔(Doosan) 상태 조회
  useEffect(() => {
    if (!detailVisible || !selectedAmr?.id) {
      setArmState(null);
      return;
    }
    
    const fetchArmState = async () => {
      setArmStateLoading(true);
      try {
        const r = await fetch(`${API}/api/robots/${selectedAmr.id}/arm-state`);
        if (r.ok) {
          const data = await r.json();
          setArmState(data);
        } else {
          setArmState(null);
        }
      } catch {
        setArmState(null);
      } finally {
        setArmStateLoading(false);
      }
    };
    
    fetchArmState();
    const interval = setInterval(fetchArmState, 2000); // 2초마다 갱신
    return () => clearInterval(interval);
  }, [detailVisible, selectedAmr?.id]);

  // 2) AMR 추가
  const addMut = useMutation({
    mutationFn: async (body) => {
      const r = await fetch(`${API}/api/robots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("추가 실패");
    },
    onSuccess: () => {
      messageApi.success("추가 완료");
      qc.invalidateQueries(["robots"]);
      setAddVisible(false);
    },
    onError: () => messageApi.error("추가 실패"),
  });

  // 3) AMR 삭제
  const deleteMut = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API}/api/robots/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("삭제 실패");
    },
    onSuccess: () => {
      messageApi.success("삭제 완료");
      qc.invalidateQueries(["robots"]);
    },
    onError: () => messageApi.error("삭제 실패"),
  });

  // 4) AMR 충전
  const chargeMut = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${API}/api/robots/${id}/sendtocharge`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robotId: id })
      });
      if (!r.ok) throw new Error("충전 명령 실패");
    },
    onSuccess: () => {
      messageApi.success("충전 명령 전송 완료");
      qc.invalidateQueries(["robots"]);
    },
    onError: () => messageApi.error("충전 명령 실패"),
  });

  /**
   * slots 저장 포맷(호환)
   * - 신규: JSON 문자열로 [{ slot_no: number, product_type: number }, ...] (sparse)
   * - 구형: JSON 문자열로 [0,1,2,...] (dense)
   */
  const parseSlotsEntries = useCallback((raw) => {
    if (raw == null) return [];
    let v = raw;
    try {
      if (typeof v === "string") v = JSON.parse(v);
    } catch {
      return [];
    }

    // 신규: 엔트리 배열
    if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] !== null) {
      return v
        .map((x) => ({
          slot_no: Number(x?.slot_no),
          product_type: Number(x?.product_type) || 0,
        }))
        .filter((x) => Number.isFinite(x.slot_no) && x.slot_no >= 1);
    }

    // 구형: dense 배열 → product_type != 0 만 엔트리로 (불필요한 0 슬롯 폭증 방지)
    if (Array.isArray(v)) {
      return v
        .map((pv, idx) => ({
          slot_no: idx + 1,
          product_type: Number(pv) || 0,
        }))
        .filter((x) => x.product_type !== 0);
    }

    return [];
  }, []);

  // 선택된 맵의 스테이션 목록(홈/충전 스테이션 선택용)
  const mapStations = useMemo(() => {
    try {
      const stations = safeParse(selectedMap?.stations).stations ?? [];
      return Array.isArray(stations) ? stations : [];
    } catch {
      return [];
    }
  }, [selectedMap]);

  const stationOptions = useMemo(() => {
    return mapStations.map((s) => {
      const id = String(s.id ?? "");
      const name = s.name ?? id;
      return {
        value: id,
        label: `${name} (#${id})`,
        search: `${name} ${id}`.toLowerCase(),
      };
    });
  }, [mapStations]);

  const resolveStationLabel = useCallback(
    (val) => {
      if (!val) return "-";
      const key = String(val);
      const st =
        mapStations.find((s) => String(s.id) === key) ||
        mapStations.find((s) => String(s.name) === key);
      if (!st) return key;
      const id = String(st.id ?? key);
      const name = st.name ?? id;
      return `${name} (#${id})`;
    },
    [mapStations]
  );

  // 로봇 설정 저장 (home_station / charge_station / slots)
  const robotSettingsMut = useMutation({
    mutationFn: async ({ id, patch }) => {
      const r = await fetch(`${API}/api/robots/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        throw new Error(msg || `저장 실패 (HTTP ${r.status})`);
      }
      return r.json().catch(() => null);
    },
    onSuccess: (updated) => {
      messageApi.success("로봇 설정 저장 완료");
      // 모달이 닫혔다가 다시 열려도 최신값이 보이도록 로컬 상태도 동기화
      if (updated && selectedAmr && updated.id === selectedAmr.id) {
        setSelectedAmr(updated);
        robotSettingsForm.setFieldsValue({
          home_station: updated?.home_station ?? undefined,
          home_pre_station: updated?.home_pre_station ?? undefined,
          charge_station: updated?.charge_station ?? undefined,
          charge_pre_station: updated?.charge_pre_station ?? undefined,
          slots: parseSlotsEntries(updated?.slots).sort((a, b) => a.slot_no - b.slot_no),
        });
      }
      qc.invalidateQueries(["robots"]);
    },
    onError: (e) => messageApi.error(e?.message || "로봇 설정 저장 실패"),
  });

  const showAdd = () => {
    form.resetFields();
    setAddVisible(true);
  };
  const handleAdd = () =>
    form.validateFields().then((vals) =>
      addMut.mutate({
        name: vals.id,
        ip: vals.ip,
        battery: 100,
        status: "대기",
        additional_info: "",
      })
    );
  const showDetail = (amr) => {
    setSelectedAmr(amr);
    robotSettingsForm.setFieldsValue({
      home_station: amr?.home_station ?? undefined,
      home_pre_station: amr?.home_pre_station ?? undefined,
      charge_station: amr?.charge_station ?? undefined,
      charge_pre_station: amr?.charge_pre_station ?? undefined,
      slots: parseSlotsEntries(amr?.slots).sort((a, b) => a.slot_no - b.slot_no),
    });
    setDetailVisible(true);
  };

  const handleDetailClose = () => {
    setDetailVisible(false);
    setSelectedAmr(null);
  };

  // 스테이션 ID로 스테이션 정보 찾기
  const getStationInfo = useCallback((stationId) => {
    if (!selectedMap || !selectedMap.stations || !stationId) return null;
    try {
      const stations = safeParse(selectedMap.stations).stations ?? [];
      const station = stations.find(st => String(st.id) === String(stationId));
      return station || null;
    } catch (error) {
      console.warn('Failed to parse station info:', error);
      return null;
    }
  }, [selectedMap]);

  // 충전 버튼 활성화 조건 확인
  const isChargeEnabled = useCallback((amr) => {
    if (!amr || !amr.location) return false;
    const station = getStationInfo(amr.location);
    if (!station) return false;
    
    const chargeStations = ['B1', 'B2', 'B3'];
    
    // 스테이션 이름으로 확인
    const stationName = station.name;
    let isEnabled = chargeStations.includes(stationName);
    
    // 스테이션 클래스로도 확인
    if (!isEnabled) {
      const classes = Array.isArray(station.class)
        ? station.class
        : Array.isArray(station.classList)
        ? station.classList
        : station.class
        ? [station.class]
        : [];
      
      isEnabled = classes.some(cls => chargeStations.includes(cls));
    }
    
    // 디버깅을 위한 로그
    console.log(`[ChargeButton] AMR: ${amr.name}, Location ID: ${amr.location}, Station:`, station, `Enabled: ${isEnabled}`);
    
    return isEnabled;
  }, [getStationInfo]);

  // 충전 명령 실행
  const handleCharge = () => {
    if (!selectedAmr) return;
    chargeMut.mutate(selectedAmr.id);
  };

  // 패스워드 확인 후 AMR 삭제
  const handleDeleteWithPassword = () => {
    if (!selectedAmr) return;
    
    passwordConfirm.showPasswordConfirm(
      () => {
        deleteMut.mutate(selectedAmr.id);
      },
      {
        title: "AMR 삭제 확인",
        description: `관리자 비밀번호가 필요합니다.\n\nAMR "${selectedAmr.name}"을(를) 삭제하시겠습니까?`
      }
    );
  };

  const handleSaveRobotSettingsWithPassword = () => {
    if (!selectedAmr) return;

    passwordConfirm.showPasswordConfirm(
      () => {
        robotSettingsForm
          .validateFields()
          .then((vals) => {
            const entries = Array.isArray(vals.slots) ? vals.slots : [];
            const cleaned = entries
              .map((x) => ({
                slot_no: Number(x?.slot_no),
                product_type: Number(x?.product_type) || 0,
              }))
              .filter((x) => Number.isFinite(x.slot_no) && x.slot_no >= 1);

            const patch = {
              home_station: vals.home_station || null,
              home_pre_station: vals.home_pre_station || null,
              charge_station: vals.charge_station || null,
              charge_pre_station: vals.charge_pre_station || null,
              // sparse 저장: slot_no 기반 엔트리만 저장 (0도 "빈 슬롯"으로 의미 있으므로 유지)
              slots: JSON.stringify(
                cleaned
                  .sort((a, b) => a.slot_no - b.slot_no)
              ),
            };
            robotSettingsMut.mutate({ id: selectedAmr.id, patch });
          })
          .catch(() => {});
      },
      {
        title: "로봇 설정 저장",
        description: `관리자 비밀번호가 필요합니다.\n\nAMR "${selectedAmr.name}"의 설정을 저장하시겠습니까?`,
      }
    );
  };

  // 화물 상태 확인 함수 (메모이제이션)
  const getCargoStatus = useCallback((amr) => {
    let additionalInfo = {};
    try {
      additionalInfo = typeof amr.additional_info === 'string' 
        ? JSON.parse(amr.additional_info) 
        : amr.additional_info || {};
    } catch (e) {
      return { hasCargo: false, sensors: [] };
    }
    
    const diSensors = additionalInfo.diSensors || [];
    const sensor4 = diSensors.find(s => s.id === 4);
    const sensor5 = diSensors.find(s => s.id === 5);
    
    const hasCargo = sensor4?.status === true && sensor5?.status === true;
    
    return {
      hasCargo,
      sensors: diSensors,
      sensor4Status: sensor4?.status || false,
      sensor5Status: sensor5?.status || false
    };
  }, []);

  // JSON 포맷팅 함수
  const formatJsonForDisplay = useCallback((jsonString) => {
    try {
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return jsonString || "없음";
    }
  }, []);

  // ──────────────────────────────────────────────────────────────
  // TaskSteps 컴포넌트 - 완전 수동 fetch (자동 새로고침 없음)
  const _CurrentTaskStepsInner = React.memo(({ amr }) => {
    // ═══════════════════════════════════════════════════════════
    // 상태: 데이터 + 로딩
    // ═══════════════════════════════════════════════════════════
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const expandedStepsRef = useRef(new Set());
    const containerRef = useRef(null);
    const taskIdRef = useRef(null); // 현재 task_id 추적
    
    // ═══════════════════════════════════════════════════════════
    // 수동 Fetch 함수
    // ═══════════════════════════════════════════════════════════
    const fetchTask = useCallback(async () => {
      if (!amr?.id) return;
      setIsLoading(true);
      try {
        const r = await fetch(`${API}/api/robots/${amr.id}/current-task`);
        if (r.status === 204 || r.status === 404) {
          setData(null);
          taskIdRef.current = null;
          return;
        }
        if (!r.ok) throw new Error(`status: ${r.status}`);
        const taskData = await r.json();
        if (!taskData?.steps?.length) {
          setData(null);
          taskIdRef.current = null;
          return;
        }
        taskIdRef.current = taskData.task_id;
        setData(taskData);
      } catch {
        setData(null);
        taskIdRef.current = null;
      } finally {
        setIsLoading(false);
      }
    }, [amr?.id]);
    
    // 최초 마운트 시 한 번만 fetch
    useEffect(() => {
      fetchTask();
    }, [fetchTask]);
    
    // 확장 상태 변경 핸들러
    const handleExpandChange = useCallback((seq, expanded) => {
      if (expanded) {
        expandedStepsRef.current.add(seq);
      } else {
        expandedStepsRef.current.delete(seq);
      }
    }, []);
    
    // ═══════════════════════════════════════════════════════════
    // 일시정지/재시작/취소 (수동 fetch 후 상태 갱신)
    // ═══════════════════════════════════════════════════════════
    const handlePause = useCallback(async () => {
      if (!taskIdRef.current) return;
      try {
        await fetch(`${API}/api/tasks/${taskIdRef.current}/pause`, { method: "PUT" });
        message.success("일시정지");
        fetchTask();
      } catch {
        message.error("일시정지 실패");
      }
    }, [fetchTask]);
    
    const handleRestart = useCallback(async () => {
      if (!taskIdRef.current) return;
      try {
        await fetch(`${API}/api/tasks/${taskIdRef.current}/restart`, { method: "PUT" });
        message.success("재시작");
        fetchTask();
      } catch {
        message.error("재시작 실패");
      }
    }, [fetchTask]);
    
    const handleCancel = useCallback(async () => {
      if (!taskIdRef.current) return;
      try {
        await fetch(`${API}/api/tasks/${taskIdRef.current}`, { method: "DELETE" });
        message.success("취소");
        setData(null);
        taskIdRef.current = null;
      } catch {
        message.error("취소 실패");
      }
    }, []);

    const handleCancelWithPassword = useCallback(() => {
      passwordConfirm.showPasswordConfirm(
        () => handleCancel(),
        {
          title: "태스크 취소 확인",
          description: `관리자 비밀번호가 필요합니다.\n\nAMR "${amr?.name}"의 태스크를 취소하시겠습니까?`
        }
      );
    }, [amr?.name, handleCancel, passwordConfirm]);

    // ═══════════════════════════════════════════════════════════
    // 렌더링
    // ═══════════════════════════════════════════════════════════
    return (
      <Card
        size="small"
        bordered
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>현재 태스크</span>
            {data && (
              <Tag 
                color={data.paused ? 'orange' : 'blue'} 
                icon={data.paused ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                style={{ fontSize: '11px' }}
              >
                {data.paused ? '일시정지' : '실행중'}
              </Tag>
            )}
          </div>
        }
        extra={
          <Tooltip title="새로고침">
            <Button
              size="small"
              icon={<ReloadOutlined spin={isLoading} />}
              onClick={fetchTask}
              disabled={isLoading}
            />
          </Tooltip>
        }
        bodyStyle={{ padding: 12, height: 'calc(100% - 46px)', display: 'flex', flexDirection: 'column' }}
        style={{ width: '100%', height: '100%' }}
      >
        {data?.steps?.length > 0 ? (
          <>
            {/* 태스크 요약 */}
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: '#f5f5f5', 
              borderRadius: 6,
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text strong>Task #{data.task_id}</Text>
                  {data.scenario && (
                    <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
                      시나리오 {data.scenario}
                    </Tag>
                  )}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.current_seq + 1} / {data.steps.length} 스텝
                </Text>
              </div>
              {data.summary && (
                <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
                  <div>
                    <span style={{ color: '#999' }}>출발:</span> {data.summary.source || '-'}
                  </div>
                  <div>
                    <span style={{ color: '#999' }}>도착:</span> {data.summary.target || '-'}
                  </div>
                  <div>
                    <span style={{ color: '#999' }}>수량:</span> 픽업 {data.summary.pickup_count ?? 0}개 → 하역 {data.summary.dropoff_count ?? 0}개
                  </div>
                </div>
              )}
              <Progress 
                percent={Math.round(((data.current_seq + 1) / data.steps.length) * 100)} 
                size="small" 
                status={data.paused ? 'exception' : 'active'}
                showInfo={false}
              />
            </div>

            {/* 스텝 목록 */}
            <div 
              ref={containerRef}
              style={{ 
                flex: 1, 
                overflowY: 'auto', 
                overflowX: 'hidden',
                marginBottom: 12,
                paddingRight: 4,
              }}
            >
              {data.steps.map((step, index) => (
                <StepItem
                  key={`${data.task_id}-${step.seq}`}
                  step={step}
                  isCurrentStep={step.seq === data.current_seq}
                  isCompleted={step.seq < data.current_seq}
                  isLast={index === data.steps.length - 1}
                  initialExpanded={expandedStepsRef.current.has(step.seq)}
                  onExpandChange={handleExpandChange}
                />
              ))}
            </div>

            {/* 제어 버튼 */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {data.paused ? (
                <Button
                  size="small"
                  type="primary"
                  onClick={handleRestart}
                  icon={<ReloadOutlined />}
                  style={{ flex: 1, fontSize: '12px' }}
                >
                  재시작
                </Button>
              ) : (
                <Button
                  size="small"
                  onClick={handlePause}
                  icon={<PauseCircleOutlined />}
                  style={{ flex: 1, fontSize: '12px' }}
                >
                  일시정지
                </Button>
              )}
              <Button
                danger
                size="small"
                onClick={handleCancelWithPassword}
                icon={<StopOutlined />}
                style={{ flex: 1, fontSize: '12px' }}
              >
                취소
              </Button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="현재 태스크 없음" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </Card>
    );
  });

  // ──────────────────────────────────────────────────────────────
  // 메인 렌더
  return (
    <>
      {contextHolder}

      <Card
        size="small"
        bordered={false}
        bodyStyle={{ padding: token.padding, overflowX: "auto" }}
      >
        {isLoading ? (
          <Text type="danger">AMR 목록 조회 중...</Text>
        ) : (
          <Space
            wrap
            size={token.paddingSM}
            split={<Divider type="vertical" />}
          >
            {amrs.map((amr) => {
              // 상태별 테두리 색상 매핑
              const status = getAmrStatus(amr);
              let borderColor;
              switch(status) {
                case '이동':
                  borderColor = token.colorInfo;
                  break;
                case '작업 중':
                  borderColor = '#13c2c2';
                  break;
                case '대기':
                  borderColor = token.colorSuccess;
                  break;
                case '충전':
                  borderColor = token.colorWarning;
                  break;
                case '수동':
                  borderColor = token.colorTextSecondary;
                  break;
                case '오류':
                  borderColor = token.colorError;
                  break;
                case '비상정지':
                  borderColor = '#eb2f96'; // magenta
                  break;
                case '연결 끊김':
                  borderColor = token.colorTextSecondary;
                  break;
                default:
                  borderColor = token.colorBorder;
              }
              
              const hover = hoveredId === amr.id;
              return (
                <Button
                  key={amr.id}
                  type="text"
                  ghost
                  onClick={() => showDetail(amr)}
                  onMouseEnter={() => setHoveredId(amr.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    border: `1px solid ${borderColor}`,
                    boxShadow: token.boxShadowSecondary,
                    height: token.controlHeightSM,
                    borderRadius: token.borderRadius,
                    padding: `${token.padding}px ${token.paddingSM}px`,
                    transform: hover ? "scale(1.05)" : undefined,
                    transition: "transform 0.2s",
                  }}
                >
                  <Badge
                    status={STATUS_BADGE[status]}
                    style={{ marginRight: token.marginXXS }}
                  />
                  <span
                    style={{
                      fontWeight: token.fontWeightStrong,
                      marginRight: token.marginXXS,
                    }}
                  >
                    {amr.name}
                  </span>
                  <Tag size="small" color={STATUS_TAG_COLOR[status]}>
                    {status}
                  </Tag>
                </Button>
              );
            })}
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={showAdd}
              style={{ boxShadow: token.boxShadowSecondary }}
            ></Button>
          </Space>
        )}
      </Card>

      {/* 추가 모달 */}
      <Modal
        title="새 AMR 추가"
        open={addVisible}
        onOk={handleAdd}
        okButtonProps={{ loading: addMut.isLoading }}
        onCancel={() => setAddVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="id"
            label="AMR ID"
            rules={[{ required: true, message: "ID를 입력하세요" }]}
          >
            <Input placeholder="AMR1" />
          </Form.Item>
          <Form.Item
            name="ip"
            label="IP 주소"
            rules={[{ required: true, message: "IP를 입력하세요" }]}
          >
            <Input placeholder="192.168.0.10" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 상세 모달 - 고정 높이 적용 */}
      <Modal
        title={`AMR 상세 – ${selectedAmr?.name}`}
        open={detailVisible}
        onCancel={handleDetailClose}
        width={900}
        style={{ top: 20 }} // 상단 여백 추가
        bodyStyle={{ 
          maxHeight: 'calc(100vh - 200px)', 
          overflowY: 'auto',
          padding: 24
        }}
        footer={[
          <Button
            key="save"
            type="primary"
            icon={<SaveOutlined />}
            loading={robotSettingsMut.isLoading}
            onClick={handleSaveRobotSettingsWithPassword}
          >
            저장
          </Button>,
          <Button
            key="del"
            danger
            icon={<DeleteOutlined />}
            loading={deleteMut.isLoading}
            onClick={handleDeleteWithPassword}
          >
            삭제
          </Button>,
          <Tooltip 
            title={!isChargeEnabled(selectedAmr) ? 
              `AMR이 B1, B2, B3 스테이션에 위치하고 있지 않습니다${selectedAmr?.location ? ` (현재: ${selectedAmr.location})` : ''}` : null
            }
            placement="top"
          >
            <Button
              key="charge"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={chargeMut.isLoading}
              disabled={!isChargeEnabled(selectedAmr)}
              onClick={handleCharge}
              style={{ 
                backgroundColor: isChargeEnabled(selectedAmr) ? '#faad14' : undefined,
                borderColor: isChargeEnabled(selectedAmr) ? '#faad14' : undefined
              }}
            >
              충전
            </Button>
          </Tooltip>,
          <Button key="close" onClick={handleDetailClose}>
            닫기
          </Button>,
        ]}
      >
        {selectedAmr && (
          <div style={{ display: "flex", gap: 24, height: "calc(100vh - 280px)", minHeight: 450 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Tabs
                defaultActiveKey="summary"
                style={{ flex: 1, display: "flex", flexDirection: "column" }}
                items={[
                  {
                    key: "summary",
                    label: "요약",
                    children: (
                      <>
                      <Descriptions
                        bordered
                        size="small"
                        column={2}
                        labelStyle={{ width: 120 }}
                      >
                        <Descriptions.Item label="ID">{selectedAmr.id}</Descriptions.Item>
                        <Descriptions.Item label="이름">{selectedAmr.name}</Descriptions.Item>
                        <Descriptions.Item label="IP">{selectedAmr.ip}</Descriptions.Item>
                        <Descriptions.Item label="상태">
                          <Tag color={STATUS_TAG_COLOR[getAmrStatus(selectedAmr)]}>
                            {getAmrStatus(selectedAmr)}
                          </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="위치">{selectedAmr.location || "-"}</Descriptions.Item>
                        <Descriptions.Item label="목적지">{selectedAmr.destination || "-"}</Descriptions.Item>
                        <Descriptions.Item label="작업 단계">{selectedAmr.task_step || "-"}</Descriptions.Item>
                        <Descriptions.Item label="다음 위치">{selectedAmr.next_location || "-"}</Descriptions.Item>

                        <Descriptions.Item label="HOME">{selectedAmr.home_station || "-"}</Descriptions.Item>
                        <Descriptions.Item label="충전">{selectedAmr.charge_station || "-"}</Descriptions.Item>

                        <Descriptions.Item label="배터리" span={2}>
                          <Space>
                            <Progress
                              type="circle"
                              percent={selectedAmr.battery - 10}
                              width={40}
                              status={selectedAmr.battery - 10 < 20 ? "exception" : "normal"}
                            />
                            <Text>{selectedAmr.battery - 10}%</Text>
                          </Space>
                        </Descriptions.Item>

                        <Descriptions.Item label="슬롯" span={2}>
                          <Space wrap>
                            {parseSlotsEntries(selectedAmr.slots).length ? (
                              [...parseSlotsEntries(selectedAmr.slots)]
                                .sort((a, b) => a.slot_no - b.slot_no)
                                .map((s) => (
                                  <Tag key={s.slot_no} color={s.product_type ? "blue" : "default"}>
                                    #{s.slot_no}: {s.product_type}
                                  </Tag>
                                ))
                            ) : (
                              <Text type="secondary">없음</Text>
                            )}
                          </Space>
                        </Descriptions.Item>
                      </Descriptions>
                      
                      {/* 로봇 팔 상태 */}
                      <div style={{ marginTop: 16, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <Text strong style={{ fontSize: 13, color: '#1f1f1f' }}>로봇 팔 (Doosan)</Text>
                          {armStateLoading && <Text type="secondary" style={{ fontSize: 11 }}>갱신 중...</Text>}
                        </div>
                        {armState ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {/* 상태 행 */}
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: '#8c8c8c' }}>태스크</span>
                                <Tag 
                                  color={armState.TASK_STATUS === '0' ? 'default' : 'processing'} 
                                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
                                >
                                  {armState.TASK_STATUS}
                                </Tag>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: '#8c8c8c' }}>상태</span>
                                <Tag 
                                  color={armState.ROBOT_STATUS === '0' ? 'success' : 'warning'} 
                                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
                                >
                                  {armState.ROBOT_STATUS}
                                </Tag>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: '#8c8c8c' }}>에러</span>
                                <Tag 
                                  color={armState.ROBOT_ERROR === '0' ? 'default' : 'error'} 
                                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
                                >
                                  {armState.ROBOT_ERROR}
                                </Tag>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: '#8c8c8c' }}>비전</span>
                                <Tag 
                                  color={armState.VISION_ERROR === '0' ? 'default' : 'error'} 
                                  style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
                                >
                                  {armState.VISION_ERROR}
                                </Tag>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, color: '#8c8c8c' }}>FROM→TO</span>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#262626' }}>
                                  {armState.ROBOT_CMD_FROM}→{armState.ROBOT_CMD_TO}
                                </span>
                              </div>
                            </div>
                            
                            {/* 관절 데이터 테이블 */}
                            <div style={{ 
                              display: 'grid', 
                              gridTemplateColumns: 'auto repeat(6, 1fr)', 
                              gap: 0,
                              fontSize: 11,
                              border: '1px solid #e8e8e8',
                              borderRadius: 4,
                              overflow: 'hidden',
                              background: '#fff'
                            }}>
                              {/* 헤더 */}
                              <div style={{ padding: '6px 10px', background: '#f5f5f5', borderBottom: '1px solid #e8e8e8', fontWeight: 500, color: '#595959' }}></div>
                              {[1,2,3,4,5,6].map(i => (
                                <div key={i} style={{ padding: '6px 8px', background: '#f5f5f5', borderBottom: '1px solid #e8e8e8', borderLeft: '1px solid #e8e8e8', textAlign: 'center', fontWeight: 500, color: '#595959' }}>
                                  J{i}
                                </div>
                              ))}
                              
                              {/* 온도 행 */}
                              <div style={{ padding: '6px 10px', borderBottom: '1px solid #e8e8e8', color: '#8c8c8c' }}>온도</div>
                              {[1,2,3,4,5,6].map(i => {
                                const temp = parseInt(armState[`JOINT_MOTOR_TEMPERATURE_${i}`] || '0', 10);
                                const color = temp > 50 ? '#ff4d4f' : temp > 40 ? '#faad14' : '#389e0d';
                                return (
                                  <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid #e8e8e8', borderLeft: '1px solid #e8e8e8', textAlign: 'center', fontFamily: 'monospace', color, fontWeight: 500 }}>
                                    {temp}°
                                  </div>
                                );
                              })}
                              
                              {/* 위치 행 */}
                              <div style={{ padding: '6px 10px', borderBottom: '1px solid #e8e8e8', color: '#8c8c8c' }}>위치</div>
                              {[1,2,3,4,5,6].map(i => (
                                <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid #e8e8e8', borderLeft: '1px solid #e8e8e8', textAlign: 'center', fontFamily: 'monospace', color: '#262626' }}>
                                  {armState[`JOINT_POSITION_${i}`]}
                                </div>
                              ))}
                              
                              {/* 토크 행 */}
                              <div style={{ padding: '6px 10px', borderBottom: '1px solid #e8e8e8', color: '#8c8c8c' }}>토크</div>
                              {[1,2,3,4,5,6].map(i => (
                                <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid #e8e8e8', borderLeft: '1px solid #e8e8e8', textAlign: 'center', fontFamily: 'monospace', color: '#262626' }}>
                                  {armState[`JOINT_TORQUE_${i}`]}
                                </div>
                              ))}
                              
                              {/* 전류 행 */}
                              <div style={{ padding: '6px 10px', color: '#8c8c8c' }}>전류</div>
                              {[1,2,3,4,5,6].map(i => (
                                <div key={i} style={{ padding: '6px 8px', borderLeft: '1px solid #e8e8e8', textAlign: 'center', fontFamily: 'monospace', color: '#262626' }}>
                                  {armState[`JOINT_MOTOR_CURRENT_${i}`]}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>로봇 팔 상태를 가져올 수 없습니다</Text>
                        )}
                      </div>
                      </>
                    ),
                  },
                  {
                    key: "settings",
                    label: "설정(수정)",
                    children: (
                      <Form form={robotSettingsForm} layout="vertical">
                        <Form.Item name="home_station" label="HOME 스테이션(현재 맵)">
                          <Select
                            allowClear
                            showSearch
                            placeholder="스테이션 선택 또는 검색"
                            options={stationOptions}
                            filterOption={(input, option) =>
                              (option?.search ?? option?.label ?? "")
                                .toString()
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                        <Form.Item name="home_pre_station" label="HOME_PRE 스테이션(현재 맵)">
                          <Select
                            allowClear
                            showSearch
                            placeholder="스테이션 선택 또는 검색"
                            options={stationOptions}
                            filterOption={(input, option) =>
                              (option?.search ?? option?.label ?? "")
                                .toString()
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                        <Form.Item name="charge_station" label="충전 스테이션(현재 맵)">
                          <Select
                            allowClear
                            showSearch
                            placeholder="스테이션 선택 또는 검색"
                            options={stationOptions}
                            filterOption={(input, option) =>
                              (option?.search ?? option?.label ?? "")
                                .toString()
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                        <Form.Item name="charge_pre_station" label="충전_PRE 스테이션(현재 맵)">
                          <Select
                            allowClear
                            showSearch
                            placeholder="스테이션 선택 또는 검색"
                            options={stationOptions}
                            filterOption={(input, option) =>
                              (option?.search ?? option?.label ?? "")
                                .toString()
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>

                        <Form.List name="slots">
                          {(fields, { add, remove }) => {
                            const handleAdd = () => {
                              const cur = robotSettingsForm.getFieldValue("slots") || [];
                              const used = new Set(cur.map((x) => Number(x?.slot_no)).filter((n) => Number.isFinite(n)));
                              let next = 1;
                              while (used.has(next)) next += 1;
                              add({ slot_no: next, product_type: 0 });
                            };

                            return (
                              <>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text strong>슬롯</Text>
                                  <Button size="small" icon={<PlusOutlined />} onClick={handleAdd}>
                                    슬롯 추가
                                  </Button>
                                </div>
                                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                                  {fields.map((field) => (
                                    <div key={field.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <Form.Item
                                        name={[field.name, "slot_no"]}
                                        style={{ margin: 0, width: 110 }}
                                        rules={[
                                          { required: true, message: "번호" },
                                          {
                                            validator: async (_, value) => {
                                              const v = Number(value);
                                              if (!Number.isFinite(v) || v < 1) throw new Error("1 이상");
                                              const all = robotSettingsForm.getFieldValue("slots") || [];
                                              const nums = all
                                                .map((x) => Number(x?.slot_no))
                                                .filter((n) => Number.isFinite(n));
                                              const count = nums.filter((n) => n === v).length;
                                              if (count > 1) throw new Error("중복");
                                            },
                                          },
                                        ]}
                                      >
                                        <InputNumber min={1} precision={0} style={{ width: "100%" }} placeholder="슬롯 번호" />
                                      </Form.Item>

                                      <Form.Item
                                        name={[field.name, "product_type"]}
                                        style={{ margin: 0, flex: 1 }}
                                      >
                                        <Select
                                          options={[
                                            { label: "0 (비어있음)", value: 0 },
                                            { label: "1 (제품 타입 1)", value: 1 },
                                            { label: "2 (제품 타입 2)", value: 2 },
                                          ]}
                                        />
                                      </Form.Item>

                                      <Button
                                        size="small"
                                        danger
                                        icon={<MinusCircleOutlined />}
                                        onClick={() => remove(field.name)}
                                      />
                                    </div>
                                  ))}
                                  {!fields.length && (
                                    <Text type="secondary">슬롯이 없습니다. “슬롯 추가”를 눌러 생성하세요.</Text>
                                  )}
                                </div>
                              </>
                            );
                          }}
                        </Form.List>
                      </Form>
                    ),
                  },
                  {
                    key: "json",
                    label: "추가정보(JSON)",
                    children: (
                      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        <div
                          style={{
                            flex: 1,
                            minHeight: 0,
                            overflow: "auto",
                            background: "#1a1a2e",
                            borderRadius: 8,
                            padding: 16,
                          }}
                        >
                          <pre
                            style={{
                              margin: 0,
                              color: "#a9b7c6",
                              fontSize: 12,
                              lineHeight: 1.7,
                              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {formatJsonForDisplay(selectedAmr.additional_info)}
                          </pre>
                        </div>
                        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                          <Button
                            icon={<CopyOutlined />}
                            onClick={() => {
                              navigator.clipboard.writeText(formatJsonForDisplay(selectedAmr.additional_info));
                              message.success("클립보드에 복사됨");
                            }}
                          >
                            JSON 복사
                          </Button>
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </div>

            <div style={{ width: 350, flexShrink: 0, overflow: "auto" }}>
              <CurrentTaskSteps
                amrId={selectedAmr?.id}
                amrName={selectedAmr?.name}
                passwordConfirm={passwordConfirm}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 패스워드 확인 모달 */}
      <PasswordConfirm
        visible={passwordConfirm.isVisible}
        onConfirm={passwordConfirm.handleConfirm}
        onCancel={passwordConfirm.handleCancel}
        {...passwordConfirm.modalProps}
      />
    </>
  );
}
