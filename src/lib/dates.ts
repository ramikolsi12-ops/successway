import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "dayjs/locale/fr";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("fr");
export const TIMEZONE = "Africa/Tunis";
export function tunisDate(value: Date | string = new Date()) { return dayjs(value).tz(TIMEZONE); }
export function tunisInputISO(value: Dayjs) {
  return dayjs.tz(value.format("YYYY-MM-DD HH:mm:ss"), TIMEZONE).toISOString();
}
export function periodBounds(now: Date = new Date()) {
  const local = tunisDate(now);
  return {
    dayStart: local.startOf("day").toDate(),
    dayEnd: local.startOf("day").add(1, "day").toDate(),
    monthStart: local.startOf("month").toDate(),
    monthEnd: local.startOf("month").add(1, "month").toDate(),
    monthDateStart: new Date(`${local.startOf("month").format("YYYY-MM-DD")}T00:00:00Z`),
    monthDateEnd: new Date(`${local.startOf("month").add(1, "month").format("YYYY-MM-DD")}T00:00:00Z`),
  };
}
