// src/pages/TaskLogs/index.jsx
import React, { useState, useMemo, useCallback } from "react";
import {
  Card,
  Tag,
  Button,
  Space,
  Input,
  Select,
  DatePicker,
  Modal,
  Typography,
  message,
  Row,
  Col,
  Tooltip,
  Popconfirm,
  Collapse,
  Timeline,
  Badge,
  Empty,
  Spin,
  Descriptions,
  Divider,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  RocketOutlined,
  StopOutlined,
  DownOutlined,
  RightOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const { Panel } = Collapse;

const API = import.meta.env.VITE_CORE_BASE_URL;

// 이벤트별 색상 (더 부드러운 색상)
const EVENT_COLORS = {
  TASK_CREATED: "#1890ff",
  TASK_STARTED: "#13c2c2",
  TASK_DONE: "#52c41a",
  TASK_FAILED: "#ff4d4f",
  TASK_CANCELED: "#faad14",
  STEP_STARTED: "#597ef7",
  STEP_DONE: "#73d13d",
  STEP_FAILED: "#ff7875",
};

const EVENT_LABELS = {
  TASK_CREATED: "태스크 생성",
  TASK_STARTED: "태스크 시작",
  TASK_DONE: "태스크 완료",
  TASK_FAILED: "태스크 실패",
  TASK_CANCELED: "태스크 취소",
  STEP_STARTED: "스텝 시작",
  STEP_DONE: "스텝 완료",
  STEP_FAILED: "스텝 실패",
};

const SCENARIO_LABELS = {
  1: "인스토커 → 연마기",
  2: "연마기 → 아웃스토커",
  3: "아웃스토커 → 컨베이어",
};

// 단일 로그 아이템
const LogItem = React.memo(({ log, onDetail }) => {
  const time = dayjs(log.created_at).format("HH:mm:ss");
  const color = EVENT_COLORS[log.event] || "#999";
  
  return (
    <div style={{ 
      display: "flex", 
      alignItems: "flex-start", 
      gap: 12,
      padding: "8px 0",
      borderBottom: "1px solid #f5f5f5",
    }}>
      <Text type="secondary" style={{ fontSize: 12, minWidth: 60 }}>
        {time}
      </Text>
      <Tag 
        color={color} 
        style={{ 
          margin: 0, 
          fontSize: 11,
          borderRadius: 4,
        }}
      >
        {EVENT_LABELS[log.event] || log.event}
      </Tag>
      <div style={{ flex: 1, fontSize: 13 }}>
        {log.step_seq != null && (
          <Text type="secondary" style={{ marginRight: 8 }}>
            [스텝 #{log.step_seq} {log.step_type}]
          </Text>
        )}
        <Text>{log.message}</Text>
      </div>
      {log.payload && (
        <Button
          size="small"
          type="text"
          icon={<InfoCircleOutlined />}
          onClick={() => onDetail(log)}
          style={{ color: "#999" }}
        />
      )}
    </div>
  );
});

// PLC 상태 표시 컴포넌트
const PlcStatusDisplay = ({ plcStatus, scenario }) => {
  if (!plcStatus) return <Text type="secondary">PLC 상태 정보 없음</Text>;
  
  return (
    <div style={{ fontSize: 12 }}>
      {scenario === 1 && (
        <>
          {/* 인스토커 */}
          {plcStatus.instocker && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13 }}>인스토커 작업 가능</Text>
              <div style={{ marginTop: 4 }}>
                {Object.entries(plcStatus.instocker).map(([side, data]) => (
                  <Tag key={side} color={data.work_available ? "green" : "default"}>
                    {side}: {data.work_available ? "ON" : "OFF"}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          {/* 인스토커 슬롯 */}
          {plcStatus.instocker_slots && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13 }}>인스토커 슬롯</Text>
              {Object.entries(plcStatus.instocker_slots).map(([side, slots]) => (
                <div key={side} style={{ marginTop: 4 }}>
                  <Text type="secondary">{side}:</Text>{" "}
                  {slots.map((slot, i) => (
                    <Tag key={i} color={slot.has_product ? "blue" : "default"} style={{ fontSize: 10 }}>
                      {slot.key}: P{slot.product_type ?? "?"}
                    </Tag>
                  ))}
                </div>
              ))}
            </div>
          )}
          {/* 연마기 */}
          {plcStatus.grinders && (
            <div>
              <Text strong style={{ fontSize: 13 }}>연마기 상태</Text>
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {plcStatus.grinders.map((g) => (
                  <div key={g.index} style={{ 
                    padding: "4px 8px", 
                    background: g.bypass ? "#fff2f0" : "#f6ffed",
                    borderRadius: 4,
                    border: `1px solid ${g.bypass ? "#ffccc7" : "#b7eb8f"}`,
                  }}>
                    <Text style={{ fontSize: 11 }}>
                      G{g.index} {g.bypass && <Tag color="red" style={{ fontSize: 9 }}>bypass</Tag>}
                    </Text>
                    <div style={{ fontSize: 10 }}>
                      L: {g.positions?.L?.input_ready ? "✓" : "✗"} / 
                      R: {g.positions?.R?.input_ready ? "✓" : "✗"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      
      {scenario === 2 && (
        <>
          {/* 연마기 배출 */}
          {plcStatus.grinders && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13 }}>연마기 배출 가능</Text>
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {plcStatus.grinders.map((g) => (
                  <div key={g.index} style={{ 
                    padding: "4px 8px", 
                    background: g.bypass ? "#fff2f0" : "#f0f5ff",
                    borderRadius: 4,
                    border: `1px solid ${g.bypass ? "#ffccc7" : "#adc6ff"}`,
                  }}>
                    <Text style={{ fontSize: 11 }}>
                      G{g.index} {g.bypass && <Tag color="red" style={{ fontSize: 9 }}>bypass</Tag>}
                    </Text>
                    <div style={{ fontSize: 10 }}>
                      L: {g.positions?.L?.output_ready ? "✓" : "✗"} / 
                      R: {g.positions?.R?.output_ready ? "✓" : "✗"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 아웃스토커 */}
          {plcStatus.outstocker && (
            <div>
              <Text strong style={{ fontSize: 13 }}>아웃스토커 적재 가능</Text>
              {Object.entries(plcStatus.outstocker).map(([side, data]) => (
                <div key={side} style={{ marginTop: 4 }}>
                  <Text type="secondary">{side}</Text>
                  {data.bypass && <Tag color="red" style={{ fontSize: 9, marginLeft: 4 }}>bypass</Tag>}
                  <div style={{ marginLeft: 8 }}>
                    {Object.entries(data.rows || {}).map(([row, rowData]) => (
                      <Tag key={row} color={rowData.load_ready ? "green" : "default"} style={{ fontSize: 10 }}>
                        R{row}: {rowData.load_ready ? "ON" : "OFF"}
                      </Tag>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      
      {scenario === 3 && (
        <>
          {/* 아웃스토커 지그 */}
          {plcStatus.outstocker && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13 }}>아웃스토커 지그 상태</Text>
              {Object.entries(plcStatus.outstocker).map(([side, data]) => (
                <div key={side} style={{ marginTop: 4 }}>
                  <Text type="secondary">{side}:</Text>
                  <div style={{ marginLeft: 8 }}>
                    {Object.entries(data.rows || {}).map(([row, rowData]) => (
                      <Tag key={row} color={rowData.jig_state ? "blue" : "default"} style={{ fontSize: 10 }}>
                        R{row}: {rowData.jig_state ? `P${rowData.model_no ?? "?"}` : "-"}
                      </Tag>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 컨베이어 */}
          {plcStatus.conveyors && (
            <div>
              <Text strong style={{ fontSize: 13 }}>컨베이어 호출</Text>
              <div style={{ marginTop: 4 }}>
                {plcStatus.conveyors.map((c) => (
                  <Tag key={c.index} color={c.call_signal ? "cyan" : "default"}>
                    C{c.index}: {c.call_signal ? `호출 (${c.qty ?? 0}개)` : "대기"}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// 태스크 그룹 카드
const TaskGroup = React.memo(({ taskId, logs, onDetail }) => {
  const [expanded, setExpanded] = useState(false);
  const [plcExpanded, setPlcExpanded] = useState(false);
  
  // 태스크 정보 추출
  const createdLog = logs.find(l => l.event === "TASK_CREATED");
  const endLog = logs.find(l => ["TASK_DONE", "TASK_FAILED", "TASK_CANCELED"].includes(l.event));
  const stepLogs = logs.filter(l => l.event.startsWith("STEP_"));
  
  const robotName = createdLog?.robot_name || logs[0]?.robot_name || "-";
  const createdAt = createdLog ? dayjs(createdLog.created_at) : null;
  const endedAt = endLog ? dayjs(endLog.created_at) : null;
  const duration = createdAt && endedAt ? endedAt.diff(createdAt, "second") : null;
  
  // payload에서 시나리오와 요약 정보 추출
  let scenario = null;
  let summary = null;
  let plcStatus = null;
  if (createdLog?.payload) {
    try {
      const payload = typeof createdLog.payload === "string" 
        ? JSON.parse(createdLog.payload) 
        : createdLog.payload;
      scenario = payload.scenario;
      summary = payload.summary;
      plcStatus = payload.plc_status;
    } catch {}
  }
  
  // 태스크 상태 결정
  let status = "진행중";
  let statusColor = "processing";
  let statusIcon = <ClockCircleOutlined />;
  if (endLog?.event === "TASK_DONE") {
    status = "완료";
    statusColor = "success";
    statusIcon = <CheckCircleOutlined />;
  } else if (endLog?.event === "TASK_FAILED") {
    status = "실패";
    statusColor = "error";
    statusIcon = <CloseCircleOutlined />;
  } else if (endLog?.event === "TASK_CANCELED") {
    status = "취소";
    statusColor = "warning";
    statusIcon = <StopOutlined />;
  }
  
  const completedSteps = stepLogs.filter(l => l.event === "STEP_DONE").length;
  const failedSteps = stepLogs.filter(l => l.event === "STEP_FAILED").length;
  
  return (
    <Card
      size="small"
      style={{ 
        marginBottom: 12,
        borderRadius: 8,
        border: "1px solid #f0f0f0",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
      bodyStyle={{ padding: 0 }}
    >
      {/* 헤더 */}
      <div 
        style={{ 
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          background: expanded ? "#fafafa" : "#fff",
          borderRadius: expanded ? "8px 8px 0 0" : 8,
          transition: "background 0.2s",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <DownOutlined style={{ fontSize: 10, color: "#999" }} /> : <RightOutlined style={{ fontSize: 10, color: "#999" }} />}
        
        <Text strong style={{ fontSize: 14 }}>Task #{taskId}</Text>
        
        {scenario && (
          <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
            시나리오 {scenario}
          </Tag>
        )}
        
        <Badge status={statusColor} text={<Text style={{ fontSize: 12 }}>{status}</Text>} />
        
        <div style={{ flex: 1 }} />
        
        <Text type="secondary" style={{ fontSize: 12 }}>
          {robotName}
        </Text>
        
        {createdAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {createdAt.format("MM-DD HH:mm")}
          </Text>
        )}
        
        {duration !== null && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            ({duration}초)
          </Text>
        )}
        
        <Space size={4}>
          {completedSteps > 0 && (
            <Tag color="green" style={{ margin: 0, fontSize: 10 }}>
              {completedSteps} 완료
            </Tag>
          )}
          {failedSteps > 0 && (
            <Tag color="red" style={{ margin: 0, fontSize: 10 }}>
              {failedSteps} 실패
            </Tag>
          )}
        </Space>
      </div>
      
      {/* 상세 내용 */}
      {expanded && (
        <div style={{ borderTop: "1px solid #f0f0f0" }}>
          {/* 요약 정보 */}
          {summary && (
            <div style={{ padding: "12px 16px", background: "#fafafa" }}>
              <Row gutter={24}>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>출발</Text>
                  <div style={{ fontSize: 13 }}>{summary.source || "-"}</div>
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>도착</Text>
                  <div style={{ fontSize: 13 }}>{summary.target || "-"}</div>
                </Col>
                <Col span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>수량</Text>
                  <div style={{ fontSize: 13 }}>
                    픽업 {summary.pickup_count ?? 0}개 → 하역 {summary.dropoff_count ?? 0}개
                  </div>
                </Col>
              </Row>
            </div>
          )}
          
          {/* PLC 상태 (생성 시점) */}
          {plcStatus && (
            <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
              <div 
                style={{ 
                  padding: "8px 16px", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: 8,
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPlcExpanded(!plcExpanded);
                }}
              >
                {plcExpanded ? <DownOutlined style={{ fontSize: 10, color: "#999" }} /> : <RightOutlined style={{ fontSize: 10, color: "#999" }} />}
                <InfoCircleOutlined style={{ color: "#1890ff", fontSize: 12 }} />
                <Text style={{ fontSize: 12, color: "#1890ff" }}>생성 시점 PLC 상태</Text>
              </div>
              {plcExpanded && (
                <div style={{ padding: "8px 16px 12px 16px", background: "#fafafa" }}>
                  <PlcStatusDisplay plcStatus={plcStatus} scenario={scenario} />
                </div>
              )}
            </div>
          )}
          
          {/* 로그 타임라인 */}
          <div style={{ padding: "12px 16px" }}>
            {logs.map((log) => (
              <LogItem key={log.id} log={log} onDetail={onDetail} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
});

export default function TaskLogs() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [filters, setFilters] = useState({
    task_id: "",
    robot_name: "",
    event: "",
    dateRange: null,
  });
  const [detailModal, setDetailModal] = useState({ visible: false, log: null });

  // 필터 쿼리 파라미터 생성
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", page);
    params.set("limit", pageSize);
    if (filters.task_id) params.set("task_id", filters.task_id);
    if (filters.robot_name) params.set("robot_name", filters.robot_name);
    if (filters.event) params.set("event", filters.event);
    if (filters.dateRange?.[0]) {
      params.set("start_date", filters.dateRange[0].toISOString());
    }
    if (filters.dateRange?.[1]) {
      params.set("end_date", filters.dateRange[1].toISOString());
    }
    return params.toString();
  }, [page, pageSize, filters]);

  // 로그 목록 조회
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["taskLogs", queryParams],
    queryFn: async () => {
      const r = await fetch(`${API}/api/task-logs?${queryParams}`);
      if (!r.ok) throw new Error("로그 조회 실패");
      return r.json();
    },
  });

  // 통계 조회
  const { data: stats } = useQuery({
    queryKey: ["taskLogStats"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/task-logs/stats`);
      if (!r.ok) throw new Error("통계 조회 실패");
      return r.json();
    },
    refetchInterval: 30000,
  });

  // 오래된 로그 삭제
  const deleteMut = useMutation({
    mutationFn: async (daysOld) => {
      const r = await fetch(`${API}/api/task-logs?days_old=${daysOld}`, {
        method: "DELETE",
      });
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

  // 태스크별로 그룹화
  const groupedLogs = useMemo(() => {
    if (!data?.logs) return [];
    
    const groups = new Map();
    for (const log of data.logs) {
      if (!log.task_id) continue;
      if (!groups.has(log.task_id)) {
        groups.set(log.task_id, []);
      }
      groups.get(log.task_id).push(log);
    }
    
    // 각 그룹 내부를 시간순 정렬
    for (const [, logs] of groups) {
      logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    
    // 태스크 ID 역순 정렬 (최신 태스크가 위로)
    return Array.from(groups.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([taskId, logs]) => ({ taskId, logs }));
  }, [data?.logs]);

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      task_id: "",
      robot_name: "",
      event: "",
      dateRange: null,
    });
    setPage(1);
  }, []);

  const handleDetail = useCallback((log) => {
    setDetailModal({ visible: true, log });
  }, []);

  // 모달에서 payload 파싱
  const parsedPayload = useMemo(() => {
    if (!detailModal.log?.payload) return null;
    try {
      return typeof detailModal.log.payload === "string"
        ? JSON.parse(detailModal.log.payload)
        : detailModal.log.payload;
    } catch {
      return null;
    }
  }, [detailModal.log]);

  return (
    <div style={{ padding: 24, background: "#f5f5f5", minHeight: "100vh" }}>
      {/* 헤더 카드 */}
      <Card
        style={{ 
          marginBottom: 16,
          borderRadius: 8,
          border: "none",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
        bodyStyle={{ padding: "16px 24px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Text strong style={{ fontSize: 18 }}>태스크 실행 로그</Text>
            {stats && (
              <div style={{ marginTop: 8, display: "flex", gap: 24 }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>전체</Text>
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{stats.total}</div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>완료</Text>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#52c41a" }}>
                    {stats.byEvent?.TASK_DONE || 0}
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>실패</Text>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#ff4d4f" }}>
                    {stats.byEvent?.TASK_FAILED || 0}
                  </div>
                </div>
              </div>
            )}
          </div>
          <Space>
            <Popconfirm
              title="오래된 로그 삭제"
              description="30일 이전의 로그를 삭제합니다."
              onConfirm={() => deleteMut.mutate(30)}
              okText="삭제"
              cancelText="취소"
            >
              <Button icon={<DeleteOutlined />} danger size="small">
                30일 이전 삭제
              </Button>
            </Popconfirm>
            <Button 
              icon={<ReloadOutlined spin={isLoading} />} 
              onClick={() => refetch()}
              size="small"
            >
              새로고침
            </Button>
          </Space>
        </div>
      </Card>

      {/* 필터 */}
      <Card
        style={{ 
          marginBottom: 16,
          borderRadius: 8,
          border: "none",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
        bodyStyle={{ padding: "12px 16px" }}
      >
        <Space wrap>
          <Input
            placeholder="Task ID"
            prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
            value={filters.task_id}
            onChange={(e) => handleFilterChange("task_id", e.target.value)}
            style={{ width: 120, borderRadius: 6 }}
            allowClear
            size="small"
          />
          <Input
            placeholder="로봇 이름"
            prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
            value={filters.robot_name}
            onChange={(e) => handleFilterChange("robot_name", e.target.value)}
            style={{ width: 140, borderRadius: 6 }}
            allowClear
            size="small"
          />
          <Select
            placeholder="이벤트"
            value={filters.event || undefined}
            onChange={(v) => handleFilterChange("event", v)}
            style={{ width: 140 }}
            allowClear
            size="small"
            options={[
              { value: "TASK_CREATED", label: "태스크 생성" },
              { value: "TASK_STARTED", label: "태스크 시작" },
              { value: "TASK_DONE", label: "태스크 완료" },
              { value: "TASK_FAILED", label: "태스크 실패" },
              { value: "TASK_CANCELED", label: "태스크 취소" },
            ]}
          />
          <RangePicker
            value={filters.dateRange}
            onChange={(v) => handleFilterChange("dateRange", v)}
            format="MM-DD HH:mm"
            size="small"
            style={{ borderRadius: 6 }}
          />
          <Button onClick={handleClearFilters} size="small">
            초기화
          </Button>
        </Space>
      </Card>

      {/* 로그 목록 */}
      <Spin spinning={isLoading}>
        {groupedLogs.length === 0 ? (
          <Card
            style={{ 
              borderRadius: 8,
              border: "none",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <Empty description="로그가 없습니다" />
          </Card>
        ) : (
          <div>
            {groupedLogs.map(({ taskId, logs }) => (
              <TaskGroup 
                key={taskId} 
                taskId={taskId} 
                logs={logs} 
                onDetail={handleDetail}
              />
            ))}
          </div>
        )}
      </Spin>

      {/* 페이지네이션 */}
      {data?.total > pageSize && (
        <Card
          style={{ 
            marginTop: 16,
            borderRadius: 8,
            border: "none",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
          bodyStyle={{ padding: "12px 16px", textAlign: "center" }}
        >
          <Space>
            <Button 
              disabled={page === 1} 
              onClick={() => setPage(p => p - 1)}
              size="small"
            >
              이전
            </Button>
            <Text type="secondary">
              {page} / {Math.ceil((data?.total || 0) / pageSize)} 페이지
            </Text>
            <Button 
              disabled={page >= Math.ceil((data?.total || 0) / pageSize)} 
              onClick={() => setPage(p => p + 1)}
              size="small"
            >
              다음
            </Button>
          </Space>
        </Card>
      )}

      {/* 상세 모달 */}
      <Modal
        title={`로그 상세 #${detailModal.log?.id}`}
        open={detailModal.visible}
        onCancel={() => setDetailModal({ visible: false, log: null })}
        footer={null}
        width={640}
        bodyStyle={{ padding: "16px 24px" }}
      >
        {detailModal.log && (
          <div>
            <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="시간">
                {dayjs(detailModal.log.created_at).format("YYYY-MM-DD HH:mm:ss")}
              </Descriptions.Item>
              <Descriptions.Item label="이벤트">
                <Tag color={EVENT_COLORS[detailModal.log.event]}>
                  {EVENT_LABELS[detailModal.log.event] || detailModal.log.event}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="로봇">
                {detailModal.log.robot_name || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="스텝">
                {detailModal.log.step_seq != null 
                  ? `#${detailModal.log.step_seq} (${detailModal.log.step_type})`
                  : "-"
                }
              </Descriptions.Item>
            </Descriptions>
            
            <Divider style={{ margin: "12px 0" }} />
            
            <Text strong>메시지</Text>
            <Paragraph style={{ marginTop: 4 }}>
              {detailModal.log.message}
            </Paragraph>
            
            {parsedPayload && (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <Text strong>Payload</Text>
                <pre
                  style={{
                    marginTop: 12,
                    background: "#f5f5f5",
                    padding: 12,
                    borderRadius: 6,
                    color: "#333",
                    fontSize: 11,
                    maxHeight: 300,
                    overflow: "auto",
                    border: "1px solid #e8e8e8",
                  }}
                >
                  {JSON.stringify(parsedPayload, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
