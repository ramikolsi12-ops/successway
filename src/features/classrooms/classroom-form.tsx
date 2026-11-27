"use client";
import { useState } from "react";
import { Alert, App, Form, Input, Modal, Switch } from "antd";
import { apiRequest } from "@/lib/api-client";
import { createClassroomSchema, classroomFields } from "@/validations/management";
import type { ClassroomRow } from "@/types/management";

export function ClassroomForm({ room, open, onClose, onSaved }: { room: ClassroomRow | null; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form] = Form.useForm<{ name: string; description: string; active: boolean }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  async function save() {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const parsed = (room ? classroomFields : createClassroomSchema).safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true); setError(null);
    try {
      await apiRequest(room ? `/api/classrooms/${room.id}` : "/api/classrooms", { method: room ? "PATCH" : "POST", body: JSON.stringify(parsed.data) });
      await onSaved(); message.success(room ? "La salle a été modifiée." : "La salle a été ajoutée."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "L’enregistrement a échoué."); }
    finally { setSaving(false); }
  }
  return <Modal title={room ? "Modifier la salle" : "Ajouter une salle"} open={open} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="Enregistrer" cancelText="Annuler" destroyOnHidden
    afterClose={() => setError(null)}>
    {error && <Alert type="error" title={error} showIcon className="form-alert" />}
    <Form form={form} layout="vertical" requiredMark={false} preserve={false} initialValues={{ name: room?.name ?? "", description: room?.description ?? "", active: true }}>
      <Form.Item name="name" label="Nom de la salle" rules={[{ required: true, whitespace: true, message: "Saisissez un nom." }]}><Input maxLength={100} placeholder="Ex. Salle 7" /></Form.Item>
      <Form.Item name="description" label="Description"><Input.TextArea maxLength={2000} rows={3} placeholder="Équipements, accès, remarques…" /></Form.Item>
      {!room && <Form.Item name="active" label="Salle active" valuePropName="checked"><Switch checkedChildren="Oui" unCheckedChildren="Non" /></Form.Item>}
    </Form>
  </Modal>;
}
