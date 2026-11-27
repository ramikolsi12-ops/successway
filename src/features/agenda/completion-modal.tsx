"use client";

import { useRef, useState } from "react";
import { Alert, App, Descriptions, Form, Modal } from "antd";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { AgendaEvent } from "@/types/agenda";
import { normalizeSessionPrice, SessionPricingFields } from "./session-pricing-fields";

export function CompletionModal({ event, onClose, onCompleted }: {
  event: AgendaEvent; onClose: () => void; onCompleted: () => Promise<void>;
}) {
  const [form] = Form.useForm<{ exceptional: boolean; priceOverride?: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const commandPrice = useRef<string | null>(null);
  const { message } = App.useApp();
  const exceptional = Form.useWatch("exceptional", form) ?? event.priceOverride !== null;
  const overrideAmount = Form.useWatch("priceOverride", form) ?? event.priceOverride;
  const finalAmount = exceptional ? normalizeSessionPrice(overrideAmount) : event.defaultRate;
  const start = tunisDate(event.startAt);
  const end = tunisDate(event.endAt);
  const minutes = Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60000);
  const duration = `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  async function complete() {
    if (submitting.current) return;
    submitting.current = true;
    const values = await form.validateFields().catch(() => null);
    if (!values) { submitting.current = false; return; }
    if (!values.exceptional && event.defaultRate === null) {
      setError("Définissez un tarif habituel ou saisissez un tarif exceptionnel avant de confirmer.");
      submitting.current = false; return;
    }
    const priceOverride = values.exceptional ? normalizeSessionPrice(values.priceOverride) : null;
    const signature = JSON.stringify({ priceOverride });
    if (commandPrice.current !== signature) { commandPrice.current = signature; idempotencyKey.current = null; }
    idempotencyKey.current ??= crypto.randomUUID();
    setSaving(true); setError(null);
    try {
      await apiRequest(`/api/agenda/events/${encodeURIComponent(event.id)}/status`, {
        method: "PATCH", body: JSON.stringify({ status: "TERMINEE", confirm: true,
          priceOverride, expectedPrice: finalAmount, idempotencyKey: idempotencyKey.current }),
      });
      message.success("La séance a été terminée et son tarif historique a été enregistré.");
      onClose(); await onCompleted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La séance n’a pas pu être terminée."); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal open title="Confirmer la fin de séance et son tarif" onCancel={() => { if (!saving) onClose(); }} onOk={() => void complete()}
    okText="Confirmer la fin de séance" cancelText="Retour" confirmLoading={saving} okButtonProps={{ disabled: !exceptional && event.defaultRate === null }}
    closable={!saving} mask={{ closable: !saving }} keyboard={!saving} width={680} destroyOnHidden>
    {error && <Alert className="form-alert" showIcon type="error" title={error} />}
    <Descriptions size="small" bordered column={1} items={[
      { key: "professor", label: "Professeur", children: event.teacherName },
      { key: "classroom", label: "Salle", children: event.classroomName },
      { key: "date", label: "Date de la séance", children: start.format("dddd D MMMM YYYY") },
      { key: "start", label: "Heure de début · Tunis", children: start.format("HH:mm") },
      { key: "end", label: "Heure de fin · Tunis", children: start.format("YYYY-MM-DD") === end.format("YYYY-MM-DD") ? end.format("HH:mm") : "24:00" },
      { key: "duration", label: "Durée", children: duration },
    ]} />
    <Form form={form} layout="vertical" requiredMark={false} onValuesChange={() => { idempotencyKey.current = null; }} initialValues={{ exceptional: event.priceOverride !== null, priceOverride: event.priceOverride ?? undefined }}>
      <SessionPricingFields defaultRate={event.defaultRate} fixed={event.type === "FIXE"} disabled={saving} />
      <p className="agenda-applied-price">Montant final dû au centre : <strong>{finalAmount !== null ? formatMoney(finalAmount) : "Saisissez un tarif valide"}</strong></p>
    </Form>
    <Alert type="info" showIcon title="Le tarif appliqué sera le montant dû au centre" description="Une charge unique sera créée pour cette séance. Aucun paiement reçu ne sera enregistré par cette confirmation." />
  </Modal>;
}
