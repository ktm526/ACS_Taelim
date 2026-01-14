import React from "react";
import { ConfigProvider } from "antd";
import { useAtomValue } from "jotai";
import { selectedMapAtom } from "@/state/atoms";
import ServerMapFile from "./ServerMapFile";
import MapPreviewCard from "@/components/MapPreviewCard";
import PLCMapEditorPanel from "@/components/PLCMapEditorPanel";

export default function MapSettings() {
  const selMap = useAtomValue(selectedMapAtom);
  const stations = (() => {
    try {
      return JSON.parse(selMap?.stations || "{}").stations || [];
    } catch {
      return [];
    }
  })();

  return (
    <ConfigProvider
      theme={{
        components: {
          Card: {
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            borderRadius: 8,
          },
        },
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 24,
          height: "100vh",
          padding: 24,
          overflowY: "hidden",
        }}
      >
        <MapPreviewCard map={selMap} />

        <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 24, minHeight: 0 }}>
          <ServerMapFile />
          <PLCMapEditorPanel apiBase={import.meta.env.VITE_CORE_BASE_URL || ""} stations={stations} />
        </div>
      </div>
    </ConfigProvider>
  );
}
