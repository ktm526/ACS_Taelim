// src/pages/TaskLogs/index.jsx
import React, { useState, useMemo, useCallback } from "react";
import {
  Input,
  Select,
  DatePicker,
  Typography,
  message,
  Popconfirm,
  Empty,
  Spin,
  Tabs,
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

// PLC 값 셀 (주소 + 값)
const PlcCell = ({ data, label }) => {
  if (!data) return <span style={{ color: "#cbd5e1" }}>-</span>;
  const { addr, value } = data;
  const isOn = value === 1 || value === true;
  const isWord = typeof value === "number" && value > 1;
  return (
    <span 
      title={addr || "주소 없음"}
      style={{ 
        color: isOn ? "#10b981" : isWord ? "#3b82f6" : "#94a3b8",
        fontWeight: isOn || isWord ? 500 : 400,
        cursor: addr ? "help" : "default",
      }}
    >
      {isWord ? value : (isOn ? "ON" : "OFF")}
    </span>
  );
};

// 상세 PLC 상태 테이블
const PlcStatusDetail = ({ plcStatus, scenario }) => {
  if (!plcStatus) return <Text type="secondary" style={{ fontSize: 11 }}>PLC 상태 정보 없음</Text>;
  
  const tableStyle = {
    width: "100%",
    fontSize: 11,
    borderCollapse: "collapse",
  };
  const thStyle = {
    padding: "6px 8px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    fontWeight: 500,
    color: "#475569",
  };
  const tdStyle = {
    padding: "6px 8px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155",
  };
  
  if (scenario === 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 인스토커 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>인스토커</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>사이드</th>
                <th style={thStyle}>작업가능</th>
                <th style={thStyle}>작업중</th>
                <th style={thStyle}>작업완료</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(plcStatus.instocker || {}).map(([side, data]) => (
                <tr key={side}>
                  <td style={tdStyle}><strong>{side}</strong></td>
                  <td style={tdStyle}><PlcCell data={data.work_available} /></td>
                  <td style={tdStyle}><PlcCell data={data.working} /></td>
                  <td style={tdStyle}><PlcCell data={data.work_done} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 인스토커 슬롯 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>인스토커 슬롯</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>슬롯</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>MANI위치</th>
                <th style={thStyle}>제품타입</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(plcStatus.instocker_slots || {}).flatMap(([side, slots]) =>
                (slots || []).map((slot, idx) => (
                  <tr key={`${side}-${idx}`}>
                    <td style={tdStyle}><strong>{side}-{slot.key || idx + 1}</strong></td>
                    <td style={tdStyle}>{slot.amr_pos || "-"}</td>
                    <td style={tdStyle}>{slot.mani_pos || "-"}</td>
                    <td style={tdStyle}><PlcCell data={slot.product_type} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* 연마기 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>연마기</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>연마기</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>바이패스</th>
                <th style={thStyle}>L-투입가능</th>
                <th style={thStyle}>L-투입중</th>
                <th style={thStyle}>L-투입완료</th>
                <th style={thStyle}>R-투입가능</th>
                <th style={thStyle}>R-투입중</th>
                <th style={thStyle}>R-투입완료</th>
              </tr>
            </thead>
            <tbody>
              {(plcStatus.grinders || []).map((g) => (
                <tr key={g.index}>
                  <td style={tdStyle}><strong>G{g.index}</strong></td>
                  <td style={tdStyle}>{g.amr_pos || "-"}</td>
                  <td style={tdStyle}><PlcCell data={g.bypass} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.input_ready} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.input_working} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.input_done} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.input_ready} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.input_working} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.input_done} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  if (scenario === 2) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 연마기 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>연마기 배출</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>연마기</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>바이패스</th>
                <th style={thStyle}>L-배출가능</th>
                <th style={thStyle}>L-배출중</th>
                <th style={thStyle}>L-배출완료</th>
                <th style={thStyle}>L-제품</th>
                <th style={thStyle}>R-배출가능</th>
                <th style={thStyle}>R-배출중</th>
                <th style={thStyle}>R-배출완료</th>
                <th style={thStyle}>R-제품</th>
              </tr>
            </thead>
            <tbody>
              {(plcStatus.grinders || []).map((g) => (
                <tr key={g.index}>
                  <td style={tdStyle}><strong>G{g.index}</strong></td>
                  <td style={tdStyle}>{g.amr_pos || "-"}</td>
                  <td style={tdStyle}><PlcCell data={g.bypass} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.output_ready} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.output_working} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.output_done} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.L?.product_type} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.output_ready} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.output_working} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.output_done} /></td>
                  <td style={tdStyle}><PlcCell data={g.positions?.R?.product_type} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 아웃스토커 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>아웃스토커 적재</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>라인</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>바이패스</th>
                <th style={thStyle}>R1</th>
                <th style={thStyle}>R2</th>
                <th style={thStyle}>R3</th>
                <th style={thStyle}>R4</th>
                <th style={thStyle}>R5</th>
                <th style={thStyle}>R6</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(plcStatus.outstocker || {}).map(([side, data]) => (
                <tr key={side}>
                  <td style={tdStyle}><strong>{side}</strong></td>
                  <td style={tdStyle}>{data.amr_pos || "-"}</td>
                  <td style={tdStyle}><PlcCell data={data.bypass} /></td>
                  {[1, 2, 3, 4, 5, 6].map((row) => (
                    <td key={row} style={tdStyle}>
                      <PlcCell data={data.rows?.[row]?.load_ready} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  if (scenario === 3) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 아웃스토커 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>아웃스토커 지그</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>라인</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>바이패스</th>
                <th style={thStyle}>R1 지그</th>
                <th style={thStyle}>R1 모델</th>
                <th style={thStyle}>R2 지그</th>
                <th style={thStyle}>R2 모델</th>
                <th style={thStyle}>R3 지그</th>
                <th style={thStyle}>R3 모델</th>
                <th style={thStyle}>R4 지그</th>
                <th style={thStyle}>R4 모델</th>
                <th style={thStyle}>R5 지그</th>
                <th style={thStyle}>R5 모델</th>
                <th style={thStyle}>R6 지그</th>
                <th style={thStyle}>R6 모델</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(plcStatus.outstocker || {}).map(([side, data]) => (
                <tr key={side}>
                  <td style={tdStyle}><strong>{side}</strong></td>
                  <td style={tdStyle}>{data.amr_pos || "-"}</td>
                  <td style={tdStyle}><PlcCell data={data.bypass} /></td>
                  {[1, 2, 3, 4, 5, 6].flatMap((row) => [
                    <td key={`${row}-jig`} style={tdStyle}><PlcCell data={data.rows?.[row]?.jig_state} /></td>,
                    <td key={`${row}-model`} style={tdStyle}><PlcCell data={data.rows?.[row]?.model_no} /></td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 컨베이어 */}
        <div>
          <Text strong style={{ fontSize: 11, color: "#64748b" }}>컨베이어</Text>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>컨베이어</th>
                <th style={thStyle}>AMR위치</th>
                <th style={thStyle}>제품번호</th>
                <th style={thStyle}>호출신호</th>
                <th style={thStyle}>호출수량</th>
                <th style={thStyle}>투입1</th>
                <th style={thStyle}>투입4</th>
                <th style={thStyle}>작업중</th>
                <th style={thStyle}>작업완료</th>
              </tr>
            </thead>
            <tbody>
              {(plcStatus.conveyors || []).map((c) => (
                <tr key={c.index}>
                  <td style={tdStyle}><strong>C{c.index}</strong></td>
                  <td style={tdStyle}>{c.amr_pos || "-"}</td>
                  <td style={tdStyle}>{c.product_no ?? "-"}</td>
                  <td style={tdStyle}><PlcCell data={c.call_signal} /></td>
                  <td style={tdStyle}><PlcCell data={c.call_qty} /></td>
                  <td style={tdStyle}><PlcCell data={c.input_qty_1} /></td>
                  <td style={tdStyle}><PlcCell data={c.input_qty_4} /></td>
                  <td style={tdStyle}><PlcCell data={c.working} /></td>
                  <td style={tdStyle}><PlcCell data={c.work_done} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  return <Text type="secondary" style={{ fontSize: 11 }}>지원되지 않는 시나리오</Text>;
};

// 스텝 리스트 표시
const StepList = ({ steps }) => {
  if (!steps || steps.length === 0) {
    return <Text type="secondary" style={{ fontSize: 11 }}>스텝 정보 없음</Text>;
  }
  
  const stepTypeColors = {
    NAV: { bg: "#eff6ff", color: "#3b82f6" },
    MANI_WORK: { bg: "#f0fdfa", color: "#14b8a6" },
    PLC_WRITE: { bg: "#fdf4ff", color: "#a855f7" },
    PLC_WAIT: { bg: "#fffbeb", color: "#f59e0b" },
    WAIT: { bg: "#f1f5f9", color: "#64748b" },
  };
  
  const formatPayload = (type, payload) => {
    if (!payload) return "-";
    if (type === "NAV") {
      return payload.dest || "-";
    }
    if (type === "MANI_WORK") {
      const parts = [];
      if (payload.CMD_ID != null) parts.push(`CMD:${payload.CMD_ID}`);
      if (payload.CMD_FROM != null) parts.push(`FROM:${payload.CMD_FROM}`);
      if (payload.CMD_TO != null) parts.push(`TO:${payload.CMD_TO}`);
      if (payload.PRODUCT_NO != null) parts.push(`P:${payload.PRODUCT_NO}`);
      if (payload.VISION_CHECK != null) parts.push(`V:${payload.VISION_CHECK}`);
      return parts.join(" ");
    }
    if (type === "PLC_WRITE") {
      return `${payload.address} = ${payload.value}`;
    }
    if (type === "PLC_WAIT") {
      return `${payload.address} == ${payload.expected}`;
    }
    return JSON.stringify(payload);
  };
  
  return (
    <div style={{ 
      maxHeight: 300, 
      overflowY: "auto",
      background: "#fff",
      borderRadius: 8,
      border: "1px solid #e2e8f0",
    }}>
      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "1px solid #e2e8f0", width: 40 }}>#</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "1px solid #e2e8f0", width: 80 }}>타입</th>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>내용</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, idx) => {
            const typeStyle = stepTypeColors[step.type] || { bg: "#f1f5f9", color: "#64748b" };
            return (
              <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{step.seq ?? idx}</td>
                <td style={{ padding: "6px 8px" }}>
                  <span style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 500,
                    background: typeStyle.bg,
                    color: typeStyle.color,
                  }}>
                    {step.type}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", color: "#475569", fontFamily: "monospace", fontSize: 10 }}>
                  {formatPayload(step.type, step.payload)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// 태스크 아이템
const TaskItem = ({ task, expanded, onToggle }) => {
  const [activeTab, setActiveTab] = useState("summary");
  const StatusIcon = STATUS_CONFIG[task.status]?.icon || ClockCircleFilled;
  const statusColor = STATUS_CONFIG[task.status]?.color || "#64748b";
  
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
        <div style={{ color: "#94a3b8", fontSize: 10 }}>
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </div>
        <StatusIcon style={{ fontSize: 18, color: statusColor }} />
        <div style={{ minWidth: 60 }}>
          <Text style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>#{task.taskId}</Text>
        </div>
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
        <div style={{ minWidth: 100 }}>
          <Text style={{ fontSize: 12, color: "#64748b" }}>{task.robotName}</Text>
        </div>
        <div style={{ minWidth: 120 }}>
          <Text style={{ fontSize: 12, color: "#94a3b8" }}>
            {task.createdAt?.format("MM/DD HH:mm:ss")}
          </Text>
        </div>
        <div style={{ minWidth: 50 }}>
          {task.duration !== null && (
            <Text style={{ fontSize: 12, color: "#64748b" }}>{task.duration}s</Text>
          )}
        </div>
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
        <div style={{ borderTop: "1px solid #f1f5f9", background: "#fafbfc" }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            size="small"
            style={{ padding: "0 16px" }}
            items={[
              {
                key: "summary",
                label: "요약",
                children: (
                  <div style={{ padding: "12px 0" }}>
                    {task.summary ? (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary">출발:</Text> <Text strong>{task.summary.source || "-"}</Text>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <Text type="secondary">도착:</Text> <Text strong>{task.summary.target || "-"}</Text>
                        </div>
                        <div>
                          <Text type="secondary">수량:</Text> <Text strong>{task.summary.pickup_count ?? 0} → {task.summary.dropoff_count ?? 0}</Text>
                        </div>
                      </div>
                    ) : (
                      <Text type="secondary">요약 정보 없음</Text>
                    )}
                  </div>
                ),
              },
              {
                key: "steps",
                label: `스텝 (${task.steps?.length || 0})`,
                children: (
                  <div style={{ padding: "12px 0" }}>
                    <StepList steps={task.steps} />
                  </div>
                ),
              },
              {
                key: "plc",
                label: "PLC 상태",
                children: (
                  <div style={{ padding: "12px 0", overflowX: "auto" }}>
                    <PlcStatusDetail plcStatus={task.plcStatus} scenario={task.scenario} />
                  </div>
                ),
              },
              {
                key: "logs",
                label: `실행 로그 (${task.logs?.length || 0})`,
                children: (
                  <div style={{ padding: "12px 0" }}>
                    <div style={{
                      maxHeight: 200,
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
                ),
              },
            ]}
          />
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
      
      let scenario = null, summary = null, plcStatus = null, steps = null;
      if (createdLog?.payload) {
        try {
          const payload = typeof createdLog.payload === "string" ? JSON.parse(createdLog.payload) : createdLog.payload;
          scenario = payload.scenario;
          summary = payload.summary;
          plcStatus = payload.plc_status;
          steps = payload.steps;
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
        steps,
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
