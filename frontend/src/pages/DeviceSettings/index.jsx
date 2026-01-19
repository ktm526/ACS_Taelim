import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Input, Button, Spin, message, Divider, Tag, Select } from "antd";
import { useAtomValue } from "jotai";
import { useApiClient } from "@/hooks/useApiClient";
import { selectedMapAtom } from "@/state/atoms";

const SLOT_SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const GRINDER_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R"];
const SIGNALS = [
  { key: "input_ready_id", label: "투입 가능" },
  { key: "output_ready_id", label: "배출 가능" },
  { key: "safe_pos_id", label: "안전위치" },
  { key: "input_in_progress_id", label: "투입중" },
  { key: "input_done_id", label: "투입완료" },
  { key: "output_in_progress_id", label: "배출중" },
  { key: "output_done_id", label: "배출 완료" },
];

function createDefaultSlots() {
  const slots = {};
  SLOT_SIDES.forEach((side) => {
    SLOT_INDEXES.forEach((idx) => {
      slots[`${side}${idx}`] = {
        working_id: null,
        product_type_id: null,
        amr_pos: null,
        mani_pos: null,
      };
    });
  });
  return slots;
}

function createDefaultSideSignals() {
  const signals = {};
  SLOT_SIDES.forEach((side) => {
    signals[side] = {
      work_available_id: null,
      done_id: null,
      error_id: null,
      safe_id: null,
    };
  });
  return signals;
}

