"use client";

import { useRef, useState } from "react";
import { Alert, App, Checkbox, Col, DatePicker, Form, Input, Modal, Row, Select } from "antd";
import type { Dayjs } from "dayjs";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { addDays, minutesOf, occurrenceDate, timeOf, weekMonday } from "@/lib/scheduling";
import { openingSlotError } from "@/lib/opening-hours";
import { formatDateOnly } from "@/lib/format";
import type { AgendaData, AgendaEvent, RecurrenceUpdateInput } from "@/types/agenda";
import { endTimeOptions, timeOptions, weekdayOptions } from "./agenda-labels";

type Values = {
  teacherId: string; classroomId: string; weekday: number; startTime: string; endTime: string;
  effectiveDate: Dayjs; endDate?: Dayjs; notes: string; confirm: boolean;
};

export function RecurrenceForm({ event, mode, data, onClose, onSaved }: {
  event: AgendaEvent | null; mode: "edit" | "end" | null; data: AgendaData; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();
  const recurrence = event?.recurrence;
  const currentWeek = weekMonday(tunisDate().format("YYYY-MM-DD"));
  const firstEditableWeek = currentWeek < tunisDate().format("YYYY-MM-DD") ? addDays(currentWeek, 7) : currentWeek;
  const selectedWeek = event?.occurrenceWeek ?? currentWeek;
  const firstFutureWeek = recurrence ? weekMonday(recurrence.startDate) : firstEditableWeek;
  const effectiveWeek = [firstEditableWeek, selectedWeek, firstFutureWeek].sort().at(-1)!;
  const watchedStartTime = Form.useWatch("startTime", form) ?? timeOf(recurrence?.startMinute ?? 480);

  async function save() {
    if (!recurrence || !event?.recurrenceId || savingRef.current) return;
    savingRef.current = true;
    const values = await form.validateFields().catch(() => null);
    if (!values) { savingRef.current = false; return; }
    const effectiveDate = weekMonday(values.effectiveDate.format("YYYY-MM-DD"));
    if (mode === "edit") {
      const hoursError = openingSlotError(data.openingHours, { date: occurrenceDate(effectiveDate, values.weekday), startMinute: minutesOf(values.startTime), endMinute: minutesOf(values.endTime) });
      if (hoursError) { setError(hoursError); savingRef.current = false; return; }
    }
    setSaving(true); setError(null);
    const input: RecurrenceUpdateInput = {
      teacherId: values.teacherId, classroomId: values.classroomId, weekday: values.weekday,
      startTime: values.startTime, endTime: values.endTime, effectiveDate,
      endDate: values.endDate?.format("YYYY-MM-DD") ?? null, notes: values.notes?.trim() || null, confirm: true,
    };
    try {
      await apiRequest(`/api/agenda/recurrences/${event.recurrenceId}${mode === "end" ? "/end" : ""}`, {
        method: "PATCH", body: JSON.stringify(mode === "end" ? { effectiveDate, confirm: true } : input),
      });
      message.success(mode === "end" ? "La programmation fixe a été arrêtée à la semaine choisie." : "La programmation fixe a été modifiée pour les semaines à venir.");
      onClose(); await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La programmation n’a pas pu être modifiée."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <Modal title={mode === "end" ? "Arrêter la programmation fixe" : "Modifier la programmation fixe"} open={Boolean(mode && recurrence)}
    onCancel={() => { if (!saving) onClose(); }} onOk={() => void save()} okText={mode === "end" ? "Confirmer l’arrêt" : "Confirmer la modification"}
    cancelText="Annuler" confirmLoading={saving} width={720} destroyOnHidden afterClose={() => setError(null)} mask={{ closable: !saving }} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }}>
    {error && <Alert className="form-alert" type="error" showIcon title={error} />}
    <Alert className="form-alert" type="info" showIcon title={mode === "end" ? "Arrêt des nouvelles occurrences à partir de la semaine choisie" : "Cette action modifie les semaines futures de la programmation fixe"}
      description={mode === "end" ? "Les occurrences prévues ou en cours seront annulées à partir du lundi choisi. Une séance déjà terminée sur cette période bloque l’arrêt. Les anciennes séances et leurs montants sont conservés." : "Les séances terminées et les exceptions déjà enregistrées conservent leurs informations. Les changements s’appliquent à partir d’un lundi."} />
    <Form form={form} layout="vertical" requiredMark={false} preserve={false} disabled={saving} initialValues={{
      teacherId: recurrence?.teacherId, classroomId: recurrence?.classroomId, weekday: recurrence?.weekday,
      startTime: timeOf(recurrence?.startMinute ?? 480), endTime: timeOf(recurrence?.endMinute ?? 600),
      effectiveDate: tunisDate(`${effectiveWeek}T12:00:00+01:00`), endDate: recurrence?.endDate ? tunisDate(`${recurrence.endDate}T12:00:00+01:00`) : undefined,
      notes: recurrence?.notes ?? "", confirm: false,
    }}>
      <Form.Item name="effectiveDate" label="À partir de la semaine du" rules={[{ required: true, message: "Choisissez une semaine d’application." }]} extra="La date est ramenée au lundi de la semaine choisie.">
        <DatePicker allowClear={false} format="DD/MM/YYYY" className="agenda-full-control" disabledDate={value => weekMonday(value.format("YYYY-MM-DD")) < firstEditableWeek}
          onChange={value => { if (value) form.setFieldValue("effectiveDate", tunisDate(`${weekMonday(value.format("YYYY-MM-DD"))}T12:00:00+01:00`)); }} />
      </Form.Item>
      {mode === "edit" && <>
        <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="teacherId" label="Professeur" rules={[{ required: true, message: "Choisissez un professeur actif." }]}><Select showSearch optionFilterProp="label" options={data.professors.map(item => ({ value: item.id, label: `${item.name}${item.active ? "" : " · Inactif"}`, disabled: !item.active }))} /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="classroomId" label="Salle" rules={[{ required: true, message: "Choisissez une salle active." }]}><Select options={data.classrooms.map(item => ({ value: item.id, label: `${item.name}${item.active ? "" : " · Inactive"}`, disabled: !item.active }))} /></Form.Item></Col></Row>
        <Form.Item name="weekday" label="Jour de la semaine" rules={[{ required: true }]}><Select options={weekdayOptions.map(option => ({ ...option, disabled: !data.openingHours.openingDays.includes(option.value) }))} /></Form.Item>
        <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="startTime" label="Heure de début · Tunis" rules={[{ required: true }]}><Select options={timeOptions.map(option => ({ ...option, disabled: minutesOf(option.value) < data.openingHours.openingMinute || minutesOf(option.value) >= data.openingHours.closingMinute }))} /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="endTime" label="Heure de fin · Tunis" rules={[{ required: true }]}><Select options={endTimeOptions.map(option => ({ ...option, disabled: minutesOf(option.value) <= Math.max(minutesOf(watchedStartTime), data.openingHours.openingMinute) || minutesOf(option.value) > data.openingHours.closingMinute }))} /></Form.Item></Col></Row>
        <Form.Item name="endDate" label="Fin de la programmation (facultatif)"><DatePicker format="DD/MM/YYYY" className="agenda-full-control" /></Form.Item>
        <Form.Item name="notes" label="Notes (facultatif)"><Input.TextArea rows={3} maxLength={4000} /></Form.Item>
      </>}
      {mode === "end" && <p>Cette programmation sera arrêtée définitivement. Les réservations futures, y compris les occurrences déplacées déjà enregistrées, seront annulées sans effacer leur historique.</p>}
      <Form.Item name="confirm" valuePropName="checked" rules={[{ validator: (_, checked) => checked ? Promise.resolve() : Promise.reject(new Error("Confirmez cette action pour continuer.")) }]}>
        <Checkbox>Je confirme {mode === "end" ? "l’arrêt" : "la modification"} de cette programmation pour les semaines à venir.</Checkbox>
      </Form.Item>
      {recurrence && <p className="agenda-form-hint">Version consultée : à partir du {formatDateOnly(recurrence.startDate)}{recurrence.endDate ? `, jusqu’au ${formatDateOnly(recurrence.endDate)}` : ", sans date de fin"}.</p>}
    </Form>
  </Modal>;
}
