// src/pages/MapSettings/ServerMapFile.jsx
import React, { useRef, useState, useEffect, useCallback } from "react";
import { Card, Button, List, Spin, Popconfirm, theme, Typography, Empty } from "antd";
import {
  UploadOutlined,
  FileOutlined,
  EyeOutlined,
  DeleteOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MapDetailModal from "./MapDetailModal";

const { Text } = Typography;

function safeParse(raw, fallback = {}) {
  if (raw == null) return fallback;
  let v = raw;
  try {
    if (typeof v === "string") v = JSON.parse(v);
    if (typeof v === "string") v = JSON.parse(v);
  } catch {
    return fallback;
  }
  return v ?? fallback;
}

export default function ServerMapFile() {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const fileInputRef = useRef(null);
  const canvasContRef = useRef(null);
  const canvasRef = useRef(null);

  const [hoveredId, setHoveredId] = useState(null);
  const [selectedMap, setSelectedMap] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 캔버스 뷰 상태
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [sf, setSf] = useState(1);
  const [drag, setDrag] = useState(false);
  const [last, setLast] = useState({ x: 0, y: 0 });

  const CORE_API = import.meta.env.VITE_CORE_BASE_URL;

  /* ───────── ① maps 조회 ───────── */
  const mapsQuery = useQuery({
    queryKey: ["serverMaps"],
    queryFn: async () => {
      const res = await fetch(`${CORE_API}/api/maps`);
      return await res.json();
    },
  });

  /* ───────── ② 업로드 (.smap / .json) ───────── */
  const uploadMut = useMutation({
    mutationFn: async (files) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("mapFile", f));
      const res = await fetch(`${CORE_API}/api/maps/import`, {
        method: "POST",
        body: fd,
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["serverMaps"] }),
  });

  /* ───────── ③ 삭제 ───────── */
  const delMut = useMutation({
    mutationFn: (id) =>
      fetch(`${CORE_API}/api/maps/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["serverMaps"] });
      if (selectedMap?.id === delMut.variables) {
        setSelectedMap(null);
      }
    },
  });

  /* ───────── UI 핸들러 ───────── */
  const triggerFile = () => fileInputRef.current.click();
  const onFileChange = (e) => {
    const list = Array.from(e.target.files || []);
    if (list.length) uploadMut.mutate(list);
    e.target.value = "";
  };

  const selectMap = (map) => {
    setSelectedMap(selectedMap?.id === map.id ? null : map);
  };

  /* ───────── 캔버스 로직 ───────── */
  const fitCanvas = useCallback(() => {
    if (!canvasContRef.current || !canvasRef.current) return;
    const rect = canvasContRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const c = canvasRef.current;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.style.width = `${rect.width}px`;
    c.style.height = `${rect.height}px`;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    if (!selectedMap) return;
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, [selectedMap, fitCanvas]);

  // 맵 선택 시 뷰 초기화
  useEffect(() => {
    if (!canvasContRef.current || !selectedMap) return;
    const hdr = safeParse(selectedMap.additional_info).header || {};
    let { minPos, maxPos, resolution } = hdr;

    // header가 없으면 스테이션 좌표에서 범위 계산
    if (!minPos || !maxPos) {
      const stations = safeParse(selectedMap.stations).stations ?? [];
      if (stations.length > 0) {
        const xs = stations.map((s) => s.x);
        const ys = stations.map((s) => s.y);
        minPos = { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1 };
        maxPos = { x: Math.max(...xs) + 1, y: Math.max(...ys) + 1 };
      } else {
        setSf(1);
        setScale(1);
        setOffset({ x: 50, y: 50 });
        return;
      }
    }

    const nSf = resolution ? 1 / resolution : 1;
    setSf(nSf);

    const rect = canvasContRef.current.getBoundingClientRect();
    const mapWidth = (maxPos.x - minPos.x) * nSf;
    const mapHeight = (maxPos.y - minPos.y) * nSf;
    const scaleX = (rect.width - 40) / Math.max(mapWidth, 1);
    const scaleY = (rect.height - 40) / Math.max(mapHeight, 1);
    const fitScale = Math.min(scaleX, scaleY, 2);

    const midX = (minPos.x + maxPos.x) / 2;
    const midY = (minPos.y + maxPos.y) / 2;

    setScale(fitScale);
    setOffset({
      x: rect.width / 2 - midX * nSf * fitScale,
      y: rect.height / 2 - midY * nSf * fitScale,
    });

    setTimeout(fitCanvas, 10);
  }, [selectedMap, fitCanvas]);

  const transform = useCallback(
    (x, y) => {
      const h = canvasContRef.current?.getBoundingClientRect().height || 0;
      return {
        x: x * sf * scale + offset.x,
        y: h - (y * sf * scale + offset.y),
      };
    },
    [sf, scale, offset]
  );

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !selectedMap) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    // normalPointList 그리기
    const normalPoints = safeParse(selectedMap.additional_info).normalPointList ?? [];
    if (normalPoints.length > 0) {
      ctx.fillStyle = token.colorInfo;
      ctx.beginPath();
      normalPoints.forEach((pt) => {
        const { x, y } = transform(pt.x, pt.y);
        ctx.moveTo(x + 2, y);
        ctx.arc(x, y, 2, 0, Math.PI * 2);
      });
      ctx.fill();
    }

    // 기존 normals(legacy) 그리기
    const normals = safeParse(selectedMap.additional_info).normalPosList ?? [];
    if (normals.length > 0) {
      ctx.fillStyle = "#000";
      normals.forEach((pt) => {
        const q = transform(pt.x, pt.y);
        ctx.fillRect(q.x, q.y, 1, 1);
      });
    }

    // 경로 그리기
    const paths = safeParse(selectedMap.paths).paths ?? [];
    const stations = safeParse(selectedMap.stations).stations ?? [];
    if (paths.length > 0) {
      ctx.strokeStyle = "#f00";
      ctx.lineWidth = 1;
      ctx.beginPath();
      paths.forEach((p) => {
        let s = p.coordinates?.start;
        let e = p.coordinates?.end;
        if (!s || !e) {
          s = stations.find((st) => String(st.id) === String(p.start));
          e = stations.find((st) => String(st.id) === String(p.end));
        }
        if (!s || !e) return;
        const sp = transform(s.x, s.y);
        const ep = transform(e.x, e.y);
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(ep.x, ep.y);
      });
      ctx.stroke();
    }

    // Stations 그리기
    const rPix = Math.max(4, 6 * scale);
    if (stations.length > 0) {
      ctx.fillStyle = "#ffa500";
      ctx.beginPath();
      stations.forEach((st) => {
        const p = transform(st.x, st.y);
        ctx.moveTo(p.x + rPix, p.y);
        ctx.arc(p.x, p.y, rPix, 0, Math.PI * 2);
      });
      ctx.fill();

      ctx.fillStyle = "#333";
      ctx.font = `${Math.max(10, 11 * scale)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      stations.forEach((st) => {
        const p = transform(st.x, st.y);
        ctx.fillText(st.name || st.id, p.x, p.y + rPix + 2);
      });
    }
  }, [selectedMap, transform, scale, token.colorInfo]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 패닝 & 줌
  const getPos = (e) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    setDrag(true);
    setLast(getPos(e));
  };

  const onMove = (e) => {
    if (!drag) return;
    const p = getPos(e);
    setOffset((o) => ({
      x: o.x + p.x - last.x,
      y: o.y - p.y + last.y,
    }));
    setLast(p);
  };

  const onUp = () => setDrag(false);

  const onWheel = useCallback(
    (e) => {
      e.preventDefault();
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const fac = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScale((prevScale) => {
        const ns = Math.max(0.1, Math.min(prevScale * fac, 10));
        const ratio = ns / prevScale;
        const rect = canvasContRef.current?.getBoundingClientRect();
        if (!rect) return prevScale;
        setOffset((o) => ({
          x: o.x * ratio + p.x * (1 - ratio),
          y: o.y * ratio + (rect.height - p.y) * (1 - ratio),
        }));
        return ns;
      });
    },
    []
  );

  // wheel 이벤트를 passive: false로 등록
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedMap) return;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [selectedMap, onWheel]);

  /* ───────── 컴포넌트 ───────── */
  return (
    <>
      <Card
        size="small"
        title="서버 맵 파일"
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
        styles={{
          body: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: token.padding,
            overflow: "hidden",
          },
        }}
      >
        <Button
          icon={<UploadOutlined />}
          onClick={triggerFile}
          style={{ marginBottom: token.paddingSM, alignSelf: "flex-start" }}
          loading={uploadMut.isPending}
        >
          업로드
        </Button>
        <input
          type="file"
          multiple
          accept=".smap,.json"
          ref={fileInputRef}
          hidden
          onChange={onFileChange}
        />

        {mapsQuery.isPending ? (
          <Spin style={{ marginTop: token.padding }} />
        ) : mapsQuery.isError ? (
          <Text type="danger">맵을 불러오는 중 오류가 발생했습니다.</Text>
        ) : (
          <List
            dataSource={mapsQuery.data}
            style={{ overflowY: "auto", marginBottom: selectedMap ? token.padding : 0 }}
            renderItem={(map) => (
              <List.Item
                key={map.id}
                onMouseEnter={() => setHoveredId(map.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => selectMap(map)}
                style={{
                  cursor: "pointer",
                  borderRadius: token.borderRadius,
                  background: selectedMap?.id === map.id ? token.colorPrimaryBg : undefined,
                  boxShadow:
                    hoveredId === map.id
                      ? "0 2px 8px rgba(0,0,0,0.15)"
                      : undefined,
                  margin: `0 0 ${token.paddingXS}px 0`,
                  padding: `${token.paddingXS}px ${token.padding}px`,
                }}
                actions={[
                  <Button
                    key="view"
                    icon={<EyeOutlined />}
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailOpen(map);
                    }}
                  />,
                  <Popconfirm
                    key="del"
                    title="정말 삭제하시겠습니까?"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      delMut.mutate(map.id);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      size="small"
                      loading={delMut.isPending}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <FileOutlined
                      style={{
                        fontSize: token.fontSizeIcon,
                        color: selectedMap?.id === map.id ? token.colorPrimary : token.colorTextSecondary,
                      }}
                    />
                  }
                  title={<span style={{ fontSize: 13 }}>{map.name}</span>}
                  description={
                    <span style={{ fontSize: 11 }}>
                      {map.last_updated
                        ? new Date(map.last_updated).toLocaleString()
                        : "―"}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}

        {/* 맵 캔버스 - 선택된 맵이 있을 때 리스트 아래에 표시 */}
        {selectedMap && (
          <div
            style={{
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              paddingTop: token.padding,
              flex: 1,
              minHeight: 300,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: token.paddingXS,
              }}
            >
              <Text strong>{selectedMap.name}</Text>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setSelectedMap(null)}
              />
            </div>
            <div
              ref={canvasContRef}
              style={{
                flex: 1,
                position: "relative",
                background: token.colorBgLayout,
                borderRadius: token.borderRadius,
                overflow: "hidden",
              }}
            >
              <canvas
                ref={canvasRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  cursor: drag ? "grabbing" : "grab",
                }}
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
              />
              {!safeParse(selectedMap.additional_info).normalPointList?.length &&
                !safeParse(selectedMap.additional_info).normalPosList?.length &&
                !safeParse(selectedMap.stations).stations?.length && (
                  <Empty
                    description="맵 데이터가 없습니다"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                )}
            </div>
          </div>
        )}
      </Card>

      {/* 미리보기 모달 */}
      {detailOpen && (
        <MapDetailModal
          open={!!detailOpen}
          onClose={() => setDetailOpen(false)}
          mapData={detailOpen}
          apiBase={CORE_API}
        />
      )}
    </>
  );
}
