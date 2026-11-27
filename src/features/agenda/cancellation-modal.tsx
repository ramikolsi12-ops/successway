"use client";

import { useRef, useState } from "react";
import { Alert, App, Checkbox, Descriptions, Form, Input, Modal, Radio } from "antd";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import type { AgendaEvent } from "@/types/agenda";
import type { CancellationScope } from "./replacement-draft";

type Values = { scope: CancellationScope; reason?: string; confirmFollowing: boolean };

export function CancellationModal({ event, onClose, onCancelled }: {
  event: AgendaEvent;
  onClose: () => void;
  onCancelled: (event: AgendaEvent, scope: CancellationScope) => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const command = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const { message } = App.useApp();
  const scope = Form.useWatch("scope", form) ?? "OCCURRENCE";
  const following = event.type === "FIXE" && scope === "FOLLOWING";
  const start = tunisDate(event.startAt);
  const end = tunisDate(event.endAt);

  async function cancel() {
    if (submitting.current) return;
    submitting.current = true;
    const values = await form.validateFields().catch(() => null);
    if (!values) { submitting.current = false; return; }
    const input: { scope: CancellationScope; reason: string | null; confirm: true } = { scope: event.type === "FIXE" ? values.scope : "OCCURRENCE", reason: values.reason?.trim() || null, confirm: true };
    const signature = JSON.stringify(input);
    if (command.current?.signature !== signature) command.current = { signature, idempotencyKey: crypto.randomUUID() };
    setSaving(true); setError(null);
    try {
      const cancelled = await apiRequest<AgendaEvent>(`/api/agenda/events/${encodeURIComponent(event.id)}/cancel`, {
        method: "POST", body: JSON.stringify({ ...input, idempotencyKey: command.current.idempotencyKey }),
      });
      message.success(input.scope === "FOLLOWING" ? "La programmation fixe a été arrêtée à partir de cette séance." : "La séance a été annulée et son créneau libéré.");
      onClose();
      await onCancelled(cancelled, input.scope);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La séance n’a pas pu être annulée."); }
    finally { submitting.current = false; setSaving(false); }
  }

  return <Modal open title={event.type === "FIXE" ? "Annuler la séance fixe" : "Voulez-vous annuler cette séance provisoire ?"}
    onCancel={() => { if (!saving) onClose(); }} onOk={() => void cancel()} confirmLoading={saving}
    okText="Confirmer l'annulation" cancelText="Retour" okButtonProps={{ danger: true }} cancelButtonProps={{ disabled: saving }}
    closable={!saving} mask={{ closable: !saving }} keyboard={!saving} width={700} destroyOnHidden>
    {error && <Alert className="form-alert" type="error" showIcon title={error} />}
    <Descriptions bordered size="small" column={1} items={[
      { key: "teacher", label: "Professeur", children: event.teacherName },
      { key: "classroom", label: "Salle", children: event.classroomName },
      { key: "date", label: "Date de la séance", children: start.format("dddd D MMMM YYYY") },
      { key: "start", label: "Heure de début · Tunis", children: start.format("HH:mm") },
      { key: "end", label: "Heure de fin · Tunis", children: end.format("YYYY-MM-DD") === start.format("YYYY-MM-DD") ? end.format("HH:mm") : "24:00" },
      { key: "type", label: "Type de séance", children: event.type === "FIXE" ? "Fixe" : "Provisoire" },
    ]} />
    <Form form={form} layout="vertical" requiredMark={false} disabled={saving} initialValues={{ scope: "OCCURRENCE", reason: "", confirmFollowing: false }}>
      {event.type === "FIXE" && <>
        <Form.Item name="scope" label="Séances à annuler" className="agenda-cancellation-options">
          <Radio.Group onChange={() => form.setFieldValue("confirmFollowing", false)}>
            <Radio value="OCCURRENCE">Annuler uniquement cette séance</Radio>
            <Radio value="FOLLOWING">Annuler cette séance et toutes les suivantes</Radio>
          </Radio.Group>
        </Form.Item>
        <p>{following ? "Cette action arrêtera définitivement cette programmation fixe à partir de la séance sélectionnée. Les anciennes séances seront conservées." : "Cette annulation concerne uniquement la séance sélectionnée. Les séances des autres semaines restent inchangées."}</p>
      </>}
      <Form.Item name="reason" label="Motif de l’annulation (facultatif)" rules={[{ max: 2000, message: "Le motif ne doit pas dépasser 2 000 caractères." }]}><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
      <Alert className="form-alert" type={following ? "warning" : "info"} showIcon
        title={following ? "Le créneau sera libéré à partir de cette date pour toutes les prochaines occurrences de cette programmation." : "Le créneau sera libéré uniquement pour cette séance."}
        description="L’historique sera conservé. Cette annulation ne crée aucune charge financière." />
      {following && <Form.Item name="confirmFollowing" valuePropName="checked" rules={[{ validator: (_, checked) => checked ? Promise.resolve() : Promise.reject(new Error("Confirmez explicitement l’arrêt de cette programmation.")) }]}>
        <Checkbox>Je confirme l’arrêt définitif de cette programmation à partir de cette séance.</Checkbox>
      </Form.Item>}
    </Form>
  </Modal>;
}
