import React from "react";
import { Drawer } from "antd";
import MapPreviewCard from "@/components/MapPreviewCard";
import PLCMapEditableTable from "@/components/PLCMapEditableTable";

export default function PLCMapEditorDrawer({ open, onClose, apiBase = "", stations = [], map = null }) {
  return (
    <>
      <Drawer
        title="PLC 맵(PLC↔스테이션 매핑) 편집"
        open={open}
        onClose={onClose}
        width={780}
        destroyOnClose
      >
        <div style={{ height: 360, marginBottom: 12 }}>
          <MapPreviewCard map={map} />
        </div>
        <PLCMapEditableTable apiBase={apiBase} stations={stations} />
      </Drawer>
    </>
  );
}

