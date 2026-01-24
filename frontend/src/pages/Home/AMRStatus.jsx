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
          charge_station: updated?.charge_station ?? undefined,
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
      charge_station: amr?.charge_station ?? undefined,
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
              charge_station: vals.charge_station || null,
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
  // TaskSteps 컴포넌트 - 별도 컴포넌트로 분리하여 불필요한 리렌더링 방지
  const CurrentTaskSteps = React.memo(({ amr }) => {
    // 스크롤 위치 저장용 ref
    const scrollPositionRef = useRef(0);
    const stepsContainerRef = useRef(null);
    // 확장된 스텝 (상세 보기)
    const [expandedStepSeq, setExpandedStepSeq] = useState(null);
    // 태스크 완료/취소 상태를 추적하는 로컬 상태
    const [isTaskCancelled, setIsTaskCancelled] = useState(false);
    // 이전 데이터 참조 (불필요한 스크롤 초기화 방지)
    const prevDataRef = useRef(null);
    
    // AMR이 변경될 때만 취소 상태 초기화
    useEffect(() => {
      setIsTaskCancelled(false);
      setExpandedStepSeq(null);
    }, [amr?.id]);
    
    // 스크롤 위치 저장
    const saveScrollPosition = useCallback(() => {
      if (stepsContainerRef.current) {
        scrollPositionRef.current = stepsContainerRef.current.scrollTop;
      }
    }, []);
    
    // 스크롤 위치 복원
    const restoreScrollPosition = useCallback(() => {
      if (stepsContainerRef.current && scrollPositionRef.current > 0) {
        stepsContainerRef.current.scrollTop = scrollPositionRef.current;
      }
    }, []);
    
    const { data, error, isLoading } = useQuery({
      enabled: !!amr && !isTaskCancelled,
      queryKey: ["currentTask", amr?.id],
      queryFn: async () => {
        // 쿼리 전 스크롤 위치 저장
        saveScrollPosition();
        
        try {
          const r = await fetch(`${API}/api/robots/${amr.id}/current-task`);
          
          if (r.status === 204 || r.status === 404) {
            setIsTaskCancelled(true);
            return null;
          }
          
          if (!r.ok) {
            throw new Error(`Failed to fetch task, status: ${r.status}`);
          }
          
          const taskData = await r.json();
          
          if (!taskData || !taskData.steps || taskData.steps.length === 0) {
            setIsTaskCancelled(true);
            return null;
          }
          
          setIsTaskCancelled(false);
          return taskData;
        } catch (error) {
          if (error.message.includes('204') || 
              error.message.includes('404') || 
              error.message.includes('Failed to fetch')) {
            setIsTaskCancelled(true);
            return null;
          }
          throw error;
        }
      },
      refetchInterval: (data) => {
        if (isTaskCancelled || data === null) return false;
        return 3000;
      },
      refetchIntervalInBackground: false,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 2000,
      gcTime: 5000,
      retry: false,
      // 구조적 공유를 비활성화하여 동일한 데이터일 때 리렌더링 방지
      structuralSharing: (oldData, newData) => {
        if (!oldData || !newData) return newData;
        // task_id와 current_seq가 같으면 이전 데이터 유지
        if (oldData.task_id === newData.task_id && 
            oldData.current_seq === newData.current_seq &&
            oldData.paused === newData.paused) {
          // steps 상태도 비교
          const oldStepsStr = JSON.stringify(oldData.steps?.map(s => ({ seq: s.seq, status: s.status })));
          const newStepsStr = JSON.stringify(newData.steps?.map(s => ({ seq: s.seq, status: s.status })));
          if (oldStepsStr === newStepsStr) {
            return oldData; // 이전 데이터 유지
          }
        }
        return newData;
      },
    });
    
    // 데이터 변경 시 스크롤 위치 복원
    useEffect(() => {
      if (data && prevDataRef.current) {
        // 데이터가 있고 이전 데이터도 있으면 스크롤 복원
        requestAnimationFrame(restoreScrollPosition);
      }
      prevDataRef.current = data;
    }, [data, restoreScrollPosition]);

    // pause/restart/cancel API 호출
    const pauseMut = useMutation({
      mutationFn: () =>
        fetch(`${API}/api/tasks/${data?.task_id}/pause`, { method: "PUT" }),
      onSuccess: () => {
        message.success("일시정지");
        qc.invalidateQueries(["currentTask", amr?.id]);
      },
      onError: () => message.error("일시정지 실패"),
    });

    const restartMut = useMutation({
      mutationFn: () =>
        fetch(`${API}/api/tasks/${data?.task_id}/restart`, { method: "PUT" }),
      onSuccess: () => {
        message.success("재시작");
        qc.invalidateQueries(["currentTask", amr?.id]);
      },
      onError: () => message.error("재시작 실패"),
    });

    const cancelMut = useMutation({
      mutationFn: () =>
        fetch(`${API}/api/tasks/${data?.task_id}`, { method: "DELETE" }),
      onSuccess: () => {
        message.success("취소");
        setIsTaskCancelled(true);
        qc.setQueryData(["currentTask", amr?.id], null);
        qc.invalidateQueries(["currentTask", amr?.id]);
      },
      onError: () => message.error("취소 실패"),
    });

    // 패스워드 확인 후 태스크 취소
    const handleCancelWithPassword = useCallback(() => {
      passwordConfirm.showPasswordConfirm(
        () => {
          cancelMut.mutate();
        },
        {
          title: "태스크 취소 확인",
          description: `관리자 비밀번호가 필요합니다.\n\nAMR "${amr?.name}"의 태스크를 취소하시겠습니까?`
        }
      );
    }, [amr?.name, cancelMut, passwordConfirm]);

    // 스텝 타입별 아이콘 반환
    const getStepIcon = useCallback((stepType) => {
      switch (stepType) {
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
    }, []);

    // 스텝 요약 정보
    const getStepSummary = useCallback((step) => {
      try {
        const p = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload || {};
        switch (step.type) {
          case 'NAV':
          case 'NAV_PRE':
            return `→ ${p.dest || '?'}`;
          case 'MANI_WORK':
            return `매니 ${p.CMD_FROM}→${p.CMD_TO}`;
          case 'PLC_WRITE':
            return `PLC ${p.PLC_BIT}=${p.PLC_DATA}`;
          case 'PLC_READ':
            return `PLC ${p.PLC_ID}==${p.EXPECTED}`;
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
    }, []);

    // 스텝 상세 정보 포맷팅
    const getStepDetailPayload = useCallback((step) => {
      try {
        const p = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload || {};
        return JSON.stringify(p, null, 2);
      } catch {
        return step.payload || "{}";
      }
    }, []);

    // 스텝 클릭 핸들러
    const handleStepClick = useCallback((seq) => {
      setExpandedStepSeq(prev => prev === seq ? null : seq);
    }, []);

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
                style={{ fontSize: '11px', marginLeft: 'auto' }}
              >
                {data.paused ? '일시정지' : '실행중'}
              </Tag>
            )}
          </div>
        }
        bodyStyle={{ padding: 12, height: 'calc(100% - 46px)', display: 'flex', flexDirection: 'column' }}
        style={{ width: '100%', height: '100%' }}
      >
        {data && data.steps && data.steps.length > 0 ? (
          <>
            {/* 태스크 요약 */}
            <div style={{ 
              marginBottom: 12, 
              padding: 10, 
              background: '#f5f5f5', 
              borderRadius: 6,
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text strong>Task #{data.task_id}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.current_seq + 1} / {data.steps.length} 스텝
                </Text>
              </div>
              <Progress 
                percent={Math.round(((data.current_seq + 1) / data.steps.length) * 100)} 
                size="small" 
                status={data.paused ? 'exception' : 'active'}
                showInfo={false}
              />
            </div>

            {/* 스텝 목록 - 스크롤 가능 영역 */}
            <div 
              ref={stepsContainerRef}
              style={{ 
                flex: 1, 
                overflowY: 'auto', 
                overflowX: 'hidden',
                marginBottom: 12,
                paddingRight: 4,
              }}
              onScroll={saveScrollPosition}
            >
              {data.steps.map((step, index) => {
                const isCurrentStep = step.seq === data.current_seq;
                const isCompleted = step.seq < data.current_seq;
                const isExpanded = expandedStepSeq === step.seq;
                
                return (
                  <div 
                    key={step.seq}
                    style={{ marginBottom: index === data.steps.length - 1 ? 0 : 8 }}
                  >
                    {/* 스텝 헤더 (클릭 가능) */}
                    <div 
                      onClick={() => handleStepClick(step.seq)}
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
                      {/* 상태 아이콘 */}
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
                      
                      {/* 스텝 정보 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 6,
                          marginBottom: 2
                        }}>
                          {getStepIcon(step.type)}
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
                            {getStepSummary(step)}
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
                      
                      {/* 확장 아이콘 */}
                      <div style={{ marginLeft: 8, color: '#999' }}>
                        {isExpanded ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                      </div>
                    </div>
                    
                    {/* 스텝 상세 (확장 시) */}
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
                          {getStepDetailPayload(step)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 제어 버튼 */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {data.paused ? (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => restartMut.mutate()}
                  loading={restartMut.isLoading}
                  icon={<ReloadOutlined />}
                  style={{ flex: 1, fontSize: '12px' }}
                >
                  재시작
                </Button>
              ) : (
                <Button
                  size="small"
                  onClick={() => pauseMut.mutate()}
                  loading={pauseMut.isLoading}
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
                loading={cancelMut.isLoading}
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

                        <Descriptions.Item label="HOME 스테이션">{selectedAmr.home_station || "-"}</Descriptions.Item>
                        <Descriptions.Item label="충전 스테이션">{selectedAmr.charge_station || "-"}</Descriptions.Item>
                        <Descriptions.Item label="HOME(표시명)" span={2}>
                          {resolveStationLabel(selectedAmr.home_station)}
                        </Descriptions.Item>
                        <Descriptions.Item label="충전(표시명)" span={2}>
                          {resolveStationLabel(selectedAmr.charge_station)}
                        </Descriptions.Item>

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
              <CurrentTaskSteps amr={selectedAmr} />
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
