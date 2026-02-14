import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Card,
  Descriptions,
  Spin,
  Alert,
  Button,
  Divider,
  Tag,
  Input,
  Table,
  Select,
  Typography,
  Statistic,
  Space,
  Tooltip,
} from "antd";
import {
  ReloadOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DashboardOutlined,
  CloudServerOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/hooks/useApiClient";

const { Text, Title } = Typography;

/* ─── 유틸 ─── */
function formatBps(v) {
  if (v == null || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  if (n < 1024) return `${n} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(2)} MB/s`;
}

function formatUptime(sec) {
  if (sec == null) return "-";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}일 ${h}시간 ${m}분`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

/* ─── 차트 컬러 & 설정 ─── */
const CHART_CONFIGS = {
  systemCpu: {
    label: "시스템 CPU",
    unit: "%",
    color: "#1677ff",
    gradientId: "gradCpu",
    min: 0,
    max: 100,
  },
  processCpu: {
    label: "프로세스 CPU",
    unit: "%",
    color: "#13c2c2",
    gradientId: "gradProcCpu",
    min: 0,
    max: 100,
  },
  memory: {
    label: "메모리 사용률",
    unit: "%",
    color: "#722ed1",
    gradientId: "gradMem",
    min: 0,
    max: 100,
  },
  eventLoop: {
    label: "Event Loop Lag",
    unit: "ms",
    color: "#fa8c16",
    gradientId: "gradLoop",
  },
  rx: {
    label: "네트워크 Rx",
    unit: "B/s",
    color: "#52c41a",
    gradientId: "gradRx",
  },
  tx: {
    label: "네트워크 Tx",
    unit: "B/s",
    color: "#eb2f96",
    gradientId: "gradTx",
  },
};

/* ─── 커스텀 Tooltip ─── */
function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.96)",
        border: "1px solid #e8e8e8",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        fontSize: 12,
      }}
    >
      <div style={{ color: "#999", marginBottom: 4, fontSize: 11 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600 }}>
          {typeof p.value === "number" ? p.value.toFixed(2) : p.value} {unit}
        </div>
      ))}
    </div>
  );
}

/* ─── 미니 Area 차트 (그래디언트) ─── */
function MetricChart({ data, dataKey, config, height = 180 }) {
  if (!data?.length) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#bfbfbf",
          fontSize: 13,
        }}
      >
        데이터 없음
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={config.color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={config.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: "#999" }}
          axisLine={{ stroke: "#f0f0f0" }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[config.min ?? "auto", config.max ?? "auto"]}
          tick={{ fontSize: 10, fill: "#999" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <RechartsTooltip
          content={<ChartTooltip unit={config.unit} />}
          cursor={{ stroke: config.color, strokeWidth: 1, strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={config.color}
          strokeWidth={2}
          fill={`url(#${config.gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── 상태 카드 (현재 값) ─── */
function StatCard({ icon, title, value, suffix, color, subText }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: "16px 20px",
        border: "1px solid #f0f0f0",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flex: 1,
        minWidth: 200,
        transition: "box-shadow 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `${color}14`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#262626", lineHeight: 1.2 }}>
          {value}
          {suffix && <span style={{ fontSize: 13, fontWeight: 400, color: "#8c8c8c", marginLeft: 3 }}>{suffix}</span>}
        </div>
        {subText && <div style={{ fontSize: 11, color: "#bfbfbf", marginTop: 2 }}>{subText}</div>}
      </div>
    </div>
  );
}

