import React, { useState, useEffect, useRef } from "react";
import { Card, Descriptions, Spin, Alert, Button, Divider, Tag, Input, Table, Select } from "antd";
import { ReloadOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/hooks/useApiClient";

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
        if (record.error) return <span style={{ color: "red" }}>{record.error}</span>;
        if (v == null) return "-";
        const str = typeof v === "string" ? v : JSON.stringify(v);
        return <span style={{ fontSize: 11, wordBreak: "break-all" }}>{str.length > 200 ? str.slice(0, 200) + "..." : str}</span>;
      },
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            메시지(JSON) - API 번호는 헤더의 request code로 전송됩니다.
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
