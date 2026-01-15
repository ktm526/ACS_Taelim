import React from "react";
import { Card, theme } from "antd";
import MapPreviewCard from "@/components/MapPreviewCard";
import PLCMapEditableTable from "@/components/PLCMapEditableTable";

export default function PLCMapEditorPanel({ apiBase = "", stations = [], map = null }) {
  const { token } = theme.useToken();
  return (
    <>
      <Card
        size="small"
        title="PLC 맵(PLC↔스테이션 매핑)"
        style={{ height: "100%" }}
        bodyStyle={{
          padding: token.padding,
          height: "calc(100% - 44px)",
          display: "flex",
          flexDirection: "column",
          gap: token.marginMD,
        }}
      >
        <div style={{ height: 420 }}>
          <MapPreviewCard map={map} />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PLCMapEditableTable apiBase={apiBase} stations={stations} />
        </div>
      </Card>
    </>
  );
}

