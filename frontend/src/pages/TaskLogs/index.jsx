// src/pages/TaskLogs/index.jsx
import React, { useState, useMemo, useCallback } from "react";
import {
  Input,
  Select,
  DatePicker,
  Typography,
  message,
  Tooltip,
  Popconfirm,
  Empty,
  Spin,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleFilled,
  MinusCircleFilled,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

const API = import.meta.env.VITE_CORE_BASE_URL;

const SCENARIO_LABELS = {
  1: "인스토커 → 연마기",
  2: "연마기 → 아웃스토커",
  3: "아웃스토커 → 컨베이어",
};

const STATUS_CONFIG = {
  완료: { icon: CheckCircleFilled, color: "#10b981", bg: "#ecfdf5" },
  실패: { icon: CloseCircleFilled, color: "#ef4444", bg: "#fef2f2" },
  취소: { icon: MinusCircleFilled, color: "#f59e0b", bg: "#fffbeb" },
  진행중: { icon: ClockCircleFilled, color: "#3b82f6", bg: "#eff6ff" },
};

// 통계 카드
const StatCard = ({ label, value, color, icon: Icon }) => (
  <div style={{
    background: "#fff",
    borderRadius: 12,
    padding: "16px 20px",
    minWidth: 120,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      {Icon && <Icon style={{ fontSize: 14, color }} />}
      <Text style={{ fontSize: 12, color: "#64748b" }}>{label}</Text>
    </div>
    <Text style={{ fontSize: 24, fontWeight: 600, color }}>{value}</Text>
  </div>
);

// PLC 상태 컴팩트 표시
const PlcStatusCompact = ({ plcStatus, scenario }) => {
  if (!plcStatus) return null;
  
  const Badge = ({ active, activeColor = "#10b981", activeBg = "#ecfdf5", children }) => (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      background: active ? activeBg : "#f1f5f9",
      borderRadius: 4,
      fontSize: 11,
      color: active ? activeColor : "#94a3b8",
    }}>
      {children}
    </span>
  );
  
  const renderDevices = () => {
    const items = [];
    
    if (scenario === 1) {
      // 인스토커 작업 가능 상태
      if (plcStatus.instocker) {
        Object.entries(plcStatus.instocker).forEach(([side, data]) => {
          items.push(
            <Badge key={`ins-${side}`} active={data.work_available}>
              인스토커 {side}
              {data.work_available && <CheckCircleFilled style={{ fontSize: 10 }} />}
            </Badge>
          );
        });
      }
      // 인스토커 슬롯 상태 (제품 정보)
      if (plcStatus.instocker_slots) {
        Object.entries(plcStatus.instocker_slots).forEach(([side, slots]) => {
          const activeSlots = (slots || []).filter(s => s.has_product);
          const productTypes = activeSlots.map(s => `P${s.product_type ?? "?"}`).join(",");
          items.push(
            <Badge 
              key={`ins-slot-${side}`}
              active={activeSlots.length > 0}
              activeColor="#f59e0b"
              activeBg="#fffbeb"
            >
              {side}슬롯 {activeSlots.length > 0 ? `${activeSlots.length}개 (${productTypes})` : "비어있음"}
            </Badge>
          );
        });
      }
      // 연마기 투입 가능 상태
      if (plcStatus.grinders) {
        plcStatus.grinders.forEach((g) => {
          const hasInput = g.positions?.L?.input_ready || g.positions?.R?.input_ready;
          items.push(
            <Badge 
              key={`g-${g.index}`} 
              active={g.bypass || hasInput}
              activeColor={g.bypass ? "#ef4444" : "#3b82f6"}
              activeBg={g.bypass ? "#fef2f2" : "#eff6ff"}
            >
              G{g.index} {g.bypass ? "바이패스" : `L:${g.positions?.L?.input_ready ? "✓" : "-"} R:${g.positions?.R?.input_ready ? "✓" : "-"}`}
            </Badge>
          );
        });
      }
    }
    
    if (scenario === 2) {
      // 연마기 배출 가능 상태
      if (plcStatus.grinders) {
        plcStatus.grinders.forEach((g) => {
          const hasOutput = g.positions?.L?.output_ready || g.positions?.R?.output_ready;
          items.push(
            <Badge 
              key={`g-${g.index}`} 
              active={g.bypass || hasOutput}
              activeColor={g.bypass ? "#ef4444" : "#14b8a6"}
              activeBg={g.bypass ? "#fef2f2" : "#f0fdfa"}
            >
              G{g.index} {g.bypass ? "바이패스" : `L:${g.positions?.L?.output_ready ? "✓" : "-"} R:${g.positions?.R?.output_ready ? "✓" : "-"}`}
            </Badge>
          );
        });
      }
      // 아웃스토커 적재 가능 상태
      if (plcStatus.outstocker) {
        Object.entries(plcStatus.outstocker).forEach(([side, data]) => {
          const readyRows = Object.entries(data.rows || {}).filter(([_, r]) => r.load_ready).map(([row]) => `R${row}`);
          const isBypass = data.bypass;
          items.push(
            <Badge 
              key={`out-${side}`}
              active={isBypass || readyRows.length > 0}
              activeColor={isBypass ? "#ef4444" : "#8b5cf6"}
              activeBg={isBypass ? "#fef2f2" : "#f5f3ff"}
            >
              아웃{side} {isBypass ? "바이패스" : (readyRows.length > 0 ? readyRows.join(",") : "대기")}
            </Badge>
          );
        });
      }
    }
    
    if (scenario === 3) {
      // 아웃스토커 지그 상태
      if (plcStatus.outstocker) {
        Object.entries(plcStatus.outstocker).forEach(([side, data]) => {
          const jigRows = Object.entries(data.rows || {})
            .filter(([_, r]) => r.jig_state)
            .map(([row, r]) => `R${row}:P${r.model_no ?? "?"}`);
          const hasJig = jigRows.length > 0;
          items.push(
            <Badge 
              key={`out-${side}`}
              active={hasJig}
              activeColor="#8b5cf6"
              activeBg="#f5f3ff"
            >
              아웃{side} {hasJig ? jigRows.join(" ") : "지그없음"}
            </Badge>
          );
        });
      }
      // 컨베이어 호출 상태
      if (plcStatus.conveyors) {
        plcStatus.conveyors.forEach((c) => {
          const hasCall = c.call_signal === 1 || c.call_signal === true;
          items.push(
            <Badge 
              key={`c-${c.index}`}
              active={hasCall}
              activeColor="#a855f7"
              activeBg="#fdf4ff"
            >
              C{c.index} {hasCall ? `호출 ${c.qty ?? 0}개` : `대기`}
            </Badge>
          );
        });
      }
    }
    
    return items;
  };
  
  const devices = renderDevices();
  if (devices.length === 0) {
    return <span style={{ fontSize: 11, color: "#94a3b8" }}>PLC 상태 정보 없음</span>;
  }
  
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {devices}
    </div>
  );
};

