import React from "react";
import { ConfigProvider } from "antd";
import ServerMapFile from "./ServerMapFile";

export default function MapSettings() {
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
          padding: 24,
          height: "100vh",
          boxSizing: "border-box",
        }}
      >
        <ServerMapFile />
      </div>
    </ConfigProvider>
  );
}
