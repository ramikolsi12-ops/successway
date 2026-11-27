import { BusinessError } from "@/lib/business-error";
import { tunisDate } from "@/lib/dates";
import type { SessionStatus } from "@/types/management";
import { z } from "@/validations/locale";

const monthSchema = z.string().length(7).regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
  .refine(value => Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 9998);

/** Calendar dates are inclusive and never derived by converting local midnight to UTC. */
export function dashboardMonth(month: string | undefined, now: Date = new Date()) {
  const currentMonth = tunisDate(now).format("YYYY-MM");
  const parsed = monthSchema.safeParse(month ?? currentMonth);
  if (!parsed.success) throw new BusinessError("Choisissez un mois valide au format AAAA-MM, entre 1900 et 9998.");
  const selectedMonth = parsed.data;
  const [year, monthNumber] = selectedMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const startDate = `${selectedMonth}-01`;
  return {
    month: selectedMonth,
    currentMonth,
    monthLabel: tunisDate(`${startDate}T12:00:00+01:00`).locale("fr").format("MMMM YYYY"),
    startDate,
    endDate: `${selectedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function monthlyActivity(events: { classroomId: string; teacherId: string; status: SessionStatus }[]) {
  const statuses = { planned: 0, running: 0, completed: 0, absent: 0, cancelled: 0 };
  const rooms = new Set<string>();
  const professors = new Set<string>();
  for (const event of events) {
    switch (event.status) {
      case "PLANIFIEE": statuses.planned++; break;
      case "EN_COURS": statuses.running++; break;
      case "TERMINEE": statuses.completed++; break;
      case "ABSENT": statuses.absent++; break;
      case "ANNULEE": statuses.cancelled++; break;
    }
    if (event.status === "PLANIFIEE" || event.status === "EN_COURS" || event.status === "TERMINEE") {
      rooms.add(event.classroomId);
      professors.add(event.teacherId);
    }
  }
  return { sessionsCount: events.length, statuses, roomsUsed: rooms.size, scheduledProfessors: professors.size };
}