// 태스크 아이템
const TaskItem = ({ task, expanded, onToggle }) => {
  const StatusIcon = STATUS_CONFIG[task.status]?.icon || ClockCircleFilled;
  const statusColor = STATUS_CONFIG[task.status]?.color || "#64748b";
  const statusBg = STATUS_CONFIG[task.status]?.bg || "#f8fafc";
  
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      marginBottom: 8,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      border: "1px solid #f1f5f9",
      transition: "all 0.2s ease",
    }}>
      {/* 헤더 */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px",
          cursor: "pointer",
          gap: 12,
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        {/* 확장 아이콘 */}
        <div style={{ color: "#94a3b8", fontSize: 10 }}>
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </div>
        
        {/* 상태 아이콘 */}
        <StatusIcon style={{ fontSize: 18, color: statusColor }} />
        
        {/* Task ID */}
        <div style={{ minWidth: 60 }}>
          <Text style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>#{task.taskId}</Text>
        </div>
        
        {/* 시나리오 */}
        <div style={{
          padding: "3px 10px",
          background: "#f1f5f9",
          borderRadius: 6,
          fontSize: 11,
          color: "#475569",
          fontWeight: 500,
          minWidth: 140,
        }}>
          {task.scenario ? SCENARIO_LABELS[task.scenario] || `S${task.scenario}` : "-"}
        </div>
        
        {/* AMR */}
        <div style={{ minWidth: 100 }}>
          <Text style={{ fontSize: 12, color: "#64748b" }}>{task.robotName}</Text>
        </div>
        
        {/* 시간 */}
        <div style={{ minWidth: 120 }}>
          <Text style={{ fontSize: 12, color: "#94a3b8" }}>
            {task.createdAt?.format("MM/DD HH:mm:ss")}
          </Text>
        </div>
        
        {/* 소요 시간 */}
        <div style={{ minWidth: 50 }}>
          {task.duration !== null && (
            <Text style={{ fontSize: 12, color: "#64748b" }}>{task.duration}s</Text>
          )}
        </div>
        
        {/* 스텝 진행 */}
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {task.stepDone > 0 && (
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "#ecfdf5",
              color: "#10b981",
              borderRadius: 4,
            }}>
              {task.stepDone} 완료
            </span>
          )}
          {task.stepFailed > 0 && (
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "#fef2f2",
              color: "#ef4444",
              borderRadius: 4,
            }}>
              {task.stepFailed} 실패
            </span>
          )}
        </div>
      </div>
      
      {/* 확장 영역 */}
      {expanded && (
        <div style={{
          borderTop: "1px solid #f1f5f9",
          padding: 16,
          background: "#fafbfc",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20 }}>
            {/* 요약 */}
            <div>
              <Text style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>
                요약
              </Text>
              {task.summary ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 36 }}>출발</span>
                    <span style={{ fontSize: 12, color: "#334155" }}>{task.summary.source || "-"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 36 }}>도착</span>
                    <span style={{ fontSize: 12, color: "#334155" }}>{task.summary.target || "-"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 36 }}>수량</span>
                    <span style={{ fontSize: 12, color: "#334155" }}>
                      {task.summary.pickup_count ?? 0} → {task.summary.dropoff_count ?? 0}
                    </span>
                  </div>
                </div>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
              )}
            </div>
            
            {/* PLC 상태 */}
            {task.plcStatus && (
              <div>
                <Text style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  생성 시점 PLC 상태
                </Text>
                <div style={{ marginTop: 8 }}>
                  <PlcStatusCompact plcStatus={task.plcStatus} scenario={task.scenario} />
                </div>
              </div>
            )}
          </div>
          
          {/* 로그 타임라인 */}
          <div style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>
              실행 로그
            </Text>
            <div style={{
              marginTop: 8,
              maxHeight: 180,
              overflowY: "auto",
              background: "#fff",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
            }}>
              {task.logs.map((log, idx) => (
                <div
                  key={log.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderBottom: idx < task.logs.length - 1 ? "1px solid #f1f5f9" : "none",
                    fontSize: 12,
                  }}
                >
                  <Text style={{ color: "#94a3b8", fontSize: 11, minWidth: 55, fontFamily: "monospace" }}>
                    {dayjs(log.created_at).format("HH:mm:ss")}
                  </Text>
                  <span style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontWeight: 500,
                    minWidth: 48,
                    textAlign: "center",
                    background: 
                      log.event.includes("DONE") ? "#ecfdf5" :
                      log.event.includes("FAIL") ? "#fef2f2" :
                      log.event.includes("CREATE") ? "#eff6ff" :
                      log.event.includes("START") ? "#f0fdfa" :
                      log.event.includes("CANCEL") ? "#fffbeb" : "#f1f5f9",
                    color:
                      log.event.includes("DONE") ? "#10b981" :
                      log.event.includes("FAIL") ? "#ef4444" :
                      log.event.includes("CREATE") ? "#3b82f6" :
                      log.event.includes("START") ? "#14b8a6" :
                      log.event.includes("CANCEL") ? "#f59e0b" : "#64748b",
                  }}>
                    {log.event.replace("TASK_", "").replace("STEP_", "S-")}
                  </span>
                  {log.step_seq != null && (
                    <Text style={{ color: "#94a3b8", fontSize: 11 }}>
                      #{log.step_seq}
                    </Text>
                  )}
                  <Text style={{ color: "#475569", flex: 1 }} ellipsis>
                    {log.message}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function TaskLogs() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [filters, setFilters] = useState({
    task_id: "",
    robot_name: "",
    event: "",
    dateRange: null,
  });

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", page);
    params.set("limit", pageSize);
    if (filters.task_id) params.set("task_id", filters.task_id);
    if (filters.robot_name) params.set("robot_name", filters.robot_name);
    if (filters.event) params.set("event", filters.event);
    if (filters.dateRange?.[0]) params.set("start_date", filters.dateRange[0].toISOString());
    if (filters.dateRange?.[1]) params.set("end_date", filters.dateRange[1].toISOString());
    return params.toString();
  }, [page, pageSize, filters]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["taskLogs", queryParams],
    queryFn: async () => {
      const r = await fetch(`${API}/api/task-logs?${queryParams}`);
      if (!r.ok) throw new Error("로그 조회 실패");
      return r.json();
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["taskLogStats"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/task-logs/stats`);
      if (!r.ok) throw new Error("통계 조회 실패");
      return r.json();
    },
    refetchInterval: 30000,
  });

  const deleteMut = useMutation({
    mutationFn: async (daysOld) => {
      const r = await fetch(`${API}/api/task-logs?days_old=${daysOld}`, { method: "DELETE" });
      if (!r.ok) throw new Error("삭제 실패");
      return r.json();
    },
    onSuccess: (result) => {
      message.success(result.message);
      qc.invalidateQueries(["taskLogs"]);
      qc.invalidateQueries(["taskLogStats"]);
    },
    onError: () => message.error("삭제 실패"),
  });

  const groupedData = useMemo(() => {
    if (!data?.logs) return [];
    
    const groups = new Map();
    for (const log of data.logs) {
      if (!log.task_id) continue;
      if (!groups.has(log.task_id)) groups.set(log.task_id, []);
      groups.get(log.task_id).push(log);
    }
    
    const result = [];
    for (const [taskId, logs] of groups) {
      logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      const createdLog = logs.find(l => l.event === "TASK_CREATED");
      const endLog = logs.find(l => ["TASK_DONE", "TASK_FAILED", "TASK_CANCELED"].includes(l.event));
      const stepDone = logs.filter(l => l.event === "STEP_DONE").length;
      const stepFailed = logs.filter(l => l.event === "STEP_FAILED").length;
      
      let scenario = null, summary = null, plcStatus = null;
      if (createdLog?.payload) {
        try {
          const payload = typeof createdLog.payload === "string" ? JSON.parse(createdLog.payload) : createdLog.payload;
          scenario = payload.scenario;
          summary = payload.summary;
          plcStatus = payload.plc_status;
        } catch {}
      }
      
      const createdAt = createdLog ? dayjs(createdLog.created_at) : null;
      const endedAt = endLog ? dayjs(endLog.created_at) : null;
      const duration = createdAt && endedAt ? endedAt.diff(createdAt, "second") : null;
      
      let status = "진행중";
      if (endLog?.event === "TASK_DONE") status = "완료";
      else if (endLog?.event === "TASK_FAILED") status = "실패";
      else if (endLog?.event === "TASK_CANCELED") status = "취소";
      
      result.push({
        taskId,
        robotName: createdLog?.robot_name || logs[0]?.robot_name || "-",
        scenario,
        status,
        createdAt,
        duration,
        stepDone,
        stepFailed,
        logs,
        summary,
        plcStatus,
      });
    }
    
    return result.sort((a, b) => b.taskId - a.taskId);
  }, [data?.logs]);

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const toggleExpand = (taskId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const totalTasks = groupedData.length;
  const doneTasks = groupedData.filter(t => t.status === "완료").length;
  const failedTasks = groupedData.filter(t => t.status === "실패").length;
  const runningTasks = groupedData.filter(t => t.status === "진행중").length;

  return (
    <div style={{ 
      padding: 24, 
      background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)", 
      minHeight: "100vh" 
    }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#1e293b" }}>
              태스크 실행 내역
            </h1>
            <Text style={{ color: "#64748b", fontSize: 13 }}>
              AMR 태스크 실행 기록 및 상세 로그
            </Text>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Popconfirm
              title="30일 이전 로그를 삭제합니다"
              onConfirm={() => deleteMut.mutate(30)}
              okText="삭제"
              cancelText="취소"
            >
              <button style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                color: "#64748b",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#ef4444";
                e.currentTarget.style.color = "#ef4444";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.color = "#64748b";
              }}
              >
                <DeleteOutlined /> 정리
              </button>
            </Popconfirm>
            <button
              onClick={() => refetch()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "#3b82f6",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                color: "#fff",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#2563eb"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#3b82f6"}
            >
              <ReloadOutlined spin={isLoading} /> 새로고침
            </button>
          </div>
        </div>
        
        {/* 통계 카드 */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <StatCard label="전체" value={stats?.total || totalTasks} color="#334155" />
          <StatCard label="완료" value={stats?.byEvent?.TASK_DONE || doneTasks} color="#10b981" icon={CheckCircleFilled} />
          <StatCard label="실패" value={stats?.byEvent?.TASK_FAILED || failedTasks} color="#ef4444" icon={CloseCircleFilled} />
          <StatCard label="진행중" value={runningTasks} color="#3b82f6" icon={ClockCircleFilled} />
        </div>
        
        {/* 필터 */}
        <div style={{
          display: "flex",
          gap: 10,
          padding: 12,
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          <Input
            placeholder="Task ID"
            prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
            value={filters.task_id}
            onChange={(e) => handleFilterChange("task_id", e.target.value)}
            style={{ width: 110, borderRadius: 6 }}
            allowClear
            size="middle"
          />
          <Input
            placeholder="AMR"
            value={filters.robot_name}
            onChange={(e) => handleFilterChange("robot_name", e.target.value)}
            style={{ width: 120, borderRadius: 6 }}
            allowClear
            size="middle"
          />
          <Select
            placeholder="상태"
            value={filters.event || undefined}
            onChange={(v) => handleFilterChange("event", v)}
            style={{ width: 100 }}
            allowClear
            size="middle"
            options={[
              { value: "TASK_CREATED", label: "생성" },
              { value: "TASK_DONE", label: "완료" },
              { value: "TASK_FAILED", label: "실패" },
              { value: "TASK_CANCELED", label: "취소" },
            ]}
          />
          <RangePicker
            value={filters.dateRange}
            onChange={(v) => handleFilterChange("dateRange", v)}
            format="MM-DD"
            size="middle"
            style={{ borderRadius: 6 }}
          />
          <button
            onClick={() => {
              setFilters({ task_id: "", robot_name: "", event: "", dateRange: null });
              setPage(1);
            }}
            style={{
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              color: "#64748b",
            }}
          >
            초기화
          </button>
        </div>
      </div>
      
      {/* 태스크 리스트 */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : groupedData.length === 0 ? (
        <div style={{
          background: "#fff",
          borderRadius: 12,
          padding: 60,
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          <Empty description="실행 내역이 없습니다" />
        </div>
      ) : (
        <div>
          {groupedData.slice(0, 50).map((task) => (
            <TaskItem
              key={task.taskId}
              task={task}
              expanded={expandedIds.has(task.taskId)}
              onToggle={() => toggleExpand(task.taskId)}
            />
          ))}
          {groupedData.length > 50 && (
            <div style={{ textAlign: "center", padding: 16 }}>
              <Text type="secondary">최근 50개 태스크만 표시됩니다</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
