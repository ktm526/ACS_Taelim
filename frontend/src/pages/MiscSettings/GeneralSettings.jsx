import React, { useState } from "react";
import { Card, Descriptions, Spin, Alert, Button, Divider, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/hooks/useApiClient";

export default function GeneralSettings() {
  const api = useApiClient();
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);

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

  return (
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
              const res = await api.post("/api/plc/task-trigger", {
                side: "L",
              });
              setTriggerResult({
                type: "success",
                text: `좌측 트리거 전송: ${res.written?.join(", ") || "완료"}`,
              });
            } catch (err) {
              setTriggerResult({
                type: "error",
                text: err?.message || "좌측 트리거 실패",
              });
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
              const res = await api.post("/api/plc/task-trigger", {
                side: "R",
              });
              setTriggerResult({
                type: "success",
                text: `우측 트리거 전송: ${res.written?.join(", ") || "완료"}`,
              });
            } catch (err) {
              setTriggerResult({
                type: "error",
                text: err?.message || "우측 트리거 실패",
              });
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
              const res = await api.post("/api/plc/task-reset", {
                side: "ALL",
              });
              setTriggerResult({
                type: "success",
                text: `태스크 신호 리셋: ${res.written?.join(", ") || "완료"}`,
              });
            } catch (err) {
              setTriggerResult({
                type: "error",
                text: err?.message || "리셋 실패",
              });
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
  );
}
