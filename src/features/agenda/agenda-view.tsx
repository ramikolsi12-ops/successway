"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Alert, App, Button, Checkbox, DatePicker, Descriptions, Drawer, Empty, Select, Space, Spin, Tag, Tooltip } from "antd";
import { CalendarOutlined, CheckOutlined, CloseOutlined, EditOutlined, LeftOutlined, PlusOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api-client";
import { tunisDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { agendaMinuteRange, isOpeningDay, openingSlotError } from "@/lib/opening-hours";
import { addDays, canTransition, timeOf, timelineGeometry, weekMonday } from "@/lib/scheduling";
import type { AgendaData, AgendaEvent } from "@/types/agenda";
import type { SessionStatus } from "@/types/management";
import { statusLabels, weekdays } from "./agenda-labels";
import { SessionForm, type SessionDraft } from "./session-form";
import { RecurrenceForm } from "./recurrence-form";
import { CompletionModal } from "./completion-modal";
import { CancellationModal } from "./cancellation-modal";
import { replacementDraft, type CancellationScope } from "./replacement-draft";
import { PriceCorrectionModal } from "./price-correction-modal";
import { FinancialStatusTag, financialStatusLabels } from "./financial-status";
import { ChargePriceHistory } from "@/features/payments/charge-price-history";
import "./agenda.css";

const ROOM_WIDTH = 180;
const HOUR_WIDTH = 112;
const LANE_HEIGHT = 92;
const subscribeClock = (onChange: () => void) => { const timer = setInterval(onChange, 30_000); return () => clearInterval(timer); };
const currentMinuteSnapshot = () => Math.floor(Date.now() / 60_000);
const serverClockSnapshot = () => null;
const actionLabels: Record<string, string> = {
  EN_COURS: "Marquer en cours", TERMINEE: "Marquer comme terminée", ABSENT: "Marquer absent", ANNULEE: "Annuler la séance",
};

function eventTime(event: AgendaEvent) {
  const start = tunisDate(event.startAt);
  const end = tunisDate(event.endAt);
  return `${start.format("HH:mm")}–${start.format("YYYY-MM-DD") === end.format("YYYY-MM-DD") ? end.format("HH:mm") : "24:00"}`;
}
function eventDuration(event: AgendaEvent) {
  const minutes = Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60000);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h` : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}`.trim();
}
function statusClass(event: AgendaEvent) { return event.status === "PLANIFIEE" ? event.type === "FIXE" ? "fixed" : "provisional" : event.status.toLowerCase(); }

function placeEvents(events: AgendaEvent[]) {
  const ends: number[] = [];
  const placed = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)).map(event => {
    const start = new Date(event.startAt).getTime();
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = new Date(event.endAt).getTime();
    return { event, lane };
  });
  return { placed, lanes: Math.max(1, ends.length) };
}

