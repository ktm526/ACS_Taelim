import React from "react";
import { Alert, Card, Descriptions, Divider, Space, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/hooks/useApiClient";

export default function ConnectionInfoTab() {
  const api = useApiClient();

  const plcQ = useQuery({
    queryKey: ["plcSnapshot"],
    queryFn: async () => {
      const res = await api.get("/api/plc/snapshot");
      if (!res?.success) throw new Error(res?.message || "PLC 스냅샷 조회 실패");
      return res.data;
    },
    refetchInterval: 1000,
  });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="PLC 연결 정보" bordered>
        {plcQ.isLoading && <Spin tip="PLC 로딩 중..." />}
        {plcQ.error && (
          <Alert type="error" message="PLC 조회 실패" description={plcQ.error.message} />
        )}
        {plcQ.data && (
          <>
            <Descriptions bordered size="small" column={1} labelStyle={{ width: 200 }}>
              <Descriptions.Item label="connected">
                {String(plcQ.data.connected)}
              </Descriptions.Item>
              <Descriptions.Item label="lastPollAt">
                {plcQ.data.lastPollAt ? new Date(plcQ.data.lastPollAt).toLocaleString() : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="lastError">
                {plcQ.data.lastError ?? "-"}
              </Descriptions.Item>
            </Descriptions>

            <Divider />

            <Descriptions bordered size="small" column={1} labelStyle={{ width: 200 }}>
              <Descriptions.Item label="BIT (6000~6021)">
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(plcQ.data.bits, null, 2)}
                </pre>
              </Descriptions.Item>
              <Descriptions.Item label="WORD (6030~6099)">
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(plcQ.data.words, null, 2)}
                </pre>
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Card>
    </Space>
  );
}

