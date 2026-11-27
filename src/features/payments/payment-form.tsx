"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, DatePicker, Descriptions, Form, Input, Modal, Select, Spin } from "antd";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { AllocationPreview, compareMoney, conflictPreview, normalizedAmount, sumMoney } from "./finance-ui";
import type { ProfessorRow } from "@/types/management";
import type { FinancialPayment, PaymentInput, PaymentPreview } from "@/types/payments";

export function PaymentForm({ professors, professorId, payment, onClose, onSaved }: {
  professors: ProfessorRow[]; professorId?: string; payment?: FinancialPayment;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [fields, setFields] = useState({ teacherId: payment?.teacherId ?? professorId ?? "", amount: payment?.amount ?? "", paymentDate: payment?.paymentDate ?? tunisDate().format("YYYY-MM-DD"), notes: payment?.notes ?? "", reason: "" });
  const [result, setResult] = useState<{ key: string; preview: PaymentPreview } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const idempotency = useRef<{ key: string; id: string } | null>(null);
  const { message } = App.useApp();
  const router = useRouter();
  const professor = professors.find(row => row.id === fields.teacherId);
  const amount = normalizedAmount(fields.amount);
  const input: PaymentInput = { teacherId: fields.teacherId, amount: amount ?? "", paymentDate: fields.paymentDate, notes: fields.notes.trim() || null };
  const correctionInput = { amount: input.amount, paymentDate: input.paymentDate, notes: input.notes, reason: fields.reason.trim() };
  const payloadKey = JSON.stringify(payment ? correctionInput : input);
  const preview = result?.key === payloadKey ? result.preview : null;
  const before = result?.preview.teacherId === fields.teacherId ? result.preview.before : professor?.finance;
  const maximumAmount = before ? sumMoney([before.remaining, ...(payment ? [payment.amount] : [])]) : null;
  const noOutstanding = maximumAmount !== null && compareMoney(maximumAmount, "0.000") <= 0;
  const exceedsRemaining = Boolean(amount && maximumAmount !== null && compareMoney(amount, maximumAmount) > 0);
  const amountError = fields.amount && !amount ? "Saisissez un montant supérieur à zéro, avec trois décimales au maximum." : exceedsRemaining ? `Le montant du paiement ne peut pas dépasser le reste à encaisser de ${maximumAmount} DT.` : null;
  const ready = Boolean(fields.teacherId && before && amount && !exceedsRemaining && !noOutstanding && fields.paymentDate && fields.paymentDate <= tunisDate().format("YYYY-MM-DD") && (!payment || fields.reason.trim().length >= 3));
  const loading = loadingKey === payloadKey;
  function change<K extends keyof typeof fields>(key: K, value: typeof fields[K]) { setFields(previous => ({ ...previous, [key]: value })); setError(null); }

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingKey(payloadKey);
      try {
        const body = JSON.parse(payloadKey) as PaymentInput | typeof correctionInput;
        const next = await apiRequest<PaymentPreview>(payment ? `/api/payments/${payment.id}/preview` : "/api/payments/preview", { method: "POST", signal: controller.signal, body: JSON.stringify({ ...body, ...(payment ? { kind: "PAYMENT" } : {}) }) });
        if (!controller.signal.aborted) { setResult({ key: payloadKey, preview: next }); setError(null); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "L’aperçu n’a pas pu être calculé."); }
      finally { if (!controller.signal.aborted) setLoadingKey(null); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [payloadKey, ready, payment]);

  async function save() {
    if (savingRef.current || !preview || !ready) return;
    savingRef.current = true; setSaving(true); setError(null);
    if (idempotency.current?.key !== payloadKey) idempotency.current = { key: payloadKey, id: crypto.randomUUID() };
    try {
      await apiRequest(payment ? `/api/payments/${payment.id}/correction` : "/api/payments", { method: "POST", body: JSON.stringify({ ...(payment ? correctionInput : input), previewToken: preview.token, idempotencyKey: idempotency.current.id, confirm: true }) });
      message.success(payment ? "Le paiement a été corrigé. L’original et ses affectations restent consultables." : "Le paiement a été enregistré et réparti automatiquement sur les séances les plus anciennes.");
      router.refresh(); onClose();
      try { await onSaved(); } catch { message.warning("Le paiement est enregistré. Actualisez la page pour consulter les nouveaux soldes."); }
    } catch (cause) {
      const updated = conflictPreview(cause);
      if (updated) { setResult({ key: payloadKey, preview: updated }); setError("La situation financière a changé. Vérifiez le nouvel aperçu puis confirmez de nouveau."); }
      else setError(cause instanceof Error ? cause.message : "Le paiement n’a pas pu être enregistré.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  return <Modal open title={payment ? "Corriger le paiement" : "Enregistrer un paiement"} width={940} onCancel={() => { if (!savingRef.current) onClose(); }} onOk={() => void save()} okText={payment ? "Confirmer la correction" : "Confirmer le paiement"} cancelText="Annuler" confirmLoading={saving} okButtonProps={{ disabled: !preview || !ready || loading }} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
    {payment && <Alert showIcon type="warning" className="form-alert" title={`Paiement original : ${formatMoney(payment.amount)} reçu le ${formatDateOnly(payment.paymentDate)}`} description="La correction conserve l’original, crée un paiement corrigé et recalcule les affectations du professeur. Indiquez le motif puis vérifiez les nouveaux soldes avant de confirmer." />}
    {error && <Alert showIcon type="error" title={error} className="form-alert" />}
    {noOutstanding && <Alert showIcon type="info" title="Ce professeur n'a aucun montant à régler." className="form-alert" />}
    <Form layout="vertical" requiredMark disabled={saving}>
      <Form.Item label="Professeur" required><Select value={fields.teacherId || undefined} disabled={Boolean(payment || professorId) || saving} showSearch optionFilterProp="label" placeholder="Choisir un professeur" onChange={value => change("teacherId", value)} options={professors.map(row => ({ value: row.id, label: `${row.fullName} · ${row.phone}${row.active ? "" : " · Inactif"}` }))} /></Form.Item>
      {before && <Descriptions title="Situation avant paiement — toutes périodes" size="small" bordered column={{ xs: 1, sm: 2 }} style={{ marginBottom: 20 }} items={[
        { key: "professor", label: "Professeur", children: professor?.fullName ?? payment?.teacherName },
        { key: "completed", label: "Séances effectuées", children: professor?.completedSessions ?? before.paidSessions + before.partiallyPaidSessions + before.unpaidSessions },
        { key: "paid", label: "Séances payées", children: before.paidSessions },
        { key: "partial", label: "Séances partiellement payées", children: before.partiallyPaidSessions },
        { key: "unpaid", label: "Séances non payées", children: before.unpaidSessions },
        { key: "remaining", label: "Reste à encaisser", children: formatMoney(before.remaining) },
      ]} />}
      <div className="form-columns"><Form.Item label="Montant reçu (DT)" required validateStatus={amountError ? "error" : undefined} help={amountError ?? "Précision : 0,001 DT."}><Input value={fields.amount} disabled={saving || noOutstanding} onChange={event => change("amount", event.target.value.replace(",", "."))} onBlur={() => { if (amount) change("amount", amount); }} suffix="DT" inputMode="decimal" maxLength={16} placeholder="210,000" /></Form.Item>
        <Form.Item label="Date du paiement" required><DatePicker value={fields.paymentDate ? tunisDate(`${fields.paymentDate}T12:00:00+01:00`) : null} format="DD/MM/YYYY" allowClear={false} disabledDate={current => current.format("YYYY-MM-DD") > tunisDate().format("YYYY-MM-DD")} onChange={value => change("paymentDate", value?.format("YYYY-MM-DD") ?? "")} /></Form.Item></div>
      <Form.Item label="Note (facultative)"><Input.TextArea value={fields.notes} onChange={event => change("notes", event.target.value)} maxLength={4000} rows={2} /></Form.Item>
      {payment && <Form.Item label="Motif de la correction" required><Input.TextArea value={fields.reason} onChange={event => change("reason", event.target.value)} maxLength={2000} rows={2} /></Form.Item>}
    </Form>
    {loading && <Spin tip="Calcul de la répartition…"><div style={{ height: 70 }} /></Spin>}
    {preview && ready ? <AllocationPreview preview={preview} /> : !loading && !noOutstanding && <Alert showIcon type="info" title="L’aperçu est calculé automatiquement après la saisie des champs obligatoires." />}
  </Modal>;
}
