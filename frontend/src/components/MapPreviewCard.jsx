import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, theme } from "antd";

// safeParse: 두 겹 JSON도 처리
function safeParse(str, fallback = {}) {
  try {
    let v = typeof str === "string" ? JSON.parse(str) : str;
    if (typeof v === "string") v = JSON.parse(v);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export default function MapPreviewCard({ map }) {
  const { token } = theme.useToken();
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scaleFactor, setScaleFactor] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [last, setLast] = useState({ x: 0, y: 0 });

  const stations = useMemo(() => safeParse(map?.stations).stations ?? [], [map]);
  const paths = useMemo(() => safeParse(map?.paths).paths ?? [], [map]);
  const normalPoints = useMemo(
    () => safeParse(map?.additional_info).normalPointList ?? safeParse(map?.additional_info).normalPosList ?? [],
    [map]
  );

  const updateCanvasSize = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const c = canvasRef.current;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.style.width = `${rect.width}px`;
    c.style.height = `${rect.height}px`;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const initViewport = useCallback(() => {
    if (!containerRef.current) return;
    const pts = [
      ...(stations ?? []).map(({ x, y }) => ({ x, y })),
      ...(normalPoints ?? []),
    ];
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = Math.max(maxX - minX, 0.01);
    const h = Math.max(maxY - minY, 0.01);
    const rect = containerRef.current.getBoundingClientRect();
    const sf = Math.max(0.1, Math.min(rect.width / w, rect.height / h) * 0.9);
    setScaleFactor(sf);
    setScale(1);
    setOffset({
      x: rect.width / 2 - (minX + w / 2) * sf,
      y: rect.height / 2 - (minY + h / 2) * sf,
    });
  }, [stations, normalPoints]);

  useEffect(() => {
    updateCanvasSize();
    initViewport();
    window.addEventListener("resize", updateCanvasSize);
    return () => window.removeEventListener("resize", updateCanvasSize);
  }, [updateCanvasSize, initViewport]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    const transform = (x, y) => {
      const h = containerRef.current?.getBoundingClientRect().height || 0;
      return {
        x: x * scaleFactor * scale + offset.x,
        y: h - (y * scaleFactor * scale + offset.y),
      };
    };

    // normal points
    if (normalPoints?.length) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      normalPoints.forEach((p) => {
        const q = transform(p.x, p.y);
        ctx.fillRect(q.x, q.y, 1, 1);
      });
    }

    // paths
    if (paths?.length) {
      ctx.strokeStyle = "rgba(255,0,0,0.35)";
      ctx.lineWidth = 1;
      paths.forEach((p) => {
        let s, e;
        if (p.coordinates) {
          s = p.coordinates.start;
          e = p.coordinates.end;
        } else {
          s = stations.find((st) => String(st.id) === String(p.start));
          e = stations.find((st) => String(st.id) === String(p.end));
        }
        if (!(s && e)) return;
        const sp = transform(s.x, s.y);
        const ep = transform(e.x, e.y);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(ep.x, ep.y);
        ctx.stroke();
      });
    }

    // stations
    if (stations?.length) {
      ctx.fillStyle = "rgba(255,165,0,0.85)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      stations.forEach((st) => {
        const p = transform(st.x, st.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillText(String(st.name ?? st.id), p.x, p.y - 10);
        ctx.fillStyle = "rgba(255,165,0,0.85)";
      });
    }
  }, [stations, paths, normalPoints, scale, offset, scaleFactor]);

  const getMouse = (e) => {
    const r = canvasRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    setLast(getMouse(e));
  };
  const onMouseMove = (e) => {
    if (!dragging) return;
    const pos = getMouse(e);
    setOffset((o) => ({ x: o.x + (pos.x - last.x), y: o.y + (pos.y - last.y) }));
    setLast(pos);
  };
  const onMouseUp = () => setDragging(false);
  const onWheel = (e) => {
    e.preventDefault();
    const pos = getMouse(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.max(0.1, Math.min(scale * factor, 80));
    const ratio = ns / scale;
    setScale(ns);
    setOffset((o) => ({ x: o.x * ratio + pos.x * (1 - ratio), y: o.y * ratio + pos.y * (1 - ratio) }));
  };

  return (
    <Card
      size="small"
      title={`현재 맵 미리보기${map?.name ? ` – ${map.name}` : ""}`}
      style={{ height: "100%" }}
      bodyStyle={{ padding: 0, height: "calc(100% - 44px)" }}
    >
      {!map ? (
        <div style={{ padding: token.padding }}>
          <Empty description="현재 선택된 맵이 없습니다" />
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            height: "100%",
            position: "relative",
            background: token.colorBgContainer,
            borderRadius: token.borderRadius,
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              inset: 0,
              cursor: dragging ? "grabbing" : "grab",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          />
        </div>
      )}
    </Card>
  );
}

