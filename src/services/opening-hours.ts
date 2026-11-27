import "server-only";
import { BusinessError } from "@/lib/business-error";
import { tunisDate } from "@/lib/dates";
import { centreIntervalSlots, firstUnstoredOccurrence, openingSlotError, type CentreSlot, type OpeningHours } from "@/lib/opening-hours";
import { addDays, weekMonday, type WeeklySchedule } from "@/lib/scheduling";
import type { Transaction } from "@/services/management-shared";

type Reader = Pick<Transaction, "teachingSession" | "recurrenceSchedule">;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function assertCentreSlot(hours: OpeningHours, slot: CentreSlot) {
  const error = openingSlotError(hours, slot);
  if (error) throw new BusinessError(error, 409);
}

export async function assertCentreWeeklySchedule(reader: Pick<Reader, "teachingSession">, hours: OpeningHours, schedule: WeeklySchedule & { recurrenceId: string }) {
  const stored = await reader.teachingSession.findMany({ where: { recurrenceId: schedule.recurrenceId }, select: { occurrenceWeek: true } });
  const weeks = new Set(stored.flatMap(session => session.occurrenceWeek ? [dateOnly(session.occurrenceWeek)] : []));
  const date = firstUnstoredOccurrence(schedule, weeks);
  if (date) assertCentreSlot(hours, { date, startMinute: schedule.startMinute, endMinute: schedule.endMinute });
}

/** Call inside the same agenda lock as settings and reservation writes. No generation horizon. */
export async function assertOpeningHoursCompatible(reader: Reader, hours: OpeningHours, now: Date = new Date()): Promise<void> {
  const today = tunisDate(now).format("YYYY-MM-DD");
  const [sessions, schedules, stored] = await Promise.all([
    reader.teachingSession.findMany({ where: { status: { in: ["PLANIFIEE", "EN_COURS", "TERMINEE"] }, endAt: { gt: now } }, select: { startAt: true, endAt: true } }),
    reader.recurrenceSchedule.findMany({ where: { supersededAt: null, recurrence: { active: true }, OR: [{ endDate: null }, { endDate: { gte: new Date(`${today}T00:00:00Z`) } }] },
      select: { recurrenceId: true, weekday: true, startMinute: true, endMinute: true, startDate: true, endDate: true } }),
    reader.teachingSession.findMany({ where: { recurrenceId: { not: null }, occurrenceWeek: { gte: new Date(`${weekMonday(today)}T00:00:00Z`) } }, select: { recurrenceId: true, occurrenceWeek: true } }),
  ]);
  const warning = (date: string): never => { throw new BusinessError(`Ces horaires sont incompatibles avec une réservation à venir le ${tunisDate(`${date}T12:00:00+01:00`).format("DD/MM/YYYY")}. Déplacez ou annulez la séance concernée avant de modifier les horaires du centre.`, 409); };
  for (const session of sessions) {
    for (const slot of centreIntervalSlots(session.startAt, session.endAt)) if (openingSlotError(hours, slot)) warning(slot.date);
  }
  const weeksBySeries = new Map<string, Set<string>>();
  for (const session of stored) if (session.recurrenceId && session.occurrenceWeek) {
    if (!weeksBySeries.has(session.recurrenceId)) weeksBySeries.set(session.recurrenceId, new Set());
    weeksBySeries.get(session.recurrenceId)!.add(dateOnly(session.occurrenceWeek));
  }
  const currentMinute = tunisDate(now).hour() * 60 + tunisDate(now).minute();
  for (const schedule of schedules) {
    const proposal = { ...schedule, startDate: dateOnly(schedule.startDate), endDate: schedule.endDate ? dateOnly(schedule.endDate) : null };
    const from = schedule.endMinute <= currentMinute ? addDays(today, 1) : today;
    const date = firstUnstoredOccurrence(proposal, weeksBySeries.get(schedule.recurrenceId) ?? new Set(), from);
    if (date && openingSlotError(hours, { date, startMinute: schedule.startMinute, endMinute: schedule.endMinute })) warning(date);
  }
}
