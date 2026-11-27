"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Collapse, Descriptions, Drawer, Empty, Form, Input, Modal, Space, Spin, Tag } from "antd";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { formatDateOnly, formatMoney } from "@/lib/format";
import { AllocationPreview, AllocationsTable, conflictPreview } from "./finance-ui";
import { PaymentForm } from "./payment-form";
import type { ProfessorRow } from "@/types/management";
import type { FinancialAudit, FinancialPayment, PaymentPreview } from "@/types/payments";

function AuditSnapshot({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  const items = Object.entries({ amount: "Montant", paymentDate: "Date du paiement", notes: "Notes", reason: "Motif", valid: "Valide", cancelled: "Annulé", totalDue: "Montant dû au centre", totalReceived: "Montant encaissé", remaining: "Reste à encaisser", priceOverride: "Tarif exceptionnel", rateSnapshot: "Tarif appliqué" }).flatMap(([key, label]) => {
    const field = snapshot[key];
    if (field === undefined || field === null || typeof field === "object") return [];
    let text = String(field);
    if (/^-?\d+\.\d{3}$/.test(text)) text = formatMoney(text);
    if (key === "valid" || key === "cancelled") text = field ? "Oui" : "Non";
    if (key === "paymentDate") text = formatDateOnly(text.slice(0, 10));
    return [{ key, label, children: text }];
  });
  return items.length ? <Descriptions size="small" column={1} items={items} /> : <span className="muted">Affectations recalculées ; consultez l’historique des affectations ci-dessus.</span>;
}
function AuditHistory({ history }: { history: FinancialAudit[] }) {
  const labels: Record<string, string> = { ENREGISTREMENT_PAIEMENT: "Paiement enregistré", CORRECTION_PAIEMENT: "Paiement corrigé", ANNULATION_PAIEMENT: "Paiement annulé", REALLOCATION_FIFO: "Répartition recalculée", PAYMENT_CREATED: "Paiement enregistré", PAYMENT_CORRECTED: "Paiement corrigé", PAYMENT_CANCELLED: "Paiement annulé", PAYMENT_CANCEL: "Paiement annulé", PAYMENT_CORRECTION: "Paiement corrigé", PRICE_CORRECTED: "Tarif corrigé", ALLOCATION_REBUILT: "Répartition recalculée" };
  return history.length ? <Collapse items={history.map(row => ({ key: row.id, label: `${tunisDate(row.createdAt).format("DD/MM/YYYY HH:mm")} · ${labels[row.action] ?? "Opération financière"}`, children: <><p><strong>Motif : </strong>{row.reason || "Enregistrement initial"}</p><div className="form-columns"><div><strong>Avant</strong><AuditSnapshot value={row.before} /></div><div><strong>Après</strong><AuditSnapshot value={row.after} /></div></div></> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune correction ni annulation" />;
}

function CancelPayment({ payment, onClose, onSaved }: { payment: FinancialPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ reason: string; preview: PaymentPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestKey = useRef<{ reason: string; id: string } | null>(null);
  const { message } = App.useApp();
  const router = useRouter();
  const cleanedReason = reason.trim();
  const preview = result?.reason === cleanedReason ? result.preview : null;
  useEffect(() => {
    if (cleanedReason.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const next = await apiRequest<PaymentPreview>(`/api/payments/${payment.id}/preview`, { method: "POST", signal: controller.signal, body: JSON.stringify({ kind: "CANCELLATION", reason: cleanedReason }) });
        if (!controller.signal.aborted) { setResult({ reason: cleanedReason, preview: next }); setError(null); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "L’aperçu n’a pas pu être calculé."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cleanedReason, payment.id]);
  async function cancel() {
    if (!preview || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    if (requestKey.current?.reason !== cleanedReason) requestKey.current = { reason: cleanedReason, id: crypto.randomUUID() };
    try {
      await apiRequest(`/api/payments/${payment.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: cleanedReason, previewToken: preview.token, idempotencyKey: requestKey.current.id, confirm: true }) });
      message.success("Le paiement a été annulé et les affectations ont été recalculées.");
      router.refresh(); onClose();
      try { await onSaved(); } catch { message.warning("L’annulation est enregistrée. Actualisez la page pour consulter les nouveaux soldes."); }
    } catch (cause) {
      const next = conflictPreview(cause);
      if (next) { setResult({ reason: cleanedReason, preview: next }); setError("La situation financière a changé. Vérifiez le nouvel aperçu puis confirmez de nouveau."); }
      else setError(cause instanceof Error ? cause.message : "L’annulation a échoué.");
    } finally { savingRef.current = false; setSaving(false); }
  }
  return <Modal open width={940} title="Annuler ce paiement" okText="Confirmer l’annulation du paiement" cancelText="Conserver le paiement" okButtonProps={{ danger: true, disabled: !preview || loading }} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }} onCancel={() => { if (!savingRef.current) onClose(); }} onOk={() => void cancel()}>
    <Alert type="warning" showIcon className="form-alert" title={`${formatMoney(payment.amount)} · ${payment.teacherName} · ${formatDateOnly(payment.paymentDate)}`} description="Cette annulation corrige un encaissement invalide. Le paiement et ses anciennes affectations restent dans l’historique. Les autres paiements valides seront répartis à nouveau sur les séances les plus anciennes." />
    {error && <Alert type="error" showIcon className="form-alert" title={error} />}
    <Form layout="vertical"><Form.Item label="Motif de l’annulation" required><Input.TextArea value={reason} disabled={saving} onChange={event => { setReason(event.target.value); setError(null); setLoading(false); }} maxLength={2000} rows={3} /></Form.Item></Form>
    {loading && <Spin tip="Calcul des nouveaux soldes…"><div style={{ height: 70 }} /></Spin>}
    {preview && <AllocationPreview preview={preview} />}
  </Modal>;
}

export function PaymentDetail({ id, professors, onClose, onChanged }: { id: string; professors: ProfessorRow[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(id);
  const [result, setResult] = useState<FinancialPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"correct" | "cancel" | null>(null);
  const payment = result?.id === selectedId ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<FinancialPayment>(`/api/payments/${selectedId}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setResult(value); setError(null); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Le paiement ne peut pas être chargé."); });
    return () => controller.abort();
  }, [selectedId]);
  function selectPayment(nextId: string) { setSelectedId(nextId); setError(null); setAction(null); }
  async function changed() { setResult(await apiRequest<FinancialPayment>(`/api/payments/${selectedId}`)); await onChanged(); }
  return <>
    <Drawer open title="Détails du paiement" size={1080} onClose={onClose}>
      {error && <Alert type="error" showIcon title={error} />}
      {!payment && !error && <Spin tip="Chargement du paiement…"><div style={{ minHeight: 180 }} /></Spin>}
      {payment && <>
        <Space wrap style={{ marginBottom: 20 }}><Tag color={payment.valid ? "green" : "default"}>{payment.valid ? "Valide" : payment.replacementId ? "Corrigé" : "Annulé"}</Tag>{payment.valid && <><Button onClick={() => setAction("correct")}>Corriger le paiement</Button><Button danger onClick={() => setAction("cancel")}>Annuler le paiement</Button></>}</Space>
        <Descriptions bordered column={{ xs: 1, sm: 2 }} items={[
          { key: "id", label: "Identifiant", children: payment.id, span: 2 },
          { key: "professor", label: "Professeur", children: <Link href={`/professeurs/${payment.teacherId}?tab=paiements`}>{payment.teacherName}</Link> },
          { key: "date", label: "Date du paiement", children: formatDateOnly(payment.paymentDate) },
          { key: "amount", label: "Montant reçu", children: formatMoney(payment.amount) },
          { key: "recorded", label: "Enregistré le", children: tunisDate(payment.createdAt).format("DD/MM/YYYY HH:mm") },
          { key: "recordedBy", label: "Enregistré par", children: payment.recordedBy || "Administrateur" },
          { key: "allocated", label: "Total affecté valide", children: formatMoney(payment.allocated) },
          { key: "notes", label: "Notes", children: <span className="preserve-lines">{payment.notes || "—"}</span>, span: 2 },
          ...(!payment.valid ? [{ key: "void", label: "Motif de l’annulation / correction", children: payment.voidReason || "—", span: 2 }, { key: "voidDate", label: "Annulé le", children: payment.voidedAt ? tunisDate(payment.voidedAt).format("DD/MM/YYYY HH:mm") : "—" }] : []),
        ]} />
        {(payment.replacesId || payment.replacementId) && <Space wrap style={{ marginTop: 16 }}>{payment.replacesId && <Button onClick={() => selectPayment(payment.replacesId!)}>Consulter le paiement original</Button>}{payment.replacementId && <Button onClick={() => selectPayment(payment.replacementId!)}>Consulter le paiement corrigé</Button>}</Space>}
        <h3 className="subsection-title">Séances couvertes et historique des affectations</h3><p className="muted">Les affectations extournées sont conservées et ne participent plus aux montants réglés.</p>
        <AllocationsTable allocations={payment.allocations} />
        <h3 className="subsection-title">Historique des corrections et annulations</h3><AuditHistory history={payment.history} />
      </>}
    </Drawer>
    {payment && action === "correct" && <PaymentForm professors={professors} payment={payment} onClose={() => setAction(null)} onSaved={changed} />}
    {payment && action === "cancel" && <CancelPayment payment={payment} onClose={() => setAction(null)} onSaved={changed} />}
  </>;
}
