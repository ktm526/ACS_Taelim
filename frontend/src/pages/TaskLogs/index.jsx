// src/pages/TaskLogs/index.jsx
import React, { useState, useMemo, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Input,
  Select,
  DatePicker,
  Modal,
  Typography,
  message,
  Tooltip,
  Popconfirm,
  Badge,
  Empty,
  Descriptions,
  Divider,
  Progress,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DownOutlined,
  RightOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

const { Text } = Typography;
const { RangePicker } = DatePicker;

const API = import.meta.env.VITE_CORE_BASE_URL;

// 이벤트별 색상
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
  TASK_CREATED: "생성",
  TASK_STARTED: "시작",
  TASK_DONE: "완료",
  TASK_FAILED: "실패",
  TASK_CANCELED: "취소",
  STEP_STARTED: "스텝시작",
  STEP_DONE: "스텝완료",
  STEP_FAILED: "스텝실패",
};

// PLC 상태 표시 컴포넌트
const PlcStatusDisplay = ({ plcStatus, scenario }) => {
  if (!plcStatus) return <Text type="secondary">PLC 상태 정보 없음</Text>;
  
  return (
    <div style={{ fontSize: 11 }}>
      {scenario === 1 && (
        <>
          {plcStatus.instocker && (
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontSize: 11 }}>인스토커</Text>
              <div>
                {Object.entries(plcStatus.instocker).map(([side, data]) => (
                  <Tag key={side} color={data.work_available ? "green" : "default"} style={{ fontSize: 10, marginRight: 4 }}>
                    {side}: {data.work_available ? "ON" : "OFF"}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          {plcStatus.grinders && (
            <div>
              <Text strong style={{ fontSize: 11 }}>연마기</Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                {plcStatus.grinders.map((g) => (
                  <Tag 
                    key={g.index} 
                    color={g.bypass ? "red" : "blue"} 
                    style={{ fontSize: 10 }}
                  >
                    G{g.index} L:{g.positions?.L?.input_ready ? "✓" : "✗"} R:{g.positions?.R?.input_ready ? "✓" : "✗"}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      
      {scenario === 2 && (
        <>
          {plcStatus.grinders && (
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontSize: 11 }}>연마기 배출</Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                {plcStatus.grinders.map((g) => (
                  <Tag 
                    key={g.index} 
                    color={g.bypass ? "red" : "cyan"} 
                    style={{ fontSize: 10 }}
                  >
                    G{g.index} L:{g.positions?.L?.output_ready ? "✓" : "✗"} R:{g.positions?.R?.output_ready ? "✓" : "✗"}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          {plcStatus.outstocker && (
            <div>
              <Text strong style={{ fontSize: 11 }}>아웃스토커</Text>
              <div style={{ marginTop: 2 }}>
                {Object.entries(plcStatus.outstocker).map(([side, data]) => (
                  <div key={side} style={{ fontSize: 10 }}>
                    <Text type="secondary">{side}:</Text>{" "}
                    {Object.entries(data.rows || {}).map(([row, rowData]) => (
                      <Tag key={row} color={rowData.load_ready ? "green" : "default"} style={{ fontSize: 9, marginRight: 2 }}>
                        R{row}
                      </Tag>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      
      {scenario === 3 && (
        <>
          {plcStatus.outstocker && (
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontSize: 11 }}>아웃스토커 지그</Text>
              <div style={{ marginTop: 2 }}>
                {Object.entries(plcStatus.outstocker).map(([side, data]) => (
                  <div key={side} style={{ fontSize: 10 }}>
                    <Text type="secondary">{side}:</Text>{" "}
                    {Object.entries(data.rows || {}).map(([row, rowData]) => (
                      <Tag key={row} color={rowData.jig_state ? "blue" : "default"} style={{ fontSize: 9, marginRight: 2 }}>
                        R{row}{rowData.jig_state ? `:P${rowData.model_no ?? "?"}` : ""}
                      </Tag>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {plcStatus.conveyors && (
            <div>
              <Text strong style={{ fontSize: 11 }}>컨베이어</Text>
              <div style={{ marginTop: 2 }}>
                {plcStatus.conveyors.map((c) => (
                  <Tag key={c.index} color={c.call_signal ? "cyan" : "default"} style={{ fontSize: 10 }}>
                    C{c.index}: {c.call_signal ? `호출(${c.qty ?? 0})` : "-"}
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

// 확장 행 컴포넌트
const ExpandedRow = ({ logs, plcStatus, scenario, summary }) => {
  return (
    <div style={{ padding: "8px 16px", background: "#fafafa" }}>
      {/* 요약 + PLC 상태 */}
      <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
        {summary && (
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 12 }}>요약</Text>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              <div><Text type="secondary">출발:</Text> {summary.source || "-"}</div>
              <div><Text type="secondary">도착:</Text> {summary.target || "-"}</div>
              <div><Text type="secondary">수량:</Text> {summary.pickup_count ?? 0} → {summary.dropoff_count ?? 0}</div>
            </div>
          </div>
        )}
        {plcStatus && (
          <div style={{ flex: 2 }}>
            <Text strong style={{ fontSize: 12 }}>생성 시점 PLC 상태</Text>
            <div style={{ marginTop: 4 }}>
              <PlcStatusDisplay plcStatus={plcStatus} scenario={scenario} />
            </div>
          </div>
        )}
      </div>
      
      {/* 로그 타임라인 */}
      <div>
        <Text strong style={{ fontSize: 12 }}>실행 로그</Text>
        <div style={{ 
          marginTop: 8, 
          maxHeight: 200, 
          overflow: "auto",
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 4,
          padding: 8,
        }}>
          {logs.map((log) => (
            <div 
              key={log.id} 
              style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 8,
                padding: "4px 0",
                borderBottom: "1px solid #f5f5f5",
                fontSize: 11,
              }}
            >
              <Text type="secondary" style={{ minWidth: 55, fontSize: 10 }}>
                {dayjs(log.created_at).format("HH:mm:ss")}
              </Text>
              <Tag 
                color={EVENT_COLORS[log.event]} 
                style={{ margin: 0, fontSize: 10, padding: "0 4px" }}
              >
                {EVENT_LABELS[log.event]}
              </Tag>
              {log.step_seq != null && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  [#{log.step_seq} {log.step_type}]
                </Text>
              )}
              <Text ellipsis style={{ flex: 1, fontSize: 11 }}>{log.message}</Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function TaskLogs() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);
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
  const groupedData = useMemo(() => {
    if (!data?.logs) return [];
    
    const groups = new Map();
    for (const log of data.logs) {
      if (!log.task_id) continue;
      if (!groups.has(log.task_id)) {
        groups.set(log.task_id, []);
      }
      groups.get(log.task_id).push(log);
    }
    
    // 각 그룹을 요약 정보로 변환
    const result = [];
    for (const [taskId, logs] of groups) {
      logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      const createdLog = logs.find(l => l.event === "TASK_CREATED");
      const endLog = logs.find(l => ["TASK_DONE", "TASK_FAILED", "TASK_CANCELED"].includes(l.event));
      const stepDone = logs.filter(l => l.event === "STEP_DONE").length;
      const stepFailed = logs.filter(l => l.event === "STEP_FAILED").length;
      
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
      
      const createdAt = createdLog ? dayjs(createdLog.created_at) : null;
      const endedAt = endLog ? dayjs(endLog.created_at) : null;
      const duration = createdAt && endedAt ? endedAt.diff(createdAt, "second") : null;
      
      let status = "진행중";
      let statusColor = "processing";
      if (endLog?.event === "TASK_DONE") {
        status = "완료";
        statusColor = "success";
      } else if (endLog?.event === "TASK_FAILED") {
        status = "실패";
        statusColor = "error";
      } else if (endLog?.event === "TASK_CANCELED") {
        status = "취소";
        statusColor = "warning";
      }
      
      result.push({
        key: taskId,
        taskId,
        robotName: createdLog?.robot_name || logs[0]?.robot_name || "-",
        scenario,
        status,
        statusColor,
        createdAt,
        duration,
        stepDone,
        stepFailed,
        totalSteps: stepDone + stepFailed,
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

  const handleClearFilters = useCallback(() => {
    setFilters({
      task_id: "",
      robot_name: "",
      event: "",
      dateRange: null,
    });
    setPage(1);
  }, []);

  const columns = [
    {
      title: "Task",
      dataIndex: "taskId",
      key: "taskId",
      width: 70,
      render: (v) => <Text code style={{ fontSize: 11 }}>#{v}</Text>,
    },
    {
      title: "시나리오",
      dataIndex: "scenario",
      key: "scenario",
      width: 80,
      render: (v) => v ? (
        <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>S{v}</Tag>
      ) : "-",
    },
    {
      title: "상태",
      dataIndex: "status",
      key: "status",
      width: 70,
      render: (v, record) => (
        <Badge status={record.statusColor} text={<span style={{ fontSize: 11 }}>{v}</span>} />
      ),
    },
    {
      title: "AMR",
      dataIndex: "robotName",
      key: "robotName",
      width: 100,
      ellipsis: true,
      render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: "시간",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 110,
      render: (v) => v ? (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {v.format("MM-DD HH:mm:ss")}
        </Text>
      ) : "-",
    },
    {
      title: "소요",
      dataIndex: "duration",
      key: "duration",
      width: 60,
      render: (v) => v !== null ? (
        <Text type="secondary" style={{ fontSize: 11 }}>{v}초</Text>
      ) : "-",
    },
    {
      title: "스텝",
      key: "steps",
      width: 90,
      render: (_, record) => (
        <Space size={4}>
          {record.stepDone > 0 && (
            <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{record.stepDone}완료</Tag>
          )}
          {record.stepFailed > 0 && (
            <Tag color="red" style={{ fontSize: 10, margin: 0 }}>{record.stepFailed}실패</Tag>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16, background: "#f5f5f5", minHeight: "100vh" }}>
      <Card
        size="small"
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Text strong>태스크 실행 로그</Text>
            {stats && (
              <Space size={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  전체 <Text strong>{stats.total}</Text>
                </Text>
                <Text style={{ fontSize: 12, color: "#52c41a" }}>
                  완료 <Text strong>{stats.byEvent?.TASK_DONE || 0}</Text>
                </Text>
                <Text style={{ fontSize: 12, color: "#ff4d4f" }}>
                  실패 <Text strong>{stats.byEvent?.TASK_FAILED || 0}</Text>
                </Text>
              </Space>
            )}
          </div>
        }
        extra={
          <Space size={8}>
            <Popconfirm
              title="30일 이전 로그 삭제"
              onConfirm={() => deleteMut.mutate(30)}
              okText="삭제"
              cancelText="취소"
            >
              <Button size="small" icon={<DeleteOutlined />} danger>
                정리
              </Button>
            </Popconfirm>
            <Button 
              size="small"
              icon={<ReloadOutlined spin={isLoading} />} 
              onClick={() => refetch()}
            >
              새로고침
            </Button>
          </Space>
        }
        bodyStyle={{ padding: 12 }}
      >
        {/* 필터 */}
        <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input
            placeholder="Task ID"
            prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
            value={filters.task_id}
            onChange={(e) => handleFilterChange("task_id", e.target.value)}
            style={{ width: 100 }}
            allowClear
            size="small"
          />
          <Input
            placeholder="AMR"
            value={filters.robot_name}
            onChange={(e) => handleFilterChange("robot_name", e.target.value)}
            style={{ width: 100 }}
            allowClear
            size="small"
          />
          <Select
            placeholder="이벤트"
            value={filters.event || undefined}
            onChange={(v) => handleFilterChange("event", v)}
            style={{ width: 100 }}
            allowClear
            size="small"
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
            size="small"
            style={{ width: 180 }}
          />
          <Button onClick={handleClearFilters} size="small">
            초기화
          </Button>
        </div>

        {/* 테이블 */}
        <Table
          columns={columns}
          dataSource={groupedData}
          loading={isLoading}
          size="small"
          pagination={{
            current: page,
            pageSize: 20,
            total: groupedData.length,
            showSizeChanger: false,
            showTotal: (total) => `${total}개 태스크`,
            size: "small",
            onChange: (p) => setPage(p),
          }}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys),
            expandedRowRender: (record) => (
              <ExpandedRow 
                logs={record.logs} 
                plcStatus={record.plcStatus}
                scenario={record.scenario}
                summary={record.summary}
              />
            ),
            expandIcon: ({ expanded, onExpand, record }) => (
              <Button
                type="text"
                size="small"
                icon={expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
                onClick={(e) => onExpand(record, e)}
                style={{ width: 20, height: 20, padding: 0 }}
              />
            ),
          }}
          scroll={{ x: 600 }}
          rowClassName={(record) => 
            record.statusColor === "error" ? "row-error" : 
            record.statusColor === "warning" ? "row-warning" : ""
          }
        />
      </Card>

      <style>{`
        .row-error {
          background: #fff2f0 !important;
        }
        .row-warning {
          background: #fffbe6 !important;
        }
        .ant-table-expanded-row > td {
          padding: 0 !important;
        }
      `}</style>
    </div>
  );
}
