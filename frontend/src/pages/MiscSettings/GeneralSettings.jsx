import React, { useState, useEffect, useRef } from "react";
import { Card, Descriptions, Spin, Alert, Button, Divider, Tag, Input, Table, Select } from "antd";
import { ReloadOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/hooks/useApiClient";

function formatBps(v) {
  if (v == null || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  if (n < 1024) return `${n} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(2)} MB/s`;
}

function Sparkline({ data, color = "#1677ff", min = null, max = null, height = 60 }) {
  const width = 360;
  const nums = (data || []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!nums.length) {
    return <div style={{ height, fontSize: 12, color: "#999" }}>데이터 없음</div>;
  }
  const lo = min != null ? min : Math.min(...nums);
  const hiRaw = max != null ? max : Math.max(...nums);
  const hi = hiRaw === lo ? lo + 1 : hiRaw;
  const points = nums
    .map((v, i) => {
      const x = (i / Math.max(1, nums.length - 1)) * (width - 2) + 1;
      const y = height - ((v - lo) / (hi - lo)) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
}

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
      render: (v) => v ? new Date(v).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }) : "-",
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
      render: (v) => v != null ? `${v}ms` : "-",
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
        const pretty =
          typeof v === "string" ? v : JSON.stringify(v, null, 2);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        title="서버 안정성 모니터 (최근 24시간)"
        bordered
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => metricsQ.refetch()}
            disabled={metricsQ.isLoading}
          >
            새로고침
          </Button>
        }
      >
        {metricsQ.isLoading && <Spin tip="시스템 메트릭 로딩 중..." />}
        {metricsQ.error && (
          <Alert type="error" message="시스템 메트릭 조회 실패" description={metricsQ.error.message} />
        )}
        {metricsQ.data?.data?.length > 0 && (() => {
          const rows = metricsQ.data.data;
          const latest = rows[rows.length - 1] || {};
          const cpuData = rows.map((r) => r.systemCpuPct).filter((v) => v != null);
          const procCpuData = rows.map((r) => r.processCpuPct).filter((v) => v != null);
          const memData = rows.map((r) => r.systemMemUsedPct).filter((v) => v != null);
          const loopData = rows.map((r) => r.eventLoopLagMaxMs).filter((v) => v != null);
          const rxData = rows.map((r) => r.netRxBps).filter((v) => v != null);
          const txData = rows.map((r) => r.netTxBps).filter((v) => v != null);
          return (
            <div style={{ display: "grid", gap: 12 }}>
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="업타임">
                  {latest.uptimeSec != null ? `${Math.floor(latest.uptimeSec / 3600)}h ${Math.floor((latest.uptimeSec % 3600) / 60)}m` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="샘플 간격">
                  {metricsQ.data?.meta?.sample_ms != null ? `${metricsQ.data.meta.sample_ms} ms` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="시스템 CPU">
                  {latest.systemCpuPct != null ? `${latest.systemCpuPct.toFixed(1)} %` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="프로세스 CPU">
                  {latest.processCpuPct != null ? `${latest.processCpuPct.toFixed(1)} %` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="시스템 메모리 사용률">
                  {latest.systemMemUsedPct != null ? `${latest.systemMemUsedPct.toFixed(1)} %` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="프로세스 메모리 (RSS)">
                  {latest.processMemMb != null ? `${latest.processMemMb} MB` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Event Loop Lag (max)">
                  {latest.eventLoopLagMaxMs != null ? `${latest.eventLoopLagMaxMs.toFixed(2)} ms` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Active Handles / Requests">
                  {`${latest.activeHandles ?? "-"} / ${latest.activeRequests ?? "-"}`}
                </Descriptions.Item>
                <Descriptions.Item label="네트워크 Rx">
                  {formatBps(latest.netRxBps)}
                </Descriptions.Item>
                <Descriptions.Item label="네트워크 Tx">
                  {formatBps(latest.netTxBps)}
                </Descriptions.Item>
              </Descriptions>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card size="small" title="시스템 CPU(%)">
                  <Sparkline data={cpuData} min={0} max={100} color="#1677ff" />
                </Card>
                <Card size="small" title="프로세스 CPU(%)">
                  <Sparkline data={procCpuData} min={0} max={100} color="#13c2c2" />
                </Card>
                <Card size="small" title="시스템 메모리 사용률(%)">
                  <Sparkline data={memData} min={0} max={100} color="#722ed1" />
                </Card>
                <Card size="small" title="Event Loop Lag Max (ms)">
                  <Sparkline data={loopData} color="#fa8c16" />
                </Card>
                <Card size="small" title="네트워크 Rx (B/s)">
                  <Sparkline data={rxData} color="#52c41a" />
                </Card>
                <Card size="small" title="네트워크 Tx (B/s)">
                  <Sparkline data={txData} color="#eb2f96" />
                </Card>
              </div>
            </div>
          );
        })()}
      </Card>

      <Card
        title="설정값(PLC→DB)"
        bordered
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => settingsQ.refetch()}
            disabled={settingsQ.isLoading}
          >
            새로고침
          </Button>
        }
      >
        {settingsQ.isLoading && <Spin tip="설정 로딩 중..." />}
        {settingsQ.error && (
          <Alert type="error" message="설정 조회 실패" description={settingsQ.error.message} />
        )}
        {settingsQ.data && (
          <Descriptions bordered size="small" column={1} labelStyle={{ width: 260 }}>
            <Descriptions.Item label="기준 연마기 PLC ID">
              {settingsQ.data.reference_grinder ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="연마기 신호 활성화 후 대기 시간">
              {settingsQ.data.grinder_wait_ms ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="배터리 충전 필요 기준">
              {settingsQ.data.charge_threshold_percent ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="배터리 충전 완료 기준">
              {settingsQ.data.charge_complete_percent ?? "-"}
            </Descriptions.Item>
          </Descriptions>
        )}
        <Divider />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            type="primary"
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-trigger", { side: "L" });
                setTriggerResult({ type: "success", text: `좌측 트리거 전송: ${res.written?.join(", ") || "완료"}` });
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
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-trigger", { side: "R" });
                setTriggerResult({ type: "success", text: `우측 트리거 전송: ${res.written?.join(", ") || "완료"}` });
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
            onClick={async () => {
              try {
                setTriggerLoading(true);
                setTriggerResult(null);
                const res = await api.post("/api/plc/task-reset", { side: "ALL" });
                setTriggerResult({ type: "success", text: `태스크 신호 리셋: ${res.written?.join(", ") || "완료"}` });
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
            <Tag color={triggerResult.type === "success" ? "green" : "red"}>
              {triggerResult.text}
            </Tag>
          )}
        </div>
      </Card>

      <Card
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span>TCP 통신 테스트 (Doosan State)</span>
            {tcpTestRunning && <Tag color="processing">실행 중</Tag>}
          </div>
        }
        bordered
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <span>AMR Host:</span>
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
          <span>Port:</span>
          <Input
            value={tcpPort}
            onChange={(e) => setTcpPort(e.target.value)}
            style={{ width: 80 }}
            disabled={tcpTestRunning}
          />
          <span>API:</span>
          <Input
            value={tcpApiNo}
            onChange={(e) => setTcpApiNo(e.target.value)}
            style={{ width: 80 }}
            disabled={tcpTestRunning}
            placeholder="ex) 4022"
          />
          {!tcpTestRunning ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startTcpTest}>
              시작
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={stopTcpTest}>
              중지
            </Button>
          )}
        </div>
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#666" }}>
            메시지(JSON) - API 번호는 10진수 입력이며 헤더에 16진수로 전송됩니다.
          </div>
          <Input.TextArea
            value={tcpMessageText}
            onChange={(e) => setTcpMessageText(e.target.value)}
            rows={4}
            disabled={tcpTestRunning}
          />
          {tcpMessageError && <Tag color="red">{tcpMessageError}</Tag>}
        </div>
        <Table
          dataSource={[...tcpTestResults].reverse()}
          columns={tcpColumns}
          rowKey="timestamp"
          size="small"
          pagination={false}
          scroll={{ y: 300 }}
          locale={{ emptyText: "테스트 결과가 없습니다" }}
        />
      </Card>
    </div>
  );
}
