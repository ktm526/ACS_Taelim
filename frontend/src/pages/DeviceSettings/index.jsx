import React, { useEffect, useMemo, useState } from "react";
import { Card, Input, Button, Spin, message, Divider, Collapse, Tag } from "antd";
import { useApiClient } from "@/hooks/useApiClient";

const SLOT_SIDES = ["L", "R"];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const GRINDER_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ["L", "R", "O", "I"];
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
        done_id: null,
        product_type_id: null,
      };
    });
  });
  return slots;
}

function createDefaultGrinders() {
  return GRINDER_INDEXES.map((index) => {
    const positions = {};
    POSITIONS.forEach((pos) => {
      const signals = {};
      SIGNALS.forEach((item) => {
        signals[item.key] = null;
      });
      positions[pos] = signals;
    });
    return { index, product_type_id: null, positions };
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length ? text : null;
}

export default function DeviceSettings() {
  const apiClient = useApiClient();
  const [loading, setLoading] = useState(true);
  const [savingInstocker, setSavingInstocker] = useState(false);
  const [savingGrinder, setSavingGrinder] = useState(false);
  const [plcValues, setPlcValues] = useState({});
  const [instocker, setInstocker] = useState({
    work_available_signal_id: null,
    slots: createDefaultSlots(),
  });
  const [grinder, setGrinder] = useState({
    grinders: createDefaultGrinders(),
  });

  const slotKeys = useMemo(() => {
    return SLOT_SIDES.flatMap((side) => SLOT_INDEXES.map((idx) => `${side}${idx}`));
  }, []);

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
    pushId(instocker.work_available_signal_id);
    slotKeys.forEach((slotKey) => {
      pushId(instocker.slots?.[slotKey]?.working_id);
      pushId(instocker.slots?.[slotKey]?.done_id);
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

  const renderSignalInput = (value, onChange) => {
    const key = normalizeText(value);
    const liveValue = key ? plcValues?.[key] : null;
    return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 8, alignItems: "center" }}>
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ID 입력"
        allowClear
      />
      {renderValueTag(liveValue)}
    </div>
    );
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
            <Button type="primary" onClick={saveInstocker} loading={savingInstocker}>
              저장
            </Button>
          }
        >
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ minWidth: 160 }}>작업 가능 신호 ID</span>
              <div style={{ width: 320 }}>
                {renderSignalInput(instocker.work_available_signal_id, (nextValue) =>
                  setInstocker((prev) => ({
                    ...prev,
                    work_available_signal_id: normalizeText(nextValue),
                  }))
                )}
              </div>
            </div>

            <Divider style={{ margin: "8px 0" }} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 1fr 1fr",
                gap: 8,
                alignItems: "center",
              }}
            >
              <strong>칸</strong>
              <strong>작업중 신호 ID</strong>
              <strong>작업완료 신호 ID</strong>
              <strong>제품 종류 ID</strong>
              {slotKeys.map((slotKey) => (
                <React.Fragment key={slotKey}>
                  <span>{slotKey}</span>
                  {renderSignalInput(
                    instocker.slots?.[slotKey]?.working_id ?? null,
                    (value) => handleSlotChange(slotKey, "working_id", value)
                  )}
                  {renderSignalInput(
                    instocker.slots?.[slotKey]?.done_id ?? null,
                    (value) => handleSlotChange(slotKey, "done_id", value)
                  )}
                  {renderSignalInput(
                    instocker.slots?.[slotKey]?.product_type_id ?? null,
                    (value) => handleSlotChange(slotKey, "product_type_id", value)
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </Card>

        <Card
          title="연마기 설정"
          extra={
            <Button type="primary" onClick={saveGrinder} loading={savingGrinder}>
              저장
            </Button>
          }
        >
          <Collapse
            accordion={false}
            items={grinder.grinders.map((item) => ({
              key: String(item.index),
              label: `연마기 ${item.index}`,
              children: (
                <div style={{ display: "grid", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ minWidth: 120 }}>제품 종류 ID</span>
                    <Input
                      value={item.product_type_id ?? ""}
                      onChange={(e) => handleGrinderProductChange(item.index, e.target.value)}
                      allowClear
                      style={{ width: 240 }}
                      placeholder="제품 종류 ID"
                    />
                  </div>

                  {POSITIONS.map((position) => (
                    <div key={`${item.index}-${position}`}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {item.index}-{position}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "160px 1fr",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        {SIGNALS.map((signal) => (
                          <React.Fragment key={`${item.index}-${position}-${signal.key}`}>
                            <span>{signal.label}</span>
                            {renderSignalInput(
                              item.positions?.[position]?.[signal.key] ?? null,
                              (value) =>
                                handleGrinderSignalChange(item.index, position, signal.key, value)
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      <Divider style={{ margin: "12px 0" }} />
                    </div>
                  ))}
                </div>
              ),
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
