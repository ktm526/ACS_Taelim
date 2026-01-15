import React from "react";
import { Alert, Card, Descriptions, Divider, Space, Spin, Table, Tag } from "antd";
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

  const bitRows = (plcQ.data?.bitBlocks ?? []).map((b) => ({
    key: String(b.addr),
    addr: b.addr,
    hex: b.hex,
    bits: b.bits,
  }));

  const wordRows = Object.entries(plcQ.data?.words ?? {}).map(([addr, value]) => {
    const v = Number(value) & 0xffff;
    return {
      key: String(addr),
      addr: Number(addr),
      value: v,
      hex: "0x" + v.toString(16).toUpperCase().padStart(4, "0"),
    };
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

            <Card size="small" title="BIT (6000~6021: 6000.0 ~ 6000.F)">
              <Table
                size="small"
                bordered
                pagination={false}
                dataSource={bitRows}
                scroll={{ x: 1000, y: 360 }}
                columns={[
                  { title: "Word", dataIndex: "addr", width: 90 },
                  { title: "HEX", dataIndex: "hex", width: 100 },
                  {
                    title: "0~F",
                    dataIndex: "bits",
                    render: (bits) => (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(bits ?? []).map((b, idx) => (
                          <Tag
                            key={idx}
                            color={b ? "blue" : "default"}
                            style={{
                              marginInlineEnd: 0,
                              opacity: b ? 1 : 0.6,
                              borderStyle: b ? "solid" : "dashed",
                            }}
                          >
                            {idx.toString(16).toUpperCase()}
                          </Tag>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>

            <Card size="small" title="WORD (6030~6099)">
              <Table
                size="small"
                bordered
                pagination={false}
                dataSource={wordRows}
                scroll={{ y: 360 }}
                columns={[
                  { title: "Addr", dataIndex: "addr", width: 90 },
                  { title: "DEC", dataIndex: "value", width: 120 },
                  { title: "HEX", dataIndex: "hex", width: 120 },
                ]}
              />
            </Card>
          </>
        )}
      </Card>
    </Space>
  );
}

