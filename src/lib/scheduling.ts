import dayjs from "dayjs";
import { TIMEZONE } from "@/lib/dates";
import type { SessionStatus } from "@/types/management";

const MINUTE = 60_000;
const DAY = 86_400_000;

function dateValue(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("La date est invalide.");
  }
  return date;
}

export function addDays(date: string, count: number): string {
  if (!Number.isInteger(count)) throw new RangeError("Le nombre de jours est invalide.");
  const result = dateValue(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

export function weekMonday(date: string): string {
  const weekday = dateValue(date).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function occurrenceDate(week: string, weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new RangeError("Le jour de la semaine est invalide.");
  return addDays(weekMonday(week), weekday - 1);
}

export function minutesOf(time: string): number {
  if (time === "24:00") return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError("L’heure est invalide.");
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeOf(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new RangeError("L’heure est invalide.");
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

export function atTunis(date: string, time: string): Date {
  dateValue(date);
  const minute = minutesOf(time);
  return dayjs.tz(`${minute === 1440 ? addDays(date, 1) : date} ${minute === 1440 ? "00:00" : time}`, TIMEZONE).toDate();
}

export function intervalsOverlap(aStart: number | Date, aEnd: number | Date, bStart: number | Date, bEnd: number | Date): boolean {
  return Number(aStart) < Number(bEnd) && Number(aEnd) > Number(bStart);
}

export const blockingSessionStatuses = ["PLANIFIEE", "EN_COURS", "TERMINEE"] as const;

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return true;
  if (from === "PLANIFIEE") return ["EN_COURS", "TERMINEE", "ABSENT", "ANNULEE"].includes(to);
  if (from === "EN_COURS") return ["TERMINEE", "ABSENT", "ANNULEE"].includes(to);
  return false;
}

/** One shared scale for header ticks, events and pointer positions, without hour rounding. */
export function timelineGeometry(startAt: Date | string, endAt: Date | string, date: string, startMinute = 0, pixelsPerHour = 120): { left: number; width: number } {
  if (!Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0 || !Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440) {
    throw new RangeError("L’échelle de l’agenda est invalide.");
  }
  const origin = atTunis(date, timeOf(startMinute)).getTime();
  const boundary = atTunis(addDays(date, 1), "00:00").getTime();
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new RangeError("Le créneau est invalide.");
  const visibleStart = Math.min(boundary, Math.max(origin, start));
  const visibleEnd = Math.min(boundary, Math.max(origin, end));
  return { left: (visibleStart - origin) / MINUTE * pixelsPerHour / 60, width: Math.max(0, visibleEnd - visibleStart) / MINUTE * pixelsPerHour / 60 };
}

export function clickedMinute(x: number, pixelsPerHour = 120, startMinute = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0 || !Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440) {
    throw new RangeError("La position dans l’agenda est invalide.");
  }
  return Math.max(0, Math.min(1410, startMinute + Math.floor(Math.max(0, x) * 60 / pixelsPerHour / 30) * 30));
}

export interface WeeklySchedule {
  weekday: number;
  startMinute: number;
  endMinute: number;
  startDate: string;
  endDate: string | null;
}
export interface WeeklyOccurrence { date: string; week: string; startAt: Date; endAt: Date }

/** Expand only the requested window; permanent weekly schedules never create unbounded rows. */
export function generateWeekly(schedule: WeeklySchedule, from: string, to: string): WeeklyOccurrence[] {
  const first = dateValue(from);
  const last = dateValue(to);
  if (last < first || (last.getTime() - first.getTime()) / DAY + 1 > 370) {
    throw new RangeError("Consultez une période de 370 jours maximum.");
  }
  dateValue(schedule.startDate);
  if (schedule.endDate) dateValue(schedule.endDate);
  occurrenceDate(from, schedule.weekday);
  if (!Number.isInteger(schedule.startMinute) || !Number.isInteger(schedule.endMinute)
    || schedule.startMinute < 0 || schedule.endMinute > 1440 || schedule.endMinute <= schedule.startMinute) {
    throw new RangeError("Le créneau de la programmation fixe est invalide.");
  }
  const lower = from > schedule.startDate ? from : schedule.startDate;
  const upper = schedule.endDate && schedule.endDate < to ? schedule.endDate : to;
  if (lower > upper) return [];
  let date = occurrenceDate(lower, schedule.weekday);
  if (date < lower) date = addDays(date, 7);
  const occurrences: WeeklyOccurrence[] = [];
  for (; date <= upper; date = addDays(date, 7)) {
    occurrences.push({ date, week: weekMonday(date), startAt: atTunis(date, timeOf(schedule.startMinute)), endAt: atTunis(date, timeOf(schedule.endMinute)) });
  }
  return occurrences;
}
