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
  완료: { icon: CheckCircleFilled, color: "#10b981" },
  실패: { icon: CloseCircleFilled, color: "#ef4444" },
  취소: { icon: MinusCircleFilled, color: "#f59e0b" },
  진행중: { icon: ClockCircleFilled, color: "#3b82f6" },
};

// 통계 카드
const StatCard = ({ label, value, color, icon: Icon }) => (
  <div style={{
    background: "#fff",
    borderRadius: 8,
    padding: "12px 16px",
    minWidth: 90,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
      {Icon && <Icon style={{ fontSize: 11, color }} />}
      <span style={{ fontSize: 10, color: "#9ca3af" }}>{label}</span>
    </div>
    <span style={{ fontSize: 18, fontWeight: 600, color }}>{value}</span>
  </div>
);

// PLC 값 표시
const PlcVal = ({ data }) => {
  if (!data || data.value == null) return <span style={{ color: "#d1d5db" }}>-</span>;
  const { addr, value } = data;
  const isOn = value === 1 || value === true;
  const isWord = typeof value === "number" && value > 1;
  return (
    <span
      title={addr || undefined}
      style={{
        color: isOn ? "#10b981" : isWord ? "#3b82f6" : "#9ca3af",
        fontWeight: isOn || isWord ? 500 : 400,
        cursor: addr ? "help" : "default",
      }}
    >
      {isWord ? value : isOn ? "1" : "0"}
    </span>
  );
};

// PLC 테이블
const PlcTable = ({ headers, rows }) => (
  <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={i} style={{
            padding: "3px 5px",
            background: "#f8fafc",
            borderBottom: "1px solid #e5e7eb",
            textAlign: "left",
            fontWeight: 500,
            color: "#6b7280",
            whiteSpace: "nowrap",
          }}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>
);

const Td = ({ children, bold }) => (
  <td style={{ padding: "3px 5px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: bold ? 500 : 400 }}>
    {children}
  </td>
);

// 시나리오별 PLC 상태
const PlcStatusSection = ({ plcStatus, scenario }) => {
  if (!plcStatus) return <span style={{ color: "#9ca3af", fontSize: 10 }}>PLC 정보 없음</span>;

  if (scenario === 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>인스토커</div>
          <PlcTable
            headers={["", "작업 가능", "작업중", "완료"]}
            rows={Object.entries(plcStatus.instocker || {}).map(([side, d]) => (
              <tr key={side}>
                <Td bold>{side}</Td>
                <Td><PlcVal data={d.work_available} /></Td>
                <Td><PlcVal data={d.working} /></Td>
                <Td><PlcVal data={d.work_done} /></Td>
              </tr>
            ))}
          />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>인스토커 슬롯</div>
          <PlcTable
            headers={["슬롯", "AMR Pos", "Mani Pos", "제품타입"]}
            rows={Object.entries(plcStatus.instocker_slots || {}).flatMap(([side, slots]) =>
              (slots || []).map((s, i) => (
                <tr key={`${side}-${i}`}>
                  <Td bold>{side}-{s.key || i + 1}</Td>
                  <Td>{s.amr_pos || "-"}</Td>
                  <Td>{s.mani_pos || "-"}</Td>
                  <Td><PlcVal data={s.product_type} /></Td>
                </tr>
              ))
            )}
          />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>연마기</div>
          <PlcTable
            headers={["", "AMR Pos", "바이패스", "L-투입 가능", "L-투입중", "L-투입완료", "R-투입 가능", "R-투입중", "R-투입완료"]}
            rows={(plcStatus.grinders || []).map((g) => (
              <tr key={g.index}>
                <Td bold>G{g.index}</Td>
                <Td>{g.amr_pos || "-"}</Td>
                <Td><PlcVal data={g.bypass} /></Td>
                <Td><PlcVal data={g.positions?.L?.input_ready} /></Td>
                <Td><PlcVal data={g.positions?.L?.input_working} /></Td>
                <Td><PlcVal data={g.positions?.L?.input_done} /></Td>
                <Td><PlcVal data={g.positions?.R?.input_ready} /></Td>
                <Td><PlcVal data={g.positions?.R?.input_working} /></Td>
                <Td><PlcVal data={g.positions?.R?.input_done} /></Td>
              </tr>
            ))}
          />
        </div>
      </div>
    );
  }

  if (scenario === 2) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>연마기</div>
          <PlcTable
            headers={["", "AMR Pos", "바이패스", "L-배출 가능", "L-배출중", "L-배출 완료", "L-제품타입", "R-배출 가능", "R-배출중", "R-배출 완료", "R-제품타입"]}
            rows={(plcStatus.grinders || []).map((g) => (
              <tr key={g.index}>
                <Td bold>G{g.index}</Td>
                <Td>{g.amr_pos || "-"}</Td>
                <Td><PlcVal data={g.bypass} /></Td>
                <Td><PlcVal data={g.positions?.L?.output_ready} /></Td>
                <Td><PlcVal data={g.positions?.L?.output_working} /></Td>
                <Td><PlcVal data={g.positions?.L?.output_done} /></Td>
                <Td><PlcVal data={g.positions?.L?.product_type} /></Td>
                <Td><PlcVal data={g.positions?.R?.output_ready} /></Td>
                <Td><PlcVal data={g.positions?.R?.output_working} /></Td>
                <Td><PlcVal data={g.positions?.R?.output_done} /></Td>
                <Td><PlcVal data={g.positions?.R?.product_type} /></Td>
              </tr>
            ))}
          />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>아웃스토커 (적재 가능)</div>
          <PlcTable
            headers={["", "AMR Pos", "바이패스", "R1", "R2", "R3", "R4", "R5", "R6"]}
            rows={Object.entries(plcStatus.outstocker || {}).map(([side, d]) => (
              <tr key={side}>
                <Td bold>{side}</Td>
                <Td>{d.amr_pos || "-"}</Td>
                <Td><PlcVal data={d.bypass} /></Td>
                {[1, 2, 3, 4, 5, 6].map((r) => (
                  <Td key={r}><PlcVal data={d.rows?.[r]?.load_ready} /></Td>
                ))}
              </tr>
            ))}
          />
        </div>
      </div>
    );
  }

  if (scenario === 3) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>아웃스토커 (공지그 상태 / 모델 번호)</div>
          <PlcTable
            headers={["", "AMR Pos", "바이패스", "R1 공지그", "R1 모델", "R2 공지그", "R2 모델", "R3 공지그", "R3 모델", "R4 공지그", "R4 모델", "R5 공지그", "R5 모델", "R6 공지그", "R6 모델"]}
            rows={Object.entries(plcStatus.outstocker || {}).map(([side, d]) => (
              <tr key={side}>
                <Td bold>{side}</Td>
                <Td>{d.amr_pos || "-"}</Td>
                <Td><PlcVal data={d.bypass} /></Td>
                {[1, 2, 3, 4, 5, 6].flatMap((r) => [
                  <Td key={`${r}j`}><PlcVal data={d.rows?.[r]?.jig_state} /></Td>,
                  <Td key={`${r}m`}><PlcVal data={d.rows?.[r]?.model_no} /></Td>,
                ])}
              </tr>
            ))}
          />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>컨베이어</div>
          <PlcTable
            headers={["", "AMR Pos", "제품번호", "호출신호", "호출수량", "투입수량1", "투입수량4", "투입중", "투입완료"]}
            rows={(plcStatus.conveyors || []).map((c) => (
              <tr key={c.index}>
                <Td bold>C{c.index}</Td>
                <Td>{c.amr_pos || "-"}</Td>
                <Td>{c.product_no ?? "-"}</Td>
                <Td><PlcVal data={c.call_signal} /></Td>
                <Td><PlcVal data={c.call_qty} /></Td>
                <Td><PlcVal data={c.input_qty_1} /></Td>
                <Td><PlcVal data={c.input_qty_4} /></Td>
                <Td><PlcVal data={c.working} /></Td>
                <Td><PlcVal data={c.work_done} /></Td>
              </tr>
            ))}
          />
        </div>
      </div>
    );
  }

  return null;
};

