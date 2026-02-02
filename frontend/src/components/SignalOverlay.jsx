import React, { useState } from "react";
import { Button, Card, Spin, Alert, Tag } from "antd";
import { InfoCircleOutlined, CloseOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_CORE_BASE_URL || "";

export default function SignalOverlay() {
  const [visible, setVisible] = useState(false);

  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["signals"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/health/signals`);
      if (!res.ok) throw new Error("네트워크 오류");
      return res.json();
    },
    refetchInterval: visible ? 2000 : false,
    retry: false,
  });

  const renderSignalTag = (value) => {
    if (value === null || value === undefined) return <Tag>-</Tag>;
    return value === 1 ? <Tag color="green">ON</Tag> : <Tag>OFF</Tag>;
  };

  const collapsedContainer = {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 1000,
  };
  const overlayContainer = {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 1000,
    overflow: "hidden",
    borderRadius: 8,
  };
  const buttonStyle = {
    backdropFilter: "blur(4px)",
    background: "rgba(255, 255, 255, 0.85)",
    border: "1px solid #d9d9d9",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    width: 32,
    height: 32,
    padding: 0,
  };
  const cardStyle = {
    width: 320,
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(6px)",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  };
  const rowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 13,
  };
  const labelStyle = {
    color: "#666",
  };
  const valueStyle = {
    fontWeight: 500,
  };

  return (
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
          title="장치 신호 상태"
          extra={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined spin={isFetching} />}
                onClick={() => refetch()}
              />
              <CloseOutlined
                onClick={() => setVisible(false)}
                style={{ cursor: "pointer", fontSize: 14 }}
              />
            </div>
          }
          style={cardStyle}
          styles={{ body: { padding: "8px 12px" } }}
        >
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
              <Spin size="small" />
            </div>
          )}
          {error && (
            <Alert
              type="error"
              message="불러오기 실패"
              description={error.message}
              showIcon
              style={{ marginBottom: 8 }}
            />
          )}
          {data && (
            <div>
              <div style={rowStyle}>
                <span style={labelStyle}>인스토커 작업 가능</span>
                <span style={valueStyle}>
                  L {renderSignalTag(data.instocker?.work_available?.L)} R{" "}
                  {renderSignalTag(data.instocker?.work_available?.R)}
                </span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>인스토커 배출 가능</span>
                <span style={valueStyle}>{data.instocker?.available_count ?? "-"}개</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>사용 연마기</span>
                <span style={valueStyle}>{data.grinder?.used_count ?? "-"}대</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>연마기 투입 가능</span>
                <span style={valueStyle}>{data.grinder?.input_ready_count ?? "-"}개</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>연마기 배출 가능</span>
                <span style={valueStyle}>{data.grinder?.output_ready_count ?? "-"}개</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>아웃스토커 투입 가능</span>
                <span style={valueStyle}>{data.outstocker?.load_ready_count ?? "-"}칸</span>
              </div>
              <div style={rowStyle}>
                <span style={labelStyle}>아웃스토커 배출 가능</span>
                <span style={valueStyle}>{data.outstocker?.unload_jig_count ?? "-"}개</span>
              </div>
              <div style={{ ...rowStyle, borderBottom: "none" }}>
                <span style={labelStyle}>컨베이어 호출</span>
                <span style={valueStyle}>
                  {(data.conveyor?.calls || [])
                    .map((c) => `C${c.index ?? "?"}:${c.qty || 0}`)
                    .join(" / ") || "-"}
                </span>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

