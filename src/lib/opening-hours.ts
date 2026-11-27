import { tunisDate } from "@/lib/dates";
import { addDays, occurrenceDate, timeOf, weekMonday, type WeeklySchedule } from "@/lib/scheduling";

export interface OpeningHours { openingMinute: number; closingMinute: number; openingDays: number[] }
export interface CentreSlot { date: string; startMinute: number; endMinute: number }
export const defaultOpeningHours: OpeningHours = { openingMinute: 0, closingMinute: 1440, openingDays: [1, 2, 3, 4, 5, 6, 7] };

export function isOpeningDay(hours: OpeningHours, date: string): boolean {
  return hours.openingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay() || 7);
}

export function openingSlotError(hours: OpeningHours, slot: CentreSlot): string | null {
  if (!isOpeningDay(hours, slot.date)) return "Le centre est fermé ce jour. Choisissez un jour d’ouverture.";
  if (slot.startMinute < hours.openingMinute || slot.endMinute > hours.closingMinute || slot.endMinute <= slot.startMinute) {
    return `Les séances doivent être comprises entre ${timeOf(hours.openingMinute)} et ${timeOf(hours.closingMinute)}, pendant les horaires d’ouverture du centre.`;
  }
  return null;
}

/** Legacy intervals may cross midnight; only calendar days actually occupied count. */
export function centreIntervalSlots(startAt: Date | string, endAt: Date | string): CentreSlot[] {
  const start = tunisDate(startAt), end = tunisDate(endAt);
  const firstDate = start.format("YYYY-MM-DD"), lastDate = end.format("YYYY-MM-DD");
  const minuteOf = (value: typeof start) => value.hour() * 60 + value.minute() + value.second() / 60 + value.millisecond() / 60_000;
  const slots: CentreSlot[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    const startMinute = date === firstDate ? minuteOf(start) : 0;
    const endMinute = date === lastDate ? minuteOf(end) : 1440;
    if (endMinute > startMinute) slots.push({ date, startMinute, endMinute });
  }
  return slots;
}

/** Every stored occurrence replaces its template week, including moves and cancellations. */
export function firstUnstoredOccurrence(schedule: WeeklySchedule, storedWeeks: ReadonlySet<string>, from = schedule.startDate): string | null {
  const lower = from > schedule.startDate ? from : schedule.startDate;
  let date = occurrenceDate(weekMonday(lower), schedule.weekday);
  if (date < lower) date = addDays(date, 7);
  // Each skipped week consumes a distinct stored exception. An infinite series
  // therefore has an unsuppressed occurrence after at most N + 1 candidates.
  for (let count = 0; count <= storedWeeks.size && (!schedule.endDate || date <= schedule.endDate); count++, date = addDays(date, 7)) {
    if (!storedWeeks.has(weekMonday(date))) return date;
  }
  return null;
}

/** Keep historical events visible while the default workspace follows current hours. */
export function agendaMinuteRange(hours: OpeningHours, date: string, events: { startAt: string; endAt: string }[], fullDay = false) {
  if (fullDay) return { startMinute: 0, endMinute: 1440 };
  let startMinute = hours.openingMinute;
  let endMinute = hours.closingMinute;
  for (const event of events) {
    const start = tunisDate(event.startAt), end = tunisDate(event.endAt);
    const first = start.format("YYYY-MM-DD") < date ? 0 : start.hour() * 60 + start.minute();
    const last = end.format("YYYY-MM-DD") > date ? 1440 : end.hour() * 60 + end.minute();
    startMinute = Math.min(startMinute, Math.floor(first / 30) * 30);
    endMinute = Math.max(endMinute, Math.ceil(last / 30) * 30);
  }
  return { startMinute, endMinute };
}
