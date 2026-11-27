import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { addDays, generateWeekly, weekMonday } from "@/lib/scheduling";
import { tunisDate } from "@/lib/dates";
import type { AgendaEvent, AgendaRecurrence } from "@/types/agenda";
import type { Transaction } from "@/services/management-shared";

export const agendaSessionRelations = {
  teacher: { include: { agreements: true } },
  classroom: true,
  charge: true,
  recurrence: { include: { schedules: { where: { supersededAt: null }, orderBy: { startDate: "desc" as const } } } },
} satisfies Prisma.TeachingSessionInclude;
export const agendaScheduleRelations = {
  teacher: { include: { agreements: true } }, classroom: true,
  recurrence: { include: { schedules: { where: { supersededAt: null }, orderBy: { startDate: "desc" as const } } } },
} satisfies Prisma.RecurrenceScheduleInclude;

export type ConcreteSession = Prisma.TeachingSessionGetPayload<{ include: typeof agendaSessionRelations }>;
export type ScheduleEntity = Prisma.RecurrenceScheduleGetPayload<{ include: typeof agendaScheduleRelations }>;
export type AgendaReader = Pick<Transaction, "teachingSession" | "recurrenceSchedule">;
export const dateString = (date: Date) => date.toISOString().slice(0, 10);
export const dateValue = (date: string) => new Date(`${date}T00:00:00Z`);
export const blocksTime = (status: string) => !["ANNULEE", "ABSENT"].includes(status);

export function recurrenceRow(value: ScheduleEntity | NonNullable<ConcreteSession["recurrence"]>["schedules"][number]): AgendaRecurrence {
  return { id: value.recurrenceId, teacherId: value.teacherId, classroomId: value.classroomId,
    weekday: value.weekday, startMinute: value.startMinute, endMinute: value.endMinute,
    startDate: dateString(value.startDate), endDate: value.endDate ? dateString(value.endDate) : null, notes: value.notes };
}

function applicablePrice(teacher: ConcreteSession["teacher"], date: string) {
  return teacher.agreements.find(rate => rate.active && dateString(rate.startDate) <= date
    && (!rate.endDate || dateString(rate.endDate) >= date))?.pricePerSession.toFixed(3) ?? null;
}

export function concreteEvent(session: ConcreteSession): AgendaEvent {
  const latest = session.recurrence?.schedules[0];
  return {
    id: session.recurrenceId && session.occurrenceWeek ? `${session.recurrenceId}@${dateString(session.occurrenceWeek)}` : session.id,
    sessionId: session.id, teacherId: session.teacherId, teacherName: `${session.teacher.firstName} ${session.teacher.lastName}`,
    classroomId: session.classroomId, classroomName: session.classroom.name,
    startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), status: session.status, notes: session.notes,
    rateSnapshot: session.rateSnapshot?.toFixed(3) ?? null, type: session.recurrenceId ? "FIXE" : "PROVISOIRE",
    recurrenceId: session.recurrenceId, occurrenceWeek: session.occurrenceWeek ? dateString(session.occurrenceWeek) : null,
    originalDate: session.originalDate ? dateString(session.originalDate) : null,
    isException: session.isException, startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null, absentAt: session.absentAt?.toISOString() ?? null,
    cancelledAt: session.cancelledAt?.toISOString() ?? null,
    applicableRate: session.rateSnapshot?.toFixed(3) ?? applicablePrice(session.teacher, tunisDate(session.startAt).format("YYYY-MM-DD")),
    defaultRate: applicablePrice(session.teacher, tunisDate(session.startAt).format("YYYY-MM-DD")),
    priceOverride: session.priceOverride?.toFixed(3) ?? null,
    pricingSource: session.charge?.pricingSource ?? (session.priceOverride !== null && session.priceOverride !== undefined ? "EXCEPTIONNEL" : "HABITUEL"),
    expectedPrice: session.rateSnapshot?.toFixed(3) ?? session.priceOverride?.toFixed(3) ?? applicablePrice(session.teacher, tunisDate(session.startAt).format("YYYY-MM-DD")),
    financial: null,
    chargeAmount: session.charge && !session.charge.voidedAt ? session.charge.amount.toFixed(3) : null,
    persisted: true, recurrence: latest ? recurrenceRow(latest) : null,
  };
}

