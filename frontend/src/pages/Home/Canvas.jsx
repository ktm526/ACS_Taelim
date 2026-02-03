// src/pages/Home/Canvas.jsx
import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  Card,
  Button,
  Spin,
  Alert,
  Modal,
  Radio,
  Tag,
  message,
  theme,
  List,
  Input,
  Select,
  Collapse,
  Popconfirm,
  Divider,
  Checkbox,
} from "antd";
import { SettingOutlined, DownOutlined, UpOutlined, EyeOutlined, SaveOutlined, FolderOpenOutlined, DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue, useAtom } from "jotai";
import { mapsQueryAtom, robotsQueryAtom, selectedMapAtom } from "@/state/atoms";
import arrowIcon from "@/assets/arrow.png";
import SignalOverlay from "@/components/SignalOverlay";
import PasswordConfirm from "@/components/PasswordConfirm";
import usePasswordConfirm from "@/hooks/usePasswordConfirm";

// 안전한 JSON 파싱
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

const CORE = import.meta.env.VITE_CORE_BASE_URL;
const ICON_MM = { width: 800, height: 1200 };

export default function Canvas() {
  // jotai
  const mapsQ = useAtomValue(mapsQueryAtom);
  const robotsQ = useAtomValue(robotsQueryAtom);
  const [selMap, setSelMap] = useAtom(selectedMapAtom);

  const maps = mapsQ.data ?? [];
  const robots = robotsQ.data ?? [];

  const { token } = theme.useToken();

  // 패스워드 컨펌 훅 추가
  const passwordConfirm = usePasswordConfirm();

  // station tooltip state
  const [hoveredStationClasses, setHoveredStationClasses] = useState(null);
  const [stationTooltipPos, setStationTooltipPos] = useState({ x: 0, y: 0 });

  // 펄스 애니메이션을 위한 상태
  const [pulseTime, setPulseTime] = useState(0);

  // localStorage에서 저장된 뷰 상태 복원 함수
  const getStoredViewState = useCallback(() => {
    try {
      const stored = localStorage.getItem('canvas-view-state');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          scale: parsed.scale || 1.5, // 기본값을 1.5로 변경
          offset: parsed.offset || { x: 100, y: 100 } // 기본 오프셋 변경
        };
      }
    } catch (error) {
      console.warn('Failed to parse stored view state:', error);
    }
    return {
      scale: 1.5, // 기본 스케일 값
      offset: { x: 100, y: 100 } // 기본 오프셋 값
    };
  }, []);

  // localStorage에 뷰 상태 저장 함수
  const saveViewState = useCallback((scale, offset) => {
    try {
      localStorage.setItem('canvas-view-state', JSON.stringify({
        scale,
        offset
      }));
    } catch (error) {
      console.warn('Failed to save view state:', error);
    }
  }, []);

  // AMR 상태 판단 함수 (AMRStatus.jsx와 동일한 로직)
  const getAmrStatus = useCallback((amr) => {
    // 연결 끊김 상태를 최우선으로 확인
    if (amr.status === '연결 끊김') {
      return '연결 끊김';
    }
    
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

  // 각 로봇의 현재 task 상태를 조회하는 쿼리
  const robotTasksQuery = useQuery({
    queryKey: ["robotTasks", robots.map(r => r.id)],
    queryFn: async () => {
      if (robots.length === 0) return {};
      
      const taskPromises = robots.map(async (robot) => {
        try {
          const response = await fetch(`${CORE}/api/robots/${robot.id}/current-task`);
          if (response.status === 404) {
            return { robotId: robot.id, task: null };
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch task for robot ${robot.id}`);
          }
          const task = await response.json();
          return { robotId: robot.id, task };
        } catch (error) {
          console.warn(`Failed to fetch task for robot ${robot.id}:`, error);
          return { robotId: robot.id, task: null };
        }
      });

      const results = await Promise.all(taskPromises);
      const taskMap = {};
      results.forEach(({ robotId, task }) => {
        taskMap[robotId] = task;
      });
      return taskMap;
    },
    refetchInterval: 5000,
    enabled: robots.length > 0,
    staleTime: 5000,
  });

  const robotTasks = robotTasksQuery.data || {};

  // 태스크 리스트 조회
  const tasksQuery = useQuery({
    queryKey: ["tasksList"],
    queryFn: async () => {
      const response = await fetch(`${CORE}/api/tasks`);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      return response.json();
    },
    refetchInterval: 5000,
    staleTime: 5000,
  });

  const tasks = tasksQuery.data ?? [];
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(true);
  const [taskRobotId, setTaskRobotId] = useState(null);
  const [taskSteps, setTaskSteps] = useState([
    { type: "NAV", dest: "", cmdId: "", cmdFrom: "", cmdTo: "", visionCheck: "", plcId: "", plcData: "", plcExpected: "" },
  ]);
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  // 태스크 상세 보기 모달
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [taskDetailData, setTaskDetailData] = useState(null);
  const [taskDetailId, setTaskDetailId] = useState(null);

  // 프리셋 관련 상태
  const [presets, setPresets] = useState(() => {
    try {
      const stored = localStorage.getItem("task-presets");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState("");
  const [presetModalOpen, setPresetModalOpen] = useState(false);

  // 프리셋 저장
  const savePreset = useCallback(() => {
    if (!presetName.trim()) {
      message.warning("프리셋 이름을 입력하세요.");
      return;
    }
    const newPreset = {
      id: Date.now(),
      name: presetName.trim(),
      steps: taskSteps,
    };
    const newPresets = [...presets, newPreset];
    setPresets(newPresets);
    localStorage.setItem("task-presets", JSON.stringify(newPresets));
    setPresetName("");
    setPresetModalOpen(false);
    message.success(`프리셋 "${newPreset.name}" 저장됨`);
  }, [presetName, taskSteps, presets]);

  // 프리셋 삭제
  const deletePreset = useCallback((presetId) => {
    const newPresets = presets.filter((p) => p.id !== presetId);
    setPresets(newPresets);
    localStorage.setItem("task-presets", JSON.stringify(newPresets));
    message.success("프리셋 삭제됨");
  }, [presets]);

  // 프리셋 로드
  const loadPreset = useCallback((preset) => {
    setTaskSteps(preset.steps);
    message.success(`프리셋 "${preset.name}" 로드됨`);
  }, []);

  // 태스크 상세 조회
  const fetchTaskDetail = useCallback((taskId) => {
    setTaskDetailId(taskId);
    setTaskDetailOpen(true);
  }, []);

  const taskDetailQuery = useQuery({
    queryKey: ["taskDetail", taskDetailId],
    queryFn: async () => {
      const response = await fetch(`${CORE}/api/tasks/${taskDetailId}`);
      if (!response.ok) throw new Error("Failed to fetch task detail");
      return response.json();
    },
    enabled: !!taskDetailId && taskDetailOpen,
    refetchInterval: taskDetailOpen ? 3000 : false,
    staleTime: 0,
  });

  useEffect(() => {
    if (taskDetailQuery.data) {
      setTaskDetailData(taskDetailQuery.data);
    }
  }, [taskDetailQuery.data]);

  // 스텝 타입 라벨
  const stepTypeLabel = (type) => {
    switch (type) {
      case "NAV": return "이동";
      case "MANI_WORK": return "매니퓰레이터";
      case "PLC_WRITE": return "PLC 쓰기";
      case "PLC_READ": return "PLC 읽기";
      default: return type;
    }
  };

  // 스텝 payload 요약
  const stepPayloadSummary = (step) => {
    try {
      const payload = typeof step.payload === "string" ? JSON.parse(step.payload) : step.payload;
      switch (step.type) {
        case "NAV":
          return `→ ${payload.dest || "?"}`;
        case "MANI_WORK":
          return payload.desc_from && payload.desc_to
            ? `${payload.desc_from} → ${payload.desc_to}${payload.VISION_CHECK === 1 ? " V✓" : ""}`
            : `FROM:${payload.CMD_FROM} TO:${payload.CMD_TO}${payload.VISION_CHECK === 1 ? " Vision✓" : ""}`;
        case "PLC_WRITE":
          return payload.desc || `${payload.PLC_BIT}=${payload.PLC_DATA}`;
        case "PLC_READ":
          return payload.desc || `${payload.PLC_ID} == ${payload.EXPECTED}`;
        default:
          return JSON.stringify(payload);
      }
    } catch {
      return "-";
    }
  };

  const stationOptions = useMemo(() => {
    try {
      const parsed = safeParse(selMap?.stations, {}).stations || [];
      return parsed.map((station) => {
        if (typeof station === "string") {
          return { label: station, value: station };
        }
        const value = station.name ?? station.station_name ?? station.id ?? "";
        const label = station.name ?? station.station_name ?? station.id ?? String(value);
        return { label: String(label), value: String(value) };
      });
    } catch {
      return [];
    }
  }, [selMap]);

  // 펄스 효과 색상과 조건 결정
  const getPulseEffect = useCallback((robot) => {
    const status = getAmrStatus(robot);
    const currentTask = robotTasks[robot.id];
    
    // 연결 끊김 상태 - 빨간색 (최우선)
    if (status === '연결 끊김') {
      return { color: '#ff4d4f', shouldPulse: true };
    }
    
    // 비상정지 상태 - 마젠타
    if (status === '비상정지') {
      return { color: '#eb2f96', shouldPulse: true };
    }
    
    // 오류 상태이거나 일시정지된 task가 있는 경우 - 빨간색
    if (status === '오류' || (currentTask && currentTask.paused)) {
      return { color: '#ff4d4f', shouldPulse: true };
    }
    
    // 충전 상태 - 노란색
    if (status === '충전') {
      return { color: '#faad14', shouldPulse: true };
    }
    
    // 이동 상태 - 브랜드 컬러
    if (status === '이동') {
      return { color: token.colorPrimary, shouldPulse: true };
    }
    
    // 작업 중 (할당된 태스크 있음)
    if (status === '작업 중') {
      return { color: '#13c2c2', shouldPulse: true };
    }
    
    return { shouldPulse: false };
  }, [getAmrStatus, robotTasks, token.colorPrimary]);

  // 펄스 애니메이션을 30fps로 제한
  useEffect(() => {
    let animationId;
    let lastTime = 0;
    const targetFPS = 30; // 60fps -> 30fps로 감소
    const frameInterval = 1000 / targetFPS;
    
    const animate = (currentTime) => {
      if (currentTime - lastTime >= frameInterval) {
        setPulseTime(currentTime);
        lastTime = currentTime;
      }
      animationId = requestAnimationFrame(animate);
    };
    animate(0);
    return () => cancelAnimationFrame(animationId);
  }, []);

  // 지도 변경 API
  const saveCurrent = useMutation({
    mutationFn: (id) =>
      fetch(`${CORE}/api/maps/current`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapId: id }),
      }),
  });

  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [tempId, setTempId] = useState(selMap?.id);

  // 캔버스 refs
  const contRef = useRef(null);
  const canvRef = useRef(null);

  // 뷰 상태 (localStorage에서 초기값 복원)
  const initialViewState = getStoredViewState();
  const [scale, setScale] = useState(initialViewState.scale);
  const [offset, setOffset] = useState(initialViewState.offset);
  const [sf, setSf] = useState(1);

  // 스케일과 오프셋이 변경될 때마다 localStorage에 저장
  useEffect(() => {
    saveViewState(scale, offset);
  }, [scale, offset, saveViewState]);

  // station 원 반지름
  const rPix = ((ICON_MM.width / 1000) * sf * scale) / 6;

  // 로봇 아이콘 로드
  const [robotImg, setRobotImg] = useState(null);
  useEffect(() => {
    const img = new Image();
    img.src = arrowIcon;
    img.onload = () => setRobotImg(img);
    img.onerror = () => console.error("🚨 arrow.png 로드 실패:", arrowIcon);
  }, []);

  // DPI 대응
  const fitCanvas = useCallback(() => {
    if (!contRef.current || !canvRef.current) return;
    const rect = contRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const c = canvRef.current;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.style.width = `${rect.width}px`;
    c.style.height = `${rect.height}px`;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);
  useEffect(() => {
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, [fitCanvas]);

  // 지도 변경 시 뷰 초기화 (저장된 값이 있으면 사용, 없으면 계산된 값 사용)
  useEffect(() => {
    if (!contRef.current || !selMap) return;
    const hdr = safeParse(selMap.additional_info).header || {};
    const { minPos, maxPos, resolution } = hdr;
    if (!minPos || !maxPos) return;
    
    const nSf = resolution ? 1 / resolution : 1;
    setSf(nSf);
    
    // localStorage에 저장된 값이 있는지 확인
    const storedState = getStoredViewState();
    
    // 저장된 값이 기본값이 아니라면 (즉, 사용자가 조정한 값이라면) 그대로 사용
    if (storedState.scale !== 1.5 || storedState.offset.x !== 100 || storedState.offset.y !== 100) {
      setScale(storedState.scale);
      setOffset(storedState.offset);
    } else {
      // 저장된 값이 없거나 기본값이라면 지도 중앙으로 초기화
      const midX = (minPos.x + maxPos.x) / 2;
      const midY = (minPos.y + maxPos.y) / 2;
      const rect = contRef.current.getBoundingClientRect();
      setScale(1.5); // 기본 스케일 적용
      setOffset({
        x: rect.width / 2 - midX * nSf,
        y: rect.height / 2 - midY * nSf,
      });
    }
  }, [selMap, getStoredViewState]);

  // 좌표 변환
  const transform = (x, y) => {
    const h = contRef.current?.getBoundingClientRect().height || 0;
    return {
      x: x * sf * scale + offset.x,
      y: h - (y * sf * scale + offset.y),
    };
  };

  // 그리기
  const draw = () => {
    const c = canvRef.current;
    if (!c || !selMap) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    // normalPointList 그리기 (배치 렌더링)
    const normalPoints =
      safeParse(selMap.additional_info).normalPointList ?? [];
    if (normalPoints.length > 0) {
      ctx.fillStyle = token.colorInfo;
      ctx.beginPath();
      normalPoints.forEach((pt) => {
        const { x, y } = transform(pt.x, pt.y);
        ctx.moveTo(x + 2, y);
        ctx.arc(x, y, 2, 0, Math.PI * 2);
      });
      ctx.fill();
    }

    // 기존 normals(legacy) 그리기
    const normals = safeParse(selMap.additional_info).normalPosList ?? [];
    if (normals.length > 0) {
      ctx.fillStyle = "#000";
      normals.forEach((pt) => {
        const q = transform(pt.x, pt.y);
        ctx.fillRect(q.x, q.y, 1, 1);
      });
    }

    // 경로 그리기 (배치 렌더링)
    const paths = safeParse(selMap.paths).paths ?? [];
    const stations = safeParse(selMap.stations).stations ?? [];
    if (paths.length > 0) {
      ctx.strokeStyle = "#f00";
      ctx.beginPath();
      paths.forEach((p) => {
        let s = p.coordinates?.start;
        let e = p.coordinates?.end;
        if (!s || !e) {
          s = stations.find((st) => String(st.id) === String(p.start));
          e = stations.find((st) => String(st.id) === String(p.end));
        }
        if (!s || !e) return;
        const sp = transform(s.x, s.y);
        const ep = transform(e.x, e.y);
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(ep.x, ep.y);
      });
      ctx.stroke();
    }

    // Stations 그리기 (배치 렌더링)
    if (stations.length > 0) {
      ctx.fillStyle = "#ffa500";
      ctx.font = `${12 * scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      
      // 모든 스테이션 원을 한번에 그리기
      ctx.beginPath();
      stations.forEach((st) => {
        const p = transform(st.x, st.y);
        ctx.moveTo(p.x + rPix, p.y);
        ctx.arc(p.x, p.y, rPix, 0, Math.PI * 2);
      });
      ctx.fill();
      
      // 텍스트는 별도로 그리기
      ctx.fillStyle = "#333";
      stations.forEach((st) => {
        const p = transform(st.x, st.y);
        ctx.fillText(st.name || st.id, p.x, p.y + rPix + 2);
      });
    }

    // Robots 그리기
    if (robotImg) {
      robots.forEach((r) => {
        const pos = safeParse(r.position, {
          x: 0,
          y: 0,
          angle: 0,
        });
        const p = transform(pos.x, pos.y);
        const sizePx = (ICON_MM.width / 1000) * sf * scale;
        
        // 펄스 효과 그리기
        const pulseEffect = getPulseEffect(r);
        if (pulseEffect.shouldPulse) {
          const pulsePhase = (pulseTime % 2000) / 2000; // 2초 주기
          const pulseRadius = sizePx * 0.8 * (1 + Math.sin(pulsePhase * Math.PI * 2) * 0.3);
          const pulseOpacity = 0.6 * (1 - pulsePhase);
          
          // 펄스 원 그리기
          ctx.save();
          ctx.globalAlpha = pulseOpacity;
          ctx.strokeStyle = pulseEffect.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, pulseRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // 추가 펄스 링 (더 큰 원)
          const outerPulseRadius = sizePx * 1.2 * (1 + Math.sin(pulsePhase * Math.PI * 2 + Math.PI) * 0.4);
          const outerPulseOpacity = 0.3 * (1 - pulsePhase);
          ctx.globalAlpha = outerPulseOpacity;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, outerPulseRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        
        // 로봇 이미지 그리기
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-pos.angle + Math.PI / 2);
        ctx.drawImage(robotImg, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
        ctx.restore();
      });
    }
  };
  useEffect(draw, [
    selMap,
    scale,
    offset,
    sf,
    robots,
    robotImg,
    token.colorInfo,
    pulseTime,
    getPulseEffect,
    robotTasks,
  ]);

  // 패닝 & 줌
  const [drag, setDrag] = useState(false);
  const [last, setLast] = useState({ x: 0, y: 0 });

  const getPos = (e) => {
    const r = canvRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    setDrag(true);
    setLast(getPos(e));
  };
  const onMove = (e) => {
    if (drag) {
      const p = getPos(e);
      setOffset((o) => ({
        x: o.x + p.x - last.x,
        y: o.y - p.y + last.y,
      }));
      setLast(p);
    }
    handleHover(e);
    handleStationHover(e);
  };
  const onUp = () => setDrag(false);

  const onWheel = (e) => {
    e.preventDefault();
    const p = getPos(e);
    const fac = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(0.1, Math.min(scale * fac, 80));
    const ratio = ns / scale;
    const rect = contRef.current.getBoundingClientRect();
    setScale(ns);
    setOffset((o) => ({
      x: o.x * ratio + p.x * (1 - ratio),
      y: o.y * ratio + (rect.height - p.y) * (1 - ratio),
    }));
  };

  // 로봇 툴팁 상태
  const [hoveredRobotName, setHoveredRobotName] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleHover = (e) => {
    const pos = getPos(e);
    let found = null;
    robots.forEach((r) => {
      const rp = safeParse(r.position, {
        x: 0,
        y: 0,
        angle: 0,
      });
      const pScr = transform(rp.x, rp.y);
      const dx = pScr.x - pos.x;
      const dy = pScr.y - pos.y;
      if (dx * dx + dy * dy <= (rPix + 5) ** 2) {
        found = r;
      }
    });
    if (found) {
      setHoveredRobotName(found.name);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredRobotName(null);
    }
  };

  const handleStationHover = (e) => {
    const pos = getPos(e);
    // re-parse the stations here
    const stations = safeParse(selMap?.stations).stations ?? [];
    let found = null;
    stations.forEach((st) => {
      const p = transform(st.x, st.y);
      const dx = p.x - pos.x,
        dy = p.y - pos.y;
      if (dx * dx + dy * dy <= rPix * rPix) {
        found = st;
        console.log(st);
      }
    });
    if (found) {
      const classes = Array.isArray(found.class)
        ? found.class
        : Array.isArray(found.classList)
        ? found.classList
        : found.class
        ? [found.class]
        : [];
      setHoveredStationClasses(classes);
      console.log(classes);
      setStationTooltipPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredStationClasses(null);
    }
  };

  // 우클릭 메뉴 상태
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [menuStation, setMenuStation] = useState(null);

  const onCanvasContextMenu = (e) => {
    e.preventDefault();
    if (!selMap) return;
    const stations = safeParse(selMap.stations).stations ?? [];
    const click = getPos(e);
    const clicked = stations.find((st) => {
      const p = transform(st.x, st.y);
      const dx = p.x - click.x,
        dy = p.y - click.y;
      return dx * dx + dy * dy <= rPix * rPix;
    });
    if (clicked) {
      setMenuStation(clicked);
      setMenuPos({ x: e.clientX, y: e.clientY });
      setMenuVisible(true);
    }
  };

  // 패스워드 확인 후 로봇 이동 명령 실행
  const dispatchRobot = async (robotId) => {
    if (!menuStation) return;
    
    const robotName = robots.find(r => r.id === robotId)?.name || robotId;
    const stationName = menuStation.name ?? menuStation.id;
    
    // 패스워드 확인 요청
    passwordConfirm.showPasswordConfirm(
      async () => {
        try {
          await fetch(`${CORE}/api/robots/${robotId}/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              station: stationName,
            }),
          });
          message.success(`로봇 ${robotName} → ${stationName} 이동 명령 보냄`);
        } catch {
          message.error("이동 명령 실패");
        }
      },
      {
        title: "로봇 이동 명령 확인",
        description: `로봇 ${robotName}을(를) ${stationName}으로 이동시키시겠습니까?`
      }
    );
    
    // 메뉴 닫기
    setMenuVisible(false);
  };

  return (
    <>
      <Card
        size="small"
        title={`${selMap?.name ?? "―"}`}
        extra={
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => {
              setTempId(selMap?.id);
              setModalOpen(true);
            }}
          />
        }
        style={{ height: "calc(100%)" }}
        bodyStyle={{ height: "calc(100%)" }}
      >
        <div
          ref={contRef}
          style={{
            position: "relative",
            width: "100%",
            height: "calc(100% - 40px)",
            backgroundColor: token.colorBgContainer,
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.1)",
            borderRadius: token.borderRadius,
            overflow: "hidden",
            padding: token.padding,
            boxSizing: "border-box",
          }}
        >
          <SignalOverlay />

          {/* 태스크 리스트 패널 */}
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 5,
            }}
          >
            {!taskPanelOpen ? (
              <Button
                type="primary"
                size="small"
                onClick={() => setTaskPanelOpen(true)}
              >
                태스크 보기
              </Button>
            ) : (
              <Card
                size="small"
                title="태스크"
                extra={
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="small" onClick={() => setTaskPanelOpen(false)}>
                      접기
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        if (stationOptions.length) {
                          setTaskSteps((prev) =>
                            prev.map((step) =>
                              step.type === "NAV" && !step.dest
                                ? { ...step, dest: stationOptions[0].value }
                                : step
                            )
                          );
                        }
                        setTaskModalOpen(true);
                      }}
                    >
                      추가
                    </Button>
                  </div>
                }
                style={{ width: 320 }}
                styles={{ body: { padding: 8 } }}
              >
                {tasksQuery.isLoading ? (
                  <Spin size="small" />
                ) : tasksQuery.isError ? (
                  <Alert type="error" message="태스크 조회 실패" />
                ) : (
                  <List
                    size="small"
                    dataSource={tasks}
                    style={{ maxHeight: 260, overflowY: "auto" }}
                    locale={{ emptyText: "태스크 없음" }}
                    renderItem={(task) => {
                      const robot = robots.find((r) => r.id === task.robot_id);
                      const robotName = robot?.name || `로봇 ${task.robot_id}`;
                      return (
                        <List.Item
                          key={task.id}
                          actions={[
                            <Button
                              key="view"
                              size="small"
                              icon={<EyeOutlined />}
                              onClick={() => fetchTaskDetail(task.id)}
                              loading={taskDetailOpen && taskDetailId === task.id && taskDetailQuery.isFetching}
                            />,
                            <Button
                              key="del"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={async () => {
                                try {
                                  await fetch(`${CORE}/api/tasks/${task.id}`, {
                                    method: "DELETE",
                                  });
                                  tasksQuery.refetch();
                                  message.success("태스크 삭제 완료");
                                } catch {
                                  message.error("태스크 삭제 실패");
                                }
                              }}
                            />,
                          ]}
                        >
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>
                              #{task.id} / {robotName}
                            </span>
                          <Tag
                            color={
                              task.status === "DONE" ? "green" :
                              task.status === "RUNNING" ? "blue" :
                              task.status === "PENDING" ? "default" :
                              task.status === "PAUSED" ? "orange" :
                              task.status === "CANCELED" ? "red" :
                              task.status === "FAILED" ? "red" : "default"
                            }
                            style={{ fontSize: 10, marginTop: 2 }}
                          >
                            {task.status} · seq {task.current_seq ?? 0}
                          </Tag>
                        </div>
                      </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            )}
          </div>

          <canvas
            ref={canvRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              height: "100%",
              cursor: drag ? "grabbing" : "grab",
            }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onWheel={onWheel}
            onContextMenu={onCanvasContextMenu}
          />

          {menuVisible && menuStation && (
            <div
              style={{
                position: "fixed",
                top: menuPos.y,
                left: menuPos.x,
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.15)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                zIndex: 1000,
              }}
              onMouseLeave={() => setMenuVisible(false)}
            >
              {robots.map((r) => (
                <div
                  key={r.id}
                  style={{ padding: "4px 12px", cursor: "pointer" }}
                  onClick={() => dispatchRobot(r.id)}
                >
                  {r.name}
                </div>
              ))}
            </div>
          )}

          {hoveredRobotName && (
            <div
              style={{
                position: "fixed",
                top: tooltipPos.y + 10,
                left: tooltipPos.x + 10,
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                fontSize: 12,
              }}
            >
              {hoveredRobotName}
            </div>
          )}
          {hoveredStationClasses && (
            <div
              style={{
                position: "fixed",
                top: stationTooltipPos.y + 10,
                left: stationTooltipPos.x + 10,
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                fontSize: 12,
              }}
            >
              {hoveredStationClasses.join(", ")}
            </div>
          )}
        </div>
      </Card>

      {/* 맵 선택 모달 */}
      <Modal
        title="맵 선택"
        open={modalOpen}
        okText="선택"
        cancelText="취소"
        onOk={() => {
          const m = maps.find((x) => x.id === tempId);
          if (m) {
            setSelMap(m);
            saveCurrent.mutate(m.id);
          }
          setModalOpen(false);
        }}
        onCancel={() => setModalOpen(false)}
      >
        {mapsQ.isLoading && maps.length === 0 ? (
          <Spin />
        ) : mapsQ.error ? (
          <Alert type="error" message="맵 로드 실패" />
        ) : (
          <Radio.Group
            value={tempId}
            onChange={(e) => setTempId(e.target.value)}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {maps.map((m) => (
              <Radio key={m.id} value={m.id}>
                {m.name}{" "}
                {m.is_current && (
                  <Tag color="blue" style={{ marginLeft: 4 }}>
                    현재
                  </Tag>
                )}
              </Radio>
            ))}
          </Radio.Group>
        )}
      </Modal>

      {/* 태스크 추가 모달 */}
      <Modal
        title="태스크 추가"
        open={taskModalOpen}
        okText="추가"
        cancelText="취소"
        confirmLoading={taskSubmitting}
        width={600}
        onOk={async () => {
          try {
            if (!taskRobotId) {
              message.warning("로봇을 선택하세요.");
              return;
            }
            const steps = taskSteps
              .filter((step) => step && step.type) // 빈 스텝 필터링
              .map((step) => {
                if (step.type === "NAV") {
                  return { type: "NAV", payload: { dest: step.dest || "" } };
                }
                if (step.type === "MANI_WORK") {
                  return {
                    type: "MANI_WORK",
                    payload: {
                      CMD_ID: Number(step.cmdId) || 0,
                      CMD_FROM: Number(step.cmdFrom) || 0,
                      CMD_TO: Number(step.cmdTo) || 0,
                      VISION_CHECK: Number(step.visionCheck) === 1 ? 1 : 0,
                    },
                  };
                }
                if (step.type === "PLC_WRITE") {
                  return {
                    type: "PLC_WRITE",
                    payload: {
                      PLC_BIT: step.plcId || "",
                      PLC_DATA: Number(step.plcData) || 0,
                    },
                  };
                }
                if (step.type === "PLC_READ") {
                  return {
                    type: "PLC_READ",
                    payload: {
                      PLC_ID: step.plcId || "",
                      EXPECTED: Number(step.plcExpected) || 0,
                    },
                  };
                }
                return { type: step.type, payload: {} };
              });
            console.log(`[TaskCreate] 프론트엔드: taskSteps=${taskSteps.length}개, 변환된 steps=${steps.length}개`, steps);
            setTaskSubmitting(true);
            await fetch(`${CORE}/api/tasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ robot_id: taskRobotId, steps }),
            });
            message.success("태스크가 추가되었습니다.");
            setTaskModalOpen(false);
            tasksQuery.refetch();
          } catch {
            message.error("태스크 추가 실패");
          } finally {
            setTaskSubmitting(false);
          }
        }}
        onCancel={() => setTaskModalOpen(false)}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ marginBottom: 4 }}>로봇</div>
            <Select
              value={taskRobotId}
              onChange={setTaskRobotId}
              options={robots.map((r) => ({
                label: `${r.name ?? r.id} (${r.id})`,
                value: r.id,
              }))}
              placeholder="로봇 선택"
              style={{ width: "100%" }}
            />
          </div>

          {/* 프리셋 영역 */}
          <div style={{ background: "#f5f5f5", padding: 8, borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>프리셋</span>
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={() => setPresetModalOpen(true)}
                disabled={taskSteps.length === 0}
              >
                현재 스텝 저장
              </Button>
            </div>
            {presets.length === 0 ? (
              <span style={{ fontSize: 11, color: "#999" }}>저장된 프리셋이 없습니다.</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {presets.map((preset) => (
                  <Tag
                    key={preset.id}
                    style={{ cursor: "pointer", marginRight: 0 }}
                    closable
                    onClose={(e) => {
                      e.preventDefault();
                      deletePreset(preset.id);
                    }}
                    onClick={() => loadPreset(preset)}
                    icon={<FolderOpenOutlined />}
                  >
                    {preset.name} ({preset.steps.length})
                  </Tag>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>스텝 목록</span>
              <Button
                size="small"
                onClick={() =>
                  setTaskSteps((prev) => [
                    ...prev,
                    { type: "NAV", dest: "", cmdId: "", cmdFrom: "", cmdTo: "", visionCheck: "", plcId: "", plcData: "", plcExpected: "" },
                  ])
                }
              >
                스텝 추가
              </Button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {taskSteps.map((step, idx) => (
                <div
                  key={`step-${idx}`}
                  style={{
                    border: "1px solid #e8e8e8",
                    borderRadius: 6,
                    padding: 8,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>#{idx + 1}</span>
                    <Select
                      size="small"
                      value={step.type}
                      onChange={(value) =>
                        setTaskSteps((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, type: value } : s))
                        )
                      }
                      options={[
                        { label: "이동(NAV)", value: "NAV" },
                        { label: "매니퓰레이터(MANI_WORK)", value: "MANI_WORK" },
                        { label: "PLC 쓰기(PLC_WRITE)", value: "PLC_WRITE" },
                        { label: "PLC 읽기(PLC_READ)", value: "PLC_READ" },
                      ]}
                      style={{ width: 220 }}
                    />
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        setTaskSteps((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      삭제
                    </Button>
                  </div>
                  {step.type === "NAV" && (
                    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 6 }}>
                      <span>목적지</span>
                      <Select
                        size="small"
                        value={step.dest || undefined}
                        onChange={(value) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, dest: value } : s))
                          )
                        }
                        options={stationOptions}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        placeholder="스테이션 선택"
                      />
                    </div>
                  )}
                  {step.type === "MANI_WORK" && (
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 1fr 80px 1fr 100px 1fr", gap: 6 }}>
                      <span>CMD_ID</span>
                      <Input
                        size="small"
                        value={step.cmdId}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, cmdId: e.target.value } : s))
                          )
                        }
                        placeholder="숫자"
                      />
                      <span>CMD_FROM</span>
                      <Input
                        size="small"
                        value={step.cmdFrom}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, cmdFrom: e.target.value } : s))
                          )
                        }
                        placeholder="숫자"
                      />
                      <span>CMD_TO</span>
                      <Input
                        size="small"
                        value={step.cmdTo}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, cmdTo: e.target.value } : s))
                          )
                        }
                        placeholder="숫자"
                      />
                      <span>Vision Check</span>
                      <Input
                        size="small"
                        value={step.visionCheck ?? ""}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, visionCheck: e.target.value } : s))
                          )
                        }
                        placeholder="0 또는 1"
                      />
                    </div>
                  )}
                  {step.type === "PLC_WRITE" && (
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 1fr", gap: 6 }}>
                      <span>ID</span>
                      <Input
                        size="small"
                        value={step.plcId}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, plcId: e.target.value } : s))
                          )
                        }
                        placeholder="예: 5001.0"
                      />
                      <span>값</span>
                      <Input
                        size="small"
                        value={step.plcData}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, plcData: e.target.value } : s))
                          )
                        }
                        placeholder="숫자"
                      />
                    </div>
                  )}
                  {step.type === "PLC_READ" && (
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 1fr", gap: 6 }}>
                      <span>ID</span>
                      <Input
                        size="small"
                        value={step.plcId}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, plcId: e.target.value } : s))
                          )
                        }
                        placeholder="예: 2224.1"
                      />
                      <span>기대값</span>
                      <Input
                        size="small"
                        value={step.plcExpected}
                        onChange={(e) =>
                          setTaskSteps((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, plcExpected: e.target.value } : s))
                          )
                        }
                        placeholder="숫자"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* 패스워드 확인 모달 */}
      <PasswordConfirm
        visible={passwordConfirm.isVisible}
        onConfirm={passwordConfirm.handleConfirm}
        onCancel={passwordConfirm.handleCancel}
        {...passwordConfirm.modalProps}
      />

      {/* 태스크 상세 보기 모달 */}
      <Modal
        title={taskDetailData ? `태스크 #${taskDetailData.id} 상세` : "태스크 상세"}
        open={taskDetailOpen}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button
              size="small"
              onClick={() => taskDetailQuery.refetch()}
              loading={taskDetailQuery.isFetching}
            >
              새로고침
            </Button>
            <Button
              size="small"
              onClick={() => {
                setTaskDetailOpen(false);
                setTaskDetailData(null);
                setTaskDetailId(null);
              }}
            >
              닫기
            </Button>
          </div>
        }
        onCancel={() => {
          setTaskDetailOpen(false);
          setTaskDetailData(null);
          setTaskDetailId(null);
        }}
        width={600}
      >
        {taskDetailQuery.isFetching && !taskDetailData ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spin size="small" />
          </div>
        ) : null}
        {taskDetailData && (() => {
          const robot = robots.find((r) => r.id === taskDetailData.robot_id);
          const robotName = robot?.name || `로봇 ${taskDetailData.robot_id}`;
          return (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#888" }}>로봇</div>
                  <div style={{ fontWeight: 600 }}>{robotName}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#888" }}>상태</div>
                  <Tag
                    color={
                      taskDetailData.status === "DONE" ? "green" :
                      taskDetailData.status === "RUNNING" ? "blue" :
                      taskDetailData.status === "PENDING" ? "default" :
                      taskDetailData.status === "PAUSED" ? "orange" :
                      taskDetailData.status === "CANCELED" ? "red" :
                      taskDetailData.status === "FAILED" ? "red" : "default"
                    }
                  >
                    {taskDetailData.status}
                  </Tag>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#888" }}>현재 스텝</div>
                  <div style={{ fontWeight: 600 }}>{taskDetailData.current_seq ?? 0}</div>
                </div>
              </div>

              <Divider style={{ margin: "8px 0" }} />

              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>스텝 목록 ({taskDetailData.steps?.length ?? 0}개)</div>
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {(taskDetailData.steps || [])
                    .slice()
                    .sort((a, b) => a.seq - b.seq)
                    .map((step, idx) => (
                      <div
                        key={step.id || idx}
                        style={{
                          padding: 8,
                          marginBottom: 6,
                          border: "1px solid #e8e8e8",
                          borderRadius: 6,
                          background:
                            step.status === "DONE" ? "#f6ffed" :
                            step.status === "RUNNING" ? "#e6f7ff" :
                            step.status === "FAILED" ? "#fff2f0" : "#fafafa",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#888" }}>#{step.seq + 1}</span>
                            <Tag color="blue">{stepTypeLabel(step.type)}</Tag>
                            <span style={{ fontSize: 12 }}>{stepPayloadSummary(step)}</span>
                          </div>
                          <Tag
                            color={
                              step.status === "DONE" ? "green" :
                              step.status === "RUNNING" ? "blue" :
                              step.status === "PENDING" ? "default" :
                              step.status === "FAILED" ? "red" : "default"
                            }
                            style={{ fontSize: 10 }}
                          >
                            {step.status}
                          </Tag>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 프리셋 저장 모달 */}
      <Modal
        title="프리셋 저장"
        open={presetModalOpen}
        okText="저장"
        cancelText="취소"
        onOk={savePreset}
        onCancel={() => {
          setPresetModalOpen(false);
          setPresetName("");
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div>프리셋 이름</div>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="예: 인스토커→연마기"
            onPressEnter={savePreset}
          />
          <div style={{ fontSize: 11, color: "#888" }}>
            현재 {taskSteps.length}개 스텝이 저장됩니다.
          </div>
        </div>
      </Modal>
    </>
  );
}