/* ─── 메인 컴포넌트 ─── */
export default function GeneralSettings() {
  const api = useApiClient();
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);

  // TCP 테스트 상태
  const [tcpTestRunning, setTcpTestRunning] = useState(false);
  const [tcpTestResults, setTcpTestResults] = useState([]);
  const [tcpHost, setTcpHost] = useState("");
  const [tcpPort, setTcpPort] = useState("19207");
  const [tcpApiNo, setTcpApiNo] = useState("4022");
  const pollRef = useRef(null);
  const [robotOptions, setRobotOptions] = useState([]);
  const [tcpMessageText, setTcpMessageText] = useState(
    JSON.stringify({ type: "module", relative_path: "doosan_state.py" }, null, 2)
  );
  const [tcpMessageError, setTcpMessageError] = useState(null);

  // Settings (PLC → DB) 조회
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get("/api/settings");
      if (!res?.success) throw new Error(res?.message || "설정 조회 실패");
      return res.data;
    },
    refetchInterval: 1000,
  });

  const metricsQ = useQuery({
    queryKey: ["system-metrics", 24],
    queryFn: async () => {
      const res = await api.get("/api/health/system-metrics?hours=24");
      if (!res?.success) throw new Error(res?.message || "시스템 메트릭 조회 실패");
      return res;
    },
    refetchInterval: 10000,
  });

  // 차트 데이터 가공 (메모이제이션)
  const chartData = useMemo(() => {
    const rows = metricsQ.data?.data || [];
    return rows.map((r, i) => {
      const ts = r.createdAt ? new Date(r.createdAt) : null;
      const time = ts
        ? ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
        : `${i}`;
      return {
        time,
        systemCpu: r.systemCpuPct ?? null,
        processCpu: r.processCpuPct ?? null,
        memory: r.systemMemUsedPct ?? null,
        eventLoop: r.eventLoopLagMaxMs ?? null,
        rx: r.netRxBps ?? null,
        tx: r.netTxBps ?? null,
      };
    });
  }, [metricsQ.data]);

  // TCP 테스트 상태 폴링
  useEffect(() => {
    if (!tcpTestRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const res = await api.get("/api/plc/tcp-test/status");
        if (res?.data) {
          setTcpTestRunning(res.data.isRunning);
          setTcpTestResults(res.data.results || []);
        }
      } catch (e) {
        console.warn("TCP 테스트 상태 조회 실패:", e);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 500);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tcpTestRunning, api]);

  // AMR 목록 로드
  useEffect(() => {
    let mounted = true;
    const fetchRobots = async () => {
      try {
        const res = await api.get("/api/robots");
        if (!mounted) return;
        const list = Array.isArray(res) ? res : res?.data || [];
        const options = list
          .filter((r) => r?.ip)
          .map((r) => ({
            label: `${r.name ?? "AMR"} (${r.ip})`,
            value: r.ip,
          }));
        setRobotOptions(options);
        if (!tcpHost && options.length) {
          setTcpHost(options[0].value);
        }
      } catch (e) {
        console.warn("AMR 목록 조회 실패:", e);
      }
    };
    fetchRobots();
    return () => {
      mounted = false;
    };
  }, [api, tcpHost]);

  const startTcpTest = async () => {
    try {
      let message;
      try {
        message = JSON.parse(tcpMessageText);
        setTcpMessageError(null);
      } catch {
        setTcpMessageError("메시지 JSON 형식이 올바르지 않습니다.");
        return;
      }
      await api.post("/api/plc/tcp-test/start", {
        host: tcpHost,
        port: Number(tcpPort),
        apiNo: Number(tcpApiNo),
        message,
        intervalMs: 1000,
      });
      setTcpTestRunning(true);
      setTcpTestResults([]);
    } catch (e) {
      console.error("TCP 테스트 시작 실패:", e);
    }
  };

  const stopTcpTest = async () => {
    try {
      await api.post("/api/plc/tcp-test/stop");
      setTcpTestRunning(false);
    } catch (e) {
      console.error("TCP 테스트 중지 실패:", e);
    }
  };

  const tcpColumns = [
    {
      title: "시간",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 180,
      render: (v) =>
        v
          ? new Date(v).toLocaleTimeString("ko-KR", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              fractionalSecondDigits: 3,
            })
          : "-",
    },
    {
      title: "상태",
      dataIndex: "success",
      key: "success",
      width: 80,
      render: (v) => <Tag color={v ? "green" : "red"}>{v ? "OK" : "FAIL"}</Tag>,
    },
    {
      title: "응답 시간",
      dataIndex: "elapsedMs",
      key: "elapsedMs",
      width: 100,
      render: (v) => (v != null ? `${v}ms` : "-"),
    },
    {
      title: "응답/에러",
      dataIndex: "response",
      key: "response",
      render: (v, record) => {
        if (record.error) {
          return (
            <pre style={{ margin: 0, color: "red", whiteSpace: "pre-wrap" }}>
              {record.error}
            </pre>
          );
        }
        if (v == null) return "-";
        const pretty = typeof v === "string" ? v : JSON.stringify(v, null, 2);
        return (
          <pre
            style={{
              margin: 0,
              maxHeight: 180,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontSize: 11,
              lineHeight: 1.4,
              background: "#fafafa",
              padding: "6px 8px",
              borderRadius: 4,
            }}
          >
            {pretty}
          </pre>
        );
      },
    },
  ];

  const rows = metricsQ.data?.data || [];
  const latest = rows.length > 0 ? rows[rows.length - 1] : {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ═══════ 서버 안정성 모니터 ═══════ */}
      <Card
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DashboardOutlined style={{ fontSize: 18, color: "#1677ff" }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>서버 안정성 모니터</span>
            <Tag color="blue" style={{ marginLeft: 4, fontWeight: 400, fontSize: 11 }}>
              최근 24시간
            </Tag>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => metricsQ.refetch()}
            loading={metricsQ.isFetching}
            type="text"
          >
            새로고침
          </Button>
        }
      >
        {metricsQ.isLoading && <Spin tip="시스템 메트릭 로딩 중..." style={{ display: "block", padding: 40 }} />}
        {metricsQ.error && (
          <Alert
            type="error"
            message="시스템 메트릭 조회 실패"
            description={metricsQ.error.message}
            showIcon
            style={{ borderRadius: 8 }}
          />
        )}
        {rows.length > 0 && (
          <>
            {/* ── 상태 요약 카드 ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <StatCard
                icon={<ClockCircleOutlined />}
                title="업타임"
                value={formatUptime(latest.uptimeSec)}
                color="#1677ff"
              />
              <StatCard
                icon={<DashboardOutlined />}
                title="시스템 CPU"
                value={latest.systemCpuPct?.toFixed(1) ?? "-"}
                suffix="%"
                color="#1677ff"
              />
              <StatCard
                icon={<CloudServerOutlined />}
                title="프로세스 CPU"
                value={latest.processCpuPct?.toFixed(1) ?? "-"}
                suffix="%"
                color="#13c2c2"
              />
              <StatCard
                icon={<ThunderboltOutlined />}
                title="메모리 사용률"
                value={latest.systemMemUsedPct?.toFixed(1) ?? "-"}
                suffix="%"
                color="#722ed1"
                subText={latest.processMemMb ? `프로세스: ${latest.processMemMb} MB` : undefined}
              />
              <StatCard
                icon={<ArrowDownOutlined />}
                title="네트워크 Rx"
                value={formatBps(latest.netRxBps)}
                color="#52c41a"
              />
              <StatCard
                icon={<ArrowUpOutlined />}
                title="네트워크 Tx"
                value={formatBps(latest.netTxBps)}
                color="#eb2f96"
              />
            </div>

            {/* ── 추가 정보 ── */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              <Tag
                style={{
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 12,
                  border: "1px solid #f0f0f0",
                  background: "#fafafa",
                }}
              >
                Event Loop Lag: <b>{latest.eventLoopLagMaxMs?.toFixed(2) ?? "-"} ms</b>
              </Tag>
              <Tag
                style={{
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 12,
                  border: "1px solid #f0f0f0",
                  background: "#fafafa",
                }}
              >
                Active Handles / Requests: <b>{latest.activeHandles ?? "-"} / {latest.activeRequests ?? "-"}</b>
              </Tag>
              <Tag
                style={{
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 12,
                  border: "1px solid #f0f0f0",
                  background: "#fafafa",
                }}
              >
                샘플 간격: <b>1000 ms</b>
              </Tag>
            </div>

            {/* ── 차트 그리드 ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
                gap: 16,
              }}
            >
              {[
                { key: "systemCpu", label: "시스템 CPU (%)" },
                { key: "processCpu", label: "프로세스 CPU (%)" },
                { key: "memory", label: "시스템 메모리 사용률 (%)" },
                { key: "eventLoop", label: "Event Loop Lag Max (ms)" },
                { key: "rx", label: "네트워크 Rx (B/s)" },
                { key: "tx", label: "네트워크 Tx (B/s)" },
              ].map(({ key, label }) => (
                <Card
                  key={key}
                  size="small"
                  bordered={false}
                  style={{
                    borderRadius: 10,
                    background: "#fff",
                    border: "1px solid #f0f0f0",
                  }}
                  title={
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      <span style={{ color: CHART_CONFIGS[key].color }}>●</span> {label}
                    </span>
                  }
                >
                  <MetricChart data={chartData} dataKey={key} config={CHART_CONFIGS[key]} />
                </Card>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ═══════ 설정값 (PLC→DB) ═══════ */}
      <Card
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SettingOutlined style={{ fontSize: 18, color: "#1677ff" }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>설정값 (PLC → DB)</span>
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => settingsQ.refetch()}
            loading={settingsQ.isFetching}
            type="text"
          >
            새로고침
          </Button>
        }
      >
        {settingsQ.isLoading && <Spin tip="설정 로딩 중..." style={{ display: "block", padding: 40 }} />}
        {settingsQ.error && (
          <Alert
            type="error"
            message="설정 조회 실패"
            description={settingsQ.error.message}
            showIcon
            style={{ borderRadius: 8 }}
          />
        )}
        {settingsQ.data && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {[
              { label: "기준 연마기 PLC ID", value: settingsQ.data.reference_grinder, color: "#1677ff" },
              { label: "연마기 신호 활성화 후 대기", value: settingsQ.data.grinder_wait_ms, suffix: "ms", color: "#fa8c16" },
              { label: "배터리 충전 필요 기준", value: settingsQ.data.charge_threshold_percent, suffix: "%", color: "#f5222d" },
              { label: "배터리 충전 완료 기준", value: settingsQ.data.charge_complete_percent, suffix: "%", color: "#52c41a" },
            ].map((item, idx) => (
              <div
                key={idx}
                style={{
                  background: "#fafafa",
                  borderRadius: 10,
                  padding: "14px 18px",
                  border: "1px solid #f0f0f0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 12, color: "#8c8c8c" }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>
                  {item.value ?? "-"}
                  {item.suffix && item.value != null && (
                    <span style={{ fontSize: 13, fontWeight: 400, color: "#8c8c8c", marginLeft: 2 }}>
                      {item.suffix}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Divider style={{ margin: "12px 0 16px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            type="primary"
            style={{ borderRadius: 8 }}
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-trigger", { side: "L" });
                setTriggerResult({
                  type: "success",
                  text: `좌측 트리거 전송: ${res.written?.join(", ") || "완료"}`,
                });
              } catch (err) {
                setTriggerResult({ type: "error", text: err?.message || "좌측 트리거 실패" });
              } finally {
                setTriggerLoading(false);
              }
            }}
            loading={triggerLoading}
          >
            태스크 트리거 테스트 (L)
          </Button>
          <Button
            type="primary"
            style={{ borderRadius: 8 }}
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-trigger", { side: "R" });
                setTriggerResult({
                  type: "success",
                  text: `우측 트리거 전송: ${res.written?.join(", ") || "완료"}`,
                });
              } catch (err) {
                setTriggerResult({ type: "error", text: err?.message || "우측 트리거 실패" });
              } finally {
                setTriggerLoading(false);
              }
            }}
            loading={triggerLoading}
          >
            태스크 트리거 테스트 (R)
          </Button>
          <Button
            danger
            style={{ borderRadius: 8 }}
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-reset", { side: "ALL" });
                setTriggerResult({
                  type: "success",
                  text: `태스크 신호 리셋: ${res.written?.join(", ") || "완료"}`,
                });
              } catch (err) {
                setTriggerResult({ type: "error", text: err?.message || "리셋 실패" });
              } finally {
                setTriggerLoading(false);
              }
            }}
            loading={triggerLoading}
          >
            태스크 신호 리셋
          </Button>
          {triggerResult && (
            <Tag
              color={triggerResult.type === "success" ? "green" : "red"}
              style={{ borderRadius: 6, padding: "4px 12px" }}
            >
              {triggerResult.text}
            </Tag>
          )}
        </div>
      </Card>

      {/* ═══════ TCP 통신 테스트 ═══════ */}
      <Card
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ApiOutlined style={{ fontSize: 18, color: tcpTestRunning ? "#52c41a" : "#1677ff" }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>TCP 통신 테스트</span>
            <Tag color="default" style={{ fontWeight: 400, fontSize: 11 }}>
              Doosan State
            </Tag>
            {tcpTestRunning && (
              <Tag color="processing" icon={<SendOutlined />} style={{ fontSize: 11 }}>
                실행 중
              </Tag>
            )}
          </div>
        }
        bordered={false}
        style={{ borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
      >
        {/* 입력 영역 */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
            background: "#fafafa",
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              AMR Host
            </Text>
            <Select
              value={tcpHost || undefined}
              onChange={(value) => setTcpHost(value)}
              options={robotOptions}
              placeholder="AMR IP 선택"
              showSearch
              optionFilterProp="label"
              style={{ width: 220 }}
              disabled={tcpTestRunning}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              Port
            </Text>
            <Input
              value={tcpPort}
              onChange={(e) => setTcpPort(e.target.value)}
              style={{ width: 80, borderRadius: 6 }}
              disabled={tcpTestRunning}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              API
            </Text>
            <Input
              value={tcpApiNo}
              onChange={(e) => setTcpApiNo(e.target.value)}
              style={{ width: 80, borderRadius: 6 }}
              disabled={tcpTestRunning}
              placeholder="ex) 4022"
            />
          </div>
          {!tcpTestRunning ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={startTcpTest}
              style={{ borderRadius: 8 }}
            >
              시작
            </Button>
          ) : (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={stopTcpTest}
              style={{ borderRadius: 8 }}
            >
              중지
            </Button>
          )}
        </div>

        {/* 메시지 입력 */}
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            메시지(JSON) — API 번호는 10진수 입력이며 헤더에 16진수로 전송됩니다.
          </Text>
          <Input.TextArea
            value={tcpMessageText}
            onChange={(e) => setTcpMessageText(e.target.value)}
            rows={4}
            disabled={tcpTestRunning}
            style={{ borderRadius: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
          />
          {tcpMessageError && (
            <Tag color="red" style={{ borderRadius: 6 }}>
              {tcpMessageError}
            </Tag>
          )}
        </div>

        {/* 결과 테이블 */}
        <Table
          dataSource={[...tcpTestResults].reverse()}
          columns={tcpColumns}
          rowKey="timestamp"
          size="small"
          pagination={false}
          scroll={{ y: 300 }}
          locale={{ emptyText: "테스트 결과가 없습니다" }}
          style={{ borderRadius: 8, overflow: "hidden" }}
        />
      </Card>
    </div>
  );
}