export function virtualEvent(schedule: ScheduleEntity, occurrence: ReturnType<typeof generateWeekly>[number]): AgendaEvent {
  return {
    id: `${schedule.recurrenceId}@${occurrence.week}`, sessionId: null, teacherId: schedule.teacherId,
    teacherName: `${schedule.teacher.firstName} ${schedule.teacher.lastName}`, classroomId: schedule.classroomId,
    classroomName: schedule.classroom.name, startAt: occurrence.startAt.toISOString(), endAt: occurrence.endAt.toISOString(),
    status: "PLANIFIEE", notes: schedule.notes, rateSnapshot: null, type: "FIXE", recurrenceId: schedule.recurrenceId,
    occurrenceWeek: occurrence.week, originalDate: occurrence.date, isException: false,
    startedAt: null, completedAt: null, absentAt: null, cancelledAt: null,
    applicableRate: applicablePrice(schedule.teacher, occurrence.date), chargeAmount: null, persisted: false,
    defaultRate: applicablePrice(schedule.teacher, occurrence.date), priceOverride: null, pricingSource: "HABITUEL",
    expectedPrice: applicablePrice(schedule.teacher, occurrence.date), financial: null,
    recurrence: recurrenceRow(schedule.recurrence.schedules[0] ?? schedule),
  };
}

/** Read-only expansion: viewing a date never inserts reservations or future rows. */
export async function readAgendaEvents(reader: AgendaReader, from: string, to: string): Promise<AgendaEvent[]> {
  const fromAt = tunisDate(`${from}T12:00:00+01:00`).startOf("day").toDate();
  const toAt = tunisDate(`${addDays(to, 1)}T12:00:00+01:00`).startOf("day").toDate();
  const concrete = await reader.teachingSession.findMany({ where: { startAt: { lt: toAt }, endAt: { gt: fromAt } }, include: agendaSessionRelations });
  const occupiedWeeks = await reader.teachingSession.findMany({ where: { recurrenceId: { not: null }, occurrenceWeek: { gte: dateValue(weekMonday(from)), lte: dateValue(weekMonday(to)) } }, select: { recurrenceId: true, occurrenceWeek: true } });
  const schedules = await reader.recurrenceSchedule.findMany({ where: { supersededAt: null, recurrence: { active: true }, startDate: { lte: dateValue(to) }, OR: [{ endDate: null }, { endDate: { gte: dateValue(from) } }] }, include: agendaScheduleRelations });
  const persisted = new Set(occupiedWeeks.map(value => `${value.recurrenceId}@${dateString(value.occurrenceWeek!)}`));
  const events = concrete.map(concreteEvent);
  for (const schedule of schedules) {
    for (const occurrence of generateWeekly({ ...schedule, startDate: dateString(schedule.startDate), endDate: schedule.endDate ? dateString(schedule.endDate) : null }, from, to)) {
      if (!persisted.has(`${schedule.recurrenceId}@${occurrence.week}`)) events.push(virtualEvent(schedule, occurrence));
    }
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}

/** A finite list of concrete bookings plus the next effective occurrence of each fixed schedule. */
export async function upcomingBookings(reader: AgendaReader, classroomId: string, now = new Date()): Promise<AgendaEvent[]> {
  const today = tunisDate(now).format("YYYY-MM-DD");
  const concrete = await reader.teachingSession.findMany({ where: { classroomId, status: { in: ["PLANIFIEE", "EN_COURS"] }, endAt: { gt: now } }, include: agendaSessionRelations, orderBy: { startAt: "asc" } });
  const schedules = await reader.recurrenceSchedule.findMany({ where: { supersededAt: null, classroomId, recurrence: { active: true }, OR: [{ endDate: null }, { endDate: { gte: dateValue(today) } }] }, include: agendaScheduleRelations });
  const persisted = await reader.teachingSession.findMany({ where: { recurrenceId: { not: null }, occurrenceWeek: { gte: dateValue(weekMonday(today)) } }, select: { recurrenceId: true, occurrenceWeek: true } });
  const keys = new Set(persisted.map(value => `${value.recurrenceId}@${dateString(value.occurrenceWeek!)}`));
  const result = concrete.map(concreteEvent);
  for (const schedule of schedules) {
    let cursor = dateString(schedule.startDate) > today ? dateString(schedule.startDate) : today;
    // At most one skip per persisted exception; open-ended series need no horizon.
    for (let i = 0; i <= persisted.length + 1; i++) {
      const occurrence = generateWeekly({ ...schedule, startDate: dateString(schedule.startDate), endDate: schedule.endDate ? dateString(schedule.endDate) : null }, cursor, addDays(cursor, 7))[0];
      if (!occurrence) break;
      if (occurrence.endAt > now && !keys.has(`${schedule.recurrenceId}@${occurrence.week}`)) { result.push(virtualEvent(schedule, occurrence)); break; }
      cursor = addDays(occurrence.date, 7);
    }
  }
  return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