function createDefaultGrinders() {
  return GRINDER_INDEXES.map((index) => {
    const positions = {};
    POSITIONS.forEach((pos) => {
      const signals = {};
      SIGNALS.forEach((item) => {
        signals[item.key] = null;
      });
      positions[pos] = {
        ...signals,
        amr_pos: null,
        mani_pos: null,
      };
    });
    return { index, product_type_id: null, bypass_id: null, positions };
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length ? text : null;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export default function DeviceSettings() {
  const apiClient = useApiClient();
  const selectedMap = useAtomValue(selectedMapAtom);
  const [loading, setLoading] = useState(true);
  const [savingInstocker, setSavingInstocker] = useState(false);
  const [savingGrinder, setSavingGrinder] = useState(false);
  const [instockerSavedAt, setInstockerSavedAt] = useState(null);
  const [grinderSavedAt, setGrinderSavedAt] = useState(null);
  const [plcValues, setPlcValues] = useState({});
  const fileInputRef = useRef(null);
  const [instocker, setInstocker] = useState({
    work_available_signal_id: null,
    slots: createDefaultSlots(),
    side_signals: createDefaultSideSignals(),
  });
  const [grinder, setGrinder] = useState({
    grinders: createDefaultGrinders(),
  });

  const slotKeys = useMemo(() => {
    return SLOT_SIDES.flatMap((side) => SLOT_INDEXES.map((idx) => `${side}${idx}`));
  }, []);

  const stationOptions = useMemo(() => {
    try {
      const parsed = JSON.parse(selectedMap?.stations || "{}").stations || [];
      return parsed.map((station) => {
        if (typeof station === "string") {
          return { label: station, value: station };
        }
        const value = station.name ?? station.station_name ?? station.id ?? "";
        const label = station.name ?? station.station_name ?? station.id ?? String(value);
        return { label: String(label), value: String(value) };
      });
    } catch {
      return [];
    }
  }, [selectedMap]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [instockerRes, grinderRes] = await Promise.all([
          apiClient.get("/api/devices/instocker"),
          apiClient.get("/api/devices/grinder"),
        ]);
        if (instockerRes?.data) {
          setInstocker({
            work_available_signal_id: instockerRes.data.work_available_signal_id ?? null,
            slots: instockerRes.data.slots || createDefaultSlots(),
            side_signals: instockerRes.data.side_signals || createDefaultSideSignals(),
          });
        }
        if (grinderRes?.data) {
          setGrinder({
            grinders: grinderRes.data.grinders || createDefaultGrinders(),
          });
        }
      } catch (error) {
        console.error("장치 설정 로드 실패:", error);
        message.error("장치 설정을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [apiClient]);

  const signalIds = useMemo(() => {
    const ids = [];
    const pushId = (value) => {
      const text = normalizeText(value);
      if (text) ids.push(text);
    };
    SLOT_SIDES.forEach((side) => {
      pushId(instocker.side_signals?.[side]?.work_available_id);
      pushId(instocker.side_signals?.[side]?.done_id);
      pushId(instocker.side_signals?.[side]?.error_id);
      pushId(instocker.side_signals?.[side]?.safe_id);
    });
    slotKeys.forEach((slotKey) => {
      pushId(instocker.slots?.[slotKey]?.working_id);
      pushId(instocker.slots?.[slotKey]?.product_type_id);
    });
    grinder.grinders.forEach((item) => {
      POSITIONS.forEach((position) => {
        SIGNALS.forEach((signal) => {
          pushId(item.positions?.[position]?.[signal.key]);
        });
      });
    });
    return Array.from(new Set(ids));
  }, [instocker, grinder, slotKeys]);

  useEffect(() => {
    let isActive = true;
    let timer = null;

    const pollValues = async () => {
      if (!signalIds.length) {
        if (isActive) setPlcValues({});
        return;
      }
      try {
        const res = await apiClient.post("/api/plc/values", { ids: signalIds });
        if (isActive && res?.data) {
          setPlcValues(res.data);
        }
      } catch (error) {
        console.warn("PLC 값 로드 실패:", error);
      }
    };

    pollValues();
    timer = setInterval(pollValues, 1000);

    return () => {
      isActive = false;
      if (timer) clearInterval(timer);
    };
  }, [apiClient, signalIds]);

  const handleSlotChange = (slotKey, field, value) => {
    setInstocker((prev) => ({
      ...prev,
      slots: {
        ...prev.slots,
        [slotKey]: {
          ...prev.slots[slotKey],
          [field]: normalizeText(value),
        },
      },
    }));
  };

  const handleSideSignalChange = (side, field, value) => {
    setInstocker((prev) => ({
      ...prev,
      side_signals: {
        ...prev.side_signals,
        [side]: {
          ...prev.side_signals?.[side],
          [field]: normalizeText(value),
        },
      },
    }));
  };

  const handleGrinderProductChange = (index, value) => {
    setGrinder((prev) => ({
      grinders: prev.grinders.map((item) =>
        item.index === index ? { ...item, product_type_id: normalizeText(value) } : item
      ),
    }));
  };

  const handleGrinderSignalChange = (index, position, key, value) => {
    setGrinder((prev) => ({
      grinders: prev.grinders.map((item) => {
        if (item.index !== index) return item;
        return {
          ...item,
          positions: {
            ...item.positions,
            [position]: {
              ...item.positions[position],
              [key]: normalizeText(value),
            },
          },
        };
      }),
    }));
  };

  const saveInstocker = async () => {
    setSavingInstocker(true);
    try {
      await apiClient.put("/api/devices/instocker", instocker);
      message.success("인스토커 설정이 저장되었습니다.");
      setInstockerSavedAt(new Date());
    } catch (error) {
      console.error("인스토커 저장 실패:", error);
      message.error("인스토커 설정 저장에 실패했습니다.");
    } finally {
      setSavingInstocker(false);
    }
  };

  const saveGrinder = async () => {
    setSavingGrinder(true);
    try {
      await apiClient.put("/api/devices/grinder", grinder);
      message.success("연마기 설정이 저장되었습니다.");
      setGrinderSavedAt(new Date());
    } catch (error) {
      console.error("연마기 저장 실패:", error);
      message.error("연마기 설정 저장에 실패했습니다.");
    } finally {
      setSavingGrinder(false);
    }
  };

  const renderValueTag = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return <Tag color="default">-</Tag>;
    }
    return <Tag color="blue">{String(value)}</Tag>;
  };

  const buildCsvRows = () => {
    const rows = [["category", "target", "field", "value"]];
    SLOT_SIDES.forEach((side) => {
      rows.push([
        "instocker_side",
        side,
        "work_available_id",
        instocker.side_signals?.[side]?.work_available_id ?? "",
      ]);
      rows.push([
        "instocker_side",
        side,
        "done_id",
        instocker.side_signals?.[side]?.done_id ?? "",
      ]);
      rows.push([
        "instocker_side",
        side,
        "error_id",
        instocker.side_signals?.[side]?.error_id ?? "",
      ]);
      rows.push([
        "instocker_side",
        side,
        "safe_id",
        instocker.side_signals?.[side]?.safe_id ?? "",
      ]);
    });
    slotKeys.forEach((slotKey) => {
      rows.push([
        "instocker_slot",
        slotKey,
        "working_id",
        instocker.slots?.[slotKey]?.working_id ?? "",
      ]);
      rows.push([
        "instocker_slot",
        slotKey,
        "product_type_id",
        instocker.slots?.[slotKey]?.product_type_id ?? "",
      ]);
      rows.push([
        "instocker_slot",
        slotKey,
        "amr_pos",
        instocker.slots?.[slotKey]?.amr_pos ?? "",
      ]);
      rows.push([
        "instocker_slot",
        slotKey,
        "mani_pos",
        instocker.slots?.[slotKey]?.mani_pos ?? "",
      ]);
    });
    grinder.grinders.forEach((item) => {
      rows.push([
        "grinder",
        String(item.index),
        "product_type_id",
        item.product_type_id ?? "",
      ]);
      rows.push([
        "grinder",
        String(item.index),
        "bypass_id",
        item.bypass_id ?? "",
      ]);
      POSITIONS.forEach((position) => {
        rows.push([
          "grinder_position",
          `${item.index}-${position}`,
          "amr_pos",
          item.positions?.[position]?.amr_pos ?? "",
        ]);
        rows.push([
          "grinder_position",
          `${item.index}-${position}`,
          "mani_pos",
          item.positions?.[position]?.mani_pos ?? "",
        ]);
        SIGNALS.forEach((signal) => {
          rows.push([
            "grinder_signal",
            `${item.index}-${position}`,
            signal.key,
            item.positions?.[position]?.[signal.key] ?? "",
          ]);
        });
      });
    });
    return rows;
  };

  const handleExportCsv = () => {
    const rows = buildCsvRows();
    const csv = rows
      .map((row) => row.map((cell) => escapeCsvValue(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "device-settings.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyCsvRows = (rows) => {
    const nextInstocker = {
      ...instocker,
      slots: { ...instocker.slots },
      side_signals: { ...instocker.side_signals },
    };
    const nextGrinder = {
      ...grinder,
      grinders: grinder.grinders.map((item) => ({
        ...item,
        positions: { ...item.positions },
      })),
    };

    rows.forEach((row) => {
      const [category, target, field, value] = row;
      if (!category || !field) return;
      const normalizedValue = normalizeText(value);
      if (category === "instocker_side") {
        if (!SLOT_SIDES.includes(target)) return;
        nextInstocker.side_signals[target] = {
          ...nextInstocker.side_signals[target],
          [field]: normalizedValue,
        };
      } else if (category === "instocker_slot") {
        if (!nextInstocker.slots?.[target]) return;
        nextInstocker.slots[target] = {
          ...nextInstocker.slots[target],
          [field]: normalizedValue,
        };
      } else if (category === "grinder") {
        const index = Number(target);
        const grinderItem = nextGrinder.grinders.find((g) => g.index === index);
        if (!grinderItem) return;
        grinderItem[field] = normalizedValue;
      } else if (category === "grinder_position") {
        const [indexText, position] = String(target).split("-");
        const index = Number(indexText);
        const grinderItem = nextGrinder.grinders.find((g) => g.index === index);
        if (!grinderItem || !POSITIONS.includes(position)) return;
        grinderItem.positions[position] = {
          ...grinderItem.positions[position],
          [field]: normalizedValue,
        };
      } else if (category === "grinder_signal") {
        const [indexText, position] = String(target).split("-");
        const index = Number(indexText);
        const grinderItem = nextGrinder.grinders.find((g) => g.index === index);
        if (!grinderItem || !POSITIONS.includes(position)) return;
        grinderItem.positions[position] = {
          ...grinderItem.positions[position],
          [field]: normalizedValue,
        };
      }
    });

    setInstocker(nextInstocker);
    setGrinder(nextGrinder);
  };

  const handleImportCsv = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result ? String(reader.result) : "";
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
      if (!lines.length) {
        message.warning("CSV 내용이 비어 있습니다.");
        return;
      }
      const rows = lines.map(parseCsvLine);
      const header = rows[0] || [];
      const hasHeader =
        header[0]?.trim() === "category" &&
        header[1]?.trim() === "target" &&
        header[2]?.trim() === "field";
      const dataRows = hasHeader ? rows.slice(1) : rows;
      applyCsvRows(dataRows);
      message.success("CSV를 불러왔습니다. 저장을 눌러 반영하세요.");
    };
    reader.onerror = () => {
      message.error("CSV 파일을 읽지 못했습니다.");
    };
    reader.readAsText(file);
  };

  if (loading) {
    return (
      <div style={{ padding: 32, display: "flex", justifyContent: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, background: "#fafafa", minHeight: "100%" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 24 }}>
        <Card
          title="인스토커 설정"
          extra={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button onClick={handleExportCsv}>CSV 내보내기</Button>
              <Button onClick={() => fileInputRef.current?.click()}>CSV 가져오기</Button>
              <Button type="primary" onClick={saveInstocker} loading={savingInstocker}>
                저장
              </Button>
              {instockerSavedAt && (
                <Tag color="green">
                  저장됨 {instockerSavedAt.toLocaleTimeString("ko-KR")}
                </Tag>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportCsv(file);
                  e.target.value = "";
                }}
              />
            </div>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {SLOT_SIDES.map((side) => (
              <div
                key={side}
                style={{
                  border: "1px solid #e8e8e8",
                  borderRadius: 8,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 8,
                    borderBottom: "1px solid #f0f0f0",
                    paddingBottom: 8,
                  }}
                >
                  {side} 측면
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr 50px",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                >
                  <span>작업가능</span>
                  <Input
                    size="small"
                    value={instocker.side_signals?.[side]?.work_available_id ?? ""}
                    onChange={(e) => handleSideSignalChange(side, "work_available_id", e.target.value)}
                    placeholder="ID"
                  />
                  {renderValueTag(
                    instocker.side_signals?.[side]?.work_available_id
                      ? plcValues?.[instocker.side_signals[side].work_available_id]
                      : null
                  )}

                  <span>작업완료</span>
                  <Input
                    size="small"
                    value={instocker.side_signals?.[side]?.done_id ?? ""}
                    onChange={(e) => handleSideSignalChange(side, "done_id", e.target.value)}
                    placeholder="ID"
                  />
                  {renderValueTag(
                    instocker.side_signals?.[side]?.done_id
                      ? plcValues?.[instocker.side_signals[side].done_id]
                      : null
                  )}

                  <span>작업에러</span>
                  <Input
                    size="small"
                    value={instocker.side_signals?.[side]?.error_id ?? ""}
                    onChange={(e) => handleSideSignalChange(side, "error_id", e.target.value)}
                    placeholder="ID"
                  />
                  {renderValueTag(
                    instocker.side_signals?.[side]?.error_id
                      ? plcValues?.[instocker.side_signals[side].error_id]
                      : null
                  )}

                  <span>안전위치</span>
                  <Input
                    size="small"
                    value={instocker.side_signals?.[side]?.safe_id ?? ""}
                    onChange={(e) => handleSideSignalChange(side, "safe_id", e.target.value)}
                    placeholder="ID"
                  />
                  {renderValueTag(
                    instocker.side_signals?.[side]?.safe_id
                      ? plcValues?.[instocker.side_signals[side].safe_id]
                      : null
                  )}
                </div>

                <Divider style={{ margin: "8px 0" }} />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "30px 1fr 1fr 1fr 1fr",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>#</span>
                  <span style={{ fontWeight: 600 }}>작업중</span>
                  <span style={{ fontWeight: 600 }}>제품종류</span>
                  <span style={{ fontWeight: 600 }}>AMR Pos</span>
                  <span style={{ fontWeight: 600 }}>Mani</span>

                  {SLOT_INDEXES.map((idx) => {
                    const slotKey = `${side}${idx}`;
                    const workingId = instocker.slots?.[slotKey]?.working_id;
                    const productId = instocker.slots?.[slotKey]?.product_type_id;
                    return (
                      <React.Fragment key={slotKey}>
                        <span style={{ fontWeight: 500 }}>{idx}</span>
                        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                          <Input
                            size="small"
                            value={workingId ?? ""}
                            onChange={(e) => handleSlotChange(slotKey, "working_id", e.target.value)}
                            placeholder="ID"
                            style={{ flex: 1 }}
                          />
                          <Tag
                            color={workingId && plcValues?.[workingId] != null ? "blue" : "default"}
                            style={{ margin: 0, fontSize: 10, padding: "0 4px" }}
                          >
                            {workingId ? plcValues?.[workingId] ?? "-" : "-"}
                          </Tag>
                        </div>
                        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                          <Input
                            size="small"
                            value={productId ?? ""}
                            onChange={(e) => handleSlotChange(slotKey, "product_type_id", e.target.value)}
                            placeholder="ID"
                            style={{ flex: 1 }}
                          />
                          <Tag
                            color={productId && plcValues?.[productId] != null ? "blue" : "default"}
                            style={{ margin: 0, fontSize: 10, padding: "0 4px" }}
                          >
                            {productId ? plcValues?.[productId] ?? "-" : "-"}
                          </Tag>
                        </div>
                        <Select
                          size="small"
                          showSearch
                          allowClear
                          value={instocker.slots?.[slotKey]?.amr_pos ?? null}
                          onChange={(value) => handleSlotChange(slotKey, "amr_pos", value)}
                          options={stationOptions}
                          filterOption={(input, option) =>
                            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                          }
                          placeholder="스테이션"
                          style={{ width: "100%" }}
                        />
                        <Input
                          size="small"
                          value={instocker.slots?.[slotKey]?.mani_pos ?? ""}
                          onChange={(e) => handleSlotChange(slotKey, "mani_pos", e.target.value)}
                          placeholder="값"
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="연마기 설정"
          extra={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button onClick={handleExportCsv}>CSV 내보내기</Button>
              <Button onClick={() => fileInputRef.current?.click()}>CSV 가져오기</Button>
              <Button type="primary" onClick={saveGrinder} loading={savingGrinder}>
                저장
              </Button>
              {grinderSavedAt && (
                <Tag color="green">
                  저장됨 {grinderSavedAt.toLocaleTimeString("ko-KR")}
                </Tag>
              )}
            </div>
          }
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
            }}
          >
            {grinder.grinders.map((item) => (
              <div
                key={item.index}
                style={{
                  border: "1px solid #e8e8e8",
                  borderRadius: 8,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 8,
                    borderBottom: "1px solid #f0f0f0",
                    paddingBottom: 8,
                  }}
                >
                  연마기 {item.index}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr 60px",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 12,
                  }}
                >
                  <span>제품종류</span>
                  <Input
                    size="small"
                    value={item.product_type_id ?? ""}
                    onChange={(e) => handleGrinderProductChange(item.index, e.target.value)}
                    placeholder="ID"
                  />
                  {renderValueTag(item.product_type_id ? plcValues?.[item.product_type_id] : null)}

                  <span>bypass</span>
                  <Input
                    size="small"
                    value={item.bypass_id ?? ""}
                    onChange={(e) =>
                      setGrinder((prev) => ({
                        grinders: prev.grinders.map((g) =>
                          g.index === item.index
                            ? { ...g, bypass_id: normalizeText(e.target.value) }
                            : g
                        ),
                      }))
                    }
                    placeholder="ID"
                  />
                  {renderValueTag(item.bypass_id ? plcValues?.[item.bypass_id] : null)}
                </div>

                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr 1fr",
                      gap: 4,
                      alignItems: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#666",
                      marginBottom: 4,
                    }}
                  >
                    <span></span>
                    <span style={{ textAlign: "center" }}>L</span>
                    <span style={{ textAlign: "center" }}>R</span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr 1fr",
                      gap: 4,
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <span>AMR Pos</span>
                    {POSITIONS.map((pos) => (
                      <Select
                        key={`${item.index}-${pos}-amr`}
                        size="small"
                        showSearch
                        allowClear
                        value={item.positions?.[pos]?.amr_pos ?? null}
                        onChange={(value) =>
                          handleGrinderSignalChange(item.index, pos, "amr_pos", value)
                        }
                        options={stationOptions}
                        filterOption={(input, option) =>
                          (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                        }
                        placeholder="스테이션"
                        style={{ width: "100%" }}
                      />
                    ))}

                    <span>Mani Pos</span>
                    {POSITIONS.map((pos) => (
                      <Input
                        key={`${item.index}-${pos}-mani`}
                        size="small"
                        value={item.positions?.[pos]?.mani_pos ?? ""}
                        onChange={(e) =>
                          handleGrinderSignalChange(item.index, pos, "mani_pos", e.target.value)
                        }
                        placeholder="값"
                      />
                    ))}

                    {SIGNALS.map((signal) => (
                      <React.Fragment key={`${item.index}-${signal.key}`}>
                        <span style={{ fontSize: 11 }}>{signal.label}</span>
                        {POSITIONS.map((pos) => {
                          const val = item.positions?.[pos]?.[signal.key] ?? null;
                          const liveVal = val ? plcValues?.[val] : null;
                          return (
                            <div
                              key={`${item.index}-${pos}-${signal.key}`}
                              style={{ display: "flex", gap: 2, alignItems: "center" }}
                            >
                              <Input
                                size="small"
                                value={val ?? ""}
                                onChange={(e) =>
                                  handleGrinderSignalChange(
                                    item.index,
                                    pos,
                                    signal.key,
                                    e.target.value
                                  )
                                }
                                placeholder="ID"
                                style={{ flex: 1 }}
                              />
                              <Tag
                                color={liveVal != null ? "blue" : "default"}
                                style={{ margin: 0, fontSize: 10, padding: "0 4px" }}
                              >
                                {liveVal ?? "-"}
                              </Tag>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
