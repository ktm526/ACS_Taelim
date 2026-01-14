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
  ThunderboltOutlined
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
  대기: "success",
  충전: "warning",
  수동: "default",
  오류: "error",
  "연결 끊김": "default",
  unknown: "default",
};
const STATUS_TAG_COLOR = {
  이동: "blue",
  대기: "green",
  충전: "orange",
  수동: "purple",
  오류: "red",
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
    
    // additional_info에서 charging 상태 확인
    let additionalInfo = {};
    try {
      additionalInfo = typeof amr.additional_info === 'string' 
        ? JSON.parse(amr.additional_info) 
        : amr.additional_info || {};
    } catch (e) {
      // JSON 파싱 실패 시 빈 객체 사용
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
  // TaskSteps 컴포넌트 (pause/resume/cancel 버튼) - 메모이제이션 적용
  const CurrentTaskSteps = useCallback(({ amr }) => {
    // 스크롤 컨테이너 ref
    const stepsContainerRef = useRef(null);
    // 태스크 완료/취소 상태를 추적하는 로컬 상태
    const [isTaskCancelled, setIsTaskCancelled] = useState(false);
    
    // AMR이 변경될 때마다 취소 상태 초기화
    useEffect(() => {
      setIsTaskCancelled(false);
    }, [amr?.id]);
    
    const { data, error, isLoading, isFetching, refetch } = useQuery({
      enabled: !!amr && !isTaskCancelled, // isTaskCancelled가 true면 쿼리 비활성화
      queryKey: ["currentTask", amr?.id],
      queryFn: async () => {
        try {
          const r = await fetch(`${API}/api/robots/${amr.id}/current-task`);
          
          // 204 No Content 또는 404 - 태스크 없음
          if (r.status === 204 || r.status === 404) {
            console.log(`[CurrentTaskSteps] ${amr.name}: 태스크 없음 (${r.status})`);
            setIsTaskCancelled(true);
            return null;
          }
          
          if (!r.ok) {
            throw new Error(`Failed to fetch task, status: ${r.status}`);
          }
          
          const taskData = await r.json();
          
          // 태스크 데이터가 유효하지 않으면 태스크 취소 상태로 설정
          if (!taskData || !taskData.steps || taskData.steps.length === 0) {
            console.log(`[CurrentTaskSteps] ${amr.name}: 유효하지 않은 태스크 데이터`);
            setIsTaskCancelled(true);
            return null;
          }
          
          // 유효한 태스크 데이터가 있으면 취소 상태 해제
          setIsTaskCancelled(false);
          console.log(`[CurrentTaskSteps] ${amr.name}: 유효한 태스크 발견 (${taskData.task_id})`);
          return taskData;
        } catch (error) {
          console.error(`[CurrentTaskSteps] ${amr.name}: 에러 - ${error.message}`);
          // 네트워크 오류나 특정 상태코드는 태스크 없음으로 처리
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
        // 태스크가 취소되었거나 데이터가 null이면 새로고침 중단
        if (isTaskCancelled || data === null) {
          console.log(`[CurrentTaskSteps] ${amr?.name}: 새로고침 중단 (isTaskCancelled: ${isTaskCancelled}, data: ${data})`);
          return false;
        }
        return 3000;
      },
      refetchIntervalInBackground: false,
      refetchOnMount: true,
      refetchOnWindowFocus: false, // 창 포커스 시 새로고침 비활성화
      refetchOnReconnect: false, // 재연결 시 새로고침 비활성화
      staleTime: 1000, // 1초로 설정하여 빠른 업데이트
      gcTime: 5000, // 5초로 줄여서 캐시 빨리 정리
      retry: (failureCount, error) => {
        // 204, 404나 네트워크 오류는 재시도하지 않음
        if (error?.message?.includes('204') || 
            error?.message?.includes('404') || 
            error?.message?.includes('Failed to fetch')) {
          return false;
        }
        return failureCount < 1;
      },
      // 에러 발생 시 null로 폴백하고 쿼리 비활성화
      onError: (error) => {
        console.log(`[CurrentTaskSteps] ${amr?.name}: onError - ${error.message}`);
        if (error?.message?.includes('204') || error?.message?.includes('404')) {
          setIsTaskCancelled(true);
          qc.setQueryData(["currentTask", amr?.id], null);
        }
      },
      // 성공 시에도 데이터 확인
      onSuccess: (data) => {
        if (data === null) {
          console.log(`[CurrentTaskSteps] ${amr?.name}: onSuccess with null data`);
          setIsTaskCancelled(true);
        }
      },
    });

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
        console.log(`[CurrentTaskSteps] ${amr?.name}: 태스크 취소 완료`);
        // 태스크 취소 상태로 설정하여 추가 API 호출 방지
        setIsTaskCancelled(true);
        // 캐시를 즉시 null로 설정하여 UI 즉시 업데이트
        qc.setQueryData(["currentTask", amr?.id], null);
        // 추가로 invalidate도 호출 (혹시 모를 상황 대비)
        qc.invalidateQueries(["currentTask", amr?.id]);
        // 강제로 쿼리 비활성화를 위해 잠깐 기다린 후 다시 무효화
        setTimeout(() => {
          qc.invalidateQueries(["currentTask", amr?.id]);
        }, 100);
      },
      onError: () => message.error("취소 실패"),
    });

    // 패스워드 확인 후 태스크 취소
    const handleCancelWithPassword = () => {
      passwordConfirm.showPasswordConfirm(
        () => {
          cancelMut.mutate();
        },
        {
          title: "태스크 취소 확인",
          description: `관리자 비밀번호가 필요합니다.\n\nAMR "${amr?.name}"의 태스크를 취소하시겠습니까?`
        }
      );
    };

    // 스텝 타입별 아이콘 반환 (메모이제이션)
    const getStepIcon = useCallback((stepType) => {
      switch (stepType) {
        case 'NAV':
        case 'NAV_PRE':
          return <CarOutlined />;
        case 'JACK_UP':
        case 'JACK_DOWN':
        case 'JACK':
          return <ToolOutlined />;
        case 'WAIT_FREE_PATH':
          return <HourglassOutlined />;
        case 'NAV_OR_BUFFER':
          return <AimOutlined />;
        case 'CHECK_BUFFER_BEFORE_NAV':
        case 'CHECK_BUFFER_WITHOUT_CHARGING':
          return <SearchOutlined />;
        default:
          return <ClockCircleOutlined />;
      }
    }, []);

    // 스텝 상태별 아이콘과 상태 결정 (메모이제이션)
    const getStepStatusInfo = useCallback((step, currentSeq) => {
      if (step.seq < currentSeq) {
        return { 
          status: 'finish', 
          icon: <CheckCircleOutlined style={{ color: '#096dd9' }} />
        };
      } else if (step.seq === currentSeq) {
        switch (step.status) {
          case 'RUNNING':
            return { 
              status: 'process', 
              icon: <LoadingOutlined style={{ color: '#1890ff' }} />
            };
          case 'PAUSED':
            return { 
              status: 'error', 
              icon: <PauseCircleOutlined style={{ color: '#faad14' }} />
            };
          case 'FAILED':
            return { 
              status: 'error', 
              icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
            };
          default:
            return { 
              status: 'process', 
              icon: <LoadingOutlined style={{ color: '#1890ff' }} />
            };
        }
      } else {
        return { 
          status: 'wait', 
          icon: <ClockCircleOutlined style={{ color: '#d9d9d9' }} />
        };
      }
    }, []);

    // 스텝 요약 정보 (메모이제이션)
    const getStepSummary = useCallback((step) => {
      const p = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload || {};
      switch (step.type) {
        case 'NAV':
        case 'NAV_PRE':
          return `→ ${p.dest}`;
        case 'JACK_UP':
          return "잭 올리기";
        case 'JACK_DOWN':
          return "잭 내리기";
        case 'WAIT_FREE_PATH':
          return "경로 대기";
        case 'NAV_OR_BUFFER':
          return `→ ${p.primary || p.dest || '목적지'}`;
        case 'CHECK_BUFFER_BEFORE_NAV':
        case 'CHECK_BUFFER_WITHOUT_CHARGING':
          return `버퍼 확인 (${p.target || '대상'})`;
        case 'FIND_EMPTY_B_BUFFER':
          return "빈 B 버퍼 찾기";
        case 'CHECK_BATTERY_AFTER_BUFFER':
          return "배터리 체크";
        default:
          return step.type;
      }
    }, []);

    // 디버깅을 위한 로그 (개발 중에만)
    if (import.meta.env.DEV) {
      console.log(`[CurrentTaskSteps] ${amr?.name} - data: ${data === null ? 'null' : data ? `exists(task_id:${data.task_id})` : 'undefined'}, isLoading: ${isLoading}, error: ${error?.message || 'none'}, isTaskCancelled: ${isTaskCancelled}, enabled: ${!!amr && !isTaskCancelled}`);
      if (data && data.steps) {
        console.log(`[CurrentTaskSteps] ${amr?.name} - steps: ${data.steps.length}, current_seq: ${data.current_seq}, paused: ${data.paused}`);
      }
    }

    // 항상 같은 구조를 유지하되 내용만 변경
    return (
      <Card
        size="small"
        bordered
        bodyStyle={{ padding: 16, height: 700, display: 'flex', flexDirection: 'column' }}
        style={{ width: '100%', maxWidth: 350 }}
      >
        {data && data.steps && data.steps.length > 0 ? (
          // 태스크 데이터가 있는 경우
          <>
            {/* 헤더 */}
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong style={{ fontSize: 15 }}>
                  Task #{data.task_id}
                </Text>
                <Tag 
                  color={data.paused ? 'orange' : 'blue'} 
                  icon={data.paused ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  style={{ fontSize: '11px' }}
                >
                  {data.paused ? '일시정지' : '실행중'}
                </Tag>
              </div>
              
              <Progress 
                percent={Math.round((data.current_seq / data.steps.length) * 100)} 
                size="small" 
                status={data.paused ? 'exception' : 'active'}
                format={() => `${data.current_seq}/${data.steps.length}`}
              />
            </div>

            {/* Steps */}
            <div style={{ marginBottom: 12, flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <div 
                ref={stepsContainerRef}
                style={{ 
                  height: '100%',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  paddingRight: '4px',
                }}
              >
                <div style={{ padding: '8px 0' }}>
                  {data.steps.map((step, index) => {
                    const isCurrentStep = step.seq === data.current_seq;
                    const isCompleted = step.seq < data.current_seq;
                    const summary = getStepSummary(step);
                    
                    return (
                      <div 
                        key={step.seq}
                        style={{ 
                          display: 'flex',
                          marginBottom: index === data.steps.length - 1 ? 0 : '16px',
                          position: 'relative'
                        }}
                      >
                        {/* 연결선 */}
                        {index < data.steps.length - 1 && (
                          <div
                            style={{
                              position: 'absolute',
                              left: '11px',
                              top: '24px',
                              width: '2px',
                              height: '16px',
                              backgroundColor: isCompleted ? '#096dd9' : '#d9d9d9',
                              zIndex: 1
                            }}
                          />
                        )}
                        {/* 아이콘 영역 */}
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 
                              isCompleted ? '#096dd9' :
                              isCurrentStep ? '#1890ff' : '#d9d9d9',
                            color: 'white',
                            fontSize: '12px',
                            marginRight: '12px',
                            flexShrink: 0,
                            zIndex: 2,
                            position: 'relative'
                          }}
                        >
                          {isCompleted ? <CheckCircleOutlined style={{ fontSize: '14px' }} /> :
                           isCurrentStep ? <LoadingOutlined style={{ fontSize: '14px' }} /> :
                           <span style={{ fontSize: '10px', fontWeight: 'bold' }}>{step.seq}</span>}
                        </div>
                        {/* 내용 영역 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 6,
                            backgroundColor: isCurrentStep ? 'rgba(24, 144, 255, 0.1)' : 'transparent',
                            padding: isCurrentStep ? '4px 6px' : '2px 0',
                            borderRadius: isCurrentStep ? '4px' : '0',
                            margin: isCurrentStep ? '-2px -6px' : '0',
                            maxWidth: '100%',
                            overflow: 'hidden'
                          }}>
                            <div style={{ flexShrink: 0 }}>
                              {getStepIcon(step.type)}
                            </div>
                            <span style={{ 
                              fontWeight: isCurrentStep ? 600 : 400,
                              color: isCurrentStep ? '#1890ff' : 'inherit',
                              fontSize: '13px',
                              lineHeight: '1.2',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1
                            }}>
                              {step.seq}. {summary}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                            <Tag size="small" style={{ fontSize: '10px', lineHeight: '14px', padding: '0 4px' }} color={
                              step.status === 'DONE' ? 'blue' :
                              step.status === 'RUNNING' ? 'green' :
                              step.status === 'PAUSED' ? 'orange' :
                              step.status === 'FAILED' ? 'red' : 'default'
                            }>
                              {step.status}
                            </Tag>
                            <span style={{ marginLeft: 4, fontSize: '10px' }}>{step.type}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
          // 태스크 데이터가 없는 경우
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="현재 Task 없음" size="small" />
          </div>
        )}
      </Card>
    );
  }, [passwordConfirm]); // passwordConfirm 의존성 추가

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
          <div style={{ display: "flex", gap: 24, minHeight: 520 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Tabs
                defaultActiveKey="summary"
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
                      <Paragraph
                        code
                        copyable
                        style={{
                          whiteSpace: "pre-wrap",
                          maxHeight: 260,
                          overflow: "auto",
                        }}
                      >
                        {formatJsonForDisplay(selectedAmr.additional_info)}
                      </Paragraph>
                    ),
                  },
                ]}
              />
            </div>

            <div style={{ width: 350, flexShrink: 0 }}>
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
