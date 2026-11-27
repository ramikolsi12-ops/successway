"use client";
import { useState } from "react";
import { Alert, App, Col, Form, Input, Modal, Row, Switch } from "antd";
import { apiRequest } from "@/lib/api-client";
import { createProfessorSchema, professorFields } from "@/validations/management";
import type { ProfessorRow } from "@/types/management";

type Values = { firstName: string; lastName: string; phone: string; email: string; address: string; notes: string; active: boolean };
export function ProfessorForm({ professor, open, onClose, onSaved }: { professor: ProfessorRow | null; open: boolean; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  async function save() {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const parsed = (professor ? professorFields : createProfessorSchema).safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true); setError(null);
    try {
      const saved = await apiRequest<{ id: string }>(professor ? `/api/professors/${professor.id}` : "/api/professors", { method: professor ? "PATCH" : "POST", body: JSON.stringify(parsed.data) });
      await onSaved(saved.id); message.success(professor ? "Les informations ont été modifiées." : "Le professeur a été ajouté."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "L’enregistrement a échoué."); }
    finally { setSaving(false); }
  }
  return <Modal title={professor ? "Modifier le professeur" : "Ajouter un professeur"} open={open} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="Enregistrer" cancelText="Annuler" width={680} destroyOnHidden
    afterClose={() => setError(null)}>
    {error && <Alert showIcon type="error" title={error} className="form-alert" />}
    <Form form={form} layout="vertical" requiredMark={false} preserve={false} initialValues={{ firstName: professor?.firstName ?? "", lastName: professor?.lastName ?? "", phone: professor?.phone ?? "", email: professor?.email ?? "", address: professor?.address ?? "", notes: professor?.notes ?? "", active: true }}>
      <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="firstName" label="Prénom" rules={[{ required: true, whitespace: true, message: "Saisissez le prénom." }]}><Input maxLength={100} autoComplete="given-name" /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="lastName" label="Nom" rules={[{ required: true, whitespace: true, message: "Saisissez le nom." }]}><Input maxLength={100} autoComplete="family-name" /></Form.Item></Col></Row>
      <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="phone" label="Téléphone" rules={[{ required: true, message: "Saisissez le téléphone." }]}><Input maxLength={30} type="tel" placeholder="20 123 456" /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="email" label="E-mail (facultatif)"><Input maxLength={254} type="email" autoComplete="email" /></Form.Item></Col></Row>
      <Form.Item name="address" label="Adresse"><Input.TextArea maxLength={1000} rows={2} /></Form.Item>
      <Form.Item name="notes" label="Notes"><Input.TextArea maxLength={4000} rows={3} /></Form.Item>
      {!professor && <Form.Item name="active" label="Professeur actif" valuePropName="checked"><Switch checkedChildren="Oui" unCheckedChildren="Non" /></Form.Item>}
    </Form>
  </Modal>;
}