// 스텝 리스트
const StepList = ({ steps }) => {
  if (!steps?.length) return <span style={{ color: "#9ca3af", fontSize: 10 }}>스텝 정보 없음</span>;

  const formatStep = (step) => {
    const { type, payload } = step;
    if (type === "NAV") return payload?.dest || "-";
    if (type === "MANI_WORK") {
      const p = payload || {};
      return `CMD:${p.CMD_ID ?? "-"} FROM:${p.CMD_FROM ?? "-"} TO:${p.CMD_TO ?? "-"} P:${p.PRODUCT_NO ?? "-"} V:${p.VISION_CHECK ?? "-"}`;
    }
    if (type === "PLC_WRITE") {
      const p = payload || {};
      return `${p.PLC_BIT || "-"} = ${p.PLC_DATA ?? "-"}`;
    }
    if (type === "PLC_WAIT") {
      const p = payload || {};
      return `${p.PLC_BIT || "-"} == ${p.PLC_DATA ?? "-"}`;
    }
    return JSON.stringify(payload);
  };

  const typeColors = {
    NAV: "#3b82f6",
    MANI_WORK: "#14b8a6",
    PLC_WRITE: "#a855f7",
    PLC_WAIT: "#f59e0b",
  };

  return (
    <div style={{ maxHeight: 180, overflowY: "auto" }}>
      {steps.map((step, idx) => (
        <div key={idx} style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 0",
          borderBottom: "1px solid #f5f5f5",
          fontSize: 10,
        }}>
          <span style={{ color: "#9ca3af", width: 18 }}>{step.seq ?? idx}</span>
          <span style={{
            padding: "1px 4px",
            borderRadius: 2,
            background: `${typeColors[step.type] || "#6b7280"}15`,
            color: typeColors[step.type] || "#6b7280",
            fontWeight: 500,
            fontSize: 9,
          }}>
            {step.type}
          </span>
          <span style={{ color: "#4b5563", fontFamily: "monospace", fontSize: 9 }}>
            {formatStep(step)}
          </span>
        </div>
      ))}
    </div>
  );
};

