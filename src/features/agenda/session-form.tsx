"use client";

import { useRef, useState } from "react";
import { Alert, App, Col, DatePicker, Form, Input, Modal, Radio, Row, Select } from "antd";
import type { Dayjs } from "dayjs";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { isOpeningDay, openingSlotError } from "@/lib/opening-hours";
import { findApplicableAgreement } from "@/lib/management-rules";
import { addDays, minutesOf, occurrenceDate, timeOf, weekMonday } from "@/lib/scheduling";
import type { AgendaData, AgendaEvent, SessionInput, SessionType } from "@/types/agenda";
import { endTimeOptions, timeOptions, weekdayOptions } from "./agenda-labels";
import { normalizeSessionPrice, SessionPricingFields } from "./session-pricing-fields";

export interface SessionDraft { date: string; classroomId?: string; startMinute: number; endMinute?: number; type?: SessionType }
type Values = {
  teacherId: string; classroomId: string; date: Dayjs; startTime: string; endTime: string; type: SessionType;
  notes: string; weekday: number; recurrenceStartDate: Dayjs; recurrenceEndDate?: Dayjs;
  exceptional: boolean; priceOverride?: string; overrideDecision?: "KEEP" | "RESTORE";
};

export function SessionForm({ open, event, draft, data, onClose, onSaved }: {
  open: boolean; event: AgendaEvent | null; draft: SessionDraft; data: AgendaData;
  onClose: () => void; onSaved: (date: string) => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  const type = Form.useWatch("type", form) ?? event?.type ?? draft.type ?? "PROVISOIRE";
  const teacherId = Form.useWatch("teacherId", form) ?? event?.teacherId;
  const watchedDate = Form.useWatch("date", form) as Dayjs | undefined;
  const recurrenceStart = Form.useWatch("recurrenceStartDate", form) as Dayjs | undefined;
  const weekday = Form.useWatch("weekday", form) as number | undefined;
  const overrideDecision = Form.useWatch("overrideDecision", form);
  const eventDate = event ? tunisDate(event.startAt).format("YYYY-MM-DD") : draft.date;
  const startTime = event ? tunisDate(event.startAt).format("HH:mm") : timeOf(draft.startMinute);
  const endTime = event ? (tunisDate(event.endAt).format("YYYY-MM-DD") !== eventDate ? "24:00" : tunisDate(event.endAt).format("HH:mm")) : timeOf(draft.endMinute ?? Math.min(1440, draft.startMinute + 120));
  const watchedStartTime = Form.useWatch("startTime", form) ?? startTime;
  const startOptions = timeOptions.map(option => ({ ...option, disabled: minutesOf(option.value) < data.openingHours.openingMinute || minutesOf(option.value) >= data.openingHours.closingMinute }));
  const endOptions = endTimeOptions.map(option => ({ ...option, disabled: minutesOf(option.value) <= Math.max(minutesOf(watchedStartTime), data.openingHours.openingMinute) || minutesOf(option.value) > data.openingHours.closingMinute }));
  const editWeek = event?.occurrenceWeek ?? weekMonday(eventDate);
  let pricingDate = watchedDate?.format("YYYY-MM-DD") ?? eventDate;
  if (!event && type === "FIXE") {
    const boundary = recurrenceStart?.format("YYYY-MM-DD") ?? eventDate;
    pricingDate = occurrenceDate(weekMonday(boundary), weekday ?? Number(tunisDate(`${eventDate}T12:00:00+01:00`).day() || 7));
    if (pricingDate < boundary) pricingDate = addDays(pricingDate, 7);
  }
  let defaultRate: string | null = null;
  let rateError: string | null = null;
  try { defaultRate = findApplicableAgreement(data.professors.find(professor => professor.id === teacherId)?.agreements ?? [], pricingDate)?.pricePerSession ?? null; }
  catch (cause) { rateError = cause instanceof Error ? cause.message : "Le tarif habituel ne peut pas être déterminé."; }
  const professorChangedWithOverride = Boolean(event?.priceOverride !== null && event?.priceOverride !== undefined && teacherId !== event.teacherId);

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    const values = await form.validateFields().catch(() => null);
    if (!values) { savingRef.current = false; return; }
    if (minutesOf(values.endTime) <= minutesOf(values.startTime)) {
      setError("L’heure de fin doit être après l’heure de début."); savingRef.current = false; return;
    }
    let date = values.date?.format("YYYY-MM-DD") ?? draft.date;
    if (!event && values.type === "FIXE") {
      const boundary = values.recurrenceStartDate.format("YYYY-MM-DD");
      date = occurrenceDate(weekMonday(boundary), values.weekday);
      if (date < boundary) date = addDays(date, 7);
      if (values.recurrenceEndDate && date > values.recurrenceEndDate.format("YYYY-MM-DD")) {
        setError("La période doit contenir au moins une séance au jour choisi."); savingRef.current = false; return;
      }
    }
    const rescheduled = !event || values.teacherId !== event.teacherId || values.classroomId !== event.classroomId || date !== eventDate || values.startTime !== startTime || values.endTime !== endTime;
    const hoursError = rescheduled ? openingSlotError(data.openingHours, { date, startMinute: minutesOf(values.startTime), endMinute: minutesOf(values.endTime) }) : null;
    if (hoursError) { setError(hoursError); savingRef.current = false; return; }
    const input: SessionInput = {
      teacherId: values.teacherId, classroomId: values.classroomId, date,
      startTime: values.startTime, endTime: values.endTime, type: event?.type ?? values.type,
      notes: values.notes?.trim() || null,
      priceOverride: values.exceptional ? normalizeSessionPrice(values.priceOverride) : null,
      ...(professorChangedWithOverride ? { overrideDecision: values.overrideDecision } : {}),
      ...(!event && values.type === "FIXE" ? {
        weekday: values.weekday, recurrenceStartDate: values.recurrenceStartDate.format("YYYY-MM-DD"),
        recurrenceEndDate: values.recurrenceEndDate?.format("YYYY-MM-DD") ?? null,
      } : {}),
    };
    setSaving(true); setError(null);
    try {
      await apiRequest(event ? `/api/agenda/events/${encodeURIComponent(event.id)}` : "/api/agenda", {
        method: event ? "PATCH" : "POST", body: JSON.stringify(input),
      });
      message.success(event ? "La séance sélectionnée a été modifiée." : type === "FIXE" ? "La programmation fixe a été créée." : "La séance provisoire a été ajoutée.");
      onClose();
      await onSaved(date);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La séance n’a pas pu être enregistrée."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <Modal title={event ? "Modifier cette séance uniquement" : "Ajouter une séance"} open={open}
    onCancel={() => { if (!saving) onClose(); }} onOk={() => void save()} confirmLoading={saving}
    okText={event ? "Enregistrer la séance" : "Ajouter"} cancelText="Annuler" width={720} destroyOnHidden
    afterClose={() => setError(null)} mask={{ closable: !saving }} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }}>
    {error && <Alert className="form-alert" type="error" showIcon title={error} />}
    {event?.type === "FIXE" && <Alert className="form-alert" type="info" showIcon title="Cette modification concerne uniquement la séance sélectionnée." description="Les autres semaines et la programmation fixe restent inchangées. Le déplacement est limité à la même semaine." />}
    {!data.professors.some(professor => professor.active) && <Alert className="form-alert" type="warning" showIcon title="Ajoutez ou réactivez un professeur dans le panneau Professeurs pour réserver." />}
    <p className="agenda-form-hint">Horaires du centre : {timeOf(data.openingHours.openingMinute)}–{timeOf(data.openingHours.closingMinute)}. Les nouvelles réservations sont limitées aux jours d’ouverture.</p>
    <Form form={form} layout="vertical" requiredMark={false} preserve={false} disabled={saving} initialValues={{
      teacherId: event?.teacherId, classroomId: event?.classroomId ?? draft.classroomId,
      date: tunisDate(`${eventDate}T12:00:00+01:00`), startTime, endTime, type: event?.type ?? draft.type ?? "PROVISOIRE", notes: event?.notes ?? "",
      weekday: Number(tunisDate(`${eventDate}T12:00:00+01:00`).day() || 7),
      recurrenceStartDate: tunisDate(`${eventDate}T12:00:00+01:00`),
      exceptional: event?.priceOverride !== null && event?.priceOverride !== undefined,
      priceOverride: event?.priceOverride ?? undefined,
    }}>
      {!event && <Form.Item name="type" label="Type de séance"><Radio.Group optionType="button" buttonStyle="solid" options={[{ value: "PROVISOIRE", label: "Provisoire · une seule date" }, { value: "FIXE", label: "Fixe · chaque semaine" }]} /></Form.Item>}
      <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="teacherId" label="Professeur" rules={[{ required: true, message: "Choisissez un professeur actif." }]}>
        <Select showSearch optionFilterProp="label" placeholder="Choisir un professeur" onChange={() => form.setFieldValue("overrideDecision", undefined)} options={data.professors.map(professor => ({ value: professor.id, label: `${professor.name}${professor.active ? "" : " · Inactif"}`, disabled: !professor.active && professor.id !== event?.teacherId }))} />
      </Form.Item></Col><Col xs={24} sm={12}><Form.Item name="classroomId" label="Salle" rules={[{ required: true, message: "Choisissez une salle active." }]}>
        <Select placeholder="Choisir une salle" options={data.classrooms.map(room => ({ value: room.id, label: `${room.name}${room.active ? "" : " · Inactive"}`, disabled: !room.active }))} />
      </Form.Item></Col></Row>
      {(event || type === "PROVISOIRE") && <Form.Item name="date" label="Date de la séance" rules={[{ required: true, message: "Choisissez une date." }]}>
        <DatePicker format="DD/MM/YYYY" allowClear={false} className="agenda-full-control" disabledDate={current => !isOpeningDay(data.openingHours, current.format("YYYY-MM-DD")) || Boolean(event?.type === "FIXE" && (current.format("YYYY-MM-DD") < editWeek || current.format("YYYY-MM-DD") > addDays(editWeek, 6)))} />
      </Form.Item>}
      {!event && type === "FIXE" && <>
        <Form.Item name="weekday" label="Jour de la semaine" rules={[{ required: true }]}><Select options={weekdayOptions.map(option => ({ ...option, disabled: !data.openingHours.openingDays.includes(option.value) }))} /></Form.Item>
        <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="recurrenceStartDate" label="Début de la programmation" rules={[{ required: true, message: "Choisissez une date de début." }]}><DatePicker format="DD/MM/YYYY" allowClear={false} className="agenda-full-control" /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="recurrenceEndDate" label="Fin de la programmation (facultatif)"><DatePicker format="DD/MM/YYYY" className="agenda-full-control" /></Form.Item></Col></Row>
        <p className="agenda-form-hint">Une séance sera prévue chaque semaine au jour choisi, dans cette période.</p>
      </>}
      <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="startTime" label="Heure de début · Tunis" rules={[{ required: true, message: "Choisissez une heure de début." }]}><Select options={startOptions} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="endTime" label="Heure de fin · Tunis" rules={[{ required: true, message: "Choisissez une heure de fin." }]}><Select options={endOptions} /></Form.Item></Col></Row>
      {professorChangedWithOverride && <>
        <Alert className="form-alert" type="warning" showIcon title="Le professeur a changé" description="Choisissez de conserver le tarif exceptionnel existant ou de rétablir le tarif habituel du nouveau professeur." />
        <Form.Item name="overrideDecision" label="Tarif de cette séance après le changement de professeur" rules={[{ required: true, message: "Choisissez le tarif à conserver après ce changement." }]}>
          <Radio.Group onChange={change => form.setFieldsValue(change.target.value === "KEEP" ? { exceptional: true, priceOverride: event!.priceOverride ?? undefined } : { exceptional: false, priceOverride: undefined })} options={[{ value: "KEEP", label: "Conserver le tarif exceptionnel" }, { value: "RESTORE", label: "Rétablir le tarif habituel du nouveau professeur" }]} />
        </Form.Item>
      </>}
      {rateError && <Alert className="form-alert" type="error" showIcon title={rateError} />}
      <SessionPricingFields defaultRate={defaultRate} fixed={(event?.type ?? type) === "FIXE"} initialOccurrence={!event && type === "FIXE"} disabled={saving || (professorChangedWithOverride && !overrideDecision)} />
      <Form.Item name="notes" label="Notes (facultatif)"><Input.TextArea maxLength={4000} rows={3} /></Form.Item>
    </Form>
  </Modal>;
}
