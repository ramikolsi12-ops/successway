"use client";

import { useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Descriptions, Form, Input, Modal, Table } from "antd";
import { ApiError, apiRequest } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { tunisDate } from "@/lib/dates";
import type { AgendaEvent } from "@/types/agenda";
import type { AllocationPreviewRow, CorrectionPreview } from "@/types/payments";
import { FinancialStatusTag } from "./financial-status";
import { normalizeSessionPrice } from "./session-pricing-fields";

export function PriceCorrectionModal({ event, onClose, onCorrected }: {
  event: AgendaEvent; onClose: () => void; onCorrected: () => Promise<void>;
}) {
  const [form] = Form.useForm<{ amount: string; reason: string }>();
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const { message } = App.useApp();
  async function submit(commit: boolean) {
    if (submitting.current || (commit && (!preview || !confirmed))) return;
    submitting.current = true;
    const values = await form.validateFields().catch(() => null);
    if (!values) { submitting.current = false; return; }
    const input = { amount: normalizeSessionPrice(values.amount)!, reason: values.reason.trim() };
    setSaving(true); setError(null);
    try {
      if (!commit) {
        const next = await apiRequest<CorrectionPreview>(`/api/agenda/events/${encodeURIComponent(event.id)}/price-preview`, { method: "POST", body: JSON.stringify(input) });
        setPreview(next); setConfirmed(false);
      } else {
        idempotencyKey.current ??= crypto.randomUUID();
        await apiRequest(`/api/agenda/events/${encodeURIComponent(event.id)}/price`, { method: "PATCH", body: JSON.stringify({ ...input, previewToken: preview!.token, idempotencyKey: idempotencyKey.current, confirm: true }) });
        message.success("Le tarif de la séance a été corrigé avec succès. Les affectations ont été recalculées.");
        onClose(); await onCorrected();
      }
    } catch (cause) {
      const details = cause instanceof ApiError && cause.status === 409 ? cause.details as { preview?: CorrectionPreview } | undefined : undefined;
      if (details?.preview) {
        setPreview(details.preview); setConfirmed(false);
        setError("La situation financière a changé. Vérifiez le nouvel aperçu et confirmez de nouveau la correction.");
      } else setError(cause instanceof Error ? cause.message : "La correction du tarif a échoué.");
    } finally { submitting.current = false; setSaving(false); }
  }
  return <Modal open title="Corriger le tarif de la séance terminée" onCancel={() => { if (!saving) onClose(); }} width={780}
    closable={!saving} keyboard={!saving} mask={{ closable: !saving }} destroyOnHidden footer={[
      <Button key="cancel" disabled={saving} onClick={onClose}>Annuler</Button>,
      <Button key="preview" loading={saving && !preview} disabled={saving} onClick={() => void submit(false)}>Prévisualiser les conséquences</Button>,
      <Button key="confirm" type="primary" loading={saving && Boolean(preview)} disabled={saving || !preview || !confirmed} onClick={() => void submit(true)}>Confirmer la correction</Button>,
    ]}>
    <p><strong>{event.teacherName}</strong> · {event.classroomName}<br />{tunisDate(event.startAt).format("DD/MM/YYYY HH:mm")} · Tarif historique : {formatMoney(event.financial?.amount ?? event.rateSnapshot ?? "0.000")}</p>
    <Alert className="form-alert" type="warning" showIcon title="Cette correction conserve l’historique et recalcule les affectations du professeur" description="Les paiements seront réaffectés aux séances les plus anciennes. Une correction qui ramènerait le montant dû sous le montant déjà reçu sera refusée." />
    {error && <Alert className="form-alert" type="error" showIcon title={error} />}
    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ amount: event.financial?.amount ?? event.rateSnapshot ?? "", reason: "" }}
      onValuesChange={() => { setPreview(null); setConfirmed(false); idempotencyKey.current = null; }} disabled={saving}>
      <Form.Item name="amount" label="Nouveau tarif historique (DT)" rules={[{ validator: (_, value) => normalizeSessionPrice(value) !== null ? Promise.resolve() : Promise.reject(new Error("Saisissez un montant positif ou nul avec au maximum trois décimales.")) }]}><Input inputMode="decimal" suffix="DT" autoComplete="off" /></Form.Item>
      <Form.Item name="reason" label="Motif de la correction" rules={[{ required: true, whitespace: true, message: "Indiquez le motif de cette correction." }, { max: 2000, message: "Le motif ne doit pas dépasser 2 000 caractères." }]}><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
    </Form>
    {preview && <div className="agenda-correction-preview">
      <h3>Conséquences pour le professeur</h3>
      <Descriptions bordered size="small" column={1} items={[
        { key: "due", label: "Montant dû au centre", children: `${formatMoney(preview.before.totalDue)} → ${formatMoney(preview.after.totalDue)}` },
        { key: "remaining", label: "Reste à encaisser", children: `${formatMoney(preview.before.remaining)} → ${formatMoney(preview.after.remaining)}` },
        { key: "paid", label: "Séances payées", children: `${preview.before.paidSessions} → ${preview.after.paidSessions}` },
        { key: "partially-paid", label: "Séances partiellement payées", children: `${preview.before.partiallyPaidSessions} → ${preview.after.partiallyPaidSessions}` },
        { key: "settle", label: "Séances restant à régler", children: preview.sessionsToSettle },
      ]} />
      <Table<AllocationPreviewRow> size="small" rowKey="chargeId" dataSource={preview.allocations} pagination={{ pageSize: 6 }} scroll={{ x: 580 }} locale={{ emptyText: "Aucune affectation à afficher" }} columns={[
        { title: "Séance", key: "date", render: (_, row) => tunisDate(row.startAt).format("DD/MM/YYYY HH:mm") },
        { title: "Tarif", dataIndex: "amount", render: (value: string) => formatMoney(value) },
        { title: "Payé avant", dataIndex: "previouslyPaid", render: (value: string) => formatMoney(value) },
        { title: "Variation affectée", dataIndex: "allocated", render: (value: string) => formatMoney(value) },
        { title: "Reste", dataIndex: "remaining", render: (value: string) => formatMoney(value) },
        { title: "Statut financier", dataIndex: "status", render: (status: AllocationPreviewRow["status"]) => <FinancialStatusTag status={status} /> },
      ]} />
      <Checkbox checked={confirmed} disabled={saving} onChange={change => setConfirmed(change.target.checked)}>Je confirme ce nouveau tarif et les conséquences affichées.</Checkbox>
    </div>}
  </Modal>;
}