// 스텝 로그 아이템 (시작 카드 하위)
const StepLogItem = ({ log, steps }) => {
  const [expanded, setExpanded] = useState(false);
  
  const evtConfig = {
    STEP_STARTED: { color: "#6366f1", label: "시작" },
    STEP_DONE: { color: "#22c55e", label: "완료" },
    STEP_FAILED: { color: "#f87171", label: "실패" },
  };
  
  const cfg = evtConfig[log.event] || { color: "#6b7280", label: log.event };
  const step = log.step_seq != null && steps?.[log.step_seq];
  
  return (
    <div style={{ marginLeft: 12, borderLeft: "2px solid #e5e7eb", paddingLeft: 8, marginBottom: 2 }}>
      <div
        onClick={() => step && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 0",
          cursor: step ? "pointer" : "default",
          gap: 6,
          fontSize: 10,
        }}
      >
        {step && (
          <span style={{ color: "#9ca3af", fontSize: 8 }}>
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
        )}
        <span style={{ color: "#9ca3af", fontFamily: "monospace", minWidth: 45 }}>
          {dayjs(log.created_at).format("HH:mm:ss")}
        </span>
        <span style={{
          padding: "1px 4px",
          borderRadius: 2,
          background: `${cfg.color}15`,
          color: cfg.color,
          fontWeight: 500,
          fontSize: 9,
        }}>
          #{log.step_seq} {cfg.label}
        </span>
        <span style={{ color: "#4b5563", flex: 1 }}>{log.message}</span>
      </div>
      {expanded && step && (
        <div style={{ padding: "4px 0 4px 20px", fontSize: 10, color: "#374151", fontFamily: "monospace" }}>
          {(() => {
            const p = step.payload || {};
            if (step.type === "NAV") return `목적지: ${p.dest || "-"}`;
            if (step.type === "MANI_WORK") {
              return `CMD:${p.CMD_ID ?? "-"} FROM:${p.CMD_FROM ?? "-"} TO:${p.CMD_TO ?? "-"} P:${p.PRODUCT_NO ?? "-"} V:${p.VISION_CHECK ?? "-"}`;
            }
            if (step.type === "PLC_WRITE") return `${p.PLC_BIT || "-"} = ${p.PLC_DATA ?? "-"}`;
            if (step.type === "PLC_WAIT") return `${p.PLC_BIT || "-"} == ${p.PLC_DATA ?? "-"}`;
            return JSON.stringify(p);
          })()}
        </div>
      )}
    </div>
  );
};

