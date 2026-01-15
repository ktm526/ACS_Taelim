import React, { useEffect, useMemo, useRef, useState } from "react";
import { AutoComplete, Button, Input, InputNumber, Popconfirm, Select, Space, Table, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const CLASS_OPTIONS = [
  { label: "in", value: "in" },
  { label: "out", value: "out" },
  { label: "연마기", value: "연마기" },
  { label: "컨베이어", value: "컨베이어" },
];

export default function PLCMapEditableTable({ apiBase = "", stations = [] }) {
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [q, setQ] = useState("");
  const [localRows, setLocalRows] = useState([]);
  const saveTimersRef = useRef(new Map()); // rowKey -> timeoutId
  const creatingRef = useRef(false);

  const stationAutoOptions = useMemo(() => {
    return (stations || [])
      .map((s) => {
        const id = String(s?.id ?? "");
        const name = String(s?.name ?? id);
        const value = name;
        return { value, label: `${name} (#${id})` };
      })
      .filter((o) => o.value);
  }, [stations]);

  const plcMapsQ = useQuery({
    queryKey: ["plcMaps", q],
    queryFn: async () => {
      const qs = q ? `?q=${encodeURIComponent(q)}` : "";
      const r = await fetch(`${apiBase}/api/plc-maps${qs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 1000,
  });

  // 서버 데이터 -> 로컬 편집용 상태로 반영
  useEffect(() => {
    if (!Array.isArray(plcMapsQ.data)) return;
    setLocalRows(
      plcMapsQ.data.map((r) => ({
        key: String(r.id),
        id: r.id,
        amr_station: r.amr_station ?? "",
        mani_id: r.mani_id ?? "",
        class: r.class ?? null,
        product_type: r.product_type ?? null,
        bypass: r.bypass == null ? 0 : Number(r.bypass),
      }))
    );
  }, [plcMapsQ.data]);

  const createMut = useMutation({
    mutationFn: async (body) => {
      const r = await fetch(`${apiBase}/api/plc-maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      return r.json();
    },
    onSuccess: () => {
      messageApi.success("추가 완료");
      qc.invalidateQueries({ queryKey: ["plcMaps"] });
      creatingRef.current = false;
    },
    onError: (e) => messageApi.error(e?.message || "추가 실패"),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }) => {
      const r = await fetch(`${apiBase}/api/plc-maps/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      return r.json();
    },
    onSuccess: (updated) => {
      // 엑셀형 편집 UX를 위해, 저장 성공 시 전체 refetch로 로컬 입력을 덮어쓰지 않도록 함.
      // 서버가 반환한 row로 로컬만 동기화.
      if (updated && updated.id != null) {
        setLocalRows((prev) =>
          prev.map((r) =>
            String(r.id) === String(updated.id)
              ? {
                  ...r,
                  amr_station: updated.amr_station ?? "",
                  mani_id: updated.mani_id ?? "",
                  class: updated.class ?? null,
                  product_type: updated.product_type ?? null,
                  bypass: updated.bypass == null ? 0 : Number(updated.bypass),
                }
              : r
          )
        );
      }
    },
    onError: (e) => messageApi.error(e?.message || "저장 실패"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id) => {
      const r = await fetch(`${apiBase}/api/plc-maps/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
    },
    onSuccess: () => {
      messageApi.success("삭제 완료");
      qc.invalidateQueries({ queryKey: ["plcMaps"] });
    },
    onError: (e) => messageApi.error(e?.message || "삭제 실패"),
  });

  const addRow = () => {
    // 신규 행은 항상 표 최상단에 하나만 유지
    setLocalRows((prev) => {
      if (prev.some((r) => r.key === "__new__")) return prev;
      return [
        {
          key: "__new__",
          id: null,
          amr_station: "",
          mani_id: "",
          class: null,
          product_type: null,
          bypass: 0,
        },
        ...prev,
      ];
    });
  };

  const scheduleUpdate = (row) => {
    // id=0도 유효하므로 falsy 체크 금지
    if (row?.id == null || row.key === "__new__") return;
    const key = row.key;
    const m = saveTimersRef.current;
    if (m.has(key)) clearTimeout(m.get(key));
    m.set(
      key,
      setTimeout(() => {
        const patch = {
          amr_station: row.amr_station,
          mani_id: row.mani_id || null,
          class: row.class,
          product_type: row.product_type == null ? null : Number(row.product_type),
          bypass: row.class === "연마기" ? (Number.isFinite(Number(row.bypass)) ? Number(row.bypass) : 0) : 0,
        };
        updateMut.mutate({ id: row.id, body: patch });
      }, 350)
    );
  };

  const tryCreateIfReady = (row) => {
    if (row.key !== "__new__") return;
    if (creatingRef.current) return;
    const id = Number(row.id);
    if (!Number.isFinite(id)) return;
    if (!row.amr_station) return;
    if (!row.class) return;
    creatingRef.current = true;
    createMut.mutate({
      id,
      amr_station: row.amr_station,
      mani_id: row.mani_id || null,
      class: row.class,
      product_type: row.product_type == null ? null : Number(row.product_type),
      bypass: row.class === "연마기" ? (Number.isFinite(Number(row.bypass)) ? Number(row.bypass) : 0) : 0,
    });
    // 성공 시 invalidateQueries로 서버 데이터 재로딩되며 __new__는 사라짐
    setLocalRows((prev) => prev.filter((r) => r.key !== "__new__"));
  };

  const updateCell = (rowKey, field, value) => {
    setLocalRows((prev) => {
      const next = prev.map((r) => {
        if (r.key !== rowKey) return r;
        const nr = { ...r, [field]: value };
        // class가 연마기가 아니면 bypass는 강제로 false
        if (field === "class" && value !== "연마기") nr.bypass = 0;
        return nr;
      });
      const changed = next.find((r) => r.key === rowKey);
      if (changed) {
        if (changed.key === "__new__") tryCreateIfReady(changed);
        else scheduleUpdate(changed);
      }
      return next;
    });
  };

  const columns = [
    {
      title: "PLC ID",
      dataIndex: "id",
      width: 80,
      render: (_, r) => (
        <InputNumber
          value={r.id}
          min={0}
          precision={0}
          style={{ width: "100%" }}
          disabled={r.key !== "__new__"}
          onChange={(v) => updateCell(r.key, "id", v)}
          onBlur={() => tryCreateIfReady(r)}
        />
      ),
    },
    {
      title: "AMR 스테이션",
      dataIndex: "amr_station",
      width: 200,
      render: (_, r) => (
        <AutoComplete
          value={r.amr_station}
          options={stationAutoOptions}
          placeholder="스테이션"
          style={{ width: "100%" }}
          filterOption={(inputValue, option) =>
            (option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase()) ||
            (option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
          }
          onChange={(v) => updateCell(r.key, "amr_station", v)}
          onBlur={() => tryCreateIfReady(r)}
        />
      ),
    },
    {
      title: "Manipulator Code",
      dataIndex: "mani_id",
      width: 160,
      render: (_, r) => (
        <Input
          value={r.mani_id}
          placeholder="두산팔 ID"
          onChange={(e) => updateCell(r.key, "mani_id", e.target.value)}
        />
      ),
    },
    {
      title: "Class",
      dataIndex: "class",
      width: 140,
      render: (_, r) => (
        <Select
          value={r.class}
          options={CLASS_OPTIONS}
          style={{ width: "100%" }}
          onChange={(v) => updateCell(r.key, "class", v)}
          placeholder="선택"
        />
      ),
    },
    {
      title: "ByPass ID",
      dataIndex: "bypass",
      width: 110,
      render: (_, r) => (
        <InputNumber
          value={r.bypass}
          min={0}
          precision={0}
          style={{ width: "100%" }}
          disabled={r.class !== "연마기"}
          onChange={(v) => updateCell(r.key, "bypass", v)}
        />
      ),
    },
    {
      title: "Product type",
      dataIndex: "product_type",
      width: 110,
      render: (_, r) => (
        <Select
          value={r.product_type}
          style={{ width: "100%" }}
          placeholder="선택"
          options={[
            { label: "1", value: 1 },
            { label: "2", value: 2 },
          ]}
          allowClear
          onChange={(v) => updateCell(r.key, "product_type", v == null ? null : Number(v))}
        />
      ),
    },
    {
      title: "",
      dataIndex: "actions",
      width: 120,
      render: (_, r) =>
        r.key === "__new__" ? (
          <Button size="small" onClick={() => setLocalRows((p) => p.filter((x) => x.key !== "__new__"))}>
            새 행 취소
          </Button>
        ) : (
          <Popconfirm title="삭제하시겠습니까?" okText="삭제" cancelText="취소" onConfirm={() => deleteMut.mutate(r.id)}>
            <Button size="small" danger>
              삭제
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Input
          placeholder="검색(스테이션/mani)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 260 }}
          allowClear
        />
        <Button type="primary" onClick={addRow} disabled={createMut.isLoading || updateMut.isLoading}>
          + 행 추가
        </Button>
      </Space>

      <Table
        bordered
        size="small"
        loading={plcMapsQ.isLoading}
        dataSource={localRows}
        columns={columns}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        scroll={{ y: 420, x: 980 }}
      />
    </>
  );
}

