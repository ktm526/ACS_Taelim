import React, { useMemo, useState } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  AutoComplete,
  Popconfirm,
  message,
  theme,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const CLASS_OPTIONS = [
  { label: "in", value: "in" },
  { label: "out", value: "out" },
  { label: "연마기", value: "연마기" },
  { label: "컨베이어", value: "컨베이어" },
];

export default function PLCMapEditorPanel({ apiBase = "", stations = [] }) {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [q, setQ] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

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
    staleTime: 2000,
  });

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
      setEditOpen(false);
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
    onSuccess: () => {
      messageApi.success("저장 완료");
      qc.invalidateQueries({ queryKey: ["plcMaps"] });
      setEditOpen(false);
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

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      id: row.id,
      amr_station: row.amr_station,
      mani_id: row.mani_id ?? "",
      class: row.class,
      product_type: row.product_type ?? null,
      description: row.description ?? "",
    });
    setEditOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      id: Number(v.id),
      amr_station: v.amr_station,
      mani_id: v.mani_id || null,
      class: v.class,
      product_type: v.product_type == null ? null : Number(v.product_type),
      description: v.description || null,
    };
    if (editing) {
      const { id, ...patch } = body;
      updateMut.mutate({ id: editing.id, body: patch });
    } else {
      createMut.mutate(body);
    }
  };

  return (
    <>
      {contextHolder}
      <Card
        size="small"
        title="PLC 맵(PLC↔스테이션 매핑)"
        style={{ height: "100%" }}
        bodyStyle={{ padding: token.padding, height: "calc(100% - 44px)", display: "flex", flexDirection: "column" }}
        extra={
          <Space>
            <Input
              placeholder="검색(스테이션/mani/설명)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              추가
            </Button>
          </Space>
        }
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <Table
            size="small"
            rowKey="id"
            loading={plcMapsQ.isLoading}
            dataSource={plcMapsQ.data ?? []}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            scroll={{ y: 420 }}
            columns={[
              { title: "PLC", dataIndex: "id", width: 70 },
              { title: "Station", dataIndex: "amr_station", width: 140, ellipsis: true },
              { title: "Mani", dataIndex: "mani_id", width: 90, ellipsis: true },
              { title: "Class", dataIndex: "class", width: 90 },
              { title: "Prod", dataIndex: "product_type", width: 70 },
              { title: "Desc", dataIndex: "description", ellipsis: true },
              {
                title: "",
                key: "actions",
                width: 90,
                render: (_, r) => (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                    <Popconfirm title="삭제하시겠습니까?" okText="삭제" cancelText="취소" onConfirm={() => deleteMut.mutate(r.id)}>
                      <Button danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <Modal
        title={editing ? `PLCMap 수정 (PLC ${editing.id})` : "PLCMap 추가"}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        okButtonProps={{ loading: createMut.isLoading || updateMut.isLoading }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" label="PLC Bit(ID)" rules={[{ required: true, message: "PLC Bit를 입력하세요" }]}>
            <InputNumber style={{ width: "100%" }} min={0} precision={0} disabled={!!editing} />
          </Form.Item>

          <Form.Item name="amr_station" label="AMR Station" rules={[{ required: true, message: "AMR Station을 입력/선택하세요" }]}>
            <AutoComplete
              options={stationAutoOptions}
              placeholder="현재 맵 스테이션 이름 검색/선택 또는 직접 입력"
              filterOption={(inputValue, option) =>
                (option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase()) ||
                (option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
              }
            />
          </Form.Item>

          <Form.Item name="mani_id" label="Mani ID(두산팔 ID)">
            <Input placeholder="예: DUSAN_01" />
          </Form.Item>

          <Form.Item name="class" label="Class" rules={[{ required: true, message: "class를 선택하세요" }]}>
            <Select options={CLASS_OPTIONS} />
          </Form.Item>

          <Form.Item name="product_type" label="Product Type">
            <InputNumber style={{ width: "100%" }} min={0} precision={0} placeholder="예: 1" />
          </Form.Item>

          <Form.Item name="description" label="설명">
            <Input.TextArea rows={3} placeholder="메모/설명" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