export function AgendaView({ initialData, initialEventId }: { initialData: AgendaData; initialEventId?: string }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullDay, setFullDay] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<AgendaEvent | null>(() => initialData.events.find(event => event.id === initialEventId || event.sessionId === initialEventId) ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaEvent | null>(null);
  const [draft, setDraft] = useState<SessionDraft>({ date: data.date, startMinute: 480 });
  const [recurrenceMode, setRecurrenceMode] = useState<"edit" | "end" | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [completionEvent, setCompletionEvent] = useState<AgendaEvent | null>(null);
  const [cancellationEvent, setCancellationEvent] = useState<AgendaEvent | null>(null);
  const [replacement, setReplacement] = useState<{ event: AgendaEvent; scope: CancellationScope } | null>(null);
  const [correctionEvent, setCorrectionEvent] = useState<AgendaEvent | null>(null);
  const submissionRef = useRef(false);
  const loadSequence = useRef(0);
  const { message, modal } = App.useApp();
  const clockMinute = useSyncExternalStore<number | null>(subscribeClock, currentMinuteSnapshot, serverClockSnapshot);
  const now = clockMinute === null ? null : tunisDate(new Date(clockMinute * 60_000));
  const dayOpen = isOpeningDay(data.openingHours, data.date);
  const monday = weekMonday(data.date);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const selectedDay = tunisDate(`${data.date}T12:00:00+01:00`);
  const weekStart = tunisDate(`${monday}T12:00:00+01:00`);
  const weekEnd = tunisDate(`${addDays(monday, 6)}T12:00:00+01:00`);
  const weekLabel = `Semaine du ${weekStart.format("D")} ${weekStart.month() !== weekEnd.month() ? weekStart.format("MMMM") + " " : ""}${weekStart.year() !== weekEnd.year() ? weekStart.format("YYYY") + " " : ""}au ${weekEnd.format("D MMMM YYYY")}`;
  const activeEvents = useMemo(() => data.events.filter(event => event.status !== "ANNULEE"), [data.events]);
  const cancelledEvents = useMemo(() => data.events.filter(event => event.status === "ANNULEE").sort((a, b) => a.startAt.localeCompare(b.startAt)), [data.events]);
  const { startMinute, endMinute } = useMemo(() => agendaMinuteRange(data.openingHours, data.date, activeEvents, fullDay), [data.openingHours, data.date, activeEvents, fullDay]);
  const hours = [startMinute, ...Array.from({ length: Math.ceil(endMinute / 60) - Math.floor(startMinute / 60) - 1 }, (_, index) => (Math.floor(startMinute / 60) + index + 1) * 60)];
  const width = (endMinute - startMinute) / 60 * HOUR_WIDTH;
  const nowMinute = now && now.format("YYYY-MM-DD") === data.date ? now.hour() * 60 + now.minute() : null;
  const nowPosition = nowMinute !== null && nowMinute >= startMinute && nowMinute <= endMinute ? (nowMinute - startMinute) / 60 * HOUR_WIDTH : null;
  const rows = useMemo(() => data.classrooms.map(room => ({ room, ...placeEvents(activeEvents.filter(event => event.classroomId === room.id)) })), [data.classrooms, activeEvents]);

  async function load(date = data.date) {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try {
      const next = await apiRequest<AgendaData>(`/api/agenda?${new URLSearchParams({ date })}`);
      if (sequence === loadSequence.current) setData(next);
    } catch (cause) {
      if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "L’emploi du temps n’a pas pu être chargé.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  function create(classroomId?: string, minute = Math.max(data.openingHours.openingMinute, Math.min(480, data.openingHours.closingMinute - 30))) {
    setEditing(null); setDraft({ date: data.date, classroomId, startMinute: minute, endMinute: Math.min(data.openingHours.closingMinute, minute + 120) }); setFormOpen(true);
  }
  function edit() {
    if (!selected) return;
    setEditing(selected); setDraft({ date: data.date, classroomId: selected.classroomId, startMinute: 480 }); setFormOpen(true);
  }
  function createReplacement() {
    if (!replacement) return;
    setSelected(null); setEditing(null);
    setDraft(replacementDraft(replacement.event, replacement.scope));
    setFormOpen(true);
  }
  function confirmStatus(status: SessionStatus) {
    const event = selected;
    if (!event || submissionRef.current) return;
    if (status === "TERMINEE") { setCompletionEvent(event); return; }
    if (status === "ANNULEE") { setCancellationEvent(event); return; }
    modal.confirm({
      title: `${actionLabels[status]} ?`, okText: "Confirmer", cancelText: "Retour", okButtonProps: { danger: status === "ABSENT" },
      content: <>
        <p><strong>{event.teacherName}</strong> · {event.classroomName}<br />{tunisDate(event.startAt).format("dddd D MMMM YYYY")} · {eventTime(event)}</p>
        <p>{status === "EN_COURS" ? "Vous confirmez que le professeur utilise la salle. L’heure de confirmation sera conservée." : "L’absence sera conservée et le créneau libéré. Aucun montant ne sera facturé."}</p>
        {event.type === "FIXE" && <p>Cette action concerne uniquement cette semaine. Les autres semaines restent inchangées.</p>}
      </>,
      async onOk() {
        if (submissionRef.current) return;
        submissionRef.current = true; setStatusSaving(true);
        try {
          await apiRequest(`/api/agenda/events/${encodeURIComponent(event.id)}/status`, { method: "PATCH", body: JSON.stringify({ status, confirm: true }) });
          setSelected(null);
          message.success(status === "ABSENT" ? "La séance a été marquée comme absente." : "La séance est en cours.");
          await load();
        } catch (cause) { message.error(cause instanceof Error ? cause.message : "Le statut n’a pas pu être modifié."); }
        finally { submissionRef.current = false; setStatusSaving(false); }
      },
    });
  }

  return <div className="agenda-page">
    <div className="page-heading"><div><span className="eyebrow">ORGANISATION DU CENTRE</span><h1>Emploi du temps</h1><p>Réservez les salles et gérez chaque séance directement dans l’agenda.</p></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => create()} disabled={loading || !dayOpen}>Ajouter une séance</Button>
    </div>
    {replacement && <Alert className="agenda-replacement" type="success" showIcon closable onClose={() => setReplacement(null)}
      title="Le créneau a été libéré"
      description={`${replacement.event.classroomName} · ${tunisDate(replacement.event.startAt).format("dddd D MMMM YYYY")} · ${eventTime(replacement.event)}`}
      action={<Button onClick={createReplacement} disabled={loading}>Ajouter une séance à ce créneau</Button>} />}
    <section className="agenda-panel" aria-label="Agenda des salles">
      <div className="agenda-toolbar">
        <div className="agenda-week-navigation"><Button aria-label="Semaine précédente" title="Semaine précédente" icon={<LeftOutlined />} onClick={() => void load(addDays(data.date, -7))} disabled={loading} />
          <Button onClick={() => void load(tunisDate().format("YYYY-MM-DD"))} disabled={loading}>Aujourd’hui</Button>
          <Button aria-label="Semaine suivante" title="Semaine suivante" icon={<RightOutlined />} onClick={() => void load(addDays(data.date, 7))} disabled={loading} />
        </div>
        <h2>{weekLabel}</h2>
        <div className="agenda-toolbar-tools"><DatePicker aria-label="Choisir une date" allowClear={false} format="DD/MM/YYYY" value={selectedDay} onChange={value => { if (value) void load(value.format("YYYY-MM-DD")); }} disabled={loading} />
          <Button icon={<ReloadOutlined />} aria-label="Actualiser l’agenda" title="Actualiser l’agenda" loading={loading} onClick={() => void load()} />
        </div>
      </div>
      <div className="agenda-days" role="group" aria-label="Jour de la semaine">
        {days.map((date, index) => <button key={date} type="button" className={`agenda-day${date === data.date ? " selected" : ""}${date === tunisDate().format("YYYY-MM-DD") ? " today" : ""}`}
          aria-pressed={date === data.date} disabled={loading} onClick={() => void load(date)}><span>{weekdays[index]}</span><strong>{tunisDate(`${date}T12:00:00+01:00`).format("D MMM")}</strong></button>)}
      </div>
      <div className="agenda-context"><div><CalendarOutlined /><strong>{selectedDay.format("dddd D MMMM YYYY")}</strong><span className="agenda-zone">Heure de Tunis</span></div>
        <Space wrap><Checkbox checked={showCancelled} onChange={change => setShowCancelled(change.target.checked)}>Afficher les séances annulées</Checkbox>
          <Select aria-label="Amplitude des horaires" size="small" value={fullDay ? "full" : "standard"} onChange={value => setFullDay(value === "full")} options={[{ value: "standard", label: "Horaires du centre" }, { value: "full", label: "Journée entière" }]} /></Space>
      </div>
      {!dayOpen && <Alert className="agenda-error" type="info" showIcon title="Le centre est fermé ce jour. Les séances historiques restent consultables." />}
      {error && <Alert className="agenda-error" type="error" showIcon title={error} action={<Button size="small" onClick={() => void load()}>Réessayer</Button>} />}
      <Spin spinning={loading}>
        {!data.classrooms.length ? <Empty className="agenda-empty" description="Aucune salle enregistrée. Ajoutez une salle depuis le panneau Salles." /> :
          <div className="agenda-scroll" tabIndex={0} aria-label="Grille horaire à défilement horizontal">
            <div className="agenda-canvas" style={{ width: width + ROOM_WIDTH, "--agenda-hour-width": `${HOUR_WIDTH}px`, "--agenda-half-width": `${HOUR_WIDTH / 2}px`, "--agenda-hour-offset": `${-(startMinute % 60) / 60 * HOUR_WIDTH}px` } as React.CSSProperties}>
              <div className="agenda-time-header"><div className="agenda-corner">Salle / Heure</div><div className="agenda-hour-track" style={{ width }}>
                {hours.map((minute, index) => <div key={minute} className="agenda-hour" style={{ left: (minute - startMinute) / 60 * HOUR_WIDTH, width: ((hours[index + 1] ?? endMinute) - minute) / 60 * HOUR_WIDTH }}>{timeOf(minute)}</div>)}
                <span className="agenda-final-hour">{timeOf(endMinute)}</span>
                {nowPosition !== null && <span className="agenda-current-time-label" style={{ left: nowPosition }} aria-label={`Heure actuelle à Tunis : ${now!.format("HH:mm")}`}>{now!.format("HH:mm")}</span>}
              </div></div>
              {rows.map(({ room, placed, lanes }) => <div className={`agenda-room-row${room.active ? "" : " inactive"}`} key={room.id} style={{ minHeight: lanes * LANE_HEIGHT + 20 }}>
                <div className="agenda-room-label"><strong>{room.name}</strong><span className={`agenda-room-status${room.active ? " active" : ""}`}>{room.active ? "Active" : "Inactive"}</span>{!room.active && <small>Réservation indisponible</small>}</div>
                <div className="agenda-event-track" style={{ width, height: lanes * LANE_HEIGHT + 20 }}>
                  <div className="agenda-slot-controls" aria-label={`Créneaux de ${room.name}`}>
                    {Array.from({ length: (endMinute - startMinute) / 30 }, (_, index) => {
                      const minute = startMinute + index * 30;
                      const slotError = openingSlotError(data.openingHours, { date: data.date, startMinute: minute, endMinute: minute + 30 });
                      return <button key={minute} type="button" className={`agenda-empty-slot${slotError ? " closed" : ""}`} style={{ width: HOUR_WIDTH / 2 }} disabled={!room.active || loading || Boolean(slotError)} tabIndex={minute === data.openingHours.openingMinute ? 0 : -1}
                        aria-label={`Ajouter une séance dans ${room.name}, le ${selectedDay.format("D MMMM")}, à ${timeOf(minute)}`} title={!room.active ? "Impossible de réserver une salle inactive." : slotError ?? `Ajouter à ${timeOf(minute)}`}
                        onClick={() => create(room.id, minute)} onKeyDown={event => {
                          const target = event.key === "ArrowRight" ? event.currentTarget.nextElementSibling : event.key === "ArrowLeft" ? event.currentTarget.previousElementSibling : null;
                          if (target instanceof HTMLButtonElement) { event.preventDefault(); target.focus(); }
                        }}><span><PlusOutlined />{timeOf(minute)}</span></button>;
                    })}
                  </div>
                  {nowPosition !== null && <div className="agenda-current-time-line" style={{ left: nowPosition }} aria-hidden="true" />}
                  {placed.map(({ event, lane }) => {
                    const geometry = timelineGeometry(event.startAt, event.endAt, data.date, startMinute, HOUR_WIDTH);
                    const label = `${event.teacherName} · ${event.type === "FIXE" ? "Fixe" : "Provisoire"} · ${statusLabels[event.status]} · ${eventTime(event)}`;
                    return <Tooltip key={event.id} title={<><strong>{event.teacherName}</strong><br />{event.classroomName} · {eventTime(event)} · {eventDuration(event)}<br />{event.type === "FIXE" ? "Fixe" : "Provisoire"} · {statusLabels[event.status]}{event.isException ? " · Modifiée cette semaine" : ""}</>}>
                      <button type="button" className={`agenda-event ${statusClass(event)}${geometry.width < 100 ? " compact" : ""}`} style={{ left: geometry.left + 2, width: Math.max(geometry.width - 4, 12), top: lane * LANE_HEIGHT + 10 }} aria-label={label} onClick={() => setSelected(event)}>
                        <strong>{event.teacherName}</strong><span className="agenda-event-meta">{event.type === "FIXE" ? "Fixe" : "Provisoire"} · {statusLabels[event.status]}</span><span className="agenda-event-time">{eventTime(event)}</span>
                        {event.isException && <span className="agenda-event-exception" title="Exception enregistrée pour cette semaine">*</span>}
                        {event.status === "TERMINEE" && event.financial && <span className={`agenda-financial-indicator ${event.financial.status.toLowerCase()}`} title={`Statut financier : ${financialStatusLabels[event.financial.status]}`} aria-label={`Statut financier : ${financialStatusLabels[event.financial.status]}`} />}
                      </button>
                    </Tooltip>;
                  })}
                </div>
              </div>)}
            </div>
          </div>}
      </Spin>
      {showCancelled && <section className="agenda-cancelled-history" aria-label="Historique des séances annulées">
        <h3>Séances annulées · historique</h3>
        {cancelledEvents.length ? <ul>{cancelledEvents.map(event => <li key={event.id}>
          <button type="button" className="agenda-cancelled-event" onClick={() => setSelected(event)}>
            <strong>{event.teacherName}</strong><span>{event.classroomName} · {eventTime(event)}</span>
            <span>{event.type === "FIXE" ? "Fixe" : "Provisoire"} · Annulée</span><span className="agenda-cancelled-details">Voir les détails</span>
          </button>
        </li>)}</ul> : <p>Aucune séance annulée pour cette journée.</p>}
      </section>}
      <div className="agenda-legend" aria-label="Légende des séances">
        {[{ kind: "fixed", text: "Fixe · Prévue" }, { kind: "provisional", text: "Provisoire · Prévue" }, { kind: "en_cours", text: "En cours" }, { kind: "terminee", text: "Terminée" }, { kind: "absent", text: "Absent" }, { kind: "annulee", text: "Annulée" }].map(item => <span key={item.kind}><i className={item.kind} aria-hidden="true" />{item.text}</span>)}
      </div>
      {activeEvents.some(event => event.financial) && <div className="agenda-legend agenda-financial-legend" aria-label="Légende des statuts financiers">
        <span><i className="financial-paid" />Payée</span><span><i className="financial-partial" />Partiellement payée</span><span><i className="financial-unpaid" />Non payée</span>
      </div>}
      <p className="agenda-help">Cliquez sur un créneau libre pour réserver, ou sur une séance pour afficher ses détails et ses actions. Les séances annulées libèrent leur créneau et restent consultables avec « Afficher les séances annulées ».</p>
    </section>
    <SessionForm key={formOpen ? `${editing?.id ?? "new"}:${draft.date}:${draft.classroomId}:${draft.startMinute}:${draft.endMinute}:${draft.type}` : "closed"} open={formOpen} event={editing} draft={draft} data={data}
      onClose={() => setFormOpen(false)} onSaved={async date => { setSelected(null); setReplacement(null); await load(date); }} />
    <RecurrenceForm key={`${selected?.recurrenceId}:${recurrenceMode}`} event={selected} mode={recurrenceMode} data={data} onClose={() => setRecurrenceMode(null)} onSaved={async () => { setSelected(null); await load(); }} />
    {completionEvent && <CompletionModal key={completionEvent.id} event={completionEvent} onClose={() => setCompletionEvent(null)} onCompleted={async () => { setSelected(null); await load(); }} />}
    {cancellationEvent && <CancellationModal key={cancellationEvent.id} event={cancellationEvent} onClose={() => setCancellationEvent(null)} onCancelled={async (cancelled, scope) => {
      setSelected(null);
      setData(current => ({ ...current, events: current.events.map(event => event.id === cancellationEvent.id ? cancelled : event) }));
      setReplacement({ event: cancelled, scope });
      await load();
    }} />}
    {correctionEvent && <PriceCorrectionModal key={correctionEvent.id} event={correctionEvent} onClose={() => setCorrectionEvent(null)} onCorrected={async () => { setSelected(null); await load(); }} />}
    <Drawer title="Détails de la séance" open={Boolean(selected)} onClose={() => { if (!statusSaving) setSelected(null); }} size={560}>
      {selected && <>
        <div className="agenda-detail-heading"><span className={`agenda-detail-type ${statusClass(selected)}`}>{selected.type === "FIXE" ? "Fixe" : "Provisoire"} · {statusLabels[selected.status]}</span><h2>{selected.teacherName}</h2><p>{selected.classroomName} · {tunisDate(selected.startAt).format("dddd D MMMM YYYY")}</p></div>
        {selected.isException && <Alert className="form-alert" type="info" showIcon title="Exception conservée pour cette semaine uniquement" />}
        <Descriptions bordered column={1} size="small" items={[
          { key: "time", label: "Horaire · Tunis", children: eventTime(selected) },
          { key: "duration", label: "Durée", children: eventDuration(selected) },
          { key: "status", label: "Statut", children: <Tag>{statusLabels[selected.status]}</Tag> },
          ...(selected.status === "TERMINEE" ? [
            { key: "rate", label: "Tarif historique appliqué", children: selected.financial?.amount !== undefined ? formatMoney(selected.financial.amount) : selected.rateSnapshot !== null ? formatMoney(selected.rateSnapshot) : "Aucun tarif historique" },
            { key: "source", label: "Origine du tarif historique", children: (selected.financial?.pricingSource ?? selected.pricingSource) === "EXCEPTIONNEL" ? "Tarif exceptionnel" : "Tarif habituel" },
            { key: "due", label: "Montant dû au centre", children: selected.financial ? formatMoney(selected.financial.amount) : "Aucune charge valide" },
            { key: "paid", label: "Montant payé", children: selected.financial ? formatMoney(selected.financial.paid) : "—" },
            { key: "remaining", label: "Reste à payer", children: selected.financial ? formatMoney(selected.financial.remaining) : "—" },
            { key: "financial", label: "Statut financier", children: selected.financial ? <FinancialStatusTag status={selected.financial.status} /> : "Non applicable" },
            { key: "allocations", label: "Paiements affectés", children: selected.financial?.allocations.some(allocation => allocation.valid) ? <ul className="agenda-allocation-dates">{selected.financial.allocations.filter(allocation => allocation.valid).map(allocation => <li key={allocation.id}>{tunisDate(`${allocation.paymentDate.slice(0, 10)}T12:00:00+01:00`).format("DD/MM/YYYY")} : {formatMoney(allocation.amount)}</li>)}</ul> : "Aucun paiement affecté" },
          ] : [
            { key: "default-rate", label: "Tarif habituel du professeur", children: selected.defaultRate !== null ? formatMoney(selected.defaultRate) : "Aucun tarif pour cette date" },
            { key: "exceptional-rate", label: "Tarif exceptionnel", children: selected.priceOverride !== null ? formatMoney(selected.priceOverride) : "Aucun" },
            { key: "rate", label: "Tarif prévu", children: selected.expectedPrice !== null ? formatMoney(selected.expectedPrice) : "Aucun tarif pour cette date" },
            { key: "source", label: "Origine du tarif", children: selected.pricingSource === "EXCEPTIONNEL" ? "Tarif exceptionnel pour cette séance uniquement" : "Tarif habituel du professeur" },
          ]),
          { key: "notes", label: "Notes", children: selected.notes || "Aucune note" },
          ...[{ key: "started", label: "Début confirmé le", value: selected.startedAt }, { key: "completed", label: "Fin confirmée le", value: selected.completedAt }, { key: "absent", label: "Absence confirmée le", value: selected.absentAt }, { key: "cancelled", label: "Annulation confirmée le", value: selected.cancelledAt }].filter(item => item.value).map(item => ({ key: item.key, label: item.label, children: tunisDate(item.value!).format("DD/MM/YYYY HH:mm") })),
        ]} />
        {selected.status === "TERMINEE" && selected.financial && <ChargePriceHistory history={selected.financial.history} />}
        <div className="agenda-detail-actions">
          {(selected.status === "PLANIFIEE" || selected.status === "EN_COURS") && <>
            <Button block icon={<EditOutlined />} onClick={edit} disabled={statusSaving}>Modifier cette séance uniquement</Button>
            <Space wrap>{(["EN_COURS", "TERMINEE", "ABSENT", "ANNULEE"] as SessionStatus[]).filter(status => status !== selected.status && canTransition(selected.status, status)).map(status => <Button key={status} type={status === "EN_COURS" || status === "TERMINEE" ? "primary" : "default"} danger={status === "ABSENT" || status === "ANNULEE"} icon={status === "TERMINEE" ? <CheckOutlined /> : status === "ANNULEE" ? <CloseOutlined /> : undefined} loading={statusSaving} onClick={() => confirmStatus(status)}>{actionLabels[status]}</Button>)}</Space>
          </>}
          {selected.type === "FIXE" && selected.recurrence && <div className="agenda-recurrence-actions"><h3>Programmation hebdomadaire</h3><p>Les modifications conservent les exceptions. L’arrêt annule les réservations futures de cette programmation et conserve leur historique.</p>
            <Button block icon={<EditOutlined />} onClick={() => setRecurrenceMode("edit")} disabled={statusSaving}>Modifier la programmation fixe</Button>
            <Button block onClick={() => setRecurrenceMode("end")} disabled={statusSaving}>Arrêter la programmation fixe</Button>
          </div>}
          {selected.status === "TERMINEE" && <>
            <Alert type="success" showIcon title="Séance terminée" description="Le tarif historique est conservé. Le statut financier dépend des paiements réellement affectés à cette séance." />
            {selected.financial && <Button block icon={<EditOutlined />} onClick={() => setCorrectionEvent(selected)}>Corriger le tarif de cette séance terminée</Button>}
          </>}
          <Link href={`/professeurs/${encodeURIComponent(selected.teacherId)}?tab=paiements`}>Consulter les détails financiers du professeur</Link>
        </div>
      </>}
    </Drawer>
  </div>;
}
