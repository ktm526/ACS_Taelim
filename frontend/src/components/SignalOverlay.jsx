import React, { useState } from "react";
import { Button, Card, Space, Spin, Alert, message } from "antd";
import { InfoCircleOutlined, CloseOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_CORE_BASE_URL || "";

export default function SignalOverlay() {
  const [visible, setVisible] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  
  const { data, error, isLoading } = useQuery({
    queryKey: ["signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/health/signals`);
      if (!res.ok) throw new Error("네트워크 오류");
      return res.json();
    },
    refetchInterval: visible ? 1000 : false,
    retry: false,
  });

  const renderSignal = (value) => {
    if (value === null || value === undefined) return "-";
    return value === 1 ? "ON" : "OFF";
  };

  const collapsedContainer = {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1000,
  };
  const overlayContainer = {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1000,
    overflow: "hidden",
    borderRadius: 8,
  };
  const buttonStyle = {
    backdropFilter: "blur(4px)",
    background: "rgba(255, 255, 255, 0.1)",
    border: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    width: 32,
    height: 32,
    padding: 0,
  };
  const cardStyle = {
    width: 280,
    background: "rgba(255,255,255,0.15)",
    backdropFilter: "blur(6px)",
    borderRadius: 8,
    padding: 8,
  };

  return (
    <>
      {contextHolder}
      <div style={visible ? overlayContainer : collapsedContainer}>
        {!visible ? (
          <Button
            shape="circle"
            icon={<InfoCircleOutlined />}
            style={buttonStyle}
            size="small"
            onClick={() => setVisible(true)}
          />
        ) : (
          <Card
            size="small"
            title="신호 상태"
            extra={<CloseOutlined onClick={() => setVisible(false)} />}
            style={cardStyle}
          >
            {isLoading && <Spin tip="로딩 중..." style={{ width: "100%" }} />}
            {error && (
              <Alert
                type="error"
                message="불러오기 실패"
                description={error.message}
                showIcon
              />
            )}
            {data && (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <div>
                  <strong>인스토커 작업 가능:</strong>{" "}
                  L {renderSignal(data.instocker?.work_available?.L)} / R{" "}
                  {renderSignal(data.instocker?.work_available?.R)}
                </div>
                <div>
                  <strong>인스토커 배출 가능 제품 수:</strong>{" "}
                  {data.instocker?.available_count ?? "-"}
                </div>
                <div>
                  <strong>사용 연마기 수:</strong>{" "}
                  {data.grinder?.used_count ?? "-"}
                </div>
                <div>
                  <strong>연마기 투입 가능 제품 수:</strong>{" "}
                  {data.grinder?.input_ready_count ?? "-"}
                </div>
                <div>
                  <strong>연마기 배출 가능 제품 수:</strong>{" "}
                  {data.grinder?.output_ready_count ?? "-"}
                </div>
                <div>
                  <strong>아웃스토커 투입 가능 위치 수:</strong>{" "}
                  {data.outstocker?.load_ready_count ?? "-"}
                </div>
                <div>
                  <strong>아웃스토커 배출 가능 지그 수:</strong>{" "}
                  {data.outstocker?.unload_jig_count ?? "-"}
                </div>
                <div>
                  <strong>컨베이어 호출 신호:</strong>{" "}
                  {(data.conveyor?.calls || [])
                    .map((c) => `C${c.index ?? "?"}:${c.qty || 0}`)
                    .join(" / ") || "-"}
                </div>
              </Space>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