// 로그 아이템 (드롭다운)
const LogItem = ({ log, scenario, plcStatus, steps, summary, stepLogs }) => {
  const [expanded, setExpanded] = useState(false);

  const evtConfig = {
    TASK_CREATED: { color: "#3b82f6", label: "생성" },
    TASK_STARTED: { color: "#14b8a6", label: "시작" },
    TASK_DONE: { color: "#10b981", label: "완료" },
    TASK_FAILED: { color: "#ef4444", label: "실패" },
    TASK_CANCELED: { color: "#f59e0b", label: "취소" },
  };

  const cfg = evtConfig[log.event] || { color: "#6b7280", label: log.event };
  const hasDetail = log.event === "TASK_CREATED" || (log.event === "TASK_STARTED" && stepLogs?.length > 0);

  return (
    <div style={{
      background: "#fff",
      borderRadius: 6,
      marginBottom: 4,
      border: "1px solid #f3f4f6",
      overflow: "hidden",
    }}>
      {/* 헤더 */}
      <div
        onClick={() => hasDetail && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 10px",
          cursor: hasDetail ? "pointer" : "default",
          gap: 8,
        }}
      >
        {hasDetail && (
          <span style={{ color: "#9ca3af", fontSize: 8 }}>
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
        )}
        <span style={{
          fontFamily: "monospace",
          fontSize: 10,
          color: "#9ca3af",
          minWidth: 50,
        }}>
          {dayjs(log.created_at).format("HH:mm:ss")}
        </span>
        <span style={{
          padding: "2px 6px",
          borderRadius: 3,
          background: `${cfg.color}15`,
          color: cfg.color,
          fontWeight: 500,
          fontSize: 10,
          minWidth: 50,
          textAlign: "center",
        }}>
          {cfg.label}
        </span>
        <span style={{ color: "#374151", fontSize: 11, flex: 1 }}>{log.message}</span>
        {log.event === "TASK_STARTED" && stepLogs?.length > 0 && (
          <span style={{ color: "#9ca3af", fontSize: 10 }}>{stepLogs.length}스텝</span>
        )}
      </div>

      {/* 상세 (드롭다운) */}
      {expanded && hasDetail && (
        <div style={{ padding: "8px 10px", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
          {log.event === "TASK_CREATED" && (
            <div style={{ display: "flex", gap: 16 }}>
              {/* 요약 + 스텝 */}
              <div style={{ minWidth: 200 }}>
                {summary && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>요약</div>
                    <div style={{ fontSize: 10, color: "#374151", lineHeight: 1.5 }}>
                      <div><span style={{ color: "#9ca3af" }}>출발</span> {summary.source || "-"}</div>
                      <div><span style={{ color: "#9ca3af" }}>도착</span> {summary.target || "-"}</div>
                      <div><span style={{ color: "#9ca3af" }}>수량</span> {summary.pickup_count ?? 0} → {summary.dropoff_count ?? 0}</div>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>스텝 리스트 ({steps?.length || 0})</div>
                <StepList steps={steps} />
              </div>
              {/* PLC 상태 */}
              <div style={{ flex: 1, overflowX: "auto" }}>
                <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>생성 시점 PLC 상태</div>
                <PlcStatusSection plcStatus={plcStatus} scenario={scenario} />
              </div>
            </div>
          )}

          {log.event === "TASK_STARTED" && stepLogs?.length > 0 && (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {stepLogs.map((slog) => (
                <StepLogItem key={slog.id} log={slog} steps={steps} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 태스크 그룹
const TaskGroup = ({ task, expanded, onToggle }) => {
  const StatusIcon = STATUS_CONFIG[task.status]?.icon || ClockCircleFilled;
  const statusColor = STATUS_CONFIG[task.status]?.color || "#6b7280";

  // 스텝 로그를 분리 (TASK_STARTED 하위로 이동)
  const mainLogs = (task.logs || []).filter(l => !l.event.startsWith("STEP_"));
  const stepLogs = (task.logs || []).filter(l => l.event.startsWith("STEP_"));

  return (
    <div style={{
      background: "#fff",
      borderRadius: 8,
      marginBottom: 8,
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      border: "1px solid #e5e7eb",
      overflow: "hidden",
    }}>
      {/* 태스크 헤더 */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px",
          cursor: "pointer",
          gap: 10,
          background: expanded ? "#f9fafb" : "#fff",
        }}
      >
        <span style={{ color: "#9ca3af", fontSize: 9 }}>
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </span>
        <StatusIcon style={{ fontSize: 14, color: statusColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1f2937" }}>#{task.taskId}</span>
        <span style={{
          padding: "2px 6px",
          background: "#f3f4f6",
          borderRadius: 3,
          fontSize: 10,
          color: "#4b5563",
        }}>
          {task.scenario ? SCENARIO_LABELS[task.scenario] : "-"}
        </span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{task.robotName}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{task.createdAt?.format("MM/DD HH:mm:ss")}</span>
        {task.duration != null && <span style={{ fontSize: 10, color: "#6b7280" }}>{task.duration}s</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{mainLogs.length}건</span>
      </div>

      {/* 로그 목록 */}
      {expanded && (
        <div style={{ padding: "8px 12px", background: "#f9fafb" }}>
          {mainLogs.map((log) => (
            <LogItem
              key={log.id}
              log={log}
              scenario={task.scenario}
              plcStatus={task.plcStatus}
              steps={task.steps}
              summary={task.summary}
              stepLogs={log.event === "TASK_STARTED" ? stepLogs : undefined}
            />
          ))}
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
    <div style={{ padding: 16, background: "#f3f4f6", minHeight: "100vh" }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#111827" }}>태스크 실행 로그</h1>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Popconfirm
              title="30일 이전 로그 삭제"
              onConfirm={() => deleteMut.mutate(30)}
              okText="삭제"
              cancelText="취소"
            >
              <button style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                color: "#6b7280",
              }}>
                <DeleteOutlined /> 정리
              </button>
            </Popconfirm>
            <button
              onClick={() => refetch()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                background: "#3b82f6",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                color: "#fff",
              }}
            >
              <ReloadOutlined spin={isLoading} /> 새로고침
            </button>
          </div>
        </div>

        {/* 통계 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <StatCard label="전체" value={stats?.total || totalTasks} color="#111827" />
          <StatCard label="완료" value={stats?.byEvent?.TASK_DONE || doneTasks} color="#10b981" icon={CheckCircleFilled} />
          <StatCard label="실패" value={stats?.byEvent?.TASK_FAILED || failedTasks} color="#ef4444" icon={CloseCircleFilled} />
          <StatCard label="진행중" value={runningTasks} color="#3b82f6" icon={ClockCircleFilled} />
        </div>

        {/* 필터 */}
        <div style={{
          display: "flex",
          gap: 6,
          padding: 8,
          background: "#fff",
          borderRadius: 6,
        }}>
          <Input
            placeholder="Task ID"
            prefix={<SearchOutlined style={{ color: "#9ca3af" }} />}
            value={filters.task_id}
            onChange={(e) => handleFilterChange("task_id", e.target.value)}
            style={{ width: 90 }}
            allowClear
            size="small"
          />
          <Input
            placeholder="AMR"
            value={filters.robot_name}
            onChange={(e) => handleFilterChange("robot_name", e.target.value)}
            style={{ width: 90 }}
            allowClear
            size="small"
          />
          <Select
            placeholder="상태"
            value={filters.event || undefined}
            onChange={(v) => handleFilterChange("event", v)}
            style={{ width: 80 }}
            allowClear
            size="small"
            options={[
              { value: "TASK_DONE", label: "완료" },
              { value: "TASK_FAILED", label: "실패" },
              { value: "TASK_CANCELED", label: "취소" },
            ]}
          />
          <RangePicker
            value={filters.dateRange}
            onChange={(v) => handleFilterChange("dateRange", v)}
            format="MM-DD"
            size="small"
          />
          <button
            onClick={() => {
              setFilters({ task_id: "", robot_name: "", event: "", dateRange: null });
              setPage(1);
            }}
            style={{
              padding: "2px 8px",
              background: "transparent",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 11,
              color: "#6b7280",
            }}
          >
            초기화
          </button>
        </div>
      </div>

      {/* 리스트 */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : groupedData.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 8, padding: 40, textAlign: "center" }}>
          <Empty description="실행 내역 없음" />
        </div>
      ) : (
        <div>
          {groupedData.slice(0, 50).map((task) => (
            <TaskGroup
              key={task.taskId}
              task={task}
              expanded={expandedIds.has(task.taskId)}
              onToggle={() => toggleExpand(task.taskId)}
            />
          ))}
          {groupedData.length > 50 && (
            <div style={{ textAlign: "center", padding: 10, color: "#9ca3af", fontSize: 11 }}>
              최근 50개만 표시
            </div>
          )}
        </div>
      )}
    </div>
  );
}
