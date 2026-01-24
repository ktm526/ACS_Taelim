// src/pages/TaskLogs/index.jsx
import React, { useState, useMemo } from "react";
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
  Statistic,
  Row,
  Col,
  Tooltip,
  Popconfirm,
} from "antd";
import {
  ReloadOutlined,
  SearchOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

const API = import.meta.env.VITE_CORE_BASE_URL;

const EVENT_COLORS = {
  TASK_CREATED: "blue",
  TASK_STARTED: "cyan",
  TASK_DONE: "green",
  TASK_FAILED: "red",
  TASK_CANCELED: "orange",
  STEP_STARTED: "geekblue",
  STEP_DONE: "lime",
  STEP_FAILED: "magenta",
};

const EVENT_ICONS = {
  TASK_CREATED: <RocketOutlined />,
  TASK_STARTED: <PlayCircleOutlined />,
  TASK_DONE: <CheckCircleOutlined />,
  TASK_FAILED: <CloseCircleOutlined />,
  TASK_CANCELED: <PauseCircleOutlined />,
  STEP_STARTED: <PlayCircleOutlined />,
  STEP_DONE: <CheckCircleOutlined />,
  STEP_FAILED: <CloseCircleOutlined />,
};

export default function TaskLogs() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
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

  const columns = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 70,
    },
    {
      title: "시간",
      dataIndex: "created_at",
      key: "created_at",
      width: 170,
      render: (v) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      title: "이벤트",
      dataIndex: "event",
      key: "event",
      width: 130,
      render: (v) => (
        <Tag color={EVENT_COLORS[v] || "default"} icon={EVENT_ICONS[v]}>
          {v}
        </Tag>
      ),
    },
    {
      title: "Task ID",
      dataIndex: "task_id",
      key: "task_id",
      width: 80,
      render: (v) => <Text code>#{v}</Text>,
    },
    {
      title: "로봇",
      dataIndex: "robot_name",
      key: "robot_name",
      width: 100,
      render: (v) => v || "-",
    },
    {
      title: "스텝",
      key: "step",
      width: 100,
      render: (_, record) =>
        record.step_seq != null ? (
          <Space>
            <Text type="secondary">#{record.step_seq}</Text>
            <Tag>{record.step_type}</Tag>
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "메시지",
      dataIndex: "message",
      key: "message",
      ellipsis: true,
      render: (v) => (
        <Tooltip title={v}>
          <Text>{v || "-"}</Text>
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "action",
      width: 50,
      render: (_, record) =>
        record.payload && (
          <Button
            size="small"
            type="text"
            icon={<InfoCircleOutlined />}
            onClick={() => setDetailModal({ visible: true, log: record })}
          />
        ),
    },
  ];

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({
      task_id: "",
      robot_name: "",
      event: "",
      dateRange: null,
    });
    setPage(1);
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="태스크 실행 로그"
        extra={
          <Space>
            <Popconfirm
              title="오래된 로그 삭제"
              description="30일 이전의 로그를 삭제합니다."
              onConfirm={() => deleteMut.mutate(30)}
              okText="삭제"
              cancelText="취소"
            >
              <Button icon={<DeleteOutlined />} danger>
                30일 이전 삭제
              </Button>
            </Popconfirm>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              새로고침
            </Button>
          </Space>
        }
      >
        {/* 통계 */}
        {stats && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={4}>
              <Statistic title="전체 로그" value={stats.total} />
            </Col>
            <Col span={4}>
              <Statistic
                title="태스크 생성"
                value={stats.byEvent?.TASK_CREATED || 0}
                valueStyle={{ color: "#1890ff" }}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title="태스크 완료"
                value={stats.byEvent?.TASK_DONE || 0}
                valueStyle={{ color: "#52c41a" }}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title="태스크 실패"
                value={stats.byEvent?.TASK_FAILED || 0}
                valueStyle={{ color: "#ff4d4f" }}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title="스텝 완료"
                value={stats.byEvent?.STEP_DONE || 0}
                valueStyle={{ color: "#52c41a" }}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title="스텝 실패"
                value={stats.byEvent?.STEP_FAILED || 0}
                valueStyle={{ color: "#ff4d4f" }}
              />
            </Col>
          </Row>
        )}

        {/* 필터 */}
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            placeholder="Task ID"
            prefix={<SearchOutlined />}
            value={filters.task_id}
            onChange={(e) => handleFilterChange("task_id", e.target.value)}
            style={{ width: 120 }}
            allowClear
          />
          <Input
            placeholder="로봇 이름"
            prefix={<SearchOutlined />}
            value={filters.robot_name}
            onChange={(e) => handleFilterChange("robot_name", e.target.value)}
            style={{ width: 150 }}
            allowClear
          />
          <Select
            placeholder="이벤트"
            value={filters.event || undefined}
            onChange={(v) => handleFilterChange("event", v)}
            style={{ width: 150 }}
            allowClear
            options={[
              { value: "TASK_CREATED", label: "태스크 생성" },
              { value: "TASK_STARTED", label: "태스크 시작" },
              { value: "TASK_DONE", label: "태스크 완료" },
              { value: "TASK_FAILED", label: "태스크 실패" },
              { value: "TASK_CANCELED", label: "태스크 취소" },
              { value: "STEP_STARTED", label: "스텝 시작" },
              { value: "STEP_DONE", label: "스텝 완료" },
              { value: "STEP_FAILED", label: "스텝 실패" },
            ]}
          />
          <RangePicker
            value={filters.dateRange}
            onChange={(v) => handleFilterChange("dateRange", v)}
            showTime
            format="YYYY-MM-DD HH:mm"
          />
          <Button onClick={handleClearFilters}>필터 초기화</Button>
        </Space>

        {/* 테이블 */}
        <Table
          columns={columns}
          dataSource={data?.logs || []}
          rowKey="id"
          loading={isLoading}
          size="small"
          pagination={{
            current: page,
            pageSize: pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `총 ${total}개`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* 상세 모달 */}
      <Modal
        title={`로그 상세 #${detailModal.log?.id}`}
        open={detailModal.visible}
        onCancel={() => setDetailModal({ visible: false, log: null })}
        footer={null}
        width={600}
      >
        {detailModal.log && (
          <div>
            <Paragraph>
              <Text strong>시간:</Text>{" "}
              {dayjs(detailModal.log.created_at).format("YYYY-MM-DD HH:mm:ss")}
            </Paragraph>
            <Paragraph>
              <Text strong>이벤트:</Text>{" "}
              <Tag color={EVENT_COLORS[detailModal.log.event]}>
                {detailModal.log.event}
              </Tag>
            </Paragraph>
            <Paragraph>
              <Text strong>메시지:</Text> {detailModal.log.message}
            </Paragraph>
            {detailModal.log.payload && (
              <>
                <Text strong>Payload:</Text>
                <pre
                  style={{
                    background: "#1a1a2e",
                    padding: 12,
                    borderRadius: 6,
                    color: "#a9b7c6",
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(JSON.parse(detailModal.log.payload), null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
