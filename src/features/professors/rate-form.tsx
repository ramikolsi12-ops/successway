"use client";
import { useState } from "react";
import { Alert, App, Checkbox, DatePicker, Form, Input, Modal } from "antd";
import type { Dayjs } from "dayjs";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { rateAgreementSchema } from "@/validations/management";

type Values = { pricePerSession: string; startDate: Dayjs; endDate?: Dayjs | null; notes: string; closePrevious: boolean };
export function RateForm({ professorId, open, onClose, onSaved, hasPrevious }: { professorId: string; open: boolean; onClose: () => void; onSaved: () => Promise<void>; hasPrevious: boolean }) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  async function save() {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const parsed = rateAgreementSchema.safeParse({ ...values, startDate: values.startDate?.format("YYYY-MM-DD"), endDate: values.endDate?.format("YYYY-MM-DD") ?? null });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true); setError(null);
    try {
      await apiRequest(`/api/professors/${professorId}/agreements`, { method: "POST", body: JSON.stringify(parsed.data) });
      await onSaved(); message.success("Le nouveau tarif a été enregistré."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Le tarif n’a pas pu être enregistré."); }
    finally { setSaving(false); }
  }
  return <Modal title="Définir un prix par séance" open={open} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okText="Enregistrer le tarif" cancelText="Annuler" destroyOnHidden
    afterClose={() => setError(null)}>
    <p className="muted">Ce prix correspond au montant que le professeur doit verser au centre pour chaque séance effectuée.</p>
    {error && <Alert type="error" title={error} showIcon className="form-alert" />}
    <Form form={form} layout="vertical" requiredMark={false} preserve={false} initialValues={{ startDate: tunisDate(), closePrevious: false, pricePerSession: "", notes: "" }}>
      <Form.Item name="pricePerSession" label="Prix par séance" rules={[{ required: true, message: "Saisissez le prix." }]}><Input suffix="DT" inputMode="decimal" placeholder="20,000" maxLength={15} /></Form.Item>
      <div className="form-columns"><Form.Item name="startDate" label="Début de validité" rules={[{ required: true, message: "Choisissez une date." }]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
        <Form.Item name="endDate" label="Fin (facultative)"><DatePicker format="DD/MM/YYYY" /></Form.Item></div>
      {hasPrevious && <Form.Item name="closePrevious" valuePropName="checked"><Checkbox>Clôturer le tarif précédent à la veille du nouveau tarif</Checkbox></Form.Item>}
      <Form.Item name="notes" label="Notes"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
    </Form>
    <Alert type="info" showIcon title="Les prix appliqués aux séances terminées sont conservés." />
  </Modal>;
}
